# Agent Note: the canvas long-form view is gone, and so is the vocabulary that was wrong

Status: implemented

## Problem

The v2.2 round shipped to prod 3080 as `@khorsheed/dsh-canvas` 0.4.4 and the user opened it, screenshotted the board, and asked 符合预期吗. Two approved decisions were missing from what shipped — not new requests, and not judgment calls that went sideways:

- **The rename never happened.** `proposals/active/2026-09-16-canvas-space.md` §10.7 carries a naming table that landed inside stage ②, the stage the user explicitly nodded to. The board still read `碎片 / 依据 / 资料` and the top bar still read `[卡板 | 成稿]`.
- **The long-form view was still there.** The prototype they clicked through strikes it out — `proposals/prototypes/canvas-link-compose-draw.html:313` renders `<s>卡板 | 长文</s> → 只剩一档`, and line 279 of the same page says 长文那一档已经拿掉. I had recorded the deletion as *unruled* in §11.2 and §11.8 and therefore did not do it.

Both failures share one mechanism: **I ported from the prototype by asking "what should this page show" instead of "what does the approved artifact already say".** The same error had already dropped the paste handler (round 5) and the category manager (round 6); this time it dropped a *removal*, which is why it survived a screenshot review — an absent feature is invisible, an absent handler is not.

## Decision

- **Delete the long-form view end to end.** `src/client/tab/DraftView.tsx` (236 lines), the `readDraft` / `writeDraft` Remote verbs, `DRAFT_FILE_NAME` and its four request/result types, the `page` state and the `[卡板 | 成稿]` toggle in `CanvasTab.tsx`, 87 lines of `CanvasTab.module.css`, 8 locale keys removed **as zh/en pairs**, and 6 tests.
- **Rename the content-role vocabulary, on both sides of the model boundary.** `kind.fragment` 碎片→灵感, `kind.grounding` 依据→共识, `kind.reference` 资料→来源 in `src/client/locales.ts` — and the same three words in the **model-facing Chinese**: the theme paragraph and the grounding guard in `src/prompt.ts`, the two `kind 取值` descriptions and the `source` parameter description in `src/tools.ts`. Changing the UI and leaving the prompt is half a rename: the agent would keep answering with words the board no longer shows.
- **`卡板` disappears as a word.** It was a *view name*, and with one view left there is nothing to name. Prose that meant "the board screen" now reads 板面 (README) or 画布 (the Esc hint, which points at the tab the user actually sees).
- **English kind labels stay put.** `Fragment / Grounding / Reference` are the source terms of this concept; §10.7 ruled that the *Chinese* words misdescribe the things (依据 reads as evidence, and `grounding` means a shared understanding, not proof). Translating the Chinese fix into English would have thrown away the accurate term to fix a problem English never had.
- **`document` survives.** §10.7's table row says 文档（随轴合并删除）, and the section's own later lines say the opposite (内置 id 一个不删; the default catalog is 灵感/问题/共识/来源/文档). Dropping the id would make `normalizeCard` discard every existing document card on the next board read — the user's board has a 7,700-character one. The table row is annotated as overturned rather than quietly edited.
- **The orphan is documented, not migrated.** `draft.md` files already on disk under `$DSH_HOME/state/canvas/<id>/` are neither read nor deleted; both READMEs say so in one sentence. An uninstall already promises to keep that directory, so silently deleting user files behind the rename would have been the worse of the two lies.

## Alternatives considered

- **Rename the toggle to `[卡片 | 长文]` and keep the view** — §10.7's literal instruction. Rejected: the prototype that came later struck the long-form half, and a one-option toggle is not a toggle.
- **Keep `readDraft`/`writeDraft` as no-ops for compatibility** — rejected. This package self-mounts and its state directory is its own; a verb that returns nothing is a surface area that lies about what the plugin can do.
- **Delete `draft.md` on first boot** — rejected: it is user text, the uninstall contract says it is kept, and "we removed the feature so we removed your file" is not a migration.
- **Migrate the long-form content into a `document` card** — rejected as unasked-for. The proposal's own evidence is that nothing ever wrote a model-side draft, so the files that exist are hand-written; a silent reformat of someone's document is worse than an orphan.
- **Rename in the UI only** — rejected; see the model-boundary bullet.
- **Also delete the `canvas_propose_draft` roadmap item** — nothing to delete: it was never implemented. `exportDraftToWorkspace` likewise exists only in the proposal text. Both are now recorded as dead in the README's 仍不做 list, which is where a reader would otherwise still expect them.

## Consequences

- **This is a breaking shrink of a published Remote surface.** `canvas/readDraft` and `canvas/writeDraft` disappear from the generated type namespace. Nothing in this repository consumes them, and the package has not been npm-published at this line, but an out-of-tree consumer would break and we have no way to know.
- **`draft` is an overloaded word in this package and the collision is now load-bearing.** Roughly 70 matches belong to a *different* feature — the unsaved new-card draft that 「＋ 新卡」 hands to the detail page (`contract.ts`'s draft-card members, `CardPad.tsx`, `CanvasDetailView.tsx`, `draw.hintDraft`, the discard confirmation). Anyone deleting "draft code" here will break the flow the user approved the same day. The three tests that fence it: `never lets a stray click create the card: the draft saves on ⌘ only`, `drops an untouched draft without asking, and guards a drafted one exactly once`, and all of `tests/detail.client.spec.tsx`.
- **`.seg` in `CanvasTab.module.css` was dead on arrival and is deleted with it.** The three components do *not* share that stylesheet — `CanvasDetailView` and `BoardView` each import their own module with their own `.seg` — so the shared-chrome warning that protected it was wrong. `.spacer` and `.notice` in the same file are genuinely still used by `CanvasTab.tsx`.
- **Test count moves 295 → 289** (−6, all of them the deleted feature) and `lib/client.js` **421.73 → 406.74 kB, gzip 90.14 → 87.37 kB**.
- **Open, and now named**: the shipped board CSS is a faithful port of `canvas-card-styles.html` but a divergent port of `canvas-link-compose-draw.html`. Four structural declarations never crossed over — `.card{min-height:84px}`, `.foot{margin-top:auto}` (the pinned footer is what makes a row of cards bottom-align), chips scrolling instead of wrapping, and `font-weight:600` on the active chip. Which prototype owns *style* and which owns *interaction* was never settled, so this is a question for the user, not a backlog item I may quietly pick.

## Testing

- `pnpm --filter @khorsheed/dsh-canvas build` — gen-typert regenerates the remote namespace before the client-face `tsc` consumes it, which is the only reason the verb deletion typechecks.
- `pnpm --filter @khorsheed/dsh-canvas test` — 18 files / 289 green; the category-2 draft tests above re-run by name.
- `pnpm run check:plugins` — 39 packages scanned, 0 findings.
- `grep -rn "readDraft\|writeDraft\|DRAFT_FILE_NAME\|DraftView" packages/canvas/src packages/canvas/tests` — empty.
- `grep -c "卡板\|成稿" packages/canvas/src/client/locales.ts` — 0, including prose.
- The rename is asserted where the UI is asserted: `tests/tab.client.spec.tsx` now clicks `灵感` and `返回画布`.
