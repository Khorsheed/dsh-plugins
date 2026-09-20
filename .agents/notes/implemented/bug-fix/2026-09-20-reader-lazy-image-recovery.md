# Agent Note: the reader recovers lazy-loaded images

Status: implemented

## Problem

The extractor read exactly one attribute of an `<img>`: `src`. Lazy-loading sites ship a 1px `data:` placeholder there (or nothing at all) and keep the real URL one attribute over — in `data-src` and its kin, in `srcset`, in a `<picture>`'s `<source>`s, or in the `<noscript>` no-JS fallback. A fetch runs no scripts, so that static markup is the ONLY copy the reader can ever get, and the normalizer threw it away: `data:` was rejected as a scheme, `<noscript>` was in `DROP_TAGS` and removed before scoring, `<picture>` was unwrapped (its fallback `<img>` then usually died on the placeholder `src`), and `srcset` was never read. The detail view also emitted bare `<img>` tags, which anti-hotlink CDNs answer with a 403. (The reader-visible symptom sat next to the script-figure gap the [state-boundaries note](../architecture/2026-09-19-reader-state-boundaries.md) cites: the reported paper's 27 dimensionless images.)

## Decision

All in `client/extract-article.ts`:

- **Candidate order for an `<img>`**: a real `src` first (a `data:` URI there is the classic placeholder and counts as ABSENT), then the lazy attributes (`data-src`, `data-original`, `data-lazy-src`, `data-url`, `data-actualsrc` — a deliberately tight list), then the largest `srcset` candidate (`w` and `x` descriptors ranked by their number). Only when nothing usable remains is the image dropped.
- **A `srcset` is not split naively on commas**: a `data:` URL carries a comma of its own, and the payload tail of a split one parses as a candidate that can WIN. The halves are rejoined first (the rejoined candidate is then rejected as a scheme, as before).
- **`<picture>` normalizes to ONE `<img>`**: the first usable `<source srcset>`, else the fallback `<img>` (whose `alt` either way survives). The whitelist has no picture/source, so keeping the wrapper would duplicate or lose the image.
- **`<noscript>` left `DROP_TAGS`** and is handled by the normalizer: if it contains an `<img>` — the standard no-JS fallback — that image is recovered; anything else a noscript carries ("please enable JavaScript") is dropped exactly as before, including from inline summaries. The content parses as elements under a scripting-disabled parse (what a fetch gets; verified in jsdom) and as text under a scripting one, so both shapes are handled.
- **Scoring does not count an `<img>` inside a `<noscript>`**: it is the fallback duplicate of a picture the markup already holds, not a second picture.
- **Every normalized `<img>` carries `referrerpolicy="no-referrer"`** — emitted, not copied: the reader has no page context to refer from, and the lazy-loading sites are the ones whose CDNs 403 a hotlink.
- **`scriptFigures` is unchanged**: a figure whose picture exists only at runtime (an empty container and a caption) still produces the notice. The line this fix draws is exactly "the URL is in the static markup" versus "the page draws it".

## Alternatives considered

**Leave lazy images lost and say so, like the script figures.** The script-figure notice exists because that case is genuinely unrecoverable; a URL sitting in `data-src` is not, and the two failures read the same to the reader only if we choose to treat them the same.
**Fetch images through the host and inline them.** The host's seam caps bodies and re-fetching every image multiplies requests; recovering the URL costs nothing and lets the browser load the image itself.
**Parse `srcset` per the full HTML spec algorithm.** The ranking here (number of the descriptor, bare URL smallest) is wrong only for markup that is invalid anyway (mixed `w`/`x` in one list); the data-URI rejoin is the one case that actually occurs.
**Keep `noscript` in `DROP_TAGS` for scoring and recover at normalize time.** Impossible: the pre-scoring strip removes the subtree from the document the normalizer walks. What reaches scoring instead is a small text mass noscripts rarely carry and an image count that now skips them.

## Consequences

- Articles on lazy-loading sites (a large share of the modern web) now arrive with their pictures; the CDN 403s are gone with the `no-referrer` emission.
- A figure whose only markup copy of the picture is the noscript fallback is no longer counted as script-drawn — correctly, since the picture now renders.
- The scorer sees noscript subtrees now (they are no longer stripped before scoring). Their usual content — one image, no prose — does not move a score, and the image count explicitly skips the duplicates; both real-page fixtures extract byte-identical bodies.
- An image that is ONLY a `data:` URI (no lazy attribute, no srcset) is still dropped — the same outcome as before, reached by a different road.

## Testing

`packages/dsh-reader` runs 271 tests (+10): each recovery path has its own case in `tests/extract-article.spec.ts` (lazy attributes, the `data:` placeholder fall-through, srcset width and density descriptors, the data-URI comma, picture source and fallback, noscript recovery, the noscript-that-is-not-an-image, referrerpolicy on the emitted tag), plus the regression that the script-drawn-figure notice is unchanged. The two real-page fixtures still extract the same bodies.
