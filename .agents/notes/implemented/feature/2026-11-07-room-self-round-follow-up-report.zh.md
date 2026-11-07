# Agent Note：成员自己开的一轮作为后续回报交回派活人

Status: implemented

## Problem

成员自开轮设计（`proposals/active/2026-11-06-member-self-started-rounds.md`，不在仓库里）的 M4 已经让 Kimi CLI 在后台任务结束后自己开的一轮成为独立执行：调用方 `cli`，起因 `{ kind: 'self', reason: 'background-task', taskId, taskStatus, startedBy }`。房间原本就像对待别处发起的轮次一样显示这一轮（`observeMemberExecution`），但有两个缺口：一是没有任何地方说明成员为什么在说话；二是成员承诺过「完成后我会继续汇报」，结果却始终交不到派活的成员手里。

## Decision

M5 主要改 room，Context Lens 顺带做了一点小补充：

- **这一轮接着什么在做**：自开轮的运行边（`room/run-state`）和回复（`room/speech`）带可选字段 `continues: { taskId, taskStatus, label?, runId? }`（`RoomRoundContinues`）。`runId` 是运行边上写着 `startedBy` 的那条房间 run。`label` 是任务描述，在这一轮运行期间经 local-agent 的 `memberBackgroundTasks` 读取（可选探测）；轮次结束时还没读到，就不写。卡片标题显示「X 正在处理后台任务的结果」。回复上方加一行安静的小字「↻ 后台任务完成后继续 · <描述>」（失败、超时、停止时把「完成」换成对应字样），点击滚动到启动该任务的那一轮。
- **后续回报**：房间先找到原投递（`followUpDelivery`）。如果启动任务的那一轮本身也是自开轮（`execution:<id>`），就顺着它的 `continues.runId` 往回追，最多追 8 层。原投递本来会汇报的（协调者或成员派出、且带 `replyTo`），走现有的 `reportOutcome` → `gateReport` 发后续回报。后续回报有自己的去重键 `room/dispatch.reportFor = execution:<自开轮 executionId>`，并新增可选字段 `followUpOf = <原投递 id>`；收件人、任务、计划节奏都取自原投递。原投递自己的汇报早已交过，不受影响。信封写「#mN 的后续回报 · 来自 X · 后台任务完成」（或失败、超时、已停止）。回复带 `reportedTo`，显示「→ 已作为后续回报交给 Y」。
- **不汇报的情况**：活是人派的（人在房间里直接看到回复），或者启动任务的那一轮来自成员页、宿主 `subagent` 工具（这类 `execution:` run 不属于房间的活）。这两种情况仍显示那行小字。
- **起因与「收到…」行**：`executionFacts` 把 `reportFor` 为 `execution:<id>` 的派活映射为 `{ kind: 'execution', executionId }`，与汇报触发的轮次是同一种起因，没有新增起因。`speech-cause.ts` 的 `reporter()` 识别 `execution:`（成员从 run 上取，取不到就用原投递）和 `background-task:`（M6 用）。收件人的回复显示「收到 X 的后续回报」。
- **Context Lens**：契约夹具新增第 10 步，即协调者的「做甲」派活之后发生的一次自开轮及其后续回报。Lens 的 `roomSelfRounds` 原来只按协作树把自开轮归到某个人的轮次下；协调者自己发出的派活不在这棵树里，自开轮就落进了「未归轮」。现在 Lens 也会按启动派活的 `task`（`RoomDispatchLink.task`）认领，与决策已有的按 `task` 兜底是同一做法。

## Alternatives considered

- **后续回报按原投递 id 去重**：否决。这个键已经被原汇报占用，后续回报永远发不出去。
- **为后续回报的轮次新增一种起因**：否决。汇报触发的轮次本来就是 `execution`。
- **把并进别的轮次的结果转给原派活人**（成员忙别的事时任务结束）：按用户决定 5 否决，那条回复已经交给了当时那一轮的派活人。这种情况的标记本期也没有做：不读 wire，房间看不到结果是否被并进了那一轮。

## Consequences

- `room/dispatch.followUpOf`、`room/speech.continues`、`room/run-state.continues` 都是已登记类型上的可选字段，旧版本会忽略它们。
- 自开轮只在其房间于本宿主进程中处于活跃状态时显示（`observeMemberExecution` 需要拿到房间会话）。没人打开的房间里发生的自开轮，成员会话里有镜像，但房间里不显示、也不汇报。

## Testing

- `packages/room/tests/dispatch.host.spec.ts`：成员派的活引出的自开轮 → 运行卡片带 `continues`，回复带小字、任务描述和 `reportedTo`，经闸门发出一条后续回报（键为 `execution:exec-self`，带 `followUpOf`），信封为「后续回报 · 来自 bill · 后台任务完成」，收件人那一轮的起因是 `execution`；人派的活 → 只有小字，不写派活；成员页那一轮 → 只有小字，不写派活。
- `packages/room/tests/nodes.client.spec.tsx`：`speechCause` 覆盖 `execution:`、`background-task:` 和执行记录缺失三种情况；回复小字的显示与点击，以及「已作为后续回报交给」；卡片标题。
- `packages/room/tests/lens-contract.host.spec.ts` 新增第 10 步并重新生成夹具；`packages/context-lens/tests/room-contract.spec.ts` 断言该自开轮归在「第三轮」下。
- 预览：`packages/room/tests/preview/self-round.html?state=running|selfdone|human`。
