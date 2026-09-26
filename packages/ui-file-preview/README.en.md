# dsh-client-ui-file-preview

English | [中文](README.md)

Every file the agent wrote or edited, in one right-sidebar Produced page: the file list plus a step-through diff history of each change.

The agent worked for an hour; which files did it actually touch, and what did they end up looking like? With this plugin, the right sidebar's guide page gains a "Session products" entry: every file the session touched, latest activity first. Clicking a row opens a detail view in the same tab, rendered by the SHARED content pane `@khorsheed/dsh-client-ui-content-preview` (title row: name + language chip + copy-path / show-in-folder / open-in-IDE — a split control with an app menu when several IDEs resolved; path row: path + the view controls; search row: content search). It carries a Content / Change history toggle: document-form previews (markdown rendered, JSON inspector tree, CSV table, tiered sandboxed HTML, highlighted code, content search) on one side, and a step-through of every recorded write/edit diff on the other. Every open route — prose mentions, the official deliverables row, the file tree, the turn card — lands renderable session files in our detail view (the tab type claims `dsh-resource://file/**` with a renderable-suffix filter at the extension band, outranking the official document tab's fallback band, a purely static test with no cold-cache window; types we cannot render — pdf, archives, binaries — fall back to the official document tab). Each finished turn also ends with a small card summarizing which files changed and by how many lines — on list-kind hosts (0.1.6-alpha.2+) it is the ONLY products card in the turn area (the official present card and the memory-resident changes card are shadowed through the slot system's first-class mechanism, see "How it works"). The data comes from the companion host half `@khorsheed/dsh-file-preview` (including bash write captures the official data misses); install both to get the UI. Without the host half, every UI surface is absent—no error card or empty tab remains.

## Features

- **Right-sidebar Produced page (one form on both host lines)** — a page-type right-sidebar tab (entered from the guide page) that is also a claimant: every file the session wrote or edited, latest activity first, searchable; a row click opens the detail view in-tab. 0.1.5 and 0.1.7-rc.2 share the same form (the plan-B embedding into the official pane was reverted on 2026-09-24).
- **Detail view** — breadcrumb path header with actions (copy path always; "show in folder" = the file selected in the host file manager, and "open in IDE" = file-exact open via a split button listing every probed IDE, when the host probe finds a handler); the title row's "Reload" gesture re-reads the current file's content (fresh on-disk content in one click; the old read stays visible in flight, and a failure keeps it, reporting through the existing error slot); a Content / Change history toggle — document-form previews (markdown/JSON/CSV/tiered sandboxed HTML/highlighted code + content search) and per-write diff stepping (the official side still has no such dimension: workspace-changes is memory-resident, git-only, and lost on a host restart — this dimension stays self-drawn, **tracked upstream**).
- **Outside-workspace artifacts get the same detail view** — files bash wrote beyond the workspace root read through this plugin's Remote (the workspace-scoped official read cannot serve them); content and change history both work.
- **Turn mutation card (both lines)** — each finished turn ends with a collapsible "N products" card (including bash captures — broader than the official deliverables row) with per-file line deltas; clicks take the official open route (renderable addresses are claimed by this page). On list-kind hosts the official deliverables entry in the same slot (present card + memory-resident changes card) is shadowed by a first-class slot mechanism (an empty lower-priority body wins the shared cell id) — the turn area keeps only this durable, complete card.

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
| deepseek-harness master (`0.1.7-rc.2`) | ✅ full — the same form as 0.1.5: the self-drawn page claims renderable addresses at the extension band (rc.1's tab registry kept the band mechanism); the turnTail list arm also carries the official deliverables shadow |
| npm release (`>= 0.1.5-rc.1`) | ✅ full (`verifiedHost: 0.1.5-rc.1`) — same form; on chain-kind turnTail slots the registration probes and falls back to the select + priority -1 preemptive arm |
| npm release (`<= 0.1.4.x`) | ❌ unsupported — the right-sidebar tab system (`ctx.sidebarRightTabs` / `openResource`) landed in 0.1.5; older hosts stay on the previous release line |

**Version line mapping**: 0.3.0 and up require host `0.1.5-rc.1` or later; hosts on `0.1.2-rc.1` ~ `0.1.4.x` stay on the 0.2.x release line, and hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.0`). minHost does not move: after the revert the package carries no rc.1-only API (the turnTail list/chain arms already had a 0.1.5 fallback).

## Known Limitations

- **Outside-workspace artifacts stay off the official route** — files bash wrote beyond the session's workspace root produce no `dsh-resource://file/...` address (the official `file` resource is workspace-scoped), so their rows carry a marker; our own detail view is unaffected — content and change history both render.
- **Current session only** — shows the selected session's files; not an arbitrary file browser.
- **Read-only** — previewing never edits; the session continues to own file mutations.

## How it works

<details>
<summary>Internals (click to expand)</summary>

- `src/client/index.ts` — apply mounts the `filePreview` Remote and performs the zero-session `capabilities()` handshake; on success `installFilePreviewSurfaces` registers every UI surface and owns disposal; the turnTail list arm also registers the official deliverables entry's shadow
- `src/client/definition.tsx` — the page-type tab's registry definition (guide entry + `dsh-resource://file/**` renderable-suffix claims) and the claim suffix list
- `src/client/FilePreviewTab.tsx` — the right-sidebar Produced page (list + detail view)
- `src/client/preview.ts` — the adaptation layer: `filePreview` wire kind → the kernel's `PreviewRead`, dictionary adapters (the detail view's header and preview stack come from `@khorsheed/dsh-client-ui-content-preview`; this package's private render copies are gone)
- `src/client/DiffHistory.tsx` — per-write diff stepping (unique to this plugin)
- `src/client/mentions-wrap.ts` — the in-place wrap unifying mention opens into the sidebar (seam S1 tail)
- `src/client/open-in-app.ts` — the official open-in-app probe (action visibility)
- `src/client/TurnFileRow.tsx` — the per-turn "N products" card

Purely additive: it registers one right-sidebar tab type (`ctx.sidebarRightTabs` + the keyed `sidebar.right.pane.tab` seat) and one turn-file row (`conversation.chat.turnTail` — list-kind since 0.1.6-alpha.2, where the arm also registers an empty body under the official deliverables entry's cell id at priority -1 — the slot system's first-class shadowing: one cell, entries at distinct priorities, the lowest renders; the official entry stays on the ledger so its declared `deliverables.file.actions` child slot never collapses; on 0.1.5 hosts the slot is still the election chain and the registration falls back to the old select + `priority: -1` preemptive shape on a probe), and self-mounts the `filePreview` Remote via `ctx.remote.$mount` — a stock dsh core runs it with zero edits. The namespace is not declared as an inject (self-mounting it would deadlock the loader); the mount is awaited, the service is read back via `ctx.get('remote.filePreview')`, and the zero-session `capabilities()` probe must return `{ protocolVersion: 1 }` before any UI surface is installed. If the host is absent, all surfaces remain absent. The file list is folded host-side by `@khorsheed/dsh-file-preview` (nested Code Mode dispatches and bash write captures included). The turn card reads the same host `filePreview.turnFiles` RPC through a per-session client cache — one source of truth for card and tab.

The 0.1.5-rc.1 move retired four workarounds (upstream seam S1 landed): the `conversation.view` Produced tab, the `shell.overlay` preview drawer, the capture-phase DOM interception of prose mentions, and the turnTail `priority: -1` preemption — the official file-open entries (deliverables row / prose mentions / tool-result lines) all converge on `ctx.sidebarRight.openResource()`. Plan B (landed and vetoed by the repo owner on the same day, 2026-09-24): registering the content face into the official `documentPreviews` registry as the document tab's default renderer, plus the phase-two headless embedding — the seam cost (the renderer loading protocol, the extension-band takeover semantics, the headless layout coupling) and the UX compromises (change history demoted to the renderer dropdown, the copy button floating over the search row) did not hold up, so the self-drawn products page (the address-claim form) was restored on both lines; the turnTail shadow was not part of the veto and stays.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/ui-file-preview`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
