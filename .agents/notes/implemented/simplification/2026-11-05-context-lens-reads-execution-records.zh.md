# Agent Note：Context Lens 读执行记录，不再推断归属

Status: implemented

## 问题

批 5（统一执行入口，设计稿 `proposals/active/2026-11-03-unified-execution-entry.md`，在仓库外）第 S8 步。S1–S7 与 S9 让写入端记下了事实：每次成员执行都在子会话里写 `local-agent/execution` 的 start/end 记录（S1）；`/compact` 一定留下带 `unrecorded` 标记的压缩事实（S2）；codex live 每次调用一步（S3）；room 的 run 带 `executionId`，`childTurn` 取自结算（S5）；`room/decision` 与 `room/help` 写明所属任务和 run（S9）。Context Lens 却仍按时间猜这些归属：

| 推断（改前） | 位置 |
|---|---|
| run 的请求 = 时间窗 ±2 秒内的子会话请求；没结束的 run 截到该成员下一个 run 或下一条派活 | `store.ts` `roomTurns`（`- 2000`/`+ 2000`）、`laterRuns`、`openRunEnd`、`laterChildTurns` |
| run 没有子会话 id 时，取开始时间 10 秒内最近的子会话 | `store.ts` `childOfRun` |
| 决策归到它之前最近开始的那一轮 | `store.ts` `decisionsByTurn` |
| 两轮之间的 `/compact` 归到最后关闭的那一轮 | `log-lane.ts` `buildCliCompaction`（`lastTurnHost`） |
| 没有用量的外部步拼成一次请求 | `log-lane.ts` `deferred` / `flushDeferred` / `joinCall` |
| 外部步的开始时间用上一个事件的时间代替 | `log-lane.ts` `MIRROR_LAG_MS` / `stepPrevAt` |
| 没有 `messageId` 的派活按文本往回找人类消息 | `service.ts` `humanMessageBefore` |

## 决定

Lens 改为读记录。按房间的每一轮、按数据判断，不按日期或版本（设计稿补充「房间 Context Lens 对旧数据的兜底」，用户已批准）。

- **有记录的轮。** run 带 `executionId` 或 `childTurn` 就算有记录。它的请求就是子会话记录点名的那些：被该执行 start/end 记录夹住的请求（`StoredRequest.executionId`，fold 时标上），加上 end 记录列出的轮次里的请求；还没读到子会话记录（尚未读取，或是批 4 的 run）时，用 room 写下的 `childTurn`。run 只用 `childSessionId` 找子会话，没有就近匹配。成员视图带上执行自己记下的事实（`AgentScopeOverview.execution`：起因类别、结局、`unrecorded`）。
- **没有记录的轮**（`TurnListItem.room.unrecorded`）：不给成员视图。`TurnOverview.roomFallback` 列出每个 run 的成员、会话和时间段；面板显示「暂无房间维度的请求视图」，每个成员一个「在成员会话里查看」，打开成员自己的透镜并选中包含该 run 开始时刻的那一轮（新的页签导航 `locateTime`、`openMemberSessionAt`）。整个会话一轮都没有记录时（`ListTurnsResult.roomRecords: 'none'`），这句话只在顶部说一次，每轮只留入口。
- **「未归轮」分组**（`ROOM_UNATTRIBUTED_TURN`、`TurnListItem.roomUnattributed`）：没有记录能归到某一轮的决策模型调用，以及没有被有记录的轮认领的成员压缩（`/compact` 自己那次执行、没有记录的轮里的压缩）。列在最后，不编号，也不会是默认落点（`isHollowTurn`）。
- **决策。** 归属依次取：它点名的 run（`runId` → 该 run 的轮）、它归档的人类消息（`about.message` → 以该消息为锚的轮）、写入时正在进行的主对话轮、它点名的任务（`task` → 开启该任务的轮），都没有就进未归轮。
- **带记录的成员日志**（`SessionLogCursor.recorded`，读到第一条 `local-agent/execution` 时置上）：一条 `assistant/message` 就是一次请求，不拼接；没有原始发出时刻的请求，开始时间取其流的第一个片段，没有就取该步的写入时间，并标 `startUnrecorded`；声明了 `per-call-usage` 的执行，带用量的那一步标 `roundTotal`（整轮合计）。没有记录的旧日志仍走旧的 fold，成员自己的透镜看旧历史和以前一样。
- **压缩。** 两轮之间的 CLI 压缩没有轮次（不再归到最后关闭的那一轮），带上记录夹住它的执行。它的 `unrecorded` 标记原样传下去，显示为「未记录：用量、前后大小、摘要」。
- **对话锚点。** 一轮的锚点就是它的派活记下的 `messageId`；没有就没有。

