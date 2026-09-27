# Agent Note: The canvas strip holds canvases only; a breadcrumb brings you back from a card (scheme B)

Status: implemented

## Problem

The [inner tab strip](2026-09-23-canvas-inner-tab-strip.md) held three kinds of row in one strip: a canvas's board, one card, and one unsaved draft. After a few rounds of use, every problem traced back to that mix:

- Opening a few cards filled the strip with card rows, and the canvases themselves got harder to find.
- A card row was labelled with its category (「灵感」, 「问题」), which did not say which card it was.
- Getting back to the board meant finding that canvas's row in the strip, and the filter, the ticked cards and the scroll position were gone when you got there (switching canvases reset them all).
- The back button was ad hoc and did not match the host's toolbars.

In the 2026-09-27 review the user picked scheme B out of several options: the strip holds canvases only, a card opens in place inside its canvas, and a breadcrumb brings you back. The user also asked to "reuse the host's own assets and style as far as possible, but make it more designed".

## Decision

**One row per canvas, and the row remembers where you stood.** A row in `space/selection.ts` becomes `{ id: b:<canvas>, canvasId, at }`, where `at` is one of three places: the board, a card (with its heading) or the draft (with its category).

- `openCardTab` / `openDraftTab` only change that row's `at`.
- `backToBoard` is new.
- `openCanvas` keeps the existing `at`, so switching away and back returns you to the card you left.
- One row per canvas means one draft per canvas, guaranteed by the structure rather than by a lookup.
- `forget(canvas, card)` sends the row back to the board only when it stood on the deleted card.
- A full strip (16 rows) evicts the oldest canvas, and a row standing on a draft goes last.
- The stash shape changed. Card and draft rows stashed by 0.4.6/0.4.7 fold into one board row per canvas on read. A draft's words never rode the stash, so nothing is lost in the fold.

**The breadcrumb (`detail/DetailCrumbs.tsx`).** The order is: ‹ back · canvas name / card name · ‹n/m› · ⋯.

- The card name is the card's first line (`cardTitleOf`), no longer its category.
- The canvas name is set one step quieter than the card name: the card is where you are, the canvas is where you go back to.
- The canvas name is itself a way back.
- ‹n/m› steps through the order the board **currently shows under its filter** (`shownCardsOf`). A card the board is not showing (filtered away or archived) gets no stepper, and neither does a lone card.
- The buttons follow the host sidebar browser's `.tool`: 28px, borderless, pale at rest, filled on hover. The icons are the host's ChevronLeft/Right (synced in through `sync-icon-artwork`), and the tooltips are the host `Tooltip`.

**The category moves to the meta row.** It shows as a host `Tag` that opens a host `Menu` over this canvas's enabled categories, with a check on the current one. Picking one re-files the card in place: an existing card goes through `patchCard {kind}`, the draft through `openCardDraft` with the new category.

**Per-canvas view memory.** `CanvasTab` keeps a map keyed by canvas id holding the filter, the ticked cards, the board/link face, show-archived, and the wire picked in the link view. The picked wire used to be `LinkView`'s internal state; it is lifted up and passed back in through `wire`/`onWire`. Scrollers carry a `data-canvas-scroll` marker, `onScrollCapture` records offsets per canvas:scroller, and a layout effect restores them when you return to the board. All of this is in-memory and never goes to `sessionStorage`.

**Every way out of a draft asks first.** The strip's × (「关闭这块画布」), the crumb's ‹ and Esc all go through one `leaveRow`: a draft with words or ink raises the same confirmation, and only after it does the row close or go back to the board. Saving a draft returns to the board.

**The entry becomes 「画布 ▾」**, with 「＋ 新画布」 moved to the top of its menu. No shortcuts, per the user.

## Alternatives considered

**Scheme A: keep card rows and just label them with the card name.** The two root problems, a crowded strip and no easy way back to the board, stay.

**Scheme C: open cards in the host dock.** 0.4.5 took this route and 0.4.6 reverted it: the host closes tabs without offering interception, so drafts went silently.

**Store the view memory in `sessionStorage`.** It is transient in-session state, and starting fresh after a reload is acceptable. Storing it would need another shape check for category ids and wire endpoints.

**Name cards by category plus a number.** The user said explicitly that the card's name should show, not its type.

## Consequences

- The strip can no longer hold two cards of the same canvas side by side. Comparing two cards means stepping with ‹n/m›, or using the link view.
- A draft comes back on its board after a reload, as before; the stash reader now says so explicitly.
- View memory is gone when the page closes.
- The dock chip reads `at.heading`: 「画布」 on a board, 「画布 · card name」 on a card.

## Testing

- `tests/strip.client.spec.tsx`:
  - Store: one row per canvas, and re-opening the same card refreshes its heading; switching away and back returns to the card; the draft is re-categorized in place; closing a row activates its left neighbour; `forget` of a card resets only the row standing on it, and `forget` of a canvas hands the view to the neighbour; a full strip evicts the oldest canvas and spares the draft row; the stash round-trips and drops what it cannot vouch for; an old card-row stash folds.
  - Page: after opening a card the strip still has one row, and both the crumb's ‹ and the canvas name go back; ‹n/m› follows the filter; stepping never carries an editor's text across; the filter is remembered per canvas; the category Tag re-files a card; leaving a draft by ‹, × or Esc asks first, saving returns to the board, and each canvas keeps its own draft; the empty-strip wording.
- `tests/detail.client.spec.tsx`: the fixture gains its category table, and the empty state uses the new wording.
