# Agent Note: message-timeline 补上 message-tools 编辑/恢复气泡且不动基线

Status: implemented

English | [中文](2026-08-28-message-timeline-edit-keeps-rail.zh.md)

## Problem

活体 bug(message-timeline × message-tools):编辑重发一条用户消息后,时间轴轨道归零并保持。message-tools 的 `editMessage` 替换目标消息**及其后的整个 surface 尾巴**,宿主把被覆盖的节点撤回(离开可见 `order`),并物化一个 `message-tools-edited` 气泡(恢复以 `message-tools-restored` 重放)。轨道原本遍历 `s.chat.order`、过滤 `user`/`steering` kinds,而编辑气泡——宿主可见 `order` 不一定补上、即便它在流里渲染——因此从不上轨道;编辑第一条消息时一行都不剩。

两次更早的方案(先加 kind 谓词、再改为以 `s.chat.nodes.values()` 为主源)均已回滚:两者都让**每个会话**的轨道消失,包括没编辑过的普通会话。回滚后的 main 是可用基线。

## Decision

- **主路径与基线字节一致。** 轨道仍遍历 `s.chat.order`、过滤 `user`/`steering` kinds,产出与之前普通会话完全相同的行。加这个修复绝不改变基线——普通(未编辑)会话没有 message-tools 节点,什么都不变。
- **message-tools 气泡是追加,不是替换。** 在 order 循环之后,轨道遍历 `s.chat.nodes.values()`,把 order 漏掉、且未显式 `visibility:'hidden'` 的 `message-tools-edited` / `message-tools-restored` 追加进去(按 key 去重,order 已给出的不重复)。这样宿主 order 丢掉的编辑气泡被补上,编辑不再清空轨道。
- **追加逻辑降级而不爆炸。** 包在 try/catch 里:store 读取失败只丢追加的气泡,order 派生的行照常渲染——普通会话绝不因 store 异常断掉。

## Verification

回归测试:普通会话恰好渲染它的 order 行(基线守卫);宿主 order 漏掉编辑气泡时(编辑第一条、order 空、store 里有编辑气泡)它仍出现;编辑中间消息时保留编辑前的行并追加编辑气泡;`values()` 抛错的 store 仍渲染 order 行(`tests/TimelineRail.client.spec.tsx`)。包内 87 个测试全绿;`pnpm build` 通过。

## Alternatives considered

**只改 kind 谓词(已回滚)。** `isTimelineRowKind` 接受编辑 kinds 没用——宿主 `order` 漏掉该气泡时,轨道遍历的是 `order`,根本到不了它;而且部署后连带每个会话的轨道都消失。

**以 `s.chat.nodes.values()` 为主源(已回滚)。** 替换宿主的 order 投影,改变了普通会话的渲染,作为回归被回滚。

**给被撤回的原消息留灰显幽灵**——用户提过这个方向,方便定位"我刚才改的是哪条"。否决:原消息已隐藏(不在 surface、无跳转目标),message-tools 分割线已承载历史,编辑气泡已满足定位需求。

## Consequences

原地编辑不再清空轨道;编辑气泡(以及恢复重放)出现在列表里、显示内容预览且可跳转。普通会话逐字节不变。被撤回的原消息按设计留在轨道之外(分割线承载历史)。阅读位置解析器仍只把 `user`/`steering` 行当锚点,所以亮起的标记不会特别指向编辑气泡——这是刻意收窄范围,保持改动最小且基线安全。
