# Agent Note: worktrees 改动视图迁为右栏 tab；徽标留在 utilities

Status: implemented

## Problem

宿主 0.1.5 适配计划（[proposals/active/2026-09-10-host-015-adaptation.md](../../../proposals/active/2026-09-10-host-015-adaptation.md) 第三批）给 worktrees 布置了两个入口迁移：徽标迁往新增的 `conversation.session.header.corner` 槽，diff/commit 抽屉迁为右栏 tab 类型。对 0.1.5-rc.1 源码的核实表明第一步不可行；第二步落地，并且同事务重接了 external-open 手势——0.1.2 线上它被迫永久隐藏（`canOpenPath` host-description 字段变成了 loopback 闸门无法确认的 RPC 探测）。

## Decision

- **徽标留在 `conversation.session.header.utilities`。** corner 槽是 `kind: 'single'`，且出厂 web 组合（packages/bundle/web-app/cordis.patch.yml）挂载的 ui-sidebar-right 已用 ExpandButton 以默认优先级占用。single 槽冲突语义（packages/client/ui-slots/src/index.ts）：同优先级的第二次注册在加载期抛错；不同优先级则遮蔽——优先级最低者渲染，另一个永不挂载。因此徽标要进 corner 只有两条路：永久驱逐 ExpandButton（收起的右栏唯一的官方重开入口），或自己永久不可见。两者都不可接受，徽标保持 list 槽位。
- **徽标在 utilities 内的 order 为 `-20`（最左）。** list 槽按 priority 升序、再按 order 升序、最后按注册先后排序（ui-slots `src/index.ts` 注册路径上的 stable-sort 注释）。邻居：官方 open-in-app 拆分按钮（`order: -10`，ui-open-in-app `src/client/index.ts`）、官方 session-log-export 的「…」菜单（无 order → `0`，session-log-export `src/client/index.ts`；省略号按钮即其 `SessionLogDownloadHeaderAction`，`HeaderAction.tsx`）。社区注册在 10 以上（message-timeline 100）。`-20` 让工作树胶囊排在最左且不动任何其他包的注册。「…」菜单的位置归上游所有：list 条目的 order 写在它自己的注册里，插件侧要么同 id 同 priority 撞车抛错、要么同 id 低 priority 双渲染——两条 hack 路都否决；把它挪到 sidebar 开关旁边是上游变更请求，不是本地修改。
- **改动/提交/仓库抽屉迁为右栏 page-type tab**，沿用官方 ui-sidebar-files 两段式形态（及仓内 taskpilot/ui-file-preview 先例）：`src/client/definition.tsx` 把类型注册进 `ctx.sidebarRightTabs`（`id` = 包名，同时是 keyed 槽位的 key；`kind` = `worktrees`；无 `patterns`；默认 `extension` 档；一条 guide 入口），`src/client/WorktreesTab.tsx` 注册进 keyed `sidebar.right.pane.tab` 槽位同一 id。徽标分支胶囊经 `ctx.sidebarRight.openTab('worktrees', { params: { mode } })` 打开；`SidebarRightTabParamsMap` 声明合并 `worktrees: { mode?: DrawerMode }`，body 在每次 `navigation.revision` 递增时应用该 mode，重复点按会重申。不注册 `.title` chip：注册表的静态标题足够。
- **抽屉骨架删除而非保留**：`open` 状态与 `open`/`close` action、overlay/拖宽/Escape/document-mark 推挤 CSS（几何归右栏所有）、关闭按钮（tab 关闭归 dockkit）。store 从 root 作用域变为 session 作用域（keyed 槽位的作用域）；`Drawer.tsx` 拆为 `WorktreesTab.tsx` 与 `sizing.ts`（存活的本地文件浏览器仍需要的拖宽 hook）。
- **改动视图的内容是会话级的，不是仓库级的**：本会话改动档只列本会话修改过且尚未提交的文件——工作树 git 未提交列表 ∩ 兄弟包 file-preview fold 的会话触碰集合（`remote.filePreview.list(sessionId)`，op ≠ read）。file-preview 是平级社区包，经 `ctx.get('remote.filePreview')` 探测 + 本地拼写的接口消费，绝不构成依赖；缺席或读取失败时触碰集合为 null，视图列出全部未提交文件（过滤前行为——fail-open，与徽标闸门同源哲学）。展示路径先按会话 cwd 解析（`resolveWorkspacePath`），再按活动工作树根去前缀（`relativizeToCwd`，两者来自官方 `@deepseek-ai/dsh-util-workspace-path`）；cwd 未知的相对路径条目按仓库相对处理。已提交段整体离开此视图——改名后的仓库提交记录档保留完整分支日志，明确不做会话过滤（用户明确要求）。
- **本地文件浏览器保持 `shell.overlay`**（第三批只迁 diff/commit 抽屉）——但其 external-open 闸门随 tab 一并重接。
- **external-open 改走官方 open-in-app 路由**（`src/client/open-in-app.ts`，镜像自 local-files 同日落地的实现）：每页一次的 `GET /open-in-app/apps` 探测把已安装 catalog id 发布到一个 snapshot store，经 inject hook 绑定（`hooks: { openInApp }` → `useOpenInApp`）；「在文件夹中显示」手势只在 `pickFileManager(apps)` 有解时渲染，点击 POST `/open-in-app/open { app, path }`（仅目录）。宿主没有该路由（404 或 0.1.5 之前）即读作无应用，手势保持隐藏。`hostDescription`/`canOpenPath` 机制（`host-description.ts`、`index.ts` 里的按宿主线探测）与旧的 `workspaces.openPath` / `remote.session.openWorkspacePath` 打开器一并删除；`pickHostDirectory` 简化为 0.1.5 的 `uiWorkspace.pickDirectory` 面。
- `dsh.compat.minHost`/`verifiedHost` 前移至 `0.1.5-rc.1`；`@deepseek-ai/dsh-client-ui-sidebar-right` 以非 optional peer 加入（`^0.1.5-rc.1`，taskpilot 先例：tab 即主体面，没有值得发布的降级路径），devDependencies 整体升到 0.1.5-rc.1 线。宿主换线，版本线升至 0.2.0。

