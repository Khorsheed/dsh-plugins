# Agent Note: inline SVG figures survive the whitelist

Status: implemented

## Problem

`@khorsheed/dsh-capture` (the [ingest proposal](../../../proposals/active/2026-09-20-reader-ingest-capture-documents.md)'s M1, merged) returns RENDERED pages: figures the origin site paints with scripts — the exact content capture exists to rescue — arrive as inline SVG with computed styles inlined onto the elements. The reader's extractor dropped `svg` wholesale (`DROP_TAGS`), so a capture-fetched article lost precisely those figures: the page paid for a render and got a caption.

## Decision

`extract-article.ts` keeps a static SVG subset (`normalizeSvg`, a per-element walker the generic normalizer enters at `<svg>`):

- **Elements**: shapes (`path, circle, ellipse, rect, line, polyline, polygon`), text (`text, tspan, textPath`), structure (`svg, g, defs, symbol, use, marker`), paint (`clipPath, mask, pattern, linearGradient, radialGradient, stop`), and `desc`. Looked up case-insensitively and emitted in canonical casing (the HTML parser's foreign-content adjustment already produced it; the emitted string is re-parsed as HTML downstream). Unknown elements unwrap to their children, exactly like the HTML path. SVG `<title>` is deliberately absent: it collides with the HTML `<title>` in the pre-scoring strip, and `<desc>` carries the accessible text.
- **Dropped with their subtrees, always**: `script`, `foreignObject` (the HTML-injection vector inside SVG), and every SMIL element (`animate`, `animateMotion`, `animateTransform`, `set`) — static figures need none, and animation is the event-adjacent surface.
- **Attributes**: one whitelist — geometry, presentation, the capture pipeline's inlined `style` (CSS is non-executable), paint/clip reference attrs, and `id` (every `url(#…)`/`href="#…"` points at it). Any value containing `url(` must open a same-document fragment, so no external paint server, font or tracking pixel loads. `use`/`textPath` keep `href` ONLY as a fragment (`#…`) — an external reference drops the element; legacy `xlink:href` normalizes to `href`.
- **The script-figure probe is unchanged and now honest for this shape**: `svg` was always in its content list, so a figure whose SVG is kept is not counted; genuinely empty runtime shells still are (the notice keeps telling the truth).
- **No per-element size cap**: the body's own machinery (the fetch seam's cap, the sidecar threshold) bounds the whole markup; a chart's `<path>` data is the content that cap exists to bound.
- Summaries stay clean: the inline pass skips `svg` subtrees (a chart's `<text>` labels are chart chrome, not prose), same as `object`/`noscript`.

## Alternatives considered

**Keep dropping svg and let capture rasterize figures to PNG.** The capture design already chose SVG-over-raster for v1 (the proposal: rasterization is the降级 option, and it loses quotable text); the reader dropping the SVG it receives would silently veto that decision downstream.
**A per-element allowlist per SVG tag** (path gets d, circle gets cx/cy/r, …). Per-tag precision buys nothing against a global list whose members are all inert geometry/presentation values, and it rots the day a chart uses a new combination; the dangerous attributes (events, external refs) are excluded by the global list plus the value gate, not by per-tag tables.
**Keep SMIL animations.** Dead weight for a static snapshot and the only script-adjacent surface in SVG; dropped.
**`<image>` inside SVG (external raster or data URI).** Not in v1: external raster via SVG is already covered by the page's own `<img>`s, and the data-URI policy's reuse there is untested surface. Recorded as the first candidate if a real capture shows charts embedding raster.

## Consequences

- A capture-rendered article arrives with its charts intact — colors (gradients, inlined styles, CSS vars resolved upstream), clipping, symbol reuse — and the script-figure notice stops claiming they're missing.
- The two real-page fixtures and every existing extraction test are byte-identical (no svg in them); the feed-body path (`normalizeRichText`) applies the same subset.
- The security invariant stays stated by the whitelist: no scripts, no events, no foreign HTML, no external references — by list and by value gate, not by a sanitizer pass.

## Testing

`packages/dsh-reader` (+3): `tests/extract-article.spec.ts` drives `tests/fixtures/capture-svg.html` (a capture-shaped figure: gradients, clip path, symbol `<use>`, tspans, inlined styles) — the chart survives with internal fragment refs intact; `script`/`foreignObject`/`onload`/`animate`/external-`use`/external-`url()` are all pinned GONE (the external-style rect keeps its other attributes); `scriptFigures` counts only the genuinely empty shell; the feed-body path applies the same subset and the inline summary drops chart text.
