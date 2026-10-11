# Agent Note: library chapter-quiz review fixes

Status: implemented

## Problem

A product review of the chapter quiz (a 《大转型》 reading project) surfaced seven defects, all in `packages/library`:

1. A question's evidence quote rendered BEFORE the answer control — a web/photo quote often contains the answer verbatim (the reviewed question's quote named option C's text), so the citation gave the answer away.
2. Choice questions arrived with `answer` naming a different option than the explanation defended (the answer matched option C while the explanation argued A) — a generation-side inconsistency; and an answer matching NO option at all was silently stored, after which the sidebar judged every pick wrong.
3. The coach restated the whole quiz in the conversation after storing it — tokens spent on content the learner answers in the sidebar.
4. The book view's header put the edition in `PanelHeader`'s nowrap, never-truncating `meta` — a long edition overflowed the header and pushed the actions out.
5. The path legend line (「方形是关卡，过章节考解锁下一关…」) was explanatory noise under the roadmap.
6. Opening a level from the path landed on 章节考 instead of 导读.
7. A `focus: book` quiz still read the learner's cards (the guidance's "what to quiz, in order" was unconditional), making book indistinguishable from mixed in the coach's narration.
8. A freshly composed quiz surfaced as one plain list row at the top of the 章节考 tab — visually identical to the history, easy to miss after the coach's long turn.
9. An open question could turn on a bare allusion (「社会的发现」是什么意思？) with nothing for the learner to anchor the discussion to.
10. The pane learned host-side writes only inside the per-tab two-minute watch windows — a quiz landing after the window (or a photo, or any other session's write) left the open view stale until a remount; the new hero card simply never appeared without a tab switch.
11. A fill question on judgement/argument content ("社会的发现既是自由的 ___") punishes any legitimate paraphrase — the sidebar judges fills by exact text, and a translation or an idea has many right wordings.
12. The open-question quote that framed the discussion could itself hand the answer over (the passage enumerated the three features the question asked for).

## Decision

- **Quote after answering** (`src/client/views/quiz.tsx`): the evidence quote renders only inside the post-answer feedback block, beside the explanation and the source link. The evidence-kind chip stays up front — it names the source, not the content.
- **Choice-key gate** (`src/service.ts`): `putQuiz` refuses a choice question whose answer resolves to no option — the resolution covers the same spellings the sidebar's judge resolves (a letter in range, a lettered option, the verbatim text, one-way containment) and returns a teaching error. A letter out of range (answer `D` with two options) resolves to nothing.
- **Prompt** (`src/tool.ts` `LIBRARY_PROMPT`): two revised bullets and two new ones — a choice answer IS one of its options (compose the correct option from the evidence first, copy it into `answer` verbatim, let the explanation defend that same option); a stored quiz is answered in the sidebar's 章节考 tab, so the reply is one line and never restates the questions; `focus: book` quizzes the chapter's content alone and skips `library_read · cards` entirely; the "what to quiz, in order" bullet is now scoped to focus mine and mixed.
- **Header** (`src/client/views/book.tsx`): the BookView header drops the edition `meta` (the edition stays in the bookHead row below, which wraps); the title is the book title.
- **Legend removed** (`src/client/views/book.tsx`, `src/client/locales.ts`, `src/client/LibraryPane.module.css`): the `book.legend` copy, its zh/en keys and the `.legend` rule.
- **Default tab guide** (`src/client/views/book.tsx`): path nodes open on 导读 regardless of kind (was: read nodes to guide, quiz nodes straight to the quiz tab).
- **The latest quiz stands out** (`src/client/views/book.tsx` QuizTab, `LibraryPane.module.css`): the newest quiz renders as an accent hero card (「最新考卷 · N 题」, focus and evidence mix, a primary 开始作答) directly under the pass rule; older quizzes move under a 之前的考卷 section. A quiz the learner is waiting for (the 请教练出题 watch) opens itself the moment the poll sees it land.
- **Open questions frame their discussion, folded** (`src/client/views/quiz.tsx`, `LIBRARY_PROMPT`): a free question's evidence quote sits behind a 参考原文 toggle (peek expands it, answering expands it for good) — it frames the discussion on demand without handing the answer over; choice and fill quotes stay post-answer only. The prompt requires an open question's PROMPT to locate the discussion (the passage, the claim, the chapters) since the quote is folded, and `QuestionCard` is keyed per question so the peek state never leaks to the next one.
- **The pane polls activity** (`src/service.ts` `latestActivity`, the Remote verb, `LibraryPane.tsx`): the newest event's timestamp across the library rides the toast's existing 5s timer; a move bumps the store's `rev` and every open view re-reads. The per-tab watch windows stay (they drive the waiting label and the auto-open), but staleness no longer survives them.
- **Kind follows content** (`LIBRARY_PROMPT`): fill only for a short exact answer worth verbatim recall (term, name, formula, date); a judgement, an argument or a legitimately varying wording (a translation) is a choice or a free question, never a fill.

## Alternatives considered

- **Hiding the quote for choice questions only**: a fill question's quote leaks the same way (the quote is the sentence the blank came from); open questions keep theirs within reach but folded — the learner who cannot place the question peeks deliberately.
- **Showing the open question's quote always** (the previous round's behavior): an answer-bearing passage then reads as the answer before the learner writes a word; the fold keeps the framing one tap away.
- **A push channel on the Remote instead of a poll**: the Typert Remote is request/response today; a one-field poll riding the existing 5s timer is additive and covers every view, not only the quiz tab.
- **Extending the two-minute watch windows**: a longer per-tab window still strands any view without one (and any landing past it); the pane-level poll removes the class of bug rather than widening it.
- **A toast or notice for the landed quiz instead of an auto-open**: the watch exists exactly because the learner asked and is waiting; navigating into the quiz is the next step either way, so the click is ceremony.
- **Keeping the quiz list newest-first with a "new" badge**: a badge on an otherwise identical row still reads as list noise; the hero card gives the fresh quiz the panel's one primary action.
- **Validating answer/explanation agreement server-side**: the agreement is semantic — the store cannot tell which option an explanation defends; the prompt carries that rule, the gate carries the mechanical one (answer must hit an option).
- **Truncating `meta` in the shared panel-kit CSS**: a kit-wide change for a local problem, and the design comment already scopes meta to "a count, a parent folder"; the edition lives in the body row that wraps.
- **Keeping the legend behind a first-run flag**: the path's own iconography (locked discs, numbered levels, side dots) already teaches it; the line was noise on every visit.
- **Landing levels on 章节考 kept as-is for the current node**: rejected — the guide is the node's own page (goals, covered contents); the quiz tab is one click away and the user expectation is to land on the guide.

## Consequences

- `putQuiz` is stricter: a previously-storable broken choice question now refuses with a lesson; two new tests pin the gate (stray text, out-of-range letter, lettered acceptance). The stored data shape is unchanged, and quizzes stored before the gate render the quote post-answer like any other.
- The prompt changes steer new conversations only; nothing persisted carries them.
- 79 tests pass (3 new: the gate pair and the activity poll); `pnpm check:panels --package packages/library` reports 0 errors. The rendering changes (quote placement and fold, the hero card, auto-open on the watched landing) were exercised against the package's sidebar fixture — DOM and computed-style checks, since the Playwright screenshot path stalls in this environment.
- `latestActivity` is new public wire surface (additive, `library/latestActivity`); the pane polls it only while visible.
- The NodeView header still pairs a long node title with the book-title meta; on very narrow panels the meta can still squeeze the title — left as-is because the reviewed overflow was the BookView edition.
