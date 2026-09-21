# Agent Note: a figure the page draws is not a figure the fetch can bring, and the search field owns its width

Status: implemented

## Problem

Two reports, one of them a bug this repository introduced hours earlier.

**The search field was not sized to the sidebar.** `width: 100%` on an input with `content-box` is 100% **plus** its padding and border. The field's right padding had just grown from 8px to 28px for the in-field clear button, so the field hung ~56px past the pane's right edge — visibly "not adapted to the sidebar". The panel's own source-search had been fixed for the same class of mistake (a `flex: none` wrapper around a 100%-wide input); the wall's field kept the old one.

**The article's figures were missing.** Fetching `transformer-circuits.pub/2026/workspace/index.html` and rendering it showed the text and captions but no illustrations: measured, the served HTML has 102 `<figure>` elements and 18 `<img>`, and 84 of those figures contain **an empty `<div class='intro-structural'>` plus a caption** — the illustrations are painted by the page's own scripts at runtime. The detail view rendered those captions under nothing, which reads as "the plugin lost my images" rather than "this page draws them".

**The badge said the wrong thing.** The card for that article carried 「已补全」 ("complete") while still showing the feed's 167-character summary, because the badge marks "the full text was fetched and cached", not "the card shows it". The copy and the label never said which. This is the same confusion the summary/body batch addressed one step earlier; the badge was the last surface still asserting completeness.

## Decision

- **The field is `border-box`.** A form control that must not exceed its container declares `box-sizing: border-box`; the CSS test suite now pins it, because this is the second time the same mistake cost a reader-visible defect.
- **Figures with no picture are counted, and their captions stay.** `extractArticle` counts every `<figure>` whose subtree has no `<img>`, `<svg>`, `<canvas>`, `<video>`, `<picture>`, `<math>` or image-typed `<object>` AND no substantial text of its own past the caption (a capture-rendered composite of styled boxes IS content — see the [figure-layout note](2026-09-21-reader-figure-layout.md)) — and the caption is kept, because it is text the page published (the earlier drop-them version misread as data loss). The count travels with the body — persisted on the entry annotation (`ReaderEntryBody.scriptFigures`), reported by `getEntryBody` and by the fetch — and the detail view says 「这一页有 N 张插图由页面自己的脚本绘制，抓取时拿不到」 with 「阅读原文」 next to it.
- **The badge says what it means.** 「已补全」 became 「已抓全文」 and its tooltip states the actual situation: the card still shows the feed's own summary, the full text is cached, open it to read.

## Alternatives considered

**Render the captions and leave a placeholder box for the missing image.** Rejected: a placeholder asserts an image exists and could not be loaded, which is the opposite of the truth — the page never put one in the HTML. The note above the body is the honest version.

**Keep the empty figures and say nothing.** Rejected: that is the reported state, and it reads as a defect in this plugin rather than a property of the source page.

**Try to run the page's scripts (a headless renderer).** Rejected for this package: `ctx.web.fetch` is the sanctioned egress seam and it fetches bytes; executing a page's scripts needs the browser pane, which is still `planned` and is explicitly out of this plugin's scope. This is the same boundary that makes feed parsing live in the browser half.

**Count figures by caption presence instead of by picture.** Rejected: a figure with a real `<img>` and no caption is fine, and a figure with neither is noise. "Does it contain a picture element?" is the question that decides whether anything was lost.

**Rename the badge away entirely (drop it).** Rejected: it still carries information the summary cannot — the body behind the card is longer than the feed's own text — and the fix was that its words were wrong, not that it existed.

## Consequences

- The transformer-circuits.pub paper's note reads "84 张插图" — a large number because that page really does draw nearly every illustration, including the visual table of contents. The count is the truth about the delivered HTML, not an estimate.
- Captions of script-drawn figures are dropped with them, so a little descriptive text goes with the missing pictures. That is the price of not showing a caption under nothing, and the original page is one click away.
- `ReaderEntryBody.scriptFigures` is persisted with the cached body, so reopening an entry shows the same note without refetching; it is absent (not zero) when nothing was dropped, and `normalizeStateDoc` drops unknown fields as usual.
- The `已抓全文` badge still appears for entries the **backfill** filled, not for bodies fetched by opening — `noteBackfilled` is the only writer. An entry the reader fetched by hand shows no badge, which is correct: the badge marks work the plugin did on its own.
- The width fix restores the field to the pane's inner width; the reserved 28px right padding now eats into the field's own box rather than overhanging the layout.

## Testing

`packages/dsh-reader` runs 212 tests (4 new):

- `extract-article.spec.ts`: a caption-only figure is dropped and counted while a figure with `<img>` survives (its relative `src` absolutized); a page whose figures all carry pictures reports no count.
- `ReaderPane.client.spec.tsx`: opening an entry whose fetched body reports script-drawn figures shows the note with that count and the 「阅读原文」 action.
- `host-pure.spec.ts`: `.search input` declares `box-sizing: border-box` alongside `width: 100%`.
