# Agent Note: Library — the roadmap scope reads itself off the covers; question axes default

Status: implemented

## Problem

Two of the coach's recurring live failures were DECISIONS the tool forced on every call, not knowledge gaps. (1) `write·roadmap` demanded a scope choice (a book's path vs the project's own) — the [journey scope guard](../../implemented/bug-fix/2026-10-15-library-journey-scope-guard.md) turned a wrong choice into a refusal, but the model still had to make the choice, and a bound session's default silently captured mixed journeys (a mixed draft on a book-bound session failed the one-book rule instead of landing on the project). (2) Every quiz question demanded both a `target` and an `evidence` object — the highest-frequency write carried two mandatory nested decisions whose default answer ("the station's topic, resting on domain knowledge") covers most questions.

## Decision

- **Scope derivation** (`deriveRoadmapBook`, tool layer): when `write·roadmap`'s `book` is omitted (or null), the scope is read off the post-sugar covers — every station covering the same single book lands on THAT book's path; anything mixed lands on the project's own. An explicit `book: "<id>"` remains as an override, validated exactly as before; the binding's book is consulted only by the `chapterRanges` sugar. This supersedes the refusal half of the journey scope guard at the tool layer — a misrouted choice is now impossible to omit — while the service keeps the mirror guard as the override's (and every non-tool caller's) safety net.
- **Axis defaults** (`normalizeQuestionAxes`, tool layer): a question's `target` defaults to `{ kind: "topic" }`, `evidence` to `{ kind: "knowledge" }`; flat shorthands fill them — `cardIds` imply a marked target, `pageId` / `url` imply photo / web evidence, a bare string sets just the kind. The service's two-axis gate is untouched: it judges the normalized shape, so a defaulted knowledge-backed question on a material book still refuses.
- The schema descriptions carry the new optionality (both axes also accept the bare-kind string), and `write·roadmap`'s `book` parameter documentation now says "omit it".

## Alternatives considered

- **Keep the refusal and teach harder**: rejected — a decision the model must make whose answer the payload already contains is a tax on every call; deriving it removes the error class instead of correcting it.
- **Drop the mirror guard in the service too**: rejected — the service validates every caller (the explicit override included); the guard costs nothing there.
- **Relax the service's two-axis checks**: rejected — the verbatim gate is the product's honesty core; only the transport default moved, the judgment did not.

## Consequences

- `write·roadmap` no longer needs `book`; a book-bound session drafting a mixed path now correctly lands on the project instead of failing validation.
- The defaults apply at write time only — stored quizzes and roadmaps are untouched.
- These are the contract-layer forerunners of the v5 model proposal ([proposals/active/2026-10-16-library-v5-model.md](../../../proposals/active/2026-10-16-library-v5-model.md)).

## Testing

tool.spec.ts (+5): same-book covers land on the book with no book parameter; mixed covers land on the project even when bound; the explicit override still validates; a bare question stores topic + knowledge while the flat shorthands fill the axes; a defaulted question still hits the material-book verbatim gate. 127/127 green, `check:panels` clean.
