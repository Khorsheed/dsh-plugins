# @khorsheed/dsh-ui-shortcuts

English | [中文](README.md)

Keyboard shortcuts for the dsh web GUI: `Esc` pauses the running turn, `Ctrl/Cmd+S` steer-sends the draft, `Ctrl/Cmd+O` starts a new session — every key rebindable in Settings.

<img src="../../docs/screenshots/07-ui-shortcuts.png" width="480" alt="keyboard shortcuts card in Settings">

## Features

- **Pause the turn** (`Esc`) — the composer's Stop button, from anywhere on the page.
- **Steer-send the draft** (`Ctrl/Cmd+S`) — queue-jump delivery of the current draft; the browser save gesture is suppressed.
- **New session** (`Ctrl/Cmd+O`) — the sidebar's New-session entry; the browser open-file gesture is suppressed.
- **Rebindable keys** — click a binding in Settings → Plugins → Keyboard shortcuts to record, unbind, or reset; persists in `$DSH_HOME/settings.yaml`.

## Install

Not part of the default web bundle; one command installs and mounts it (self-mounting via `dsh.bundle`):

```sh
dsh plugin --profile web add @khorsheed/dsh-ui-shortcuts      # install
dsh plugin --profile web remove @khorsheed/dsh-ui-shortcuts   # uninstall
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **No user-defined actions** — actions come from plugins via `ctx.shortcuts`; arbitrary command lines or toggles are not offered.
- **Ctrl/Cmd+S is draft-only** — an empty draft is a no-op; whole-queue steering stays on the composer's `Cmd/Ctrl+Enter` gesture.

## How it works

<details>
<summary>Internals (click to expand)</summary>

- `src/index.ts` (node half) — registers the `ui-shortcuts` settings namespace.
- `src/client/` (browser half, `/plugins/ui-shortcuts/client.js`) — wires the keys and the shortcuts card in Settings → Plugins.

The row id `ui-shortcuts` is shared with the official `@deepseek-ai/dsh-client-ui-shortcuts` bundle — compose at most one per profile (duplicate loader ids fail loud at boot); the default web image mounts neither, so the install above is the normal path.

Actions go through public services, never ui-conversation internals:

| Action | Behavior |
| --- | --- |
| 暂停当前任务 (Pause current task) | `conversation.cancel()` — the same operation as the composer's Stop button. One-shot subagents do not stop, mirroring Stop's visibility. |
| 插队发送 (Send with priority) | `conversation.input.for(scope).submit('steer')` on the current draft; an empty draft is a silent no-op. |
| 新建会话 (New session) | `workspaces.startSession()` — the sidebar's New-session entry; global, focus-independent. |

Rebinding: click a binding to record the next chord (`Esc` cancels, `Delete`/`Backspace` unbinds, `Ctrl/Cmd` counts as one `primary` modifier on every platform), or reset to the shipped default. Preferences persist in `$DSH_HOME/settings.yaml` under the `ui-shortcuts` section.

**Escape layering**: Escape pause is global but yields to whatever owns the key first: a consumed keydown (`defaultPrevented` — the composer's slash menu, popupSelect), an open overlay (modals, menus, the settings panel), or a non-composer editable (inline rename, search fields). Everywhere else — composer textarea, sidebar, session list — Escape pauses the running turn. IME composition and held-repeat keys never trigger any action.

**For plugin authors** — contribute actions through the `ctx.shortcuts` registry:

```ts
ctx.effect(() => ctx.shortcuts.registerAction({
  id: 'my-plugin.myAction',          // unique id, <plugin>.<action> by convention
  label: { ns: 'my-plugin', key: 'action.myAction' },
  description: { ns: 'my-plugin', key: 'action.myAction.desc' },
  defaultBinding: { kind: 'key', modifiers: ['primary', 'shift'], key: 'o' },
  layering: 'global',                // 'global': capture-phase, browser default suppressed
                                     // 'yield': bubble-phase, yields to consumed keys / open overlays / editables
  available: () => true,             // optional dispatch-time gate
  run: () => { /* ... */ },
}), 'my-plugin: shortcut')
```

Locale entries stay in the contributing plugin's own namespace. Duplicate ids fail loud; on a shared chord the first registration wins. Users rebind or unbind any action in Settings → Plugins → Keyboard shortcuts. No model requests, no KV-cache effect — the actions call the same public verbs the composer's own controls use.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/ui-shortcuts`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
