# Agent Note: the canvas owns its tab strip, and stage ⑧'s dock tab goes back

Status: implemented

## Problem

Stage ⑧ made a card's detail a tab of the HOST right-sidebar dock, which fixed a real thing: the board kept its scroll and its filters while you edited, and two cards were two tabs instead of one screen the board flipped to. But it put the strip of open things one chrome layer away from the thing being looked at. The user's acceptance pass says it plainly: "打开卡片怎么变成新增 sidebar 标签，我们讨论的不是在画布内部有多个标签吗" — the discussion had always been about tabs *inside* the canvas, where some tabs are canvases and some are cards. (That note lists it as its seventh finding and the user's message numbers it 6, because the note splits one reported item into two; it is the finding the acceptance pass left open.)

Two other facts pushed the same way. The host chip said 画布 for every one of those tabs, so the dock could not tell you which card you were looking at; and the host closes a tab by its id with no interception, so ×-ing a drafted tab dropped the words silently — a gap stage ⑧'s note had already written down as unfixable from the plugin side.

## Decision

`packages/canvas` registers **one** right-sidebar tab type again. Inside it, `tab/TabStrip.tsx` is the surface's own row of tabs and `CanvasTab` is a router over the showing row: a board row is the board page (its header + `BoardView`/`LinkView`), a card row and a draft row are `CanvasDetailView` — the reader stage ⑧ shipped, unchanged, just mounted here. The canvas switcher is now the ＋ at the strip's end and only puts rows on the strip; the canvas name in the board header is text, not a door.

- **A row's id is derived from its subject** (`b:<canvas>` / `c:<canvas>:<card>` / `d:<canvas>`), so dedupe is a property of the id: clicking the same card twice cannot seat a second row, and one canvas has exactly one draft row. Re-picking a kind in the ＋新卡 menu therefore RE-CATEGORIZES the open draft (its place in the strip is kept, its payload moves) instead of seating a second blank.
- **The store holds rows, not a pointer.** `space/selection.ts` went from `{canvasId, cardId, rev}` to `{tabs, active, rev}`, with `canvasId` derived from the showing row — so a card's row still points the main-session tools at the canvas that card belongs to, which is what `focusCanvas` reports.
- **The strip survives a reload** through `sessionStorage`, row by row through a shape check; a payload the code cannot vouch for is dropped whole. The cap is 16 rows and the eviction order is card → board → never the row just added: re-opening a card is one click on it, losing a board row costs a trip through the ＋ menu, and losing a draft costs words.
- **A draft's words live in `CanvasTab`, keyed by row id** — not in the store, and not in the reader. That is what makes turning tabs and back keep them, and it is what lets the × ask. The reader's textarea is uncontrolled, so the row is mounted under `key={row.id}`: an editor's DOM value must never travel from the card you looked at last into this one.
- **The × is ours, so the discard question is answerable** — including on Esc and on the draft's own leave gesture, which the host chip's × never was.
- **The dock chip still shows live text** through the `sidebar.right.pane.tab.title` inject slot (`tab/CanvasTabTitle.tsx`): the host captures `title` once at open and never refreshes it, so the registrant reads the store itself. This works because a slot inject's `ComposedProps` intersects the registrant's own `InjectFace` — a title registrant can publish `hooks.selection` AND still receive `useTabInfo`.

## Alternatives considered

- **Keep the dock kind and add the strip beside it.** Rejected: two tab systems over one set of objects is how you get a card open in the dock and a different card showing inside, with nothing telling you which is which. The user's ruling was "卡片只有一个家".
- **Keep the dock address as the row id** (`dsh-resource://canvas/<canvas>/<card>`). Rejected: the address existed to buy the host's dedupe, and deriving an id from the subject buys the same thing without a grammar to validate — which is why `detail/detail-address.ts`, the `_draft` sentinel and the `SidebarRightResourceParamsMap` augmentation are gone rather than repurposed. A stored card id cannot collide with a draft row once the draft's id is `d:<canvas>`.
- **Put the draft text in the store** so it survives a reload too. Rejected: the store is shared across every seat of the composition, and a keystroke per character through a shared snapshot is a re-render fan-out for the one thing that has exactly one reader. A reload may lose a draft's words; a tab turn does not.
- **Give board rows a heading too, so the chip reads the canvas's NAME.** Rejected on ripple: `openCanvas`'s signature, the stash's shape check, the row-swap guard, the label resolver, the switcher prop and three specs all move so that a chip already reading 画布 correctly can read 为什么人们不愿表达异议 instead. A board row is the surface's own name; a card row is where the ambiguity was, and it carries its heading.
- **Let the row's label resolve a canvas title in the chip directly.** Same rejection one layer down: the canvas list is an async read, so the chip would need the whole list feed for a string the strip already shows.

## Consequences

- **What the host gave us is gone too**: the dock's own tab cap, its middle-click/close-all affordances, its scrollable chip strip, and per-session tab storage. Our strip is per-browser-tab storage with its own cap, and the host's × on the canvas tab still cannot be intercepted — closing the whole surface with a drafted row inside is silent, exactly as before. Only the inner × asks.
- **A stashed row can name something that has gone.** The degrade is designed and asserted: a card row whose card is gone reads 这张卡已不在板上, and an empty strip after the user closed every row reads 没有打开的标签了，点上面的「＋ 画布」… instead of the account's 还没有画布. Those are three different silences and the surface now names each separately.
- **The board's filters still belong to ONE canvas at a time**, reset when the derived `openId` moves — stage ⑧'s win (a card of the same canvas leaves them alone) is kept because `openId` does not move for it.
- **Bundle: 504.48 kB → 514.20 kB, gzip 111.78 → 114.21 kB** — ten kB for the strip, the row list and the stash, with ⑧'s seat modules (`CanvasDetailTab`, `CanvasDetailTitle`, `detail-address`, its CSS module) out of the bundle. No new dependency.
- **Layout is still untested here.** The strip scrolls sideways rather than shrinking rows, and the ＋ is sticky so a control cannot be scrolled away; jsdom never lays out, so neither claim is in a test. The 3080 acceptance pass is where they are checked.
- **`strip.canvases` / `space.new` / `tab.label` all read 画布 or 新画布**, which is what makes the switcher's trigger unambiguous next to a strip full of canvas names — and what makes `＋ 画布` the string a spec can click on. Renaming any of them moves specs in three files.

## Testing

- `pnpm --filter @khorsheed/dsh-canvas test` — **23 files / 461 green** (454 before this change; +18 in `tests/strip.client.spec.tsx`, −11 with `tests/detail-tab.client.spec.tsx` deleted, +2 re-expressed in the switcher specs).
- `tests/strip.client.spec.tsx` holds the rules a render cannot reach (derived-id dedupe, the draft re-categorization, close→left-neighbour, the eviction order, the stash round-trip and its corrupt payload) plus the routed strip and the chip. Its bench wires the REAL verbs to the store — `openCardDetail` is not a recorder here, because what this spec asserts is where the row goes.
- `tests/tab.client.spec.tsx` and `tests/link.client.spec.tsx` keep their record-only `openCardDetail` mocks: those specs assert what a gesture PASSES (which card, which heading), and the reader's own behaviour stays in `tests/detail.client.spec.tsx`. Their switcher selectors now click `画布` (the ＋ trigger) instead of the canvas-name pill that no longer exists, and every bench clears `sessionStorage` before building its store — the strip is deliberately sticky, so a bench that did not would inherit the previous bench's rows.
- Repo-wide `pnpm run build && pnpm run test` green in this worktree; `pnpm run verify-agent-note-format`, `verify-agent-note-classification` and the translation-pairing gate pass on this note's triplet.

## Related

- [the card detail page is a tab](../feature/2026-09-23-canvas-detail-tab.md) — stage ⑧, whose dock tab this retires and whose reader it keeps.
- [an acceptance pass on the shipped canvas](../bug-fix/2026-09-23-canvas-acceptance-round3-fixes.md) — the round that fixed six reported surface findings and left this one for a ruling.
- [the canvas link view is a second face of one board](../feature/2026-09-23-canvas-link-view.md) — the board face a strip row now switches between.
