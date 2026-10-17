# Agent Note: Library — the mistake loop (错题本, retake direction, voided-question replacement)

Status: implemented

## Problem

Three gaps surfaced from real 3080 use, all on the same mistake-driven loop: misses had no home beyond the station tab (nothing cross-station); 「这题有问题」 voided a question's score and nothing else happened (the coach never learned the question was broken); and re-entering a quizzed station offered the SAME paper — no fresh questions, no way to steer a new set at the weak points.

## Decision

Client-level, no storage change (misses and voids were already ledgered in attempts):

- **错题本 on the project page** (`MistakesSection`): every missed question across the project's papers (each paper's latest sitting, deduped per paper+question, newest first) with its answer and source, plus a one-tap 「围绕错题出一套」 that primes the coach with the list (a free quiz). The station-level missed list on the 章节考 tab stays — the two scopes serve the walk-by and the sit-down.
- **A fresh set is the primary action once a station has been quizzed**: the ask button flips 请教练出题 → 再出一套新题, and the direction chips gain 「错题重考」 (with the miss count) when the station has misses — it primes the retake wording directly (same weak points, new angles, never the originals).
- **Flagged questions close the loop**: the 章节考 tab lists voided questions (「你觉得有问题的题」) with a 「请教练换题」 gesture (prime.quiz.replace), and the coach prompt now teaches: a void is a broken question — when grading mentions voids, offer replacements.

*(2026-10-18: two facts above moved on — the project-page 错题本 section became a 错题 band entry plus the station tab's 其他站 shelf (one shared collection in `client/mistakes.ts`), and the 错题重考 direction chip became the paper card's state-driven CTA. See [the quiz-loop note](2026-10-18-library-quiz-loop-points.md).)*

## Alternatives considered

- **A separate 错题本 tab/route**: rejected — the project page is where the learner already lands; a section there beats another destination, and the cards view (source quiz) already serves the weakness-ledger reading.
- **Letting void auto-trigger a replacement quiz**: rejected — the coach must see the verdicts first (the replacement needs the context of what was wrong and why); the gesture primes exactly that.
- **A new focus value `missed` on the wire**: rejected — the retake wording is a priming concern, not a quiz-scope one; LibraryQuizFocus stays mine/book/mixed.

## Consequences

- QuizTab's direction state is back to plain `LibraryQuizFocus` — the priming-only `| 'missed'` chip was retired with the state-driven paper card (2026-10-18).
- The project page reads attempts + assessments once per mount for the 错题 band entry (both lists are small and already cached by the pane's poll).

## Testing

142/142 green (host suite); tsc + tsdown + check:panels clean.
