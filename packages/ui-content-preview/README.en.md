# @khorsheed/dsh-client-ui-content-preview

English | [中文](README.md)

Three file-preview surfaces, one "show me this file" implementation — fix it once, fixed everywhere.

The file list, the worktree tab, and the session-products page all need the same pane: markdown rendering, a JSON tree, CSV tables, an HTML sandbox, content search, copy-path / open-folder / open-in-IDE. This package extracts that whole content pane into a shared kernel: `@khorsheed/dsh-local-files`, `@khorsheed/dsh-worktrees` and `@khorsheed/dsh-client-ui-file-preview` all render their preview areas through one implementation, so a bug gets fixed exactly once.

**This is not a plugin.** It registers no slot, service or locale, owns no loader row and ships no client bundle of its own — it is consumed at the **source plane**: each plugin declares it as a dependency and imports `@khorsheed/dsh-client-ui-content-preview/src/client/…` directly, so each plugin's tsdown client bundle inlines it into its own `lib/client.js`. Zero runtime coupling, every plugin stays independently installable and uninstallable, and installing this package into a profile mounts nothing.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/content-preview-1.png" width="640" alt="the shared content pane: search hits painted over rendered markdown, with reload, copy path, open folder and open in IDE in the title bar">

## Features

- **Content dispatch on a kind union** — one read normalizes into `PreviewRead`: `text` (with `truncated` / `htmlScripted` markers) / `image` / `binary` / `missing` (with a reason) / `too-large` / `error`; the kernel owns the contract and each plugin adapts its own Remote payload into it.
- **Structured previews** — JSON renders through the official `JsonTree` (collapsible, keyboard-accessible; past 150k source chars it honestly falls back to the code view); CSV/TSV render as GFM tables through the official `MarkdownText` (past 500 rows or 40 columns, fallback); markdown goes through the official `MarkdownText`, and **only the `--dsw-font-markdown-*` scale tokens are overridden, never per-element margins/padding**, so the rhythm matches the official document sheet; every other text is highlighted by the official `CodeBlock` with a prism language picked by extension.
- **Tiered HTML sandbox** — a source / render / script three-way: Tier0 `sandbox=""` plus an embedded meta CSP (the default; a scripted page shows a "scripts did not run" hint bar in the static tier); Tier1 `sandbox="allow-scripts"` that **never** combines with `allow-same-origin`, run only after an explicit confirmation; the CSP pins network and navigation shut, large documents defer via `content-visibility`, oversized or scripted documents get a stall-watchdog hint, and the render can go fullscreen.
- **Capability bridge** — the only way out for a Tier1 script: the `window.dshBridge` allowlist of `openLink` (https only, noopener) / `copy` (1 MB cap) / `download` (data: URLs only); the parent validates every message's source, function name and argument shape, and a throwing handler becomes an error reply — never an exception in the host.
- **Rendered-content search** — hits are painted over the rendered document through the CSS Custom Highlight API: the rendered form stays, React's DOM is untouched; a query that exists only in source syntax (`**`, a fence, a collapsed JSON node) honestly degrades back to the raw matched-lines view, and so does an engine without the API — never a blank pane. Counting is uncapped (painting caps at 2000), and chrome text like button labels and banners never counts as a hit.
- **Pane chrome** — back control, basename with a language chip, reload-current-file (rendered only when the caller injects `onReload`, ahead of copy-path; disabled with a spinning icon while in flight), copy path, open folder, open in IDE (each shown only when the host open-in-app probe resolved that kind of app; multiple IDEs render as a split button); scroll memory per (session, path); a format banner on every structured render; the diff/content toggle plugs in as a caller-owned render prop.

Deliberately **not** here: the file tree, the data face (Remote / store / root selection), the diff and commit-comparison implementation (the caller passes it in as a render prop), tab registration and visibility — those are each plugin's own data face and identity.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/content-preview-2.png" width="640" alt="the tiered HTML sandbox: the source / render / script three-way toggle and the scripts-did-not-run hint bar over a statically rendered page">

## Usage

```ts
import { ContentPane, buildSrcDoc, attachBridge, structuredPreview, useRenderedSearch } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
```

Localized copy belongs to the caller: the kernel holds no locale namespace — every string arrives through a `PreviewTranslator` and `StructuredLabels` built from the consumer's own dictionary. The `PREVIEW_KEYS` constant materializes the full key set, and a package-level test in each consumer asserts every key resolves in its dictionary — a missing key is a test failure, not an English string in a Chinese UI.

## Install

