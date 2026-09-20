# Agent Note：公式活过白名单（呈现 MathML 子集）

Status: implemented

## Problem

[arXiv HTML 升级](2026-09-20-reader-link-ingest.md)落地之后，论文的公式是 MathML——`<math alttext="…">` 的 LaTeXML 产物——而提取器在打分之前就把每个 `<math>` 子树丢掉了：论文到了、公式无声消失。对读论文这个主场景，这是「文字」与「内容」之别。白名单整棵丢 `math`，是因为抓回来的标记不可信，而 MathML 有一个真正注射形状的成员（`annotation-xml`）。

## Decision

`extract-article.ts` 现在放行**安全的呈现 MathML 子集**——`math, mrow, mi, mo, mn, ms, mtext, msup, msub, msubsup, mfrac, msqrt, mroot, mspace, mtable, mtr, mtd, munder, mover, munderover, semantics, annotation`——因为渲染目标是 Chromium ≥ 153，原生绘制：不要脚本、不要字体下载、不要第三方渲染器。规则：

- `math` 移出 `DROP_TAGS`；`annotation-xml` **进入**它。带 `encoding="text/html"` 的 `annotation-xml` 会把子节点按 HTML 解析（HTML5 解析器在它里面切回来）——唯一 MathML 形状的 HTML 注射通道——所以这个子树永远到不了归一化。
- 属性：`math` 只留 `alttext`（公式的纯文本孪生——无障碍，也是 MathML 不可用时的人类可读兜底）与 `display`（块级还是行内）；其它一切——事件钩子、`<mi>` 上的 `href`、样式钩子——被同一张过滤器剥掉，与所有标签同规则。
- `<semantics><annotation>` 剥掉 `encoding` 后存活：TeX 源码是页面发布的、渲染不可见的数据，引用/翻译管线看得见它。未知 MathML（`mglyph`、`mpadded`、`menclose`……）解包到子节点——对公式来说就是它的可读文本。
- 只有公式的 `<figure>` 不是脚本绘制图：`countScriptFigures` 的内容探针加入 `math`，「脚本绘制插图」提示绝不会对图就是标记的 figure 响。
- 行内摘要把公式摊平成文本（INLINE 通道只留强调）——卡片摘要带的是字，不是结构。
- CSS：`.article math[display="block"]` 是独立块，横向滚动而不是顶破正文右缘（`pre` 已有的同一约定）；行内公式随文字走。

## Alternatives considered

**从 `alttext` 出发用 KaTeX/MathJax 渲染。** 一个 vendor 进来的渲染器是 MB 级客户端依赖外加字体故事，去画浏览器本来就会画的东西；本设计的全部要点就是零第三方运行时的应用级 DOM。
**只留 `alttext` 当文本、丢标记。** 可读，但一个分式塔摊平后是字母粥——对超过一个符号的公式，标记本身就是内容。
**连 `annotation-xml` 也留。** 读者需要的东西它一概不带（TeX 已在 `annotation` 里），而它的 HTML 解析开关正是注射通道；整棵丢掉就是安全故事的全体。
**把任意博客散文里的 `$…$` 解析成 MathML。** 不在范围内，记录在案：那是对不可信文本做启发式语言解析（关于钱的散文里的误命中是经典失败），而 arXiv HTML——主场景——到达时带着真 MathML。等有带真公式内容的非 arXiv 来源出现再议。
**arxiv 内部链接（`#cite.*`、`#fig.*`）在面板内锚点跳转。** 推迟，具名：白名单剥掉所有 `id`，面板内滚动目标不存在；恢复 id 是归一化契约变更（每个已存正文的字节都变、每张译文映射重新定键），而当前经 `absolutize` 的锚链接会打开完整页面——是能用的兜底。体量超过 M0 的「够便宜才做」门。

## Consequences

- arXiv HTML 正文带着渲染好的公式到达；两个真实页面 fixture 的抽取逐字节不变（它们不含 math），其它一概没动。
- 公式文本现在计入打分的段落质量（math 子树以前在打分**之前**就被丢）——对公式多的页面更正确，对没有公式的页面是零变化。
- 被翻译文章里的 MathML：`translate.ts` 装饰文本节点；数学记号（`<mi>x</mi>`）也是文本节点，所以译文视图可能把单个字母也"翻"了——有界、表层，而且原文离读者一次地球点击。
- 安全不变量由白名单陈述，不靠清洗通道补：脚本、事件、`annotation-xml` 没有进来的路。

## Testing

`packages/dsh-reader`（+5，每个都先对着改动前的提取器红过）：`tests/extract-article.spec.ts` 驱动一个真实形状的 arXiv fixture（`tests/fixtures/arxiv-math.html`，LaTeXML 风格）——安全子集带 `alttext`/`display` 存活；TeX `<annotation>` 剥属性后存活；带 HTML 载荷的 `annotation-xml`、直接嵌在 `<math>` 里的 script、带 `onerror` 的 img 全部钉死为**不存在**；只有公式的 figure 不触发脚本图提示；feed 正文路径（`normalizeRichText`）同样放行 math；行内摘要把它摊平成文本。
