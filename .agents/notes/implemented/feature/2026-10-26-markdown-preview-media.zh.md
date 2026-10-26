# Agent Note: Markdown 预览里的图片与本地链接

Status: implemented

## Problem

几个文件面板的 Markdown 预览把 README 里的截图显示成原始文字：`<img src="…" width="640">` 原样打印，`<p align="center">` 也一样。本地图片（`![](docs/shot.png)`）只显示说明文字，本地链接（`[English](README.en.md)`）也只是普通文字。这几个面板最常打开的就是 README，渲染出来的页面恰好丢掉了最值得看的部分。

## Decision

共享内容面板只在预览面把这三件事补上，源码面和编辑器保留文件原文。

- **HTML 媒体转成 Markdown**（`markdown-media.ts` 的 `rewriteHtmlMedia`）：解析之前，先把 `<img>` 改写成 `![alt](src)`。`<a href>` 如果里面只剩 Markdown，就改成 Markdown 链接，带链接的图片因此仍然可以点。对齐用的外层标签 `<p>`、`<div>`、`<center>`、`<picture>`、`<source>` 直接去掉；只剩标签的行顶格输出，免得 HTML 的缩进变成缩进代码块。多行 `<a>` 单独占一行的开闭标签也去掉，中间的图片照样显示。代码里的内容一律不动：围栏代码块、缩进代码块和行内代码原样保留，所以讲解 `<img>` 写法的 README 依然显示标签本身。其他标签照官方渲染器的设计原样显示。
- **本地图片**：`ContentPaneProps.resolveImage(path) => Promise<url | undefined>`，其中 `path` 是按文档所在目录、在该面板自己的路径空间里解析出的路径（`resolveDocPath`）。`MarkdownDocument` 给官方渲染器一个 `pathImages` 解析器。某个路径第一次被问到时，在渲染之外发起面板的读取，并先回答「还没有」，这时显示说明文字。结果存进按（文档路径，读取内容）分组的缓存：重新载入会重读图片，编辑草稿时的每次按键和面板每次渲染新建的闭包都不会。
- **本地链接**：`ContentPaneProps.onOpenFile(path, { line })`，经官方 `MarkdownDelegateProvider.openFile` 接入。
- **图片加载失败要说出来**（`linkFailedImages`）：没能加载的图片会变成一行指向它自己地址的「⚠ 图片加载失败：说明」链接，不再悄悄显示成说明文字。覆盖三种情况：浏览器连不上的远程地址（在文档容器上用捕获阶段的 `error` 监听拿到），面板读不到的本地文件（缓存里记为 `null`），以及浏览器解不了码的本地图片。远程链接在新标签打开，用户能看出是不是网络问题；本地链接在面板里打开那个文件。链接里的图片（比如徽章）改成那个链接的文字，因为链接不能嵌套。代码里的内容一律不动。官方渲染器自带的失败提示是纯文字，而且只有传了 `fileImages` 才显示，所以由内核把失败的图片重新写成渲染器本来就会画的 Markdown。
- **各面板**：
  - local-files 用 `readFile` 读图（返回 data URL），点链接就选中那个文件。
  - worktrees 用 `readRepoImage` 读仓库相对路径的图片，但提交的历史内容不读图，否则会拿今天工作树里的截图冒充历史。点链接沿用当前的 segment（提交里的 README 打开的是同一提交时的相邻文件），并落在内容视图；绝对路径不处理。
  - file-preview 的 `read` 本来就会对图片路径返回它的图片地址，由面板转成绝对地址。点链接时先按列表里记录的写法去匹配，agent 改过的文件因此仍带改动记录。
- **旧宿主**：`ui-primitives` 是平台模块，运行时用的是宿主自带的那一份。`MarkdownDelegateProvider`（2026-09 加入）先探测是否存在，缺失就不包，本地链接保持纯文字。`pathImages`（2026-09 加入）只是一个属性，旧版 `MarkdownText` 会直接忽略。

## Alternatives considered

**解析 HTML（rehype-raw 加净化器）**：否决。官方渲染器刻意不让 HTML 进入处理流程，而内核是借这个组件渲染、并不自己维护渲染器。对一个封闭的标签集合做文本改写，安全性不变：它产出的全是渲染器本来就会净化的 Markdown。

**由各面板在渲染前把图片解析好**：否决。那样每个面板都得自己解析 Markdown 来找图片地址。直接响应渲染器自己的 `pathImages` 回调，哪些算图片由渲染器决定（引用式图片也算在内），内核只负责缓存。

**worktrees 在提交内容里显示工作树的图片**：否决。历史版本的 README 会悄悄显示今天的截图。显示说明文字才不会误导。

## Consequences

- 常见情况下 README 的效果和在 GitHub 上一样：居中截图、带链接的徽章、相对路径截图、语言切换链接。
- `<img>` 的 `width`/`height` 会丢失，图片按面板宽度显示。
- 带非行号锚点（`#section`）的链接保持纯文字（官方的链接解析会拒绝它们），不支持页内锚点跳转。
- 这个集合以外的 HTML（`<details>`、`<br>`、`<table>`）照旧原样显示。
- 远程图片能不能加载取决于看页面那台浏览器的网络，而不是宿主的网络：代理只配在终端环境变量里的机器上，浏览器会直连，`raw.githubusercontent.com` 就会失败。失败链接把这种情况显示出来，不会再像是作者写的一行说明。