**Do not install it as a plugin.** It has no row to mount, so `dsh plugin add` on it would do nothing. It arrives at build time with the plugins that consume it — install any (or all) of these surfaces and the kernel comes inlined into their client bundles:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-files              # workspace file browser
dsh plugin --profile web add @khorsheed/dsh-worktrees                # worktrees right tab
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview   # session products page
```

Restart the web instance to activate. Removing any one plugin leaves the others intact — the kernel is inlined into each bundle:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-files
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the official-host surface is exactly the peer set the consumers already carry: ui-primitives (`MarkdownText` / `JsonTree` / `CodeBlock` / icons) and ui-slots (the label types), so minHost tracks the consuming plugins' 0.1.5-rc.1 right-sidebar line.
- Source line (deepseek-harness master): ✅ (verifiedHost: `0.1.5-rc.1`) — as a source-plane library it registers no slot / service / locale / row and owns no client bundle, so its compatibility surface is exactly the type exports of the handful of official packages it consumes.

## Known Limitations

- **Relative resources are not resolved** — both tiers render inside a `srcdoc` sandbox, where `base-uri 'none'` stops relative `<link>` / `<script>` / images from loading (the standing 2026-08-21 ruling, see `proposals/active/2026-08-21-file-view-html-rendering.md`). The official document tab's HTML renderer can pack relative dependencies through the Remote; that is its capability and it is not back-filled here.
- **The HTML preview body stays out of rendered search** — the render iframe is an opaque origin whose text is not in this DOM, so searching an HTML file uses the raw matched-lines view.
- **Not the endgame for reusable rendering** — the official `dsh-client-ui-sidebar-documentpreview` already owns a `ctx.documentPreviews` registry plus markdown/code/html/image/pdf renderers, but exports no reusable component, and `sidebar.right.tab.document` is a keyed slot render-exclusive to its own entries, so a plugin-owned pane cannot mount it. The moment the host exposes a reusable rendered surface (or a render-authorized slot for third-party panes), this package degenerates to an adapter and is deleted — see `proposals/active/2026-09-23-preview-kernel.md` §退休路径.
- **Styles travel with the consumer bundle** — the kernel's CSS ships as CSS Modules inlined into the consumer's `<style data-plugin>` tag, so a style change only needs the consumer rebuilt — no separate kernel release.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Architecture.** A source-plane library: no loader row, no client bundle of its own. The consumers (local-files / worktrees / ui-file-preview) declare it as a dependency and import `@khorsheed/dsh-client-ui-content-preview/src/client/*` directly, so tsdown inlines the kernel into each plugin's own `lib/client.js` — zero runtime coupling, and installing or removing one surface never touches the others. The package root entry (`src/index.ts`) exists only for type-checking and tooling resolution; no host process ever runs it. The kernel never imports a consumer's wire types: each surface maps its own read result into the `PreviewRead` union (local-files collapses its kind union directly, worktrees maps its `ReadFileResult` / `LocalImageResult`, and a deleted or unreadable file is reported through `missing.reason`).

**The contract surface.** `ContentPane`'s props are the whole interaction: the `read` / `loading` / `error` data face is fed by the caller's Remote; the chrome gestures (`openFolder` / `openIDE` / `ideChoices`) and `onCopyPath` / `onReload` / `onBack` are each optional — omit one and its button does not render; `diffView` + `view` + `onViewChange` let the caller plug in a diff/content toggle; `imageView` replaces the image body (worktrees' zoom viewer); `notice` lets a caller slot its own banner (worktrees' untracked-file note); `sessionId` namespaces the scroll memory. A surface whose read is pinned at a commit — one that cannot go stale — simply omits `onReload`, and no reload button exists.

**The HTML sandbox.** `buildSrcDoc` guarantees the CSP lands inside the document: the parent web shell has no CSP of its own and a srcdoc iframe is not an HTTP response, so inheritance cannot be relied on — a fragment is wrapped into a full document, and a full document gets the injection right after its own `<head>` (no duplicate when it already declares one). Tier0's empty sandbox makes the CSP pure defense in depth; Tier1 allows scripts while the CSP pins network and navigation shut (`default-src 'none'`, `connect-src 'none'`, scripts only inline plus cdn.jsdelivr.net, images only data:/blob:, workers only blob:), and `allow-same-origin` never combines — the opaque origin is what keeps the frame's scripts from touching the host. The capability bridge is Tier1's only exit: the document gets a `window.dshBridge` postMessage client, and the parent-side `attachBridge` validates that `message.source` is the controlled iframe's window, that `fn` is on the allowlist, and that the args match each function's shape; a throwing handler is converted into an error reply, never an exception in the host.

**Search.** The first search implementation swapped the rendered body for a raw matched-lines `<pre>` the moment a query hit — markdown's `**` / table pipes and the JSON tree all collapsed back to text. Now hits are painted over the rendered body: the CSS Custom Highlight API registers `Range`s and the browser draws them through `::highlight()`, React's DOM is never touched, and the MutationObserver can never observe its own paint (no infinite rescan). Chrome text — button labels, banners — is excluded from the scan via a tag blocklist and the `data-dsh-search-skip` attribute. When a query matches only source syntax or a collapsed JSON node, no visible Range exists at all — the pane honestly returns to the raw-line view, where the hit is visible by construction. Jumping scrolls only the pane's own scrollport (a `Range` has no scrollIntoView, and the element-level API would drag the whole shell along).

**open-in-app.** The route constants and wire payloads mirror the official shared module verbatim (the client-bundle purity gate forbids a value import of a host package; a mirrored constant degrades to "gestures hidden" rather than a boot failure if the host routes ever move). Once per page, a GET to `/open-in-app/apps` publishes into a snapshot store; a 404 or a network failure reads as an empty list and the gestures stay silently hidden — the same degrade the official header split button renders. Launching an app POSTs `/open-in-app/open`.

**Exports.** The package root (`src/index.ts`) re-exports the client barrel for type resolution only; consumers go through the `./src/*` subpath (`@khorsheed/dsh-client-ui-content-preview/src/client/index.ts`). Tests are split per module: html-src-doc / html-bridge / structured / rendered-search / open-in-app / content-pane.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/ui-content-preview`). Issues and contributions welcome there.
