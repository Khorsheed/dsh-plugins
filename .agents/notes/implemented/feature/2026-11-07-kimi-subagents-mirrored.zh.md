# Agent Note：Kimi 成员自己的子智能体镜像成孙会话

Status: implemented

## 问题

Kimi 成员可以调用自己的 `Agent` 工具，或 `AgentSwarm`（一次调用派出多个）。Kimi 把每个子智能体都完整记了下来，dsh 却一条也没镜像。成员会话里只有一行普通工具，子智能体的花费也不在任何读数里：Kimi 把它写进子智能体自己的 wire，从不写进成员的。

已定稿的设计 `proposals/active/2026-11-06-member-cli-subagents.md`（不在仓库里）把每个子智能体镜像成成员下面的孙会话。步骤 M2（[核心写入器的 note](2026-11-06-cli-subagent-sessions-core.md)）加了写入器，步骤 M4（[Claude Code 的 note](2026-11-06-claude-subagents-mirrored.md)）是参照实现。本 note 是步骤 M3：Kimi 接入，live 与 exec 两条路径都接。

## 决定

新模块 `packages/local-agent-kimi/src/subagent-mirror.ts` 放 `KimiSubagentMirror`。它只读，写入由核心的 `openCliSubagent` 负责。

**读成员 wire。** `session-view.ts` 的 `readKimiSubagents(sessionDir)` 读成员 wire 里的 `subagent.spawned` 与 `subagent.completed`，按派出顺序每次调用一条。

- 完成行归给同一子智能体在它之前最近的一次派出。
- 同一 `subagentId` 的第 n 次派出是续用，`ordinal` 为 n。
- 共用一个 `parentToolCallId` 的几次派出是一组 `AgentSwarm`。组内位置取 `swarmIndex`：wire 上从 1 数，起因里从 0 数。
- wire 上 `subagent.*` 的时间是秒，换算成毫秒；loop 事件本来就是毫秒。
- `subagent.completed.usage` 是子智能体的**累计值**，不是这一次的花费。本机 wire 可以证明：每次续用后的完成值，都等于它到那时为止各轮之和。所以一次调用的 `providerReportedUsage` 取与同一子智能体上一次完成值的差。设计原先假定是本次数字。

设计要求由 `readKimiTranscript` 自己产出这份列表，这里改成了单独的读取函数。原因有二：后台子智能体在两轮之间也要这份列表，那时没有成员镜像在跑；给 transcript 加字段又会改动现有的每一个 transcript 测试。

**读子智能体 wire。** `readKimiTranscript(dir, { agent })` 与 `wirePath(dir, agent)` 读 `agents/<agent>/wire.jsonl`。折叠沿用成员那一套，子智能体 wire 有两处不同：

- origin 为 `system_trigger`/`subagent` 的 `turn.prompt` 是这次调用的任务：它开下一轮，所以一次调用一轮；它也不算注入。照成员的折叠，所有续用都会并进第 1 轮。
- `turn.ended` 的原因作为 `endedTurns` 报出。

成员自己的读取不变。

**镜像。** 每一遍读成员 wire，接纳基线之后派出的每次调用。

- 调用经 `openCliSubagent` 与 `beginExecution` 立刻接纳，不等任何内容。这样开始记录写下时，成员这一轮还在跑，能对上成员当前开着的那次执行。起因带 `callId`、`name`、`group`、`background`、`resumed` 与派出时间。
- 这一遍把这次调用的那一轮按 wire 步折叠，一个 wire 步对应孙会话一步：提示词写成 `user/message`，`llm.request` 写成 `request/header`，每步带它自己的 `usage.record`。
- 调用进行中，wire 还没关上的步会挡住折叠，有工具还没结果的步也会。
- 续用调用的执行等上一次关上之后才开。

**收尾。**

- **`subagent.completed`。** 补完这一轮，执行以 `done` 结束，时间取 Kimi 的完成时间，`providerReportedUsage` 写本次的份额。
- **子智能体那一轮以 `cancelled`/`error` 结束。** 执行以 `cancelled` 或 `failed` 结束。
- **同一子智能体又被派出。** Kimi 只续用空闲的子智能体，所以上一次调用已经结束，定为 `uncertain`。
- **成员这一轮结算。**
  - 还开着的前台调用定为 `cancelled`，被打断的那一步标 `interrupted`。如果它那一轮已经以 `completed` 结束、只是完成行晚到，就定为 `done`。
  - 后台调用保持打开。exec 路径上进程已经退出，所以定为 `cancelled`。
