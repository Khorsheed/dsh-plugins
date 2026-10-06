# Agent Note: a browser without the Translator API can view a stored translation

Status: implemented

## Problem

The inspiration space translates article bodies through the browser's own Translator API, which only desktop Chrome 138+ / Edge 148+ ship. Every browser on iOS is WebKit and has no such API, so on a phone the globe never rendered — even for an article the reader had already translated on desktop, whose sentence pairs the host has been storing since the two-tier translation store (a global sentence memory plus one per-entry map keyed to the body's hash). The reader asked why the phone has no translate button; the translation they wanted to read was already on disk.

## Decision

- **No API, stored map for this body → the globe appears, view-only.** With `detectTranslator()` null, opening an article asks the host for the entry's own map (`getEntryTranslation`). Only a record whose `bodyHash` equals `translationHash(articleHtml)` and that has at least one segment turns the globe on (`storedPair` in `ReaderPane.tsx`). Without such a record the globe stays hidden exactly as before.
- **Turning it on paints, never translates.** `showStoredTranslation` segments the body, warms the page memory through the same `warmMemory` the desktop run uses (entry map first, global sentence memory for the rest), and paints with `applyRemembered` — the memory-only first step of `runTranslation`, now factored out of it in `translate.ts`. A sentence neither tier covers stays in its original. If nothing at all matches the segmentation, the globe goes away again.
- **The pair is the record's own.** No language detection is needed on this path: the stored record says which `<src>→<tgt>` it was made under, and that is what the memory is read with.
- **The three views work; retranslating is not offered.** The caret menu heads with `translate.stored` ("已保存的译文 · 中文（简体）") instead of `translate.local`, and the "重新翻译" item is hidden when there is no translator. Reading persists only LRU stamps (`rememberSentences` with an empty `entries`, the recalled pairs in `recalled`).
- **The restore after a remount works without a session.** The "turn the globe back on" effect, which on desktop requires an already-built translator session (`Translator.create()` needs a gesture), accepts a stored pair instead when there is no API.
- **The wall's translation stays desktop-only.** Its cards are translated field by field and nothing persists per wall; there is no stored artifact to view.

## Alternatives considered

**Translate on the phone through the host's LLM.** Would make every article translatable, but sends the article to a model provider and spends tens of thousands of tokens per long article — exactly the trade the on-device design declined. Left for the user to decide separately.
**Offer the globe whenever the global sentence memory covers some sentences.** The memory is shared across articles, so it can cover a few stray sentences of an article nobody translated; a globe that lights up a half-translated page is worse than none. Only the per-entry map, keyed to this body, proves the article was translated.
**Rely on Safari's built-in page translation.** Needs no code, but translates the whole page chrome and is untested against the panel's DOM; it stays a manual fallback to test later, not the design.

## Consequences

- A phone can now read what was translated on desktop, for free and with no model. Articles never translated on desktop, or re-fetched since (body hash changed), still show no globe on the phone.
- Opening an article on an API-less browser costs one `getEntryTranslation` read. That read already existed on the desktop path; here it simply happens at open time rather than at the gesture.
- `runTranslation` and the stored-view path share one memory-painting function, so a change to how remembered sentences are applied lands on both.
- Whether Safari becomes an officially supported reading surface is deferred to a joint test with the user.

## Testing

`packages/dsh-reader` runs 461 tests (3 new, `tests/ReaderPane.client.spec.tsx`, "the translation memory survives a reload"):

- no Translator API + a stored map matching the body → the globe appears, the translation paints, the menu shows the stored label and no retranslate item, original-only switches back, and reading persists 0 learned / 3 recalled;
- no Translator API + nothing stored → no globe;
- no Translator API + a stored map for an older body (even with every sentence in the global memory) → no globe.
