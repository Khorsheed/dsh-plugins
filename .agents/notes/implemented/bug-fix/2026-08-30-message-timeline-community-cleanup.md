# Agent Note: message-timeline community-readiness cleanup (race, kind predicate, metadata, docs)

Status: implemented

English | [中文](2026-08-30-message-timeline-community-cleanup.zh.md)

## Problem

Before community release, two independent reviews (the human + an external codex review) surfaced a small set of quality/architecture issues. Most were cosmetic or doc drift, but one was a real lifecycle defect: the rail tracker scheduled an uncancellable bind frame; if the session changed or the plugin was disposed before that frame ran, the stale callback would bind the global scrollport under a stale session, re-add listeners, or bind into an already-disposed tracker.

## Decision

Five changes, sized to the same package:

1. **Fix the pending-bind race.** `teardownBind()` now bumps a `bindToken` generation counter; the bind frame closes over the token it was scheduled with and bails if it no longer matches. A rebind or a dispose invalidates every earlier frame, so a stale bind can never attach listeners, overwrite a newer ResizeObserver, or bind after disposal. Two regression tests cover dispose-before-first-bind and rapid-session-change-before-bind.
2. **Consolidate the node-kind predicates.** The "which kinds are timeline rows" check existed in three places (the rail's order loop, `activeRowKey`, and the append filter) and could drift. `timeline-kinds.ts` is now the single source of truth: `isTimelineRowKind(kind, includeSteering)` (user, optional steering, message-tools-edited/restored) and `isHiddenSpanCarrierKind(kind)` (withdrawn/edited). The rail projection and the DOM reading-position tracker share the first; `hidden-spans.ts` uses the second. This also aligns the blue reading-position marker with edited/restored bubbles (it previously only recognized user/steering rows).
3. **Declare `dsh.client.immediately: false`** — the browser-half convention; the plugin registers its slot lazily through `slots.inject`, so it is not immediate.
4. **Refresh both READMEs.** Document `timeline-kinds.ts` and `hidden-spans.ts`, that edited/restored bubbles keep a row while withdrawn originals do not, and correct the width behavior: the 40% fallback while the flow probe is unanswered is a best-effort degrade, not a guarantee of non-overlap.
5. **Snapshot the node store once.** The `items` memo read `nodes.values()` twice (once for the span fold, once for the append). It now reads once and reuses the same snapshot, and the two separate try/catch blocks merge into one.

The withdrawn-original drop and the anchorSeq sort from the prior fix are unchanged and deliberately preserved — the review confirmed they are correct and not over-engineered.

## Verification

106 package tests pass (was 98): +2 for the bind-race regression tests, +5 for the timeline-kinds predicates, +1 for activeRowKey recognizing edited/restored rows. `pnpm build` and `typecheck` green. README bilingual pair re-recorded in sync.

## Alternatives considered

**Keep the bind as-is and rely on `dispose()`/`bind()` ordering.** Rejected: dispose cannot cancel a frame already scheduled, so the race is real.
**Add `Number.isFinite` guards to the span fold / sort.** Rejected (review consensus): a real host never produces a non-finite `anchorSeq`; the guards would be speculative defense, and the code already degrades via try/catch and skips unresolved nodes.
**Reset prefetch bookkeeping on session change.** Deferred: `conversation.session.header.utilities` is a per-session scoped slot, so the component remounts across sessions and resets the counter anyway; no verified repro.
**Single shared predicate for all three kind checks.** Refined: the timeline-row set and the span-carrier set overlap but are not identical, so two predicates (not one) live in `timeline-kinds.ts`.

## Consequences

The tracker no longer leaks listeners/observers on a rapid rebind or a dispose-before-first-bind. The rail, the reading-position marker, and the hidden-span fold share one kind classification, so adding a timeline kind later touches one file. The package meets the browser-half metadata convention and its READMEs describe the real (including best-effort) behavior. Ordinary sessions remain byte-for-byte unchanged (no appended bubbles → the kind predicates and the stable sort are no-ops).
