# @khorsheed/dsh-client-ui-file-preview

English | [中文](README.md)

Preview your session's files right in the dsh web GUI — no IDE needed. A 产物/Produced tab lists everything the session wrote or edited, and selecting one shows its current content and full change history in the page.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview1.png" width="480" alt="previewing a markdown file rendered as a document">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview2.png" width="480" alt="per-artifact change history: pageable per-turn diffs">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview3.png" width="480" alt="the Produced tab: every file the session wrote, at a glance">

## Features

- **Produced tab** — every file the session wrote or edited, latest activity first, with an all-files toggle.
- **Document-form previews** — markdown rendered, JSON/CSV as inspector/table, HTML with a source ⇄ sandboxed-render toggle, images inline.
- **Change history** — step through every recorded write/edit diff with its turn and step.
- **Turn mutation card** — each finished turn ends with a collapsible "N files changed" card with per-file line deltas.
- **In-place drawer** — previews open in a content-only drawer with content search; copy-path always, show-in-folder/open-in-IDE when the deployment can hand paths to a native desktop.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview
```

Then restart the web instance.

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-ui-file-preview
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **Text preview only** — binary, oversized, and missing files render classified notices with their size, not content.
- **Current session only** — shows the selected session's files; not an arbitrary file browser.
- **Read-only** — previewing never edits; the session continues to own file mutations.
- **Mention interception is unofficial** — only official mention buttons are rerouted, via an unofficial DOM structure; if the core changes it, mention clicks silently degrade to the OS open.

## How it works

<details>
<summary>Internals (click to expand)</summary>

- `src/client/index.ts` — apply: registers the view/turn-row/drawer and mounts the `filePreview` Remote
- `src/client/FilePreviewView.tsx` — the Produced tab (file list + preview pane)
- `src/client/FilePreviewDrawer.tsx` — the in-place preview drawer
- `src/client/TurnFileRow.tsx` — the per-turn "N files changed" card
- `src/client/structured.tsx` — document-form renderers (markdown/JSON/CSV/HTML sandbox)
- `src/client/mention-intercept.ts` — capture-phase reroute of official mention clicks

Purely additive: one conversation view (`conversation.view`), one turn-tail row (`conversation.chat.turnTail`), one overlay drawer (`shell.overlay`), and a self-mounted `filePreview` Remote via `ctx.remote.$mount` — a stock dsh core runs it with zero edits. The namespace is not declared as an inject (self-mounting it would deadlock the loader); the mount is awaited and the service read back via `ctx.get('remote.filePreview')`. The file list is folded host-side by `@khorsheed/dsh-file-preview` (nested Code Mode dispatches included). Data flows one way: `filePreview.list` on each tab activation/refresh, `filePreview.read` on selection, stale in-flight requests dropped. The turn card reads the same host `filePreview.turnFiles` RPC through a per-session client cache — one source of truth for card and tab — and claims every turn unconditionally, so the official produced-files row never mounts.

Preview rendering: markdown goes through the official `MarkdownText` pipeline at a preview-scaled 14px (font tokens overridden scoped to the preview only); JSON uses the official `JsonTree` inspector; CSV/TSV render as tables (first row as header); every other text file stays in the syntax-highlighted code view. HTML files get a source ⇄ render toggle: the render view is a sandboxed iframe (empty `sandbox` — no scripts, forms, or popups; relative assets do not resolve against a file base), because the official pipeline keeps raw HTML literal by design. Content search switches any text read to the raw matched lines so hits stay visible.

Drawer gestures: the header shows the host-resolved absolute path with "copy path" always available, plus "show in folder" and "open in IDE" behind the same loopback + `canOpenPath` gate the official row uses. Reveal resolves the path against the session cwd and opens the folder with the file selected (Finder `open -R`, Explorer `explorer /select`, or a select-capable Linux file manager), falling back to the parent folder. Official prose mentions are rerouted to the drawer by a capture-phase click interceptor (`code > button[title]`), failing open to the official behavior; both reroutes are marked `TODO(official-opener-seam)` to retire once the core offers a file-opener override. While the drawer is open, the conversation shifts left by the drawer's width. No model involvement: nothing here assembles or sends a provider request (no KV-cache effect).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/ui-file-preview`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
