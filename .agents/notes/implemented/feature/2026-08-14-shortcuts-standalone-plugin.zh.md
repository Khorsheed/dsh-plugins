# Agent Note：独立 web 快捷键插件（固定动作、用户自选键位）

Status: implemented

[English](2026-08-14-shortcuts-standalone-plugin.md) | 中文

## Problem

Composer 没有常规的停止与优先发送按键：停止运行中的回合需要用指针点击，而插队发送当前草稿需要了解 Cmd/Ctrl+Enter 的约定。产品想要两个可发现的快捷键——暂停任务键与插队发送草稿键——并且是**可安装、可卸载的插件**而不是写死在 composer 里的功能，同时采用标准快捷键交互：操作固定，键位由用户自选（可重绑、可恢复默认、可解绑）。先前的 composer 内实现（已被取代的 `2026-08-14-composer-keyboard-shortcuts` 笔记）验证了语义，但把功能焊死进了 ui-conversation；本决策取代它。

## Decision

**独立的客户端插件包 `@deepseek-ai/dsh-client-ui-shortcuts` 拥有该功能，核心零改动。** 两个固定动作——暂停当前任务与插队发送草稿——绑定到持久化、用户可重绑的键位。默认：`Esc` 暂停，`Ctrl/Cmd+S` 插队发送（`Ctrl` 与 `Cmd` 合并为一个 `primary` 修饰键，沿用 composer 的 Ctrl/Cmd 组合键惯例）。键位在 General Settings 中录制（点击录制，`Esc` 取消，`Delete`/`Backspace` 解绑，恢复默认），并通过 Host-backed 的 `ui-shortcuts` 设置小节持久化，沿用 `busyEnter` 的持久化模式。

**插件不在默认 web bundle 中。** 它作为可安装包发布；profile 加一行 Loader entry（`- id: ui-shortcuts / name: '@deepseek-ai/dsh-client-ui-shortcuts'`）即可安装，移除或禁用该行即卸载。该行的 node 半边注册设置小节；浏览器半边负责按键接线与设置行。

**动作只使用公开服务。** 插队发送调用公开的 `conversation.input.for(scope).submit('steer')` 接口；暂停调用 scope 寻址的公开 `conversation.cancel()`（即 Stop 按钮的动作）。插件从不触及 ui-conversation 内部——先前实现用到的 `ComposerBarInjected` 各面保持包内私有。先前实现被完全回退（InputBar 分支、`escPause`/`ctrlSSend` 设置字段、composer 内设置行、文案、测试、golden），ui-conversation 保持不动。

**Escape 依赖 composer 现有分层，并作为已记录契约。** 只有当事件目标是 composer 文本框、且 composer 没有先消费该按键（打开的斜杠菜单会对被消费的 Escape `preventDefault`）时才处理。模态框、菜单、popupSelect 因为焦点在文本框之外，各自保留自己的 Escape 行为。IME 组合输入与按住重复的按键不会触发任一动作。

## Alternatives considered

**把功能留在 composer 内（被取代的做法）。** 最初因其完美的分层可达性而选择：composer 的内部仲裁与提交接口让第一版实现简单且正确。作为最终形态被否决，因为产品要求可安装、可卸载的插件——写进 ui-conversation 的功能无法按 profile 移除——而且 composer 不应拥有可选的外围行为。分层需求并不需要焊死：composer 现有的 `defaultPrevented` 契约可从 document 监听器观察。

**在 document 层做全局 Escape，配合共享弹层注册表。** 已否决：不存在共享的弹层消费方注册表，而为了在任何位置都能用 Escape 暂停去建一个，是超出产品要求的大架构改动。composer 作用域门控（目标 = composer 文本框）让每个现有 Escape 消费方都保持权威，且无需新增管道。

**把插件放进默认 web bundle。** 已否决：产品决定由社区安装；默认 bundle 保持不变，设置弹层 golden 也无需改动。

## Consequences

启用插件的用户获得两个可发现、可重绑的快捷键，且核心代码零改动；未启用者得到与功能前完全一致的行为。`ui-shortcuts` 设置小节独立于 `ui-conversation` 持久化。插件的 Escape 刻意限定在 composer 作用域（已知局限，已写入其 README）；因其不在默认 bundle 中，按键接线由针对 fakes 的 apply 级浏览器 spec 覆盖，而非 `apps/web` e2e。被取代的 composer 内笔记的 rationale 在此保留：其备选方案（独立插件、全局捕获、硬编码行为）与它所确立的 composer 分层约束，正是本插件如此成形的理由。
