# Agent Note: 内容搜索保留渲染后的文档

Status: implemented

[English](2026-09-17-rendered-content-search.md) | 中文

## Problem

两个预览 pane（`ui-file-preview` 的产物 pane、`local-files` 的工作区浏览器）都带一个会劫持视图的内容搜索：只要查询有命中，正文就被换成原始行视图——一个朴素的 `<pre>` 配逐行 `<mark>`。初衷是可见性（「命中绝不能看不见」），而且当时这是唯一便宜的做法：官方 `MarkdownText` 根本不接受高亮输入（只有 `text` / `streaming` / `labels` / `fileMentions` / `pathImages`），其管线禁用 raw HTML，`<mark>` 无法注入源码；`JsonTree` 渲染的是可折叠检查器，没有可回映射的源码行坐标。

代价在日常使用里显形（2026-09-17 截图）：markdown 源码不是用来阅读的——`**`、`###`、表格竖线满屏；JSON 树或 CSV 表退回原始文本；阅读位置丢失；在一行长行里定位命中变成体力活。用户自己的说法：搜索的时候…变成代码模式，有点难定位到关键字眼。

## Decision

**渲染后的正文留着，命中画在它上面。** `rendered-search.ts`（每个包一份——两个 pane 是有意的镜像，包之间不存在可共享的运行时包）在渲染子树上收集 `Range`，通过 **CSS Custom Highlight API**（`CSS.highlights.set(name, new Highlight(...))`）注册，由各 pane 的 module CSS 里 `::highlight()` 规则上色。React 拥有的东西一个都不改：没有 `<mark>` 包裹、没有协调风险，而且那个在 DOM 变化时重扫的 `MutationObserver` 永远观察不到自己的绘制（注册表只是绘制，不改 DOM）。

**原始行视图降级为兜底，不再是默认。** 有的查询只命中源码语法（`**`、`###`、围栏），或落在 JSON 树已折叠的节点里——这些没有可见 `Range`。hook 按查询报告可见命中数，只有量到的**零**才为该查询挂上兜底标记，下一个查询重新测量。两条调用方规则让它成立：查询未测量期间渲染正文必须保持挂载（它的 DOM 才是被扫描的东西——在未测量那一帧兜底，扫描的是*兜底*视图并为一个已经消失的正文锁定命中数，这是 pane 测试发现的），以及计数与跳转游标在渲染正文里读绘制出的出现次数、在原始视图里读命中行数。

**Chrome 不算正文。** 扫描跳过 `button` 下的文本（代码围栏的复制标签否则会被算作命中），格式横幅与截断通知带 `data-dsh-search-skip`。计数因此描述用户真正看得见的东西。

**HTML 预览继续走原始视图。** 它的渲染态是沙箱、opaque-origin 的 iframe：其文本不在这个 DOM 里，任何 Range 都够不着。其余每一种文本读取——markdown、JSON 树、CSV 表、纯代码视图——都走绘制路径，也就是说代码文件搜索时保留语法配色，不再掉到等宽纯文本。

**`::highlight()` 外面的 `:global()` 是承重的。** lightningcss 会像改写类名那样改写 `::highlight()` 的标识符——首次构建产出 `::highlight(HMaBaG_dsh-file-search-hits)`，而 JS 常量仍写着 `dsh-file-search-hits`，即静默不上色。把伪元素包进 `:global()` 让两侧都保持裸注册名；构建后 grep 一下产出的名字就是最便宜的检查。

**降级是静默的，不是致命的。** 没有该 API 时（任何非 Chromium 宿主、jsdom）`supportsRenderedSearch()` 为 false，两个 pane 的行为与从前完全一致：搜索显示原始命中行视图。

## Alternatives considered

### 为什么不把命中的文本节点包进 `<mark>`（经典页内查找做法）？

它改动 React 拥有的 DOM。Markdown、`JsonTree` 与 `CodeBlock` 按各自的节奏重渲染（流式围栏、树展开），React 按位置移除/替换文本节点——插在中间的元素会把一次例行更新变成「要移除的节点不是此节点的子节点」。Highlight API 用零所有权冲突换到同样的绘制；唯一代价是浏览器支持，而 Chromium 从 105 起就有。

