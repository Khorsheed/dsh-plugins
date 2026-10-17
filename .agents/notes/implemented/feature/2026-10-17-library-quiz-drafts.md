# Agent Note: Library — quiz sittings persist locally (the quiz-draft store)

Status: implemented

## Problem

A paper answered halfway was lost on exit: the QuizView held the sitting in component state, so backing out to the station, closing the sidebar, or a reload zeroed it. The learner asked for the progress to survive.

## Decision

A small client-local store (`client/quiz-drafts.ts`): each paper's in-progress sitting (`answers` judged on the spot + open-answer `drafts`) writes to `localStorage` under `dsh-library:quiz-draft:<quiz id>` on every answer and keystroke, restores on mount, and clears when the sitting lands (交卷 ledgered). A sitting handed to the coach (open answers primed into the conversation) deliberately KEEPS its draft — the learner may still amend it before grading.

Local by definition: a draft is never ledgered until 交卷, so no host write, no Remote verb, no migration. A superseded paper's draft is orphaned harmlessly (the new paper has its own id); storage blocked (private mode) degrades to in-memory, never a failure.

## Alternatives considered

- **Persist the sitting host-side** (a draft entity beside attempts): rejected — an ungraded sitting is not library truth, and a Remote verb per keystroke buys nothing the learner can feel.
- **sessionStorage instead of localStorage**: rejected — the reported loss was exactly "I left and came back"; a draft that dies with the tab does not answer it.
- **Hold drafts in the pane store (dsh-client-store)**: rejected — the pane store is in-memory; a reload is one of the loss paths being fixed.

## Consequences

- Re-opening a paper shows the previous answers with their on-the-spot verdicts (the choice/fill judgment is part of the saved state).
- Re-answering a ledgered paper starts clean (the draft cleared at 交卷) — the retake flow is unchanged.
- Drafts are per browser profile (localStorage), not synced — acceptable for an in-progress sitting; the graded truth lives in attempts.

## Testing

142/142 green (host suite; the pane has no component tests by project convention). tsc and tsdown green.
