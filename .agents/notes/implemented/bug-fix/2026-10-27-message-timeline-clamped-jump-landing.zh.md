# Agent Note: message-timeline 在滚动钳制后保留点击落点

Status: implemented

[English](2026-10-27-message-timeline-clamped-jump-landing.md) | 中文

## Problem

时间轴此前在点击时清除悬停/键盘预选，之后完全依赖下一次阅读位置计算。会话已滚到底时，点击最新消息或任何已在可视区内的后续消息，都无法把 `scrollTop` 再增加到足以让目标置顶；浏览器钳制写入后没有形成新的阅读位置，`activeRowKey()` 又返回第一条可见用户消息。Room 里连续出现的「继续」让这看起来像内容或 steering 类型的缺陷，但这些节点其实是普通、可见且 key 唯一的 user 行。

## Decision

成功跳转现在同时产生滚动写入和一份可保留的落点。共享的 `jumpTarget` 助手在写入后返回目标行；tracker 记录其 key、DOM 元素和浏览器钳制后的实际 `scrollTop`，并立即发布该 key，不再等待可能不会发生 scroll 事件。后续更新只在滚动位置不变且目标行仍位于当前 scrollport 内时保留落点；真正滚动、目标行移除、scrollport 挂载/重绑、会话切换和 dispose 都会清除它，恢复不变的 `activeRowKey()` 阅读位置算法。直接行与大纲行共用这条路径，公开 API 形状不变。

## Alternatives considered

**底部一律选中最新一行。** 否决：它只能修最新一条，还会把更早可视行的点击归到错误目标，正好覆盖连续「继续」的场景。

**在 `TimelineRail` 内保存粘性选择。** 否决：第二个选择所有者会复制 tracker 状态，而且仍无法可靠区分钳制跳转与后续阅读移动或 DOM 替换。

**只在 `jumpTo` 后补跑一次现有 update。** 否决：滚动被钳制时它仍会发布第一条可见行；无滚动位移也不会再有事件修正它。

## Consequences

最新消息和可视区中部消息的点击现在都能在滚动底部选中实际目标，普通长回复锚定保持不变。落点不会越过真实阅读移动、目标行移除、重绑或 dispose 而残留。tracker 测试通过真实 tracker 连续点击两条「继续」，验证立即及后续更新中的选中、真实滚动后的释放和移除目标后的清理；全包 142 个测试通过。
