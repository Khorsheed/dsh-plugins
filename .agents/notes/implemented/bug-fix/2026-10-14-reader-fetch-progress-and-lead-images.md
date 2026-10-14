# Agent Note: dsh-reader makes slow fetches visible and keeps the lead image

Status: implemented

## Problem

A reader report (2026-10-14) had two halves. **A slow fetch looked dead.** Opening or adding a long article spent seconds to half a minute in a chain of resolver APIs → page fetch → extraction → store, and the only in-flight affordance was a static 「正在抓取正文…」 line in the detail view — the add dialog showed nothing at all, so a slow add read as a dead click (and invited a second submit). **A page's pictures went missing.** On `anthropic.com/research/investigating-unintended-model-actions` the stored body had zero images: the scorer keeps the ONE text-heaviest container, and the magazine template's cover art sits in a sibling wrapper before it — inside the `<article>`, outside the winner, so it was never reached. The sibling report article (`self-replicating-ai`) extracted its three figures fine; its stored body had them all along.

## Decision

**Fetch progress is a phase line, not a guess.** The fetch relay (`client/index.ts` `fetchEntryBody`) reports its legs — `downloading` → `extracting` → `storing` — through a new optional `onPhase` callback on the injected face's `fetchEntryBody` (`ReaderFetchPhase` in `client/contract.ts`). One macrotask yield precedes the synchronous extraction, so the "extracting" phase actually paints before the ~1 s a multi-MB page costs (measured: 897 ms in Chromium for a 2 MB / 49k-element arXiv paper, vs 15 s under jsdom). The detail view renders the phase in a new `BusyLine` (spinner ring + label + elapsed seconds once past 3 s, reusing the rendered-fetch's `renderingLine`/`renderingRing` idiom), keyed by entry id so a background card fetch never shows on screen. The add dialog gains the same line (「正在识别并抓取链接…」), disables its input and submit while busy, and guards re-entry.

**Refresh fetches concurrently, writes serially.** `service.refresh()` runs a bounded worker pool (`REFRESH_CONCURRENCY = 3`, `src/service.ts`) instead of a sequential loop — one dead source's 30 s timeout no longer stalls every source behind it. Document writes stay single-filed after the pool: per-source failure records and the bulk source patch commit happen sequentially, because the store's commit is a read-modify-write and two in flight is how a lost update happens.

**The lead image is grafted into the body.** After scoring and the chrome trim, `graftLeadingFigures` (`src/client/extract-article.ts`) moves qualifying image blocks that PRECEDE the winner into its front: a `<figure>`/`<picture>` qualifies by markup alone, a bare `<img>` must declare width ≥ 480 (`LEAD_IMAGE_MIN_WIDTH`) so icons and avatars stay out; at most two come in (`LEAD_GRAFT_MAX`), document order kept. The scope walk takes the OUTERMOST `article`/`main` ancestor — Anthropic nests `article > wrapper > article > text column`, and the hero sits under the outer one. The graft runs after `trimLeadingChrome`, because a grafted hero at the front would otherwise stop the masthead walk at its own border. What FOLLOWS the text (a related-stories grid) is never touched. A pre-existing trim defect surfaced by this work: the masthead walk's picture check only looked for DESCENDANT images, so a bare leading `<img>` was removed as chrome; the node itself now stops the walk.

**`data-srcset` is read.** The lazysizes shape (placeholder `src`, real candidates in `data-srcset`) had no URL the resolver would consult; `imageSrc` and `pictureImg` now fall through to it after the real `srcset`.

## Alternatives considered

**True byte-level download progress.** The fetch seam (`ctx.web.fetch`) buffers the whole decoded body before answering, so a percentage needs either a reader-owned page fetch duplicating the seam's hardening, or a `RemoteStream` verb. Both buy a number that says how many bytes arrived — but the reader's actual uncertainty was "is anything happening at all", which the phase line plus elapsed time answers at a fraction of the surface.

**Awaiting the store before display, versus display-then-store.** The extracted body could render one round trip earlier if `storeEntryBody` went fire-and-forget — but the wall's fetch pill reads the host annotation, and a racing re-read lands on the pre-store `raw` record (the sweep would then re-extract and re-store the same body). A few hundred milliseconds is not worth that dance.

**Scoring every image-bearing block and merging several.** The one-container scorer with a targeted graft is a smaller, more predictable rule than multi-block merging, whose failures (dragging in comment threads and related grids) are exactly what the scorer exists to avoid.

**Parallelizing `sweepRaw`'s two entries.** The extraction half is synchronous main-thread work either way; overlapping two Remote calls saves little and complicates the one-sweep-at-a-time invariant.

## Consequences

- A slow add or open now shows the spinner, the current leg, and the elapsed time; the double-submit path is closed. Refresh of N sources takes ~max-of-three-chunks instead of the sum.
- Anthropic-style lead art (and any preceding figure/wide image) now lands at the top of the extracted body; the 2026-10-14 report article went from 0 stored images to its cover. Bodies stored BEFORE this fix keep their old content until the cache expires or 「重新抓取」 runs — `repairStoredBody` cannot restore what was never in the markup.
- The graft is bounded (two images, preceding the winner, figure-markup or declared-width only); a page that leads with a wide promotional banner inside its article scope will bring it in — accepted, since that banner is what the page chose to lead with.
- Tests: `tests/extract-article.spec.ts` pins the graft (hero, leading figure, no trailing reach, no icon, idempotent when the winner already holds the images) and `data-srcset`; `tests/ReaderPane.client.spec.tsx` pins the in-flight phase line and the add dialog's busy/guard behavior.
