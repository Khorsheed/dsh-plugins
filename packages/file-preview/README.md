# @khorsheed/dsh-file-preview

English | [中文](README.zh.md)

Read-only file-preview Remote service for web surfaces: `list` folds one session's log into the files its `read`/`write`/`edit` tool calls touched — nested Code Mode dispatches (`tool/code-dispatch` events for those tools) included, borrowing the enclosing root call's turn/step — with every write/edit change's diff, and merges in files the session's `bash` calls wrote (heredocs, `>` redirects, `tee`, `sed -i`) that a host-side collector stat-verifies after each call settles; `read` serves the current text content of one of those files through `ctx.fs` — or a browser URL for images — resolved against the session cwd and capped by config, and `reveal` opens one of those files' folder in the host file manager with the file selected (the "show in folder" gesture). The service owns no session state and writes nothing — the session log and the filesystem stay authoritative.

## Config

```yaml
- id: file-preview
  name: '@khorsheed/dsh-file-preview'
  config:
    maxReadBytes: 524288
    maxFiles: 500
    captureBashWrites: true
```

`maxReadBytes` caps a single `read` (larger files answer `too-large` without reading); `maxFiles` caps the `list` fold. Both must be positive integers; the defaults are 512 KiB and 500. `captureBashWrites` (default `true`) switches the bash-write collector on or off: when on, the service watches each session's `tool/call` (bash) + `tool/result` pairs, extracts high-precision write targets from the command (`cat > path` heredocs, single `>` redirects, `tee` non-append, `sed -i`), expands `$VAR`/`~`/relative paths against the host environment and session cwd, and only records a path the filesystem actually has as a file (`fs.stat`, prefer a miss over a false positive). Captures live in a per-session in-memory registry rebuilt by replaying the session's own history on `session/created`, so a restarted host regains them; the session log itself is never mutated (the official `Session.append` cannot mark a plugin event `ignorable`, and the persistence read path refuses unknown non-ignorable types — see the S2 seam in `docs/upstream-seam-registry.md`). Bash-captured files carry no diff history; their preview reads current content through `read` like any other entry.

## Service contract

`ctx.filePreview` (wire namespace `filePreview`) exposes three generated Remote methods:

- `list(agent)` — a pure fold over `agent.session.events`: every `tool/call` for the `read`, `write`, or `edit` tool (all use the `file_path` argument key) contributes its display path, and a settled `tool/code-dispatch` for those tools (a nested Code Mode call) contributes likewise — failed dispatches record nothing, and the entry borrows the enclosing root call's turn/step since dispatch events carry none. Repeated paths refresh their op and location in place, keeping first-seen order. A `tool/result` for `write`/`edit` whose presentation meta carries `diffs` appends each change to the entry's `diffs` in event order (each with its seq/turn/step), with `lastDiff` kept as the final change, all preserved across later reads. The response carries the entries, the last scanned seq, and whether the `maxFiles` cap was reached. No filesystem access in the fold itself; when `captureBashWrites` is on, entries are merged with the collector's verified bash-written paths (see Config).
- `read(agent, path, signal)` — resolves `path` against `agent.session.header.cwd` and serves the file's current content as `kind: 'text'` (capped and flagged `truncated` when it exceeds `maxReadBytes`), or `kind: 'image'` with a browser-loadable `url` when the path is an image and a web host is present, or a classified notice: `binary` (binary extension or NUL bytes in the decoded text), `missing` (no such file), `too-large` (backend-reported size above the cap), or `error` (resolve/stat/decode failure, message included). Binary extensions are never read. Image bytes ride a dedicated host route (`/file-preview-image/<sessionId>/<path>`, registered only when the optional `webServer` and `agents` services are composed) so the browser loads them natively without bloating the RPC channel; image reads answer `binary` on headless hosts.
- `reveal(agent, path, signal)` — resolves `path` against `agent.session.header.cwd` (through `ctx.fs`), then opens the file's folder in the host file manager with the file selected, shell-free through `@deepseek-ai/dsh-native-command`: macOS `open -R` (Finder), Windows `explorer /select,<path>` (Explorer), WSL translates the path with `wslpath` first, and desktop Linux tries the select-capable file managers (`nautilus` / `dolphin` / `nemo` `--select`) in order. Answers `{ revealed: true }` when the file manager selected the file; `{ revealed: false, reason: 'missing' }` when the recorded path does not resolve to an existing target, or `'select-failed'` when no file manager can select — the caller then opens the parent folder instead, so the gesture always lands somewhere visible. The native reveal only ever hands a path to the host OS; the service writes nothing.

The service is a trusted, read-only capability: it reads whatever `ctx.fs` allows for the session, so composing it grants preview access to the session's filesystem view — it is not a security boundary. It emits no session events and keeps no per-session cache.

## Sharing

This package is a pure host-side addition: it registers one Remote service (mounted by its browser half through the official `ctx.remote.$mount` channel) and writes nothing into other packages. The browser half (`@khorsheed/dsh-client-ui-file-preview`) is equally additive and depends on official extension points only. Both packages distribute independently and compose into a stock dsh core with zero edits.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.7`): ✅ full — the runtime touches only the official public stable surface (slots, core services, core events, cordis 4.x, schemastery).
- source line (deepseek-harness master): ✅

## Known Limitations and Deferred Work

- **List is a point-in-time fold** — the client refreshes by re-calling `list`; there is no push channel for new files.
- **No binary preview content** — non-image binary files answer `kind: 'binary'` with their size only; rendering their content inline is deferred.
