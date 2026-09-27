# @khorsheed/dsh-client-ui-content-preview

[English](README.en.md) | 中文

> **已并入内部库，不再发布（2026-09-27）。** 本包是源码面共享内核，从未在运行时单独存在；自 0.1.1 后标记 `private: true`，不再发布新版本，npm 上的旧名 `@khorsheed/dsh-client-ui-content-preview` 已 deprecate。消费方（local-files / worktrees / file-preview）照旧经 `./src/*` 源码面内联它，任何功能演进都随消费方的版本发布。

三个文件预览面，一份「给我看文件内容」的实现——修一处，处处生效。

文件列表、工作树、会话产物页都需要同一块面板：markdown 渲染、JSON 树、CSV 表格、HTML 沙箱、内容搜索、复制路径/打开文件夹/在 IDE 中打开。这个包把整块内容面板抽成共享内核：`@khorsheed/dsh-local-files`、`@khorsheed/dsh-worktrees` 与 `@khorsheed/dsh-file-preview` 的预览区渲染的是同一份实现，一个 bug 只修一次。

**这不是插件。** 它不注册 slot、service、locale，没有自己的 loader row 和 client bundle——它在**源码面**被消费：各插件把它声明为依赖，直接 `import '@khorsheed/dsh-client-ui-content-preview/src/client/…'`，各自的 tsdown client bundle 把它内联进自己的 `lib/client.js`。零运行时耦合，各插件仍然各自可独立安装、独立卸载；把它自己装进 profile 不会挂载任何东西。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/content-preview-1.png" width="640" alt="共享内容面板在 local-files 插件里的实际样子:markdown 渲染态、内容搜索、预览/源码切换">

## 特性

- **kind 联合的内容分发**——一次读取归一化为 `PreviewRead`：`text`（含 `truncated` / `htmlScripted` 标记）/ `image` / `binary` / `missing`（带原因）/ `too-large` / `error`；内核持有契约，各插件把自己 Remote 的读取结果适配进来。
- **结构化预览**——JSON 走官方 `JsonTree`（可折叠、键盘可达；超 15 万字符如实回退代码视图）；CSV/TSV 经官方 `MarkdownText` 渲成 GFM 表格（超 500 行或 40 列回退）；markdown 走官方 `MarkdownText`，且**只覆盖 `--dsw-font-markdown-*` 字号 token、从不碰元素级 margin/padding**，排版节奏与官方文档页一致；其余文本按扩展名给 prism 语言，走官方 `CodeBlock` 高亮。
- **HTML 分级沙箱**——源码 / 渲染 / 脚本三态切换：Tier0 `sandbox=""` + 内嵌 meta CSP（默认；带脚本的页面在静态档下显示提示条）；Tier1 `sandbox="allow-scripts"` 且**永不同开** `allow-same-origin`，显式确认后才运行；CSP 钉死网络与导航，大文档用 `content-visibility` 延迟渲染，超大或带脚本文档有停滞看门狗提示，渲染可全屏。
- **能力桥**——Tier1 脚本唯一的对外通道：`window.dshBridge` 的 `openLink`（仅 https、noopener）/ `copy`（上限 1 MB）/ `download`（仅 data: URL）白名单；父页逐条校验消息来源、函数名与参数形状，异常一律回错误应答，绝不在宿主里抛。
- **渲染态内容搜索**——命中用 CSS Custom Highlight API 画在渲染后的文档上，不拆渲染态、不动 React 的 DOM；命中只在源码语法（`**`、围栏、折叠的 JSON 节点）里时如实降级回原始命中行视图；引擎不支持该 API 同样降级，绝不白屏。计数不设上限（绘制上限 2000 条），按钮与 banner 等 chrome 文本不计入命中。
- **面板 chrome**——返回、basename + 语言 chip、重新加载当前文件（调用方注入 `onReload` 才渲染，排在复制路径之前；进行中禁用并旋转图标）、复制路径、打开文件夹、在 IDE 中打开（按宿主 open-in-app 探测结果逐项显隐，多个 IDE 时渲染成分裂按钮）；滚动位置按 (session, path) 记忆；结构化渲染统一带格式 banner；diff/内容 视图切换由调用方以 render prop 接入。

**故意不做**：文件树、数据面（Remote / store / 根目录选择）、diff 与提交对比的实现（调用方以 render prop 传入）、tab 注册与可见性——那些是各插件自己的数据面与身份。

## 使用

```ts
import { ContentPane, buildSrcDoc, attachBridge, structuredPreview, useRenderedSearch } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
```

文案由调用方提供：内核不持有任何 locale 命名空间，所有字符串经调用方用自己字典构造的 `PreviewTranslator` 与 `StructuredLabels` 注入；`PREVIEW_KEYS` 常量实体化全部 key，消费方的包级测试断言每个 key 在自己的字典里可解析——缺 key 是测试失败，而不是中文 UI 里蹦英文。

## 安装

**不作为插件安装。** 它没有可挂载的行，`dsh plugin add` 它不会产生任何效果。它在构建期随消费它的插件一起到达——装下面任意一个（或几个）面，内核随它们的 client bundle 内联进去：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-files              # 工作区文件浏览
dsh plugin --profile web add @khorsheed/dsh-worktrees                # 工作树右栏
dsh plugin --profile web add @khorsheed/dsh-file-preview              # 会话产物页
```

重启 web 实例后生效。卸载其中任一个插件都不影响其余——内核已内联进各自的 bundle：

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-files
```

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——官方宿主面就是消费方本来就带的 peer 集：ui-primitives（`MarkdownText` / `JsonTree` / `CodeBlock` / 图标）与 ui-slots（label 类型），因此 minHost 跟随消费插件的 0.1.5-rc.1 右栏线。
- 源码线（deepseek-harness master）：✅（verifiedHost: `0.1.5-rc.1`）——源码面库不注册任何 slot / service / locale / row，也没有自己的 client bundle，兼容面等于它消费的那几个官方包的类型导出。

