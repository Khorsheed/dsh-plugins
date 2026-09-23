# Agent Note: the reader remembers where it was

Status: implemented

## Problem

Two reports, one root cause each, both about the same journey — leave the reader and come back.

**Returning lost everything.** The host unmounts the whole right sidebar when another main panel takes over (`RightbarRoot` renders only while `activePanelId === null`), and the pane's store is created per mount. So hopping to the side chat and back put the reader on the wall with the default filter: the open article was gone, the reading position was gone, the wall's search and sort were gone, and a translation the reader had paid for was gone with it. The translator made it worse: the `Translator` API requires user activation for `create()`, so a second visit could not even rebuild the session it already had.

**Entering a fetched article fetched it again.** Opening an entry whose feed publishes only a summary triggered `fetchBody` unconditionally — `summaryOwed` is a property of the FEED entry and stays true forever. Once a body was cached, `getEntryBody` answered with it and the code still went to the network, replacing the article's DOM with the same bytes. That is why a reader who had translated a paper found it "needing translation again": the translation lives in the DOM it had just been thrown away.

## Decision

- **`src/client/session.ts` holds where the reader was, in module memory, per session.** `view`, `openEntryId`, `openSourceId`, `filter`, `query`, `sort`, `unreadOnly`, `read`, the wall's `wallOn`/`wallBoth`/`cardTranslations`, a per-entry reading position, and a per-entry translation record. Deliberately NOT persisted: a reload is a fresh visit. (The position moved to `sessionStorage` on 2026-09-19 — see the state-boundaries note — and the translated SENTENCES gained a host-side store on 2026-09-20, in [the persistent-translation note](2026-09-20-reader-persistent-translation.md); what still never persists is the translator session and the globe record, because neither can act after a reload without a gesture.) The map is capped (12 sessions, LRU) because it lives for the tab's whole life.
- **The store gets one new action, `hydrate`**, taking exactly the session-local fields — not `sources`, `parsed`, `fetchStates` or `articleHtml`. Host-owned facts are always re-read, so a restarted pane can never show a stale copy of what the host knows.
- **The article is re-established by the same call a tap makes.** The restore waits for the parsed entries, finds the entry the snapshot names, and calls `open(row)`; the host answers from its cache, so a return costs no network. Nothing is restored until the entries are there: opening an entry that no longer exists would put the reader in a detail view with no entry.
- **The reading position belongs to the DETAIL scroller** (`detailBody`), is written on every scroll event (unthrottled: a dropped trailing event is exactly one scroll behind the reader), and is applied once the body it belongs to is on screen — an offset applied earlier clamps against a shorter page.
- **Translations are restored from a page-level session cache, never built.** `session.ts` now owns the translator-session map (the wall and the detail view share it); a session that exists is used, and only if one exists does a return turn the globe back on by itself. No session means no automatic restore — the record stays, and the reader's next click on the globe is instant because the same cache answers it.
- **The record is per entry and tiny**: the view (`trans`/`both`) plus the source language it was built for. "Original" is not a record — the globe is off, and a record that outlived that choice would switch it back on. A manual re-fetch forgets the record, because the body is about to be a different DOM.
- **Auto-fetch on open now requires that the text on screen is the FEED's** (`view.value.fromFeed === true`) rather than merely "a body is owed". A body the host already holds is shown as it stands.
- **The detail view gets its own 「重新抓取」**, in the tag row next to the entry's tags. It is the same `startFetch` the card's pill uses, so it goes through the same host path (raw written to disk first, extraction in the browser): the reader asking for a fresh copy is one action wherever they stand.

## Alternatives considered

**`sessionStorage` / `localStorage`.** Declined, and it was the user's call: the reader's memory of a visit should not survive a reload, and translated third-party text must not reach disk. `sessionStorage` would also resurrect a reading position onto a DOM that a reload rebuilt from scratch.
**Keep the pane mounted instead of remounting it.** That is host behavior (`RightbarRoot`), not this package's to change; a plugin-side portal would fight the sidebar's own visibility rules.
**Re-fetch on open to check for a newer version.** That is what the TTL, the card's pill and the new 「重新抓取」 are for. Paying a request (and the translation) on every look is the bug being fixed.
**Store the translated text in the session snapshot (the earlier "recent 20 articles / ~4 MB" idea).** Unnecessary: the record plus the page-level session plus `translate.ts`'s own sentence memory reproduce the translation without a second, larger cache. It also keeps the snapshot small enough that writing it on every scroll is free.
**Auto-restore by building a translator session when none is cached.** Impossible without a user gesture: `create()` rejects, and the reader would get an error for a translation they had already paid for. The cache is what makes the restore honest.

## Consequences

- The pane remembers *where the reader was*, never *what the host has*. A body whose TTL expired is still re-fetched by opening it, exactly as before.
- `tsconfig.client.json` lists files explicitly; a new client module has to be added there or `tsc -b` fails with `TS6307` (that is the whole error, with no hint about the project's file list).
- The client spec's `afterEach` must `forgetSession('s1')` and `forgetTranslators()`: every case renders the same session id, so without it one case's open article, narrowing and cached translator are restored into the next one.
- The mirror effect that writes the snapshot skips its first run, because the hydration lands after it in the same commit — without the skip, mounting would overwrite the record with the store's defaults before ever reading it back.
- A summary-only entry whose body is cached no longer costs a request per open; the card's green pill is now the truth about the body rather than a hint that another fetch is coming.

## Testing

`packages/dsh-reader` runs 240 tests (18 new):

- `tests/session.spec.ts` (new, 12): merge semantics, per-session isolation, `undefined` dropping a field, the 12-session cap and its LRU order, per-entry scroll, the translation record (including "original" forgetting it), the pair-keyed translator cache.
- `tests/ReaderPane.client.spec.tsx` (75, +6): a cached body is shown with **no** `fetchEntryBody` call; an unfetched entry still pays exactly one; 「重新抓取」 fetches again from the detail view; and three remount cases (a second pane over the same session id restores the open article and the wall's query, turns the globe back on **without a click**, and reopens without asking the host for a body it already has).
