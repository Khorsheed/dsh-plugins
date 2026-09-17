# @khorsheed/dsh-reader

The **inspiration space**: one **page-type tab** in the right sidebar that gathers RSS/Atom subscriptions and pasted article links onto a single wall. Clicking a card reads the body inside dsh (selectable, so it can be quoted); when the host's fetch cap truncated the body, the page says so in one line and offers a button to the original.

> The package name, tab kind and Remote namespace stay `reader` — they are stable identifiers (renaming them would change a deployed loader row and the on-disk state root). "Inspiration" is the name the reader SEES.

Fetching happens on the **host half** through the sanctioned `ctx.web` egress seam; the browser half only parses and renders. The subscription list and the most recent raw payloads are persisted to `$DSH_HOME/state/dsh-reader/state.json` with atomic `node:fs` writes — **not** through `ctx.fs`, which is the policy-fenced sandboxed filesystem (see Compatibility) — and a daily refresh is armed by a plugin-owned `setTimeout`, since no host scheduler service exists to ride.

## The three surfaces

| Surface | Contents |
| --- | --- |
| The wall | **Content first**: the entry cards own the first screen. The toolbar carries search / **filter** / sort; the filter is a **popover** that narrows the wall two ways — read state (unread) and by source (all, plus every source with its item count and a `!` where the payload could not be read whole). It is the same local predicate as the search box (D14), so filtering costs no round trip, and its value is visible in the search box (`#sourceId`), which is also how it is cleared. **A long source list does not sprawl**, because it is a vertical list rather than a row. Management lives behind the settings button. The entry cards: unread is a **dot** (7px) on the tile's corner — session-only, never persisted. The toolbar carries a search box, a **today/all segmented control** (default all), an unread-only toggle and three sort orders; all local predicates, no round trip. A freshness line sits at the bottom — "Refreshed 3 h ago · daily 10:00" — so a reader can tell whether the snapshot is worth re-fetching |
| Detail | Where a card leads. The body renders as DOM text — **that is exactly what makes passage quoting work**, and why this surface never hosts an iframe. Toolbar: back, copy link, open the original in the browser. Below the body, the other entries "also from this source" |
| Add (dialog) | The header's plus, the empty-state card and the dashed card at the end of the wall all open the same **dialog** (the members tab's invite-dialog idiom: transparent overlay plus centered card, Esc and overlay-click close), because adding is a momentary act and the wall should not be replaced by it. **What comes back decides how it is stored** (D15): a feed becomes a subscription, a web page is saved as a single item. When the fetch itself fails, the fetch seam's own words appear under the verdict instead of a bare "failed" |
| Subscriptions (page) | The header's filter icon opens the **subscription page**: one row per source (item count, last fetch, updating/paused, failure reason), per-source refresh, pause/resume, remove, and the **daily refresh time setting**. Those questions are about SOURCES rather than about content, so they do not live on the wall |

**Click semantics (settled as option B)**: a card click opens the detail view. Most reading happens in dsh; when the body is too long or the reader wants the original, the detail view's own button goes to the browser. The trailing chevron is a cue that the card leads somewhere, not a control.

## Quoting

The body is an app-level selection, so `@khorsheed/dsh-quote`'s overlay menu **already covers it** — this package builds no selection menu of its own. The detail view also carries:

- **Quote**: the selection (the whole entry when there is none) plus a source label, merged into the current conversation draft through the official input machine (the live draft is read and merged, never overwritten, never sent);
- **Sent to side chat**: shown only when the composition really has a `sideChat` service (the capability handshake decides), hidden otherwise.

