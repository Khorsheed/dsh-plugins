# Agent Note: a saved link is never dropped — link-only previews, honest failure codes, and a findable list

Status: implemented

## Problem

Two links the reader added to the inspiration space produced two different failures, and together they exposed one wrong rule and five gaps:

| What the reader did | What happened |
| --- | --- |
| Pasted an OpenReview PDF link | A card appeared, but opening it showed an anti-bot page instead of the paper |
| Pasted an institutional-proxy article (`…ezproxy.obspm.fr/html/…`) | "Could not fetch that address" — and **nothing was saved at all** |
| Wanted to delete the first one | No delete anywhere in the detail view; the only path was the subscription page |

The recorded state was the evidence for the first: the stored source's URL had become `https://openreview.net/challenge?redirect=%2Fpdf%3Fid%3D…` with a 4,783-character challenge page as its payload. OpenReview answers non-browser requests with a bot challenge (`302 → /challenge…`, then **200**), and `classifyPayload` correctly called that HTML "a web page" — so the challenge page was stored as the article. Measured directly, the same URL answers 403 to a plain request. So **the status code alone cannot decide this**, which is why the first fix attempt ("treat 401/403 as refused") was never enough.

The second failure had a code defect underneath it. The host's egress seam refuses a cross-origin hop with `WEB_REDIRECT_BLOCKED`, and `ReaderService` was supposed to catch that and re-enter the seam for the next hop. It tested for the code **in the error message** (`/WEB_REDIRECT_BLOCKED/i.test(errorMessage(error))`), but the harness puts the code in `error.code` and never in the message (`WebError extends HarnessError`; `errorMessage` returns `error.message`). The follow path was therefore dead code with no test, and every cross-origin redirect — this proxy, ordinary shorteners, every feed that moves domains — surfaced as the seam's raw sentence. The README claimed "follows up to 3 cross-origin hops itself", which was not what shipped.

Three more gaps followed from the same rule, that an add either succeeds with a body or fails:

- A link whose body cannot be read has no way to be a card. `addSource` returned a refusal and the URL was gone — the one outcome a reader who deliberately saved something should never get, and the fatal one for the mobile-capture flow this surface is meant to grow into.
- Without a body, the wall could not see the link at all: `load()` asked the host for payloads only for sources with `hasBody`, so a link-only source produced no parsed entry and therefore no card.
- An entry with no `publishedAt` scored `0` in the time sort, so a saved link sorted to the **bottom** of "newest first" — while a link-only source with no publication date and no body was also invisible to `#link`-style narrowing, because no kind narrowing existed.

## Decision

**A URL the reader pasted is saved, always; what varies is whether it can be previewed, and why not.**

- **The add outcome carries the reason instead of becoming a refusal.** `addSource` refuses only `invalid-url` and `duplicate` now. Everything else commits a `link` source and returns `{ outcome: 'saved-link', failure: { code, message } }`. The dialog's verdict says "saved, and here is why there is no preview" — the copy changed from "Could not fetch that address", which had nothing to show for the URL.
- **Seven failure codes, one of them retryable.** `ReaderPreviewFailureCode` is `blocked | login | unsupported-type | redirected | empty | unreachable | http`. `isRetryablePreviewFailure` lets only `unreachable` through, and `listBackfillCandidates` skips a saved link whose recorded failure is permanent — a bot wall, a login wall, a PDF and a 404 answer the same way forever, so retrying them on a timer is a crawler with a grudge. The subscription page's per-source Refresh still retries by hand and clears the record on success (`withoutFailure`).
- **The host classifies a payload before storing it.** `inspectPreview(raw, finalUrl, requestedUrl)` counts visible text (script/style/tags stripped) and, when that is under 200 characters, looks for the words a bot or login wall leaves behind, and for a host that changed. Any hit means the payload is **not** stored as a body: the card is 仅链接. This is the rule that keeps a challenge page from becoming an article, and it is deliberately crude — the host has no DOM, and a page with real text is never second-guessed.
- **A cross-origin hop is followed only when it can be reconstructed.** `crossOriginRetarget(error, current)` reads `error.code` and parses the origin the refusal names; it returns the same path and query on the new origin **only when the host is unchanged** (the `http://host/feed` → `https://host/feed` upgrade). A hop to a different host is reported as such. The refusal names the target ORIGIN only, so following it to the bare origin would fetch a different page and file it under the URL the reader pasted.
- **The reason is recorded twice, on purpose.** The source carries `failure` (the wall marks the card, the backfill needs the retry verdict), and the entry annotation carries it too, keyed by `linkEntryId(sourceId)` — a new shared helper, because the entry id for a saved link was a magic string built in the browser half. That second record is what makes `getEntryBody` — the one call the detail view makes — explain itself rather than answer with a blank article.
- **The wall shows the link.** `load()` now requests payloads for every `link` source as well as every source with a body, so a link-only source produces a card with a 仅链接 badge whose tooltip is the classified reason. The same badge is absent from feed entries: a feed's missing body is the backfill's job and it is already marked when the text arrives.
- **The detail view names the reason and offers the way out.** For a failure with a code, the sentence comes from the code (`preview.*` copy), not from the seam's message; the message stays for diagnosis. The line always carries 阅读原文.
- **A saved link can be deleted where the reader is.** The detail toolbar gets a trash button for `link` sources only, and the card's context menu gets the same action. A feed entry deliberately has neither: the next refresh would bring it back, and a delete that undoes itself is a lie.
- **A saved link sorts by when its source was added.** `ReaderSourceSummary` gained a required `addedAt`; the row carries it and `timeOf` falls back to it when the entry has no `publishedAt`. The just-added link is at the top of "newest first" instead of at the bottom.
- **The list can be narrowed by kind, in both places.** `kindQuery('rss'|'link')` writes `#rss` / `#link` into the search box — the same local predicate as `#sourceId` and `@tagId` (D14), so it costs no request and is visible and clearable. The subscription page gets its own kind chips (with counts) and an order chip row (added / name / last fetch, added descending by default), because that page is where the delete action lives and it mixes two different things.

