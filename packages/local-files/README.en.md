# @khorsheed/dsh-local-files

English | [中文](README.md)

Browse any local directory from the right sidebar — a lazy-loading file tree with structured previews, git-agnostic, defaulting to the current session's workspace but never locked to it.

To glance at an assets folder next to the workspace or a data file outside the repo, you used to switch to the system file manager. This plugin registers a **Files** page-type tab in the right sidebar (entered from the guide page's "Files" card): a per-level lazy-loading file tree on the left, and a detail pane on the right that renders HTML/Markdown/JSON/CSV as structured views and inlines images. It browses any absolute local path — untracked, ignored, and git-external files alike; the data plane rides its own Typert Remote, decoupled from the worktrees plugin's git badges: that one only shows git status, this one only does plain local-file browsing. (The split in one line: this plugin is "browse any local directory"; file-preview is "the current session's products" — different semantics, hence two independent packages.)

## Features

- **Files tab** — a page-type right-sidebar tab, entered from the guide page's "Files" card. The registration takes over the official `files` kind at the extension band (the registry's built-in per-kind shadowing): the guide shows a single files card, and the official "Workspace files" card resumes on uninstall — never two cards at once.
- **Tree left, preview right** — the tree lazy-loads per level, toggles dot-files in one click, and drags wider or narrower; the detail pane renders HTML/Markdown/JSON/CSV structurally and inlines images; the title row's "Reload" gesture re-reads the current file — on-disk changes land without reselecting, and a failed re-read keeps the old content and reports through the existing error slot.
- **Default root = the session's workspace** — the same data source as the official files tree (the session row's `cwd`, read reactively — a late-loading row fills in); a manually chosen directory is remembered per session (localStorage `dsh-local-files-root:<sessionId>`) and restored across tab reopens and page reloads; the toolbar's "Back to original workspace" jumps to the current session's workspace root (hidden while already there).
- **Breadcrumbs + action row** — breadcrumbs navigate level by level; the action buttons are "Choose workspace" (the native directory picker), "Back to original workspace", "Show in folder" (shown when the host's open-in-app probe resolved a file manager), and "Refresh files".
- **Git-agnostic** — it browses any absolute local path (including untracked, ignored, and git-external files), with no repository judgment.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-local-files
```

Restart the web instance to activate; no configuration needed. Uninstalling restores the previous composition exactly — the official "Workspace files" card resumes with it.

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-files
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the page-type right-sidebar tab (the `sidebar.right.pane.tab` seat and the per-kind shadowing registry) and the open-in-app routes all exist on this line, so `minHost` pins `0.1.5-rc.1`. Hosts `0.1.2`–`0.1.4` have no right sidebar and this plugin contributes no browser surface there (the first public release already requires 0.1.5+; do not install on older hosts).
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.7-rc.2) — the rc-line icon renames (`Icon*Outline14/16` → `Icon*OutlineMedium`) and the plugin-inventory display metadata (`locale/*.json`) are both followed up; this package's build and tests pass against the 0.1.7-rc.2 source tree (via `DSH_HARNESS`).
- **Web surface**: the right-sidebar tab is a browser surface; a headless profile has no browser consumer and the plugin contributes nothing there (the host half's Remote still registers).
- **Probed gestures degrade**: "Show in folder / Open in IDE" ride the official open-in-app — the browser probes `GET /open-in-app/apps` once per page and shows a gesture only when the host resolved a backing app (file manager / editor); a failed probe keeps them hidden. "Choose workspace" probes the host's directoryPicker Remote and degrades to a cancel when absent. Both paths degrade silently, never affecting boot.

## Known Limitations

- **Read-only browser** — no create, rename, delete, or edit gestures; browsing and previewing is the whole purpose.
- **A window cap on large files** — text reads at most 2 MB at a time (the overflow shows a truncation marker; the pane has no "load more" gesture yet); images over 2 MB are not inlined (a size placeholder instead); binary files are judged by their NUL/control-byte ratio and show a non-text placeholder.
- **Open gestures accept directories only** — the official open route refuses file paths, so a file's "Show in folder / Open in IDE" gesture opens its containing directory.
- **The browsable range is whatever the host process's user may read** — the path check is shape-only (must be absolute, `..` traversal rejected) and does not jail browsing to a subtree; this is the same trust model as the official file preview (your own machine) — shared or multi-tenant deployments, take note.
- **Search highlighting has a paint cap** — in-preview search paints through the CSS Custom Highlight API onto the rendered view, at most 2000 matches, and stops coloring beyond that; the HTML sandbox preview and hosts without the API get no highlighting.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**The data plane.** The host half `ctx.provide('localFiles')`s a stateless service core, thinly adapted by a Typert Remote (namespace `localFiles`) into two verbs: `listDirectory` / `readFile` (pure JSON args, no caller lookup — paths are absolute to begin with, so any session or the global frame may call). The client mounts it through the official `ctx.remote.$mount` channel.

**Windowed reads.** A text read is bounded by its byte window (`MAX_CONTENT_BYTES = 2 MB`, plus one extra byte to decide truncation), and the returned `nextOffset` marks where a follow-up read continues; images are all-or-nothing — a stat over the cap answers `too-large`, otherwise the whole image returns as a base64 data URL; binary is judged by a NUL/control-byte ratio over 2% after decoding. Paths pass `assertSafeLocalPath`'s shape check (absolute, no `..`) and then a `realpath` canonicalization.

**The kind takeover.** The registry admits exactly one extension per builtin kind and puts it in force — claims, the guide page, and the body/title seat lookup all follow the in-force definition, and the shadowed builtin resumes when the extension unregisters. This implementation keeps its own `id` (`@khorsheed/dsh-local-files`): duplicate ids fail hard, while kinds are the designed takeover channel.

**Default root and memory.** The session row's `cwd` is read reactively and a late-loading row fills in — never overwriting a remembered or manually chosen root; a manual choice writes localStorage (`dsh-local-files-root:<sessionId>`) and broadcasts through an externally readable store, isolated per session.

**Probe, never inject.** The directory-picker Remote is probed through `ctx.get` rather than `inject` — injecting would pend the whole plugin on compositions without a picker; open-in-app probes the apps list once per page, and the two external-open gestures show or hide per its resolution.

**A reused preview layer.** The detail pane is `@khorsheed/dsh-client-ui-content-preview`'s shared content pane (workspace source bundled into the client build, not a runtime dependency): Markdown / JSON tree / CSV table / code views each in place; HTML renders statically by default (scripts never execute), a scripted document gets a hint, and scripts run inside the sandbox only after confirmation.

**Identity triangle.** The cordis row id `local-files`, `clientBundle('@khorsheed/dsh-local-files')`, and `src/invariant.ts`'s `PACKAGE_NAME` move together.

**Exports.** `/` exports the host half (the `LocalFilesService` core and `LocalFilesRemoteService`); `/client` exports the plugin body (`apply`/`inject`) plus `WorkspaceView` and `LOCAL_FILES_KIND`/`LOCAL_FILES_TAB_ID`; `/types` carries the wire payload types; `/invariant` ships the deployment self-check.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-files`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
