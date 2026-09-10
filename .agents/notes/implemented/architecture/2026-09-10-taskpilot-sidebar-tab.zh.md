# Agent Note: TaskPilot 详情视图迁移为右栏 tab

Status: implemented

## Problem

TaskPilot 的任务详情视图原来是自建的右侧浮层（`shell.overlay` order 120），自带 store、document 标记与推开布局计算（`drawer-inset.ts`）以及窄屏降级——这一整套几何栈，宿主 0.1.5 的右栏已经原生提供。宿主 0.1.5 适配提案（[proposals/active/2026-09-10-host-015-adaptation.md](../../../proposals/active/2026-09-10-host-015-adaptation.md)，第三批）给 taskpilot 的指派是：composer 胶囊不动，抽屉迁入官方右栏 tab。

## Decision

详情视图改为 page-type 右栏 tab，照官方 `ui-sidebar-files` 的两段式形态：

- `src/client/definition.ts` 把类型注册进 `ctx.sidebarRightTabs`：`id` = 包名（`@khorsheed/dsh-taskpilot`，同时是 keyed 槽位的 key），`kind` = `taskpilot`，无 `patterns`（page 不认领地址），无 `priority`（默认 `extension` 档正是产品外类型的位置），无 `guide` 条目——没有选中任务的详情页不是有意义的入口，所以不上 guide 页。
- 抽屉 body 原样搬进 `src/client/JobTab.tsx`，注册进 keyed `sidebar.right.pane.tab` 槽位（key 为类型 id）；`src/client/JobTabTitle.tsx` 注册进 `sidebar.right.pane.tab.title`，让 chip 显示当前任务 id。
- 选中态走导航参数：胶囊的详情入口调 `ctx.sidebarRight.openTab('taskpilot', { params: { jobId } })`；`SidebarRightTabParamsMap` 用声明合并补上 `taskpilot: { jobId: string }`（与 `ui-sidebar-documentpreview` 给资源参数用的同一手法）。page 在 pane 内去重，换看另一个任务会在同一个 tab 上重新导航——body 跟随 `useTabInfo().tab.navigation.params`，并在 `navigation.revision` 变化时重载。
- 抽屉栈是删除不是保留：`drawer-store.ts`（跨面共享状态已不存在——tab 记录本身就是状态）、`drawer-inset.ts`（宽度/全屏/停靠归右栏管）、document 标记效果，以及随之不再需要的 `dsh-client-store` 依赖。
- `dsh.compat.minHost`/`verifiedHost` 前移至 `0.1.5-rc.1`；README 指引旧宿主停留 `0.2.0` 线。构建期类型消费 `@deepseek-ai/dsh-client-ui-sidebar-right@0.1.5-rc.1`（外加 `@deepseek-ai/dsh-client-ui-dockkit`，供其 re-export 的 tab 记录类型）作为 devDependency，并对 sidebar-right 包声明非 optional 的 peerDependency：tab 面就是这个功能本身，没有值得发布的降级路径。

## Alternatives considered

- **保留浮层作为旧宿主的降级面。** 否决：双面意味着两套几何栈要同时保真，而且本仓对宿主线切换的惯例是干净切换加版本线指引，不是运行期分叉。
- **注册 guide 条目，让 tab 不经胶囊也能开。** 否决：没有任务选中的详情页没有意义，guide 上的空详情页看起来就是坏的。guide 契约（`guide?:`）本来就允许不出现。
- **做成认领地址的 viewer 类型（patterns + canOpen）而不是 page 类型。** 否决：任务没有可认领的 `dsh-resource://` 地址空间；详情视图就是带参数的具名页面，正是 `openTab` 的模型。
- **等仓 baseline 升到 0.1.5 再消费新类型。** 否决：0.1.5-rc.1 的 npm 包已带完整类型面，且 ui-slots 0.1.2 的槽位机制（hookContext、keyed 槽位）与 0.1.5 的 SlotMap 行所需正好相容——混合类型基线编译干净。

## Consequences

- bundle 减掉了抽屉 store、推开布局计算和 store 引擎内联（`dsh-client-store` devDependency 移除；`lib/client.js` 相应缩小）。
- `pnpm-workspace.yaml` 新增两条 `minimumReleaseAgeExclude`（`@deepseek-ai/dsh-client-ui-dockkit@0.1.5-rc.1`、`@deepseek-ai/dsh-client-ui-sidebar-right@0.1.5-rc.1`）——pnpm 安装时机械添加；因该文件是 mainline 拥有的基线，特此点名。
- `drawer.*` locale key 保持原名（词典稳定），注释里记录了前缀早于本次迁移。
- `openTab` 作用于已挂载的会话；胶囊长在被挂载会话的 conversation 里，两者天然同会话。若胶囊为非挂载会话渲染，tab 会开错会话——接受这一点，因为 `conversation.input.dock` 只为活动会话渲染。
- 验证：`DSH_HARNESS` 指向 0.1.5-rc.1 检出的 `pnpm --filter @khorsheed/dsh-taskpilot build` 与 `pnpm --filter @khorsheed/dsh-taskpilot test`（48 个测试）；抽屉 spec 由 `tests/job-tab.spec.tsx` 替代（definition 形态、轨迹折叠、重导航重载、空态）。3080 活体验收走 `pnpm deploy:3080`，是独立步骤。
