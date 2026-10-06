# Agent Note: The reader keeps MathJax's MathML copy of a formula and drops its glyph drawing

Status: implemented

## Problem

一篇 Springer 文章（EPJ Data Science，经 capture 渲染抓取）的公式显示异常：多出横线，行内符号的位置是空白，行间公式散成好几行，文字里还有字面的 `\#`。2026-10-06 在已存的正文上实测：

- Springer 用 MathJax 2 的 SVG 输出排版，每个公式渲染两份。第一份是 `<svg>`，由 `<use href="#MJMATHI-49">` 引用拼成，被引用的字形表放在页面上一个隐藏的全局 `<svg>` 里。第二份是同一个公式的 MathML，放在一个被裁成 1px 的「辅助」span 里。
- 抽取从不带上那张字形表。所以每份 SVG 绘制都只剩 `<rect>` 分数线，也就是那些多出来的横线。隐藏的 MathML 是唯一还能渲染的副本，却仍留在包装元素内联的 1px `overflow: hidden` 样式里。
- 行间公式的 MathML 是可见的，但布局不对：`.article math[display="block"] { display: block }` 把 `<math>` 变成普通 CSS 盒子。一个有多个子节点、外面没有 `<mrow>` 的 `<math>`，就失去了 MathML 布局。
- 源 TeX 写的是 `\text{\# dreams}`。MathJax 画出来是 `#`（SVG 只用了字形 `MJMAIN-23`），但 MathML 注记原样保留了 `\#`。

## Decision

- `extract-article.ts` 里的 `settleMathJaxTwins(root)` 处理这样的 `<svg>`：由 `#MJ…` 字形引用绘成，且紧随的元素是 `<math>`，或是一个唯一子元素为 `<math>` 的包装元素。处理方式：
  - 删掉 `<svg>`；
  - 用里面的 `<math>` 替换包装元素；
  - 还原 `<mtext>` 里的 TeX 转义（`\# \% \& \$ \_ \{ \}`）。
- 它在 `extractArticle` 打分之前运行，也在显示时的 `repairStoredSvg` 里运行。修复之前缓存的正文不必重新抓取就能修好。在已存的 Springer 正文上：`<svg>` 从 53 个降到 17 个（剩下的是图标和插图），36 个公式都保留为 MathML，没有残留的 1px 包装。
- 行间公式保留 `display: block` 作为回退，再加上 `display: block math`，保住 MathML 的排版上下文。

## Alternatives considered

**把 MathJax 的字形表带进正文。** 那是一个页面全局的隐藏 `<svg>`，有几百条路径。抽取得把它重新挂上，还要让 `<use>` 的目标在整篇正文里都解析得到。而 MathML 副本本来就在，可搜索、可选中，还会跟随阅读器的字号和颜色。

**按类名匹配辅助 span。** 白名单会去掉类名，已存的正文里已经没有类名了。按结构匹配（字形引用的 `<svg>` 后面紧跟唯一的 `<math>`），原始页面和已存正文都适用。

## Consequences

- 所有 MathJax 2 SVG 页面（不只是 Springer）都改用 MathML 渲染。引用非 `#MJ` 精灵图的 `<svg>`（站点图标）不受影响，没有 MathML 副本的字形 `<svg>` 也不受影响。
- `repairStoredSvg` 仍然幂等：处理过的正文里已经没有可匹配的字形引用 `<svg>`。
- 测试（`tests/extract-article.spec.ts`）：
  - 抽取保留行内和行间的 MathML，不再被裁剪，`\#` 已还原；
  - 图标 `<svg>` 保留；
  - 已存正文的修复结果完全一致，并且幂等。
