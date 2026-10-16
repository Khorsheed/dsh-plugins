# Agent Note: 图书馆——章节考改整屏试卷，数学公式走 TeX 渲染

Status: implemented

## Problem

章节考此前一屏一题（「章节考 1/6」+ 下一题），看不见整张卷子的形状、回看不便——学习者要了整屏试卷。教练出的数学公式以纯文本到达（`√(3-x) / (x+2)`），根号的上横线伸不出去——数学课里这是歧义排版。

## Decision

- **试卷模式**（`QuizView`）：全部题目在一屏滚动里、带题号，每题照旧即时判分；草稿按题存（此前是跟着翻页走的单一 draft）；标题显示 `章节考 已答/总数`，进度条按已答计；交卷在底部，未答完禁用（「还差 N 题」）——翻页时代隐含的"答完才交卷"约束显式化。
- **TeX 渲染**（`client/math.tsx`）：`$…$` / `$$…$$` 段经自带的 `katex` 以 `output: 'mathml'` 渲染——浏览器原生 MathML，bundle 不带 KaTeX 字体与 CSS。`MathText` 覆盖考题题干、选项、解析、判错行、错题区答案；讲义 tab 的行内渲染在粗体/代码旁加 TeX 段。`questions` 与 `text`（讲义）两个工具参数的描述里告知教练 LaTeX 会渲染。

## Alternatives considered

- **左右翻页 + 题号导航**：否决——窄侧栏里可滚动试卷既简单又贴合"试卷"心智。
- **KaTeX 的 HTML 输出**：否决——要随包带 KaTeX 字体/CSS 并解析；MathML 输出自包含（Chromium/WebKit 原生支持 MathML Core）。
- **宿主的 `MarkdownText`（dsh-client-ui-primitives）**：否决——它不能独立解析（经宿主树传递依赖 clsx / katex）；自带 katex 保持插件可独立安装。

## Consequences

- 客户端 bundle 多出 KaTeX 解析器（约 +300 KB min）；MathML 输出无需字体资源。
- 教练现在能在考卷和讲义里写真数学；纯 Unicode 数学式照旧渲染。

## Testing

行为面 `tool.spec.ts` / `store.spec.ts` 不变（试卷模式与 TeX 是呈现层）。全套测试 + `check:panels` 绿。
