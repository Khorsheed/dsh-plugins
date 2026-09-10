# dsh-client-ui-file-preview

English | [中文](README.md)

Every file the agent wrote or edited, in one right-sidebar Produced page: the file list plus a step-through diff history of each change.

The agent worked for an hour; which files did it actually touch, and what did they end up looking like? With this plugin, the right sidebar's guide page gains a "Session products" entry: every file the session touched, latest activity first. Clicking a row opens a detail view in the same tab — a breadcrumb path header with copy-path / show-in-folder / open-in-IDE actions, and a Content / Change history toggle: document-form previews (markdown rendered, JSON inspector tree, CSV table, sandboxed HTML render, highlighted code, content search) on one side, and a step-through of every recorded write/edit diff on the other. The official document tab's toolbar dropdown offers the same "Change history" renderer. Every open route — prose mentions, the official deliverables card, the file tree — lands produced files in our detail view (the tab type claims `dsh-resource://file/**` addresses the fold recorded and the preview stack can render; anything else falls back to the official document tab). Each finished turn also ends with a small card summarizing which files changed and by how many lines. The data comes from the companion host half `@khorsheed/dsh-file-preview` (including bash write captures the official data misses); install both to get the UI, and without the host half it simply renders an empty state, never an error.

## Features

- **Right-sidebar Produced page** — a page-type right-sidebar tab (entered from the guide page): every file the session wrote or edited, latest activity first, searchable; a row click opens the detail view in-tab.
- **Detail view** — breadcrumb path header with actions (copy path always; "show in folder" = the file selected in the host file manager, and "open in IDE" = file-exact open, when the host probe finds a handler); a Content / Change history toggle — document-form previews (markdown/JSON/CSV/sandboxed HTML/highlighted code + content search) and per-write diff stepping.
- **Outside-workspace artifacts get the same detail view** — files bash wrote beyond the workspace root read through the host Remote; content and change history both work.
- **Change history in the official preview page too** — the document tab's toolbar dropdown offers the "Change history" renderer; prose mentions keep opening there for a quick preview.
- **Turn mutation card** — each finished turn ends with a collapsible "N files changed" card (including bash captures — broader than the official deliverables row) with per-file line deltas. Clicking an in-workspace file takes the official open route; an outside-workspace artifact opens the Produced page with that file's change history selected.

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

| Host line | Verdict |
| --- | --- |
| npm release (`>= 0.1.5-rc.1`) | ✅ full (`verifiedHost: 0.1.5-rc.1`) |
| npm release (`<= 0.1.4.x`) | ❌ unsupported — the right-sidebar tab system (`ctx.sidebarRightTabs` / `openResource`) landed in 0.1.5; older hosts stay on the previous release line |

**Version line mapping**: 0.3.0 and up require host `0.1.5-rc.1` or later; hosts on `0.1.2-rc.1` ~ `0.1.4.x` stay on the 0.2.x release line, and hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.0`).

## Known Limitations

- **Outside-workspace artifacts stay off the official route** — files bash wrote beyond the session's workspace root cannot be named by a `dsh-resource://file/...` address (the official `file` resource is workspace-scoped), and their rows carry a marker; but this plugin's own detail view is not bound by it — content and change history both render.
- **Current session only** — shows the selected session's files; not an arbitrary file browser.
- **Read-only** — previewing never edits; the session continues to own file mutations.

## How it works

<details>
<summary>Internals (click to expand)</summary>

- `src/client/index.ts` — apply: registers the tab type / tab body / change-history renderer / turn row and mounts the `filePreview` Remote
- `src/client/definition.tsx` — the page-type tab's registry definition (guide entry, claims no address)
- `src/client/history-definition.ts` — the change-history renderer's id and suffix list
- `src/client/FilePreviewTab.tsx` — the right-sidebar Produced page (list + detail view)
- `src/client/FilePreviewPane.tsx` — the detail view's preview stack (content search / markdown / JSON / CSV / sandboxed HTML + the history toggle)
- `src/client/structured.tsx` / `html-bridge.ts` / `html-src-doc.ts` — the document-form renderers and the HTML sandbox
- `src/client/FileHistoryBody.tsx` — the switchable "Change history" renderer of the official document tab
- `src/client/DiffHistory.tsx` — per-write diff stepping (unique to this plugin)
- `src/client/mentions-wrap.ts` — the in-place wrap unifying mention opens into the sidebar (seam S1 tail)
- `src/client/open-in-app.ts` — the official open-in-app probe (gesture visibility)
- `src/client/TurnFileRow.tsx` — the per-turn "N files changed" card

Purely additive: one right-sidebar tab type (`ctx.sidebarRightTabs` + the keyed `sidebar.right.pane.tab` seat), one document renderer implementation (`ctx.documentPreviews` + the keyed `sidebar.right.tab.document` seat, `priority: 'builtin'` — listed in the preview page's toolbar dropdown without taking over the official default), and one turn-tail row (`conversation.chat.turnTail`, default priority — the official deliverables row elects first, so the card renders exactly the turns official data misses), plus a self-mounted `filePreview` Remote via `ctx.remote.$mount` — a stock dsh core runs it with zero edits. The namespace is not declared as an inject (self-mounting it would deadlock the loader); the mount is awaited and the service read back via `ctx.get('remote.filePreview')`. The file list is folded host-side by `@khorsheed/dsh-file-preview` (nested Code Mode dispatches and bash write captures included). The turn card reads the same host `filePreview.turnFiles` RPC through a per-session client cache — one source of truth for card and tab.

The 0.1.5-rc.1 move retired four workarounds (upstream seam S1 landed): the `conversation.view` Produced tab, the `shell.overlay` preview drawer, the capture-phase DOM interception of prose mentions, and the turnTail `priority: -1` preemption — the official file-open entries (deliverables row / prose mentions / tool-result lines) all converge on `ctx.sidebarRight.openResource()`. Content preview now belongs to the official document tab (`dsh-resource://file/**` is claimed by the official `text` type); the change history has no official counterpart and stays self-drawn for the long haul.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/ui-file-preview`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
