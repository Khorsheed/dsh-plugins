# Agent Note: the room composer's draft lives in the official input machine

Status: implemented

English | [中文](2026-10-18-room-composer-machine-draft.zh.md)

## Problem

The room composer takeover (`conversation.composer` chain, priority -10) kept its draft in a component-local `useState`, while every other composer surface — and every external draft writer — speaks to the session's official input machine. Three observable defects followed:

1. **quote-anything looked broken in rooms.** 「引用到当前会话」 writes the machine draft (`input.setDraft`), which succeeded — but only the `display:none` fallback bar renders that draft, so the user saw nothing happen. The text was not lost: it resurfaced whenever the takeover un-elected (a pending approval, the first-pull window), which read as a second bug.
2. **Room drafts were ephemeral.** Leaving and re-entering the session remounted the component and dropped the in-progress text; the official bar's drafts survive the same navigation via the machine's persistence.
3. **The election window stranded text.** During the first-pull cache miss the official bar shows; anything typed there stayed invisible once the takeover elected.

## Decision

The takeover's draft store IS the official input machine: `RoomComposer` reads `useInput(s => s.draft)` and writes `inputActions.setDraft(...)` — both members of the session standard kit every `conversation.composer` chain occupant receives (`SessionStandardProps`, host ≥0.1.5). The component's own `useState` draft is gone.

The **send path is unchanged**: every message — bare text included — routes through room's own `remote.room.postMessage` dispatch (the host routes bare text to the current coordinator), and `inputActions.submit()` is never called. The machine's busy admission would enqueue behind a running coordinator and serialize what the dispatch engine deliberately runs in parallel (see [the room routing journal note](2026-09-15-room-routing-journal.md)). A successful send clears the machine draft and best-effort calls `persistDraft?.()` (0.2.1+; probed structurally) because the bypass skips the machine's own submit-time flush.

Reference chips in the machine (quote's chip path, other trigger sources) project to their clipboard text inside the plain textarea; editing there flattens chips back to text via `setDraft` — the accepted room-side degradation of the chip surface.

Two stale comments that still described the pre-2026-09-15 "bare messages released to the official submit path" design were corrected in the same pass (`RoomComposer.tsx` header, `slots.ts` `RoomComposerInjected.submit`).

## Alternatives considered

- **A `roomComposer` service + a pending-insert buffer, probed by quote** (the original plan): rejected — it keeps two parallel draft truths (the buffer and the machine), grows room-specific code in quote, and still leaves room drafts ephemeral. The machine binding fixes all three defects with less code.
- **Full composer unification** (room renders the official InputBar; sends go through the official submit and are rerouted host-side via `agent/pre-step`, with member fan-out observing `session/event`): verified feasible on the published 0.2.x line with zero host changes, but rejected for this change — the machine's busy admission serializes today-parallel @-dispatches, the room send path accepts no attachments (the pre-step guard hard-throws on non-text blocks), and the native-coordinator prompt envelope would need re-injection. A standalone routing refactor if ever wanted, not a quote fix.
- **Do nothing; quote special-cases rooms**: rejected — duplicates the draft state and leaves the persistence/election-window defects in place.

## Consequences

- quote-anything (and any other machine-draft writer) works in rooms with zero room-specific code; the room composer and the hidden fallback bar share one draft, so the election-window carry-over is free.
- Room drafts persist across navigation and reload via the machine's own persistence — a behavior change users will notice (previously lost).
- `RoomComposer` now hard-requires the chain slot's session standard kit (`useInput`/`inputActions`) — present on every in-range host line (the pre-2026-09-15 design already consumed them), so `minHost` is unmoved.
- The composer test bench fakes a stateful input machine (snapshot store + reactive `useInput`); assertions flipped from "setDraft never called" to "submit never called, setDraft last called with ''", plus new pins for the external-write (quote) path and draft survival across remounts. `pnpm --filter @khorsheed/dsh-room run build && pnpm --filter @khorsheed/dsh-room test` is green (315 tests).
