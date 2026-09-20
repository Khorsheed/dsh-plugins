# Agent Note: the two image forms the whitelist threw away

Status: implemented

## Problem

Two real pages from the reader's main scenes lost their pictures to the same
whitelist, in two different shapes (both user-reported from 3080 acceptance):

- **arXiv HTML figures** (`arxiv.org/html/2604.03147`, verified live): LaTeXML embeds vector figures as `<figure class="ltx_figure"><object type="image/svg+xml" data="…/circumplex.svg" width height></object><figcaption>…`. `object` was in `DROP_TAGS`, so the subtree died before scoring and the caption stayed — "the plugin lost my image", the exact reading the script-figure design exists to prevent.
- **transformer-circuits figures** (`/2026/emotions`, 41.8 MB HTML): 87 `<img src="data:image/png;base64,…">` at hundreds of KB each — the page's REAL illustrations, inlined. The lazy-image recovery treated every `data:` URI as a 1px placeholder and fell through to attributes that do not exist, deleting the pictures. That policy was written for the opposite shape (a placeholder src hiding the real URL in `data-src`), and it overfit.

## Decision

Both fixes are in `client/extract-article.ts`, and both keep the old behavior for the shape the old rule was right about:

- **An image-typed `<object>` becomes an `<img>`** (`objectImg`): `type` must start `image/`, `data` must survive the same scheme check every URL gets (relative resolves against the page; `data:`/script schemes rejected), and plain-integer `width`/`height` ride along — known dimensions are the difference between a stable layout and the growing document the [state-boundaries note](../architecture/2026-09-19-reader-state-boundaries.md) is about. Any other object (PDF, movie) drops whole, fallback children included — they duplicate the caption, not the picture. The script-figure probe learns `object[type^="image/"]` as content, and the inline-summary pass skips objects the way it skips noscript.
- **A `data:` image is kept when it is substantive** (`substantiveDataImage`): the MIME must be a real image type (`png|jpeg|gif|webp|svg+xml|avif`) and the payload must reach 512 characters. A 1px placeholder is ~70; the smallest real chart is thousands — the threshold sits far from both, so no borderline case decides anything. Base64 payloads are whitespace-stripped on emit (pages line-wrap them). A data: URI that fails the gate counts as ABSENT — it falls through to the lazy attributes exactly as before, so a placeholder still yields to the real URL in `data-src`. The same gate applies to `srcset` candidates (the comma-rejoin already kept them parseable).

**Storage, thought through**: accepting these means extracted bodies now carry megabytes of base64. The machinery already absorbs it: bodies past `INLINE_BODY_MAX_CHARS` (256 KB) are sidecar files under `bodies/`, `state.json` keeps only the manifest, `pruneBodies` sweeps by reference, and `boundAnnotations` evicts by count + TTL. The honest accounting of the worst case: entry bodies are bounded by COUNT (default 500) and TTL, not by a char budget, so a deployment that raises the seam cap (acceptance runs 64 MB) can hold maxEntries × cap of base64-heavy bodies on disk. That is a deployment-policy answer, not a bug — the same bound already applied to any huge page — but it is recorded here because this change makes the large body the COMMON case for figure-heavy papers instead of a corner.

## Alternatives considered

**Unwrap non-image objects to their fallback children.** The fallback is "your browser cannot show this" chrome or a duplicate of the caption; dropping the subtree keeps the old, never-complained-about behavior for everything that is not a picture.
**Keep rejecting all `data:` srcs.** That is the bug: transformer-circuits inlines its real figures; the placeholder reading was never true of that page, and "some data URIs are placeholders" does not make every one a placeholder.
**Sniff placeholders by content (1×1 gif signature) instead of size.** More precise against a handcrafted 600-char placeholder, but the gate exists to separate "tracking pixel" from "illustration", and size separates those two populations by orders of magnitude with one comparison. Sniffing remains available if a real page ever mixes near the threshold.
**Externalize data-URI images into their own sidecar files and rewrite the srcs.** Deferred, deliberately: the pane renders stored HTML strings, so an `<img>` src must be a URL the browser can load, and the Remote serves JSON, not binary GETs — a served-image URL is host-seam work (a resource scheme or blob plumbing) that belongs with the capture milestone, not with un-breaking two pages today. The bodies are self-contained meanwhile: quota, eviction and quoting all treat them like any body.
**Cap accepted payloads.** Rejected: the seam's own cap is the outer bound on what a page can even deliver; a second, inner cap would silently re-truncate what the deployment deliberately allowed through.

## Consequences

- arXiv HTML papers arrive with their vector figures (as `<img>`, with dimensions); transformer-circuits-class pages keep their inlined charts; the two real-page fixtures and the arXiv fixtures extract unchanged except for the newly-kept images.
- The emitted `<img>` for a data URI carries `referrerpolicy="no-referrer"` like every other (a no-op for data:, one rule for all).
- Inline summaries skip object subtrees entirely; a figure never leaks fallback chrome into a card summary.
- The disk trade-off above is the visible one: figure-heavy papers are now large bodies by design.

## Testing

`packages/dsh-reader`: `tests/extract-article.spec.ts` drives two new fixtures and inline cases, each red against the pre-change extractor. `tests/fixtures/arxiv-object-figure.html` (LaTeXML-shaped): the SVG object figure survives as an absolutized `<img>` with width/height, its figure is not counted script-drawn, the PDF object drops whole, and the feed-body path applies the same rule (including no-`data` and `data:`-addressed objects). The data-URI cases: a 1px-gif placeholder still yields to `data-src`, a substantive base64 png is kept verbatim (whitespace-stripped), the 512-char boundary is pinned on both sides, a non-image data URI is never kept, and a substantive data candidate wins a srcset.
