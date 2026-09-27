# @khorsheed/dsh-file-preview

English | [中文](README.md)

Every file the agent touched, on one page: what changed, and what it looks like now.

This package is the host half of file preview. Install it together with the companion client, and the web GUI gains a Produced-files tab: every file the session read, wrote, or edited is listed there, each write/edit change comes with its diff, and clicking any file shows its current content. Files the agent happened to write through bash (heredocs, redirects, and the like) are collected too. The whole service is read-only — it looks at files, never touches them.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview1.png" width="640" alt="the Produced tab's file preview: file list and inline markdown preview">

## Features

- **Session file list** — every file the session's `read`/`write`/`edit` calls touched, with each write/edit change's diff attached.
- **Content reads** — current text, capped and flagged when truncated; images as browser-loadable URLs on web hosts; binary, missing, and oversized files answer classified notices instead of errors.
- **Bash-write capture** — files written through `bash` (heredocs, redirects, `tee`, `sed -i`) merged into the list, stat-verified and rebuilt after a host restart.
- **Reveal in folder** — opens the file's folder with the file selected, on macOS, Windows, WSL, and desktop Linux.
- **Read-only by design** — no session state, no writes; a restarted host loses nothing.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview2.png" width="640" alt="per-artifact change history: pageable per-turn diffs">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview3.png" width="640" alt="the Produced tab: every file the session wrote, at a glance">

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-file-preview
```

Host half only — the visible surface (Produced tab, preview drawer, per-turn change card) lives in the companion client:

```sh
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview
```

Uninstall; if the client half is left behind, its zero-session handshake fails and every UI surface is absent (no error card or empty tab remains):

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

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — adapted to the 0.1.5-rc.1 PTC rename (only `tool/ptc-dispatch` is matched; the official v2→v3 log migration renames persisted rows), full build+test green; minHost moves up to 0.1.5-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)

**Version line mapping**: the first release after 0.2.0 supports host `0.1.5-rc.1` and later; hosts on `0.1.2-rc.1` stay on `0.2.0`, hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.1`).

## Known Limitations

- **List is a point-in-time fold** — no push channel; the client refreshes by re-calling `list`.
- **No binary preview content** — non-image binaries answer `kind: 'binary'` with their size only.

## How it works

<details>
<summary>Internals (click to expand)</summary>

`ctx.filePreview` (wire namespace `filePreview`) exposes six generated Remote methods:

- `capabilities()` — a zero-session availability handshake returning `{ protocolVersion: 1 }`; the companion client installs UI surfaces only after it succeeds.

- `list(agent)` — a pure fold over `agent.session.events`: `read`/`write`/`edit` `tool/call`s contribute display paths, as do settled nested PTC `tool/ptc-dispatch`es for those tools (failed dispatches record nothing; entries borrow the root call's turn/step). A `write`/`edit` `tool/result` carrying `diffs` meta appends each change to the entry in event order, `lastDiff` kept as the final one. The response carries the entries, the last scanned seq, and whether `maxFiles` was hit. No filesystem access in the fold; with `captureBashWrites` on, entries merge with the collector's verified bash-written paths. Before returning, each path is resolved against the session cwd and `stat`-ed, keeping only those that still exist as a regular file — the log fold is history, the product list reflects disk state (a temp script a turn wrote then cleaned up is no longer a product); existence is probed fresh per call (not cached with the log fold).
- `read(agent, path, signal)` — resolves `path` against the session cwd and serves `kind: 'text'` (capped at `maxReadBytes`, flagged `truncated`), or `kind: 'image'` with a browser-loadable URL on web hosts — bytes ride a dedicated `/file-preview-image/<sessionId>/<path>` route, registered only when the optional `webServer` and `agents` services are composed; headless hosts answer `binary` — or a classified notice: `binary` (binary extension or NUL bytes; never read), `missing`, `too-large`, or `error` (message included).
- `reveal(agent, path, signal)` — opens the file's folder with the file selected, shell-free through `@deepseek-ai/dsh-native-command`: macOS `open -R`, Windows `explorer /select,<path>`, WSL via `wslpath`, desktop Linux tries `nautilus`/`dolphin`/`nemo --select` in order. Answers `{ revealed: true }`, or `false` with `reason: 'missing'` (no such target) or `'select-failed'` (no capable file manager — the caller then opens the parent folder, so the gesture always lands somewhere visible). Writes nothing.
- `openExternal(agent, path, app, signal)` — open a file in a specific host application (the "open in IDE" gesture): the official open-in-app route accepts directories only, so file-exact opens go here — macOS `open -a <App> <path>`, shell-free as well. `app` is an official open-in-app catalog id (the client probes `/open-in-app/apps`); the id → `.app` name map lives in `open-external.ts` (mirroring the official catalog's darwin entries). Non-macOS hosts and unknown ids answer `{ opened: false, reason }`, and the client hides the gesture. Writes nothing.
- `turnFiles(agent)` — every turn's file mutations for the turn-tail card, the same single source of truth as `list` but NOT deduped: a file touched in two turns appears in both groups, so each card lists exactly what that turn mutated. Line deltas are summed from result diffs; the fold is cached per session and invalidated by the log watermark, which the response carries for the client's own cache. Like `list`, it probes existence against the session cwd before returning and keeps only files that still exist (a cleaned-up temp script does not occupy a card).

Bash-write collector: watches each session's bash `tool/call`/`tool/result` pairs, extracts high-precision write targets (`cat > path` heredocs, single `>` redirects, `tee` non-append, `sed -i`), expands `$VAR`/`~`/relative paths against the host environment and session cwd, and records only paths `fs.stat` confirms as files (a miss beats a false positive). Captures live in a per-session in-memory registry rebuilt by replaying the session's own history on `session/created`, so a restarted host regains them; the session log itself is never mutated (the official `Session.append` cannot mark a plugin event `ignorable` — see the S2 seam in `docs/upstream-seam-registry.md`). Bash-captured files carry no diff history; previews read current content through `read`.

Trust and state: a trusted, read-only capability — it reads whatever `ctx.fs` allows for the session, so composing it grants preview access to the session's filesystem view; it is not a security boundary. It emits no session events; its only per-session state is the turn-fold cache and the bash collector's verified-writes registry.

Sharing: a pure host-side addition — one Remote service, mounted by the browser half through the official `ctx.remote.$mount` channel. The browser half (`@khorsheed/dsh-client-ui-file-preview`) is equally additive; both distribute independently and compose into a stock dsh core with zero edits.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/file-preview`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
