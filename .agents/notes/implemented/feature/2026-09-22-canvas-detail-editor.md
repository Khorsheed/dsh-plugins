# Agent Note: the card detail page becomes the canvas's only editor — and it takes a pen

Status: implemented

## Problem

Four orders landed on `@khorsheed/dsh-canvas` at once (user, verbatim): ① click a card into a detail page instead of editing in place on the board, ② the detail page must accept pasted markdown / HTML / images and render them, ③ the detail page must support free-hand drawing (so a model can later be pointed at it), ④ the board's cards look wrong. The review gate for all four was procedural and hard: **"先画到 html 给我体验看看，体验 OK 之后你可以按照对应的交互来考虑如何实现"** — six clickable rounds in `proposals/prototypes/canvas-link-compose-draw.html` before a line of package source moved.

Under that sat one structural problem the rounds made visible: the board had an in-place textarea AND the detail page had an editor, so every new capability had to be built twice — and the board's textarea fought the renderer it was sitting next to (the whole card's format is sniffed from its finished text, so an edit-in-place surface is exactly where a format verdict gets made twice, differently).

## Decision

One editor, one seat, and a drawing that is content.

- **The board is read-only**; the detail page (`detail/CanvasDetailView.tsx`) is the only place a card's body changes. "+ New card" hands its draft over to that same page — the draft's words and ink live in the TAB's state (`newCard` in `tab/CanvasTab.tsx`), and the detail page reaches them only through the `CanvasDetailCreate` callbacks, so a draft never exists as a half-card. A draft page opens in **source** mode (`if (drafting) setMode('source')`): an empty render pane is not a writing surface, and the "+ New card" gesture's whole point is that the keyboard is already there. Every selection change returns the body to render mode — and puts the pen down.
- **The exit guard counts words OR ink, once.** A discard confirmation (`Modal`, two buttons) appears only when the draft holds text or strokes; an untouched draft leaves silently, and a card already on the board is never blocked (its edits are already saved — the open question of whether it should also be guarded is 11.8 ⑥, still unruled).
- **A drawing is content, not a caption.** `card.draw` is a typed field (`CanvasStroke[]`), `putCard` accepts an **empty body when ink is present**, and the drawing rides the model's card form: `promptFormOf` appends `drawPromptOf`'s `<board width height strokes>` point block in all three branches, so an agent that reads a card reads its ink as geometry, never as a raster it would have to be handed.
- **The pen commits a stroke; the keyboard saves a draft.** A finished stroke writes the whole point list through `patchCard` immediately, so the pad has no dirty flag and no save button of its own — and `mutate`'s toast key became optional, because a stroke that announces itself on screen has already said what it came to say. `draw: []` means "cleared" and stays distinguishable from "no `draw` key": without that split, 清空 could never be saved.
- **Storage is the point list in a logical box, never an outline and never pixels.** `{ pts: [{x,y,w}], color }` in the 600×400 (3:2) box; the outline is derived at render by `perfect-freehand`. Measured on one 24-point stroke: **287 B as points, 834 B as a tapered outline**. Coordinates in box units are what lets a stroke drawn in a 378px sidebar read in the same place on a wide panel; a tolerant `normalizeDraw` clamps every point, so a hand-edited `canvas.json` stays openable.
- **Three exits, an eraser that takes whole strokes, and a pad that stays.** §11.2 row 8's three complaints became: the tool strip sits ABOVE the field, the eraser lights the one stroke it would remove (12px screen tolerance), and after the pen is put down the field remains below the text as a read-only figure with 点一下接着画. Esc, the pen button, and leaving the card all put the pen away; ⌘⏎ rides the pad's own window listener so the draft's save survives the pen taking the page.
- **Pasted images are a pointer line, not bytes in the card.** Pixels go to the host's content-addressed attachment store (`ctx.get('attachments')`) and the card keeps `attachment://…` (markdown) or `<img src="attachment://…">` (HTML); both render arms resolve that scheme alone through a 24-entry LRU of **`data:` URLs** (not blob object URLs: no revoke lifecycle, no orphaned objects, eviction is a map delete).
- **`perfect-freehand` is pinned exactly at 1.2.3** and bundled into `lib/client.js` by tsdown — no host install, no profile row. The pin is the record of a measurement: its `StrokeOptions` has **no `caps`** option (it is `start:{cap}` / `end:{cap}`) and there is **no `toSvgPath`**, so the polygon→path walk in `draw.ts` is ours. Moving that pin is a re-measure, not a range bump.
- **The §11.4 verdict was taken as nodded, not given.** `card.draw` over §10.8's "vector JSON in `card.text`" was still listed 未裁决 with "没点头之前…阶段 ⑦ 不开工" when "OK，你开动吧" arrived. It was read as approval for the whole round. If that reading is wrong the revert is one commit: the data face only adds an optional field, and a tolerant read means rolling back strands nothing on disk.

