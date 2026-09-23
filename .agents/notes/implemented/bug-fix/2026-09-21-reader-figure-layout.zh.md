# Agent Note：组合图的容器就是它的内容

Status: implemented

## Problem

3199 上实测：capture 抓了 transformer-circuits.pub/2026/workspace——它的 Figure 2 是 HTML+CSS 组合体（左边一张 SVG 图，右边三张由带样式 div 搭出来的属性卡）。阅读器存下的正文里（真实 capture 产物的提取后形态，3.6 MB），三张卡读成一段连起来的字——`Intermediate processing stageJ-space carries workspace-like content only at intermediate depthsLimited capacity…`——读者的话是「一个图被抓成三个图」。提取器的两个行为合成了这个结果：`normalizeNode` 解包非白名单容器时**不留任何边界**，而 capture 的序列化（outerHTML）不带标签间空白，于是相邻卡片的文字粘连；而图内部容器上的 `style` 全被剥掉，让它们成为「卡片」的版式也就没了。对文章散文这套行为没问题；对 capture 渲染的组合图是破坏性的。

## Decision

两半都在 `client/extract-article.ts`：

- **在 `<figure>` 里，结构保留。** 图作用域归一化（递归携带 `inFigure`，只有 figure 的后代在其中）把 `div`/`span` 保留为真元素，各自的 `style` 过属性**白名单**——只有版式与绘制：display、position（值闸只许 static/relative/absolute）、inset 偏移、flex/grid 家族、尺寸（width/height/max-/min-）、margin/padding、gap、color/background、border 家族、overflow、font/文字度量、transform、opacity、visibility，以及 ≤5 的 z-index。即便属性在白名单里，值闸照剥：不是同文档 `#片段` 的 `url(…)`（复用 SVG walker 的闸）、`javascript:`、`expression(`、`behavior`。留下来的容器若文字与样式两空，则按空壳丢弃。figure 之外，解包的形状不变——接着往下看。
- **解包留下词边界，处处如此。** 解包的块级容器（div/section/article/main/details/summary/hgroup/fieldset/center，及任何自定义元素）在子内容两侧吐出 `\n`：capture 的序列化不带标签间空白，这个边界让两个相邻兄弟永远读不成一个词。行内的未知元素保持旧的贴身行为。行内摘要通道同例（被摊平的块留一个尾随空格）。两个公共边缘（`normalizeElement`、`normalizeRichText`）把死边界换行裁掉，边缘字节与从前一致。
- **脚本图计数器学会组合体形状**：figure 没有画面元素、但除图注外自己有足够文字（折叠后 ≥ 20 字符）就**是**内容——不计数。真正的空壳（空宿主 div 加一句图注）照旧计，提示继续说实话。

## Alternatives considered

**在 capture 侧把组合图栅格化（嵌 PNG 截图）。** 观感最准，但文字死了：图里的文字必须保持可引用、可翻译（正文是应用级 DOM 的全部理由），而栅格化在 capture 设计里本来就是记录在案的降级选项、不是 v1。若哪天来了标记子集承载不了的组合体，它是备用的退路。
**figure 里保留全部样式。** 原始 `style` 会把 `position: fixed`、`z-index: 9999`、外部 `url()` 与带脚本的遗留属性带进阅读器的铬件——白名单正是「图的版式」与「页面的遮罩」之间的那条线。
**所有解包都给块级分隔（div 成真块但不带样式）。** 一个中间方案，为一个空白问题改变每个页面的 DOM 形状；换行边界是最小的保真修复，图作用域的结构保留是版式的那半。
**只在 figure 里加边界。** 实锤发生在图里，但同样的粘连对任何无空白序列化都存在——边界做成全局，正因为它便宜且对散文无害（渲染时空白折叠）。

## Consequences

- 组合图读作它的三张卡、带版式（flex 行、卡片盒、字级排印），而每个页面被解包的容器不再粘连——纯文字保真修复，边缘字节不变。
- 既有提取测试与两个真实页面 fixture 内容不变（仅有的两处期望更新是两个行内摘要边界钉，理由就地注明）。
- 保留的带样式 div 落在正文普通流里渲染（`.article` CSS 不需要新东西：div 是块、span 行内）；一张全是色块没有文字的图仍按脚本绘制计——接受的边角，因为 capture 的空壳也带内联样式，文字是唯一能区分的信号。

## Testing

`packages/dsh-reader`（+5，先红）：`tests/extract-article.spec.ts` 驱动 `tests/fixtures/capture-composite-figure.html`——由存下的 capture 正文重建的 Figure 2 组合体，三张卡是原文逐字文本，且该区域按 outerHTML 到达的样子序列化为**无标签间空白**（这正是让红诚实的地方：改动前的代码粘出 `stageJ-space`）。卡片保住容器与白名单样式；敌意声明（`position: fixed`、`z-index: 9999`、外部 `url()`、`behavior`）被剥而卡片的真版式留下；组合体不计脚本图、空壳照计；figure 之外解包形状不变只多边界；行内摘要同例。两处既有期望更新（边缘裁剪、行内间距）连同理由就地钉住。
