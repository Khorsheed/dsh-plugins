# Agent Note: a fulltext feed's body is kept on the first open

Status: implemented

## Problem

A feed that publishes full text hands the pane the article inside the feed payload — but only inside the feed's window. The host never held that text: `getEntryBody` answered `fromFeed: true` (the payload echoed back, no cache), the card's pill said 「抓取」 as if nothing were held, and once the entry rolled off the feed the article was simply gone — the next open became a fetch of a page the reader had already been reading, or a failure against a site that refuses fetches. The reader paid nothing to have the text and lost it anyway.

## Decision

**Opening keeps it.** When the body on screen is the feed's own full text and the host holds no fresh cached copy, `open()` writes it to the host as the entry's body — the same `storeEntryBody` path the raw-payload sweep uses, with `bodyHash: translationHash(html)` so the entry's translation map rides the same identity rule a fetched body follows ([the state-boundaries note](../architecture/2026-09-19-reader-state-boundaries.md)), and a truncated feed payload is stored with its `truncated` marker. The write covers both shapes of the answer: the host echoing the payload back (`fromFeed: true`) and the pane showing the feed's `contentHtml` over an empty host answer (a stale cache, a recorded failure, an older host). On the store's resolution the entry's stale marker clears and `syncFetchState` re-reads the one entry, so the card's pill flips to 「已抓取」 on the same gesture — the propagation rule of [the fetch-state note](2026-09-20-reader-fetch-state-propagation.md), which owns the pill's semantics.

The boundaries do not move: a cached fresh body is never re-stored (it is paid for); a `summaryOnly` entry still owes a real fetch and its summary is never stored as if it were the article ([the summary-is-not-the-body note](2026-09-19-reader-summary-is-not-the-body.md)); saved-link entries are untouched. A blank payload stores nothing (the host would record it as an `empty extraction` failure).

## Alternatives considered

**Persist every fulltext payload at refresh/parse time, before any open.** That is pre-fetching by another name — caching bodies for entries nobody may read, the crawler shape the package refuses ([the subscribe-don't-crawl rule in the README](../../../packages/dsh-reader/README.md)). The open is the reader's gesture; storing what the gesture already displays is the honest version of "pay once".
**Leave it to the automatic backfill.** The backfill skips fulltext entries by design (the caller reports them as having text); making it cache them is the same pre-fetch, one layer down.
**Treat the pill as the fix (say 已抓取 whenever the feed has full text).** The pill would then be a client-computed state — exactly what the fetch-state note rejected — and the text would still die with the feed window. The store is the fix; the pill follows it.

## Consequences

- Fulltext-feed entries survive the feed window: after one open, the body, the green pill, and any translation map all read from the host's cache, with zero requests spent.
- The pill's green now means "the plugin holds the text", however it came to hold it — a fetch, a sweep extraction, or this keep-on-open. The README's pill paragraph says so in both languages.
- A stale cached body that is REPLACED by the feed's own full text (the empty-answer branch) clears its expired marker on the store's resolution — the marker still describes the host's copy, and the copy is now fresh.
- One new write path into the host per open-of-an-uncached-fulltext-entry; it fires once per entry (the next open reads the cache it made), costs no network, and rides the store's existing TTL/budget like any other body.

## Testing

`packages/dsh-reader` runs 327 tests (+3 over the scroll-clamp line):

- `tests/ReaderPane.client.spec.tsx`: a holding mock host (`storeEntryBody` writes are what `getEntryBody` and `entryFetchStates` then answer) drives the three cases — open stores the feed's full text (with its `bodyHash`) and the pill flips to 已抓取 after back; a reopen reads the cache and stores nothing twice; a summary-only open still pays its one fetch and never stores the summary. The two store cases are red against the pre-change code; the summary case is green on both sides by design — it pins the boundary the change must not cross.
