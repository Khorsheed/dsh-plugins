# Agent Note: taskpilot 任务详情抽屉把会话列整体推开

Status: implemented

[English](2026-08-22-taskpilot-drawer-push-layout.md) | 中文

## 问题

任务详情抽屉是固定右侧浮层(`position: fixed`,520px)。打开时会盖住会话区的右缘:聊天消息与聊天框的右侧都压在抽屉下面。测试抽屉的用户要求聊天区和聊天框改为整体左移。

## 决策

抽屉打开时现在会从布局中让出自己的宽度:组件在打开期间给文档打标记(`html[data-taskpilot-drawer-open]`)并设置宽度变量(`--dsh-taskpilot-drawer-w`),一条全局规则把会话列的滚动区域向左推出该宽度(`[data-slot='conversation'] [data-conversation-scroll] { margin-right: … }`)。聊天框席位就渲染在该滚动区域内部,因此聊天与聊天框一起移动。让出的宽度是响应式的:`computeDrawerInset` 只在剩余会话列仍 ≥640px 时返回抽屉宽度(520px,以视口为上限);更窄的视口返回 0,抽屉退回之前的覆盖行为。窗口 resize 时重算,关闭/卸载时移除标记与变量。

该实现沿用了兄弟插件 ui-file-preview 抽屉既有的推开模式(文档标记 + 宽度变量 + 会话滚动区 margin),并补上了兄弟插件没有的窄屏回退。

## 备选方案

- **渲染进产品的 details 列** —— 否决:`details` 槽位是 `single` 且被官方 DetailsPanel 独占;注册进去会替换它,驱动其宽度打开的是官方面板而不是抽屉。
- **给 `#root` / `body` 加 padding** —— 否决:会全局推移整个框架,与产品自身的布局所有权冲突;会话滚动区 margin 是兄弟插件验证过的、局部作用域的推开方式。
- **像 ui-file-preview 一样无条件推开** —— 否决:窄屏下 520px(甚至全宽)的 margin 会把聊天完全推出屏幕;响应式让宽保留了覆盖式回退。

## 后果

- 宽屏下抽屉不再盖住聊天或聊天框的右缘;窄屏保留原有覆盖行为。
- 未改动任何产品文件:标记、变量、推开规则全部归 taskpilot bundle 所有;如果目标选择器将来不再匹配,抽屉只是退回覆盖(变量默认 0px)。
- 当 taskpilot 与 ui-file-preview 抽屉同时打开时,两者都写同一个元素上的 `margin-right`,后加载的样式表生效——这是兄弟插件间既有冲突,非本次引入。
