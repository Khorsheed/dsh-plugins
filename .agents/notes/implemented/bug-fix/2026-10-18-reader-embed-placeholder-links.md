# Agent Note: dsh-reader turns embeds (iframe/video/audio) into placeholder links

Status: implemented

## Problem

A reader report (2026-10-18): the self-replicating-ai article's charts were "still not fully captured" after the lead-image graft. The page had been republished: its figures now ship as **sandboxed cross-origin iframe artifacts** — 16 of them (`assets.claude.ai/.../NN-*.html`, interactive charts/tables) — plus one `<video>` figure. The extractor dropped all three tags wholesale (`DROP_TAGS`), so the body read "See the table below" followed by nothing, sixteen times. No notice fired either: `countScriptFigures` only counts `figure` elements, and these embeds sit in plain div wrappers. A rendered capture cannot save them — a cross-origin iframe's document is unreachable from the top frame by construction.

## Decision

`iframe`, `video` and `audio` left `DROP_TAGS` (`src/client/extract-article.ts`); `normalizeNode` routes them to `embedLink`, which emits a **placeholder block link** (`<p data-reader-embed="…"><a href target="_blank" rel="noopener noreferrer">label</a></p>`) sitting exactly where the embed stood — the label is the embed's own `title`, else the source host. The tracker gate keeps beacons out: hidden (`display:none`/`visibility:hidden`) or pixel-sized (≤2px) embeds drop; an iframe with no title must declare content-sized dimensions (≥200px both axes, clearing YouTube-style embeds, rejecting tracker shells); video/audio qualify on a resolvable `src` (or a `<source src>` child) alone — a media file in article markup is never a beacon.

The surrounding rules moved to match reality: `countScriptFigures` treats a figure holding an `iframe[src]`/`audio` as having content (the placeholder IS its picture — counting it would raise the rendered-fetch offer for something no capture can fix); `trimLeadingChrome` stops at a leading embed (an article may open on a video); `serializeInline` skips embeds so card summaries stay clean. The pane styles `[data-reader-embed]` as a bordered block with a ↗ affordance (`ReaderPane.module.css`), and the detail view's trust comment now says the surviving markup carries no live frames, only their links.

## Alternatives considered

**Keep the iframe and let it render.** Refused by the whitelist's founding rule: the body never runs third-party scripts, and a sandboxed `allow-scripts` frame is exactly that. The reader pane renders article markup as DOM text (that is what makes passage quoting work); hosting live frames would unpick it.

**Count embeds as script figures and let 渲染抓取 answer.** The rendered capture serializes the top document; a cross-origin iframe's content is a separate document the parent cannot read. The offer would fire, cost 15–30 s, and change nothing — a control that cannot work is worse than none.

**Fetch the artifact and inline its chart.** Each artifact is its own script-driven page; importing it recreates the injection surface the whitelist exists to refuse, at sixteen times the attack surface.

**No placeholder, just a banner.** A per-article notice cannot say WHERE the sixteen holes are; the in-place link is both the notice and the way out.

## Consequences

- Anthropic-style artifact pages now read whole: every chart/table/video leaves a titled link where it stood (17 placeholders on the report page, verified against the live HTML). The reader opens one in a browser tab to see it live.
- Bodies stored before this fix keep their holes until 「重新抓取」 — `repairStoredBody` cannot resurrect markup that was never stored.
- The gate can misjudge twice: a content iframe with neither title nor size stays dropped (measured rare: publishers' embeds carry one or the other), and a titled tracker would leave a harmless link (no script, no load — the URL only resolves if the reader clicks).
- Tests: `tests/extract-article.spec.ts` pins the placeholder shape (iframe with title, video via src and via `<source>`, YouTube-sized untitled iframe), the tracker drops (hidden / 1×1 / untitled-unsized / `javascript:` src), the figure-count exclusion, and the inline-summary skip; the pre-existing "no `<iframe>` survives" injection assertion is unchanged and green.

## Related

Superseded as the primary rendering later the same day: [embeds render inline](2026-10-18-reader-embeds-inline.md) — the framing-headers measurement said the embeds readers actually hit are served for framing, so the link became the caption under a sandboxed frame. This note's tracker gate and its capture-impossibility argument still stand and are inherited there.