## Alternatives considered

**Edit in place on the board, keep the detail page as a reader.** That was the shipped shape and it lost on the orders: two editing surfaces means paste, images and drawing each get built twice, and the second copy is the one that disagrees with the renderer. Retired rather than rewritten.
**The point list inside `card.text` (§10.8's original).** Rejected for the three reasons §11.4 names, the first two now load-bearing in code: a point block folded into prose is a coordinate dump handed to the model as narrative, and `detectCardFormat` sniffs the whole body — a JSON island growing inside it makes "is this card md or html" undecidable. The 256KB text cap and the board's clamped summary are text-shaped measures too.
**Store the tapered outline (or a raster).** Rejected on bytes (2.9× per stroke, measured) and on the model edge: a raster is something the agent would have to be *given*, while points are something it can *read* off the card it is already shown.
**Excalidraw / tldraw for the pen.** Rejected earlier on the same page's evidence: tldraw carries a non-production license plus telemetry, Excalidraw is MIT at 46.8MB for a feature that is one stroke list. `@xyflow/react` stays parked at stage ⑥ (links and lanes), which is the only thing that justifies a graph library.
**A dirty flag and a save button on the pad.** Rejected: it would install a second save model next to ⌘⏎, and a stroke nobody can save on its own is also a stroke nobody can undo on its own. Per-stroke commits reuse the board's existing version fence instead of adding a second one.
**Blob object URLs for pasted images.** Rejected: `revokeObjectURL` is a lifecycle to get wrong and a way to leak orphaned objects; a `data:` URL's eviction is a plain map delete.
**Registering detail as its own tab kind (`canvasDetail`, stage ⑧) in this wave.** Deliberately not done — the dock's layout is memory-only per session, so "open a card as a tab" is a working-area promise the round does not make yet.

## Consequences

- The canvas has one editing surface, and the three new capabilities cost one seat each rather than two.
- `lib/client.js` grows to 421.55 kB (gzip 90.13 kB) with `perfect-freehand` inside it; the deployment installs nothing extra.
- Drawing works in tests and in jsdom, **not yet under a real cursor**: the acceptance click happens on 3080 (that is what the user asked to see). The known visual risk is the field's geometry (aspect-ratio + the absolutely positioned figure), not the stroke math.
- Ink costs no store: a stroke is a few hundred bytes inline in `canvas.json`, so erasing one is a rewrite with nothing left behind. (The never-collected bytes in this wave are the **pasted images'** — `ctx.fs` has no delete, and that limitation is documented in both READMEs.)
- Unruled and on purpose: pressure (`w` comes from screen speed), bitmap export for multimodal reference, and whether a saved card with unsaved words should also guard its exit (11.8 ⑥).
- Old boards open unchanged — `draw` is an optional field with a tolerant read, so this wave can be reverted without a migration in either direction.

## Testing

`packages/canvas` (this round: 197 → **295 tests, 18 files green**; `pnpm --filter @khorsheed/dsh-canvas build && test`).

- `tests/draw.spec.ts` (new): box mapping (including a zero-size and an offset rect), sampling distance/time gates and the point cap, width clamping and its screen-relative speed, eraser hit/miss/empty, `appendStroke` caps, outline bleed kept within `±MAX_DRAW_WIDTH`, and that a single point is a dot.
- `tests/board.spec.ts`: a drawing-only `putCard` (empty text accepted), the round trip through `readBoard`, per-point clamping of an out-of-range/hand-edited `canvas.json`, and `patchCard` replace / clear / leave-alone — including "the last stroke can be erased: clearing is a gesture, never a trap".
- `tests/prompt.spec.ts`: the `<board>` block's shape, one line per stroke, and that it rides a plain card, stands alone as content, stays with an HTML card's pointer, and makes `N-stroke drawing` the summary.
- `tests/detail.client.spec.tsx`: a stroke reaches `patchCard` with the first point's exact coordinates, ink appears with the pen down and 撤一笔 takes one at a time, the eraser removes exactly one whole stroke, a miss toasts and writes nothing, Esc puts the pen away, a tap never stores a stroke, and a proposed card has no pen at all.
- `tests/tab.client.spec.tsx`: ⌘⏎ saves a drawing-only draft (`text: ''` plus ink), the discard question names the ink ("1 笔", not "个字"), and the board renders a figure for a drawn card.