Lens 仍然零依赖：`local-agent/execution` 和 room 的新字段都按结构读取（`readExecutionRecord`）。

## 考虑过的其他方案

- **旧轮次保留时间窗推断，标「推断」**（设计稿待定 1 的方案 B）。用户否决（用户决定 1）。
- **按会话、或按宿主/插件版本判断。** 用户的补充否决了：按每一轮的数据判断，一条规则同时覆盖新旧混杂的会话、旧版插件的社区用户和从不写记录的第三方 provider。
- **把标了调用边界未记录的执行的各步合成一次请求。** 否决：那就是重新拼接。每步仍是一行，成员视图写明「调用边界未记录」，用量那行标「整轮合计」。
- **旧日志也去掉拼接。** 否决：用户决定 1 要求成员自己的透镜不受影响，旧的 codex 日志会散成逐 item 的行。
- **把 `/compact` 的压缩放进该成员的上一轮。** 否决：没有记录说它属于那里；它的执行不属于任何轮，所以进未归轮。

## 影响

- 用户可见，只在房间的 Context Lens：旧轮次显示兜底和进入成员透镜的入口；没有记录归属的决策和压缩挪到「未归轮」（一些以前按时间落在某轮的决策现在在这里）；`/compact` 不再出现在上一轮的「压缩」页签；成员视图显示起因和来源不记录的项目；压缩关系行改为「{name} 执行了 /compact」，并加上未记录项。
- 带记录的成员日志：codex exec 的一轮每步一行，最后一步标「整轮合计」。在成员自己的透镜里，没有原始流、也没有用量的纯文本步仍算历史（原有的镜像注释规则，没变）。
- 不变：每条回复下的「请求明细」、成员自己透镜里的旧日志、用量数字。
- 本步没动：`attachedTurn` 对主会话压缩伪轮次的放置，以及主会话的 `insideMainTurn` 判断（都不在设计稿 D 节）。

## 测试

- `tests/room-rounds.spec.ts`（重写）：逐轮判断（同一会话里有旧轮兜底、批 4 `childTurn` 轮、批 5 执行轮）；一轮都没记录时顶部只提示一次；执行不按时间段认领请求；未结束的执行持有记录夹住的请求；`/compact` 和无记录轮的压缩进未归轮；决策按 `runId` / `about.message` / 主对话轮包含 / `task` / 未归轮归属；对话锚点不按文本找。
- `tests/room-contract.spec.ts`：回放 room 真实写入端的产物，新增 `childRows`（shim 写的执行记录）、带 `runId`/`task`/`executionId` 的汇报时机决策和求助线程（夹具由扩展了 S9 的 `packages/room/tests/lens-contract.host.spec.ts` 重生成）。
- `tests/local-agent-contract.spec.ts`（新增）：回放 `tests/fixtures/local-agent-contract.json`，它由新增的 `packages/local-agent/tests/lens-contract.spec.ts` 用真实核心生成（一轮 live、一轮声明 `call-boundaries`/`per-call-usage` 的 codex exec 形状、一条核心写的未记录压缩）；同时验证去掉记录的同一份日志仍按旧方式 fold。
- `tests/cli-compaction.spec.ts`、`client-panel.spec.tsx`、`client-member-jump.spec.ts`、`client-aggregate.spec.ts`：压缩的执行与标记、兜底卡片和入口、顶部提示、执行说明、未归轮、`locateTime`。
- context-lens 311 → 333，room 530 → 531，local-agent 528 → 530，bundle-local-agent 5；`pnpm check:plugins` 无问题。
- 截图（1280 与 390）取自 `examples/workbench/room-records.html`，用真实 store 加 local-agent 夹具；未提交。
- 未验证：3080 上的真实房间、真实宿主里入口切换会话、真实的 codex exec 日志。
