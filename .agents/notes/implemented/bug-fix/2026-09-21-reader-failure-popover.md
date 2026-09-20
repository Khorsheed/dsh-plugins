# Agent Note: the failure reason floats — the card stays one line tall

Status: implemented

## Problem

Reported from 3080 acceptance with a screenshot: the [failure-taxonomy UI](../feature/2026-09-21-reader-failure-actions.md) put the failed fetch's reason as a visible red line under the card's pill — and every failed card became taller than its neighbours, breaking the wall's grid. The card's text box is fixed-height precisely so that nothing about a card's CONTENT resizes it (the wall-translation work established the rule); the reason line violated it from the side nobody measured.

## Decision

The pill keeps one-line height for every state; the reason and the cause's actions move into a popover anchored on the pill (the card menu's fixed-position idiom, dismissed by the same global outside-mousedown effect plus Escape, anchored from the pill's bounding rect).

- **Every failed pill opens it**, including the final ones (http/empty/redirected): the popover is how the reason is read at all, and a final failure has content but no action — reason only. The pill's red glyph/color and the hover tooltip (the title attr) stay as the no-click fallback.
- **The actions are the taxonomy's, unchanged**: retry (`重新抓取`) for `unreachable`/unclassified, open-in-browser (`在浏览器打开原文`, in-app Sidebar Browser when probed, external else) for the wall codes — they just live one click deeper, inside the popover. What a click on the pill DOES changed: reveal, not fire.
- The tooltip copy follows: it now says "click for details (and retry)" instead of promising the action itself.
- The popover closes itself when the failure settles: it renders only while the entry's state is `failed`, so a successful retry makes it vanish rather than go stale.

## Alternatives considered

**Clamp the reason line to one line with an ellipsis.** That is what shipped and broke the grid — a `flex-basis: 100%` line is a line however you clamp it. The grid parity rule is not negotiable, so the content leaves the card.
**Inline-expand the card on tap.** An accordion card resizes the grid under the reader's finger — the same complaint with extra steps.
**The tooltip alone.** The reason was pulled OUT of the tooltip yesterday because hover-only text reads as "failed for no reason"; the popover keeps it one tap away on touch and mouse alike, with room for the action buttons the taxonomy assigns.

## Consequences

- Failed cards are grid-identical to healthy ones; the failure is still the most visible thing on the card (red pill), and its reason + way out are one tap.
- The `fire`-on-pill-click semantics of the taxonomy are gone from the wall: the pill never performs a network action directly any more — retry is a deliberate second click inside the popover, which also matches the "not a crawler with a grudge" policy's spirit.
- No new locale keys: the popover composes the existing reason/retry/open sentences; the two tooltip strings were re-worded (zh+en).

## Testing

`packages/dsh-reader` (+1 net, rewritten red-first): `tests/ReaderPane.client.spec.tsx` — the reason is absent from the card and present after the tap; the wall-code popover opens the browser and never retries; the transport popover's 重新抓取 retries; the final-failure popover carries the reason and no action; an outside click dismisses.
