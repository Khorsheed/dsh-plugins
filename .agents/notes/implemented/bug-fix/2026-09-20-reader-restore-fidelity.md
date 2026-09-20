# Agent Note: restore fidelity — the wall's translation really comes back, late bodies land nowhere, and the position survives the translation view

Status: implemented

## Problem

Three defects in the pane's restore machinery, all of the same kind: the page memory was being WRITTEN faithfully, but what came back out did not reach the screen faithfully.

1. **The wall's translation state was mirrored and never restored.** `wallOn` / `wallBoth` / `cardTranslations` were written into the page snapshot on every change, but initialized from bare `useState` defaults — so the first post-hydration mirror overwrite erased the remembered globe and its card texts with `false` / `false` / `{}`. A remounted pane always found the wall untranslated.
2. **A late body answer landed under another entry's title.** `open()` and `fetchBody()` awaited the host and then wrote `articleHtml` with no guard: open A, go back, open B, and if A's `getEntryBody` resolved last, A's body rendered under B's title — and the translation restore, keyed on `[openEntryId, articleHtml]`, re-translated a pairing that never existed.
3. **The reading position drifted exactly in the translated view.** The anchor's in-block `offset` was pixels, valid only for the layout that measured it; a translation sets different words (Chinese runs shorter than English), so the same paragraph is a different height and the pixels pointed at a different sentence. Nothing re-measured or re-anchored on a view change after the 20-second settle window closed. (The anchor mechanism itself is [the state-boundaries note](../architecture/2026-09-19-reader-state-boundaries.md); the restore keying is [the translation-follows note](2026-09-19-reader-translation-follows-its-body.md).)

## Decision

1. **The three wall states initialize from the mount-time snapshot** (`snapshotRef`, the same copy hydration reads), so the mirror's first write carries the restored values instead of defaults. The mirror's existing guards (skip the first run, wait for hydration) already cover the rest.
2. **`openRequestRef` names the entry the detail view belongs to right now.** `open()` sets it synchronously; every async continuation that would write article state checks it first — the `getEntryBody` continuation, the no-link `getBodies` one, and `fetchBody`'s answer. `closeEntry` clears it (an effect keys on `openEntryId`). A `fetchBody` whose entry is not on screen (the card pill, a owed-fetch from an entry the reader has left) still records the per-entry facts (`fetching`, `staleBodies`) but no longer touches the article area at all.
3. **The anchor gains a TEXT offset.** `ReaderReadingAnchor` carries optional `text` / `textLength`: the character offset into the anchor block's text at record time, computed from the cached metrics (the scroll handler still reads no layout and no DOM). Both page memory and `sessionStorage` carry them; anchors written before the fields existed restore via pixels, unchanged. On restore (`offsetInBlock`), the order is: same text (`textLength` matches) → the exact pixel spot via a Range rect over the text node holding that character; different words (a translation) → the same FRACTION of the text; neither → the stored pixels. And a view change re-anchors: an effect keyed on `translateView` / `translatePhase` re-measures the blocks and re-applies the current entry's anchor whenever a translation lands or the view switches — a deliberate one-shot layout read, not the scroll handler, and not the settle window.

## Alternatives considered

**Hydrate the wall states through the store like the other restored fields.** They are `useState`, not store fields, and moving them would churn the store contract for no reader-visible gain; initializing from the same snapshot hydration reads is the smaller honest fix.
**Cancel the older open instead of guarding its continuation.** There is no cancellation token into the host's Remote calls, and a guard is the same shape the translation run already uses (`cancelRef`); the guard also covers the paths a cancel could not (the host may answer anyway).
**Re-anchor through the existing settle window (extend it, or reopen it on view changes).** The window exists for a growing document during the first 20 seconds; a view switch can happen minutes later, and reopening a ResizeObserver loop for a one-shot change is the wrong lifetime. A keyed effect says exactly when the geometry moved.
**Proportional-by-pixels (record `offset / height`) instead of a text offset.** Same information at record time, but nothing exact at restore time: the Range rect pins the same CHARACTER when the text is unchanged (fonts settled, images arrived), which a ratio cannot.
**Re-measure on every segment toggle too.** A reveal opening under a paragraph shifts the blocks below it; out of scope here — the named defect is the view switch, and the reveal case shifts content *below* the anchor block, which the block index already absorbs.

## Consequences

- A remounted pane shows the wall already translated, in the view the reader left it in — the wall pass re-runs against the page's cached translator sessions, so it costs no gesture and usually no requests.
- A slow host answer can no longer clobber the screen: the LAST open (or a close) owns the article area. The translation restore's `[openEntryId, articleHtml]` keying now never sees a mismatched pair.
- The position holds across original↔translation switches in both directions: switching the globe on lands on the same sentence (fraction of the translated text), switching back resolves the recorded character exactly (the original text is restored byte-for-byte, so `textLength` matches).
- `offsetInBlock` and `ArticleBlockMetrics` are exported from `ReaderPane.tsx` for the specs — the pure mapping is the part jsdom's missing layout cannot reach through the rendered pane.

## Testing

`packages/dsh-reader` runs 282 tests (+8 over the lazy-image line, all red against the pre-fix code except the backward-compatibility case, which is green on both sides by design):

- `tests/ReaderPane.client.spec.tsx`: the wall's switch and card texts survive a remount with no click; two race cases (a late `getEntryBody` answer, a late owed-fetch answer) never land under the newer entry's title; the translation case uses a layout stub whose block height follows text length, so the re-anchored position after translation is the same fraction of the new text; the recording case now asserts the anchor's text fields.
- `tests/reading-position.spec.ts` (new): the pure mapping — pixel passthrough for old anchors, exact Range resolution for unchanged text, the proportional fallback for changed text or missing layout.
- `tests/session.spec.ts`: the text fields ride both the page memory and the `sessionStorage` archive, and a stored anchor from before they existed reads back unchanged.
