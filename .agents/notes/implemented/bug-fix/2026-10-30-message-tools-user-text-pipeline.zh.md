# Agent Note：被接管的用户气泡走官方用户文本管线

Status: implemented

## 问题

message-tools 接管了宿主的 `user` / `steering` 聊天节点，用来加复制、编辑、撤回。它的气泡用本地投影显示文本：会话 @ 引用，加上 `/name`、`@name` 词元。它从不调用宿主的 `conversation.user.text` 工厂，所以注册的用户文本规则在任何会话里都不生效。quote 发出后的卡片就是其中之一：发出的引用在所有地方都显示成 `> …` 原文。宿主不会报错，因为这条管线根本没被调用过。

## 决定

- **气泡文本改为通过 `renderFactorySlot('conversation.user.text', …)` 渲染**，只要宿主声明了这个工厂。facts 与宿主自己的气泡一致：`sessionLabels` 取节点的 `referenceLabels`，`skillNames` 取节点自带的值，`interactive: true`。所有规则都和没被接管时一样生效：技能、文件、会话、目标 chip，以及引用卡片。
- **通过工厂声明的 keyed 子渲染位探测**（`ctx.slots.spec('conversation.user.text.node')`），每次渲染都探测。工厂本身没有 spec，直接探测工厂名永远查不到。
- **兜底**：宿主没有这个工厂时，保持原来的本地投影。

## 考虑过的其他方案

**去掉接管里的文本渲染，只保留操作行。** 否决：接管的是整个节点（折叠、已编辑标记、恢复行），要把文本和外壳拆开，得有宿主提供的缝，而现在没有。

## 影响

- 撤回或编辑后回填到输入框的仍是纯文本。回填的引用在草稿里显示为 `> ` 原文，而不是 chip，但重新发出后又会显示成卡片。
