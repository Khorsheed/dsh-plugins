# Agent Note: an acceptance pass on the shipped canvas, and the six things it found

Status: implemented

## Problem

The canvas round's demands ①–⑧ shipped as 0.4.5 and passed a canary on 3080, which proves the board loads — not that it reads well. The user then used it for real and came back with seven findings, all of them about the surface rather than the data model:

- the 「＋新卡」 button was **not visible** next to the canvas name, and the canvas switcher's own label was called ugly;
- the link view had **several lines of explanatory prose** under the board;
- **wires ran through the cards** they connected;
- the lane-rename box looked **worse than the prototype** it was built from;
- the drawing pad **overlapped the card's own body text**;
- the same overlap produced a **floating pencil row on top of the prose** in the rendered view;
- and opening a card had become a **host right-sidebar tab**, when the discussion had been about tabs *inside* the canvas.

Six of those were fixable on the spot. The mechanism behind each was different, and two of them were invisible to every test in the package — which is the part worth recording.

## Decision

- **An entry sits beside the thing it acts on, not at the end of the reading row.** 「＋新卡」 moved from the far end of the topbar to immediately after the canvas-name switcher. The button was always rendered; a `flex: 1` spacer pushed it ~1500 px away on a wide dock, so on a 1512 px viewport it was simply off-screen. A control that adds to *this canvas* cannot belong where the row's eye-leads go, because on a wide panel the eye and the button are in different panels.
- **The switcher gets chrome; its rows do not.** `.topic` became a bordered, padded pill with an ellipsised name and a dimmed chevron (and `.topicName` is a new span, since ellipsis needs a min-width-0 box that a flex child's text node is not). The dropdown's rows went the other way, flat with a hover background: **a trigger and its menu sharing one rule is how a menu ends up full of little boxes.**
- **A changelog is not UI copy.** `link.hintData` — a paragraph about `canvas.json` gaining `links` and `lanes`, aimed at whoever migrated the file — is deleted from both locales, and `link.hint` is compressed to one gesture line. The board explains itself by being dragged; a legend belongs in the note, not under the drawing.
- **A wire is anchored on the two edges that face each other, and which edge that is stays geometry.** `wirePathOf` now goes through `wireAnchorsOf`, which picks the axis by dominant delta and then the pair of opposing edges, so the line leaves card A on the side card B is on. Card B to A's left means B's left edge is *not* the target — A's right edge is not either; the endpoints become A.left and B.right. The stored pair stays `{from,to}` with no side field, because **a stored side strands the tail the first time the user drags a card past its neighbour**. Alongside it each card now carries **two** ports (`data-port="<id>:left"` / `:right`): one dot taught people to walk across the board looking for the side that draws well. Which port the hand found sets where the *live* line starts; the finished line ignores it.
- **The push floor survives the change, and its tests changed shape with it.** `WIRE_MIN_PUSH` (24 units) still keeps near neighbours bulging rather than collapsing into a seam that reads as a rendering error; what moved is that the push is now applied along the *chosen* axis from the *chosen* edge, so every pinned `d` string in `tests/layout-geometry.spec.ts` and the mount assertion in `tests/link.client.spec.tsx` were rewritten to the new contract — plus a property test that asserts, over a grid of placements, that **no endpoint ever lands inside either card**, which is the failure the user saw.
- **`outline: none` is a required declaration on a styled `<input>`, not a nicety.** `.laneInput` inherits `<button>`'s geometry from the prototype but is a real input, and Chromium's default focus ring is thick enough to read as a selection box around the whole lane. The border carries focus instead, exactly as `.catInput` in the category panel already does.
- **A flex item with an explicit `min-height` has no content floor.** This is the one that produced two of the seven findings from a single root cause. `.root` is a column flex container with a definite height and `overflow-y: auto`; `.body` declared `min-height: 60px`, which *replaces* the `min-height: auto` a flex item gets by default — so a 7000-word card was shrunk to a 239 px box while its prose kept painting at 1365 px, straight through the drawing pad below it. The pad looked like an overlay on the text; the pencil toolbar looked like a floating bug. `.body` and `.pad` both take `flex: none` now, so the page scrolls instead of the content colliding.

## Alternatives considered

- **Ship `@xyflow/react` for the wires** — already rejected for the whole stage in [the link view note](../feature/2026-09-23-canvas-link-view.md); its edge anchoring would have been the strongest argument to revisit, and the fix above is 30 lines in a layer that already has 50 tests.
- **Store the anchor side per link** (`{from,to,fromSide,toSide}`). Rejected: it makes the layout data a record of how the line was drawn rather than of which two cards are related, and card drags — which are constant — would invalidate it with no way to notice.
- **Put the whole hint behind a help affordance** (a `?` popover). Rejected: the demand was "why is there a wall of text here", and one gesture line is short enough to be part of the panel rather than something to open.
- **Give `.body` a `min-height: auto`** to restore the flex default. Rejected in favour of `flex: none`: `min-height` was also carrying a real wish — an empty card should not collapse to nothing — and `flex: none` + the 60 px floor keeps both intents visible instead of one doing double duty.
- **Re-derive the pad's position from the body's measured height in JS.** Rejected: that is a workaround for a CSS bug wearing the costume of a feature.

## Consequences

- **No component test in this package could have caught the overflow, and that is now load-bearing knowledge.** jsdom never lays out, so `tests/*.client.spec.tsx` sees a `.body` box and a pad box that merely *exist*; the assertion that would fail is `element.scrollHeight > element.clientHeight`, and there is no `scrollHeight` to read. The mechanism was confirmed outside the suite instead: a throwaway HTML replica of the detail-page CSS measured in headless Chromium (`chrome-headless-shell --dump-dom`, result written into `document.title`) reported `rectH 239 / contentH 1365 / overflows 1126` before the fix and `1365 / 1365 / 0` after. **Layout bugs in this package need a browser pass, and the acceptance round is that pass.**
- **`link.hintData`'s removal is a locale-pair removal**: both dicts lose the same key, so no language can render an orphan sentence. The migration facts it carried are not lost — they are in the link-view note's Consequences, which is where a changelog belongs.
- **Two ports per card means twice the hit area near a card's corners**, but the ports are 12 px and sit outside the node box (`left:-6px` / `right:-6px`), and `startWire` stops propagation, so a press on a port can never also be a node drag.
- **Every pinned wire string in the specs is now edge-anchored**, so a future change back to centre anchoring fails loudly rather than silently re-deriving. That is the point of pinning `d` at all.
- **The `＋新卡` position is a convention to apply again**: it now sits before the attach chips, and the chip row keeps its own scroll. Anyone adding a topbar control should ask what it acts on before choosing which side of the spacer it goes.
- **The seventh finding shipped separately, in the same round.** Opening a card as a *host right-sidebar* tab was stage ⑧'s shape, and the answer to it was a product decision rather than a fix: tabs inside the canvas surface, where some rows are canvases and some are cards. That ruling and the change it produced are in [the canvas owns its tab strip](../feature/2026-09-23-canvas-inner-tab-strip.md); the six items above are all still true on top of it.

## Testing

- `pnpm --filter @khorsheed/dsh-canvas build` (gen-typert → host tsc → client tsc → tsdown) then `pnpm --filter @khorsheed/dsh-canvas test` — **23 files / 454 green** (449 before this round; +4 geometry, +1 link-view).
- `tests/layout-geometry.spec.ts` (+4, 50 total): the two opposing-edge pins, the axis swap on a 45° pair that the old code drew horizontally, the true-overlap pair whose endpoints sit outside both boxes even when the boxes overlap, and the property pin over a placement grid that no endpoint ever falls inside a card.
- `tests/link.client.spec.tsx` (+1): a left-port drag stores the same pair and draws the same `d` as the right-port one, and the per-side mount (four `data-port` hooks for two cards). `portOf` gained a `side` argument defaulting to `right`, so every pre-existing drag test still exercises the right-hand edge.
- The six surface fixes were **verified by eye in a running host**, not by test: `~/.dsh-lab/profiles/canvas-v2-test` on port 3091, packed from this build, checked against the seven reported findings one by one.

## Related

- [the canvas link view is a second face of one board](../feature/2026-09-23-canvas-link-view.md) — stage ⑥, whose wire rule this change narrows.
- [the card detail page is a tab](../feature/2026-09-23-canvas-detail-tab.md) — stage ⑧, whose shape the seventh finding disputes.
- [the canvas owns its tab strip](../feature/2026-09-23-canvas-inner-tab-strip.md) — the seventh finding, ruled and shipped.
- [each canvas owns its card categories](../feature/2026-09-23-canvas-category-catalog.md) — `.catInput`, the focus-border precedent this round copies.
