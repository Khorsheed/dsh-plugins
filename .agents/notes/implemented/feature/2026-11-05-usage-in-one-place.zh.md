# Agent Note: 用量只写一处，房间读取显示

Status: implemented

## Problem

批 5（统一执行入口，设计稿 `proposals/active/2026-11-03-unified-execution-entry.md`，不在仓库里）的写入端事实③要求：成员一轮的用量只写在一处。本步（S6）之前，room 自己存了副本：

- `room/execution-metadata` 带 `tokens` 和 `usage`，抄自 `settled` 进度事件（provider 的 settle 报告）。
- `room/member-compacted` 带 `beforeTokens`/`afterTokens`/`contextWindow`/`usage`，抄自成员日志里的 `local-agent/compaction` 事实。

设计稿迁移行 S6 的要求是：room 不再存数，改经核心的 `readExecution` 读取。用户决定 2（2026-11-03）与该行不同的地方以决定为准：**两个数都记**，互相核对。CLI 自报的整轮合计是独立来源的事实，从 S1 起写在 `local-agent/execution` end 记录的 `providerReportedUsage` 上。逐次调用用量只在 `assistant/message.usage` 上。room 每轮显示 CLI 合计，逐次之和与它不一致时给提示。

## Decision

- **核心只读接口**（`LocalAgentRegistry.readExecution(childSessionId, executionId)`，在 `packages/local-agent/src/index.ts`；纯函数 `executionReadingsOf` 在 `packages/local-agent/src/execution-read.ts`）。它只读不写，返回 `LocalAgentExecutionReading`（`types.ts`）：
  - `callUsage`/`calls`：`turn` 落在本执行轮次里的所有 `assistant/message.usage` 之和。各桶分开相加；`totalTokens` 不加，因为各 CLI 对它的定义不同。
  - `providerReportedUsage`：照抄 end 记录。
  - `unrecorded`：照抄 end 记录。
  - `compactions`：start 与 end 记录之间的 `local-agent/compaction` 事实。它们从不并入 `callUsage`，其中的前后大小是上下文大小，不是用量。
  - `outcome`、`turns`、`operation`。

  执行未结束时，区间从它的 start 记录到下一条执行记录，轮次取区间内的 `turn/start`。活会话只在最后一个 seq 变化后才重算。冷会话每个子会话只从存储读一次，做法同 `coldContexts`；读失败不缓存。结果不落盘。
- **room 不再抄数。** `room/execution-metadata` 新写入只带 `model`/`effort`；settle 报告里没有观测项时不写这一行。`room/member-compacted` 新写入只带 `runId`/`outcome`/`summary`/`error`/`durationMs`/`unreported`。`unreported` 保留：它是核心事实写入时的标记，还决定投递结果的文案，而且它不是数字。旧字段留在类型里并注明为旧数据，旧行按当时写下的内容回放。
- **room 把读取结果挂到运行上**（`RoomService.readExecutions`，由 `getState` 调用）。对每条带 `executionId` 和 `childSessionId` 的回放运行，room 经现有探测调用 `localAgent.readExecution`（`readExecution` 加进了 `LocalAgentFacade` 的可选部分），结果写进 `RoomExecution.reading`。每次读取时计算，从不写日志。以下情况运行保持回放原样：没有门面、核心不带这个方法、读取失败、找不到该执行。
- **room 客户端决定显示什么**（`packages/room/src/client/round-usage.ts`）：
  - `roundUsage(execution)`：读取结果里有 CLI 合计时，显示 CLI 合计及其明细，明细里同时列出逐次之和。逐次之和与合计相差超过 `max(50, 合计的 1%)` 时，`gap` = 逐次之和 − 合计。
  - 读取结果里没有 CLI 合计（kimi、dsh）时，显示逐次之和。
  - 没有读取结果时，显示旧数据里存的 `usage`/`tokens`。有读取结果就以它为准，两者从不混用。
  - `compactionNumbers(row, execution)`：取读取结果里最后一条压缩事实，没有时用这一行的旧副本。