### 为什么不给官方 `MarkdownText` 加一条高亮通道（一个包裹命中的 prop）？

那是对我们不拥有的包做上游改动，而且只覆盖 markdown：JSON 树、CSV 表、`CodeBlock` 各自还得再来一套。DOM 层的 Range 扫描一次覆盖所有渲染形态，这也是同一份代码能原样服务两个 pane 的原因。

### 为什么不把 `<mark>` 注入解析前的 markdown 源码？

官方管线按设计禁用 raw HTML（不可信内容），标记会以字面文本到达用户面前。为我们自己的预览松绑，是用共享渲染器存在的那个安全属性去换一个排版便利。

### 为什么不让原始视图继续当默认、只加「源码/渲染」切换？

那是更小的改动，但它没解决抱怨：渲染视图里查询根本没有任何可见命中，用户还是得来回切模式才能找到东西。2026-09-17 询问时用户明确选了绘制渲染态这条路。

### 为什么不让两个包共享一份实现？

包约定要求每个插件独立安装、独立运行；共享模块要么新增一个包（两边都多一个依赖），要么构成跨插件的仓内 import，而 `pnpm check:plugins` 会拒绝。两个 pane 本来就是有意的镜像（local-files 的文件头就是这么写的），重复的只是一个纯函数 + 一个 hook 的文件。

## Consequences

- `packages/local-files` 与 `packages/ui-file-preview` 各新增 `src/client/rendered-search.ts`，以及各一个 `tests/rendered-search.client.spec.tsx` 和一个 pane 级搜索 spec。
- `DetailPane.tsx` / `FilePreviewPane.tsx`：搜索状态现在推导出 `canPaint` / `painted` / `total` / `rawSearch`；`PreviewBody` 改收 `rawSearch` 而不再自己重算；格式横幅与截断通知带 `data-dsh-search-skip`；ui-file-preview 的 pane 为渲染正文新增 `contentRef`。
- `local-files/tsconfig.client.json` 列入新源文件（它用显式 `files` 清单，否则构建直接报错）。
- 计数在绘制模式下的单位变了：数的是可见出现次数，不再是命中源码行数（原始模式仍数行）。一行命中两次：绘制模式报 2，原始模式报 1。
- `::highlight()` 样式只支持 color / background-color / text-decoration / text-shadow——没有圆角与内边距，所以绘制出的命中比原始视图的 `<mark>` 观感略平；当前命中用更深的填充（`--dsw-static-deepseek-600`）加下划线区分。
- 绘制命中上限 2000 个 Range（计数不封顶），使大文件上的单字符查询不会去画几万个 Range。
- 未交付：沙箱 HTML 渲染的命中计数（结构上够不着），以及 `DiffHistory` 内的搜索。

## Testing

- `packages/local-files`：41 个测试全绿——新增 9 个 `rendered-search` 用例（扫描跳过 chrome/文本节点、在桩注册表下绘制/清除、无 API 分支、hook 的计数与兜底锁定），外加 4 个 `DetailPane` 用例，证明渲染 markdown 保持挂载且命中完成注册、`**` 回落到带 `<mark>` 的原始视图、无命中查询保留文档并显示无匹配标签、格式横幅不被算作命中。
- `packages/ui-file-preview`：107 个测试全绿——同样 9 个模块用例与同样 4 个 pane 用例，针对 `FilePreviewPane`。
- 两个包都构建通过（`tsc` + `tsdown`），产出的 client bundle 在其注入 CSS 里带的是裸名 `dsh-file-search-hits` / `dsh-file-search-active`。
- 未在 3080 浏览器里验证（部署按约定协调）：Highlight 的实际上色、当前命中的滚动、JSON 树展开后的重扫，都只在面层被覆盖。

## Related

- [file-preview 侧抽屉](2026-08-14-file-preview-side-drawer.md)（这个搜索所在的 pane 栈）。
- [local-files 独立插件](2026-08-28-local-files-standalone-plugin.md)（为什么两个 pane 是镜像而没有共享包）。
- [ui-file-preview 右栏 S1 退役](../architecture/2026-09-10-ui-file-preview-sidebar-right-s1-retirement.md)。
