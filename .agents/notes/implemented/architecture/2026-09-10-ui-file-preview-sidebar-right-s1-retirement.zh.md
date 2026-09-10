# Agent Note: ui-file-preview 迁入 0.1.5 右栏体系——S1 缝退役

Status: implemented

[English](2026-09-10-ui-file-preview-sidebar-right-s1-retirement.md) | 中文

## Problem

宿主 0.1.5-rc.1 落地了右栏资源路由（缝注册表 S1）：所有文件打开入口（产物行、正文 mention、工具结果行）统一收敛到 `ctx.sidebarRight.openResource()`，`ctx.sidebarRightTabs.register()` 允许第三方注册 tab 类型——page 类型从向导页进入、不认领地址；地址类型认领 `dsh-resource://` glob。ui-file-preview 的四处绕行（`conversation.view` tab、`shell.overlay` 抽屉、mention 捕获阶段 DOM 拦截、turnTail `priority: -1` 抢占）只因这条缝缺失而存在，其中 DOM 拦截是全包最脆的代码。本次迁移是 `proposals/active/2026-09-10-host-015-adaptation.md` 的第二批。

## Decision

- **新**：page-type 右栏 tab（`kind: 'file-preview'`，id = 包名，guide 入口，不认领地址——即 ui-sidebar-files 形态）。body 为会话改动文件清单（最近活动倒序、可搜索），行点击在 tab 内导航到详情页：面包屑头（目录灰、末段实色）+ 复制路径/在文件夹打开/在 IDE 打开动作，下方「内容 / 改动记录」切换——恢复 0.1.5 前的预览栈（FilePreviewPane：Markdown/JSON/CSV/HTML 沙箱/代码 + 内容搜索）与共享的 DiffHistory。回合卡片对工作区外路径用 `openTab('file-preview', { params: { path } })` 打开该页并直落详情。（第一版把内容预览经 openResource 交给官方 document tab、改动记录堆在列表下方；活体试用否了两者——详情页收回我们自己的 tab，mention 仍走官方 document tab 作快速预览，改动记录同时保留为官方预览页的可切换渲染器——见下条。）
- **删**：`conversation.view` 注册、`shell.overlay` 抽屉、`mention-intercept.ts`、turnTail 的 `priority: -1`、panel controller（`panel-service.ts`）、host-description 探测，以及整套自绘内容预览（FilePreviewPane 的内容半、`structured.tsx`、`html-bridge.ts`、`html-src-doc.ts`、复制/文件夹/IDE 手势）——内容渲染是官方 `text` tab 类型的职责。
- **留**：turnTail 回合变更卡片（宿主数据含 bash 捕获——S2 仍绕行中——因此它覆盖官方产物行 decline 的回合）。改默认优先级：官方条目（同档、宿主启动时先注册）先选举，卡片的无条件认领只在官方数据缺失的回合被咨询。卡片点击对工作区内路径走 owner 的 `openFile`（官方 openResource 路由），工作区外走 `openTab`。
- **边界**：工作区外的 bash 产物造不出 `dsh-resource://file/...` 地址（官方 `file` 资源限定工作区，宿主应答 `workspace-file/outside-workspace`），永远进不了官方 document tab——但详情页是我们自己的、不受此限：宿主 `read` 能解析绝对路径、reveal/openExternal 也接受，故这类文件内容与改动记录都完整可看。列表行仍带「工作区外」标记。
- **改动记录视图（逐次 write/edit diff 步进）刻意保留自绘，形态是官方 document tab 的可切换渲染器**：`ctx.documentPreviews.register()`（纯后缀匹配、无通配符——`history-definition.ts` 枚举常见文本后缀，刻意不含复合后缀，避免等档时靠长度压过官方渲染器）+ 同 id（`<pkg>/history`）注册进 keyed `sidebar.right.tab.document` seat。`priority: 'builtin'` 是显式选择：出现在预览页工具栏下拉里但不抢官方默认渲染（extension 档会抢走）。组件解析 session 作用域的 `resourceAddress`，拉 `filePreview.list` fold，按工作区解析路径匹配，渲染 `DiffHistory.tsx`；owner 备好的 `content` 不消费（`loading: 'text-pages'`，最省模式）。无记录文件显示空态。
- **mention 打开直落我们的详情页（S1 尾巴，新绕行）**：ui-deliverables 的 `chatFileMentions` 对 `present` 交付的文件走原生默认程序、未交付的才走 sidebar。`ctx.provide` 拒绝重名、`ctx.set` 拒绝非提供方 fiber（"cannot set property in multiple fibers"），故 `mentions-wrap.ts` 就地改写所提供对象的 `forClosing`——原实现保留认领逻辑；每个 resolved `open` 改为 `sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))`——规范化文件地址，而不是 page 地址：openTab 的 page 打开与 openResource 的认领会给同一文件造两个 tab（page 地址 `sidebar://file-preview` vs 文件 contentId），活体试用当场抓到。回合卡片的工作区外 openTab 分支同理删除——`fileAddressFor` 把绝对路径保留在 session 地址里且我们的认领覆盖（详情页经 Remote read 照常渲染），于是所有来源对同一文件收敛到同一个 content id；包装抛错回退 `owner.openFile`，label 修实（官方「在默认程序中打开」已不成立）。包装住在注入 `chatFileMentions` 的嵌套 fiber 里（一次性 `ctx.get` 会与 deliverables fiber 的 provide 抢跑；嵌套 fiber 等待服务出现、HMR 重提供时重包装）。登记为缝 S1 的补充，退役条件=官方提供 opener 覆盖点。
- **tab 类型同时认领地址**：`patterns: ['dsh-resource://file/**']` + `canOpen` = session 作用域 + 可渲染后缀，**纯静态**。默认 extension 档压过官方 document tab 的 fallback 档，所有 openResource 入口（官方产物卡片、文件树、owner.openFile）对可渲染文件都落我们的详情页；渲染不了的类型（pdf、二进制）否决回落。guide 入口与认领共存。body 在没有 `params.path` 时从 `navigation.address` 解析详情路径，每个 navigation revision 只套用一次。第一版还要求 fold 成员（apply 级缓存）——活体抓到竞态：官方卡片认领的回合不挂我们的卡片（其加载器），恰好那些文件的缓存恒冷、永远落官方页（「有时官方有时我们」）。canOpen 必须同步回答而任何数据缓存都有冷启动窗口，故成员判定整体去除——详情页对任何工作区内文件都能渲染，认领语义变为确定性。
- **行动作恢复**（详情页头部——行悬停动作组试过，因可读性被否）：复制路径恒定（`writeClipboard` 写 cwd 解析后的绝对路径）；在文件夹打开保持旧抽屉语义——宿主半 `reveal`（选中文件），回退官方 open-in-app POST 路由开父目录；在 IDE 打开要精确到文件，官方路由只收目录，故宿主半新增 `filePreview.openExternal(path, app)`——macOS `open -a <App>`（经 dsh-native-command），catalog id → `.app` 名映射镜像官方 catalog 的 darwin 条目（`open-external.ts`）。手势可见性由每页一次的 `/open-in-app/apps` 探测驱动（镜像 local-files 的 `open-in-app.ts`——跨插件值引用被纯度门禁止）；探测无应答或无对应应用 = 按钮隐藏。
- **回合卡片选举，最终形态**：链选举为升序 priority 首个非空（ui-slots ChainSelect 契约），官方 deliverables 默认 0。中间版曾显式 `priority: 1`（官方赢它认领的回合，我们补剩余）；活体评审随后确立两个事实——某些会话里官方大卡消失并非我们选举获胜，而是官方自身行为（大卡只渲染 `present` 工具交付的文件；produced+presented 全空时 `selectDeliverables` 否决，Deliverables.tsx），且用户直接更认我们的紧凑表格——故条目改 `priority: -1` 认领所有回合：本插件在组合内时官方行永不挂载。S1 时代的抢占以产品决策回归，形态是表格。
- **minHost 前移至 0.1.5-rc.1**（消费的扩展面在此之前不存在），版本 0.3.0；旧宿主停留 0.2.x 线。
- **依赖机制**：本包随全仓 0.1.5-rc.1 基线走。一处仓级调整不可避免：0.1.5 的客户端包 peer 要求 `@deepseek-ai/cordis ^4.0.2`，而仓内基线是 4.0.1——两个 cordis 实例会把每个 `declare module` 合并（Context、SlotMap、LocaleNamespaceMap）按 peer 变体劈成两份，插件自己的合并永远落不到它 import 解析到的那份上。修复最终以仓级形态落地：`overrides` 把 cordis 钉到 4.0.2（bb04c84），全图保持一个 cordis 实例。另外，0.1.5 的 `dsh-client-store` npm 产物未打包（裸 `zustand`/`immer` import 且无声明依赖——官方构建本应内联，疑似上游打包缺陷），而客户端 bundle 按 `INLINE_SAFE` 内联该引擎，因此本包 dev-depends `zustand ~4.4.7` + `immer ^10.1.1` 使内联可解析。