- **界面。**
  - `RoomSpeechView` 的用量 chip 改用 `roundUsage`。面板标题注明数字来源：「本轮用量（CLI 报告）」或「本轮用量（逐次合计）」，旧行仍是「本轮用量」。有差额时在该轮旁加一句 meta 样式的轻提示：「逐次合计比 CLI 报告少 {n}，可能有未记录的内部调用」/ "Calls sum to {n} less than the CLI total; possibly unrecorded internal calls"，另有「多」的版本。提示放在操作行最后，回复较窄时单独折到下一行；用量明细面板里也完整重复一遍。
  - `RoomCompactionView` 新注入 `roomStore`，经 `compactionNumbers` 读数。
  - `memberUsage`（统计 chip）、`executionRows`（任务页）、`team.ts`（团队页）累加的都是每轮显示的同一个数。投递行按 `runId` 关联执行，不按另一个展示用的执行 id；投递自身的身份和状态仍然优先。
- **决策模型调用的用量**不动，仍只在 `room/decision` 上。

## Alternatives considered

- **只显示逐次之和**（设计稿该行原来的建议）。被用户决定 2 推翻：显示 CLI 合计，逐次之和用来核对。
- **在核心里算差额。** 不采用。核心只返回事实；要不要标出差异、怎么标，属于展示。room 运行时不能 import 核心，所以比较放在 room 的客户端模块里。
- **执行结束后把读取结果存进房间日志**（重复读取更便宜）。不采用，那又成了副本。改为按子会话在内存里缓存读取结果。
- **新压缩行不再写 `unreported`。** 没有这么做：核心的标记虽然已在事实上，但读取时核心不在场的情况下这一行还要用它，而且 `COMPACT_UNREPORTED_TEXT` 也靠它决定。

## Consequences

- **用户可见：**
  - Claude Code 和 Codex 的轮次显示 CLI 自报的整轮合计，和 S6 之前是同一个数（之前也来自 settle 报告）。Kimi 和 DSH 的轮次改为显示逐次之和。之前显示的是 provider settle 报告里的 `usage`，对 kimi 来说通常就是这个和。
  - 逐次之和对不上 CLI 合计的轮次会出现提示。
  - 新的压缩行数字不变，改为从事实实时读取。
  - S5/S6 之前的轮次照旧显示当时存下的数。
- **降级：** 没有 local-agent，或核心较旧、不带 `readExecution` 时，新轮次不显示用量（只显示耗时），新压缩行不显示数字。不会抛错。
- **成本：** `getState` 现在要读每个执行的子会话日志。活日志每次变化只重算一遍，冷日志每个进程只读一次。成员多、历史长的房间第一次打开时，每个成员要付一次冷读的代价。按设计稿的待核对项，还需要在 3080 上实际看一次。
- **Context Lens** 从来没读过 `room/execution-metadata` 和压缩副本，所以它的源码不用改，测试保持全绿。lens 自己读执行记录是 S8 的事。

## Testing

- `packages/local-agent/tests/execution-read.spec.ts`：
  - `addUsage`。
  - `executionReadingsOf`：逐次之和与合计一致；不一致时两个数并列返回；kimi 没有合计，跨多个轮次和多个执行；压缩事实原样返回且不计入逐次之和；未结束的执行；没有执行记录的日志。
  - `readExecution`：活会话（日志变化后重算），以及在同一 JSONL 存储上另起一个上下文做冷读。
- `packages/room/tests/usage-reading.client.spec.tsx`：
  - `roundUsage`：容差、带符号的差额、kimi、读取结果优先于存量、旧数据。
  - 回复的用量 chip：合计一致（面板里两个数都有，没有提示）；差额提示的中英文；kimi 标题为逐次合计；旧运行显示存量数字。
  - 压缩行：新行从事实读数；事实标了不报告；旧行显示存量数字。
  - `memberUsage` 对三种情况求和。
- `packages/room/tests/dispatch.host.spec.ts`：
  - metadata 只带 model/effort；只有用量的报告什么都不写。
  - `getState` 挂上读取结果，读取抛错时不受影响。
  - `/compact` 行不再抄数字。
- `packages/room/tests/real-core.host.spec.ts`：在真实的 local-agent 核心上，没有任何房间事件带 `tokens`/`usage`；`getState` 返回的运行带有核心的读取结果（逐次之和 12，CLI 合计 1,302）。
- room 预览 harness 在 1280 和 390 两种宽度下截图，覆盖合计一致、差额提示、kimi 三种情况，已逐一看图核对，截图不提交。
- 没有在真实 CLI 上验证，也没有上 3080 验证。
