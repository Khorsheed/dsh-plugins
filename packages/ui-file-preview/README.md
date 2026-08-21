# @khorsheed/dsh-client-ui-file-preview

English | [中文](README.zh.md)

A session file-preview surface for the dsh web GUI, built purely on official extension points: a 产物/Produced tab beside chat and trajectory lists the files the session wrote or edited, and selecting one previews it right in the page — current content, full change history, inline images — no IDE needed.

<img src="docs/screenshots/05-file-preview-tab.png" width="480" alt="the Produced tab listing the session's written files">

<img src="docs/screenshots/06-file-preview.png" width="480" alt="previewing a markdown file rendered as a document">

## Features

- **Produced tab** — a `'file-preview'` tab (labeled 产物/Produced) in the conversation view ring lists every file the session wrote or edited, latest activity first, defaulting to the session's products with an all-files toggle.
- **Document-form previews** — markdown renders through the same pipeline the chat uses, JSON through the collapsible `JsonTree` inspector, CSV/TSV as tables, HTML with a source ⇄ sandboxed-render toggle, images inline; every other text file stays in the syntax-highlighted code view.
- **Change history** — a second tab steps through every recorded write/edit diff, each carrying its turn and step.
- **Turn mutation card** — each finished turn ends with a collapsible "N files changed" card listing the turn's files with per-file line deltas.
- **In-place drawer + host gestures** — clicking a file opens a content-only drawer (the conversation view is untouched) with copy-path always available, plus "show in folder" and "open in IDE" when the deployment can hand paths to a native desktop.
- **Content search** — a search box highlights matches in any text preview and jumps between them.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview
```

Then restart the web instance. Uninstall removes it cleanly:

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-ui-file-preview
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **Text preview only** — binary, oversized, and missing files render classified notices with their size, not content.
- **Current session only** — the view shows the selected session's files; it does not browse arbitrary files on disk.
- **Read-only** — previewing never edits; the session continues to own file mutations.
- **Turn-card scope** — the mutation card lists each finished turn's created/edited files plus the produced files the official deliverables fold reports (line deltas show only when the tool's diff call view reported them), capping its visible rows behind an overflow toggle; the view tab lists the same products-only vocabulary (reads never appear).
- **Mention interception is unofficial** — arbitrary file paths in prose are not intercepted; only the official mention buttons are, and that interceptor tracks an unofficial DOM structure — if the core changes it, mention clicks silently degrade to the OS open. Directory grouping and heuristic path extraction from bash or prose are deferred.

## How it works

<details>
<summary>Internals (click to expand)</summary>

Pure additive browser plugin: it registers one conversation view (`conversation.view`), one turn-tail row (`conversation.chat.turnTail`), and one overlay drawer (`shell.overlay`), and mounts its own `filePreview` Remote through `ctx.remote.$mount` — a stock dsh core runs it with zero edits, and it removes cleanly when uncomposed. The file list is folded host-side by `@khorsheed/dsh-file-preview` (nested Code Mode dispatches included). Because the plugin both mounts the `filePreview` namespace and consumes it, the namespace is not declared as an inject (that would deadlock the loader — the service only appears after this apply's `$mount` runs); the mount is awaited and the namespace is read back from the global service store via `ctx.get('remote.filePreview')`.

Data flows one way: the view fetches `filePreview.list` on each tab activation and on refresh; selecting a row fetches `filePreview.read` for that path; the drawer fetches both on open. Whole values land in the session's store, and a stale in-flight request is dropped when the selection moves or the surface unmounts. The tab and the drawer each scroll independently of the surrounding page; diff lines soft-wrap through the plugin's own CSS (the shared `DiffBlock` is untouched).

The turn card reads the host `filePreview.turnFiles` RPC — the SAME single source of truth as the products tab (write/edit calls, Code Mode dispatches, render-intent paths from result diff meta, and bash captures all land there), fetched once per session through a client-side cache — so the card and the tab can never diverge. The card claims every turn unconditionally (rendering nothing until its fetch settles or the turn has no files), so the official produced-files row never mounts; the old client-side write/edit-only fold and the official deliverables union retired with it.

Preview rendering: text previews render each file type in its document form where one exists, all inside the same block chrome the code and diff views use (a rounded code-block surface with a small format banner). Markdown goes through the official `MarkdownText` pipeline scaled to a preview-appropriate 14px body (the chat's 16px reads large in a pane, so the plugin overrides the markdown font tokens scoped to the preview only); JSON uses the official `JsonTree` inspector when it parses; CSV/TSV render as a table through the markdown pipeline (first row as header). HTML files get a source ⇄ render toggle: the render view is a sandboxed iframe (empty `sandbox` — no scripts, forms, or popups; CSS and images render, relative assets do not resolve against a file base), because the official pipeline keeps raw HTML literal by design and the official way to view HTML fully is opening it in the browser (the host opener treats `.html` as a browser document — the header's "open in IDE" gesture). A content search switches any text read to the raw matched lines so hits stay visible either way.

The drawer header shows the file's host-resolved absolute path and offers "copy path" (browser clipboard, available in any context) plus "show in folder" and "open in IDE" host gestures when the deployment can hand paths to a native desktop (loopback + `canOpenPath`, the same gate the official row uses); the file view tab mirrors that header over its preview pane so both surfaces read the same. "Show in folder" goes through the host half's `filePreview.reveal` Remote method: the host resolves the path against the session cwd and opens the file's folder with the file selected (Finder `open -R`, Explorer `explorer /select`, or a select-capable Linux file manager), falling back to opening the parent folder when the file is gone or no file manager can select. The official prose mentions are rerouted the same way: a document capture-phase click interceptor (`mention-intercept.ts`) recognizes their `code > button[title]` structure and opens the drawer instead of the host OS, failing open to the official behavior on anything unrecognized; file links everywhere else keep the host OS open (the core has no third-party hook for arbitrary link interception). Both reroutes are marked `TODO(official-opener-seam)` to retire once the core offers a file-opener override. While the drawer is open the conversation (scroll body and composer seat) shifts left by the drawer's width so chat never sits underneath it.

Model experience: none — the view renders host-computed file data in the browser; nothing here reaches a model request, and the package neither assembles nor sends a provider request (no KV-cache effect).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/ui-file-preview`). Issues and contributions welcome there.
