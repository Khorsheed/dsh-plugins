# Agent Note: The reader keeps arXiv diagram labels and settles LaTeXML list labels

Status: implemented

## Problem

一篇 arXiv HTML 文章（`arxiv.org/html/2610.06783v1`）有两处问题。2026-10-06 在已存的正文和源页面上实测：

- **图 1 只剩空框和箭头。** LaTeXML 把 TikZ 图渲染成 `<svg>`，每个节点标签都是放在 `<foreignObject>` 里的 HTML（这一页有 303 个）。抽取器把 `foreignObject` 当作「SVG 里的 HTML 注入通道」整块丢掉，所以标签全没了。
- **每个列表项都先显示 `•`、换行，然后才是正文。**
  - LaTeXML 关掉了原生标记（`list-style-type:none`），在块级段落前面写一个标签：`<li><span class="ltx_tag ltx_tag_item">•</span> <div class="ltx_para"><p>…`。
  - 没有页面样式表时，原生圆点又出现了，和写出来的 `•` 并排，段落也掉到下一行。
  - 编号列表（`(a)`、`(1)`）则同时显示原生编号和写出来的标签。

## Decision

- **保留 `foreignObject`。** 它的子节点走正文自己的 HTML 白名单（`normalizeChildren`，图内模式），属性走 SVG 属性白名单（新增 `overflow`）。里面的脚本、事件处理器和 iframe 照正文的规则剥掉。
- **LaTeXML 带类名的 span 保留语义：**
  - `ltx_p` 成为块（图内是 `<div>`，其他地方是换行边界）；
  - `ltx_font_bold` 变成 `<strong>`，`ltx_font_italic` 变成 `<em>`；
  - 图内没有可保留样式的空 span 直接展开。
- **`settleListLabels(root)` 按结构匹配。** 条件是：`<li>` 开头的全部文字（一个文本节点，或一个没有子元素的 span）后面紧跟一个含段落的 `p`/`div` 块。
  - 圆点符号直接删掉；
  - 条目标签（`1.`、`(2)`、`a)`、`(iv)`）移进第一个段落，条目加上 `data-labelled`。这个属性在 `li` 上列入白名单，面板据此隐藏原生标记。
  - `li > p:first-child` 去掉上边距。
- **显示时修复改名 `repairStoredSvg` → `repairStoredBody`。** 现在也会运行 `settleListLabels`，快速判断条件改为含 `<svg` 或 `<li`。
- **在源页面和已存正文上实测：**
  - 重新抽取保留了全部 303 个标签，不再有重复圆点，15 个条目带标签；
  - 已存正文的重复圆点从 42 个降到 0；
  - 用无头 Chrome 截取抽取出的图，布局和源页面一致。

## Alternatives considered

**把图栅格化，或把 SVG 存成 `<img>`。** arXiv 没有为 TikZ 图单独提供图片，而且图片会丢掉标签里的链接和翻译。

**只按 `ltx_tag_item` 类名匹配列表。** 白名单会去掉类名，修复之前存下的正文就永远修不到。按结构匹配，原始页面和已存正文都适用。

## Consequences

- 已存正文里丢掉的标签无法补回，因为旧抽取器从来没保存过它们。这样的文章需要点一次「重新抓取」。列表在显示时就能修好，不用重新抓取。
- 翻译现在也覆盖图内标签。译文可能比框长，`overflow="visible"` 让它溢出而不是被裁掉。
- 任何 SVG（不只是 LaTeXML 的）里的 `foreignObject` 现在都会保留白名单内的 HTML。
- 测试（`tests/extract-article.spec.ts`）：
  - capture 夹具里的 foreignObject 只保留标签，没有事件处理器、脚本或 iframe；
  - LaTeXML 图内标签、圆点和编号条目，以及开头是普通文字、不应处理的条目；
  - 已存正文的列表修复结果完全一致，并且幂等。
