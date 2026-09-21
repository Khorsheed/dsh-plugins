# Agent Note: a composite figure's containers are its content

Status: implemented

## Problem

Live on 3199, capture fetched transformer-circuits.pub/2026/workspace: its Figure 2 is an HTML+CSS composite — a left SVG diagram plus three property cards built from styled divs. The reader's stored body (the real capture output post-extraction, 3.6 MB) shows the cards as one concatenated run — `Intermediate processing stageJ-space carries workspace-like content only at intermediate depthsLimited capacity…` — the user read it as 「一个图被抓成三个图」. Two extractor behaviors combined into that: `normalizeNode` unwraps non-whitelist containers with NO boundary, so when capture's serialization carries no inter-tag whitespace (outerHTML has none), sibling card texts concatenate; and any `style` on figure-internal containers is stripped, so the layout that made them CARDS is gone. Fine for article prose; destructive for capture-rendered composite figures.

## Decision

Both halves live in `client/extract-article.ts`:

- **Inside `<figure>`, structure keeps.** A figure-scoped normalizer (the recursion carries `inFigure`; only the figure's descendants are in it) keeps `div`/`span` as real elements, each with its `style` filtered through a property ALLOWLIST — layout and paint only: display, position (value-gated to static/relative/absolute), inset offsets, flex/grid families, sizing (width/height/max-/min-), margin/padding, gap, color/background, border family, overflow, font/text metrics, transform, opacity, visibility, and z-index bounded at 5. Stripped by the value gates even when the property is allowlisted: `url(…)` that is not a same-document `#fragment` (the SVG walker's gate, reused), `javascript:`, `expression(`, `behavior`. A kept container with neither text nor style left is dropped as the shell it is. Outside figures nothing about the unwrap changes shape — read on.
- **Unwrapping leaves a word boundary, everywhere.** A block-ish container that unwraps (div/section/article/main/details/summary/hgroup/fieldset/center, and any custom element) emits `\n` around its children: capture's serialized markup carries no inter-tag whitespace, so the boundary is what stops two siblings reading as one word. Inline-ish unknowns keep the old flush behavior. The same rule joins the inline-summary pass (a flattened block leaves a trailing space). The two public edges (`normalizeElement`, `normalizeRichText`) trim dead boundary newlines, so bytes at the margins stay as they were.
- **The script-figure counter learned the composite shape**: a figure with no picture element but enough text of its own past the caption (≥ 20 collapsed chars) IS content — it is not counted. The genuinely empty shell (an empty host div plus a caption) still is, so the notice keeps telling the truth.

## Alternatives considered

**Rasterize composite figures capture-side (PNG screenshots embedded).** The exact look, but dead text: a figure's words must stay quotable and translatable (the whole reason the body is application-level DOM), and rasterization is the capture design's documented降级 option, not its v1. Recorded as the fallback if a composite ever arrives that no markup subset can carry.
**Keep ALL styles inside figures.** A raw `style` carries `position: fixed`, `z-index: 9999`, external `url()`s and legacy script-ish properties into the reader's chrome — the allowlist is the difference between a figure's layout and a page's overlay.
**Block-level separation (`<div>` emitted as real block with no style) for every unwrap.** A middle option that changes every page's DOM shape for a bug about whitespace; the newline boundary is the minimal fidelity fix, and figure-scoped structure is the layout one.
**Boundary only inside figures.** The live evidence was a figure, but the same concatenation bug exists for any whitespace-free serialization — the boundary is global precisely because it is cheap and prose-safe (whitespace collapses in render).

## Consequences

- The composite figure reads as its three cards with their layout (flex row, card boxes, typography), and every page's unwrapped containers stop concatenating — a pure text-fidelity fix with bytes unchanged at the margins.
- Existing extraction tests and the two real-page fixtures pass unchanged in content (the only expectation updates are the two inline-summary boundary pins, documented in place).
- Kept styled divs render inside the article's normal flow (`.article` CSS needs nothing: divs are block, spans inline); a figure that is ALL styled color and no text still reads as script-drawn — the accepted edge, since capture's empty shells also carry inlined styles and text is the only discriminating signal.

## Testing

`packages/dsh-reader` (+5, red-first): `tests/extract-article.spec.ts` drives `tests/fixtures/capture-composite-figure.html` — the Figure 2 composite reconstructed from the stored capture body, with the three cards' verbatim texts and the region serialized whitespace-free exactly as outerHTML arrives (that is what makes the red honest: the pre-change code concatenates `stageJ-space`). The cards keep their containers and allowlisted styles; hostile declarations (`position: fixed`, `z-index: 9999`, external `url()`, `behavior`) are stripped while the card's real layout stays; the composite is not counted script-drawn while an empty shell still is; outside figures the unwrap shape is unchanged except the boundary; the inline summary gains the same boundary. The two pre-existing expectation updates (edge-trim, inline spacing) are pinned with their reasons.
