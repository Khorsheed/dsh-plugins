# @khorsheed/dsh-client-ui-content-preview

[English](README.en.md) | 中文

社区文件预览面的共享内容内核：文件列表（`@khorsheed/dsh-local-files`）、工作树（`@khorsheed/dsh-worktrees`）的右侧预览区与 ui-file-preview 的内容面渲染的是**同一份实现**，一处修复处处生效。

这不是插件。它不注册 slot、service、locale，也没有自己的 loader row 和 client bundle——它在**源码面**被消费：各插件把它声明为 workspace 依赖，直接 `import '@khorsheed/dsh-client-ui-content-preview/src/client/…'`，各自的 tsdown client bundle 把它内联进 `lib/client.js`。因此它零运行时耦合，各插件仍然各自可独立安装、独立卸载。

## 提供什么

| 能力 | 说明 |
|---|---|
| 内容分发（kind 联合） | `text`（含 `truncated` / `htmlScripted`）/ `image` / `binary` / `missing` / `too-large` / `error`；内核定义契约，各插件把自己 Remote 的形状适配进来 |
| HTML 分级沙箱 | Tier0 `sandbox=""` + 内嵌 meta CSP（默认）；Tier1 `sandbox="allow-scripts"` 且**永不同开** `allow-same-origin`，需显式确认；含 `content-visibility` 大文档延迟、`<script>` 探测提示条、能力桥（`openLink`/`copy`/`download` 白名单 + `message.source` 校验） |
| 内容搜索 | 保留渲染态，用 CSS Custom Highlight API 画命中；命中只在源码语法里（`**`、围栏、折叠的 JSON 节点）时如实降级到原始行视图；不支持该 API 的引擎同样降级，不白屏 |
| Markdown / JSON / CSV | 走官方 `MarkdownText` / `JsonTree`；**只覆盖 `--dsw-font-markdown-*` 字号 token，不覆盖任何元素级 margin/padding**，所以节奏与官方文档一致 |
| 面板 chrome | 重新加载当前文件（调用方注入 `onReload` 才渲染，排在复制路径之前；进行中禁用并旋转图标）/ 复制路径 / 打开目录 / 在 IDE 中打开（按宿主 open-in-app 探测结果逐项显隐）、滚动位置记忆、格式 banner |

**不**负责：文件树、数据面（Remote / store / 根目录选择）、diff 与提交对比（由调用方以 render prop 传入）、tab 注册与可见性——那些是各插件自己的数据面与身份。

## 使用

```ts
import { buildSrcDoc, attachBridge, structuredPreview, useRenderedSearch } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
```

localized 文案由调用方提供：内核不持有任何 locale 命名空间，它接收调用方用自己字典构造的 `StructuredLabels` / `PreviewLabels` 对象。

## 安装

**不作为插件安装。** 它随依赖它的插件一起工作在构建期：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-files
dsh plugin --profile web add @khorsheed/dsh-worktrees
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview
```

卸载其中任一个插件都不影响其余——内核被内联进了各自的 client bundle。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——peer 面就是消费方本来就带的 `ui-primitives`（`MarkdownText`/`JsonTree`/`CodeBlock`/图标）与 `ui-slots`（label 类型），因此 minHost 与两个消费插件的右栏线一致（`0.1.5-rc.1`）。
- 源码线（deepseek-harness master）：✅（verifiedHost: `0.1.5-rc.1`）

## 已知限制

- **不解析相对资源**：Tier0/Tier1 都在 `srcdoc` 沙箱里渲染，`base-uri 'none'` 下相对 `<link>`/`<script>`/图片无法加载（这是 2026-08-21 的既有裁决，见 `proposals/active/2026-08-21-file-view-html-rendering.md`）。官方文档 tab 的 HTML renderer 能经 Remote 打包相对依赖，那是它的能力，不回填到这里。
- **不是可复用渲染器的终局**：官方 `dsh-client-ui-sidebar-documentpreview` 已有 `ctx.documentPreviews` 注册表与 markdown/code/html/image/pdf 渲染器，但不导出可复用组件，且 `sidebar.right.tab.document` 是「声明即独占」的 keyed slot，插件自有 pane 装不进去。官方一旦开放可复用渲染面，本包退化为 adapter 并被删除——见 `proposals/active/2026-09-23-preview-kernel.md` §退休路径。
- **CSS 变化会随消费方 bundle 走**：内核的样式以 CSS Module 形式被打进调用方 client bundle 的 `<style data-plugin>` 标签，改动内核样式只需重建消费方，不需要单独发布内核版本。
