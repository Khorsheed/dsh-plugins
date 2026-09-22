# Agent Note: the reader's place belongs to the page, not the session

Status: implemented

## Problem

The reader reported: read (and translate) an article in one conversation, open the inspiration space in another, and there is nothing there — no open article, no translation.

The pane's memory of "where the reader was" (the previous note) was keyed by `sessionId`. The pane is mounted **per dsh session**, so that key meant every conversation started from the wall with the default filter: the article had to be found and reopened, the reading position was gone, and the globe was off so the translation had to be paid for again — even though the page's translator-session cache (module-level, and already page-wide) could have restored it for free, and even though the article body was already cached.

Worth separating, because the report said "no content cache" too: **the article bodies were never session-scoped.** They live in the deployment's `state.json`, keyed by entry id (`$DSH_HOME/state/dsh-reader/state.json` plus `bodies/`), so any session reads them; measured on the acceptance instance, one document held 106 cached bodies from many sessions. What was per session was only the pane's *view* — which article is open, where the reader had scrolled, how the wall was narrowed, and whether the globe was on.

## Decision

- **One memory bucket for the whole page.** `client/session.ts` loses the `sessionId` parameter entirely: `readSession()` / `patchSession(patch)` / `rememberScroll(entryId, top)` / `rememberTranslation(entryId, view, source)` / `forgetTranslation(entryId)`. Any pane this page mounts — including one for a different dsh session — restores the same place: the same open article, the same reading position, the same wall narrowing, and the same translation (auto-restored, because the translator-session cache is page-wide and a session that already exists needs no user activation).
- **The session id keeps only the gestures that are actually about the conversation**: reading and merging the conversation draft, and the `contextKey` of a quote sent to the side chat. Those are handed to `client/index.ts`'s injected face, which already closes over the session — no memory of the reader's place goes through it.
- **The LRU cap on remembered sessions goes away with the keying.** There is one snapshot now; its per-entry maps (reading positions, translation records) grow with what the reader actually touches on the wall, and `cardTranslations` with what the wall has translated — all bounded by the entries on screen.
- **The globe record stays off disk** — and stays inert-proof: after a reload there is no translator session for it to drive (no user activation), so a persisted record would be empty. (The translated TEXT itself has since gained a host-side store — [the persistent-translation note](2026-09-20-reader-persistent-translation.md) owns that reversal, including this note's objection that "which articles were translated" would be written for no user-visible gain: the gain is now the near-free re-translation of long articles. What this note decided — the record and the sessions — is unchanged.) What outlives a reload, all host state read from there: the cached bodies, the 「最近阅读」 list, and now the translation tiers.

## Alternatives considered

**Keep it per session, and persist the translation record per entry in `state.json`.** Would survive a restart, but the record cannot rebuild a translator session by itself, so a restored pane would find the globe off anyway; it also puts translation metadata on disk for a benefit the user never asked for.
**Keep it per session and offer a "resume where you were" affordance.** The reader's expectation is that the same wall in the same page simply IS the same place; a button to get back to it is a worse version of doing it.
**`sessionStorage` (survive a reload and every session).** Declined earlier and still declined: a reload is a fresh visit, and the translated text must not reach any storage.
**Make the reader tab's content session-scoped too** (a per-conversation wall). Rejected outright: the sources, the bodies and the recent list are deployment state, and a per-conversation copy of them would contradict everything else in this package.

## Consequences

- Switching sessions no longer resets the reader. The wall, the open article, the reading position and the translation all carry over; only the conversation draft and the side-chat hop depend on which session is active.
- One assumption is now load-bearing: **the host renders one sidebar at a time** (`RightbarRoot` only while no other main panel is active), so only one pane writes the bucket. If two panes were ever mounted together, the bucket would be last-write-wins — the same behavior a single shared memory has by definition.
- `tests/session.spec.ts` shrinks: the "two sessions are kept apart" and the 12-session LRU cases describe an API that no longer exists. The cross-session case is asserted where it is observable instead, in `tests/ReaderPane.client.spec.tsx`, which mounts the pane twice with **different session ids** and requires the article and its translation to be there without a click.
- The spec's `afterEach` calls `forgetSession()` with no argument — the memory is now page-wide, so every case would otherwise inherit the previous one's place.

## Testing

`packages/dsh-reader` runs 253 tests (the two per-session cases are gone; one cross-session case is new):

- `tests/ReaderPane.client.spec.tsx` (+1): a pane mounted for `session-a` opens an English article and turns the globe on; the pane unmounts and a pane for `session-b` mounts over the same page — the article is already open and the translated text is already there, with neither the card nor the globe clicked.
- `tests/session.spec.ts`: the snapshot's merge semantics, the reading position, the translation record (including "original" forgetting it) and the pair-keyed translator cache — now with no session argument anywhere.
