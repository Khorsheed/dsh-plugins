# Agent Note: the reader rewrite — discard the legacy RSS package, settle click semantics, ship in host + client halves

Status: implemented

## Problem

`@khorsheed/dsh-rss-reader@0.1.0` shipped but its right-sidebar tab opened with no content. The cause was structural, not a rendering bug: `src/client/RssView.tsx` returned `null` on every path, so the tab type registered and the pane seat opened onto nothing. The same package probed a `ctx.get('fetch')` service that does not exist in the host, carried a fabricated filesystem mirror, returned the literal string `'Not implemented in this build stage'` from two of its verbs, swallowed failures in four silent `catch {}` blocks, and tested only three string helpers — no test touched the pane, the service, or the boot path, which is why the defect reached production.

A reader is a long-lived surface: subscriptions accumulate, payloads grow, and the tab is opened daily. Keeping a shell whose every seam was guessed would mean re-deriving the fetch, persistence, parsing and refresh stories under a user's data. The decision was to discard the package body and rebuild the capability, keeping only the package name and mount point as the user-facing identity.

## Decision

The capability now ships as **`@khorsheed/dsh-reader`** (v0.1.0), one package with a host half and a browser half, and the scope widened from RSS-only to "a feed reader plus a place to keep article links".

**Host half** (`src/index.ts`, `service.ts`, `store.ts`, `schedule.ts`, `remote.ts`, `invariant.ts`): `apply(ctx, config)` constructs a `ReaderService`, `ctx.provide('reader', …)`s it, and mounts the thin `ReaderRemoteService` (namespace `reader`, verbs `capabilities` / `listSources` / `addSource` / `updateSource` / `removeSource` / `refresh` / `getBodies` / `quoteToSideChat`).

- **Egress goes through `ctx.web.fetch`**, the sanctioned seam (there is no service keyed `fetch` to probe instead). The seam caps a decoded body at 100,000 characters and truncates **silently**; it refuses cross-origin redirects (`WEB_REDIRECT_BLOCKED`), so the service follows up to 3 hops itself, re-entering the seam on each one.
- **Persistence is plain `node:fs`, deliberately not `ctx.fs`** (corrected during acceptance). `ctx.fs` is the SANDBOXED filesystem: every mutation is fenced by the calling session's file policy, so a workspace-write session is refused a write under `$DSH_HOME/state` with `FS_SANDBOX_DENIED` — which is what made a subscription fail on the acceptance instance. The fence is correct; the mistake was aiming a session-scoped capability at deployment-owned state, so the store writes atomically (temp file plus rename) the way this repo's other host-state packages do (`packages/lab/src/state.ts`). State lives in `$DSH_HOME/state/dsh-reader/state.json` (override via `config.stateRoot`), a missing file reads as empty, a corrupt one is refused rather than clobbered, and an unwritable root degrades to memory-only with `capabilities().hasFs === false`.
- **Refresh is a plugin-owned `setTimeout`** (`schedule.ts` does the local-calendar arithmetic). The host has no scheduler service and no `ctx.on('dispose')`; `ctx.effect` owns the teardown. A missed window is caught up once on boot rather than dropped.
- **Payload bounding is newest-first**: `boundPayloads` walks sources newest-first and drops the oldest bodies past the per-source (256 KiB) and total (2 MiB) budgets, keeping every source row. The first implementation walked oldest-first, which kept a month-old body and evicted the one just fetched — the opposite of the design.

**Browser half** (`src/client/`): a page-type sidebar tab (minted kind `reader`, tab id `@khorsheed/dsh-reader`) registered in the two sanctioned stages — `ctx.sidebarRightTabs.register(definition)` for the type and `ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({name, key, locale, store, inject}, ReaderPane))` for the body — both on `ctx.effect`.

