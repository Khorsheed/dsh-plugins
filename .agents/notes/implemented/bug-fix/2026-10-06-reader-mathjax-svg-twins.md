# Agent Note: The reader keeps MathJax's MathML copy of a formula and drops its glyph drawing

Status: implemented

## Problem

A Springer article (EPJ Data Science, rendered through capture) showed broken formulas: stray horizontal lines, blank gaps where inline symbols should be, display equations scattered over several lines, and a literal `\#` in a text run. Measured 2026-10-06 on the stored body:

- Springer typesets with MathJax 2's SVG output, which renders every formula twice. First comes an `<svg>` assembled from `<use href="#MJMATHI-49">` references into a glyph table that lives in one hidden page-global `<svg>`. Then comes the same formula as MathML, inside an "assistive" span clipped to 1px.
- The extraction never carries that glyph table. Each drawing therefore degrades to its `<rect>` fraction bars, which are the stray lines. The hidden MathML, the only copy that could still render, stayed inside its wrapper's inlined 1px `overflow: hidden` style.
- The display-math copy was visible but laid out wrong: `.article math[display="block"] { display: block }` turns `<math>` into a plain CSS box. A `<math>` with several children and no wrapping `<mrow>` then loses its MathML layout.
- The source TeX writes `\text{\# dreams}`. MathJax draws it as `#` (the SVG uses glyph `MJMAIN-23` only), but the MathML annotation keeps `\#` verbatim.

## Decision

- `settleMathJaxTwins(root)` in `extract-article.ts` handles an `<svg>` drawn from `#MJ…` glyph references whose next element sibling is a `<math>`, or a wrapper whose only element child is a `<math>`:
  - the `<svg>` is removed;
  - the wrapper is replaced by its `<math>`;
  - TeX escapes in `<mtext>` runs (`\# \% \& \$ \_ \{ \}`) are undone.
- It runs in `extractArticle` before scoring, and in `repairStoredSvg` at display time. Bodies cached before the fix are settled without a refetch. On the stored Springer body: 53 → 17 `<svg>` (icons and figures remain), 36 formulas kept as MathML, no 1px wrapper left.
- Display math keeps `display: block` as the fallback and adds `display: block math`, which keeps the MathML formatting context.

## Alternatives considered

**Carry MathJax's glyph table into the body.** It is a page-global hidden `<svg>` of several hundred paths. The extraction would have to re-attach it and keep `<use>` targets resolvable across the body. The MathML copy is already present, is searchable and selectable, and follows the reader's font size and colour.

**Match the assistive span by its class.** Class names are stripped by the whitelist, so stored bodies no longer have them. Matching the structure (glyph-reference `<svg>` followed by a sole `<math>`) works on both the raw page and stored bodies.

## Consequences

- Any MathJax 2 SVG page (not only Springer) gets the MathML rendering. An `<svg>` using a non-`#MJ` sprite (site icons) is untouched, and so is a glyph `<svg>` with no MathML twin.
- `repairStoredSvg` stays idempotent: a settled body has no glyph-reference `<svg>` left to match.
- Tests (`tests/extract-article.spec.ts`):
  - extraction keeps the inline and display MathML, unclipped, with `\#` undone;
  - an icon `<svg>` stays;
  - a stored body is settled exactly and idempotently.