## 已知限制

- **不解析相对资源**——Tier0/Tier1 都在 `srcdoc` 沙箱里渲染，`base-uri 'none'` 下相对 `<link>` / `<script>` / 图片无法加载（2026-08-21 的既有裁决，见 `proposals/active/2026-08-21-file-view-html-rendering.md`）。官方文档 tab 的 HTML renderer 能经 Remote 打包相对依赖，那是它的能力，不回填到这里。
- **HTML 预览体不参与渲染态搜索**——渲染 iframe 是 opaque origin，其文本不在本 DOM 里；搜索 HTML 文件时使用原始命中行视图。
- **不是可复用渲染器的终局**——官方 `dsh-client-ui-sidebar-documentpreview` 已有 `ctx.documentPreviews` 注册表与 markdown/code/html/image/pdf 渲染器，但不导出可复用组件，且 `sidebar.right.tab.document` 是「声明即独占」的 keyed slot，插件自有 pane 装不进去。官方一旦开放可复用渲染面（或给第三方 pane 有渲染授权的 slot），本包退化为 adapter 并被删除——见 `proposals/active/2026-09-23-preview-kernel.md` §退休路径。
- **CSS 随消费方 bundle 走**——内核样式以 CSS Module 打进调用方 client bundle 的 `<style data-plugin>`；改内核样式只需重建消费方，不需要单独发布内核版本。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**架构。** 源码面库：没有 loader row、没有自己的 client bundle；消费方（local-files / worktrees / file-preview）把它声明为依赖，直接 import `@khorsheed/dsh-client-ui-content-preview/src/client/*`，tsdown 把内核内联进各自的 `lib/client.js`——运行时零耦合，装、卸任一面互不影响。包根入口（`src/index.ts`）只为类型检查与工具解析存在，host 进程从不运行它。内核不 import 任何消费方的 wire 类型：每个面把自己的读取结果适配进 `PreviewRead` 联合（local-files 直接折叠它的 kind 联合，worktrees 映射 `ReadFileResult` / `LocalImageResult`，已删除或不可读的文件经 `missing.reason` 上报）。

**契约面。** `ContentPane` 的 props 即全部交互：`read` / `loading` / `error` 数据面由调用方的 Remote 供；chrome 手势（`openFolder` / `openIDE` / `ideChoices`）与 `onCopyPath` / `onReload` / `onBack` 逐个可选，缺了就不渲染对应按钮；`diffView` + `view` + `onViewChange` 让调用方接入 diff/内容 切换；`imageView` 可替换图片体（worktrees 的缩放查看器）；`notice` 让调用方插自己的横幅（worktrees 的未跟踪文件提示）；`sessionId` 给滚动记忆分命名空间。读数固定在 commit 上的面（不会变陈旧）直接不传 `onReload`，重载按钮就不存在。

**HTML 沙箱。** `buildSrcDoc` 保证 CSP 一定在文档里：父 web shell 自己没有 CSP，srcdoc iframe 又不是 HTTP 响应，继承靠不住——fragment 被包成完整文档，完整文档在自己的 `<head>` 后注入（已声明 CSP 的不重复注入）。Tier0 空沙箱 + CSP 仅作纵深防御；Tier1 放脚本但 CSP 钉死网络与导航（`default-src 'none'`、`connect-src 'none'`、script 仅 inline + cdn.jsdelivr.net、img 仅 data:/blob:、worker 仅 blob:），`allow-same-origin` 永不同开——opaque origin 是脚本碰不到宿主的根本。能力桥是 Tier1 唯一出口：文档内注入 `window.dshBridge`（postMessage 客户端），父页 `attachBridge` 校验 `message.source` 必须是受控 iframe 的 window、fn 必须在白名单、参数逐个验形状；handler 抛错被转成 error reply，绝不在宿主里炸。

**搜索。** 第一版搜索一命中就把渲染态换成原始行 `<pre>`——markdown 的 `**` / 表格管线、JSON 树全塌回文本。现在命中画在渲染态上：CSS Custom Highlight API 注册 Range，浏览器经 `::highlight()` 绘制，React 的 DOM 一根手指都不碰，MutationObserver 也观察不到自己的绘制（不会无限重扫）。按钮文案、banner 等 chrome 文本经 tag 黑名单与 `data-dsh-search-skip` 排除在扫描外。查询只命中源码语法或折叠的 JSON 节点时，渲染态里根本没有可见 Range——如实回到原始行视图，命中在原始行里按构造可见。跳转只滚动面板自己的 scrollport（Range 没有 scrollIntoView，元素级 API 会带动整个 shell）。

**open-in-app。** 镜像官方 shared 模块的路由常量与 wire payload（client bundle 纯度闸禁止值导入 host 包；镜像常量在宿主路由搬家时降级为「手势隐藏」而非 boot 失败）。每页一次 GET `/open-in-app/apps`，结果发布为 snapshot store；404 或网络失败即空列表，手势静默隐藏——与官方头部分裂按钮同款降级。打开动作 POST `/open-in-app/open`。

**导出。** 包根（`src/index.ts`）re-export client 桶，仅供类型解析；消费走 `./src/*` 子路径（`@khorsheed/dsh-client-ui-content-preview/src/client/index.ts`）。测试按模块分文件：html-src-doc / html-bridge / structured / rendered-search / open-in-app / content-pane。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/ui-content-preview`）。问题与贡献请移步该仓库。