- **Parsing runs in the browser because the host has no parser**: `globalThis.DOMParser === false` there, so `parse-rss.ts` (RSS 2.0 / Atom by `localName`, a real `parsererror` rejection, CDATA and entity decoding) and `extract-article.ts` (readability-style block scoring with language-aware minimum sizes — 40 chars for Latin, 18 for CJK — and a whitelist normalizer) live client-side.
- **A truncated payload is salvaged, not discarded** — the package's worst defect, found on the acceptance instance and fixed there. The egress seam caps a body by character count, and a cap inside a tag makes the whole document malformed XML, which the parser reported as "nothing to show": a 646 KB feed arriving as 100,000 characters yielded **0 entries**. Salvage now (a) re-parses every complete `<item>`/`<entry>` fragment wrapped with the DOCUMENT ROOT's namespace declarations — without them a fragment carrying `content:encoded` is itself malformed, which is how a complete 42 KB item was still being lost — (b) repairs the cut-off block best-effort, and (c) when repair still cannot produce XML, reads the fragment's own title/link/date/description straight out of its markup. The cut-off entry is flagged `partial`, its arrived text renders, and the wall states the cause with the original-page link. Same payload today: **2 cards**.
- **The wall is content-first and the sources are a filter** (course-corrected after review): the entry cards own the first screen; the sources are one scrolling strip of chips above them, each a local query (`#<sourceId>`) the search box also shows and clears. An earlier revision put a source-card grid first, which answered the rarest question (management) with the most valuable space.
- **The surface is 「灵感空间」 to the reader** (the package, tab kind and Remote namespace stay `reader` — stable identifiers; only the copy moved). The wall carries a source-card grid in the members tab's idiom, ending in a dashed add card; the empty state is that same dashed card, alone.
- **Adding is a dialog, not a page**: the members tab's invite-dialog pattern (transparent overlay plus centered card, Esc and overlay-click close), reachable from the header, the empty-state card and the wall's trailing add card. A momentary act should not replace the wall it was invoked from.
- **A subscription management page owns everything about sources**: per-source item count, last fetch, pause/resume, remove, a single-source refresh, and the daily refresh time. "Why am I seeing nothing" and "stop refreshing this one" are source questions, so they left the wall.
- **The default filter is `all`, and the filter is visible**: a feed's newest entry is frequently not from today (measured: the acceptance instance's feed was 8 days old), so a default `today` filter rendered a successful subscribe as an empty wall. The all/today segmented control makes the hidden state explicit, and the refresh button turns while the round trip is in flight and re-reads the wall when it lands — the previous implementation replaced the host's payloads and never re-read them, so the button looked dead.
- **The list states how old its snapshot is**: a freshness line under the cards (「刷出于 3 小时前 · 每日 10:00」) built from `capabilities().lastRefreshAt` / `nextRefreshAt`, so a reader can decide whether pressing refresh is worth a network round trip — a refresh really does re-fetch every enabled source.
- **The pane renders content or says why it cannot**: the list is one card per entry with a 7px unread **dot** on the source tile's corner (session-only, never persisted, floating so read/unread never moves a title), the toolbar's search / unread-only / sort are local predicates (D14), the detail view renders the normalized body as DOM text — which is what makes `@khorsheed/dsh-quote`'s existing frame-wide selection menu cover it, so this package builds no selection menu of its own — and a truncated body ends with one line, 「受限篇幅，内容未完整呈现」, plus a 「阅读原文」 button.
- **Nothing self-hides by preset**: the install layer is this tab's mode visibility, so no `pluginInventory` probe is involved.
- **What a pasted URL is, is decided by what comes back** (D15): a feed becomes a subscription, a web page is saved as one item, and neither is guessed from the URL's shape.

**Click semantics are option B**: a card click opens the detail view; the browser is an action inside the detail (toolbar button, plus the incomplete-body button). The trailing chevron is a cue, not a control. This was settled with the user rather than inferred.

**Degradation is per gesture, never per boot**: no `web` → `unsupported-content` / `fetch-failed`; no `sideChat` → the side-chat action hides; no `quote` → the selection overlay is simply absent while the entry-level Quote button works; `addSource` answers a domain refusal and never throws.

## Testing

95 tests across six suites, and the three that exist specifically for the accidents this package has already had:

- `tests/boot.spec.ts` boots the host half on a **real Cordis `Context`** and asserts that `ctx.get('reader')` exists, that the Remote face is mounted under its own service key and actually delegates, and that a composition with no `fs`/`web`/`sideChat`/`quote` still boots. The legacy shell provided no service at all; this is the assertion that would have failed on it.
- `tests/boot.spec.ts` also carries the **session-fenced-filesystem regression**: it mounts a `ctx.fs` whose every method throws `FS_SANDBOX_DENIED`, then asserts the plugin still answers a domain value (and never touched that service), and that a source added on one host is visible to a second host over the same state root. The acceptance instance is where that bug shipped; this is where it stays fixed.
- `tests/ReaderPane.client.spec.tsx` renders the pane in jsdom over a real store instance and scripted host payloads, asserting that content reaches the DOM on every path — the empty state, a card, an opened body — rather than that a function returned something.
- `host-pure.spec.ts` covers the refresh clock, payload classifier, URL policy, state normalizer and bounding; `parse-rss.spec.ts` and `extract-article.spec.ts` run against real captured pages; `selectors.spec.ts` pins the filter/query/sort predicates.

The render suite earned its place immediately by finding two real defects in the implementation it was written for: the default `today` filter dropped every saved article link (a link entry has no `publishedAt`, and `isToday(undefined)` was `false`, so the primary add-a-link flow produced an invisible link), and the fetch cap's `truncated` flag was dropped between the wire envelope and the parsed entry, so the incomplete-body note could never render for the case it was written for. Both are fixed and pinned.

## Alternatives considered

**Keep and patch the legacy package.** Rejected: the tab rendered nothing because the component returned `null`, and behind it the fetch seam, the filesystem mirror and the refresh story were all invented. There was no working path to patch — every seam had to be re-derived, so the body was discarded while the package name and mount point (the user-visible identity) were kept. The published `@khorsheed/dsh-rss-reader@0.1.0` is deprecated rather than reused.

**Render the article in a sandboxed iframe or the browser pane.** Rejected: an iframe cannot be the quote source (quotable text needs to be app-level DOM), and `proposals/active/2026-09-13-browser-pane.md` is still `planned` while canvas CDP frames cannot host selection quoting either. Rendering normalized markup is what buys both readability and quoting.

**Vendor `globalThis.fetch` for articles the host seam truncates.** Rejected: it bypasses the host's egress policy, which is exactly what the seam exists to enforce. The cap is documented as a known limit and surfaced in the UI instead.

**Pre-fetch every entry's body when a subscription refreshes.** Rejected: storage blow-up plus acting as a crawler. Bodies are fetched when an entry is opened.

**A host-side scheduler or a conditional-GET story.** Not available today: there is no scheduler service and the seam exposes no custom request headers, so the plugin owns a `setTimeout` and every refresh is a full fetch.

**Persist the read cursor and article bodies.** Rejected for now: it would need a second, write-heavy document for a feature whose value is "what is new since I last looked". Read state and bodies are session state.

## Consequences

- The rewritten package is independently installable and uninstallable; only one file survives an uninstall (`$DSH_HOME/state/dsh-reader/state.json`), which the README tells the reader to delete for a clean removal.
- `dsh.compat.minHost` is pinned to `0.1.5-rc.1`, where the sidebar seat, `ctx.web.fetch` and `ctx.fs` are all present, and the 100,000-character silent truncation is recorded as a known limit in `dsh.compat.notes` and in both READMEs.
- The article half is genuinely weaker than the feed half for large pages (measured: an Anthropic research page ~266k characters, theverge.com ~899k, newyorker.com ~1.97M, against the 100k cap; RSS feeds measured 11 KB–83 KB), so the incomplete-body note and the original-page button are load-bearing UI, not polish.
- Selecting text in the body is quoted by the QUOTE plugin's own overlay; this package only contributes the entry-level Quote / side-chat buttons, which keeps the packages independent.
- The render-test suite is the durable answer to the legacy accident: it fails when the pane stops putting content in the DOM, which is the one failure mode a helper unit test structurally cannot see.
