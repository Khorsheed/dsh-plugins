# Agent Note: message-timeline keeps edited/restored bubbles on the rail; an in-place edit never drains it

Status: implemented

English | [中文](2026-08-28-message-timeline-edit-keeps-rail.zh.md)

## Problem

Live bug (message-timeline × message-tools, predates the 0.1.2 adaptation branch): after editing and resending a user message, the timeline rail went empty. message-tools' `editMessage` replaces the target message **and the surface tail** (`slots.ts`: "replace it (and the surface tail)"), so the host hides every covered node (visibility → hidden, out of the chat `order`) and materializes a `message-tools-edited` bubble at the replacement seq; withdraw-then-restore replays land as `message-tools-restored`. The rail built its rows by filtering the visible chat order for `kind === 'user'` (plus steering), so the edited bubble was rejected and every withdrawn original was already gone from the order — editing the first message therefore drained the whole rail.

## Decision

- A shared predicate `isTimelineRowKind(kind, includeSteering)` (`slots.ts`) now drives both the row filter (`TimelineRail.tsx`) and the reading-position resolver (`rail-tracker.ts` `activeRowKey`): a row exists for every visible user-message bubble — `user`, steering, `message-tools-edited`, `message-tools-restored`. The edited bubble's preview shows the edited text (its `data.content`) and clicking it jumps to the edited bubble.
- **Rows come from the node store, not `s.chat.order`.** A live repro (clean browser, 3-user-message session, edit the first message) showed the rail draining to zero and staying there — and the host's visible `order` did not contain the `message-tools-edited` bubble (its key form is `20:message-tools-edited312`, kind-plus-seq in one segment) even though the flow renders it. The rail now reads `s.chat.nodes.values()`, filters `visibility === 'visible'` plus {@link isTimelineRowKind}, and orders by `anchorSeq` (the same projection the host uses) — so it stays aligned with what the transcript shows whatever the host's `order` projection does. The `order` subscription is gone.
- **No gray ghosts for withdrawn originals.** Withdrawn messages carry `visibility: 'hidden'` in the store, so the visibility filter drops them — the message-tools divider in the transcript owns that history (expand / replay / 重新编辑). Ghost ticks would jump to nothing and clutter the rail; the edited bubble itself is where "which message did I just edit" lives.
- `includeSteering` cannot apply to the edited kind — `EditedMessageData` does not record the source kind — so edited/restored rows always count.

## Verification

Regression tests: the rail renders `message-tools-edited` + `message-tools-restored` rows with their content previews; it stays non-empty when the edited bubble is the only user-kind node in the store (editing the first message); and it lists the edited bubble while dropping a withdrawn original that is still in the store with `visibility: 'hidden'` (`tests/TimelineRail.client.spec.tsx`); `activeRowKey` anchors to edited/restored rows (`tests/rail-tracker.client.spec.ts`). 87 package tests pass; `pnpm build` green. Deployed via deploy:3080.

## Alternatives considered

**Gray placeholder rows for withdrawn originals** — the user floated this so "which one did I edit" stays locatable. Rejected: the originals are no longer on the surface (no jump target), the transcript divider already owns history, and the edited bubble keeps the locatability need satisfied.

**Keep the filter as-is and only stop hiding the panel when empty** — the rail would still be missing the edited message; the emptiness was a symptom of the missing row, not a visibility bug.

## Consequences

An in-place edit no longer drains the rail; the edited message stays listed (with its new text) and jumpable. The rail continues to reflect the transcript's visible user messages only — withdrawn history stays out of the rail by design.
