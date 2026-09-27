# @khorsheed/dsh-file-preview

English | [中文](README.md)

Every file the agent touched, on one page: what changed, and what it looks like now.

The agent worked for an hour; which files did it actually touch, and what did they end up looking like? With this plugin, the right sidebar's guide page gains a "Session products" entry: every file the session read, wrote, or edited, latest activity first. Clicking a row opens a detail view in the same tab, rendered by the shared content pane (title row: name + language chip + copy-path / show-in-folder / open-in-IDE — a split control with an app menu when several IDEs resolved; path row: path plus the view controls; search row: content search). It carries a Content / Change history toggle: document-form previews (markdown rendered, JSON inspector tree, CSV table, tiered sandboxed HTML, highlighted code) on one side, and a step-through of every recorded write/edit diff on the other. Each finished turn also ends with a small card summarizing which files changed and by how many lines. Files the agent happened to write through bash (heredocs, redirects, and the like) are collected too. The whole service is read-only — it looks at files, never touches them.

Since 0.4.0 the host Remote service and the browser UI ship as **this one package** (previously two packages and two rows: file-preview + ui-file-preview; the old name `@khorsheed/dsh-client-ui-file-preview` is deprecated on npm).

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview1.png" width="640" alt="the Produced tab's file preview: file list and inline markdown preview">

## Features

- **Right-sidebar Produced page (one form on both host lines)** — a page-type right-sidebar tab (entered from the guide page) that is also a claimant: every file the session wrote or edited, latest activity first, searchable; a row click opens the detail view in-tab. The tab type claims `dsh-resource://file/**` addresses with a renderable-suffix filter at the extension band, outranking the official document tab's fallback band (a purely static test with no cold-cache window) — file-tree / mention / turn-card / product-row clicks all land in our detail view; types we cannot render (pdf, archives, binaries) fall through to the official document tab.
- **Detail view** — breadcrumb path header with actions (copy path always; "show in folder" = the file selected in the host file manager, and "open in IDE" = file-exact open via a split button listing every probed IDE, when the host probe finds a handler); the title row's "Reload" gesture re-reads the current file's content (the old read stays visible in flight, and a failure keeps it, reporting through the existing error slot); a Content / Change history toggle — document-form previews with content search, and per-write diff stepping (the official side still has no such dimension: workspace-changes is memory-resident, git-only, and lost on a host restart — this dimension stays self-drawn, **tracked upstream**).
- **Turn mutation card (both lines)** — each finished turn ends with a collapsible "N products" card (including bash captures — broader than the official deliverables row) with per-file line deltas; clicks take the official open route. On list-kind hosts (0.1.6-alpha.2+) the official deliverables entry in the same slot (present card + memory-resident changes card) is shadowed by a first-class slot mechanism — the turn area keeps only this durable, complete card.
- **Session file list (host Remote)** — every file the session's `read`/`write`/`edit` calls touched, with each write/edit change's diff attached.
- **Content reads** — current text, capped and flagged when truncated; images as browser-loadable URLs on web hosts; binary, missing, and oversized files answer classified notices instead of errors.
- **Bash-write capture** — files written through `bash` (heredocs, redirects, `tee`, `sed -i`) merged into the list, stat-verified and rebuilt after a host restart; artifacts bash wrote beyond the workspace root still render content and change history in our own detail view (through this plugin's Remote, which the workspace-scoped official read cannot serve).
- **Read-only by design** — no session state, no writes; a restarted host loses nothing.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview2.png" width="640" alt="per-artifact change history: pageable per-turn diffs">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview3.png" width="640" alt="the Produced tab: every file the session wrote, at a glance">

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-file-preview
```

Since 0.4.0 one package is everything: the host row provides the `filePreview` Remote and the browser half is discovered through `dsh.client`. Restart the web instance to activate; uninstalling restores the previous composition exactly:

```sh
dsh plugin --profile web remove @khorsheed/dsh-file-preview
```

> **Upgrading from 0.3.x**: the two rows are now one — drop the `ui-file-preview` row (`dsh plugin --profile web remove @khorsheed/dsh-client-ui-file-preview`) and keep/upgrade the `file-preview` row. A `disabled` override pinned to the old `ui-file-preview` row id no longer matches anything; retarget it to `file-preview` if needed.

## Config

```yaml
- id: file-preview
  name: '@khorsheed/dsh-file-preview'
  config:
    maxReadBytes: 524288
    maxFiles: 500
    captureBashWrites: true
```

`maxReadBytes` caps a single `read` (larger files answer `too-large`), `maxFiles` caps the `list` fold — both positive integers, defaults 512 KiB and 500 — and `captureBashWrites` (default `true`) toggles the bash-write collector.

## Compatibility

| Host line | Verdict |
| --- | --- |
| deepseek-harness master (`0.1.7-rc.2`) | ✅ full — the same form as 0.1.5: the self-drawn page claims renderable addresses at the extension band (rc.1's tab registry kept the band mechanism); the turnTail list arm also carries the official deliverables shadow |
| npm release (`>= 0.1.5-rc.1`) | ✅ full (`verifiedHost: 0.1.5-rc.1`) — same form; on chain-kind turnTail slots the registration probes and falls back to the select + priority -1 preemptive arm; the 0.1.5-rc.1 PTC rename is adapted (only `tool/ptc-dispatch` matches; the official v2→v3 log migration renames persisted rows) |
| npm release (`<= 0.1.4.x`) | ❌ unsupported — the right-sidebar tab system (`ctx.sidebarRightTabs` / `openResource`) landed in 0.1.5; older hosts stay on the previous release line |

**Version line mapping**: 0.3.0 and up require host `0.1.5-rc.1` or later; hosts on `0.1.2-rc.1` ~ `0.1.4.x` stay on the 0.2.x release line, and hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.1`). minHost does not move: the package carries no rc.1-only API (the turnTail list/chain arms already had a 0.1.5 fallback).

