# dsh-ui-shortcuts

English | [中文](README.md)

Esc to stop, Cmd+S to steer-send your draft, Cmd+O for a new session — every key rebindable.

Want to halt a runaway turn? No hunting for the tiny stop button — Esc does it. A finished draft that shouldn't wait in line goes out with Cmd/Ctrl+S; Cmd/Ctrl+O starts a new session from anywhere. Don't like the defaults? Click a binding in Settings → Plugins → Keyboard shortcuts and record your own. These shortcuts call the same actions the on-screen buttons do — they never send anything extra to the model.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/07-ui-shortcuts.png" width="640" alt="the keyboard-shortcuts card in Settings: pause the current task (Esc), send with priority (Ctrl/Cmd+S), new session (Ctrl/Cmd+O) — click a binding to re-record it">

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

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ full — baseline moved to the 0.1.2-rc.1 API surface (single-arm 0.1.2 API consumption; the 0.1.1-rc.2 runtime arm is retired), full build+test green; minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.2-rc.1)

**Version line mapping**: 0.2.0 and up support host `0.1.2-rc.1` and later; hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.0`).

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
