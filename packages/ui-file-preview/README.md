# @khorsheed/dsh-client-ui-file-preview

[English](README.en.md) | 中文

agent 写过、改过的文件，不开 IDE 就能看到内容和每一次改动。

agent 干了半天活，到底动了哪些文件、改成了什么样？装了这个插件，会话顶部会多出一个「产物」tab：这个会话碰过的文件全列在里面，选中一个就在页面里直接预览——Markdown 渲染成文档、JSON 是检查树、CSV 是表格、图片直接显示，还能一页页回看每次 write/edit 的 diff。每个回合结束，对话里也会出现一张小卡片，汇总这一轮改了哪几个文件、各增删了多少行。数据由配套的宿主半 `@khorsheed/dsh-file-preview` 提供，两边一起装才有界面可看；宿主半不在时它只是空态，不会报错。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview3.png" width="640" alt="「产物」tab：左侧列出会话写过的全部文件，右侧预览选中文件的当前内容">

## 特性

- **产物 tab**——列出会话写入或编辑过的每个文件，按最近活动倒序，可切换到全部文件。
- **文档形态预览**——Markdown 渲染为文档，JSON/CSV 呈现为检查树/表格，HTML 提供源码 ⇄ 沙箱渲染切换，图片内联。
- **改动记录**——步进查看每一次 write/edit 的 diff，每条带所属轮次与步骤。
- **回合变更卡片**——每个已完成回合末尾出现可收起的「N 个文件已修改」卡片，逐文件列出行数增减。
- **就地抽屉**——预览在仅内容抽屉中打开，支持内容搜索；「复制路径」始终可用，部署可对接原生桌面时另有「在文件夹中打开」和「在 IDE 打开」。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview1.png" width="640" alt="回合末尾的「N 个文件已修改」卡片，以及点开产物后在右侧抽屉里查看文件内容，抽屉头部有复制路径、文件夹、IDE 按钮">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview2.png" width="640" alt="抽屉里的「改动记录」页签：逐轮翻看该文件的每一次 diff">

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

- npm 发布线（`@deepseek-ai/dsh@0.1.2-rc.1`）：⚠️ 降级——预览与折叠主体完整；external-open 按钮（打开目录 / 在 IDE 打开）在 0.1.2 上隐藏：host description 快照不再携带 `canOpenPath`（该能力已改为 RPC 探测），loopback 闸门无法确认；恢复是 follow-up，官方 seam 为 `remote.session.canOpenWorkspacePath` RPC。minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.2-rc.1；external-open 降级同上）

**版本线对照**：0.2.0 起支持宿主 `0.1.2-rc.1` 及以后；宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 发布线（末版 `0.1.0`）。

## 已知限制

- **仅文本预览** —— 二进制、超大、缺失文件只渲染带大小的分类提示，不渲染内容。
- **仅当前会话** —— 只显示当前所选会话的文件，不是任意文件浏览器。
- **只读** —— 预览永不修改；文件变更仍归会话所有。
- **mention 拦截是非官方的** —— 只有官方 mention 按钮会被改道，且依赖非官方 DOM 结构；核心改动该结构时，mention 点击会静默退回 OS 打开。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

- `src/client/index.ts` —— apply：注册视图/回合行/抽屉并挂载 `filePreview` Remote
- `src/client/FilePreviewView.tsx` —— 产物 tab（文件列表 + 预览区）
- `src/client/FilePreviewDrawer.tsx` —— 就地预览抽屉
- `src/client/TurnFileRow.tsx` —— 每回合的「N 个文件已修改」卡片
- `src/client/structured.tsx` —— 文档形态渲染器（markdown/JSON/CSV/HTML 沙箱）
- `src/client/mention-intercept.ts` —— 官方 mention 点击的捕获阶段改道

纯增量插件：注册一个会话视图（`conversation.view`）、一个回合文件行（`conversation.chat.turnTail`）、一个抽屉（`shell.overlay`），并通过 `ctx.remote.$mount` 自挂载 `filePreview` Remote——原版 dsh 核心零改动即可运行。该命名空间不声明为 inject（自挂载会让加载器死锁）；挂载被 await 之后用 `ctx.get('remote.filePreview')` 读回。文件列表由 `@khorsheed/dsh-file-preview` 在宿主侧折叠（含嵌套 Code Mode 派发）。数据单向流动：tab 激活/刷新时拉取 `filePreview.list`，选中时拉取 `filePreview.read`，过期的在途请求丢弃。回合卡片经按会话的客户端缓存读同一个宿主 `filePreview.turnFiles` RPC——卡片与 tab 同一事实源——并无条件认领每个回合，官方产出文件行永不挂载。

预览渲染：Markdown 走官方 `MarkdownText` 管线，缩放到预览专用的 14px（仅在预览范围内覆盖字体 token）；JSON 走官方 `JsonTree` 检查树；CSV/TSV 渲染为表格（首行作表头）；其余文本文件保持语法高亮的代码视图。HTML 文件提供源码 ⇄ 渲染切换：渲染视图是沙箱 iframe（空 `sandbox`——无脚本、无表单、无弹窗；相对资源无法解析），因为官方管线按设计把原始 HTML 当字面文本。内容搜索时任何文本切换为原始匹配行，命中始终可见。

抽屉手势：头部显示宿主解析后的绝对路径，「复制路径」始终可用；「在文件夹中打开」和「在 IDE 打开」走与官方行相同的 loopback + `canOpenPath` 门禁。「在文件夹中打开」以会话 cwd 为基准解析路径，打开所在文件夹并选中文件（Finder `open -R`、Explorer `explorer /select`，或支持选中的 Linux 文件管理器），失败时回退为打开父文件夹。官方正文 mention 由捕获阶段点击拦截器（识别 `code > button[title]` 结构）改道到抽屉，无法识别时放行回官方行为；两处改道都标注 `TODO(official-opener-seam)`，待核心提供文件打开覆盖点后退役。抽屉打开时会话区按抽屉宽度向左让位。与模型无关：本包不组装也不发送任何提供方请求（无 KV 缓存影响）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/ui-file-preview`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
