# Agent Note: message-timeline 编辑/恢复气泡保留在轨道上,原地编辑不再清空轨道

Status: implemented

English | [中文](2026-08-28-message-timeline-edit-keeps-rail.zh.md)

## Problem

活体 bug(message-timeline × message-tools,早于 0.1.2 适配分支):编辑重发一条用户消息后,时间轴轨道变空。message-tools 的 `editMessage` 替换目标消息**及其后的整个 surface 尾巴**(`slots.ts`:"replace it (and the surface tail)"),宿主把被覆盖的节点全部隐藏(visibility → hidden,离开 chat `order`),并在替换 seq 处物化一个 `message-tools-edited` 气泡;撤回后恢复的重放则以 `message-tools-restored` 落地。轨道原来只按可见 order 过滤 `kind === 'user'`(外加 steering),编辑气泡被过滤拒掉,被撤回的原消息又已不在 order——编辑第一条消息时整条轨道就空了。

## Decision

- 共享谓词 `isTimelineRowKind(kind, includeSteering)`(`slots.ts`)统一驱动行过滤(`TimelineRail.tsx`)与阅读位置解析(`rail-tracker.ts` 的 `activeRowKey`):凡是会话里可见的用户消息气泡都占一行——`user`、steering、`message-tools-edited`、`message-tools-restored`。编辑气泡的预览显示编辑后的文本(其 `data.content`),点击跳到编辑气泡。
- **行来自节点 store,而非 `s.chat.order`。** 活体复现(干净浏览器、3 条用户消息会话、编辑第一条)显示轨道归零并保持——宿主可见 `order` 里没有 `message-tools-edited` 气泡(其键形如 `20:message-tools-edited312`,kind 与 seq 连在一段)即便流里渲染了它。轨道现在直接读 `s.chat.nodes.values()`,过滤 `visibility === 'visible'` 加 {@link isTimelineRowKind},按 `anchorSeq` 排序(与宿主一致)——不管宿主的 order 投影如何,轨道始终跟会话流对齐。`order` 订阅已移除。
- **不给被撤回的原消息留灰显幽灵。** 被撤回消息在 store 里带 `visibility:'hidden'`,可见性过滤会把它们滤掉;会话里的 message-tools 撤回分割线已经拥有这段历史(展开/恢复/重新编辑)。幽灵刻度会跳到不存在的位置、只会弄乱轨道;"我刚才改的是哪条"由编辑气泡本身回答。
- `includeSteering` 无法作用于编辑 kind——`EditedMessageData` 不记录来源 kind——所以编辑/恢复行恒计入。

## Verification

回归测试:轨道渲染 `message-tools-edited` + `message-tools-restored` 行并显示内容预览,且当编辑气泡是剩余唯一用户行(编辑第一条消息)时轨道不空(`tests/TimelineRail.client.spec.tsx`);`activeRowKey` 能锚定到编辑/恢复行(`tests/rail-tracker.client.spec.ts`)。包内 86 个测试全绿;`pnpm build` 通过。经 deploy:3080 上线并活体验证。

## Alternatives considered

**给被撤回的原消息留灰显占位**——用户提过这个方向,方便定位"我刚才改的是哪条"。否决:原消息已不在 surface 上(没有跳转目标),会话里的分割线已承载历史,编辑气泡已满足定位需求。

**过滤保持原样、只在空时不再隐藏面板**——轨道仍然缺编辑消息那一行;空轨是缺行的症状,不是可见性问题。

## Consequences

原地编辑不再清空轨道;编辑后的消息保留在列表里(显示新文本)且可跳转。轨道继续只反映会话中可见的用户消息——撤回历史按设计留在轨道之外。