## Alternatives considered

**Keep the failure a refusal and do not save the URL.** This is what shipped before, and it is the option the reader's report rejects: "adding failed" and the link is gone, with no card to delete, tag or open later. Saving costs one row in `state.json`; losing the URL costs the reader the thing they asked the plugin to keep.

**Store the challenge page (or the PDF bytes) and let the browser extractor fail.** The payload would exist, so `hasBody` would be true and the wall would look complete. It also means the card's body is a bot wall, which is exactly the reported symptom ("added, opens onto nothing readable"). Rejected: a body that is not the article is worse than an honest absence.

**Follow every cross-origin hop by guessing the path.** The refusal's message carries the target origin, so the path is unknowable. Keeping the current path (`origin + pathname + search`) is right for a scheme/port upgrade and wrong for a genuine move to another site — it would fetch a page that is usually not the article and store it as the source. Rejected in favour of reporting the move, which is also what the seam's own message advises ("retry against that URL directly").

**Also give feed entries a delete (or a hide tombstone).** A feed entry cannot be deleted — the feed republishes it — so the honest verb would be "hide", which needs a new persisted annotation field and client filtering. Deferred: it is a different feature with a different word, and the reported need was the single saved URL.

**Add the kind narrowing only to the subscription page.** Rejected: the wall is where the reader looks first, and "where is the link I just added" is asked there. The wall narrowing reuses the existing local predicate, so the cost is three rows in a popover that already exists.

**Keep the old README claim and merely fix the code.** The claim ("follows up to 3 hops") describes a behaviour that never ran and that cannot be implemented faithfully for a host change. The README now states what the code does.

## Consequences

- The reader's URL survives every failure mode, and the card says which one it was. The three real causes send the reader to different actions (open in a browser yourself / sign in elsewhere / the file is not a web page), which is why the vocabulary is seven codes and not one "unavailable".
- Permanent refusals stop generating automatic requests. A link saved behind a bot wall costs exactly one request until the reader refreshes it by hand.
- **Wire shape change**: `ReaderSourceSummary.addedAt` is now required. Both halves ship in this package, so there is no skew to manage, but a client reading an older host would see `undefined` — the sort and the manage chips use `?? ''` so that degrades to "unknown when, sorts last" rather than throwing.
- **Two selector words are reserved**: `#rss` and `#link`. Source ids are `${kind}-${hash}`, so neither can collide with a real id; a hand-written document with an id literally named `link` would be shadowed, which is not a shape this package produces.
- The preview heuristic can downgrade a genuinely tiny page (under 200 visible characters, no markers, same host) to a link-only card: the payload is not stored and the detail view offers the original. That is accepted — such a page has nothing to read in a reader — and the threshold is one exported constant.
- Escaping a permanent failure is manual by design: automatic retries would either hammer the site or need a user-visible "try again anyway" policy inside the backfill, and the subscription page already owns that button.
- The failure vocabulary is durable (`state.json`), and `normalizeStateDoc` drops an unknown code rather than trusting it, so a future code added by a newer host degrades to "no classified reason" on an older client instead of rendering a missing sentence.
- Feed entries still cannot be removed from the wall, and the wall's kind narrowing is session state (it lives in the search box), not a persisted preference.

## Testing

`packages/dsh-reader` runs 195 tests, of which 20 are new here:

- `host-pure.spec.ts`: `classifyFetchFailure` maps each seam failure, including the regression that a `WEB_REDIRECT_BLOCKED` **code** to a login host is `login` and to an ordinary host is `redirected`; `crossOriginRetarget` follows a same-host scheme upgrade and refuses a host change, and does not act on a message-only lookalike; `inspectPreview` leaves a real page alone and recognises a 200 bot challenge, a login interstitial, a short page and a cross-host hop.
- `boot.spec.ts`: the OpenReview-shaped challenge page is neither stored as a payload nor a backfill candidate, and the entry's detail answer carries the reason; a manual refresh after a transient failure clears the record; the no-web composition keeps the URL and classifies it; a 404 keeps the link and records `http`; an ordinary page is still saved with a body.
- `selectors.spec.ts`: `#link` / `#rss` narrow by kind while `#sourceId` still narrows by source; an undated saved link is dated by its source's `addedAt` in both directions.
- `ReaderPane.client.spec.tsx`: the 仅链接 badge carries the classified reason and follows the code (a login wall is not called a bot wall); a saved link offers delete and a feed entry does not; the add verdict reports "saved, no preview" with the reason and clears the field; the subscription page orders by arrival and narrows by kind; and a saved link whose payload yielded nothing explains itself when opened instead of rendering a title over blank space.
