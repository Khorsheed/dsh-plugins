# dsh-client-ui-file-preview

English | [中文](README.md)

See every file the agent wrote or edited — content and each individual change — without opening an IDE.

The agent worked for an hour; which files did it actually touch, and what did they end up looking like? With this plugin, the session grows a Produced tab listing every file the session touched; select one and preview it right in the page — markdown rendered as a document, JSON as an inspector tree, CSV as a table, images inline — and page back through the diff of every write/edit. Each finished turn also ends with a small card summarizing which files changed and by how many lines. The data comes from the companion host half `@khorsheed/dsh-file-preview`; install both to get the UI, and without the host half it simply renders an empty state, never an error.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview3.png" width="640" alt="the Produced tab: every file the session wrote listed on the left, the selected file's current content previewed on the right">

## Features

- **Produced tab** — every file the session wrote or edited, latest activity first, with an all-files toggle.
- **Document-form previews** — markdown rendered, JSON/CSV as inspector/table, HTML with a source ⇄ sandboxed-render toggle, images inline.
- **Change history** — step through every recorded write/edit diff with its turn and step.
- **Turn mutation card** — each finished turn ends with a collapsible "N files changed" card with per-file line deltas.
- **In-place drawer** — previews open in a content-only drawer with content search; copy-path always, show-in-folder/open-in-IDE when the deployment can hand paths to a native desktop.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview1.png" width="640" alt="the per-turn 'N files changed' card at the end of a turn, and a produced file opened in the right-hand drawer with copy-path, folder, and IDE buttons in its header">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview2.png" width="640" alt="the drawer's change-history tab: page through every per-turn diff recorded for the file">

## Install

The UI and the data are two packages — install both:

```sh
dsh plugin --profile web add @khorsheed/dsh-file-preview            # host half: folds the file list, reads content
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview  # this package: the UI
```

Then restart the web instance. Uninstall this package (the host half may stay or go):

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-ui-file-preview
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ⚠️ degraded — preview and folding are intact; the external-open buttons (open in folder / open in IDE) are hidden on 0.1.2: the host description snapshot no longer carries `canOpenPath` (the capability became an RPC probe), so the loopback gate can never confirm it; restoration is a follow-up against the official `remote.session.canOpenWorkspacePath` RPC seam. minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.2-rc.1; same external-open degradation)

**Version line mapping**: 0.2.0 and up support host `0.1.2-rc.1` and later; hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.0`).

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
