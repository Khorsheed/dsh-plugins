# @khorsheed/dsh-ui-shortcuts

English | [中文](README.zh.md)

Keyboard shortcuts for the dsh web GUI: `Esc` pauses the running turn, `Ctrl/Cmd+S` steer-sends the current draft, `Ctrl/Cmd+O` starts a new session — every key rebindable in Settings, every action going through the same public operations as the composer's own buttons. Nothing here touches a model request; install it and the page simply answers the keyboard.

<img src="docs/screenshots/07-ui-shortcuts.png" width="480" alt="keyboard shortcuts card in Settings">

## Features

- **Pause the running turn** (`Esc`) — the same cancel as the composer's Stop button, available anywhere on the page.
- **Steer-send the draft** (`Ctrl/Cmd+S`) — sends the current draft with queue-jump (steer) delivery; the browser save gesture is suppressed while bound.
- **New session** (`Ctrl/Cmd+O`) — the same entry as the sidebar New-session button; the browser open-file gesture is suppressed while bound.
- **Rebindable keys** — click a binding in Settings → Plugins → Keyboard shortcuts to record a new chord, unbind it, or reset to the shipped default; preferences persist in `$DSH_HOME/settings.yaml`.
- **A shortcuts registry for other plugins** — any plugin can contribute its own keyboard actions through `ctx.shortcuts` and gets the Settings row, rebinding, persistence, and conflict-free dispatch for free.

## Install

The plugin is **not** part of the default web bundle; add it to a profile to install it. The package declares `dsh.bundle`, so one command installs it and mounts its loader row (no hand-edited `cordis.patch.yml`):

```sh
dsh plugin --profile web add @khorsheed/dsh-ui-shortcuts
```

**Warning**: this package shares the loader entry id `ui-shortcuts` with the official `@deepseek-ai/dsh-client-ui-shortcuts`. Mounting both in one profile fails loud at boot on the duplicate entry id — keep exactly one.

Uninstall = remove the row (or set `disabled: true` on it):

```sh
dsh plugin --profile web remove @khorsheed/dsh-ui-shortcuts
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **No user-defined actions** — plugins contribute actions through `ctx.shortcuts`; arbitrary user-defined actions (command lines, toggles) are not offered.
- **Ctrl/Cmd+S is draft-only** — an empty draft does nothing; the plugin deliberately leaves whole-queue steering to the composer's `Cmd/Ctrl+Enter` gesture.
- **No in-repo e2e** — the plugin is not in the default bundle, so it has no `apps/web` replay scenario; its wiring is covered by the apply-level browser spec against fakes.

## How it works

<details>
<summary>Internals (click to expand)</summary>

The loader row's node half registers the `ui-shortcuts` settings namespace; its browser half (served at `/plugins/ui-shortcuts/client.js`) wires the keys and the keyboard-shortcuts card in the plugin configuration tab (Settings → Plugins). Disabling through the plugin inventory is a deployment concern, not this package's.

Action behavior, all through public services — the plugin never reaches into ui-conversation internals:

| Action | Behavior |
| --- | --- |
| 暂停当前任务 (Pause current task) | Cancels the current session's running turn through the public `conversation.cancel()` — the same operation as the composer's Stop button. Ordinary sessions and continuable subagents stop; one-shot subagents do not (mirroring the Stop button's visibility). |
| 插队发送 (Send with priority) | Sends the current draft with `steer` delivery through the public `conversation.input.for(scope).submit('steer')` facade. Draft-only: an empty draft is a silent no-op (steering the whole queue stays `Cmd/Ctrl+Enter`'s gesture). |
| 新建会话 (New session) | Starts a new session through the public `workspaces.startSession()` — the same entry as the sidebar New-session button. A global action, independent of focus. |

Rebinding: click a binding to record the next chord (`Esc` cancels, `Delete`/`Backspace` unbinds, `Ctrl/Cmd` counts as one `primary` modifier on every platform), or reset to the shipped default. Preferences persist in `$DSH_HOME/settings.yaml` under the `ui-shortcuts` section.

**Escape layering**: Escape pause is global and yields to whatever owns the key first: a consumed keydown (`defaultPrevented` — the composer's slash menu, popupSelect), an open overlay (modals, menus, and the settings panel close on Escape without `preventDefault`, and their DOM is still present during dispatch), or a non-composer editable target (inline rename, search fields). Everywhere else — the composer textarea, the sidebar, the session list — Escape pauses the running turn. IME composition and held-repeat keys never trigger any action.

**For plugin authors**: contribute actions through the `ctx.shortcuts` registry:

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

The contribution's locale entries stay in the contributing plugin's own namespace. Duplicate ids fail loud; when several actions share one chord, the first registration wins. Users rebind or unbind any action in Settings → Plugins → Keyboard shortcuts; preferences persist under the `ui-shortcuts` section keyed by action id.

**Model experience**: none. The actions call existing public verbs (`conversation.cancel`, `conversation.input.submit`) that the composer's own controls already use; nothing here reaches a model request. KV cache effect: none; this package neither assembles nor sends a provider request.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/ui-shortcuts`). Issues and contributions welcome there.
