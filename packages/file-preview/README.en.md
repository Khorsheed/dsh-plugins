# @khorsheed/dsh-file-preview

English | [中文](README.md)

Host service for dsh's file-preview surface: lists every file a session's tool calls touched — each write/edit change's diff included — and serves any file's current content for preview. Pair it with `@khorsheed/dsh-client-ui-file-preview` and the web GUI gains a Produced-files tab with inline previews and reveal-in-folder.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview1.png" width="480" alt="the companion client's file-preview pane: file list and inline markdown preview">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview2.png" width="480" alt="per-artifact change history: pageable per-turn diffs">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview3.png" width="480" alt="the Produced tab: every file the session wrote, at a glance">

## Features

- **Session file list** — every file the session's `read`/`write`/`edit` calls touched, with each write/edit change's diff attached.
- **Content reads** — current text, capped and flagged when truncated; images as browser-loadable URLs on web hosts; binary, missing, and oversized files answer classified notices.
- **Bash-write capture** — files written through `bash` (heredocs, redirects, `tee`, `sed -i`) merged into the list, stat-verified and rebuilt after a host restart.
- **Reveal in folder** — opens the file's folder with the file selected, on macOS, Windows, WSL, and desktop Linux.
- **Read-only by design** — no session state, no writes; a restarted host loses nothing.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-file-preview
```

Host half only — install the companion client for the visible surface (Produced tab, preview drawer, per-turn change card):

```sh
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview
```

Uninstall; a leftover client half degrades to an empty state rather than an error:

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

`maxReadBytes` caps a single `read` (larger files answer `too-large`), `maxFiles` caps the `list` fold — both positive integers, defaults 512 KiB and 500 — and `captureBashWrites` (default `true`) toggles the bash-write collector.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **List is a point-in-time fold** — no push channel; the client refreshes by re-calling `list`.
- **No binary preview content** — non-image binaries answer `kind: 'binary'` with their size only.

## How it works

<details>
<summary>Internals (click to expand)</summary>

`ctx.filePreview` (wire namespace `filePreview`) exposes four generated Remote methods:

- `list(agent)` — a pure fold over `agent.session.events`: `read`/`write`/`edit` `tool/call`s contribute display paths, as do settled nested Code Mode `tool/code-dispatch`es for those tools (failed dispatches record nothing; entries borrow the root call's turn/step). A `write`/`edit` `tool/result` carrying `diffs` meta appends each change to the entry in event order, `lastDiff` kept as the final one. The response carries the entries, the last scanned seq, and whether `maxFiles` was hit. No filesystem access in the fold; with `captureBashWrites` on, entries merge with the collector's verified bash-written paths.
- `read(agent, path, signal)` — resolves `path` against the session cwd and serves `kind: 'text'` (capped at `maxReadBytes`, flagged `truncated`), or `kind: 'image'` with a browser-loadable URL on web hosts — bytes ride a dedicated `/file-preview-image/<sessionId>/<path>` route, registered only when the optional `webServer` and `agents` services are composed; headless hosts answer `binary` — or a classified notice: `binary` (binary extension or NUL bytes; never read), `missing`, `too-large`, or `error` (message included).
- `reveal(agent, path, signal)` — opens the file's folder with the file selected, shell-free through `@deepseek-ai/dsh-native-command`: macOS `open -R`, Windows `explorer /select,<path>`, WSL via `wslpath`, desktop Linux tries `nautilus`/`dolphin`/`nemo --select` in order. Answers `{ revealed: true }`, or `false` with `reason: 'missing'` (no such target) or `'select-failed'` (no capable file manager — the caller then opens the parent folder, so the gesture always lands somewhere visible). Writes nothing.
- `turnFiles(agent)` — every turn's file mutations for the turn-tail card, the same single source of truth as `list` but NOT deduped: a file touched in two turns appears in both groups, so each card lists exactly what that turn mutated. Line deltas are summed from result diffs; the fold is cached per session and invalidated by the log watermark, which the response carries for the client's own cache.

Bash-write collector: watches each session's bash `tool/call`/`tool/result` pairs, extracts high-precision write targets (`cat > path` heredocs, single `>` redirects, `tee` non-append, `sed -i`), expands `$VAR`/`~`/relative paths against the host environment and session cwd, and records only paths `fs.stat` confirms as files (a miss beats a false positive). Captures live in a per-session in-memory registry rebuilt by replaying the session's own history on `session/created`, so a restarted host regains them; the session log itself is never mutated (the official `Session.append` cannot mark a plugin event `ignorable` — see the S2 seam in `docs/upstream-seam-registry.md`). Bash-captured files carry no diff history; previews read current content through `read`.

Trust and state: a trusted, read-only capability — it reads whatever `ctx.fs` allows for the session, so composing it grants preview access to the session's filesystem view; it is not a security boundary. It emits no session events; its only per-session state is the turn-fold cache and the bash collector's verified-writes registry.

Sharing: a pure host-side addition — one Remote service, mounted by the browser half through the official `ctx.remote.$mount` channel. The browser half (`@khorsheed/dsh-client-ui-file-preview`) is equally additive; both distribute independently and compose into a stock dsh core with zero edits.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/file-preview`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
