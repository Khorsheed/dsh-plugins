# @khorsheed/dsh-client-session-title-edit

English | [中文](README.zh.md)

Rename a session right in the dsh web GUI chat header: click the pencil next to the title, the title itself becomes an inline editor — Enter commits, Escape cancels, and a draft that would blow past the host's title-length budget is blocked with a localized warning instead of being silently truncated. No host half, no new RPC, no edits to official packages — and no model-visible effects whatsoever.

<img src="docs/screenshots/03-session-title-edit.png" width="480" alt="inline session title editor in the chat header">

## Features

- **Pencil in the header** — one `conversation.session.header.actions` entry immediately right of the session title swaps in an inline editor, prefilled with the current display title and fully selected.
- **Predictable keys** — Enter commits, Escape cancels, a trimmed-empty draft disables save, and a host rejection keeps the editor open with a localized error.
- **Auto-fitting input** — the box grows with the draft between the crumb's original width and the official 220px cap, so a long title widens the field instead of clipping.
- **Budget-aware, not silently truncated** — a draft exceeding the host's 80-UTF-8-byte title budget shows a localized warning and blocks saving.
- **Zero footprint** — rides the official `session.rename` RPC; the accepted user-sourced `session/title` event pins the title against automatic regeneration, and the title never enters the model context (no token or KV-cache effect).

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-client-session-title-edit
```

Then restart the web instance. Composing this plugin out of cordis.yml removes every surface it adds:

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-session-title-edit
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **In-place editing is a DOM-layer stopgap.** The official `ConversationSessionHeader` renders the title and exposes no title seat, so "the title becomes an input" is faked by hiding the official crumb and overlaying the plugin's input at the crumb's measured rect (viewport-fixed, re-measured on window resize). When the crumb cannot be located (the official DOM changed), the entry degrades to an inline editor in the actions row. TODO(session-title-edit): deprecate the overlay when the official header opens a title slot (or makes the crumb editable) — the entry then becomes a pure slot consumer.
- **No optimistic update.** The header title refreshes from the session-list projection when the host settles the rename; the control does not rewrite the crumb itself.
- **The title byte budget is host-owned, client-gated.** The client-side mirror (80 UTF-8 bytes by default in the base bundle) must track the host default — a host that raises the cap only widens what the editor permits once the constant follows. The official sidebar rename dialog still truncates silently.

## How it works

<details>
<summary>Internals (click to expand)</summary>

Pure browser-side plugin: the rename verb rides the official `session.rename` RPC (`session.rename` → `sessions.rename` → `ctx.sessionTitle.rename`), so the plugin needs no host half, no new RPC, and no edits to core packages. The `/client` exports are the plugin body (`apply`/`inject`) and the `TitleEditActionProps` type.

Editing is in place: clicking the pencil hides the official title crumb (a DOM-layer `data-ste-inplace` attribute) and overlays the plugin's own input at the crumb's measured rect, so the title itself reads as an editable field. The input's width is fitted to the draft — measured through a hidden mirror span at the input's font — between the crumb's original width and the crumb's 220px cap.

**Model experience:** nothing changes for the model. The title is a projection-only session property — it never enters the model context, and renaming appends only a `session/title` log event with a user source. Token effect: none. KV-cache effect: none. The header title flips when the host projection lands.

**Byte budget:** `@deepseek-ai/dsh-session-title` caps the accepted title (`maxTitleBytes`, production default 80 UTF-8 bytes); the editor mirrors the cap client-side (`MAX_TITLE_BYTES` in `src/client/title-length.ts`) along with the host's pre-cap normalization (escape/control/directional sequences stripped, whitespace collapsed, trimmed), so gating fires exactly when the host would truncate.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/session-title-edit`). Issues and contributions welcome there.
