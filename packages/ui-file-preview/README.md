# @khorsheed/dsh-client-ui-file-preview

[English](README.en.md) | 中文

agent 写过、改过的文件：内容预览 + 每一次改动的 diff 步进。

agent 干了半天活，到底动了哪些文件、改成了什么样？装了这个插件——**0.1.7-rc.1 起**，文件点击（文件树、正文 mention、回合卡片、「会话产物」壳）落进官方 document tab，而默认渲染器是我们的**共享内容面板**（`@khorsheed/dsh-client-ui-content-preview`，注册进官方 `documentPreviews` 面、extension 档，以**无头模式**并入——官方框架已有路径行/「打开方式」下拉/重新读取，面板不再重复自己的标题栏与搜索框）：Markdown 渲染成文档、JSON 检查树、CSV 表格、HTML 沙箱分级渲染、代码高亮；复制路径保留为内容区右上角的小按钮（官方 actions 只有原生打开，没有等价物）；官方渲染器与我们的「改动记录」渲染器（逐次步进每一次 write/edit 的 diff）收在工具栏下拉里。**0.1.5** 宿主没有官方面，右栏向导页多出自建「会话产物」页：文件清单 + 详情页（同一内容面板 +「内容 / 改动记录」切换 + 在文件夹/IDE 打开手势）。每个回合结束，对话里都会出现一张小卡片，汇总这一轮改了哪几个文件、各增删了多少行——rc.1 起这是回合区唯一的产物卡（官方 present 卡与内存态 changes 卡被 slot 遮蔽机制压下，见「实现原理」）。数据由配套的宿主半 `@khorsheed/dsh-file-preview` 提供（含官方数据覆盖不到的 bash 写入捕获），两边一起装才有界面可看；宿主半不在时全部 UI 面缺席——不留错误卡或空 tab。

## 特性

- **官方 document tab 的默认内容渲染器（0.1.7-rc.1 起）**——内容面板注册进官方 `documentPreviews` 面（extension 档，外部实现压过官方内置），以无头模式并入：官方框架的路径行/「打开方式」下拉/重新读取之下只出内容区，文档形态预览（Markdown/JSON/CSV/HTML 沙箱分级/代码高亮）原样并入；复制路径是官方 actions 没有等价物的唯一手势，保留为内容区右上角小按钮。官方渲染器（文本/Markdown/代码/缩放图片等）在工具栏下拉里随时可切。自建 FilePreviewTab 内容页不再注册，文件点击/mentions 全部路由官方 document tab。
- **「会话产物」薄列表壳（0.1.7-rc.1 起）**——自建内容页退役后，会话产物入口以新 tab 类型 `file-artifacts` 回归：向导页进入，列出本会话写过/改过的文件（宿主 fold 数据源，可搜索、可刷新），点行经官方 resource 地址打开官方 document tab——壳本身不画内容。
- **自建「产物」页（0.1.5）**——page-type 右栏 tab（向导页进入，`dsh-resource://file/**` + 可渲染后缀认领）：会话写入或编辑过的每个文件按最近活动倒序、可搜索；点行进入详情页（面包屑头 + 复制路径/在文件夹打开/在 IDE 打开 +「内容 / 改动记录」切换）。
- **改动记录渲染器（双线）**——官方 document tab 工具栏下拉可选「改动记录」：逐次步进每一次 write/edit 的 diff。官方至今无对应维度（workspace-changes 为内存态、git-only、宿主重启即失），此维度与回合卡片一起长期自留，**跟踪上游**：官方若日后支持同等能力（会话产出/改动记录的持久化维度），再评估退役。
- **工作区外产物同等待遇（双线）**——bash 写到工作区外的文件经我们自己的 Remote read 照常渲染（官方工作区读覆盖不到）：rc.1 在官方 document tab 内（渲染器自持加载，`loading: 'renderer'`），0.1.5 在自建详情页。
- **回合变更卡片（双线）**——每个已完成回合末尾可收起的「N 个产物」卡片（含 bash 捕获，比官方产物行数据全），逐文件列出行数增减；点击走官方打开路由。rc.1 起同槽的官方 deliverables 条目（present 卡 + 内存态 changes 卡）被一等 slot 遮蔽（同 cell id、更低 priority 的空体胜出）压下——回合区只留这张持久全量卡。

