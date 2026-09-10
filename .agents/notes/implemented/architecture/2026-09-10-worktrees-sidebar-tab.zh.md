# Agent Note: worktrees 改动视图迁为右栏 tab；徽标留在 utilities

Status: implemented

## Problem

宿主 0.1.5 适配计划（[proposals/active/2026-09-10-host-015-adaptation.md](../../../proposals/active/2026-09-10-host-015-adaptation.md) 第三批）给 worktrees 布置了两个入口迁移：徽标迁往新增的 `conversation.session.header.corner` 槽，diff/commit 抽屉迁为右栏 tab 类型。对 0.1.5-rc.1 源码的核实表明第一步不可行；第二步落地，并且同事务重接了 external-open 手势——0.1.2 线上它被迫永久隐藏（`canOpenPath` host-description 字段变成了 loopback 闸门无法确认的 RPC 探测）。

## Decision

- **徽标留在 `conversation.session.header.utilities`。** corner 槽是 `kind: 'single'`，且出厂 web 组合（packages/bundle/web-app/cordis.patch.yml）挂载的 ui-sidebar-right 已用 ExpandButton 以默认优先级占用。single 槽冲突语义（packages/client/ui-slots/src/index.ts）：同优先级的第二次注册在加载期抛错；不同优先级则遮蔽——优先级最低者渲染，另一个永不挂载。因此徽标要进 corner 只有两条路：永久驱逐 ExpandButton（收起的右栏唯一的官方重开入口），或自己永久不可见。两者都不可接受，徽标保持 list 槽位。
- **改动/提交/仓库抽屉迁为右栏 page-type tab**，沿用官方 ui-sidebar-files 两段式形态（及仓内 taskpilot/ui-file-preview 先例）：`src/client/definition.tsx` 把类型注册进 `ctx.sidebarRightTabs`（`id` = 包名，同时是 keyed 槽位的 key；`kind` = `worktrees`；无 `patterns`；默认 `extension` 档；一条 guide 入口），`src/client/WorktreesTab.tsx` 注册进 keyed `sidebar.right.pane.tab` 槽位同一 id。徽标分支胶囊经 `ctx.sidebarRight.openTab('worktrees', { params: { mode } })` 打开；`SidebarRightTabParamsMap` 声明合并 `worktrees: { mode?: DrawerMode }`，body 在每次 `navigation.revision` 递增时应用该 mode，重复点按会重申。不注册 `.title` chip：注册表的静态标题足够。
- **抽屉骨架删除而非保留**：`open` 状态与 `open`/`close` action、overlay/拖宽/Escape/document-mark 推挤 CSS（几何归右栏所有）、关闭按钮（tab 关闭归 dockkit）。store 从 root 作用域变为 session 作用域（keyed 槽位的作用域）；`Drawer.tsx` 拆为 `WorktreesTab.tsx` 与 `sizing.ts`（存活的本地文件浏览器仍需要的拖宽 hook）。
- **本地文件浏览器保持 `shell.overlay`**（第三批只迁 diff/commit 抽屉）——但其 external-open 闸门随 tab 一并重接。
- **external-open 改走官方 open-in-app 路由**（`src/client/open-in-app.ts`，镜像自 local-files 同日落地的实现）：每页一次的 `GET /open-in-app/apps` 探测把已安装 catalog id 发布到一个 snapshot store，经 inject hook 绑定（`hooks: { openInApp }` → `useOpenInApp`）；「在文件夹中显示」手势只在 `pickFileManager(apps)` 有解时渲染，点击 POST `/open-in-app/open { app, path }`（仅目录）。宿主没有该路由（404 或 0.1.5 之前）即读作无应用，手势保持隐藏。`hostDescription`/`canOpenPath` 机制（`host-description.ts`、`index.ts` 里的按宿主线探测）与旧的 `workspaces.openPath` / `remote.session.openWorkspacePath` 打开器一并删除；`pickHostDirectory` 简化为 0.1.5 的 `uiWorkspace.pickDirectory` 面。
- `dsh.compat.minHost`/`verifiedHost` 前移至 `0.1.5-rc.1`；`@deepseek-ai/dsh-client-ui-sidebar-right` 以非 optional peer 加入（`^0.1.5-rc.1`，taskpilot 先例：tab 即主体面，没有值得发布的降级路径），devDependencies 整体升到 0.1.5-rc.1 线。宿主换线，版本线升至 0.2.0。

## Alternatives considered

- **以低于 ExpandButton 的优先级占用 corner。** 否决：single 槽遮蔽语义下 ExpandButton 将永不挂载——用户会失去重开收起右栏的官方入口。为徽标驱逐出厂铬件不是本插件有权做的交换。
- **以更高优先级占用 corner。** 否决：最低优先级者渲染，徽标将永不显示；永久被遮蔽的注册是死重。
- **保留 overlay 抽屉作为旧宿主回退。** 否决（taskpilot 同判）：两套几何栈难以同步维护，且本仓对宿主换线的规则是带版本线指引的干净切换，不做运行时分叉。
- **把本地文件浏览器也搬进右栏。** 否决：第三批计划对 worktrees 的划定仅含 diff/commit 抽屉；git 无关的本地文件浏览器是独立面，计划不改其位置。
- **从 `@khorsheed/dsh-local-files` 导入 open-in-app 探测。** 否决：无跨插件依赖规则只承认少数核心/伴侣对；探测模块小且刻意镜像（官方路由常量若移动，降级为「手势隐藏」），两个包各自携带一份。

## Consequences

- 徽标点按从开 overlay 抽屉变为开右栏 tab；tab 也可从 guide 页进入；其开关、停靠、fullscreen 全归右栏（含布局意图的撤销/重做）。
- 同一会话的两个 worktrees tab（split 窗格）共享 session 作用域 store，mode/选择互相镜像——接受：page 在 pane 内去重，跨 pane 重复是罕见的进阶操作。
- external-open 手势在整个 0.1.2 线隐藏后于 0.1.5 恢复；现在由探测门控，宿主无 open-in-app 路由即不显示。
- tab 内的 `sessionId` 改由 session 作用域标准 props 提供，不再 `useSessions(s => s.current)`；`openTab` 作用于当前挂载会话，与徽标所在会话天然一致（header 只为挂载中的会话渲染）。
- `drawer.*` / `aria.openDrawer` locale 键名保留（字典稳定性），尽管承载面已是 tab。
- 验证：`DSH_HARNESS` 指向 0.1.5-rc.1 checkout 跑 `pnpm --filter @khorsheed/dsh-worktrees build` 与 `pnpm --filter @khorsheed/dsh-worktrees test`；抽屉 spec 由 `tests/worktrees-tab.client.spec.tsx`（挂载拉取链、导航参数 mode）与 `tests/browser-plugin.client.spec.tsx`（注册装配、openTab 路由、卸载复归）接替，探测另有 `tests/open-in-app.client.spec.tsx`。3080 实机验收走独立的 `pnpm deploy:3080` 流程。
