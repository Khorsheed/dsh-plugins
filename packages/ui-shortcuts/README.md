# @khorsheed/dsh-ui-shortcuts

English | [中文](README.zh.md)

Optional web shortcuts plugin: two fixed actions — **pause the running turn** and **steer-send the draft** — bound to user-chosen keys. The actions are fixed product operations; the keys are the user's. Defaults: `Esc` pauses (the same cancel as the composer's Stop button), `Ctrl/Cmd+S` sends the current draft with queue-jump (steer) delivery.

## Install and uninstall

The plugin is **not** part of the default web bundle; add it to a profile to install it. The package declares `dsh.bundle`, so one command installs it and mounts its loader row (no hand-edited `cordis.patch.yml`):

```sh
dsh plugin --profile web add @khorsheed/dsh-ui-shortcuts
```

**Warning**: this package shares the loader entry id `ui-shortcuts` with the official `@deepseek-ai/dsh-client-ui-shortcuts`. Mounting both in one profile fails loud at boot on the duplicate entry id — keep exactly one.

The row's node half registers the `ui-shortcuts` settings section; its browser half (served at `/plugins/ui-shortcuts/client.js`) wires the keys and the General Settings row. Uninstall = remove or `disabled: true` the row. Disabling through the plugin inventory is a deployment concern, not this package's.

## Actions

| Action | Default | Behavior |
| --- | --- | --- |
| 暂停当前任务 (Pause current task) | `Esc` | Cancels the current session's running turn through the public `conversation.cancel()` — the same operation as the composer's Stop button. Ordinary sessions and continuable subagents stop; one-shot subagents do not (mirroring the Stop button's visibility). |
| 插队发送 (Send with priority) | `Ctrl/Cmd+S` | Sends the current draft with `steer` delivery through the public `conversation.input.for(scope).submit('steer')` facade; the browser save gesture is suppressed while bound. Draft-only: an empty draft is a silent no-op (steering the whole queue stays `Cmd/Ctrl+Enter`'s gesture). |

Both actions run only through public services — the plugin never reaches into ui-conversation internals. Keys are rebound in General Settings → 快捷键 (Keyboard shortcuts): click a binding to record the next chord (`Esc` cancels, `Delete`/`Backspace` unbinds, `Ctrl/Cmd` counts as one `primary` modifier on every platform), or reset to the shipped default. Preferences persist in `$DSH_HOME/settings.yaml` under the `ui-shortcuts` section.

## Escape layering

Escape keeps the composer's existing layering, which the plugin relies on as a documented contract: the keydown is handled only when the event target is the composer's textarea, and only when the composer did not already consume the key (an open slash menu `preventDefault`s a consumed Escape). Everything else — modals, menus, the popupSelect shell — keeps its own Escape behavior because focus lives outside the textarea there. IME composition and held-repeat keys never trigger either action.

## Model Experience

None. The actions call existing public verbs (`conversation.cancel`, `conversation.input.submit`) that the composer's own controls already use; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Escape-pause is composer-scoped** — the key pauses only while focus is in the composer textarea. A global Escape would need a shared overlay-consumer registry that does not exist; until one does, pausing from the sidebar or over a modal is intentionally not offered.
- **No custom actions** — the action set is fixed at two; adding user-defined actions (command lines, toggles) is deferred until the rebinding UI proves the interaction model.
- **Ctrl/Cmd+S is draft-only** — an empty draft does nothing; the plugin deliberately leaves whole-queue steering to the composer's `Cmd/Ctrl+Enter` gesture.
- **No in-repo e2e** — the plugin is not in the default bundle, so it has no `apps/web` replay scenario; its wiring is covered by the apply-level browser spec against fakes.
