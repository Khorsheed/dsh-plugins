# dsh-client-ui-file-preview

English | [中文](README.md)

Every file the agent wrote or edited: content preview plus a step-through diff history of each change.

The agent worked for an hour; which files did it actually touch, and what did they end up looking like? With this plugin — **0.1.7-rc.1 and later**, every file click (the official deliverables card, the file tree, prose mentions, the turn card) lands in the official document tab whose DEFAULT renderer is our shared content pane (`@khorsheed/dsh-client-ui-content-preview`, registered into the official `documentPreviews` registry at the extension band): markdown rendered, JSON inspector tree, CSV table, tiered sandboxed HTML, highlighted code, content search, and a copy-path gesture; the official renderers and our "Change history" renderer (stepping every recorded write/edit diff) sit in the toolbar dropdown. On **0.1.5** — no official pane — the right sidebar's guide page gains a self-drawn "Session products" page: the file list plus a detail view (the same content pane with a Content / Change history toggle and show-in-folder / open-in-IDE gestures). Each finished turn also ends with a small card summarizing which files changed and by how many lines. The data comes from the companion host half `@khorsheed/dsh-file-preview` (including bash write captures the official data misses); install both to get the UI. Without the host half, every UI surface is absent—no error card or empty tab remains.

## Features

- **The official document tab's default content renderer (0.1.7-rc.1+)** — the content pane registered into the official `documentPreviews` registry (extension band: an external implementation outranks the official builtins): document-form previews (markdown/JSON/CSV/tiered sandboxed HTML/highlighted code + content search) and the copy-path gesture ride along; the official renderers (text/markdown/code/zoom image, …) stay one dropdown switch away. The self-drawn FilePreviewTab type is never registered — file clicks, mentions, and product entries all route to the official document tab.
- **Self-drawn Produced page (0.1.5)** — a page-type right-sidebar tab (entered from the guide page, claiming `dsh-resource://file/**` with a renderable-suffix filter): every file the session wrote or edited, latest activity first, searchable; a row click opens the detail view in-tab (breadcrumb header + copy path / show in folder / open in IDE + the Content / Change history toggle).
- **Change history renderer (both lines)** — the document tab's toolbar dropdown offers "Change history": a step-through of every recorded write/edit diff. The official side has no such dimension to this day (workspace-changes is memory-resident, git-only, and lost on a host restart), so this dimension and the turn card stay self-drawn, **tracked upstream**: if the official side later ships an equivalent (a durable session-products / change-record dimension), retirement gets re-evaluated.
- **Outside-workspace artifacts get the same rendering (both lines)** — files bash wrote beyond the workspace root read through our own Remote (the workspace-scoped official read cannot serve them): on rc.1 inside the official document tab (renderer-owned loading, `loading: 'renderer'`), on 0.1.5 in the self-drawn detail view.
- **Turn mutation card (both lines)** — each finished turn ends with a collapsible "N products" card (including bash captures — broader than the official deliverables row) with per-file line deltas; clicks take the official open route.

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
| deepseek-harness master (`0.1.7-rc.1`) | ✅ full — content preview registers into the official `documentPreviews` registry (the official document tab's default renderer); the self-drawn tab is not registered |
| npm release (`>= 0.1.5-rc.1`) | ✅ full (`verifiedHost: 0.1.5-rc.1`) — the self-drawn Produced page tab plus the change-history renderer in the official preview page |
| npm release (`<= 0.1.4.x`) | ❌ unsupported — the right-sidebar tab system (`ctx.sidebarRightTabs` / `openResource`) landed in 0.1.5; older hosts stay on the previous release line |

**Version line mapping**: 0.3.0 and up require host `0.1.5-rc.1` or later; hosts on `0.1.2-rc.1` ~ `0.1.4.x` stay on the 0.2.x release line, and hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.0`). minHost does not move: npm's latest release line is still 0.1.5, and the dual-line 0.1.5 arm is fully kept. The rc.1 gesture roster (folded in / yielded) lives in `package.json`'s `dsh.compat.notes`.

## Known Limitations

- **Gestures yielded on rc.1** — show-in-folder / open-in-IDE yield to the official ui-open-in-app document actions (in a composition without it those two gestures are gone; copy path is unaffected); image preview yields to the official zoom viewer (except avif, which the official viewer does not claim and our pane still serves); oversized files move from our truncation notice to the official text renderer's paged scrolling (one dropdown switch away).
- **Outside-workspace artifacts** — files bash wrote beyond the session's workspace root render on both lines (our own Remote read serves paths the official workspace read cannot); the official `file` resource does not guarantee metadata for those addresses, and without metadata an rc.1 tab has no official change detection / auto-refresh (reload by hand).
- **Current session only** — shows the selected session's files; not an arbitrary file browser.
- **Read-only** — previewing never edits; the session continues to own file mutations.

## How it works

<details>
<summary>Internals (click to expand)</summary>

- `src/client/index.ts` — apply mounts the `filePreview` Remote and performs the zero-session `capabilities()` handshake; on success `installFilePreviewSurfaces` registers the serving host line's UI surfaces and owns disposal
- `src/client/content-definition.ts` — the rc.1 content renderer's id and suffix list (extension band; avif declared a binary suffix)
- `src/client/FileContentBody.tsx` — the rc.1 content renderer body: the shared content pane inside the official document tab (`loading: 'renderer'` renderer-owned loading through this plugin's Remote)
- `src/client/definition.tsx` — the 0.1.5 page-type tab's registry definition (guide entry + address claims)
- `src/client/history-definition.ts` — the change-history renderer's id and suffix list
- `src/client/FilePreviewTab.tsx` — the 0.1.5 right-sidebar Produced page (list + detail view)
- `src/client/preview.ts` — the adaptation layer: `filePreview` wire kind → the kernel's `PreviewRead`, dictionary adapters (the content face comes from `@khorsheed/dsh-client-ui-content-preview`; this package's private render copies are gone)
- `src/client/FileHistoryBody.tsx` — the switchable "Change history" renderer of the official document tab
- `src/client/DiffHistory.tsx` — per-write diff stepping (unique to this plugin)
- `src/client/mentions-wrap.ts` — the in-place wrap unifying mention opens into the sidebar (seam S1 tail)
- `src/client/open-in-app.ts` — the official open-in-app probe (0.1.5 detail-view gesture visibility)
- `src/client/TurnFileRow.tsx` — the per-turn "N products" card

Purely additive, with the content face chosen by capability probe, never a version read: a point-in-time `ctx.get('documentPreviews')` skips the self-drawn tab when the official pane is already provided, and a nested plugin pended on `inject: ['documentPreviews']` registers the rc.1 renderer pair and retires the legacy tab when the pane arrives later (cordis re-wakes only fibers declaring the service; cordis 4.0.4's service-access guard forbids reading an undeclared service as a property, and a static inject would pend the whole plugin on 0.1.5 — the deferred-inject pattern from local-agent's settings-scope). rc.1 registrations: the content renderer (extension band, the official document tab's default body, `loading: 'renderer'` renderer-owned loading) and the change-history renderer (`priority: 'builtin'` — dropdown-listed, never the default), both bodies in the keyed `sidebar.right.tab.document` seat; 0.1.5 registrations: one right-sidebar tab type (`ctx.sidebarRightTabs` + the keyed `sidebar.right.pane.tab` seat). The turn-tail row is line-identical (`conversation.chat.turnTail` — list-kind since 0.1.6-alpha.2, coexisting with the official deliverables and plan cards and self-hiding on turns without files; on 0.1.5 hosts the slot is still the election chain and the registration falls back to the old select + `priority: -1` preemptive shape on a probe). The `filePreview` Remote self-mounts via `ctx.remote.$mount` — a stock dsh core runs it with zero edits. The namespace is not declared as an inject (self-mounting it would deadlock the loader); the mount is awaited, the service is read back via `ctx.get('remote.filePreview')`, and the zero-session `capabilities()` probe must return `{ protocolVersion: 1 }` before any UI surface is installed. If the host is absent, all surfaces remain absent. The file list is folded host-side by `@khorsheed/dsh-file-preview` (nested Code Mode dispatches and bash write captures included). The turn card reads the same host `filePreview.turnFiles` RPC through a per-session client cache — one source of truth for card and content faces.

The 0.1.5-rc.1 move retired four workarounds (upstream seam S1 landed): the `conversation.view` Produced tab, the `shell.overlay` preview drawer, the capture-phase DOM interception of prose mentions, and the turnTail `priority: -1` preemption — the official file-open entries (deliverables row / prose mentions / tool-result lines) all converge on `ctx.sidebarRight.openResource()`. The 0.1.7-rc.1 move (plan B, user decision 2026-09-24): the content preview face switched from the self-drawn FilePreviewTab to a registration in the official `documentPreviews` registry, with the self-drawn pane kept on 0.1.5 as the dual line; the change-record / session-products dimension (TurnFileRow, FileHistoryBody) has no official counterpart (memory-resident, git-only, lost on restart) and stays self-drawn, tracked upstream.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/ui-file-preview`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
