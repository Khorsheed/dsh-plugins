# Agent Note: claude-code live token 粒度流式收尾

Status: implemented

[English](2026-08-27-claude-token-stream-final.md) | 中文

## Problem

token 粒度下，claude-code live driver 把 `--include-partial-messages` 的增量流成 `assistant/chunk`，但 settle 时仍把同样的 think/text 行折叠成独立的 `assistant/message` 事件——官方投影于是把内容渲染两遍（流 + 折叠），而且 chunk 未走完的流即使干净完成也挂着「已停止」徽标。kimi live driver 已经解决了完全相同的一对缺陷（见交叉引用）；claude-code 需要在它自己的折叠（live driver 内共享的 `ClaudeStreamParser` 路径）上做同构修复。

## Decision

claude-code live driver 的 token 粒度现在照 kimi 样板（commit 13f0c62）实现，并按 claude 折叠的形态适配：

- **折叠层 skip，契约同 kimi 的 `skipAssistantContent`。** `mirrorUpTo`（live 折叠循环）新增 token 模式跳过：think/text 行不再折叠成 `assistant/message` 事件（工具行照常折叠为原生 `tool/call`/`tool/result` 对），本轮 usage 改挂到 driver 的 `settleUsage` 而不再挂到被折叠的载体行——包括载体行已被提前镜像的情形，同样改写 `settleUsage` 而不是补一条 usage `assistant/chunk`。
- **usage 来源：result 事件，走折叠自身的计算。** live driver 此前拦截 `result` 事件、从不喂给 parser，所以这条路径上 `parser.usage` 恒为 undefined。token 粒度现在把 result 事件本身推进折叠（`usageFromClaude`，既有计算）；event 粒度保持历史 flush 逐字不变。
- **流式块布局与最终消息一致。** chunk 打在 `(turn, step 1)`，`reasoning-delta` 块 index 0、`text-delta` 块 index 1（claude 流的 `thinking_delta`/`text_delta` 词汇），同时累积 `roundThink`/`roundText` 与 chunk seq。token 模式下折叠的工具行 step 偏移为 `index + 2`，使投影的 `(turn, step)` 合并键永远不与流式的 step 1 相撞。
- **settle 用一条合成最终消息完成流。** result 事件 flush 之后，settle 链在流式的同一个 `(turn, step 1)` 上追加**一条**合成 `assistant/message`——内容 `[reasoning, text]`、折叠算出的 usage、`{ surfaceOp: 'append', sourceEventSeqs: chunkSeqs }`、非 completed 轮带 `interrupted: true`。官方投影用它整块替换流：内容不重复、悬挂的「已停止」徽标消失，被取消的轮名正言顺显示「已停止」。
- **归因助手。** `assistantEvent(blocks)`（从 `claude-cli-provider.ts` 导出，kimi 同名助手）是 `claude-local` 消息归因的唯一来源，行折叠与合成最终消息共用。

## Alternatives considered

- **无条件折叠 result 事件（event 粒度也折）**——否决：那样能顺带修掉 event 模式的静默 usage 缺口，但本任务的红线是 token 粒度收尾、event 粒度逐字不变；event 模式的 usage 问题是另一个独立决策。
- **导出 `usageFromClaude` 在 driver 里直接算 usage**——否决：把 result 事件推进折叠是逐字复用既有计算，不会与 exec 路径漂移。
- **按子会话事件推算折叠 step（kimi 折叠的做法）**——否决：claude 的折叠按位置编号（`index + 1`）；token 模式 `+1` 偏移用一处小改为流式保留 step 1，且每个 transcript 行在多次 flush 间保持稳定。

## Consequences

- token 粒度不再重复渲染：折叠跳过 think/text，流式 chunk 承担实时视图，settle 时恰好一条最终 `assistant/message` 带着本轮 usage 替换流。
- 干净完成的轮不再挂虚假的「已停止」徽标；被中止的轮的合成消息带 `interrupted: true`，徽标所言属实。
- event（默认）粒度完全不变：无 chunk 事件、同样的折叠、同样的（无 usage 的）settle flush。
- event 模式既有 usage 缺口（live 路径从不折叠 `result`，因此从不挂 usage）就此记录在案；token 模式不受影响。

## Testing

- `tests/live-driver.spec.ts` +2，照 kimi 的两个测试、基于扩展后的 `FakeClaude` 夹具（thinking delta）：settle 用一条合成最终消息完成流（内容 `[reasoning, text]`、usage、无 `interrupted`、`sourceEventSeqs` 非空、工具活动照常折叠）；被取消的轮以 `interrupted: true` 完成流。套件：claude-code 86/86；build、`check:plugins`、`check:hygiene` 全绿。

## Cross-references

- [kimi live 镜像折叠修复](2026-08-27-kimi-live-mirror-fold-fixes.md)——本 note 照做的已落地样板，含官方投影语义（合并键 `(turn, step)`；append-surface 最终消息整块替换流）。
