# Agent Note: a pasted paper link lands as its arXiv HTML version

Status: implemented

## Problem

The inspiration space's second main scene is reading papers (the user's 2026-09-20 framing, see the [ingest proposal](../../../proposals/active/2026-09-20-reader-ingest-capture-documents.md)), and the add flow treated every paper link as an opaque web page:

- an `arxiv.org/abs/<id>` link saved the ABSTRACT page as the "article" — a summary plus metadata, never the paper;
- an `arxiv.org/pdf/<id>` link became a 「仅链接」 card (the fetch seam rightly refuses `application/pdf`), though arXiv ships a LaTeXML-built HTML version of the same paper at `arxiv.org/html/<id>` — measured on `2604.03147v1`: 384 KB of semantic markup with 15 real `<table>`s and MathML formulas, which the existing whitelist pipeline consumes unchanged;
- a `doi.org/…` link was the worst outcome: doi.org answers a cross-origin 302 to the publisher, the host seam refuses cross-origin hops by design, so the card said 「跨站跳转」 and the paper behind the DOI — very often on arXiv — was never found;
- an `openreview.net` link could only be diagnosed by fetching it, and the fetch is measured dead: the API sits behind a Cloudflare challenge (403) and the forum is a JS SPA whose static HTML title is always "Forum | OpenReview". No server-side read of that site exists today.

## Decision

The add flow (`ReaderService.addSource`) recognizes paper links BEFORE the first page fetch, in two stages:

- **arXiv direct upgrade** (`src/arxiv.ts`, pure): `/abs/<id>` and `/pdf/<id>` parse to one paper id (new-style `YYMM.NNNNN(vN)`, the archived `hep-th/9901001` / `math.GT/0309136v3` forms, an optional `.pdf` suffix stripped; `www.` tolerated). The fetch target becomes `https://arxiv.org/html/<id>`; a bare **404** — the only answer that means "this paper has no HTML version" — falls back to the pasted URL through the ordinary path. Any other failure (a 403, a transport error) is a fact about the REQUEST and is reported, never rerouted: quietly fetching the abs page behind a block would file somebody's refusal page under the paper's name. A pasted `/html/` link is already the upgrade and is never rewritten (no loop). The upgrade URL also joins the duplicate check, so the same paper's abs link after its HTML version is a `duplicate`, not a second card. The source stores the HTML URL, so refreshes re-fetch the good version without any marker.
- **Link resolvers** (`src/link-resolvers.ts`, table-driven, one resolver per source, network IO injected so the module is testable pure): a resolver answers an arXiv candidate, an honest link-only verdict, or `null` (not mine — the ordinary path).
  - **doi.org** (`/10.<registrant>/…`): Crossref (`api.crossref.org/works?filter=doi:<doi>&select=DOI,title,author` — the single-work route rejects `select`, measured, and a full work record can exceed the fetch cap; the filtered list route answers a few hundred bytes) gives the title and authors, then the arXiv API (`export.arxiv.org/api/query?search_query=ti:"…"`, no auth) is searched — the full title phrase first, the first eight words when that comes back empty (measured: the full 14-word phrase of the AlphaGo paper finds nothing, its 6-word prefix does). A candidate lands only through a two-factor gate: normalized-title edit similarity ≥ 0.85 AND at least one family-name overlap when both sides carry authors (title-only rises to ≥ 0.95). The author factor exists because a pure title gate measurably misfires: Crossref's "Deep learning" (LeCun, Bengio, Hinton) is a 1.0 title match for arXiv's "Deep Learning" (Polson, Sokolov) — a different paper. **No match is a degrade, never a guess**: the URL falls back to the ordinary path, which for doi.org is the honest 「跨站跳转」 link-only card. A landed candidate stores the arXiv HTML URL as the source, the paper's title as the default label, and the pasted DOI as `resolvedFrom` on the source (the detail view's kicker links it).
  - **openreview.net** (`/forum?id=` / `pdf?id=`): no fetch at all. The measured fact (above) is answered directly: a link-only card with the new `unreadable` failure code — "this page is a JS app behind an anti-bot wall, the server side cannot read it" — whose sentence carries the suggestion (paste the arXiv version if one exists / open it in a browser). Guessing at the paper, or storing the SPA shell, are both refused.

