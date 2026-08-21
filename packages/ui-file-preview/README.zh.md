# @khorsheed/dsh-client-ui-file-preview

[English](README.md) | 中文

dsh web GUI 的会话文件预览面，完全基于官方扩展点构建：对话视图环里的"产物"tab（与对话、轨迹并列）列出当前会话写入或编辑过的文件，选中即可在页面内预览——当前内容、完整改动记录、图片内联——无需打开 IDE。

<img src="docs/screenshots/05-file-preview-tab.png" width="480" alt="产物 tab 列出会话写入的文件">

<img src="docs/screenshots/06-file-preview.png" width="480" alt="以文档形态预览 markdown 文件">

## 特性

- **产物 tab**——对话视图环里的 `'file-preview'` tab（标签为"产物"）列出会话写入或编辑过的每个文件，按最近活动倒序，默认只显示产物、可切换到全部。
- **文档形态预览**——Markdown 走与聊天区同一渲染管线，JSON 走可折叠的 `JsonTree` 检查树，CSV/TSV 渲染为表格，HTML 提供源码 ⇄ 沙箱渲染切换，图片直接内联；其余文本文件保持语法高亮的代码视图。
- **改动记录**——第二个 tab 步进查看每一次 write/edit 的 diff，每条带所属轮次与步骤。
- **回合变更卡片**——每个已完成的回合末尾出现一张可收起的"N 个文件已修改"卡片，逐文件列出行数增减。
- **就地抽屉 + 宿主手势**——点击文件打开仅内容抽屉（不切换会话视图），"复制路径"任何环境可用；部署可以把路径交给原生桌面时再提供"在文件夹中打开"和"在 IDE 打开"。
- **内容搜索**——搜索框在任何文本预览里高亮匹配并逐个跳转。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview
```

然后重启 web 实例。卸载即干净移除：

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-ui-file-preview
```

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.1`）：✅ 完整——rc.8→0.1.1-rc.1 API 审计（2026-08-21）确认本插件消费的所有面无变化或纯增量（ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包），无需改动源码。
- 源码线(deepseek-harness master):✅

## 已知限制

- **仅文本预览** —— 二进制、超大、缺失文件只渲染带大小的分类提示，不渲染内容。
- **仅当前会话** —— 视图只显示当前所选会话的文件；不浏览磁盘上的任意文件。
- **只读** —— 预览永不修改；文件变更仍归会话所有。
- **回合卡片范围** —— 变更卡片列出每个已完成回合新建/编辑过的文件，外加官方 deliverables 折叠报告的产出文件（行数增减只在工具的 diff 调用视图报告了先前行内容时显示），文件行超上限时折叠收起；文件 tab 同样是只列产物的口径（read 不出现）。
- **mention 拦截是非官方的** —— 正文里任意的文件路径不会被拦截（只有官方 mention 按钮会被拦截，而拦截器跟踪的是非官方 DOM 结构——核心改动该结构时，mention 点击会静默退回 OS 打开）。目录分组与从 bash/正文中启发式提取路径留待后续。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

纯增量的浏览器插件：注册一个会话视图（`conversation.view`）、一个回合文件行（`conversation.chat.turnTail`）和一个抽屉（`shell.overlay`），并通过 `ctx.remote.$mount` 挂载自己的 `filePreview` Remote——原版 dsh 核心零改动即可运行，取消组合时干净移除。文件列表由 `@khorsheed/dsh-file-preview` 在宿主侧折叠（含嵌套 Code Mode 派发）。由于插件既挂载 `filePreview` 命名空间又消费它，命名空间不声明为 inject（那会让加载器死锁——该服务只有本 apply 的 `$mount` 运行后才会出现）；挂载被 await 之后，用 `ctx.get('remote.filePreview')` 从全局服务 store 读回命名空间。

数据单向流动：视图在每次 tab 激活时及刷新时拉取 `filePreview.list`；选中一行按路径拉取 `filePreview.read`；抽屉打开时两者都拉取。整值落入会话的 store，选择移动或表面卸载时过期的在途请求会被丢弃。tab 与抽屉各自独立于页面滚动；diff 行通过本插件自己的 CSS 软换行（共享的 `DiffBlock` 保持不动）。

回合卡片读宿主 `filePreview.turnFiles` RPC——与产物 tab **同一个**单一事实源（write/edit 调用、Code Mode 派发、result diff meta 的 render-intent 路径、bash 捕获都落在那里），经客户端按会话缓存只拉取一次——卡片与 tab 结构性不可能分叉。卡片无条件认领每个回合（数据未到或回合无文件时渲染为空），官方产出文件行永不挂载；旧的客户端 write/edit-only 折叠与官方 deliverables 并集随之退役。

预览渲染：文本预览按文件类型渲染其文档形态，且都放在与代码/diff 视图同一套块级外框里（圆角 code-block 表面 + 顶部小格式标签）。Markdown 走官方 `MarkdownText` 管线，并缩放到适合预览的 14px 正文（聊天的 16px 在面板里偏大，插件仅在预览范围内覆盖 markdown 字体 token）；JSON 在可解析时走官方 `JsonTree` 检查树；CSV/TSV 渲染为表格（同样走 markdown 管线，首行作表头）。HTML 文件提供源码 ⇄ 渲染切换：渲染视图是沙箱 iframe（空 `sandbox`——无脚本、无表单、无弹窗；CSS 与图片可渲染，相对资源因无文件基准无法解析），因为官方管线按设计把原始 HTML 当字面文本，官方"完整渲染 HTML"的方式是在浏览器里打开（宿主打开器把 `.html` 归为浏览器文档——即头部"在 IDE 打开"手势）。内容搜索时任何文本都切换为原始匹配行，命中始终可见。

抽屉头部显示该文件在宿主侧解析后的绝对路径，并提供"复制路径"（浏览器剪贴板，任何环境都可用），在部署可以把路径交给原生桌面时（loopback + `canOpenPath`，与官方行同一道门禁）再提供"在文件夹中打开"和"在 IDE 打开"两个宿主手势；文件视图 tab 在预览区上方复刻同一头部，两个表面读起来一致。"在文件夹中打开"通过宿主半边的 `filePreview.reveal` Remote 方法定位文件：宿主以会话 cwd 为基准解析路径，打开文件所在文件夹并选中该文件（Finder `open -R`、Explorer `explorer /select`，或支持选中的 Linux 文件管理器）；文件已不存在或没有可用的文件管理器时，回退为打开父文件夹。官方正文 mention 也被同样改道：一个 document 捕获阶段的点击拦截器（`mention-intercept.ts`）识别其 `code > button[title]` 结构并打开抽屉而不是宿主 OS，对任何无法识别的目标保持放行（退回官方行为）；其他位置的文件链接维持宿主 OS 打开（核心没有供第三方拦截任意链接的钩子）。两处改道都标注了 `TODO(official-opener-seam)`，待核心提供文件打开覆盖点后退役。抽屉打开时会话（滚动区与聊天框）会按抽屉宽度向左让位，聊天内容不会被盖住。

模型体验：无——视图在浏览器中渲染宿主计算出的文件数据；本包不触及任何模型请求，既不组装也不发送提供方请求（无 KV 缓存影响）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/ui-file-preview`）。问题与贡献请移步该仓库。