### 产物表格（回合卡片，最终形态）

turnTail 是取代官方 deliverables 行的紧凑表格：文件类型图标 + 文件名 + 弱化目录 + 行数增减；≤3 个产物直接平铺，更多则折叠为「N 个产物」可展开摘要行（官方大卡从不折叠）。点击保持规范化地址通路（owner.openFile → 我们认领的详情 tab）。这是 0.2 时代抽屉列表的密度在当前 token 上的重述。

### 活体对比后的打磨

- diff/内容统一吃官方 document tab 的阅读字号：主题的 `--dsw-font-markdown-code-block` 是固定 11px/19px、从不跟随正文字号设置，故在 pane 作用域内重绑为 `var(--dsh-content-font-size-secondary)/1.6` + 等宽族（官方 TextPreview body 的原配方）。
- 详情页「改动记录」tab 按需出现（fold 无 diff 记录时不显示——常驻 tab 配空态读起来像坏了）；官方渲染器下拉项仍按后缀静态匹配，不受影响。面包屑改 `Users / me / code / file` 分段样式（目录段弱化、分隔符留白、逐段省略号、文件名整段加粗）。guide 卡片带自绘双色 SVG 图标（文档页 + diff 强调色）与收紧文案——图标槽收任意 ComponentType<IconProps>，描述按设计单行。
- 「在 IDE 打开」改 split button（主按钮=当前选择，chevron 列出全部探测到的 IDE，选择即换即开；官方 `OpenInAppAction` 组件受 slot 申领规则不可导入，交互照它自绘在 ui-primitives `Menu` 上）。显示名用镜像的 id→label 表（专有名词，不本地化——官方同规则）。活体后续：(a) 下拉在面板右缘被裁切——用 Menu 自带的 `align="end"` 修好；(b) 样式先对齐官方 pill，用户看过后决意回退为详情页头部自有的低调图标按钮形态（图标主按钮 + 图标 chevron，无 pill 外框）——align="end" 修复保留。重绘前复核过复用性（0.1.5-rc.1）：该包只导出类型（client/index.ts 仅 re-export `OpenInAppActionInjected/Props`，组件不出），controller（探测+记忆+图标）同样不导出，且动作语义写死「打开会话工作目录」（`launch(appId, cwd)`）；host 路由直接拒收文件（`packages/host/open-in-app/src/index.ts:281-292`：必须绝对路径且 `stat().isDirectory()`，否则 404，无父目录兜底）。复用与文件语义都是死路，自绘 split 保留。

