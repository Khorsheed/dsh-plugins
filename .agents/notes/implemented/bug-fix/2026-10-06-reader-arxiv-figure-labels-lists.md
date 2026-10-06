# Agent Note: The reader keeps arXiv diagram labels and settles LaTeXML list labels

Status: implemented

## Problem

An arXiv HTML article (`arxiv.org/html/2610.06783v1`) showed two defects. Both were measured 2026-10-06 on the stored body and the source page.

- **Figure 1 was empty boxes and arrows.** LaTeXML renders TikZ diagrams as `<svg>`, and every node label is HTML inside a `<foreignObject>` (303 of them on this page). The extractor dropped `foreignObject` whole as "the HTML-injection vector inside SVG", so every label was lost.
- **Every list item showed `•`, a line break, then the text.**
  - LaTeXML turns the native marker off (`list-style-type:none`) and writes the label as a tag before a block paragraph: `<li><span class="ltx_tag ltx_tag_item">•</span> <div class="ltx_para"><p>…`.
  - Without the page's stylesheet, the native disc came back next to the written `•`, and the paragraph dropped to the next line.
  - Enumerations (`(a)`, `(1)`) showed both the native number and the written label.

## Decision

- **`foreignObject` is kept.** Its children walk the body's own HTML whitelist (`normalizeChildren`, figure mode), and its attributes go through the SVG attribute whitelist, which gains `overflow`. Scripts, handlers and iframes inside it are stripped exactly as they are in the body.
- **LaTeXML classed spans keep their meaning:**
  - `ltx_p` becomes a block (`<div>` inside a figure, a line boundary elsewhere);
  - `ltx_font_bold` becomes `<strong>`, `ltx_font_italic` becomes `<em>`;
  - a bare span inside a figure (no allowed style) unwraps.
- **`settleListLabels(root)` matches by structure.** It applies when an `<li>`'s whole leading text (a text node or a childless span) is followed by a `p`/`div` block holding a paragraph:
  - a bullet glyph is removed;
  - an item label (`1.`, `(2)`, `a)`, `(iv)`) moves into the first paragraph, and the item gets `data-labelled`. That attribute is whitelisted on `li`, and the pane hides the native marker for it.
  - `li > p:first-child` loses its top margin.
- **Display-time repair is renamed `repairStoredSvg` → `repairStoredBody`.** It now also runs `settleListLabels`, and its fast path checks `<svg` or `<li`.
- **Measured on the page and the stored body:**
  - fresh extraction keeps all 303 labels, with 0 doubled bullets left and 15 labelled items;
  - the stored body goes from 42 doubled bullets to 0;
  - a headless Chrome screenshot of the extracted figure matches the source layout.

## Alternatives considered

**Rasterize the diagram, or keep it as an `<img>` of the SVG.** arXiv serves no separate image for TikZ figures. An image would also lose the label links and translation.

**Match lists by the `ltx_tag_item` class only.** The whitelist strips classes, so bodies stored before the fix would never be repaired. Matching the structure covers both the raw page and stored bodies.

## Consequences

- Labels lost from stored bodies cannot be replayed, because the old extractor never kept them. Such an article needs 「重新抓取」 once. List repair happens at display time without a refetch.
- Translation now also reaches diagram labels. A translated label can be longer than its box; `overflow="visible"` lets it spill rather than clip.
- `foreignObject` in any SVG, not only LaTeXML's, now keeps whitelisted HTML.
- Tests (`tests/extract-article.spec.ts`):
  - the capture fixture's foreignObject keeps only its label (no handler, script or iframe);
  - LaTeXML figure labels, bullet and enumerated items, and a non-label leading text that is left alone;
  - stored-body list repair is exact and idempotent.
