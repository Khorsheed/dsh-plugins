# Agent Note: a fetch that survives leaving the page

Status: implemented

## Problem

Fetching an article only worked while the reader stayed on it. The host performed the HTTP request, but the payload came back **to the browser**, which extracted it and asked the host to store the body — so switching to another panel, closing the tab or reloading threw the download away. The right sidebar makes this worse than it sounds: `RightbarRoot` renders the sidebar only while `activePanelId === null`, so opening any main panel (side chat, a session) **unmounts** the reader pane rather than hiding it, and with it every piece of client state.

The reader's request: press something on the card, leave, come back to a ready article — and let the wall show which articles are ready, in flight, or broken, so the queue is visible where the decision to read is made.

## Decision

- **The raw payload is written to disk before `fetchEntryBody` answers.** The host stores it under `bodies/<digest>#raw` (the same sidecar directory that holds over-threshold bodies), records `fetch: { state: 'raw', at, rawFile, chars, url, truncated }` on the entry annotation, and only then returns the payload. A browser that goes away mid-request therefore costs nothing: the payload is on disk, and the record says so.
- **A `fetching` record is written before the request starts**, so a wall reopened while a fetch is in flight says so. A record older than ten minutes is treated as abandoned — the process that owned it may have been restarted.
- **The browser half drains stored payloads.** On load, and every two seconds while anything is `fetching` or `raw`, the pane asks `entryFetchStates` for the entries it is showing and extracts the `raw` ones — two at a time, through `getRawBody` → `extractArticle` → `storeEntryBody`, which is what clears the record and sweeps the raw file.
- **The state is per ENTRY, not per source.** Entries come from the browser's parse of a feed, so they cannot ride the source summaries: `entryFetchStates` takes the entry ids the wall is showing and answers `none | fetching | raw | ready | failed` (a failure carries its classified code so the card's tooltip is the same sentence the detail view uses).
- **The card carries a 抓取 pill** in the tag row: grey = nothing held, click to fetch; blue = fetching or raw; green = a fresh body is cached; red = the last fetch failed, hover for the reason, click to retry (a manual click ignores the backoff). Its colour is the state, so a wall full of articles can be scanned for "what is ready".
- **A failure is classified where it happens.** `fetchEntryBody` now runs its error through the same `classifyFetchFailure` the add flow uses and persists `failureCode`, so a card's red state explains itself in the reader's language rather than echoing the seam.
- **Opening an entry still fetches automatically** — the user's decision: the pill and the detail view call the same code, so prefetching from the wall and waiting in the detail view are one mechanism, not two.

## Alternatives considered

**Keep the fetch in the browser and hold it alive with a module-level promise.** Rejected: it survives a panel switch only. A reload, a closed tab or a host restart still loses the download, and the request would keep running in a JS context nobody is watching.
**A host-side job queue with progress events.** Rejected for now: this package has no event channel to the browser beyond polling, and the state record plus a two-second poll gives the same information with none of the machinery. If a real queue with cancellation arrives, the record is the natural place to hang it.
**Extract on the host.** Impossible: the host runtime has no DOM parser (the reason feed parsing also lives in the browser half). Storing the raw and extracting later is the honest version of the same idea.
**Show fetch state on the source rows instead of the cards.** Rejected: the unit the reader decides about is the article, and one feed row covers dozens of entries with different states.
**Auto-fetch everything on wall load.** Rejected (unchanged from the backfill's design): that is a crawler of every subscription. The pill lets the reader choose, and the automatic backfill still fills text a slice at a time.

## Consequences

- A fetch is now **resumable**: raw on disk, extraction whenever a browser is next present. The cost is one extra file write per fetch and a stored payload that can be large (a 41 MB page is a 41 MB raw file until it is extracted).
- The annotation keep-condition in the state normalizer had to learn about `fetch`: an annotation whose only content is a stored payload was being dropped on the next read, which silently made every raw disappear. Caught by the new test, not by inspection.
- The polling effect depends on the BOOLEAN "is anything in flight" and reaches its callbacks through a ref. Depending on the callbacks made a loop — a poll replaced the state, which recreated the callback, which re-ran the effect — and the test suite stopped finishing at all.
- `state.json` stays small: both bodies and raw payloads live in `bodies/`, and the sweep deletes neither a referenced body nor a referenced raw.
- Manual retry is deliberate: the six-hour backoff that protects the automatic backfill does not apply to a click, because a click is a person deciding to spend the request.
- The wall now makes one extra round trip per load and one every two seconds while something is in flight. Both are local RPC, and the store write is a no-op when the states are unchanged.

## Testing

`packages/dsh-reader` runs 222 tests (6 new):

- `boot.spec.ts`: `fetchEntryBody` writes the raw before answering (`rawFile` returned, one file in `bodies/`), `entryFetchStates` reports `raw`, `getRawBody` returns the payload and its URL, `storeEntryBody` flips the state to `ready` and sweeps the raw file, and a 403 reports `failed` with code `blocked`.
- `ReaderPane.client.spec.tsx`: the card shows 抓取 / 已抓取 / 抓取失败 from the host's states; a click on the grey pill (and on the red one) calls `fetchEntryBody`; a hover on the red pill carries the classified reason; and a `raw` entry is extracted through `getRawBody` → `storeEntryBody` without any fetch.
