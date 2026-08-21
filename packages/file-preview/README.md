# @khorsheed/dsh-file-preview

English | [中文](README.zh.md)

The read-only host service behind dsh's file-preview surface: it folds one session's log into the files its `read`/`write`/`edit` tool calls touched — every write/edit change's diff included — merges in the files its `bash` calls wrote, and serves any of those files' current content for preview. Pair it with the companion client (`@khorsheed/dsh-client-ui-file-preview`) and the web GUI gains a Produced-files tab with inline previews, per-change diff history, and a reveal-in-folder gesture. The service owns no session state and writes nothing — the session log and the filesystem stay authoritative.

<img src="docs/screenshots/06-file-preview.png" width="480" alt="the companion client's file-preview pane: file list and inline markdown preview">

## Features

- **Session file list** — every file the session's `read`/`write`/`edit` calls touched (nested Code Mode dispatches included), with each write/edit change's diff attached; repeated paths refresh in place, keeping first-seen order.
- **Content reads** — a file's current text, capped by config and flagged when truncated; images come back as browser-loadable URLs on web hosts; binary, missing, and oversized files answer classified notices instead of content.
- **Bash-write capture** — files written through `bash` (heredocs, `>` redirects, `tee`, `sed -i`) are merged into the list, each stat-verified against the real filesystem and rebuilt by replaying the session's own history after a host restart.
- **Reveal in folder** — opens a file's folder in the host file manager with the file selected: macOS Finder, Windows Explorer, WSL, and desktop Linux, shell-free through the official native-command service.
- **Read-only by design** — no session state, no writes, no filesystem mutation; a restarted host loses nothing.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-file-preview
```

This package is the host half only; the visible surface (the Produced tab, the preview drawer, the per-turn change card) ships in the companion client — install the pair:

```sh
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview
```

Uninstall restores the previous composition exactly; if the client half stays installed, its surface degrades to an empty state rather than an error:

```sh
dsh plugin --profile web remove @khorsheed/dsh-file-preview
```

## Config

```yaml
- id: file-preview
  name: '@khorsheed/dsh-file-preview'
  config:
    maxReadBytes: 524288
    maxFiles: 500
    captureBashWrites: true
```

`maxReadBytes` caps a single `read` (larger files answer `too-large` without reading); `maxFiles` caps the `list` fold. Both must be positive integers; the defaults are 512 KiB and 500. `captureBashWrites` (default `true`) switches the bash-write collector on or off.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **List is a point-in-time fold** — the client refreshes by re-calling `list`; there is no push channel for new files.
- **No binary preview content** — non-image binary files answer `kind: 'binary'` with their size only; rendering their content inline is deferred.

## How it works

<details>
<summary>Internals (click to expand)</summary>

`ctx.filePreview` (wire namespace `filePreview`) exposes four generated Remote methods:

- `list(agent)` — a pure fold over `agent.session.events`: every `tool/call` for the `read`, `write`, or `edit` tool (all use the `file_path` argument key) contributes its display path, and a settled `tool/code-dispatch` for those tools (a nested Code Mode call) contributes likewise — failed dispatches record nothing, and the entry borrows the enclosing root call's turn/step since dispatch events carry none. A `tool/result` for `write`/`edit` whose presentation meta carries `diffs` appends each change to the entry's `diffs` in event order (each with its seq/turn/step), with `lastDiff` kept as the final change, all preserved across later reads. The response carries the entries, the last scanned seq, and whether the `maxFiles` cap was reached. No filesystem access in the fold itself; when `captureBashWrites` is on, entries are merged with the collector's verified bash-written paths.
- `read(agent, path, signal)` — resolves `path` against `agent.session.header.cwd` and serves the file's current content as `kind: 'text'` (capped and flagged `truncated` when it exceeds `maxReadBytes`), or `kind: 'image'` with a browser-loadable `url` when the path is an image and a web host is present, or a classified notice: `binary` (binary extension or NUL bytes in the decoded text), `missing` (no such file), `too-large` (backend-reported size above the cap), or `error` (resolve/stat/decode failure, message included). Binary extensions are never read. Image bytes ride a dedicated host route (`/file-preview-image/<sessionId>/<path>`, registered only when the optional `webServer` and `agents` services are composed) so the browser loads them natively without bloating the RPC channel; image reads answer `binary` on headless hosts.
- `reveal(agent, path, signal)` — resolves `path` against `agent.session.header.cwd` (through `ctx.fs`), then opens the file's folder in the host file manager with the file selected, shell-free through `@deepseek-ai/dsh-native-command`: macOS `open -R` (Finder), Windows `explorer /select,<path>` (Explorer), WSL translates the path with `wslpath` first, and desktop Linux tries the select-capable file managers (`nautilus` / `dolphin` / `nemo` `--select`) in order. Answers `{ revealed: true }` when the file manager selected the file; `{ revealed: false, reason: 'missing' }` when the recorded path does not resolve to an existing target, or `'select-failed'` when no file manager can select — the caller then opens the parent folder instead, so the gesture always lands somewhere visible. The native reveal only ever hands a path to the host OS; the service writes nothing.
- `turnFiles(agent)` — every turn's file mutations for the turn-tail card, the SAME single source of truth as `list` (write/edit calls, Code Mode dispatches borrowing the root call's turn, render-intent paths from result diff meta — which also register in `list` — and bash captures merged by their own turn). Unlike `list`, a path is NOT deduped to its last occurrence: a file touched in two turns appears in BOTH turn groups, so each card lists exactly what that turn mutated. Per-turn line deltas are summed from the result diffs (removed is unknown for creates/overwrites). The by-turn fold is cached per session and invalidated by the log watermark, so repeated card fetches do not refold; the response carries the watermark for the client's own cache.

Bash-write collector: when `captureBashWrites` is on, the service watches each session's `tool/call` (bash) + `tool/result` pairs, extracts high-precision write targets from the command (`cat > path` heredocs, single `>` redirects, `tee` non-append, `sed -i`), expands `$VAR`/`~`/relative paths against the host environment and session cwd, and only records a path the filesystem actually has as a file (`fs.stat`, prefer a miss over a false positive). Captures live in a per-session in-memory registry rebuilt by replaying the session's own history on `session/created`, so a restarted host regains them; the session log itself is never mutated (the official `Session.append` cannot mark a plugin event `ignorable`, and the persistence read path refuses unknown non-ignorable types — see the S2 seam in `docs/upstream-seam-registry.md`). Bash-captured files carry no diff history; their preview reads current content through `read` like any other entry.

Trust and state: the service is a trusted, read-only capability — it reads whatever `ctx.fs` allows for the session, so composing it grants preview access to the session's filesystem view; it is not a security boundary. It emits no session events; the only per-session state it keeps is the by-turn fold cache (watermark-invalidated) and the bash collector's verified-writes registry.

Sharing: this package is a pure host-side addition — it registers one Remote service (mounted by its browser half through the official `ctx.remote.$mount` channel) and writes nothing into other packages. The browser half (`@khorsheed/dsh-client-ui-file-preview`) is equally additive and depends on official extension points only. Both packages distribute independently and compose into a stock dsh core with zero edits.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/file-preview`). Issues and contributions welcome there.