## Alternatives considered

- **抽屉/视图与右栏 tab 并存**——否决：同一文件两处预览，保留了本次迁移要删的维护面；抽屉独有的内容（diff 历史）已迁入 tab body。
- **以 `priority: 'extension'` 自己认领 `dsh-resource://file/**` 并渲染内容**——否决：extension 档会对所有客户端遮蔽官方 `text` 类型（全局接管而非局部偏好），且要重画宿主自带的 markdown/code/image/pdf/html 渲染器。本 tab 类型不认领任何地址，路由保持官方。
- **官方 deliverables 已存在，删掉回合卡片**——暂不：官方数据完全不含 bash 写入（S2），该卡片恰好是这些回合唯一的回合级表面。待宿主 `present` 工具普及或 S2 落地后再评估。
- **自声明 `sidebar.right.pane.tab` 的 SlotMap 条目而不修 cordis 双实例**——否决：能过类型检查，但悄悄分叉了 seat 契约（宿主侧改 seat 时对着过期副本照样编译通过）。单 cordis 实例才是诚实的修法；peer 放宽与仓内既有的 unmet-peer 警告一致。

## Consequences

- `pnpm --filter @khorsheed/dsh-client-ui-file-preview build|test` 全绿（46 个测试），`DSH_HARNESS=deepseek-harness-0.1.5-alpha`（钉 `dsh-v0.1.5-rc.1`）；全仓 build/test 与 3080 验收门归 mainline 基线波次。
- 本包卸下了对宿主结构最脆的耦合（DOM 拦截、链抢占）；剩下的只有注册表 + slot + Remote 面。
- 自绘预览栈先退役、后在详情页内恢复（活体试用更认它）：Markdown/JSON/CSV/HTML 沙箱渲染、内容搜索、external-open 手势（复制 / reveal / 经宿主半新 `openExternal` 的在 IDE 打开）。官方 document tab 保留为 mention 通路，并挂我们的改动记录渲染器。
- cordis 劈叉改由仓级解决：bb04c84 用 `overrides` 把 cordis 钉到 4.0.2（本变更引入的 `peerDependencyRules` 放宽已在 5d832bd 撤除）。`zustand`/`immer` devDeps 仍是过渡性打包缝：官方 `dsh-client-store` 产物重新打包其运行时依赖后退役。其他内联 `dsh-client-store` 的客户端包需要同样的 zustand/immer 可解析性——已上报 mainline。
- 缝注册表：S1 标已退役（0.1.5-rc.1）；S2 不变（宿主半的 bash 采集器保留）。
