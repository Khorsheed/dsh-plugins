# Agent Note: Compact + sidebar shortcuts, and mouse-button bindings

Status: implemented

English | [中文](2026-09-11-ui-shortcuts-compact-and-sidebar.zh.md)

## Problem

Two everyday housekeeping gestures had no entry in the shortcuts plugin, and one of them had no keyboard entry at all:

- Compacting the model history was reachable only by typing `/compact` into the composer.
- Toggling the sidebar was reachable only from the sidebar's own collapse control (and, on a narrow frame, its rail).

The product owner asked for both, and specifically asked whether the sidebar could ride the **middle mouse button**. The binding model could not answer that: `ShortcutPreference` was `{ kind: 'none' } | BoundKey` with no other arm, the settings recorder listened to `keydown` only, and dispatch was a keydown listener pair. Whatever the answer, one of the two had to change.

## Decision

**Two more fixed built-ins**, registered through the public `ctx.shortcuts` face like the existing three:

| Action id | Default | Runs |
| --- | --- | --- |
| `compact` | `Ctrl/Cmd+Shift+X` | `ISession.command('/compact')` on the current session |
| `toggleSidebar` | `Ctrl/Cmd+B` | `ctx.layout.toggleSidebar()` |

Both are `global` (capture-phase, browser default claimed) and both carry an `available` gate: no current session for `compact`, no live `ctx.layout` for `toggleSidebar`. The gates matter on the mouse path too — they are what keeps a bound button from being claimed for a no-op.

Compaction rides the session face's command verb, not a compaction service: `/compact` is the host's own command, so admission (busy agent, nothing compactable), the durable `command/run`/`command/done` lifecycle, and the rendered flow node are identical to the typed command's — the plugin adds a chord, not a second code path.

`ctx.layout` is **probed, never injected**: `ctx.reflect.get('layout')` reads ui-layout's service without an `inject` edge, so a composition without the shell keeps pause/steer/new-session/compact alive and only this action stands down. The probe is typed by a minimal local `LayoutFace`, which is why the package still carries no dependency on ui-layout (and no lockfile edge).

**A preference is now a key chord or a mouse button.** `BoundMouse { kind: 'mouse', modifiers, button }` joins `BoundKey` under `ShortcutBinding`; the durable schema becomes a three-arm union. The vocabulary is `SHORTCUT_MOUSE_BUTTONS = [1, 2]` — DOM `MouseEvent.button` 1 (middle) and 2 (secondary). The primary button is deliberately absent: a page-wide primary-button binding would consume every ordinary click, and it is the button that operates the recorder itself. The browser's back/forward buttons (3/4) are absent for a different reason — engines hand them to history navigation before the page sees a reliable event.

Modifiers apply to mouse gestures exactly as they do to keys, so `primary`+middle-click and a bare middle-click are distinct bindings.

**Dispatch mirrors the key path.** `dispatchMouse` shares `matchAction` and the `yield`-tier stand-down test (`defaultPrevented`, an open overlay, a non-composer editable) with `dispatch`; a claimed `global` gesture then `preventDefault`s the down event, which is where the browser hangs autoscroll (Windows) and primary-selection paste (Linux). The defaults that only surface later are suppressed by a second, complementary listener: `auxclick` (middle-clicking a link opens it in a new tab) and `contextmenu` (the secondary button's system menu). That listener suppresses but never re-runs the action, so a bound button buys exactly one outcome.

**Recording.** While an action records, the settings row installs a capture-phase `mousedown` listener next to its `keydown` one: a bindable button completes the binding and claims the down event. The primary button is ignored, so clicking the recorder again still cancels through the button's own `onClick`. The global listeners are registered before the row's, so they observe the `capturing` flag on the very event that completes a binding and never fire the action being bound.

## Alternatives considered

**Inject `layout` (`inject: ['layout']`).** Rejected: cordis injection makes the whole plugin pending until the service exists — a composition without ui-layout would lose *every* shortcut, not just this one. The "degrade, don't explode" rule owns this case, and the probe is the same one the repo's other optional-service packages use.

**Declare an optional peer dependency on `@deepseek-ai/dsh-client-ui-layout` and import its Context merge.** Rejected: it buys nicer typing for a single probe and costs a lockfile edge, which is mainline-owned shared state; the local minimal face is enough and keeps the package dependency-free.

**Call `ctx.remote.commands.execute()` directly for compaction.** Rejected: `ISession.command(line)` is the documented public verb for the session-addressed command channel and the plugin already resolves sessions through `ctx.sessions`; going to the Remote would add an inject edge and duplicate addressing the facade owns.

**Middle click as the shipped default for the sidebar.** Rejected by the product owner. It is awkward on macOS, where a trackpad has no middle button by default, and a global middle-click steals "open link in new tab" from every link on the page — a bad default for a published plugin. The chord is the default; the mouse is one click away in Settings, which is what the mouse-binding work exists to make possible.

**Ctrl/Cmd+Shift+C or Ctrl/Cmd+Shift+K for compaction** (the mnemonic initials). Rejected: DevTools' inspect shortcut and the Firefox Web Console own those at browser level and are not reliably interceptable — the user would get the action *and* the browser's panel. Compaction ships on a chord with no browser default as a result, and is rebindable.

**Bind the browser back/forward buttons (3/4).** Rejected: history navigation claims them at the engine level; a page cannot depend on receiving the event, so the vocabulary would advertise a binding that silently never fires.

**Allow the primary button, guarded.** Rejected: there is no guard that makes a page-wide left-click action safe, and no way for the recorder to distinguish "record left click" from "operate the recorder".

**A per-action `middleClick: boolean` flag instead of a general mouse binding kind.** Rejected: it special-cases one action inside the registry, the settings row, and the durable format, and the recorder would still need mouse capture. The general kind costs one union member and makes every action (including contributed ones) bindable to a button.

## Consequences

- The durable `ui-shortcuts` section is a three-arm dict now. Existing documents (`kind: 'none'` / `kind: 'key'`) read unchanged and need no migration. **Downgrade is the asymmetric case**: an older plugin build validates against the two-arm union, so a section carrying a `kind: 'mouse'` entry is rejected by the old schema — clearing that entry (or re-recording the action to a key) is the way back. This is the first durable-format change the package makes that a downgrade cannot read.
- Five rows render in the settings card, and the capture hint now names the mouse.
- A bound mouse button is a global gesture with a real cost: the browser defaults listed above are suppressed while the binding is live. Documented under 已知限制 in both READMEs, with the escape hatch (rebind to a key) stated.
- No new dependency, no peer-dependency change, no lockfile change, `minHost`/`verifiedHost` unchanged, and no host change is required — both actions were already reachable through public verbs.
- Verification: the package's own suite (44 tests) covers the mouse vocabulary (capture, matching, formatting, equality), the durable schema's acceptance of `button: 1|2` and its rejection of `0`, `3`, and unknown modifiers, dispatch through `ISession.command`, the probed-layout path with and without the service, mouse dispatch and its `auxclick`/`contextmenu` suppression, the `yield` tier for mouse gestures, and the recording-time stand-down. The READMEs' action tables and 已知限制 follow the shipped behavior.
