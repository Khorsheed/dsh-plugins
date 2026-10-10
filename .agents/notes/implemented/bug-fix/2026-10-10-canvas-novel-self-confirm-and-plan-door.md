# Agent Note: the agent can no longer confirm a plan the person has not seen; a plan card opens the plan

Status: implemented

## Problem

This happened on 3080, in 《幻梦境》 chapter 3, on 2026-10-10. The person replied to a plan with three revisions. The agent then did three things in the same turn:

1. It re-registered the plan.
2. It called `novel_write(what=confirm)`, whose answer read 「按用户在对话里的同意」.
3. It started writing the text.

The skill already said that a changed plan needs a fresh approval, and the model did not follow it.

In the same session, the plan card's 「查看计划」 opened the chapter page with the plan block folded under the written text. The page read as if the plan had not opened at all.

## Decision

- **The confirm gate is enforced in the store, not in the prompt.** The rule: the agent's chat confirmation counts only after a user message later than the one before the plan was registered. A plan registered and confirmed in one turn has never been seen.
  - `writeChapter` stamps `planAsk {session, userSeq}` whenever a plan is set or changed. `userSeq` is the seq of the session's newest `user/message` event, read structurally through `session.snapshotEvents()` by `latestUserSeq`.
  - `confirmChapterPlan({byAgent: true})` refuses with `plan-unseen` when three things hold: it is the same session, the plan is unconfirmed, and no user message has arrived since. `novel_write(what=confirm)` passes `byAgent`.
  - The refusal tells the model to say what changed and wait.
  - The person's ✓ on the page never passes `byAgent`, so it is never gated.
  - A host without `snapshotEvents` leaves the gate open, as before.
- **A plan card opens the plan.** The plan card's door, and its auto-open, pass the param `N:plan` (`PLAN_FOCUS`).
  - `ChapterPage` reads the number with `parseInt` and follows a changed param.
  - `PlanBlock` gets `focus`: it opens whatever the phase and scrolls into view.
- The skill adds that a request for changes is not approval.

## Alternatives considered

- **Prompt-only.** It was already in the skill and did not hold.
- **A time threshold between registering and confirming.** It guesses at reading speed. The user-message seq is the fact that matters.

## Consequences

- A person who approves in the same message that asks for changes, then sees the re-registered plan, has to say 「可以」 once more or click ✓ on the page.
- Rows registered before this change carry no `planAsk`, so they are not gated.

## Validation

- `pnpm --filter @khorsheed/dsh-canvas-novel run build && run test`: 179 tests.
- New tests:
  - the agent's confirm is refused in the same breath and accepted after a later user message;
  - the page's ✓ always confirms;
  - a page opened with `1:plan` shows the plan on a written chapter, and one opened with `1` does not.
