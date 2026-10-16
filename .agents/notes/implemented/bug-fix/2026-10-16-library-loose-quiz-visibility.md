# Agent Note: Library — a quiz that gates no station is still reachable

Status: implemented

## Problem

`putQuiz` has always accepted a station-less scope (book-level, or fully free with no book), but the sidebar listed quizzes only under a quiz station's 章节考 tab. A coach-written book-level quiz — the natural answer when every station on the path is a practice station, which refuses quiz scope — landed in storage with NO entry point: the learner was told 「出题了」 and could find nothing anywhere in the panel (live 微积分 session, 2026-10-16).

## Decision

- **BookView gains 本书测验** — the book's station-less quizzes, each row opening the paper.
- **ProjectView gains 自由测验** — quizzes scoped to neither book nor station.
- **A station's gate tab shows the same-scope station-less quizzes**: a quiz station's 章节考 lists them after the station's own quizzes; a practice station's 章节考 (the acceptance sheet) lists the covered books' 本书测验 between the criteria and the submit button — an acceptance line like 「完成本站测验（book 级）」 now resolves to a visible, tappable target.
- **`putQuiz` warns where a station-less quiz landed** (the book page's 本书测验 / the project page's 自由测验, "name node to gate one"), and the `quiz` / `node` tool parameter descriptions carry the same pointer, so the coach can tell the learner where to look.
- The shared row renderer is `QuizRows` (client/views/book.tsx); the quiz route's book comes from the quiz's own scope, never from the calling view.

## Alternatives considered

- **Refusing station-less quizzes**: rejected — the free practice quiz is a deliberate escape hatch; the gap was display, not storage.
- **Implicitly attaching a node-less quiz to the book's current node**: rejected — it would mis-file the sitting and could silently complete a station; explicit scope plus a visible listing is honest.

## Consequences

- Existing station-less quizzes become visible with no data migration.
- A quiz station's 章节考 now reads the book's whole quiz list and splits client-side (one wider Remote call instead of a node-filtered one).

## Testing

service.spec: a station-less quiz warns with its landing place (book page / project page); the photo-grounded quiz assertion now pins the placement note as its only warning. 122/122 + `check:panels` green.
