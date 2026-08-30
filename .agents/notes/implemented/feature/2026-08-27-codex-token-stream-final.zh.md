# Agent Note: codex live token 粒度流式收尾（一条合成最终消息）

Status: implemented

[English](2026-08-27-codex-token-stream-final.md) | 中文

## Problem

token 镜像粒度下，codex live driver 既把 `item/agentMessage/delta` / `item/reasoning/textDelta` 流成 `assistant/chunk` 事件，又在 settle 时把完成的 `agentMessage`/`reasoning` item 折成 `assistant/message` 事件——子会话把答案渲染了两遍（流 + 折叠）。更糟的是：流若始终等不到最终消息，已完成的轮次上仍挂着**已停止**徽标——官方投影按 `(turn, step)` 合并，只有打在流式同一个 `(turn, step)` 上的 append-surface `assistant/message` 才会整块替换流；只有 chunk 没有 final 就被读成已停止。kimi live driver 先修好了同一对症状（见 Cross-references）；codex 需要在它自己的折叠上照做同构修改。

## Decision

codex 折叠层获得与 kimi 镜像相同的 skip 开关，按本包惯例命名为 `CodexMirrorOptions.skipAssistantContent`（`codex-cli-provider.ts`）。开启后 `appendCodexTranscriptLine` 不再折叠 think/text 行（tool 行照常折叠），并返回是否发生了折叠，于是 live driver 的 `mirrorUpTo` 既不把该轮用量挂到折叠行上，也不再补挂事后 usage chunk——用量改由合成最终消息承载。与 kimi 不同（kimi 的文件折叠会计算窗口用量并经 delta 返回），codex 的用量来源是 driver 自己持有的 `thread/tokenUsage/updated` 变量，无需返回：skip 只是让这个变量在 settle 前保持未挂载。

driver（`live-driver.ts`）对照 kimi 的 token 模式机制：

- delta 累积进 `roundThink` / `roundText`，每个流式 chunk 的 seq 记入 `chunkSeqs`。chunk 块布局固定——`reasoning-delta` 在 index 0、`text-delta` 在 index 1——与最终消息的内容序一致（取代原先按 itemId 分配 index 的映射）；chunk 固定打在 `(turn, step: 1)` 而不再是 `mirrored + 1`，流式中途的 tool 折叠不会再挪动流的合并键。
- 折叠的 tool 行排在流式 step 之后（token 模式下 `index + 2`），tool 开头的轮次里 tool 卡片不会与最终消息的 `(turn, step)` 合并键相撞。**2026-08-30 修订**：流式 step 不再固定为 1——固定会把整个回答抬到 tool 开头轮次的所有工具卡之上；现在改为首个 delta 时惰性保留、越过当时已完成的所有项，折叠只在达到保留值时偏移。见[惰性流式 step 笔记](../bug-fix/2026-08-30-live-token-lazy-stream-step.md)。
- settle 链追加**一条**合成 `assistant/message`，打在同一个 `(turn, step: 1)` 上：内容 `[reasoning, text]`（经新的 `codexAssistantEvent` helper——把折叠处内联的 `createAssistantMessage` 调用导出共用）、观察到的 `thread/tokenUsage/updated` 用量、`{ surfaceOp: 'append', sourceEventSeqs: chunkSeqs }`；非 completed 轮带 `interrupted: true`，被中止的轮次合法地读作已停止。
- 内容兜底：delta 是流的内容，但若服务端完成 item 时从未流任何 delta，skip 会把答案弄丢——此时最终消息的内容块改从折叠行推导（think 行拼成 reasoning，text 行拼成 text）。

event 粒度（默认）逐字不变：不 skip，用量仍挂在最后一条折叠的非 tool 行上，也不追加合成最终消息。

## Alternatives considered

- **流式照流、完成的 item 照折，交给 UI 去重**——否决：投影没有跨事件去重，重复正是要修的 bug。
- **只在 turn/completed 时抑制折叠**——否决：item 到达即中途折叠（`mirrorUpTo(lines.length - 1)`），更早的 think 行仍会重复；skip 必须像 kimi 一样挂在每一次镜像传递上。
- **保留按 itemId 的块 index 映射**——否决：最终消息把全部 reasoning 合进块 0、全部 text 合进块 1，按 itemId 编号的流无法与最终消息的内容序对齐；固定布局才让投影的整块替换精确成立。
- **像 kimi 的 `KimiMirrorDelta.usage` 那样把用量经折叠 delta 返回**——否决：codex 的折叠从不计算用量（用量以通知形式到达，driver 本就持有），没有窗口值可返回；settle 时挂到最终消息上是同一个恰好一次契约。

## Consequences

- token 粒度 live 轮的答案只渲染一次：流活在保留的 `(turn, step)`（仅当首个 delta 前没有任何完成项时才为 step 1——见上方 2026-08-30 修订），settle 的单条合成最终消息原位替换它并带上该轮用量；被中止轮次的最终消息带 `interrupted: true`，保留合法的已停止读法。
- exec 路径与 event 粒度保持原折叠不变（options 参数默认关闭；`appendCodexTranscriptLine` 只是新增了调用方可忽略的返回值）。
- kimi 笔记留下的 M2 跟进项（"re-check codex/claude-code settle mirrors"）在 codex 的流式收尾上已答复；codex 没有文件折叠方面的同类问题（它的折叠来自通知而非文件）。

## Testing

- `live-driver.spec.ts` +2，对照 kimi 的两个测试：settle 以一条合成最终消息完成流式（恰好一条 `assistant/message`、`(turn, step 1)`、内容 `[reasoning, text]`、来自 `thread/tokenUsage/updated` 的用量、`sourceEventSeqs` 非空），以及被中止的轮次以 interrupted 完成流式。FakeAppServer 夹具新增脚本化 `reasoningDeltas`。套件：codex 93/93；`pnpm check:plugins` 与 `pnpm check:hygiene` 干净。

## Cross-references

- [kimi live mirror fold fixes](2026-08-27-kimi-live-mirror-fold-fixes.md)——本修改对照的已落地样板（其 Consequences 拥有 token 粒度流式收尾的语义）。
