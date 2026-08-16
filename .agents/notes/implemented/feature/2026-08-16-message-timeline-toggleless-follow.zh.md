# Agent Note: Message timeline drops the header toggle and follows the reading position

Status: implemented

[English](2026-08-16-message-timeline-toggleless-follow.md) | 中文

## Problem

[扁平列表笔记](2026-08-15-message-timeline-flat-list.md)落地后出现两个后续问题。header 开关按钮——圆点轨道时代的遗留——成了一个以"消失"为设计目标的功能里最显眼的元素,而静止态变成环境刻度之后,它的收起动作几乎没用。另外面板只在打开时定位一次:新消息发出后,对应行可能落在滚动窗口之外而无人察觉。

## Decision

header 开关与它的按会话 `open` store 一并移除;面板在会话视图下常开,`enabled` 配置仍是总开关。当前行变化时面板把高亮行滚入视野(`scrollIntoView({ block: 'nearest' })`):跟随阅读位置——发消息对应行保持可见——且不打断鼠标浏览,因为悬停时当前行就是指针下的行、必然可见;键盘预选时保持预选行可见。

## Alternatives considered

**保留开关用于临时隐藏。** 否决:静止态本就近乎不可见,一个常驻 header 图标比它要隐藏的 bar 更占注意力。

**只在 tracker 变化时跟随,预选不跟随。** 否决,属于不必要的复杂化:对已在视野内的行用 `block: 'nearest'` 滚动是无操作,一条无条件规则同时覆盖打开、跟随与键盘导航。

**点高亮行跳回底部。** 产品负责人否决:官方会话视图自带回到底部按钮,一行承担两种点击语义会含糊。

## Consequences

header 工具区的条目不再渲染可见内容——它只负责把插件锚定进会话作用域,UI 全在 portal 里。`createTimelineStore`/`TimelineStoreState`/`TimelineStore` 从公开导出移除,`rail.toggle`/`rail.toggleAria` 两个 locale 键收敛为 `rail.panel`。关掉时间轴靠 cordis.yml 的 `enabled: false`,而不是点按钮。[扁平列表笔记](2026-08-15-message-timeline-flat-list.md)里开关时代的句子指向本篇。
