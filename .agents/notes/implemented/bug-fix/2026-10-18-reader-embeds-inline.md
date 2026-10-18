# Agent Note: dsh-reader renders content embeds inline (sandboxed frames, native media)

Status: implemented

## Problem

The [placeholder-link decision](2026-10-18-reader-embed-placeholder-links.md) answered "the chart vanished" with a link to open elsewhere — the honest floor. The reader's follow-up was the obvious one: why can't the chart just BE there? The founding refusal ("the body never hosts an iframe") predated measuring what the web actually ships: the embeds readers hit (Anthropic's artifact charts, YouTube players) are served for framing — the report page's 16 artifacts carry no `X-Frame-Options`/`frame-ancestors` (verified 2026-10-18), and the source page itself embeds every one behind `sandbox="allow-scripts"`.

## Decision

`embedElement` (`src/client/extract-article.ts`) now KEEPS a content embed instead of linking it:

- **iframe → a sandboxed frame**: `sandbox="allow-scripts"` and never `allow-same-origin` — the frame's scripts run on an opaque origin with no sight of the pane, no popups, no top navigation, exactly the containment the source page itself uses — plus `loading="lazy"` and `referrerpolicy="no-referrer"`. The caption link stays under the frame as the way out when one fails to load. Sizing comes from the page: the wrapper's aspect box (`padding-bottom: N%`, the Anthropic ArtifactEmbed shape) becomes `aspect-ratio`, else the frame's declared dimensions, else the pane's default height. A fixed aspect ratio also means the frame never grows the document under a restored reading position — the old "images have no dimensions" drift does not return through this door.
- **video/audio → native `controls` players** with `preload="none"`: media elements run no scripts, autoplay is stripped, and nothing downloads until the reader presses play. The `poster` survives scheme-checked.
- The tracker gate is unchanged and now guards a load, not a label: hidden or pixel-sized embeds drop, and an iframe with no title must declare content-sized dimensions (≥200px both axes).

The pane's article styles anticipate the frames (`.article [data-reader-embed]`, `ReaderPane.module.css`), and the trust comments on both sides of the seam now state the rule: the body never carries scripts, styles, forms, or event handlers — a kept embed is a sandboxed opaque-origin frame or a controls-only player.

## Alternatives considered

**The placeholder link (kept as the caption, not the answer).** It loses the chart to a click away — the reader's report — but it stays under every frame as the failure exit. Superseded as the primary rendering, not removed: the [placeholder note](2026-10-18-reader-embed-placeholder-links.md) keeps the gate's rationale and the capture-impossibility argument, both of which still stand.

**`sandbox=""` (no allow-scripts).** The artifacts ARE their scripts — the chart is drawn at runtime. A fully silent sandbox renders a blank box for exactly the pages this fixes.

**Screenshotting each frame at capture time.** Real pixels, no live content — but it needs the capture package mounted, turns an interactive chart into a dead image, and costs a headless render per frame. The sandboxed frame is live, interactive, and free.

## Consequences

- Anthropic's republished self-replicating article now renders its 16 charts and its video inline (verified end-to-end from a localhost origin: the artifact frames, scripts running, read as the source page's own grid). YouTube-sized untitled embeds frame by their dimensions.
- The trust boundary moves: third-party scripts now execute, contained to an opaque origin by the sandbox attribute. A hostile feed the reader ADDED could frame a titled "embed" that mines nothing but its own runtime — no access to the pane, its storage, or its navigation. Trackers that load silently still drop at the gate.
- Bodies stored under the placeholder rule keep their links until 「重新抓取」; nothing about them breaks.
- Tests: `tests/extract-article.spec.ts` pins the frame shape (sandbox flags, lazy, no-referrer, aspect-ratio from wrapper and from dimensions), the native players (src or `<source>`, poster, `preload="none"`, autoplay stripped), the tracker drops, the figure-count exclusion, and the hostile-src refusal.
