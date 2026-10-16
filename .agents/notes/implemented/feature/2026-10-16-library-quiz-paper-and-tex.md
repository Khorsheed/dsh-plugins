# Agent Note: Library — the quiz is one paper on a scroll, and math renders as TeX

Status: implemented

## Problem

The chapter quiz paged one question at a time (「章节考 1/6」 + 下一题), which hid the paper's shape and made review awkward — the learner asked for the whole paper on one scroll. And coach-authored math arrived as plain text (`√(3-x) / (x+2)`), where the radical's vinculum can't extend — ambiguous typography for a math course.

## Decision

- **Paper mode** (`QuizView`): every question renders in one scroll, numbered, each judged on the spot as before; drafts are per-question (were a single shared draft tied to paging); the header shows `章节考 已答/总数` with the progress bar counting answered; 交卷 sits at the bottom, disabled until every question is answered or voided (「还差 N 题」) — the all-answered gate the pager enforced implicitly is now explicit.
- **TeX rendering** (`client/math.tsx`): `$…$` / `$$…$$` segments render via bundled `katex` with `output: 'mathml'` — browser-native MathML, so no KaTeX fonts or CSS ship in the bundle. `MathText` runs over quiz prompts, options, explanations, the wrong-answer line, and the 错题区 answer; the notes tab's inline renderer gains TeX spans beside bold / code. The `questions` and `text` (notes) tool parameters tell the coach that LaTeX renders.

## Alternatives considered

- **Left/right paging with a question navigator**: rejected — in a narrow sidebar the scrollable paper is both simpler and closer to the mental model of a 试卷.
- **KaTeX's HTML output**: rejected — it needs the KaTeX fonts/CSS shipped and resolved; MathML output is self-contained (Chromium/WebKit render MathML Core natively).
- **The host's `MarkdownText` from dsh-client-ui-primitives**: rejected — it is not resolvable standalone (drags clsx / katex transitively through the host's tree); bundling katex keeps the plugin self-installable.

## Consequences

- The client bundle grows by the KaTeX parser (~+300 KB min); MathML output needs no font assets.
- The coach can now write real math in quizzes and 讲义; plain-Unicode math still renders as before.

## Testing

`tool.spec.ts` / `store.spec.ts` unchanged for behavior (the paper mode is client-side; TeX rendering is presentational). Full suite + `check:panels` green.
