# Agent Note: 文件列表命名分家——header 工作区胶囊移除，local-files 增加右栏入口

Status: implemented

[English](2026-09-10-files-list-naming-and-sidebar-entry.md) | 中文

## Problem

三条用户反馈汇聚到同一个混淆：我们的文件浏览器自称「工作区 / Workspace」，而官方 0.1.5 的表面已经占用了这个词——会话工作区是官方 sidebar 的「工作区文件」卡片（`dsh-client-ui-sidebar-files`，限工作区范围）和官方工作区切换器。具体地：会话 header 有一个工作区胶囊（文件夹图标 + 目录名，来自 worktrees 徽标的左区），与文件浏览入口重复；我们的 `conversation.view` tab 名叫「工作区」；右栏 guide 的「工作区文件」卡片看似我们的，实际是官方包的，我们既不能也不想改它。

## Decision

命名分家：**「工作区 / workspace」归官方表面；我们的浏览器叫「文件列表 / Files」**——git 无关、随时浏览任何目录。

- **worktrees**：徽标的左（文件夹）胶囊移除——header 只留分支胶囊，非仓库会话现在完全不渲染徽标（胶囊曾是那里唯一的内容）。胶囊是徽标打开本地文件浏览器的唯一入口，但浏览器表面本身（`shell.overlay`，含工作区切换器与原生目录选择器）按明确指示保留挂载，不丢能力。`aria.openLocal` / `local.title` 随之离字典。
- **local-files**：`conversation.view` tab 改名「文件列表 / Files」，并额外注册为右栏 page-type tab（kind `local-files`）：definition 进 `ctx.sidebarRightTabs`，body（同一个 `WorkspaceView`）进 keyed `sidebar.right.pane.tab` 槽。guide 卡片复用官方彩色文件夹图标（`FileTypeIcon kind="folder"`，官方文件卡片同款 glyph），order 40——排在官方文件卡（10）、产物卡（20）、worktrees 卡（30）之后——描述承载语义分家（任何目录，不限工作区）。
- 旧宿主不受影响：sidebar 注册是 pending 于 `sidebarRightTabs` 的嵌套 `ctx.plugin`（ui-file-preview 的 `documentPreviews` 先例——没有该服务的组合永不激活它），因此 minHost 维持 0.1.2-rc.1，0.1.2–0.1.4 宿主上 conversation tab 是唯一入口。

一个类型事实随之浮现：`WorkspaceView` 的 props 不再搭 `PropsRuntime<'conversation.view'>`——该槽位的 owner 份额带有 sidebar 槽位不提供的视图切换 props。runtime 份额改为结构化直写（视图只消费 `sessionId`），两个槽位都适配。

## Alternatives considered

**直接改用户指的那张 guide 卡片。** 不可能也不应该：它属于官方 `ui-sidebar-files`（按设计限工作区）；harness 检出只读，而且改名违背分家——那张卡本来就该叫「工作区文件」。

**保留胶囊只改文案。** 否决：用户的决定是移除——header 只留 worktrees 的分支胶囊，文件浏览入口收敛到 sidebar / 会话 tab。

**随入口一起删 `shell.overlay` 浏览器。** 按指示否决：抽屉保留工作区切换与原生选择器能力，离开的只是 header 挂载点。

**顶层 inject 声明 `sidebarRightTabs`（worktrees / ui-file-preview 的做法）。** 否决：那两个包随 sidebar 把 minHost 前移到 0.1.5；local-files 保持 0.1.2 兼容，注册必须隐形 pending，而不是拖住整个插件。

## Consequences

所有文件浏览入口现在同名（文件列表 / Files）、同两处（会话 tab、sidebar guide）；header 少了一个胶囊，非仓库会话完全不显示徽标——是有意的减法。`shell.overlay` 浏览器处于已挂载但无入口的状态，直到未来某个表面调用 `worktreesPanel.openLocalFiles`——刻意保留，在此记录以免被当成死代码。覆盖：badge 测试钉住非仓库渲染为空；`tests/definition.client.spec.ts` 钉住 tab 类型的身份、页型形状与 guide 条目；中英字典键保持同步。3092 的活体验证（胶囊消失、卡片渲染、两个入口都能打开浏览器）由 owner 收尾——本次改动只做了静态验证与单测。
