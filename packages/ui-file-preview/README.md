# @khorsheed/dsh-client-ui-file-preview

[English](README.en.md) | 中文

agent 写过、改过的文件，收进右栏一个「产物」页：文件清单 + 每一次改动的 diff 步进。

agent 干了半天活，到底动了哪些文件、改成了什么样？装了这个插件，右栏向导页会多出「会话产物」入口：这个会话碰过的文件按最近活动倒序列出；点一个进入详情页——面包屑路径 + 复制路径 / 在文件夹打开 / 在 IDE 打开，下方「内容 / 改动记录」切换：内容是文档形态预览（Markdown 渲染成文档、JSON 检查树、CSV 表格、HTML 沙箱渲染、代码高亮、内容搜索），改动记录逐次步进回看每一次 write/edit 的 diff。官方文档预览页的工具栏下拉里也有同一个「改动记录」实现可切。所有打开入口——正文 mention、官方产物卡片、文件树——对产物文件都落到我们的详情页（tab 类型认领 `dsh-resource://file/**` 中 fold 记录过且可渲染的文件；认领不到时回退官方 document tab）。每个回合结束，对话里也会出现一张小卡片，汇总这一轮改了哪几个文件、各增删了多少行。数据由配套的宿主半 `@khorsheed/dsh-file-preview` 提供（含官方数据覆盖不到的 bash 写入捕获），两边一起装才有界面可看；宿主半不在时它只是空态，不会报错。

## 特性

- **右栏「产物」页**——page-type 右栏 tab（向导页进入）：会话写入或编辑过的每个文件，按最近活动倒序，可搜索；点行进入详情页。
- **详情页**——面包屑路径头 + 行动作（复制路径恒定可用；宿主探测到对应应用时另有「在文件夹中打开」= 文件管理器选中该文件、「在 IDE 打开」= 文件级精确打开）；「内容 / 改动记录」切换——内容是文档形态预览（Markdown/JSON/CSV/HTML 沙箱/代码高亮 + 内容搜索），改动记录逐次步进每一次 write/edit 的 diff。
- **工作区外产物同等待遇**——bash 写到工作区外的文件在我们自己的详情页里内容和改动记录都照常可看。
- **官方预览页里的改动记录**——官方 document tab 工具栏下拉可选「改动记录」渲染器；正文 mention 点击仍走官方快速预览。
- **回合变更卡片**——每个已完成回合末尾出现可收起的「N 个文件已修改」卡片（含 bash 捕获，比官方产物行数据全），逐文件列出行数增减；点击工作区内文件走官方打开路由，工作区外的产物打开右栏「产物」页并选中该文件的改动记录。

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
| npm release（`>= 0.1.5-rc.1`） | ✅ 完整（`verifiedHost: 0.1.5-rc.1`） |
| npm release（`<= 0.1.4.x`） | ❌ 不可用——右栏 tab 体系（`ctx.sidebarRightTabs` / `openResource`）随 0.1.5 落地；旧宿主请停留在旧发布线 |

**版本线对照**：0.3.0 起要求宿主 `0.1.5-rc.1` 及以后；宿主 `0.1.2-rc.1` ~ `0.1.4.x` 的用户请停留在 0.2.x 发布线，宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 发布线（末版 `0.1.0`）。

## 已知限制

- **工作区外产物不进官方路由**——bash 写到会话工作区之外的文件造不出 `dsh-resource://file/...` 地址（官方 `file` 资源限定工作区内），列表行带提示标记；但我们自己的详情页不受此限——内容与改动记录照常可看。
- **仅当前会话**——只显示当前所选会话的文件，不是任意文件浏览器。
- **只读**——预览与改动记录永不修改文件；文件变更仍归会话所有。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

- `src/client/index.ts` —— apply：注册 tab 类型 / tab body / 改动记录渲染器 / 回合行并挂载 `filePreview` Remote
- `src/client/definition.tsx` —— page-type tab 的注册表定义（guide 入口，不认领地址）
- `src/client/history-definition.ts` —— 改动记录渲染器的 id 与后缀清单
- `src/client/FilePreviewTab.tsx` —— 右栏「产物」页（列表 + 详情视图）
- `src/client/FilePreviewPane.tsx` —— 详情页预览栈（内容搜索 / Markdown / JSON / CSV / HTML 沙箱 + 改动记录切换）
- `src/client/structured.tsx` / `html-bridge.ts` / `html-src-doc.ts` —— 文档形态渲染器与 HTML 沙箱
- `src/client/FileHistoryBody.tsx` —— 官方 document tab 的可切换「改动记录」渲染器
- `src/client/DiffHistory.tsx` —— 逐次 write/edit diff 步进（本插件独有）
- `src/client/mentions-wrap.ts` —— mention 打开方向统一进右栏的就地包装（缝 S1 尾巴）
- `src/client/open-in-app.ts` —— 官方 open-in-app 探测（行动作可见性）
- `src/client/TurnFileRow.tsx` —— 每回合的「N 个文件已修改」卡片

纯增量插件：注册一个右栏 tab 类型（`ctx.sidebarRightTabs` + keyed `sidebar.right.pane.tab` seat）、一个文档渲染器实现（`ctx.documentPreviews` + keyed `sidebar.right.tab.document` seat，`priority: 'builtin'`——出现在预览页工具栏下拉里但不抢官方默认渲染）与一个回合文件行（`conversation.chat.turnTail`，默认优先级——官方产物行先选举，本卡片只出现在官方数据覆盖不到的回合），并通过 `ctx.remote.$mount` 自挂载 `filePreview` Remote——原版 dsh 核心零改动即可运行。该命名空间不声明为 inject（自挂载会让加载器死锁）；挂载被 await 之后用 `ctx.get('remote.filePreview')` 读回。文件列表由 `@khorsheed/dsh-file-preview` 在宿主侧折叠（含嵌套 Code Mode 派发与 bash 写入捕获）。回合卡片经按会话的客户端缓存读同一个宿主 `filePreview.turnFiles` RPC——卡片与 tab 同一事实源。

0.1.5-rc.1 迁移退役了四处绕行（上游缝 S1 已落地）：`conversation.view` 的「产物」tab、`shell.overlay` 预览抽屉、正文 mention 的捕获阶段 DOM 拦截、turnTail 的 `priority: -1` 抢占——产物行 / 正文 mention / 工具结果行的打开入口官方已统一收敛到 `ctx.sidebarRight.openResource()`。内容预览整体交给官方 document tab（`dsh-resource://file/**` 由官方 `text` 类型认领）；改动记录官方无对应物，长期自留。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/ui-file-preview`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
