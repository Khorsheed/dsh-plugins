# Agent Note: ui-file-preview 迁入 0.1.5 右栏体系——S1 缝退役

Status: implemented

[English](2026-09-10-ui-file-preview-sidebar-right-s1-retirement.md) | 中文

## Problem

宿主 0.1.5-rc.1 落地了右栏资源路由（缝注册表 S1）：所有文件打开入口（产物行、正文 mention、工具结果行）统一收敛到 `ctx.sidebarRight.openResource()`，`ctx.sidebarRightTabs.register()` 允许第三方注册 tab 类型——page 类型从向导页进入、不认领地址；地址类型认领 `dsh-resource://` glob。ui-file-preview 的四处绕行（`conversation.view` tab、`shell.overlay` 抽屉、mention 捕获阶段 DOM 拦截、turnTail `priority: -1` 抢占）只因这条缝缺失而存在，其中 DOM 拦截是全包最脆的代码。本次迁移是 `proposals/active/2026-09-10-host-015-adaptation.md` 的第二批。

## Decision

- **新**：page-type 右栏 tab（`kind: 'file-preview'`，id = 包名，guide 入口，不认领地址——即 ui-sidebar-files 形态）。body 为会话改动文件清单（最近活动倒序、可搜索），整栏高度，别无他物。工作区内的行点击既在本地选中，又经 tab 的 `actions.openResource(fileAddressFor(sessionId, cwd, path))`（`dsh-resource://file/session/<id>/<path>`）把内容预览交给官方 document tab。回合卡片对工作区外路径用 `openTab('file-preview', { params: { path } })` 打开该页；body 在每次 navigation revision 上套用 params 携带的选中。（第一版把改动记录堆在列表下方，活体试用观感不对，遂迁入 document tab 作可切换渲染器——见下条。）
- **删**：`conversation.view` 注册、`shell.overlay` 抽屉、`mention-intercept.ts`、turnTail 的 `priority: -1`、panel controller（`panel-service.ts`）、host-description 探测，以及整套自绘内容预览（FilePreviewPane 的内容半、`structured.tsx`、`html-bridge.ts`、`html-src-doc.ts`、复制/文件夹/IDE 手势）——内容渲染是官方 `text` tab 类型的职责。
- **留**：turnTail 回合变更卡片（宿主数据含 bash 捕获——S2 仍绕行中——因此它覆盖官方产物行 decline 的回合）。改默认优先级：官方条目（同档、宿主启动时先注册）先选举，卡片的无条件认领只在官方数据缺失的回合被咨询。卡片点击对工作区内路径走 owner 的 `openFile`（官方 openResource 路由），工作区外走 `openTab`。
- **边界**：工作区外的 bash 产物造不出 `dsh-resource://file/...` 地址（官方 `file` 资源限定工作区，宿主应答 `workspace-file/outside-workspace`）。这些行仅可选中并附行内提示；由于改动记录已迁入 document tab 而这类文件永远打不开 document tab，它们目前没有任何预览面——不另做自绘兜底。
- **改动记录视图（逐次 write/edit diff 步进）刻意保留自绘，形态是官方 document tab 的可切换渲染器**：`ctx.documentPreviews.register()`（纯后缀匹配、无通配符——`history-definition.ts` 枚举常见文本后缀，刻意不含复合后缀，避免等档时靠长度压过官方渲染器）+ 同 id（`<pkg>/history`）注册进 keyed `sidebar.right.tab.document` seat。`priority: 'builtin'` 是显式选择：出现在预览页工具栏下拉里但不抢官方默认渲染（extension 档会抢走）。组件解析 session 作用域的 `resourceAddress`，拉 `filePreview.list` fold，按工作区解析路径匹配，渲染 `DiffHistory.tsx`；owner 备好的 `content` 不消费（`loading: 'text-pages'`，最省模式）。无记录文件显示空态。
- **mention 打开方向统一进 sidebar（S1 尾巴，新绕行）**：ui-deliverables 的 `chatFileMentions` 对 `present` 交付的文件走原生默认程序、未交付的才走 sidebar。`ctx.provide` 拒绝重名、`ctx.set` 拒绝非提供方 fiber（"cannot set property in multiple fibers"），故 `mentions-wrap.ts` 就地改写所提供对象的 `forClosing`——原实现保留认领/文案，每个 resolved `open` 改为 `owner.openFile(hit.title)`（`title` 是官方 builder 的路径契约）。加载序靠 dsh.client.inject 的 ui-deliverables 包边；deliverables fiber HMR 重载会丢包装（接受）。登记为缝 S1 的补充，退役条件=官方提供 opener 覆盖点。
- **行动作恢复**（产物列表行悬停动作）：复制路径恒定（`writeClipboard` 写 cwd 解析后的绝对路径）；在文件夹打开保持旧抽屉语义——宿主半 `reveal`（选中文件），回退官方 open-in-app POST 路由开父目录；在 IDE 打开要精确到文件，官方路由只收目录，故宿主半新增 `filePreview.openExternal(path, app)`——macOS `open -a <App>`（经 dsh-native-command），catalog id → `.app` 名映射镜像官方 catalog 的 darwin 条目（`open-external.ts`）。手势可见性由每页一次的 `/open-in-app/apps` 探测驱动（镜像 local-files 的 `open-in-app.ts`——跨插件值引用被纯度门禁止）；探测无应答或无对应应用 = 按钮隐藏。
- **回合卡片选举确定性**：链选举为升序 priority 首个非空（ui-slots ChainSelect 契约），官方 deliverables 为默认 0，故本卡片显式 `priority: 1`——官方认领恒胜，本卡片只覆盖官方数据缺失的回合；同档会随 compose 序飘移。
- **minHost 前移至 0.1.5-rc.1**（消费的扩展面在此之前不存在），版本 0.3.0；旧宿主停留 0.2.x 线。
- **依赖机制**：本包随全仓 0.1.5-rc.1 基线走。一处仓级调整不可避免：0.1.5 的客户端包 peer 要求 `@deepseek-ai/cordis ^4.0.2`，而仓内基线是 4.0.1——两个 cordis 实例会把每个 `declare module` 合并（Context、SlotMap、LocaleNamespaceMap）按 peer 变体劈成两份，插件自己的合并永远落不到它 import 解析到的那份上。修复最终以仓级形态落地：`overrides` 把 cordis 钉到 4.0.2（bb04c84），全图保持一个 cordis 实例。另外，0.1.5 的 `dsh-client-store` npm 产物未打包（裸 `zustand`/`immer` import 且无声明依赖——官方构建本应内联，疑似上游打包缺陷），而客户端 bundle 按 `INLINE_SAFE` 内联该引擎，因此本包 dev-depends `zustand ~4.4.7` + `immer ^10.1.1` 使内联可解析。

