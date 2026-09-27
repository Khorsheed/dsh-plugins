# dsh-client-session-title-edit

English | [中文](README.md)

Rename a session whenever you like: click the little pencil by the title, hit Enter, done.

Auto-generated session titles are often off the mark, and finding a session again two days later is pure luck. This plugin puts a pencil next to the title in the chat header: one click and the title becomes an input in place, prefilled and fully selected. Enter saves, Escape cancels, and a draft that's too long gets a warning instead of silent truncation. Renames go through the official `session.rename` RPC, and the title never enters the model context — the model knows nothing about it.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/session-title-edit1.png" width="640" alt="the pencil button beside the title in the chat header, with a rename-session tooltip on hover">

## Features

- **Pencil in the header** — an entry right of the session title swaps in an inline editor, prefilled and fully selected.
- **Predictable keys** — Enter commits, Escape cancels, empty drafts disable save, host rejections show inline.
- **Auto-fitting input** — the field widens with the draft up to the official 220px cap.
- **Budget-aware** — drafts past the host's 80-UTF-8-byte title budget are blocked with a warning, never silently truncated.
- **Zero footprint** — rides the official `session.rename` RPC; the title never enters model context (no token or KV-cache effect).

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/session-title-edit2.png" width="640" alt="after clicking the pencil the title becomes an input in place — edit and press Enter to save">

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-client-session-title-edit
```

Restart the web instance after install; uninstall removes every surface the plugin adds.

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-session-title-edit
```

## Compatibility

- npm release line (host `0.1.7-rc.2`, next release `0.2.4`): ✅ full — the rename rides the official `session.rename`, and **in-place editing works on both the 0.1.5 and 0.1.7 host lines** (one text-based probe covers the 0.1.5/0.1.6 disabled crumb button and the plain-text crumb that replaced it in 0.1.7-alpha.1), proven by the dual-line suite and on both host lines in a live instance; the minHost floor stays at `0.1.2-rc.1`.
- Published `0.2.3` and earlier: on hosts from 0.1.7-alpha.1 the current crumb is no longer a disabled button, so in-place editing falls back to the inline editor in the actions row (**renaming itself keeps working**, it just no longer overlays the title); `0.2.4` restores it.
- source line (deepseek-harness master, `0.1.7-rc.2`): ✅ (verifiedHost: `0.1.7-rc.2`)

**Version line mapping**: 0.2.0 and up support host `0.1.2-rc.1` and later; hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.0`).

## Known Limitations

- **In-place editing is a DOM-layer stopgap** — the official header still exposes no title seat, so the editor hides the official title node (`data-ste-inplace`) and overlays its input at that node's measured rect. The node is located by the title text (the leaf whose text equals `displayTitle` inside the crumbs nav's last segment), which is what makes one code path serve both host lines: the current crumb is a disabled button up to 0.1.6 and plain `span.crumbCurrent` text from 0.1.7-alpha.1 (upstream `92101e1a5b`, so the title joins the window drag band). When the title is not projected yet, or the official DOM moves again, it degrades to the inline editor in the actions row (renaming is unaffected).
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

Editing is in place: clicking the pencil hides the official title node (`data-ste-inplace`) and overlays the plugin's input at that node's measured rect. The node is located by the current title text (the leaf whose text equals `displayTitle` inside the crumbs nav's last segment), so the 0.1.5/0.1.6 disabled crumb button and the 0.1.7-alpha.1 `span.crumbCurrent` share one path; ancestor crumbs and the official lineage slot's content are never hidden by mistake. The input width is fitted to the draft via a hidden mirror span at the input's font, between the title node's original width and the official crumb's 220px cap.

Nothing changes for the model: the title is a projection-only property, never in model context, and renaming appends only a user-sourced `session/title` event — no token or KV-cache effect. The header title flips when the host projection lands. Separately, `@deepseek-ai/dsh-session-title` caps accepted titles (`maxTitleBytes`, production default 80 UTF-8 bytes); the editor mirrors that cap plus the host's pre-cap normalization (escape/control/directional stripping, whitespace collapsing, trimming), so gating fires exactly when the host would truncate.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/session-title-edit`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
