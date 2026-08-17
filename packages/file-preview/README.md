# @deepseek-ai/dsh-file-preview

English | [中文](README.zh.md)

Read-only file-preview Remote service for web surfaces: `list` folds one session's log into the files its `read`/`write`/`edit` tool calls touched — nested Code Mode dispatches (`tool/code-dispatch` events for those tools) included, borrowing the enclosing root call's turn/step — with every write/edit change's diff, and `read` serves the current text content of one of those files through `ctx.fs` — or a browser URL for images — resolved against the session cwd and capped by config. The service owns no session state and writes nothing — the session log and the filesystem stay authoritative.

## Config

```yaml
- id: file-preview
  name: '@deepseek-ai/dsh-file-preview'
  config:
    maxReadBytes: 524288
    maxFiles: 500
```

`maxReadBytes` caps a single `read` (larger files answer `too-large` without reading); `maxFiles` caps the `list` fold. Both must be positive integers; the defaults are 512 KiB and 500.

## Service contract

`ctx.filePreview` (wire namespace `filePreview`) exposes two generated Remote methods:

- `list(agent)` — a pure fold over `agent.session.events`: every `tool/call` for the `read`, `write`, or `edit` tool (all use the `file_path` argument key) contributes its display path, and a settled `tool/code-dispatch` for those tools (a nested Code Mode call) contributes likewise — failed dispatches record nothing, and the entry borrows the enclosing root call's turn/step since dispatch events carry none. Repeated paths refresh their op and location in place, keeping first-seen order. A `tool/result` for `write`/`edit` whose presentation meta carries `diffs` appends each change to the entry's `diffs` in event order (each with its seq/turn/step), with `lastDiff` kept as the final change, all preserved across later reads. The response carries the entries, the last scanned seq, and whether the `maxFiles` cap was reached. No filesystem access.
- `read(agent, path, signal)` — resolves `path` against `agent.session.header.cwd` and serves the file's current content as `kind: 'text'` (capped and flagged `truncated` when it exceeds `maxReadBytes`), or `kind: 'image'` with a browser-loadable `url` when the path is an image and a web host is present, or a classified notice: `binary` (binary extension or NUL bytes in the decoded text), `missing` (no such file), `too-large` (backend-reported size above the cap), or `error` (resolve/stat/decode failure, message included). Binary extensions are never read. Image bytes ride a dedicated host route (`/file-preview-image/<sessionId>/<path>`, registered only when the optional `webServer` and `agents` services are composed) so the browser loads them natively without bloating the RPC channel; image reads answer `binary` on headless hosts.

The service is a trusted, read-only capability: it reads whatever `ctx.fs` allows for the session, so composing it grants preview access to the session's filesystem view — it is not a security boundary. It emits no session events and keeps no per-session cache.

## Sharing

This package is a pure host-side addition: it registers one Remote service (mounted by its browser half through the official `ctx.remote.$mount` channel) and writes nothing into other packages. The browser half (`@deepseek-ai/dsh-client-ui-file-preview`) is equally additive and depends on official extension points only. Both packages distribute independently and compose into a stock dsh core with zero edits.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.7`): ✅ full — the runtime touches only the official public stable surface (slots, core services, core events, cordis 4.x, schemastery).
- source line (deepseek-harness master): ✅

## Known Limitations and Deferred Work

- **List is a point-in-time fold** — the client refreshes by re-calling `list`; there is no push channel for new files.
- **No binary preview content** — non-image binary files answer `kind: 'binary'` with their size only; rendering their content inline is deferred.
