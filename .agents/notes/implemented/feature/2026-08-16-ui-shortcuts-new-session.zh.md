# Agent Note：新会话快捷键（Ctrl/Cmd+O），走公开 workspaces 服务

Status: implemented

[English](2026-08-16-ui-shortcuts-new-session.md) | 中文

## 问题

快捷键插件发布时只有两个固定动作（暂停、插队发送）；新建会话作为聊天应用里最高频的手势之一却没有键盘入口。键位选择受浏览器约束：Ctrl/Cmd+N（新窗口）、Ctrl/Cmd+Shift+N（隐身）以及标签管理系组合键都是浏览器保留键，页面永远无法拦截。

## 决策

新增第三个固定动作 `newSession`，默认 `Ctrl/Cmd+O`，调用公开的 `workspaces.startSession()`——与侧边栏"新会话"按钮同一个入口（`WorkspaceRuntime.startSession` 解析目标 workspace → 复用空白会话或新建 → 打开；无 workspace 时进入新会话空视图）。按键走插队发送同款的 capture 阶段全局监听（不走 composer 门控的 Escape 路径——新建会话是全局手势），并 `preventDefault` 掉浏览器的打开文件对话框。`workspaces` 加入插件的 `inject` 列表。Ctrl/Cmd+Shift+O 保留给未来的"新会话+分屏"动作（ChatGPT 的 new-chat 键族）。

## 考虑过的备选

**Ctrl/Cmd+N。** 否决：浏览器保留键（新窗口），不可拦截——页面根本收不到这个 keydown。

**Ctrl/Cmd+Shift+O 作为默认。** 被产品负责人否决：无 Shift 的组合给日常高频动作；带 Shift 的变体留给分屏视图落地后的"新会话+分屏"重操作。

**像 Escape 暂停一样限定 composer。** 否决：`primary` 组合键不与文本输入冲突，且该动作必须在侧边栏、会话列表等焦点下同样生效。

## 影响

持久化的 `ui-shortcuts` 设置小节新增 `newSession` 字段，由 schema 填充默认值；不含该字段的存量小节在读取时采用默认值。设置行渲染第三个字段；`ShortcutBindingsPolicy` 携带第三个 store。`apply.client.spec.tsx` 的 bench 用 spy 覆盖 root 提供的真实 `workspaces` 服务的 `startSession`（重复 provide 会 fail loud）。本记录同时覆盖另一 agent 留下的未提交半成品接线（settings/policy/locales/行接口已改、`index.ts` 未接通）的补全，以及该包此前缺失的自挂载 `cordis.patch.yml`（`name` 加引号——`@` 是 YAML 保留字符）。
