# Agent Note：内联 SVG 图活过白名单

Status: implemented

## Problem

`@khorsheed/dsh-capture`（[摄入提案](../../../proposals/active/2026-09-20-reader-ingest-capture-documents.md)的 M1，已合并）返回的是**渲染后**的页面：源站用脚本绘制的图——正是 capture 存在的意义——以**内联 SVG** 到达，计算样式内联在元素上。而阅读器提取器把 `svg` 整棵丢弃（`DROP_TAGS`），于是 capture 抓来的文章恰好丢掉这些图：渲染的钱付了，只剩一句图注。

## Decision

`extract-article.ts` 保留一个静态 SVG 子集（`normalizeSvg`，一个按元素走的 walker，通用归一化在 `<svg>` 处进入它）：

- **元素**：形状（`path, circle, ellipse, rect, line, polyline, polygon`）、文字（`text, tspan, textPath`）、结构（`svg, g, defs, symbol, use, marker`）、绘制（`clipPath, mask, pattern, linearGradient, radialGradient, stop`）与 `desc`。查找大小写不敏感、输出用规范大小写（HTML 解析器的外来内容调整表已经给好；输出字符串下游会再按 HTML 解析一次）。未知元素解包到子节点，与 HTML 路径一致。SVG 的 `<title>` 刻意不在列：它与 HTML `<title>` 在打分前剥离里撞名，而 `<desc>` 承载可达文字。
- **永远整棵丢弃**：`script`、`foreignObject`（SVG 里的 HTML 注射通道）、以及所有 SMIL 元素（`animate`、`animateMotion`、`animateTransform`、`set`）——静态图一概不需要，而动画是唯一贴事件的表面。
- **属性**：一张白名单——几何、呈现、capture 管线内联的 `style`（CSS 不可执行）、绘制/裁剪引用属性，以及 `id`（每个 `url(#…)`/`href="#…"` 都指向它）。任何含 `url(` 的值必须指向本文档片段，于是外部绘制服务、字体、追踪像素一概加载不了。`use`/`textPath` 只在 `href` 是片段（`#…`）时保留——外部引用把元素整个丢掉；旧式 `xlink:href` 归一为 `href`。
- **脚本图探针不变、而对这个形状现在诚实了**：`svg` 本来就在它的内容清单里，所以图被保留的 figure 不计数；真正空壳的运行时容器照旧计（提示继续说实话）。
- **不按元素设尺寸上限**：正文自己的机制（出网缝的上限、sidecar 阈值）约束整体标记；图表的 `<path>` 数据正是那个上限要约束的内容。
- 摘要保持干净：行内通道跳过 `svg` 子树（图表的 `<text>` 标签是图表铬件，不是散文），与 `object`/`noscript` 同例。

## Alternatives considered

**继续丢 svg，让 capture 把图栅格化成 PNG。** capture 的设计已经选了 SVG 优先（提案：栅格化是降级选项，且丢失可引用文字）；阅读器把收到的 SVG 丢掉，等于在下游悄悄否决那个决定。
**逐 SVG 标签的属性白名单**（path 给 d、circle 给 cx/cy/r……）。逐标签的精确对一张成员全是惰性几何/呈现值的全局表买不到什么，还会在图表换组合那天烂掉；危险属性（事件、外部引用）是全局表加值闸挡的，不靠逐标签表。
**保留 SMIL 动画。** 对静态快照是死重，且是 SVG 里唯一贴脚本的表面；丢弃。
**SVG 里的 `<image>`（外部栅格或 data URI）。** 不进 v1：SVG 里的外部栅格已由页面自己的 `<img>` 覆盖，而 data-URI 策略在那里的复用是没测过的表面。哪天真实 capture 出现图表内嵌栅格，它是第一个候选。

## Consequences

- capture 渲染的文章带着完整的图到达——颜色（渐变、内联样式、上游已解析的 CSS 变量）、裁剪、symbol 复用——而脚本图提示不再谎称它们缺席。
- 两个真实页面 fixture 与全部既有提取测试逐字节不变（它们不含 svg）；feed 正文路径（`normalizeRichText`）应用同一子集。
- 安全不变量仍由白名单陈述：无脚本、无事件、无外来 HTML、无外部引用——靠清单加值闸，不靠清洗通道。

## Testing

`packages/dsh-reader`（+3）：`tests/extract-article.spec.ts` 驱动 `tests/fixtures/capture-svg.html`（capture 形状的 figure：渐变、裁剪路径、symbol `<use>`、tspan、内联样式）——图表带着本文档片段引用完整存活；`script`/`foreignObject`/`onload`/`animate`/外部 `use`/外部 `url()` 全部钉死为不存在（带外部样式的 rect 保住其余属性）；`scriptFigures` 只计真正空壳的那一个；feed 正文路径同子集，行内摘要丢掉图表文字。
