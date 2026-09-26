# dsh-ui-shortcuts

English | [中文](README.md)

Esc to stop, Cmd+S to steer-send your draft, Cmd+O for a new session, Cmd+Shift+X to compact the context, middle-click to toggle the right sidebar — every binding rebindable, keyboard or mouse.

Want to halt a runaway turn? No hunting for the tiny stop button — Esc does it. A finished draft that shouldn't wait in line goes out with Cmd/Ctrl+S; Cmd/Ctrl+O starts a new session from anywhere; when the context fills up, Cmd/Ctrl+Shift+X compacts it in place; when you are done with the right column (previews, files, whatever a tool row opened), **middle-click** tucks it away (rebind it to a chord if that doesn't suit). Don't like the defaults? Click a binding in Settings → Plugins → Keyboard shortcuts and record your own. These shortcuts call the same actions the on-screen buttons and slash commands do — they never send anything extra to the model.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/07-ui-shortcuts.png" width="640" alt="the keyboard-shortcuts card in Settings: one row per action, click a binding to re-record it">

## Features

- **Pause the turn** (`Esc`) — the composer's Stop button, from anywhere on the page.
- **Steer-send the draft** (`Ctrl/Cmd+S`) — queue-jump delivery of the current draft; the browser save gesture is suppressed.
- **New session** (`Ctrl/Cmd+O`) — the sidebar's New-session entry; the browser open-file gesture is suppressed.
- **Compact the context** (`Ctrl/Cmd+Shift+X`) — runs the host's `/compact` command for the current session, exactly the path a typed `/compact` takes (same flow node, same busy error, same admission semantics).
- **Toggle the right sidebar** (middle mouse button) — calls ui-sidebar-right's public `ctx.sidebarRight.toggleExpanded()`, the action behind the right column's own expand/collapse control. The pointer gesture is the shipped default (the right column is what a link or a tool row opens, so the button that opens it also gives the room back); rebind it to a chord in Settings if that suits you better.
- **Rebindable keys and mouse buttons** — click a binding in Settings → Plugins → Keyboard shortcuts to record, unbind, or reset; besides keys, the middle and secondary mouse buttons can be recorded. Persists in `$DSH_HOME/settings.yaml`.

## Install

Not part of the default web bundle; one command installs and mounts it (self-mounting via `dsh.bundle`):

```sh
dsh plugin --profile web add @khorsheed/dsh-ui-shortcuts      # install
dsh plugin --profile web remove @khorsheed/dsh-ui-shortcuts   # uninstall
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ full — baseline moved to the 0.1.2-rc.1 API surface (single-arm 0.1.2 API consumption; the 0.1.1-rc.2 runtime arm is retired), full build+test green; minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.7-rc.2). Two shapes by host line:
  - **0.1.5 ~ 0.1.7-rc.1** (no official shortcuts service): the package ships its **full capability** — its own registry (`ctx.shortcuts`), the settings card, keyboard and mouse bindings, all five built-in actions.
  - **0.1.7-rc.2+** (the official shortcut system `dsh-client-shortcuts` is resident): the own registry, settings card, and mouse bindings are **all retired** (cordis throws on a duplicate `shortcuts` provide); the package shrinks to contributing the two commands the official catalog lacks — steer-send and compact. Pause, new-session, and the right-sidebar toggle are official natives (Esc Esc / `session.new` / `sidebar.right.toggle`), and rebinding rides the official shortcuts panel.

  Both paths verified: dual-baseline build+test plus a real rc.2 full-composition boot (2026-09-26).

**Version line mapping**: 0.2.0 and up support host `0.1.2-rc.1` and later; hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.0`).

## Known Limitations

- **No user-defined actions** — actions come from plugins via `ctx.shortcuts`; arbitrary command lines or toggles are not offered (`/compact` and the right-sidebar toggle are built-ins, not a general command palette).
- **Ctrl/Cmd+S is draft-only** — an empty draft is a no-op; whole-queue steering stays on the composer's `Cmd/Ctrl+Enter` gesture.
- **Mouse bindings are the middle and secondary buttons only** — the primary button is deliberately not bindable (a page-wide left-click action would consume every ordinary click), and the browser's back/forward buttons are absent too: engines hand them to history navigation before the page sees a reliable event.
- **The shipped default is a global middle click** — the right-sidebar toggle ships bound to the middle button, which means **out of the box** it takes over autoscroll (Windows), primary-selection paste (Linux), and — the one people notice — **middle-clicking a link no longer opens it in a new tab**. That is a deliberate product choice: the right column is what a link click opens, so the middle button is the one that puts it away again. On a trackpad, or if you want those gestures back, one click in Settings → Plugins → Keyboard shortcuts rebinds it to `Ctrl/Cmd+B` or any other chord.
- **No mouse bindings on rc.2+** — the official binding protocol expresses physical keyboard keys only; the middle/secondary button gestures have no representation. On the official path every default lands on a key chord (steer-send is `Ctrl/Cmd+Shift+S` on the web — the official web policy refuses a bare `primary+Key`; compact ships unbound on Linux desktop/web because the window manager owns the chord — bind it yourself in the official shortcuts panel). 0.1.5 through 0.1.7-rc.1 are unaffected.

## How it works

<details>
<summary>Internals (click to expand)</summary>