`ReaderPreviewFailureCode` gains `unreadable` for the second resolver: distinct from `blocked` ("we tried and the site answered a wall") in that nothing was tried — the host KNOWS this site cannot be read server-side, and the sentence says what to do instead. Not retryable, like every wall.

## Alternatives considered

**Fetch first, recognize later (the old shape).** A doi.org fetch is a refused cross-origin hop BY DESIGN, so "the normal path" is a guaranteed failure for the most common paper-link form; and OpenReview's fetch answers a 200 challenge page, the exact page that used to become the card's body. Recognition must precede the fetch for these hosts.
**Client-side resolution.** The host owns egress (`ctx.web` is the only sanctioned way out), and the resolvers need two API calls per DOI; a browser-side resolver would still ride the host for the fetch and split the classification across the process boundary — the same state in two derivations, the [fetch-state propagation bug](../bug-fix/2026-09-20-reader-fetch-state-propagation.md)'s root cause.
**Title similarity alone as the arXiv gate.** Measured wrong: short generic titles collide across different papers ("Deep learning"). The author-overlap factor is what makes "no match → degrade" honest; without it the gate guesses.
**Resolving OpenReview through the future capture package (M1).** Still the plan when capture exists — the resolver's link-only answer is the absent-capture branch, and the proposal keeps the rendered-forum title extraction for M1. Shipping the honest degrade now means the card is right with or without that package.
**Upgrading arXiv links inside feeds (the `fetchEntryBody` path).** Deferred deliberately: the add flow is where the reader pastes a paper, and upgrading every feed item's arXiv link would turn the backfill into multi-hundred-KB HTML fetches nobody opened. The stored-source upgrade already covers refreshes; feed entries keep their publisher's URL.

## Consequences

- A pasted arXiv link lands the paper (tables, MathML formulas — rendered natively since the [MathML passthrough](2026-09-20-reader-mathml.md)) instead of its abstract; a pasted DOI that gates through lands the same paper with its origin marked; an OpenReview link is an honest card instead of a challenge page.
- arXiv HTML pages exceed the fetch seam's default 100,000-char cap (measured 384 KB), so the existing 「内容未完整呈现」 truncation path is what a default deployment shows; the deployment-side `maxBodyChars` patch (the acceptance instance runs 64 MB) lifts it. The upgrade makes this limit VISIBLE on the main scene rather than rare.
- The DOI path costs two extra API requests per pasted DOI and both are new network trust: Crossref and arXiv answers are parsed defensively (JSON parse failure, missing fields and truncation all degrade to the ordinary path), and no API answer is ever rendered — only the gated id becomes a URL.
- `resolvedFrom` joins the source document (optional, normalized like every field); old documents read as before.

## Testing

`packages/dsh-reader` — the new cases each ran red against the pre-change code:

- `tests/host-pure.spec.ts`: the arXiv id shapes (abs/pdf/html, versions, old-style, `.pdf` suffix, `www.`), the non-paper rejections, the upgrade map; the DOI match shape; title normalization and the edit-similarity gate (identical-after-normalization, subtitle drift, the "Deep learning" near-collision); author family-name overlap; the resolver table's DOI and OpenReview answers against fixture payloads (Crossref JSON, arXiv Atom), including Crossref 404, truncated JSON, an empty search and a gated-out candidate.
- `tests/boot.spec.ts`: abs → the HTML URL is fetched and stored (abs never requested); pdf with version+suffix; 404 falls back to the pasted URL; 403 does NOT fall back; a pasted `/html/` link is fetched as itself; the same paper via its second URL is a duplicate. DOI end-to-end with a scripted seam: gated hit lands the HTML URL, title label and `resolvedFrom`; a gated-out title keeps the ordinary path. OpenReview is saved link-only with `unreadable` and the seam is never called.
