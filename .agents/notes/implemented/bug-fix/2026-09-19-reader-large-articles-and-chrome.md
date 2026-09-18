# Agent Note: very large articles, and the page furniture that came with them

Status: implemented

## Problem

Three reports about one family of research pages (`transformer-circuits.pub`), each with a different cause.

**A 41.8 MB article could not be fetched at all.** `https://transformer-circuits.pub/2026/emotions/index.html` answered the fetch with `response exceeds the maximum of 5000000 bytes`. The egress seam has TWO caps: `maxResponseBytes` (5,000,000 by default, the byte ceiling that failed) and `maxBodyChars` (100,000 by default). The acceptance instance's patch overlay had raised only the second one — so the deployment was configured to read 2,000,000 characters of a response it would refuse to download past 5 MB. Measured: that page is 41,842,174 bytes, and 60 of its figure images are inlined `data:image` base64, which is where the size comes from.

**The body opened with repeated furniture.** The extracted body began with an empty logo link, the site name, the article title **twice** (the page carries two `<h1>`s), four `<br>`s, and only then the byline — while the detail view already renders the entry title above the body. Reported as "why does it fetch repeated content at the start".

**Script-drawn figures.** Covered by the previous batch's note (they cannot be fetched without executing the page's scripts); this batch is what the investigation established about the *same publisher's other page*: the emotions paper's figures are inline base64, so they are fetchable, while the workspace paper's 84 figures are drawn at runtime and are not.

## Decision

- **Raise both seam caps in the deployment's patch overlay.** `$DSH_HOME/profiles/web/cordis.patch.yml` sets `maxBodyChars: 64000000` **and** `maxResponseBytes: 64000000` on the `web-fetch-http` row. The original overlay's own comment already recorded that it raises the ceiling for every web fetch on the machine; the byte cap joins it, and the comment now says so. Page size is a property of the publishing site, and a reader who pastes such a link is asking for it.
- **A body past 4 MiB is served but not cached.** `MAX_CACHED_BODY_CHARS` bounds what an entry's extracted body may add to `state.json`; above it, `storeEntryBody` returns the view with `tooLarge: true` and commits nothing, and the detail view says 「这一篇太大，没有缓存 —— 下次打开这一条会重新抓取」. Rationale in the constant's own comment: the state document is one JSON file read and rewritten whole, so a handful of inline-base64 papers would turn every reader operation into a multi-megabyte round trip.
- **Extraction drops the page's own title block.** `trimLeadingChrome` removes top-level `h1`/`h2` headings whose text repeats the document title (or the body's own first heading), then walks the leading nodes dropping the masthead — textless nodes, `<br>`s, short link-only nodes — and stops at the first stop tag (`p`, a heading, `table`, `blockquote`, `pre`, `ul`/`ol`), the first picture, or the first node with 40+ characters of prose. The title block on the measured page is `<d-title>`, a custom element with no tag in the whitelist, so the normalizer UNWRAPS it and its `<br>`s land at the front of the body; the final normalized string therefore also has its leading whitespace/`<br>`s stripped.

## Alternatives considered

**Raise only `maxBodyChars` (the cap the README documented).** Rejected: it is the wrong knob for this failure, and the error message named the byte cap. Leaving it would have kept a deployment configured to truncate a document it refuses to download.

**Stream the response and extract incrementally instead of raising the cap.** Rejected for this package: the seam hands back a decoded body or nothing; there is no streaming surface, and the extraction is DOM-based, which needs the whole document. (A future browser-pane renderer is the real answer to both size and scripts — and remains out of scope here.)

**Cache the large body anyway and rely on the existing eviction.** Rejected: `boundAnnotations` bounds cached bodies by COUNT (500), not by size, so one 40 MB article would sit in the document until 500 newer bodies pushed it out — every mutation rewriting it in the meantime.

**Truncate the body to the budget and cache the head.** Rejected: cutting normalized HTML mid-element produces markup React must repair by guesswork, and a body that silently stops is the failure mode this package keeps removing. Serving it whole for the session and saying it was not kept is truthful.

**Drop the title by matching the first heading only.** Rejected: the measured page has the site name and an empty logo link before the title, and two title `<h1>`s; a rule that only handles the first heading leaves both.

**Drop every `<br>` in the body.** Rejected: a `<br>` inside prose can be meaningful (addresses, verse). Only the leading run is stripped.

## Consequences

- The acceptance instance can now fetch and read articles in the tens of megabytes. Every web fetch on the machine inherits the higher ceilings: peak memory and transfer per fetch rise accordingly, and a hostile or simply enormous page can spend more of both before any policy stops it.
- A 41 MB page still crosses the RPC boundary to the browser and is parsed there (jsdom-equivalent DOM work in the pane's process). That is the cost of "show me this article"; the alternative was refusing it outright.
- The cache guard makes reopening a very large article re-fetch it every time. The note in the detail view says exactly that, so the reader is not surprised by the delay; the trade is deliberate (documents stay small).
- Bodies no longer repeat the entry title, and no longer start with a masthead. A page whose author intends a section heading identical to the document title would lose that heading from the body — accepted, and the heading is still visible in the page title and the pane header.
- The extraction is smaller by the dropped captions of script-drawn figures and by the title/masthead: the measured paper went from 321,868 to 286,162 characters of body.
- `ReaderEntryBodyView.tooLarge` is a new wire field; both halves ship together, and an older client ignores it (it renders the body it was handed).

## Testing

`packages/dsh-reader` runs 217 tests (5 new):

- `extract-article.spec.ts`: a page with two title `<h1>`s, a masthead and leading `<br>`s extracts to a body that starts at `<h3>Authors</h3>` with no `<h1>` and no site name; a leading `<figure><img>` is kept (a picture is content).
- `boot.spec.ts`: `storeEntryBody` above the budget returns `tooLarge: true`, hands the html back, and commits nothing (`getEntryBody` afterwards reports no cache); a body under the budget still caches and is served.
- `ReaderPane.client.spec.tsx`: a fetch result carrying `tooLarge` renders the "not cached" note.