## 安装

界面与数据分成两个包，都要装：

```sh
dsh plugin --profile web add @khorsheed/dsh-file-preview            # 宿主半：折叠文件清单、读内容
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview  # 本包：界面
```

然后重启 web 实例。卸载本包（宿主半可留可卸）：

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-ui-file-preview
```

## Compatibility

| Host 行 | 结论 |
| --- | --- |
| deepseek-harness master（`0.1.7-rc.1`） | ✅ 完整——内容预览注册进官方 `documentPreviews` 面（官方 document tab 的默认渲染器，无头模式），自建内容 tab 不注册；「会话产物」薄列表壳（`file-artifacts`）回归；回合区只留我们的产物卡（官方 deliverables 条目被一等 slot 遮蔽） |
| npm release（`>= 0.1.5-rc.1`） | ✅ 完整（`verifiedHost: 0.1.5-rc.1`）——自建「产物」页 tab + 官方预览页里的改动记录渲染器 |
| npm release（`<= 0.1.4.x`） | ❌ 不可用——右栏 tab 体系（`ctx.sidebarRightTabs` / `openResource`）随 0.1.5 落地；旧宿主请停留在旧发布线 |

**版本线对照**：0.3.0 起要求宿主 `0.1.5-rc.1` 及以后；宿主 `0.1.2-rc.1` ~ `0.1.4.x` 的用户请停留在 0.2.x 发布线，宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 发布线（末版 `0.1.0`）。minHost 不动：npm 最新发布线仍是 0.1.5，双线的 0.1.5 臂完整保留。rc.1 线的手势对账（并入/让位清单）见 `package.json` 的 `dsh.compat.notes`。

## 已知限制

- **rc.1 的手势让位**——在文件夹打开 / 在 IDE 打开让位给官方 ui-open-in-app 的 document actions 贡献（组合里没有它时这两个手势消失，复制路径不受限）；**内容搜索不随无头模式并入**（rc.1 官方 document tab 自身没有内容搜索框——此项是净减，官方若日后补上即齐；0.1.5 自建页不受影响）；图片预览让位官方缩放查看器（avif 除外——官方未认领，仍走我们的面板）；超大文件不再是我们的截断提示而是官方文本渲染器的滚动分页（工具栏下拉切换即得）。
- **工作区外产物**——bash 写到会话工作区之外的文件：内容渲染双线照常（我们自己的 Remote read，官方工作区读覆盖不到的路径也能出内容）；官方 `file` 资源对这些地址不保证元数据，缺元数据时 rc.1 的 tab 没有官方变更检测/自动刷新（手动重载即可）。
- **仅当前会话**——只显示当前所选会话的文件，不是任意文件浏览器。
- **只读**——预览与改动记录永不修改文件；文件变更仍归会话所有。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

- `src/client/index.ts` —— apply：挂载 `filePreview` Remote 并执行零会话 `capabilities()` 握手；成功后由 `installFilePreviewSurfaces` 按宿主线注册 UI 面并统一卸载；turnTail 的 list 臂同时注册官方 deliverables 条目的遮蔽体
- `src/client/content-definition.ts` —— rc.1 内容渲染器的 id 与后缀清单（extension 档；avif 声明为二进制后缀）
- `src/client/FileContentBody.tsx` —— rc.1 内容渲染器本体：官方 document tab 里的共享内容面板（无头模式；`loading: 'renderer'` 自持加载，走本插件 Remote）
- `src/client/definition.tsx` —— 0.1.5 page-type tab 的注册表定义（guide 入口 + 地址认领）
- `src/client/artifacts-definition.ts` —— rc.1 `file-artifacts` 薄壳的注册表定义（page 类型，无地址认领）
- `src/client/FileArtifactsTab.tsx` —— rc.1「会话产物」薄列表壳：fold 清单 + 名称过滤 + 刷新，点行走官方 resource 路由
- `src/client/history-definition.ts` —— 改动记录渲染器的 id 与后缀清单
- `src/client/FilePreviewTab.tsx` —— 0.1.5 右栏「产物」页（列表 + 详情视图）
- `src/client/preview.ts` —— 适配层：`filePreview` wire kind → 内核 `PreviewRead`、字典适配（内容面来自 `@khorsheed/dsh-client-ui-content-preview`，本插件的私有渲染副本已删除）
- `src/client/FileHistoryBody.tsx` —— 官方 document tab 的可切换「改动记录」渲染器
- `src/client/DiffHistory.tsx` —— 逐次 write/edit diff 步进（本插件独有）
- `src/client/mentions-wrap.ts` —— mention 打开方向统一进右栏的就地包装（缝 S1 尾巴）
- `src/client/open-in-app.ts` —— 官方 open-in-app 探测（0.1.5 详情页行动作可见性）
- `src/client/TurnFileRow.tsx` —— 每回合的「N 个产物」卡片

纯增量插件，按宿主线二选一注册内容面（能力探测，永不读版本）：`ctx.get('documentPreviews')` 点探测在官方面已就位时直接跳过自建 tab；一个 pend 在 `inject: ['documentPreviews']` 上的嵌套插件在官方面晚到时注册 rc.1 的两个渲染器、file-artifacts 薄壳并退役自建 tab（cordis 只会唤醒声明了该服务的 fiber；cordis 4.0.4 的属性访问闸门禁止把未声明服务当属性读，而静态 inject 又会在 0.1.5 上把整包挂起——local-agent settings-scope 的延迟 inject 模式）。rc.1 注册：内容渲染器（extension 档、官方 document tab 的默认渲染器、无头模式、`loading: 'renderer'` 自持加载）+ 改动记录渲染器（`priority: 'builtin'`——收在预览页工具栏下拉里不抢默认），本体都进 keyed `sidebar.right.tab.document` seat；薄壳（page 类型进 `ctx.sidebarRightTabs`，本体进 keyed `sidebar.right.pane.tab` seat）；0.1.5 注册：一个右栏 tab 类型（`ctx.sidebarRightTabs` + keyed `sidebar.right.pane.tab` seat）。回合文件行双线一致（`conversation.chat.turnTail`——0.1.6-alpha.2 起该槽为 list 语义，本行另注册一条同官方 deliverables cell id、priority -1 的空体遮蔽官方 present/changes 卡——slot 系统一等遮蔽：同 cell 异优先级共存、最低者渲染，官方条目仍在册故其声明的 `deliverables.file.actions` 子槽不塌；0.1.5 宿主上该槽仍是 chain 选举，注册按探测回落为旧的 select + `priority: -1` 抢占形）。`filePreview` Remote 经 `ctx.remote.$mount` 自挂载——原版 dsh 核心零改动即可运行。该命名空间不声明为 inject（自挂载会让加载器死锁）；挂载被 await 后用 `ctx.get('remote.filePreview')` 读回，并先执行零会话 `capabilities()`；只有 `{ protocolVersion: 1 }` 成功返回才安装这些 UI 面，宿主缺席时全部缺席。文件列表由 `@khorsheed/dsh-file-preview` 在宿主侧折叠（含嵌套 Code Mode 派发与 bash 写入捕获）。回合卡片经按会话的客户端缓存读同一个宿主 `filePreview.turnFiles` RPC——卡片与各内容面同一事实源。

0.1.5-rc.1 迁移退役了四处绕行（上游缝 S1 已落地）：`conversation.view` 的「产物」tab、`shell.overlay` 预览抽屉、正文 mention 的捕获阶段 DOM 拦截、turnTail 的 `priority: -1` 抢占——产物行 / 正文 mention / 工具结果行的打开入口官方已统一收敛到 `ctx.sidebarRight.openResource()`。0.1.7-rc.1 迁移（方案 B，用户拍板 2026-09-24）：内容预览面从自建 FilePreviewTab 切到注册进官方 `documentPreviews` 面，0.1.5 保留自建 pane 双线；改动记录/会话产出维度（TurnFileRow、FileHistoryBody）官方无对应物（内存态、git-only、重启即失），维持自留并跟踪上游。产物面二期（同日拍板）：内容面板在官方 document tab 内改无头模式（消除与官方 chrome 的三重叠加；复制路径无官方等价物，留内容区右上角小按钮）；回合产物卡收敛——官方 present 卡/内存态 changes 卡由 list 槽遮蔽压下（用户决策：只留我们的持久全量卡）；「会话产物」入口以 file-artifacts 薄列表壳回归（壳不画内容，点行开官方 document tab）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/ui-file-preview`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
