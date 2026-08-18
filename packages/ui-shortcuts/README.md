# @khorsheed/dsh-ui-shortcuts

English | [中文](README.zh.md)

Optional web shortcuts plugin: three fixed actions — **stop/retract the current activity**, **steer-send the draft**, and **new session** — bound to user-chosen keys. The actions are fixed product operations; the keys are the user's. Defaults: `Esc` stops the current activity retract-first (a just-sent message still waiting in the queue is pulled back into the composer; with nothing pending it cancels the running turn, the same cancel as the composer's Stop button), `Ctrl/Cmd+S` sends the current draft with queue-jump (steer) delivery, `Ctrl/Cmd+O` starts a new session (the same entry as the sidebar New-session button).

## Install and uninstall

The plugin is **not** part of the default web bundle; add it to a profile to install it. The package declares `dsh.bundle`, so one command installs it and mounts its loader row (no hand-edited `cordis.patch.yml`):

```sh
dsh plugin --profile web add @khorsheed/dsh-ui-shortcuts
```

**Warning**: this package shares the loader entry id `ui-shortcuts` with the official `@deepseek-ai/dsh-client-ui-shortcuts`. Mounting both in one profile fails loud at boot on the duplicate entry id — keep exactly one.

The row's node half registers the `ui-shortcuts` settings namespace; its browser half (served at `/plugins/ui-shortcuts/client.js`) wires the keys and the keyboard-shortcuts card in the plugin configuration tab (Settings → Plugins). Uninstall = remove or `disabled: true` the row. Disabling through the plugin inventory is a deployment concern, not this package's.

## Actions

| Action | Default | Behavior |
| --- | --- | --- |
| 停止当前任务 (Stop current task) | `Esc` | Stops the current activity, retract-first. While the just-sent message is still pending in the host inbox (`placement: 'queued'` — the agent has not claimed it into a turn yet: queued behind a busy turn, during maintenance, or across cancel convergence), the action removes the most recent pending send through the public `conversation.updateQueue(..., { kind: 'remove' })` and returns its text to the composer (an image-only message is removed without a draft restore; a non-empty live draft is never clobbered) — the "undo the last send" gesture, leaving the running turn untouched. Once nothing is pending it cancels the running turn through the public `conversation.cancel()` — the same operation as the composer's Stop button. Ordinary sessions and continuable subagents stop; one-shot subagents do not (mirroring the Stop button's visibility). A removal that races the claim (the host picked the message up between the snapshot read and the removal) falls through to the cancel arm. |
| 插队发送 (Send with priority) | `Ctrl/Cmd+S` | Sends the current draft with `steer` delivery through the public `conversation.input.for(scope).submit('steer')` facade; the browser save gesture is suppressed while bound. Draft-only: an empty draft is a silent no-op (steering the whole queue stays `Cmd/Ctrl+Enter`'s gesture). |
| 新建会话 (New session) | `Ctrl/Cmd+O` | Starts a new session through the public `workspaces.startSession()` — the same entry as the sidebar New-session button; the browser open-file gesture is suppressed while bound. A global action, independent of focus. |

All three actions run only through public services — the plugin never reaches into ui-conversation internals. Keys are rebound in Settings → Plugins → 快捷键 (Keyboard shortcuts): click a binding to record the next chord (`Esc` cancels, `Delete`/`Backspace` unbinds, `Ctrl/Cmd` counts as one `primary` modifier on every platform), or reset to the shipped default. Preferences persist in `$DSH_HOME/settings.yaml` under the `ui-shortcuts` section.

## For plugin authors

Any plugin can contribute its own keyboard actions through the `ctx.shortcuts` registry this package provides — contributed actions get the Settings row entry, rebinding, persistence, and conflict-free dispatch for free:

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

## Escape layering

Escape stop/retract is global and yields to whatever owns the key first: a consumed keydown (`defaultPrevented` — the composer's slash menu, popupSelect), an open overlay (modals, menus, and the settings panel close on Escape without `preventDefault`, and their DOM is still present during dispatch), or a non-composer editable target (inline rename, search fields). Everywhere else — the composer textarea, the sidebar, the session list — Escape retracts the pending send if one exists, otherwise cancels the running turn. IME composition and held-repeat keys never trigger any action.

## Model Experience

None. The actions call existing public verbs (`conversation.cancel`, `conversation.updateQueue`, `conversation.input.submit`/`setDraft`) that the composer's own controls already use; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.7`): ✅ full — verified against the published tarball: `@deepseek-ai/dsh-client-ui-conversation@0.1.0-rc.7` exposes `conversation.input` (`SessionInputResolver.for(scope)` → `SessionInput.submit(mode)`, with `'steer'` in `InputSubmitMode`); the rest of the runtime touches only the official public stable surface (slots, core services, core events, cordis 4.x, schemastery).
- source line (deepseek-harness master): ✅

## Known Limitations and Deferred Work

- **No user-defined actions** — plugins contribute actions through `ctx.shortcuts` (see *For plugin authors*); arbitrary user-defined actions (command lines, toggles) are not offered.
- **Escape retract only reaches pending messages** — a message the host has already claimed into a running turn is durable in the session log (the `user/message` event is appended the moment the turn starts), so Escape can only cancel that turn, never pull the message back. Pulling back an already-admitted message would need host-side support and is deliberately out of scope for this plugin.
- **Ctrl/Cmd+S is draft-only** — an empty draft does nothing; the plugin deliberately leaves whole-queue steering to the composer's `Cmd/Ctrl+Enter` gesture.
- **No in-repo e2e** — the plugin is not in the default bundle, so it has no `apps/web` replay scenario; its wiring is covered by the apply-level browser spec against fakes.