- **成员进程没了**（回收、`onDead`）。所有还开着的调用定为 `uncertain`。

**不回填。** 基线是镜像接上会话那一刻成员 wire 的行数。live 在 `session/new` 或 `session/load` 之后、发提示词之前接上；exec 续用在启动进程之前接上；exec 新会话从第 0 行接上。基线之前的调用一律不镜像，重启后新建的镜像也不会重读历史。

**接线。**

- **live**（`live-driver.ts`）。每个成员一个镜像，活得比一轮长。
  - 每一遍成员镜像之后都跟一次子智能体镜像，自开轮里也是。
  - 一轮结算时，`settleRound` 在 `settleMirror` 之后、关成员这一轮之前运行。
  - `reclaim` 与 `onDead` 调 `lost()`。
  - 只要有调用开着，每 2 秒轮询一次（`subagentPollMs`），没有 ACP 更新也照读。
- **exec**（`kimi-cli-provider.ts`）。exec 的轮询顺带推进镜像。结算时在关这一轮之前运行 `settleRound({ processExited: true })`。

**后台任务关联。** `readKimiBackgroundTasks` 多一个可选查询 `subagentSessionOf`。Kimi 的任务状态里写着子智能体是谁（`agentId`）。Kimi 的任务读取只在成员日志里有那个孙会话的目录行时才给 `LocalAgentBackgroundTask.subagentSessionId` 填值，所以这个关联是记录下来的事实。

任何失败都降级：记一次警告，这个子智能体不镜像，成员这一轮不受影响。

## 考虑过的其他做法

**`subagent.completed.usage` 原样当本次。** 不采用。本机 wire 显示它是累计值，原样用会让续用的子智能体每续用一次就把之前几次重复算一遍，用量相等的约束也会被打破。

**镜像成员 wire 里所有的派出。** 不采用。这会回填旧日志，用户已经定了不回填；而且折叠进度只在内存里，重启后会重复写步。

**等第一条内容出现才接纳**（M4 的做法）。不采用。后台调用的开始记录必须在成员那次执行还开着时写下，才能对上它；发现即接纳，卡片也能马上有东西可以打开。

## 影响

- Kimi 这一步不改核心，M2 的 API 照用。
- 孙会话日志用的是成员镜像的折叠和共享的写步函数，所以工具结果按同样的规则截断（用户决定：截断同成员镜像）。
- 续用的子智能体是一个会话，每次调用是一次执行、一轮（用户决定）。
- 调用开着的时候，每一遍都整份重读子 wire（2 秒一次）。Kimi 的子 wire 大约 1 到 2.5 MB，目前可以接受；真成了问题，下一步改成按偏移读。
- 成员自己的事件除了每个子智能体一条 `subagent/catalog` 之外不变。

## 测试

合成夹具由 `tests/subagent-fixtures.ts` 里的构造函数生成，不用任何真实内容。`tests/subagent-mirror.spec.ts` 共 12 个用例：

- `readKimiSubagents`：顺序、续用编号、累计值换算成本次份额、3 个成员的 `AgentSwarm` 组、后台 `taskId`、秒换毫秒；
- 子智能体 wire 一次调用一轮；
- 前台调用进行中就镜像、完成即关，续用成为同一会话的第二次执行，每次执行的逐次用量都等于它的 `providerReportedUsage`；
- 3 个孙会话的 `AgentSwarm`；
- Kimi 没收尾的调用定为 `cancelled`，最后一步标中断；
- 基线之前的历史不镜像；
- 后台：一轮结束后仍开着，关联到任务，之后定为 `done`；
- 后台调用遇 `lost()` 定为 `uncertain`；
- exec 定为 `cancelled`；
- 降级；
- 续用子智能体的镜像快照，其逐次用量之和等于 Kimi 最后的累计值；
- exec 轮分别带与不带 home 各跑一次，断言成员事件除目录行外完全相同。

每个孙会话日志都通过 `assertReleasedV4Relationships`。

未覆盖：没有带子智能体的 live 驱动 ACP 用例，接线就是上面列出的四个调用点。没有运行真实的 Kimi 进程。
