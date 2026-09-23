# Agent Note: a canvas card's detail is a tab of the dock

Status: implemented

## Problem

`proposals/active/2026-09-16-canvas-space.md` §11.2 row 7 (stage ⑧) and demand ① of the round that started on 2026-09-22 ask for the same thing: clicking a card goes to the detail — for a new card too, never an in-place edit on the board. The drill shipped in M3 did that literally: `CanvasTab` held a `drilled` card id and flipped its own page between board and detail, with a 返回卡板 button on top.

Three costs came out of using it:

- **One subject at a time.** Writing is comparing. To hold two cards against each other the reader opened one, read it, went back, opened the other — and the back trip threw the first card's reading position away, because the scroll container was the board page's.
- **A tab inside a tab.** The host's right Sidebar IS a dock (`PaneNode.tabs`, `openTab` / `openResource`, per-session layout memory). Re-implementing "another card, in the same place" as page state duplicated the worst parts of that: no second tab, no independent width, and the board's own state as the price of a view switch.
- **The draft lived in the board.** `＋新卡` put an editor inside the board page's React state, so the page had two identities (list and editor) and any board operation could be performed against a half-written card.

The question this note actually records is narrower than "use tabs": **is a card detail a page or a resource?** The dock dedupes resources by `(kind, contentId)`, which is exactly the semantics the drill was missing.

## Decision

> **Seat retired the same day**, by [the canvas owns its tab strip](2026-09-23-canvas-inner-tab-strip.md): `canvasDetail`, `src/client/detail/detail-address.ts`, `detail/CanvasDetailTab.tsx`, `detail/CanvasDetailTitle.tsx` and `tests/detail-tab.client.spec.tsx` are gone from the package — the row of tabs the canvas draws inside itself took the seat. What this page decided still stands and is what that note builds on: `cardTitleOf` as the one title rule, every gesture rule in `CanvasDetailView` (⌘⏎-only, the IME guard, the pen owning `Escape`), and the two host facts (`title` is captured once at open and never refreshed; `close` takes a branded `TabId` with no interception) — including the × gap recorded below, which the inner strip closed from the half the plugin does own. Read the rest as the decision it was.

**The detail is a resource of this package's `canvas` type.** `canvasDetail` is the tab kind, `dsh-resource://canvas/<canvasId>/<cardId>` the address (`src/client/detail/detail-address.ts`), and `…/_draft` the one address a canvas's unsaved draft gets. The consequence the whole stage exists for is free: clicking a card twice focuses the tab already showing it, clicking two cards opens two tabs in the same pane, and the plugin keeps no tab bookkeeping of its own.

- **`_draft` is outside the card-id grammar by construction, not by convention.** `CARD_SEGMENT` mirrors what `makeBoardId('c', …)` mints (`c_` + 9 base36 time chars + base36 random), and a sentinel that does not open with `c_` can never be spelled by the mint — so no card can be handed the draft's address, and the segment stays a shape check rather than a lookup, which is what lets an address resolve without asking the disk.
- **The draft's category travels in `navigation.params`, not in the address.** One draft address per canvas is what makes the `＋新卡` menu unable to stack a second blank draft: picking another kind re-delivers params and re-categorizes the tab that is open. (This is the seam where stage ⑤'s catalog meets the dock — the id is a board-scoped string, so the client is allowed to carry it in params.)
- **`openResource` throws outside `dsh-resource://`.** Both face members (`openCardDetail`, `openCardDraft`) wrap the call and `ctx.logger.warn` on failure, so a seat with no mounted session leaves the board intact rather than throwing through a click.
- **`selectCard` / `clearCard` are gone and the store lost its `cardId`.** `space/selection.ts` is now `{ canvasId, rev }`: which card a tab shows is its address, not the board's selection. Keeping the old face members "just in case" was the alternative, and it is the one thing AGENTS.md forbids — a member nobody reads is a contract nobody maintains.
- **The chip's live text rides params, through the `sidebar.right.pane.tab.title` inject seat.** The host captures a tab's `title` once at open time and never refreshes it, while re-opening the same card re-delivers params and bumps `revision`. So `CanvasDetailTitle` renders `title · params.heading`, and `revision` moving is what re-reads the card. That is also why the heading is computed at the click site.
- **One title rule, in one module.** `cardTitleOf` (`src/card-format.ts`) is the html `<title>` first, the plain first line capped at 36 characters second; `prompt.ts`'s two private copies were deleted and the chip's heading comes from the same function, so the words the model reads and the words on the chip cannot drift.
- **Closing goes through the seat's own `tab.actions.close()`.** A face member `closeDetail(tabId: string)` was the obvious write-up and is impossible: `TabId` is a branded type (`ui-dockkit`'s `Branded<'TabId'>`), so a `(tabId: string)` can never satisfy `ISidebarRight.close`. The tab already holds a correctly-typed closer, and it needs no host change.
- **Both types register under the same `RegistrationToggle`.** The visibility criterion is about whether a session can reach the canvas tools, and a detail tab without a board is not a thing anyone should be offered.
- **Every board re-read folds its own summary back into the switcher.** `CanvasTab`'s load effect now writes `summarizeBoard(board)` into the row it just read. That closes a real staleness bug the new seat exposes: the switcher's card count used to refresh only on the board tab's own writes, so a card added from a detail tab (or by an agent tool) left the switcher reporting a number nobody had earned.
- **The image subscription belongs to the tab that paints.** `useImageRev` moved out of the board (which renders no images) into `CanvasDetailTab`, one subscription per open tab, which is what the memoized `MarkdownText` needs to repaint when its bytes land.
- **Not solved, recorded**: the chip's × is a second exit this page cannot gate. `ISidebarRight.close` takes a tab id and offers no interception, so hand-closing a draft tab drops the draft silently. The proposal carries it as the stage's one open gap.