## Known Limitations

- **List is a point-in-time fold** — no push channel; the client refreshes by re-calling `list`.
- **No binary preview content** — non-image binaries answer `kind: 'binary'` with their size only.
- **Outside-workspace artifacts stay off the official route** — files bash wrote beyond the session's workspace root produce no `dsh-resource://file/...` address (the official `file` resource is workspace-scoped), so their rows carry a marker; our own detail view is unaffected — content and change history both render.
- **Current session only** — shows the selected session's files; not an arbitrary file browser.

## How it works

<details>
<summary>Internals (click to expand)</summary>

`ctx.filePreview` (wire namespace `filePreview`) exposes six generated Remote methods:

- `capabilities()` — a zero-session availability handshake returning `{ protocolVersion: 1 }`; the browser half installs UI surfaces only after it succeeds.

- `list(agent)` — a pure fold over `agent.session.events`: `read`/`write`/`edit` `tool/call`s contribute display paths, as do settled nested PTC `tool/ptc-dispatch`es for those tools (failed dispatches record nothing; entries borrow the root call's turn/step). A `write`/`edit` `tool/result` carrying `diffs` meta appends each change to the entry in event order, `lastDiff` kept as the final one. The response carries the entries, the last scanned seq, and whether `maxFiles` was hit. No filesystem access in the fold; with `captureBashWrites` on, entries merge with the collector's verified bash-written paths. Before returning, each path is resolved against the session cwd and `stat`-ed, keeping only those that still exist as a regular file — the log fold is history, the product list reflects disk state (a temp script a turn wrote then cleaned up is no longer a product); existence is probed fresh per call (not cached with the log fold).
- `read(agent, path, signal)` — resolves `path` against the session cwd and serves `kind: 'text'` (capped at `maxReadBytes`, flagged `truncated`), or `kind: 'image'` with a browser-loadable URL on web hosts — bytes ride a dedicated `/file-preview-image/<sessionId>/<path>` route, registered only when the optional `webServer` and `agents` services are composed; headless hosts answer `binary` — or a classified notice: `binary` (binary extension or NUL bytes; never read), `missing`, `too-large`, or `error` (message included).
- `reveal(agent, path, signal)` — opens the file's folder with the file selected, shell-free through `@deepseek-ai/dsh-native-command`: macOS `open -R`, Windows `explorer /select,<path>`, WSL via `wslpath`, desktop Linux tries `nautilus`/`dolphin`/`nemo --select` in order. Answers `{ revealed: true }`, or `false` with `reason: 'missing'` (no such target) or `'select-failed'` (no capable file manager — the caller then opens the parent folder, so the gesture always lands somewhere visible). Writes nothing.
- `openExternal(agent, path, app, signal)` — open a file in a specific host application (the "open in IDE" gesture): the official open-in-app route accepts directories only, so file-exact opens go here — macOS `open -a <App> <path>`, shell-free as well. `app` is an official open-in-app catalog id (the client probes `/open-in-app/apps`); the id → `.app` name map lives in `open-external.ts` (mirroring the official catalog's darwin entries). Non-macOS hosts and unknown ids answer `{ opened: false, reason }`, and the client hides the gesture. Writes nothing.
- `turnFiles(agent)` — every turn's file mutations for the turn-tail card, the same single source of truth as `list` but NOT deduped: a file touched in two turns appears in both groups, so each card lists exactly what that turn mutated. Line deltas are summed from result diffs; the fold is cached per session and invalidated by the log watermark, which the response carries for the client's own cache. Like `list`, it probes existence against the session cwd before returning and keeps only files that still exist (a cleaned-up temp script does not occupy a card).

Bash-write collector: watches each session's bash `tool/call`/`tool/result` pairs, extracts high-precision write targets (`cat > path` heredocs, single `>` redirects, `tee` non-append, `sed -i`), expands `$VAR`/`~`/relative paths against the host environment and session cwd, and records only paths `fs.stat` confirms as files (a miss beats a false positive). Captures live in a per-session in-memory registry rebuilt by replaying the session's own history on `session/created`, so a restarted host regains them; the session log itself is never mutated (the official `Session.append` cannot mark a plugin event `ignorable` — see the S2 seam in `docs/upstream-seam-registry.md`). Bash-captured files carry no diff history; previews read current content through `read`.

The browser half (`src/client/`):

- `src/client/index.ts` — apply mounts the `filePreview` Remote and performs the zero-session `capabilities()` handshake; on success `installFilePreviewSurfaces` registers every UI surface and owns disposal; the turnTail list arm also registers the official deliverables entry's shadow
- `src/client/definition.tsx` — the page-type tab's registry definition (guide entry + `dsh-resource://file/**` renderable-suffix claims) and the claim suffix list
- `src/client/FilePreviewTab.tsx` — the right-sidebar Produced page (list + detail view)
- `src/client/preview.ts` — the adaptation layer: `filePreview` wire kind → the kernel's `PreviewRead`, dictionary adapters (the detail view's header and preview stack come from the shared kernel `@khorsheed/dsh-client-ui-content-preview`, inlined at the source plane)
- `src/client/DiffHistory.tsx` — per-write diff stepping (unique to this plugin)
- `src/client/mentions-wrap.ts` — the in-place wrap unifying mention opens into the sidebar (seam S1 tail)
- `src/client/open-in-app.ts` — the official open-in-app probe (action visibility)
- `src/client/TurnFileRow.tsx` — the per-turn "N products" card

Purely additive: the host half is one Remote service; the browser half self-mounts that Remote through the official `ctx.remote.$mount` channel, registers one right-sidebar tab type (`ctx.sidebarRightTabs` + the keyed `sidebar.right.pane.tab` seat) and one turn-file row (`conversation.chat.turnTail` — list-kind since 0.1.6-alpha.2, where the arm also registers an empty body under the official deliverables entry's cell id at priority -1 — the slot system's first-class shadowing: one cell, entries at distinct priorities, the lowest renders; the official entry stays on the ledger so its declared `deliverables.file.actions` child slot never collapses; on 0.1.5 hosts the slot is still the election chain and the registration falls back to the old select + `priority: -1` preemptive shape on a probe) — a stock dsh core runs it with zero edits. The namespace is not declared as an inject (self-mounting it would deadlock the loader); the mount is awaited, the service is read back via `ctx.get('remote.filePreview')`, and the zero-session `capabilities()` probe must return `{ protocolVersion: 1 }` before any UI surface is installed. If the host is absent, all surfaces remain absent. The turn card reads the same host `filePreview.turnFiles` RPC through a per-session client cache — one source of truth for card and tab.

The 0.1.5-rc.1 move retired four workarounds (upstream seam S1 landed): the `conversation.view` Produced tab, the `shell.overlay` preview drawer, the capture-phase DOM interception of prose mentions, and the turnTail `priority: -1` preemption — the official file-open entries (deliverables row / prose mentions / tool-result lines) all converge on `ctx.sidebarRight.openResource()`. Plan B (landed and vetoed by the repo owner on the same day, 2026-09-24): registering the content face into the official `documentPreviews` registry as the document tab's default renderer, plus the phase-two headless embedding — the seam cost (the renderer loading protocol, the extension-band takeover semantics, the headless layout coupling) and the UX compromises (change history demoted to the renderer dropdown, the copy button floating over the search row) did not hold up, so the self-drawn products page (the address-claim form) was restored on both lines; the turnTail shadow was not part of the veto and stays.

Trust and state: a trusted, read-only capability — it reads whatever `ctx.fs` allows for the session, so composing it grants preview access to the session's filesystem view; it is not a security boundary. It emits no session events; its only per-session state is the turn-fold cache and the bash collector's verified-writes registry.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/file-preview`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
