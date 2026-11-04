# Agent Note: 每次 `/compact` 执行的压缩事实由核心负责

Status: implemented

## Problem

批 5（统一执行入口，设计稿 `proposals/active/2026-11-03-unified-execution-entry.md`，不在仓库里）的写入端事实③④要求：压缩调用的用量只在 `local-agent/compaction` 上；压缩前后的上下文大小单独存放，永远不当用量读；来源报不了的东西在写入时标出。本步之前还剩两个缺口：

- Claude Code 和 DSH 成员执行 `/compact` 时不写 `local-agent/compaction`。room 靠猜：一次压缩执行完成了、区间里却没有压缩事件，就标 `unreported`（`recordCompaction`，见批 4 笔记 `2026-11-02-room-local-agent-lens-contracts`）。这是 room 替 local-agent 下结论。
- Codex 自己触发的自动压缩（live 里的 `contextCompaction` 条目）写入时没有 `usage`，也没有任何字段说明用量是零、丢了，还是根本没报。

S2 把这两处都补上。

## Decision

- **`LocalAgentCompactionEvent.unrecorded`**（新增，可选，只加不改）：`Array<'usage' | 'before-after' | 'summary'>`（`LocalAgentCompactionUnrecorded`），列出来源不报告的项，在写入时标出。没有这个字段，表示来源报了它有的全部字段。`beforeTokens`/`afterTokens` 的类型注释写明了它们是上下文大小，不是用量。事件类型早已登记，登记处不用改。
- **核心兜底写事实**（`OpenExecution.writeCompactionFact`，`packages/local-agent/src/execution-records.ts`）：`compact` 执行结束时，核心检查准入水位之后的子日志。provider 没写 `local-agent/compaction` 的，核心在写执行 end 记录之前补一条，所以它落在本执行的区间里：

  ```ts
  { source: 'manual', outcome, provider, startedAt: <admittedAt>, endedAt, boundarySeq: <最后 seq>,
    unrecorded: ['usage', 'before-after', 'summary'] }
  ```

  `outcome` 由执行结果映射：`done` → `completed`，`failed` → `failed`，`cancelled` → `cancelled`。`uncertain` 不写，因为什么都不知道。`provider` 取成员绑定的委派 provider，经新增的可选字段 `ExecutionAdmission.provider` 传入。自己会写事实的 provider（Kimi live、Codex 手动）保持原样；有水位判断，一次执行不会出现两条。准入之前写下的压缩（比如更早的一次自动压缩）不算本执行的。
- **Codex 自动压缩**（`recordRoundContext`，`packages/local-agent-codex/src/live-driver.ts`）现在写 `unrecorded: ['usage']`。它在本轮结算期间、结果返回之前写入，所以落在这一轮的执行区间里。codex 报了 `beforeTokens` 的照常保留；它从不给摘要，也不给压缩后的大小。设计稿对这种情况只标 `usage`，这里就只标这一项。
- **room 读事实上的标记**（`recordCompaction` 与导出的 `compactionUnreported`，`packages/room/src/dispatch.ts`）：仍按本次 run 的区间读事实（批 4 起就是这样）。事实同时把 `before-after` 和 `usage` 标为不记录时，这一行记为 `unreported`；区间里没有事件不再导致 `unreported`。文案不变：「{member} 已执行压缩命令 · 该成员不报告压缩数据」/ "{member} ran /compact · this member does not report compaction data"；投递结果仍用 `COMPACT_UNREPORTED_TEXT`。带数字的事实照旧抄写。
- **room 仍然存的东西**：`room/member-compacted` 仍从事实抄 `beforeTokens`/`afterTokens`/`contextWindow`/`usage`/`summary`，并按事实的标记写 `unreported: true`。设计稿把「room 不再存数、改读 `readExecution`」放在 S6（迁移表 S6 行、事实③「room 不再存数」），S2 不动这份副本。`unreported` 字段保留，因为 room 客户端（`RoomCompactionView`）读它；S2 起它是核心标记的副本，不再是推断。

## Alternatives considered

- **`unrecorded: true`（布尔值）**：设计稿有一处写成 `{ outcome, unrecorded: true }`，但同一句话里把字段定义成了数组。这里采用数组，因为 Codex 自动压缩需要只标一部分。
- **每家 provider 自己写「不报告」事实**（claude-code、dsh）：不采用。这样事实会分散在两处写，第三方 provider 忽略 `operation` 时仍然有缺口。只有核心确切知道一次执行是压缩。
- **没有事实时 room 保留推断作兜底**：按设计稿「用户决定 1」（旧数据不做推断）不采用。新 room 配上 S2 之前的核心时，显示一行没有数字的「已压缩」。

## Consequences

- **用户可见：**
  - Claude Code 和 DSH 成员执行 `/compact` 后，成员自己的 Context Lens 会看到一条没有数字的 `local-agent/compaction`。lens 源码没改（显示 `unrecorded` 要等 S8），所以它的样子和现在 Codex 那种没有数字的压缩一样。
  - 占用圆环（`memberContextOf`）把没有压缩后大小的已完成压缩当作「占用未知，等下一次上报」，Codex 现在就是这样。所以这两类成员 `/compact` 后圆环会重置。这是对的：CLI 确实压缩了。
  - room 行的文案不变。
- **版本混用：** 新 room 配旧 local-agent 核心时，Claude/DSH 的 `/compact` 显示没有数字的「已压缩上下文」：没有事实写入，room 也不再猜。
- **部署：** local-agent 与 room 应一起上线。新字段是可选的，旧读者会忽略。

## Testing

- `packages/local-agent/tests/execution-records.spec.ts`：原有的压缩用例新增断言：provider 自己写的事实是唯一一条，且不带标记。新增用例：provider 什么都不写的压缩执行，核心写一条事实，带三项标记，`startedAt` 为准入时间，没有数字，位置在 start 与 end 之间，区间外更早的压缩被忽略。新增用例：失败的压缩得到一条 `failed` 事实。recorder 用例：cancelled 写一条，uncertain 不写，prompt 执行不写。每份落盘日志都通过 `assertReleasedV4Relationships`。
- `packages/local-agent-codex/tests/live-driver.spec.ts`：自动压缩用例断言 `unrecorded: ['usage']`、没有 `usage`，且事实在本轮结果返回之前写入。
- `packages/room/tests/dispatch.host.spec.ts`：「不报告」用例改为喂核心写的 unrecorded 事实。新增用例：区间里没有事实的 run 不标 `unreported`。单元用例覆盖 `compactionUnreported`（只有 `['usage']` 不算不报告）。
- `packages/room/tests/lens-contract.host.spec.ts`：用例 6 对同一成员再发一次 `/compact`，这次的事实是核心写的 unrecorded 那条（行上带 `unreported: true`）。不新增成员：新成员的轮次会改变 lens 的轮次断言，那归 S8。夹具用 `UPDATE_ROOM_CONTRACT=1` 重新生成，context-lens 的源码和测试都不改，依然全绿（311 个）。
- 未在真实 CLI 或 3080 上验证。
