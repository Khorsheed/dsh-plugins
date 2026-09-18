# Agent Note: opening an entry fetches its body

Status: implemented

## Problem

Opening an entry whose body the plugin does not hold rendered a **blank page**: the title, the source line, and nothing else — no text, no reason, no action. Measured on `https://transformer-circuits.pub/2026/workspace/index.html`, reached from that site's own Atom feed:

- The feed publishes a **167-character summary** per entry and no full text, so the card has a title and a summary and the entry's `contentHtml` is absent.
- The host held **no cached body and no failure for that entry** (the state document's `annotations` had four records, none of them this article). The automatic backfill had not reached it — it takes 8 entries per wall load, two requests at a time — and **opening an entry never triggered a fetch**: `getEntryBody` only reads the cache, the feed's own payload, and a recorded failure.
- So `open()` fell into its last branch with `error === undefined` and, for a feed entry, deliberately set no message at all. The reason recorded in the code was "the backfill is fetching it, and an error line there would be a lie" — true about the error line, but the reader sees an empty page and cannot tell "not fetched yet" from "cannot be read".

Nothing was wrong with the fetch or the extraction: the page answers 200 with 418 KB of HTML, and the shipped extractor produces 321,868 characters of body from it (measured in jsdom against this repo's own source). The plugin had simply never asked.

## Decision

**Opening an entry with no body and no recorded reason performs exactly one fetch.**

- The detail view's `open()` calls the same `fetchBody(entryId, url)` the card's 「抓取正文」 action uses: host fetch → browser extraction → `storeEntryBody`, with `fetchEntryBody` recording the failure on the entry when there is nothing to extract. One code path, one contract: a success caches the body, a failure leaves a reason the next open reads.
- **A KNOWN reason does not auto-fetch.** If `getEntryBody` answers with an error — a recorded bot wall, login wall, non-web type, cross-site hop, a previous extraction failure — the detail view shows that sentence and 「阅读原文」 and fetches nothing. Issuing a request per look at a page that has already refused is not a fix; the card's own 「抓取正文」 stays available as the deliberate retry.
- **The saved-link case keeps its own rule.** A saved link whose fetched payload did not become a body already has 「这一页抽不出正文…」 (that is what the link-only work shipped); only a FEED entry with a missing body auto-fetches. The two are different states and the code says so.
- **The page says it is fetching.** A new `detail.fetchingBody` line (「正在抓取正文…」 / "Fetching the full text…") renders while the request is in flight, driven by the entry's `fetching` flag in the store. An empty body area for the length of a request is the same impression the change exists to remove.
- **`fetchBody` moved above `open`** in the component so the two `useCallback`s cannot form a cycle; `open` now lists it as a dependency.

## Alternatives considered

**Leave it to the automatic backfill (the status quo).** Rejected: the reader cannot see that a body is merely pending, the wall's slice is 8 per load, and the measured case had nothing to show at all. "Open it and read it" is the whole promise of this surface.

**Auto-fetch on every body-less open, including recorded failures.** Rejected: it turns every look at a blocked or login-walled article into a fresh request against that site, and the failure is already known and already explained. The retry stays manual and explicit.

**Auto-fetch for saved links whose page did not extract.** Rejected for the same reason, and because that case already has a sentence and a manual retry.

**Prefetch on hover, or fetch every missing body on wall load.** Rejected as crawler behaviour: the host's candidate slice (8 per run, 6-hour backoff on failures) is the deliberate shape of that budget, and hover would spend requests on entries the reader never opens.

**Show a "not fetched yet, press to fetch" button instead.** Honest but strictly worse for the reported need: the reader asked for open-to-read, not for one more control to find. The button still exists for the cases where a fetch is a decision (recorded failures).

## Consequences

- **Opening an entry pays one request** when its body is missing — which is what the README already claimed ("想看某条正文时点开它，付一次抓取"); the implementation now matches.
- **A stale cache heals on open.** Previously a cache past its deadline produced the same silent blank page (the host returns no html for a stale body); now the view refetches it.
- **A failure costs one request, not one per open.** `fetchEntryBody` records the reason on the entry, so the next open receives it from `getEntryBody`, renders it, and does not fetch again.
- **A wall backfill and an open can race for the same entry**, issuing two requests where one would do. Both are user-visible actions in the same moment, the overlap is bounded (2 concurrent backfill workers), and serializing them would need a shared in-flight registry across the wall and the detail view — deliberately not built for this.
- The detail view's blank state is gone for feed entries; a feed entry with neither a link nor a body still renders nothing, because there is nothing to fetch and nothing to say.

## Testing

`packages/dsh-reader` runs 198 tests (3 new in `ReaderPane.client.spec.tsx`):

- Opening a feed entry that carries a link and no description calls `fetchEntryBody` exactly once with that link and renders what comes back (the previously blank page).
- While that request is in flight the 「正在抓取正文…」 line is on screen, and it disappears when the body arrives.
- A saved link whose page yielded nothing still shows its sentence and calls `fetchEntryBody` **zero** times — the deliberate restriction, pinned.
