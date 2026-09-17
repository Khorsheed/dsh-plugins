# @khorsheed/dsh-reader

A reader: one **page-type tab** in the right sidebar that gathers RSS/Atom subscriptions and pasted article links into a single card feed. Clicking a card reads the body inside dsh (selectable, so it can be quoted); when the host's fetch cap truncated the body, the page says so in one line and offers a button to the original.

Fetching happens on the **host half** through the sanctioned `ctx.web` egress seam; the browser half only parses and renders. The subscription list and the most recent raw payloads are persisted to `$DSH_HOME/state/dsh-reader/state.json` with atomic `node:fs` writes — **not** through `ctx.fs`, which is the policy-fenced sandboxed filesystem (see Compatibility) — and a daily refresh is armed by a plugin-owned `setTimeout`, since no host scheduler service exists to ride.

## The three surfaces

| Surface | Contents |
| --- | --- |
| List | One card per entry: source tile, title, summary, tags/author. Unread is a **dot** (7px) on the tile's corner — session-only, never persisted. The toolbar carries a search box, an unread-only toggle and three sort orders (newest/oldest/by source); all three are local predicates and cost no round trip. A freshness line sits under the list — "Refreshed 3 h ago · daily 10:00" — so a reader can tell whether the snapshot is worth re-fetching |
| Detail | Where a card leads. The body renders as DOM text — **that is exactly what makes passage quoting work**, and why this surface never hosts an iframe. Toolbar: back, copy link, open the original in the browser. Below the body, the other entries "also from this source" |
| Add | Paste a feed address or any article link. **What comes back decides how it is stored** (D15): a feed becomes a subscription, a web page is saved as a single item — which is what stops a random web page from becoming a subscription that is forever empty. When the fetch itself fails, the fetch seam's own words appear under the verdict instead of a bare "failed"; the back arrow returns to the list |

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
