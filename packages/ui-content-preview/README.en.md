# @khorsheed/dsh-client-ui-content-preview

English | [中文](README.md)

The shared content kernel behind the community file surfaces: the file list (`@khorsheed/dsh-local-files`) and the worktree tab (`@khorsheed/dsh-worktrees`) render their right-hand preview through **one implementation**, so a fix in one place lands in both.

This is not a plugin. It registers no slot, service or locale, owns no loader row and ships no client bundle of its own — it is consumed at the **source plane**: the two plugins declare it as a workspace dependency and import `@khorsheed/dsh-client-ui-content-preview/src/client/…` directly, so each plugin's tsdown client bundle inlines it into its own `lib/client.js`. Zero runtime coupling, and both plugins stay independently installable and uninstallable.

## What it provides

| Capability | Notes |
|---|---|
| Content dispatch (kind union) | `text` (with `truncated` / `htmlScripted`) / `image` / `binary` / `missing` / `too-large` / `error`; the kernel owns the contract and each plugin adapts its own Remote payload into it |
| Tiered HTML sandbox | Tier0 `sandbox=""` plus an embedded meta CSP (default); Tier1 `sandbox="allow-scripts"` that **never** combines with `allow-same-origin`, behind an explicit confirmation; includes `content-visibility` deferral for large documents, a "scripts did not run" hint, and the capability bridge (`openLink`/`copy`/`download` allowlist plus `message.source` validation) |
| Content search | Keeps the rendered body and paints hits through the CSS Custom Highlight API; degrades honestly to the raw matched-lines view when a query exists only in source syntax (`**`, a fence, a collapsed JSON node), and on engines without the API — never a blank pane |
| Markdown / JSON / CSV | Through the official `MarkdownText` / `JsonTree`; **only the `--dsw-font-markdown-*` scale tokens are overridden, never per-element margins/padding**, so the rhythm matches the official document sheet |
| Pane chrome | Copy path / open folder / open in IDE (each shown only when the host open-in-app probe resolved that kind of app), scroll memory per (session, path), format banner |

Deliberately **not** here: the file tree, the data face (Remote / store / root selection), diffs and commit comparison (the caller passes them in as a render prop), tab registration and visibility — those are each plugin's own data face and identity.

## Usage

```ts
import { buildSrcDoc, attachBridge, structuredPreview, useRenderedSearch } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
```

Localized copy belongs to the caller: the kernel holds no locale namespace and receives `StructuredLabels` / `PreviewLabels` objects built from the consumer's own dictionary.

## Install

**Do not install it as a plugin.** It works at build time, alongside the plugins that depend on it:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-files
dsh plugin --profile web add @khorsheed/dsh-worktrees
```

Removing either plugin leaves the other intact — the kernel is inlined into each client bundle.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the peer face is exactly what the consumers already carry (`ui-primitives` for `MarkdownText`/`JsonTree`/`CodeBlock`/icons and `ui-slots` for the label types), so minHost tracks the two consuming plugins' right-sidebar line (`0.1.5-rc.1`).
- Source line (deepseek-harness master): ✅ (verifiedHost: `0.1.5-rc.1`)

## Known limitations

- **Relative resources are not resolved**: both tiers render inside a `srcdoc` sandbox, where `base-uri 'none'` stops relative `<link>`/`<script>`/images from loading. That is the 2026-08-21 ruling (`proposals/active/2026-08-21-file-view-html-rendering.md`). The official document tab's HTML renderer can pack relative dependencies through the Remote; that is its capability and it is not back-filled here.
- **Not the endgame for rendering**: the official `dsh-client-ui-sidebar-documentpreview` already owns a `ctx.documentPreviews` registry plus markdown/code/html/image/pdf renderers, but exports no reusable component, and `sidebar.right.tab.document` is a keyed slot that is render-exclusive to its own entries — a plugin-owned pane cannot mount it. The moment the host exposes a reusable rendered surface, this package degenerates to an adapter and is deleted; see `proposals/active/2026-09-23-preview-kernel.md` §退休路径.
- **Styles travel with the consumer bundle**: the kernel's CSS ships as CSS Modules inlined into the consumer's `<style data-plugin>` tag, so a style change only needs the consumer rebuilt — no separate kernel release.