## Alternatives considered

- **以低于 ExpandButton 的优先级占用 corner。** 否决：single 槽遮蔽语义下 ExpandButton 将永不挂载——用户会失去重开收起右栏的官方入口。为徽标驱逐出厂铬件不是本插件有权做的交换。
- **以更高优先级占用 corner。** 否决：最低优先级者渲染，徽标将永不显示；永久被遮蔽的注册是死重。
- **保留 overlay 抽屉作为旧宿主回退。** 否决（taskpilot 同判）：两套几何栈难以同步维护，且本仓对宿主换线的规则是带版本线指引的干净切换，不做运行时分叉。
- **把本地文件浏览器也搬进右栏。** 否决：第三批计划对 worktrees 的划定仅含 diff/commit 抽屉；git 无关的本地文件浏览器是独立面，计划不改其位置。
- **从 `@khorsheed/dsh-local-files` 导入 open-in-app 探测。** 否决：无跨插件依赖规则只承认少数核心/伴侣对；探测模块小且刻意镜像（官方路由常量若移动，降级为「手势隐藏」），两个包各自携带一份。
- **依赖 `@khorsheed/dsh-file-preview` 获取会话触碰集合的类型/命名空间。** 否决：同一条规则——消费面（`list` → `{ path, op }` 条目）只有两个字段宽，本地拼写即可；硬依赖会把徽标主体面的可用性绑到兄弟包的安装状态上。
- **fold 缺失/读取失败时 fail-closed（什么都不显示）。** 否决：过滤是便利而非边界；会话明明有未提交工作，绝不能因为兄弟插件缺席而显示为干净。fail-open（null = 不过滤）与 `visiblePresets` 徽标闸门同源。
- **提交记录也按会话触碰过滤。** 用户明确否决：提交日志保持全量（据此改名仓库提交记录）；只有未提交视图携带会话作用域。

## Consequences

- 徽标点按从开 overlay 抽屉变为开右栏 tab；tab 也可从 guide 页进入；其开关、停靠、fullscreen 全归右栏（含布局意图的撤销/重做）。
- 同一会话的两个 worktrees tab（split 窗格）共享 session 作用域 store，mode/选择互相镜像——接受：page 在 pane 内去重，跨 pane 重复是罕见的进阶操作。
- 本会话改动视图的计数与概览现在描述会话过滤后的集合；徽标分支胶囊的计数仍是仓库级 未提交+已提交（状态信号而非文件列表——不变）。
- 会话触碰过但随后已提交的文件离开本会话改动视图（不再是未提交），仍可从仓库提交记录到达。
- external-open 手势在整个 0.1.2 线隐藏后于 0.1.5 恢复；现在由探测门控，宿主无 open-in-app 路由即不显示。
- tab 内的 `sessionId` 改由 session 作用域标准 props 提供，不再 `useSessions(s => s.current)`；`openTab` 作用于当前挂载会话，与徽标所在会话天然一致（header 只为挂载中的会话渲染）。
- `drawer.*` / `aria.openDrawer` locale 键名保留（字典稳定性），尽管承载面已是 tab。
- 验证：`DSH_HARNESS` 指向 0.1.5-rc.1 checkout 跑 `pnpm --filter @khorsheed/dsh-worktrees build` 与 `pnpm --filter @khorsheed/dsh-worktrees test`；抽屉 spec 由 `tests/worktrees-tab.client.spec.tsx`（挂载拉取链、导航参数 mode）与 `tests/browser-plugin.client.spec.tsx`（注册装配、openTab 路由、卸载复归）接替，探测另有 `tests/open-in-app.client.spec.tsx`。3080 实机验收走独立的 `pnpm deploy:3080` 流程。