## Alternatives considered

- **Keep the drill, add a "open in second tab" button.** The button would have to invent the dedupe the resource layer already gives (`(kind, contentId)`), and it leaves the board page holding two identities. Rejected as the strictly worse copy.
- **Put the cardId in `navigation.params` and keep one `canvasDetail` page tab.** Rejected with the strongest reason attached: params are not part of `contentId`, so the host would fold two different cards into one tab — the exact behaviour the stage exists to get.
- **One draft address per category (`…/_draft-question`).** Rejected: the `＋新卡` menu then opens a blank tab per category clicked, which is the "second blank draft" the address module's docblock names as the thing to prevent. Params carry the kind instead.
- **A dedicated resource type for drafts.** Rejected: `draft` and `card` are one subject's two states, and splitting them splits the `canOpen` grammar for no benefit.
- **Refresh the chip title by re-registering the definition (or by patching the tab record).** The first is a global side effect per click, the second reaches into another package's state. `params` + the title slot is the documented path and is what taskpilot's job chips already do.
- **Report `focusCanvas` from the detail tab too.** Rejected: focus is which canvas the session's tools should target, and the board is the surface that chooses it. Two seats reporting the same canvas on different gestures is how the tools start disagreeing with the screen.
- **Leave `selectCard` on the face as a no-op for compatibility.** Rejected — see the decision bullet; the package is 0.4.x and every consumer is in this repo.

## Consequences

- **The board page is a reader and a chooser only.** `CanvasTab` no longer imports the detail view, the discard `Modal`, or `newCard` state; the tests assert it as a property (`queryByPlaceholderText(/写点什么/) === null` while the board is up). Draft state now lives in the tab, so switching canvases cannot strand a half-written card — and closing the tab without saving is the only way to lose one (see the × gap).
- **Many tabs of one canvas coexist.** Each reads the board and writes under the version guard, so two tabs editing two cards of the same canvas are the case `replaceIfVersion` + re-root-once was built for. A detail tab always shows the canvas named in its own address, even after the board switches to another canvas — resource addressing implies this, and it is what the reader asked for (a card stays where you put it).
- **Bundle: 436.35 kB → 446.00 kB (gzip 96.62 kB)** for the seat, the address module, the title component and the per-tab subscription. No new dependency.
- **Copy changed with the mechanism**: `detail.back` is gone; `detail.tabCard` / `detail.tabDraft` name the chips; the guide, `card.enterDetail`, `detail.createHint` and `detail.empty` now speak of a tab rather than of a page to return from.
- **jsdom cannot lay out the pad**, so the drawing tests keep the existing fixture pattern (`getBoundingClientRect` + `setPointerCapture` patched onto the field). See Testing for the one trap in it.

## Testing

- `pnpm --filter @khorsheed/dsh-canvas build` green; `pnpm --filter @khorsheed/dsh-canvas test` — **20 files / 324 green** (19 / 319 at stage ⑤: the new file adds 11 tests, and six draft tests moved out of the board spec into it).
- `tests/detail-tab.client.spec.tsx` (new): the address half (the card an address names; a string outside the grammar answers with the notice and **no board read**; a `rev` touch re-reads; render/source/split saves through `patchCard`; a pointer paints because THIS tab reads the feed; an HTML card inlines inside the sandbox CSP), and the draft half (⌘⏎ only plus the IME guard, the category that arrived as params, a drawing-only save, an untouched draft closing silently then a drafted one asking exactly once, and the discard question naming 「1 笔」 and not 「个字」).
- Two traps the new file paid for, both worth repeating: a `fireEvent.pointerDown` fixture must pass **`clientX`/`clientY`** — spreading `{x, y}` reads as (0,0), the sampler sees a zero-length stroke, and the failure surfaces as "spy called 0 times" three layers away; and the pen owns `Escape` while it holds the field, so a test that wants the tab's exit gesture has to press it twice (which is the user-visible rule, now asserted rather than assumed).
- `tests/tab.client.spec.tsx`: the six draft tests moved to the tab spec (they were board-page tests only because the page owned the draft), the drill describe replaced by five stage-⑧ openings — a body click and the pencil both call `openCardDetail(canvasId, cardId, title)`, an HTML card's title is its `<title>` and not its markup, the archive well's card opens too, the `＋新卡` menu calls `openCardDraft(canvasId, category.id, label)`, and the board never turns into an editor.
- `tests/detail.client.spec.tsx`: the reader harness is now address-driven (a mutable target behind getter props), because the store no longer carries a card.
- Repo gates: `pnpm run check:hygiene` on the staged set, `pnpm run verify-agent-note-format` / `verify-agent-note-classification`, and `pnpm exec tsx scripts/verify-translation-pairing.mts --write` for this note's own pair.

## Related

- [the canvas owns its tab strip](2026-09-23-canvas-inner-tab-strip.md) — same day, same subject, different seat: the row of tabs now lives inside the canvas, and this page's `canvasDetail` kind was deleted rather than kept beside it.
