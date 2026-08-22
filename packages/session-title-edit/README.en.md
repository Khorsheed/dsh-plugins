# @khorsheed/dsh-client-session-title-edit

English | [中文](README.md)

Rename a session right in the dsh web GUI chat header: click the pencil next to the title and the title itself becomes an inline editor. Enter commits, Escape cancels, over-long drafts are blocked with a localized warning — and the model never sees any of it.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/session-title-edit1.png" width="480" alt="inline session title editor in the chat header">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/session-title-edit2.png" width="480" alt="click the pencil and the title becomes an input — Enter saves">

## Features

- **Pencil in the header** — an entry right of the session title swaps in an inline editor, prefilled and fully selected.
- **Predictable keys** — Enter commits, Escape cancels, empty drafts disable save, host rejections show inline.
- **Auto-fitting input** — the field widens with the draft up to the official 220px cap.
- **Budget-aware** — drafts past the host's 80-UTF-8-byte title budget are blocked with a warning, never silently truncated.
- **Zero footprint** — rides the official `session.rename` RPC; the title never enters model context (no token or KV-cache effect).

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-client-session-title-edit
```

Restart the web instance after install; uninstall removes every surface the plugin adds.

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-session-title-edit
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **In-place editing is a DOM-layer stopgap** — the official header exposes no title seat, so the editor overlays the hidden title crumb; if the official DOM changes, it degrades to an inline editor in the actions row.
- **No optimistic update** — the header title refreshes only when the host projection settles the rename.
- **Byte budget is host-owned, client-gated** — the client mirrors the host's 80-byte cap; a host that raises it widens the editor only once the constant follows.

## How it works

<details>
<summary>Internals (click to expand)</summary>

```
src/index.ts            exports (apply/inject + TitleEditActionProps)
src/client/index.ts     plugin body; contributes the header-actions entry
src/client/TitleEditAction.tsx  pencil entry, inline editor, overlay + width fitting
src/client/title-length.ts      MAX_TITLE_BYTES mirror + host normalization
src/client/locales.ts   localized warnings/errors
src/client/slots.ts     slot declaration
```

Pure browser-side plugin: the rename rides the official `session.rename` RPC (`session.rename` → `sessions.rename` → `ctx.sessionTitle.rename`), so it needs no host half, no new RPC, and no edits to core packages.

Editing is in place: clicking the pencil hides the official title crumb (`data-ste-inplace`) and overlays the plugin's input at the crumb's measured rect. The input width is fitted to the draft via a hidden mirror span at the input's font, between the crumb's original width and its 220px cap.

Nothing changes for the model: the title is a projection-only property, never in model context, and renaming appends only a user-sourced `session/title` event — no token or KV-cache effect. The header title flips when the host projection lands. Separately, `@deepseek-ai/dsh-session-title` caps accepted titles (`maxTitleBytes`, production default 80 UTF-8 bytes); the editor mirrors that cap plus the host's pre-cap normalization (escape/control/directional stripping, whitespace collapsing, trimming), so gating fires exactly when the host would truncate.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/session-title-edit`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