This section describes the package's own implementation, which applies to **0.1.5 ~ 0.1.7-rc.1**; on 0.1.7-rc.2+ the official path mounts none of these parts — what remains is the two-command contribution (see Compatibility).

- `src/index.ts` (node half) — registers the `ui-shortcuts` settings namespace.
- `src/client/` (browser half, `/plugins/ui-shortcuts/client.js`) — wires the keys and the shortcuts card in Settings → Plugins.

The row id is `khorsheed-ui-shortcuts`, deliberately distinct from the official `@deepseek-ai/dsh-client-ui-shortcuts` bundle's `ui-shortcuts` row: loader composition collapses same-id rows (last layer wins), and reusing it would shadow the official panel outright. With distinct ids the two coexist — the official panel owns the catalog and rebinding, this package contributes its two extra commands (see Compatibility).

Actions go through public services, never ui-conversation internals:

| Action | Behavior |
| --- | --- |
| 暂停当前任务 (Pause current task) | `conversation.cancel()` — the same operation as the composer's Stop button. One-shot subagents do not stop, mirroring Stop's visibility. |
| 插队发送 (Send with priority) | `conversation.input.for(scope).submit('steer')` on the current draft; an empty draft is a silent no-op. |
| 新建会话 (New session) | `sessions.create()` → `sessions.open()` — the same create-then-open entry the sidebar's New-session button rides; global, focus-independent. |
| 压缩上下文 (Compact context) | `ISession.command('/compact')` on the current session — the same command channel the composer's slash menu uses; the host owns admission (busy, nothing to compact) and renders the outcome as the flow node a typed command produces. |
| 开关右侧边栏 (Toggle right sidebar, middle click by default) | `ctx.sidebarRight.toggleExpanded()` — ui-sidebar-right's public service, the same action the right column's own expand/collapse control performs. The service is **probed**, not injected (`ctx.reflect.get('sidebarRight')`): a composition without the right column keeps every other shortcut alive and this one simply does nothing. The gate asks only for "service present + a session on screen", with a catch around the write path for the window before the seat binds — it deliberately does **not** read the face's own `active()`: a never-opened column has no active tab, and that is the state this gesture exists to expand. |

Rebinding: click a binding to record the next chord or mouse button (`Esc` cancels, `Delete`/`Backspace` unbinds, `Ctrl/Cmd` counts as one `primary` modifier on every platform, and while recording the middle/right button binds on press), or reset to the shipped default. Preferences persist in `$DSH_HOME/settings.yaml` under the `ui-shortcuts` section.

**How a mouse binding is drawn**: the row shows a top-view mouse diagram (silhouette, button split, wheel) with **the bound button filled in the theme accent**, next to the word for it in the current language. That is the device-diagram grammar game settings screens use, and it exists so nobody has to learn a numbering dialect (Source's `MOUSE2` is the right button, Ren'Py's `2` is the middle one, DOM's `1` is the middle one — three answers to one question). With modifiers it reads `Ctrl/Cmd` `+` `[diagram] Middle`, and the keycap count already says the rest. The diagram is decorative (`aria-hidden`) while **the word beside it is the accessible name** — so the label survives even if the icon does not render.

**Escape layering**: Escape pause is global but yields to whatever owns the key first: a consumed keydown (`defaultPrevented` — the composer's slash menu, popupSelect), an open overlay (modals, menus, the settings panel), or a non-composer editable (inline rename, search fields). Everywhere else — composer textarea, sidebar, session list — Escape pauses the running turn. IME composition and held-repeat keys never trigger any action.

**Mouse layering and default suppression**: mouse actions share the key layer exactly. A `global` action runs on `mousedown` and takes over the defaults hung off the down action (autoscroll, primary-selection paste); it then also takes over the ones that only surface later — a link's middle-click new tab (`auxclick`) and the secondary button's system context menu (`contextmenu`) — because a binding must not buy two outcomes at once. A `yield` action stands down while an overlay is open or the target is editable, and recording a binding stands the whole global wiring down, mouse included.

**For plugin authors** — contribute actions through the `ctx.shortcuts` registry:

```ts
ctx.effect(() => ctx.shortcuts.registerAction({
  id: 'my-plugin.myAction',          // unique id, <plugin>.<action> by convention
  label: { ns: 'my-plugin', key: 'action.myAction' },
  description: { ns: 'my-plugin', key: 'action.myAction.desc' },
  defaultBinding: { kind: 'key', modifiers: ['primary', 'shift'], key: 'o' },
                                     // or { kind: 'mouse', modifiers: [], button: 1 }
                                     // button: DOM MouseEvent.button, 1 = middle, 2 = secondary (the primary button is not bindable)
  layering: 'global',                // 'global': capture-phase, browser default suppressed
                                     // 'yield': bubble-phase, yields to consumed events / open overlays / editables
  available: () => true,             // optional dispatch-time gate
  run: () => { /* ... */ },
}), 'my-plugin: shortcut')
```

Locale entries stay in the contributing plugin's own namespace. Duplicate ids fail loud; on a shared gesture the first registration wins. Users rebind or unbind any action in Settings → Plugins → Keyboard shortcuts (a key chord and a mouse button are interchangeable). No model requests, no KV-cache effect — the actions call the same public verbs the app's own controls use.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/ui-shortcuts`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
