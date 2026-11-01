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

## Follow-up (2026-11-01): what holds 交卷 back, and editing an open answer

The user typed an answer without pressing 提交, saw 「还差 1 题」 at the bottom, and could not tell which question it meant. They also asked whether a submitted answer can still be changed.

- **The unsubmitted list**: under the disabled 交卷 button, 「还没提交：」 lists each unsubmitted question by number (第 N 题). A question with text in its box but not submitted reads 「第 N 题（写了，没点提交）」. Clicking one scrolls its card to the middle and focuses its answer box. The list disappears once everything is submitted, and after the sitting is handed to the coach.
- **改答案**: an open (`free`) question that is submitted but not yet judged shows 改答案. It drops the answer and puts the text back into the draft, so the box is editable again and 交卷 counts it as unsubmitted. Choice and fill answers are judged on the spot with the key shown, so they stay locked; editing them would let the learner copy the key. After 交卷 hands the sitting to the coach, 改答案 goes away, because the answers are already in the conversation input.
- Rejected: making the disabled 交卷 button jump to the first unsubmitted question. The button does not say where it would go, and the list shows every question at once.

Tested in `tests/quiz-pending.client.spec.tsx` (jsdom): the list and the drafted label, the jump with focus, the list clearing, 改答案 only on the open question with its text restored, and 改答案 gone after the handover.