`reader` ships its own thin typert Remote (namespace `reader`) with the verbs `capabilities` / `listSources` / `addSource` / `updateSource` / `removeSource` / `refresh` / `getBodies` / `quoteToSideChat`. The host half **never parses** a feed — parsing lives in the browser half, and `getBodies` only hands the raw payload across.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-reader
# uninstall:
dsh plugin --profile web remove @khorsheed/dsh-reader
```

Restart the host afterwards. Exactly one thing is written to disk: `$DSH_HOME/state/dsh-reader/state.json` (the subscription list plus the latest payloads). Uninstalling leaves that file behind — delete it for a clean removal.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ complete — the `sidebar.right.pane.tab` seat, the `ctx.web.fetch` egress seam, version-guarded `ctx.fs` writes; no `pluginInventory` needed (this package does no preset self-hide).
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)
- **Why state does not go through `ctx.fs`**: `ctx.fs` is this repo's **sandboxed** filesystem — every mutation is fenced by the FILE POLICY OF THE CALLING SESSION, so a workspace-write session is refused a write under `$DSH_HOME/state` (`FS_SANDBOX_DENIED`, observed on the acceptance instance). The fence is right and stays; the mistake was aiming a session-scoped capability at deployment-owned state. This package therefore writes with `node:fs` (atomic temp-file plus rename), the way this repo's other host-state packages do (`packages/lab/src/state.ts`), and degrades to memory-only when the root is unwritable.
- **Sources are named by the feed's own title**: the host half cannot parse a feed (it has no XML parser), so a new source starts with a URL-derived label — the `raw.githubusercontent.com/...` you see in the strip. Once the browser half has parsed `<channel><title>`, that real title replaces the display label, so cards read "Anthropic Research"; it falls back to the URL when parsing fails. The `{count} d ago` placeholder the list showed for an errored source was the other face of the same class of bug (an uninterpolated parameter) and is fixed.
- **The host hands over at most 100,000 characters per payload, so an oversized feed can only be read in part**: this is the egress seam's default (`web-fetch-http`'s `maxBodyChars`), NOT this package's body budget (256 KB per source, 2 MiB total). The acceptance instance's feed is 646,905 characters; the host supplies the first 100,000, so only the two entries falling inside that prefix are readable. The plugin **cannot** work around it: `ctx.web.fetch` accepts `{ url }` only — no Range, no custom headers, no pagination — and vendoring `fetch` to bypass it would bypass the host's egress policy, which is not an option. Reading such a feed whole requires a deployment-side config override on that row (`web-fetch-http` `config: { maxBodyChars: 2000000 }`), which is a **host composition change** rather than something a plugin's patch may do (a plugin patch mounts its own row only).
- **A feed the host truncates is salvaged, not discarded**: the egress seam caps a payload by CHARACTER COUNT, and a cap that lands inside a tag makes the whole document malformed — which used to mean **no entries at all**. The parser now keeps every complete `<item>`/`<entry>` (re-wrapping each fragment with the document root's namespace declarations, without which a fragment carrying `content:encoded` is itself malformed), repairs the cut-off block best-effort and flags it **partial** so its arrived text still renders, and the wall shows an "incomplete" line with the original-page link. The shape is pinned by a committed fixture (`tests/fixtures/feed-truncated.xml`).
  Measured: the acceptance instance's 646 KB feed (of which the host hands over 100,000 characters) now yields **2 cards** — one complete 42 KB body and one partial — where before this fix it yielded **0**.
- **The default filter is "all", not "today"**: a feed's newest entry is often not from today (the acceptance instance's feed was 8 days old), and a default `today` filter made a freshly subscribed wall look empty — which reads as "the subscribe did not work". The segmented control makes the today view one visible click away.
- **The host fetch cap is a known limit**: `ctx.web.fetch` truncates a decoded body at 100,000 characters and does so **silently**. Articles past that cannot be fully extracted (measured: an Anthropic research page ~266k, theverge.com ~899k, newyorker.com ~1.97M characters); a summary page's title, author and description still arrive. The detail view therefore shows 「受限篇幅，内容未完整呈现」 with a 「阅读原文」 button. RSS feeds are mostly safe (measured: HN 11KB, BBC 25KB, 阮一峰 69KB, Simon Willison 83KB — 83KB already sits against the cap).
- **Degrade matrix**: no `fs` → state is memory-only and lost on restart (the handshake reports `hasFs: false` rather than pretending persistence exists); no `web` → `addSource` answers `unsupported-content`/`fetch-failed` instead of throwing; no `sideChat` → the side-chat action is hidden; no `quote` → the selection overlay is simply absent, while the entry-level Quote button keeps working.
- **Cross-origin redirects are not followed for you**: the host seam refuses them (`WEB_REDIRECT_BLOCKED`), so this service follows up to 3 hops itself, re-entering the seam each time — which keeps ordinary shorteners and domain moves subscribable.
- **No conditional requests**: the host seam exposes no custom-request-header entry point, so there is no ETag/If-None-Match and every refresh is a full fetch.
- **Nothing behind a login wall**: there is no credential-injection surface.

## Known Limitations

- **Subscribe, do not crawl**: adding a subscription fetches the feed itself and never pre-fetches every entry's body (that would blow up storage and amount to running a crawler). Opening one entry pays for one fetch.
- **Read state and bodies are not persisted**: they are session state. Persisting a per-entry read cursor would need a second, write-heavy document, and "what is new since I last looked" is the whole value of this plugin.
- **XML parsing lives in the browser**: the host has no XML/DOM parser (`globalThis.DOMParser === false`), so feed parsing has to happen client-side.
- **No browser-pane dependency**: `proposals/active/2026-09-13-browser-pane.md` is still `planned`, and canvas CDP frames cannot host selection quoting.
