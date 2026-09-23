# Agent Note: formulas survive the whitelist (presentation MathML)

Status: implemented

## Problem

The [arXiv HTML upgrade](2026-09-20-reader-link-ingest.md) lands papers whose formulas are MathML — `<math alttext="…">` LaTeXML output — and the extractor dropped every `<math>` subtree before scoring: the paper arrived with its equations silently gone, which for the reading-papers main scene is the difference between the text and the text's content. The whitelist dropped `math` wholesale because markup from a fetch is untrusted, and MathML has one genuine injection-shaped member (`annotation-xml`).

## Decision

`extract-article.ts` now passes a **safe presentation-MathML subset** — `math, mrow, mi, mo, mn, ms, mtext, msup, msub, msubsup, mfrac, msqrt, mroot, mspace, mtable, mtr, mtd, munder, mover, munderover, semantics, annotation` — because the render target is Chromium ≥ 153, which paints it natively: no script, no font download, no third-party renderer. The rules:

- `math` leaves `DROP_TAGS`; `annotation-xml` ENTERS it. An `annotation-xml` with `encoding="text/html"` parses its children as HTML (the HTML5 parser switches back inside it), which is the one MathML-shaped HTML-injection vector — the subtree never reaches the normalizer.
- Attributes: `math` keeps `alttext` (the formula's plain-text twin — accessibility, and a readable fallback where MathML is unsupported) and `display` (block vs inline); everything else — event handlers, `href` on `<mi>`, style hooks — is stripped by the same filter as every other tag.
- `<semantics><annotation>` survives with its `encoding` stripped: the TeX source is markup-invisible data the page published, and quoting/translation flows can see it. Unknown MathML (`mglyph`, `mpadded`, `menclose`, …) unwraps to its children, which for a formula is its readable text.
- A formula-only `<figure>` is not a script-drawn figure: `countScriptFigures`'s content probe gains `math`, so the 「脚本绘制插图」 notice never fires for a figure whose picture is markup.
- Inline summaries flatten math to its text (the INLINE pass keeps emphasis only) — a card summary carries the words, not the structure.
- CSS: `.article math[display="block"]` is a block that scrolls HORIZONTALLY instead of breaking the body's right edge (the contract `pre` already keeps); inline math rides the text.

## Alternatives considered

**Render TeX from `alttext` through KaTeX/MathJax.** A vendored renderer is a megabyte-class client-bundle dependency plus a font story, to produce what the browser already paints; the design's whole point is application-level DOM with zero third-party runtime.
**Keep only `alttext` as TEXT, drop the markup.** Readable, but a fraction tower flattens into alphabet soup — the markup IS the content for anything past a one-symbol formula.
**Keep `annotation-xml` too.** It carries nothing the reader needs (`annotation` already holds the TeX), and its HTML-parsing switch is the injection vector; dropping the subtree is the whole safety story.
**Parse `$…$` in arbitrary blog prose into MathML.** Out of scope, recorded: that is a heuristic language parse of untrusted text (false positives in prose about money are the classic failure), while arXiv HTML — the main scene — arrives with real MathML already. Revisit only if a non-arXiv source with real formula content shows up.
**In-pane anchor navigation for arXiv internal links** (`#cite.*`, `#fig.*`). Deferred, named: the whitelist strips every `id`, so an in-pane scroll target does not exist; restoring ids is a normalization-contract change (every stored body's bytes change, every translation map re-keys, `absolutize`d hash links currently open the full page externally which is a working fallback). Sized beyond M0's "if cheap" gate.

## Consequences

- arXiv HTML bodies arrive with their formulas rendered; the two real-page fixtures extract byte-identically (they carry no math), so nothing else moved.
- The formula text now counts toward paragraph mass in scoring (math subtrees used to be dropped BEFORE scoring) — more correct for math-heavy pages, and a no-op for pages without them.
- MathML in a translated article: `translate.ts` decorates text nodes; math tokens (`<mi>x</mi>`) are text nodes, so a translated view may localize single letters — bounded, cosmetic, and the original is one globe-click away.
- The security invariant is stated by the whitelist, not by a sanitizer pass: scripts, events and `annotation-xml` have no path in.

## Testing

`packages/dsh-reader` (+5, each red against the pre-change extractor): `tests/extract-article.spec.ts` drives a real-shaped arXiv fixture (`tests/fixtures/arxiv-math.html`, LaTeXML-flavored) — the safe subset survives with `alttext`/`display`; the TeX `<annotation>` survives attribute-stripped; `annotation-xml` with an HTML payload, a script nested directly in `<math>`, and an `onerror` img are all pinned GONE; a formula-only figure does not raise the script-figure notice; the feed-body path (`normalizeRichText`) keeps math; an inline summary flattens it to text.
