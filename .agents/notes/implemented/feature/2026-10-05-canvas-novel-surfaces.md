# Agent Note: canvas-novel's three canvas surfaces (pending strip, foreshadow ledger page, chapter reader page)

Status: implemented

## Problem

The engine, the tools and the reconciliation gates existed, but pending review, the ledger and 「✓ 审过」 were reachable only through the tools. To review a chapter the user had to ask the model to list the pending items, relay them one by one, and call `review` on their behalf. The rule "review always comes last and a person closes the chapter" was invisible in the UI, and the human gesture it requires had no entry point.

## Decision

- **canvas-novel grows a browser half, mounted only on the canvas's genre seams**:
  - a list entry on `canvas.board.strip` (id: the genre id);
  - two keyed pages on `canvas.page`: `novel:ledger` and `novel:chapter` (param: the chapter number).
  - Every registration goes through `slots.inject(key, () => slots.register(...))`. Without the canvas there is no slot and the client renders nothing; on a canvas of another genre the strip returns null.
- **A new `novel` Remote on the host side** (`NovelRemoteService`):
  - reads: pending / ledger / chapters / chapter;
  - writes: decidePending / reviewChapter / confirmPlan.
  - Every verb delegates to `NovelService` and only adds the names a surface needs (a pending item's subject, each foreshadow's chapter track, each chapter's pending count), never a second rule.
  - The writes run under the calling session's fence, exactly like the tools.
- **The canvas hands the genre its `sessionId`** (`CanvasGenreOwnerProps.sessionId`). Only a canvas opened from a session is writable; on a read-only canvas without one, pending items can be read but not answered, and the review button is disabled with the reason shown.
- **The 「✓ 审过本章」 gate is spelled out in the UI**: it is enabled only when the phase is extracted and the chapter has no pending items; otherwise the bar says what is missing (not written, not reconciled, N pending, manuscript missing, read-only). The server still checks on its own.
- **The read hook depends only on whether the Remote exists**: `ctx.get('remote.novel')` returns a fresh proxy every call, and depending on it re-reads endlessly and starves a second read on the same page.

## Alternatives considered

- **A new sidebar tab for the ledger and pending items.** The work's context lives in the canvas, and a separate entry makes the user switch back and forth; the genre seams exist for exactly this.
- **A permanent pending row.** It is noise when there is nothing to review, so 「待审 N」 appears only when there is, and unfolds in place.
- **Calling the lamp's third step 「对账」.** It did not match the tool name `novel_extract`, so it is now 「抽取」.

## Consequences

- A chapter's whole flow (read the plan → read the manuscript → handle pending items → review) can be done by a person inside the canvas, without the model relaying anything.
- canvas-novel now has `./client` and `dsh.client`; the README's "no browser half" wording is gone.
- A legacy foreshadow card without `plantedAt` shows no planted-at chapter on its ledger row instead of 「未埋」.
- The client tests live in `tests/client.spec.tsx` (jsdom, mocked Remote) and cover strip hiding, the pending gestures and the review gate.