## Alternatives considered

- **抽屉/视图与右栏 tab 并存**——否决：同一文件两处预览，保留了本次迁移要删的维护面；抽屉独有的内容（diff 历史）已迁入 tab body。
- **以 `priority: 'extension'` 自己认领 `dsh-resource://file/**` 并渲染内容**——否决：extension 档会对所有客户端遮蔽官方 `text` 类型（全局接管而非局部偏好），且要重画宿主自带的 markdown/code/image/pdf/html 渲染器。本 tab 类型不认领任何地址，路由保持官方。
- **官方 deliverables 已存在，删掉回合卡片**——暂不：官方数据完全不含 bash 写入（S2），该卡片恰好是这些回合唯一的回合级表面。待宿主 `present` 工具普及或 S2 落地后再评估。
- **自声明 `sidebar.right.pane.tab` 的 SlotMap 条目而不修 cordis 双实例**——否决：能过类型检查，但悄悄分叉了 seat 契约（宿主侧改 seat 时对着过期副本照样编译通过）。单 cordis 实例才是诚实的修法；peer 放宽与仓内既有的 unmet-peer 警告一致。

## Consequences

- `pnpm --filter @khorsheed/dsh-client-ui-file-preview build|test` 全绿（46 个测试），`DSH_HARNESS=deepseek-harness-0.1.5-alpha`（钉 `dsh-v0.1.5-rc.1`）；全仓 build/test 与 3080 验收门归 mainline 基线波次。
- 本包卸下了对宿主结构最脆的耦合（DOM 拦截、链抢占）；剩下的只有注册表 + slot + Remote 面。
- 放弃：自绘文档预览（markdown/JSON/CSV/HTML 沙箱渲染）、external-open 手势（打开文件夹 / 在 IDE 打开 / 复制路径）、内容搜索。external-open 计划经官方 open-in-app 通道在第三批回归（local-files A 方案通道）。
- cordis 劈叉改由仓级解决：bb04c84 用 `overrides` 把 cordis 钉到 4.0.2（本变更引入的 `peerDependencyRules` 放宽已在 5d832bd 撤除）。`zustand`/`immer` devDeps 仍是过渡性打包缝：官方 `dsh-client-store` 产物重新打包其运行时依赖后退役。其他内联 `dsh-client-store` 的客户端包需要同样的 zustand/immer 可解析性——已上报 mainline。
- 缝注册表：S1 标已退役（0.1.5-rc.1）；S2 不变（宿主半的 bash 采集器保留）。
