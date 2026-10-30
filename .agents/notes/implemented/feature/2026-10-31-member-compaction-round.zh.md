# Agent Note：CLI 成员的上下文压缩作为独立的一轮运行

Status: implemented

## 问题

外部 CLI 成员会自己压缩上下文，但 local-agent 家族既没有办法主动让它们压缩，也没有在压缩发生时留下任何记录；而且 Kimi 压缩本身的用量会被算进下一轮。2026-10-30 的实测（Kimi 2.1.1 走 ACP、Codex 0.163 走 app-server）确认了两者的形态：

- **Kimi。** 把 `/compact` 当普通消息发送，会立刻返回，然后在后台压缩。压缩期间再发消息，会被**静默丢弃**（返回 `end_turn`，什么也不记）。wire 里依次写下：`full_compaction.begin` → `llm.request kind:compaction` → `usage.record usageScope:session` → `context.apply_compaction {summary}` → `token_counting.rebased` → `full_compaction.complete`。
- **Codex。** `thread/compact/start` 单独作为一轮运行（一个 `contextCompaction` 条目）。这期间的 `turn/start` 会被拒绝，报错 `ActiveTurnNotSteerable { turn_kind: Compact }`。

用户的决定记在本地交互稿 `proposals/prototypes/member-compaction.html`（2026-10-31）。

## 决定

- **压缩就是一轮带 `operation: 'compact'` 的续接。**
  - 这个字段放在续接意图和 `DelegationCallOptions` 上。
  - `LocalAgentRegistry.compact(parent, provider, child)` 就是带这个操作的一次续接。
  - 它占用成员的先进先出队列（`MemberControls.run`）：正在跑的一轮先做完，压缩期间发来的消息排在它后面，直到压缩结束。等 CLI 自己报告结束、而不是等它对 `/compact` 的回应，正是为了 Kimi。
- **Kimi**（`compactLocked`）：
  - 在常驻会话上发送 `/compact`；
  - 从压缩前的行数开始轮询 wire，直到 `readKimiCompaction` 读到结束（`kimi-compaction.ts`）；
  - 取出摘要、这次压缩自己的用量，以及压缩前后的 token 数。
- **Codex**（`compactLocked`）：
  - 调用 `thread/compact/start`，然后一直等到这一轮的 `turn/completed`；
  - 取这一轮的 `tokenUsage.last` 和 `modelContextWindow`；
  - 运行时现在会记住线程的 `contextTokens` / `contextWindow`，每一轮的 `thread/tokenUsage/updated` 都会更新。
- **压缩这一轮写下的内容**：不写任何轮次，只写一条 `local-agent/compaction` 事件（`LocalAgentCompactionEvent`），包含 `source`、`outcome`、`provider`、`model`、压缩前后的 token 数、`contextWindow`、`usage`、`summary`、`error`、`startedAt`、`endedAt`、`boundarySeq`。这个类型和 `local-agent/stream` 一样，登记在宿主的已知事件目录里。有意不复用宿主的 `compaction/*` 事件，因为那会触发宿主替换历史，不能用在镜像来的 CLI 日志上。
- **Kimi 的 transcript 解析器会跳过 `usageScope: 'session'` 的记录**，所以压缩的用量（无论手动还是 CLI 自己触发）都不会算到任何一轮头上。
- **exec 兜底路径拒绝压缩**：一次性的进程撑不到后台压缩结束，没法一直占住队列。

## 考虑过的其他方案

- **在轮次链之外另写一条压缩路径。** 要重复写进程启动、会话加载和排队，还会绕开先进先出队列，而「排队到压缩结束」正是靠这个队列免费得到的。
- **往子会话日志里写宿主的 `compaction/*` 事件。** 这些事件会驱动宿主替换历史，用在镜像日志上是错的。

## 影响

现在可以压缩成员，压缩期间的消息也能正确等待；压缩事件为界面和 Context Lens 提供了所需信息。目前还没有任何入口调用 `compact()`：接下来要做 `/compact` 命令、占用圆环、压缩提醒插件的提醒，以及识别 CLI 自己触发的压缩。给 Context Lens 的需求已经在本地起草（`proposals/active/2026-10-31-context-lens-member-compaction.md`）。

## 测试

- `local-agent-kimi`（304）：
  - `kimi-compaction.spec` 覆盖已完成、未完成、失败、取消、自动这几种压缩，以及读取最新的 token 数；
  - 一个 `session-view` 测试确认压缩的会话级用量不计入轮次；
  - 一个实时驱动测试确认：`.complete` 在回应之后 700 毫秒才写入，这一轮一直占住到那时；不写轮次；事件带有摘要、用量和压缩前后的 token 数。
- `local-agent-codex`（265）：一个实时驱动测试确认：发送 `thread/compact/start`，在压缩那一轮期间一直不结束，不写轮次，事件带有这一轮的用量和 `modelContextWindow`。
- `local-agent`（428）保持全绿。
