# Agent Note: images keep the page's display width; WeChat's donation card is dropped

Status: implemented

## Problem

Two extraction defects reported on 2026-10-27:

- **Logos three times too large.** claude.com's nonprofit article shows organization logos at a fixed width through an inline style (Best Friends: a 132×128 PNG with `style="width:48.89px"`; the testimonial logos sit in `<picture>`). The normalizer emitted every `<img>` without a size, so each rendered at its natural pixel size up to the column.
- **WeChat's donation card in the body.** mp.weixin.qq.com answers a plain fetch with a bot check, so the reader renders the page in a headless browser. The page's scripts then fill in the 腾讯公益 card (「邀请你前往腾讯公益一起捐」, 一起捐, the donors' avatars) under `#content_bottom_area`, and 「预览时标签不可点」 in `#js_tags_preview_toast`. Both sit in the winning container (`.rich_media_area_primary_inner`) beside `#js_content`.

## Decision

- **Carry an inline pixel width.** A bare `<img>` and a `<picture>` (through its `<img>`) emit `width="N"` when the page's inline style sets `width: Npx`. Percentages, `auto` and `max-width` are ignored, and the column's `max-width: 100%` still caps the image. The `width` attribute is not carried: it is usually the file's own size, which changes nothing, and existing output stays byte-identical.
- **A per-site noise list, by stable platform ids.** `NOISE_SELECTORS` (`#content_bottom_area`, `#js_tags_preview_toast`) is stripped together with the drop tags before scoring. Each entry is a platform's own id.
- **WeChat's article root is taken by name.** The same day showed the noise list was not enough: a rendered fetch also fills body-level modal layers (the font-size panel, the complaint dialog, the comment-identity popover, a11y labels), and the scorer let a container holding them win, along with the series card (目录 / 上一篇 / 下一篇). `ARTICLE_ROOTS` (`#js_content`) is now taken as the body without scoring when it holds at least 120 characters; the title comes from the document `<title>`.

## Alternatives considered

**Scoring alone, with a longer noise list.** Rejected after the modal layers turned up: WeChat ships dozens of such layers, and naming the article root is one stable id instead of a growing list.

**Drop images whose class mentions `logo`.** Rejected: on this page the logos are content (who said the quote).

## Consequences

- Bodies already stored keep their old rendering until they are fetched again (重新抓取).
- A `<picture>` whose first `<source>` is a `prefers-color-scheme: dark` variant still shows that variant in both themes (pre-existing).
