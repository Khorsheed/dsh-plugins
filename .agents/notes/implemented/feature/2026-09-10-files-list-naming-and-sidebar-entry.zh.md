# Agent Note: 文件列表命名分家——header 工作区胶囊移除，local-files 接管右栏文件卡片

Status: implemented

[English](2026-09-10-files-list-naming-and-sidebar-entry.md) | 中文

## Problem

三条用户反馈汇聚到同一个混淆：我们的文件浏览器自称「工作区 / Workspace」，而官方 0.1.5 的表面已经占用了这个词——会话工作区是官方 sidebar 的「工作区文件」卡片（`dsh-client-ui-sidebar-files`，限工作区范围）和官方工作区切换器。具体地：会话 header 有一个工作区胶囊（文件夹图标 + 目录名，来自 worktrees 徽标的左区），与文件浏览入口重复；我们的 `conversation.view` tab 名叫「工作区」；右栏 guide 的「工作区文件」卡片看似我们的，实际是官方包的，我们既不能也不想改它。

## Decision

命名分家：**「工作区 / workspace」归官方表面；我们的浏览器叫「文件列表 / Files」**——git 无关、随时浏览任何目录。

- **worktrees**：徽标的左（文件夹）胶囊移除——header 只留分支胶囊，非仓库会话现在完全不渲染徽标（胶囊曾是那里唯一的内容）。胶囊是徽标打开本地文件浏览器的唯一入口，但浏览器表面本身（`shell.overlay`，含工作区切换器与原生目录选择器）按明确指示保留挂载，不丢能力。`aria.openLocal` / `local.title` 随之离字典。
- **local-files**：`conversation.view` tab 改名「文件列表 / Files」，并额外注册为右栏 page-type tab。kind 直接沿用官方文件类型的 `files`：ui-sidebar-right 的注册表允许每个 builtin kind 带一个 extension 注册并让 extension 生效——地址认领、`get`、guide 页与 body/title 槽位查找都跟随在force的 definition，被遮蔽的 builtin 在 extension 注销时自动恢复（已在 tab-registry.ts 核实；这不是 agent-32 在 utilities list 槽踩过的同 id 双份渲染——id 保持唯一，kind 才是设计好的接管通道）。因此 guide 页只有一张文件卡片——我们的（官方彩色文件夹 glyph，order 40），官方「工作区文件」卡片在我们安装期间消失。默认根目录 = 本会话工作区，从会话行的 `cwd` 响应式读取（`useSessions`，与官方文件树同一读法），会话行晚到时补入；手动切换的目录按会话记忆（localStorage `dsh-local-files-root:<sessionId>`），重开 tab / 重载页面恢复；工具行的「返回本工作区」一键回到当前会话工作区根，已在工作区时隐藏。
- 旧宿主不受影响：sidebar 注册是 pending 于 `sidebarRightTabs` 的嵌套 `ctx.plugin`（ui-file-preview 的 `documentPreviews` 先例——没有该服务的组合永不激活它），因此 minHost 维持 0.1.2-rc.1，0.1.2–0.1.4 宿主上 conversation tab 是唯一入口。

根目录记忆维持**按会话**而非全局：两个槽位都是会话级表面，全局记忆会让会话 B 一打开就落在会话 A 最后浏览的目录——恰好违背「默认落工作区」存在的意义。按会话记忆同样满足「重开恢复上次」，而「返回本工作区」永远指当前会话的工作区。

一个类型事实随之浮现：`WorkspaceView` 的 props 不再搭 `PropsRuntime<'conversation.view'>`——该槽位的 owner 份额带有 sidebar 槽位不提供的视图切换 props。runtime 份额改为结构化直写（`sessionId` 加上带来 `useSessions` 的 `GlobalStandardProps` 席位），两个槽位都适配。

## Alternatives considered

**直接改用户指的那张 guide 卡片。** 不可能也不应该：它属于官方 `ui-sidebar-files`（按设计限工作区）；harness 检出只读。追问「能否遮蔽」在注册表源码里自有答案：kind 级 extension 压 builtin 是设计好的接管通道、卸载即恢复，所以我们安装期间 guide 只有一张文件卡片。

**另立 kind（`local-files`）与官方卡片并存。** 遮蔽机制确认后否决：用户要 guide 里只有一张文件卡片，而我们的浏览器（默认落工作区 + 任意目录）功能上是官方卡片的严格超集。

**全局根目录记忆（纯粹的「记住上次」）。** 否决：表面是会话级的，全局根会把所有会话拖进上一个活动会话浏览的目录——默认落工作区正因为每个会话各有工作区。按会话记忆既保住「记住我的选择」又没有跨会话惊吓。

**已在工作区时把「返回本工作区」置灰。** 否决，选隐藏：动作行本来就有条件渲染 open-in-app 手势，隐藏是本地一致的语法。

**保留胶囊只改文案。** 否决：用户的决定是移除——header 只留 worktrees 的分支胶囊，文件浏览入口收敛到 sidebar / 会话 tab。

**随入口一起删 `shell.overlay` 浏览器。** 按指示否决：抽屉保留工作区切换与原生选择器能力，离开的只是 header 挂载点。

**顶层 inject 声明 `sidebarRightTabs`（worktrees / ui-file-preview 的做法）。** 否决：那两个包随 sidebar 把 minHost 前移到 0.1.5；local-files 保持 0.1.2 兼容，注册必须隐形 pending，而不是拖住整个插件。

## Consequences

所有文件浏览入口现在同名（文件列表 / Files）、同两处（会话 tab、sidebar guide——一张卡片，官方工作区卡片被遮蔽）；header 少了一个胶囊，非仓库会话完全不显示徽标——是有意的减法。`shell.overlay` 浏览器处于已挂载但无入口的状态，直到未来某个表面调用 `worktreesPanel.openLocalFiles`——刻意保留，在此记录以免被当成死代码。覆盖：badge 测试钉住非仓库渲染为空；`tests/definition.client.spec.ts` 钉住 tab 类型身份、页型、`files` kind 接管与 guide 条目；`tests/workspace-view.client.spec.tsx` 钉住根目录默认逻辑（工作区 cwd、记忆优先、会话行晚到补入、手动选择不被覆盖）与「返回本工作区」按钮的显隐和点击；中英字典键保持同步。3092 的活体验证（胶囊消失、单张文件卡、默认落工作区、返回按钮）由 owner 收尾——本次改动只做了静态验证与单测。
