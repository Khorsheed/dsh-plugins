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
| `toggleSidebar` (the right column) | middle mouse button | `ctx.sidebarRight.toggleExpanded()` |

Both are `global` (capture-phase, browser default claimed) and both carry an `available` gate: no current session for `compact`, no live right-column service (or no session surface mounted on it) for `toggleSidebar`. The gates matter on the mouse path too — they are what keeps a bound button from being claimed for a no-op.

Compaction rides the session face's command verb, not a compaction service: `/compact` is the host's own command, so admission (busy agent, nothing compactable), the durable `command/run`/`command/done` lifecycle, and the rendered flow node are identical to the typed command's — the plugin adds a chord, not a second code path.

**The target is the right column, and that was a correction.** The first cut wired this action to `ctx.layout.toggleSidebar()`, which is the *left* navigation column; the product owner meant the right one — the column a link or a tool row opens. ui-layout owns the frame's geometry but explicitly does not own the right column's expanded state (the occupant records it and reports the composition back), so the writable face is ui-sidebar-right's `ctx.sidebarRight.toggleExpanded()`, the same action the column's own expand/collapse control performs. The action id stays `toggleSidebar` because it is a durable settings key: the retarget must not orphan a binding the user already recorded under it.

`ctx.sidebarRight` is **probed, never injected**: `ctx.reflect.get('sidebarRight')` reads ui-sidebar-right's service without an `inject` edge, so a composition without the right column keeps pause/steer/new-session/compact alive and only this action stands down. The probe is typed by a minimal local `RightSidebarFace`, which is why the package still carries no dependency on ui-sidebar-right (and no lockfile edge). The gate doubles as the seat check the service's own write path demands: `active()` answers undefined with no session surface mounted, and `toggleExpanded()` would throw there — so the gesture stands down (leaving the button's browser default alone) instead of catching a throw per press.

**A preference is now a key chord or a mouse button.** `BoundMouse { kind: 'mouse', modifiers, button }` joins `BoundKey` under `ShortcutBinding`; the durable schema becomes a three-arm union. The vocabulary is `SHORTCUT_MOUSE_BUTTONS = [1, 2]` — DOM `MouseEvent.button` 1 (middle) and 2 (secondary). The primary button is deliberately absent: a page-wide primary-button binding would consume every ordinary click, and it is the button that operates the recorder itself. The browser's back/forward buttons (3/4) are absent for a different reason — engines hand them to history navigation before the page sees a reliable event.

Modifiers apply to mouse gestures exactly as they do to keys, so `primary`+middle-click and a bare middle-click are distinct bindings.

**Dispatch mirrors the key path.** `dispatchMouse` shares `matchAction` and the `yield`-tier stand-down test (`defaultPrevented`, an open overlay, a non-composer editable) with `dispatch`; a claimed `global` gesture then `preventDefault`s the down event, which is where the browser hangs autoscroll (Windows) and primary-selection paste (Linux). The defaults that only surface later are suppressed by a second, complementary listener: `auxclick` (middle-clicking a link opens it in a new tab) and `contextmenu` (the secondary button's system menu). That listener suppresses but never re-runs the action, so a bound button buys exactly one outcome.

**Recording.** While an action records, the settings row installs a capture-phase `mousedown` listener next to its `keydown` one: a bindable button completes the binding and claims the down event. The primary button is ignored, so clicking the recorder again still cancels through the button's own `onClick`. The global listeners are registered before the row's, so they observe the `capturing` flag on the very event that completes a binding and never fire the action being bound.

**Presentation.** A mouse-bound keycap is a device diagram, not a word: `MouseGlyph` draws a 16×22 top view (silhouette, button split, wheel) and fills the claimed button with the theme accent, and the row puts the locale's word beside it (`gesture.middle` / `gesture.right`) — the keycap says *which button on the device*, which no numbering dialect does consistently (Source's `MOUSE2` is the right button, Ren'Py's `2` is the middle one, DOM's `1` is the middle one). `bindingParts` therefore returns slots — `{kind:'modifier'} | {kind:'key'} | {kind:'mouse'}` — rather than finished labels, and `formatBinding` takes an optional per-slot labeler: the row passes its translator, so the default-binding hint and the text form use the same word the keycap shows. The glyph is `aria-hidden` and carries no `id` or clip path (the lit caps are arcs reusing the body's corner geometry), so several diagrams on one page cannot collide on fragment ids; the visible word stays the button's accessible name.

## Alternatives considered

**Inject `sidebarRight` (`inject: ['sidebarRight']`).** Rejected: cordis injection makes the whole plugin pending until the service exists — a composition without ui-sidebar-right would lose *every* shortcut, not just this one. The "degrade, don't explode" rule owns this case, and the probe is the same one the repo's other optional-service packages use.

**Declare an optional peer dependency on `@deepseek-ai/dsh-client-ui-sidebar-right` and import its Context merge.** Rejected: it buys nicer typing for a single probe and costs a lockfile edge, which is mainline-owned shared state; the local minimal face is enough and keeps the package dependency-free.

**Bind the left column through `ctx.layout.toggleSidebar()` and leave it there.** Rejected by the product owner: the requested surface is the right column. Keeping both would also have put the shipped middle-click default in direct competition with the already-persisted `toggleSidebar` binding (first registration wins on a shared gesture), so the action was retargeted rather than duplicated.

**Call `ctx.remote.commands.execute()` directly for compaction.** Rejected: `ISession.command(line)` is the documented public verb for the session-addressed command channel and the plugin already resolves sessions through `ctx.sessions`; going to the Remote would add an inject edge and duplicate addressing the facade owns.

**`Ctrl/Cmd+B` as the shipped default for the right column.** This is what the branch shipped first, and the product owner overrode it: the right column is a pointer-adjacent surface (what a link or a tool row opens lands there), so the middle button is the default and the chord is the alternative. The cost is recorded rather than argued away — macOS trackpads have no middle button by default, and a global middle-click steals "open link in new tab" from every link on the page — and it is accepted because the chord is one rebind away in Settings, which is exactly what the mouse-binding work exists to make possible.

**Ctrl/Cmd+Shift+C or Ctrl/Cmd+Shift+K for compaction** (the mnemonic initials). Rejected: DevTools' inspect shortcut and the Firefox Web Console own those at browser level and are not reliably interceptable — the user would get the action *and* the browser's panel. Compaction ships on a chord with no browser default as a result, and is rebindable.

**Bind the browser back/forward buttons (3/4).** Rejected: history navigation claims them at the engine level; a page cannot depend on receiving the event, so the vocabulary would advertise a binding that silently never fires.

**Allow the primary button, guarded.** Rejected: there is no guard that makes a page-wide left-click action safe, and no way for the recorder to distinguish "record left click" from "operate the recorder".

**A per-action `middleClick: boolean` flag instead of a general mouse binding kind.** Rejected: it special-cases one action inside the registry, the settings row, and the durable format, and the recorder would still need mouse capture. The general kind costs one union member and makes every action (including contributed ones) bindable to a button.

**A `MOUSE3`-style text token instead of the device diagram.** Rejected: the numbering is a per-engine dialect (Source `MOUSE1`–`MOUSE5`, Ren'Py's `mousedown_1`–`5` putting the wheel on 4/5, DOM's 0/1/2), so the label with no lookup table is the picture — and a six-character token would bring back the exact width problem the diagram exists to solve.

**Keeping the English word `Middle Click`.** Rejected: it was the one label a Chinese card would render as prose next to 「插队发送」, and at roughly 90px it was by far the widest keycap in the row. The word is now locale-owned; modifier and key legends (`Ctrl/Cmd`, `Esc`) deliberately stay English keycap legends, unchanged from before.

**A glyph-only keycap.** Rejected even though it is the most compact option: the button's accessible name comes from its text content, so dropping the word would require an `aria-label` or hidden text to keep any name at all, and the suite's `getByRole('button', { name })` lookups pin that contract. Reintroducing it means shipping that label layer first.

## Consequences

- The durable `ui-shortcuts` section is a three-arm dict now. Existing documents (`kind: 'none'` / `kind: 'key'`) read unchanged and need no migration. **Downgrade is the asymmetric case**: an older plugin build validates against the two-arm union, so a section carrying a `kind: 'mouse'` entry is rejected by the old schema — clearing that entry (or re-recording the action to a key) is the way back. This is the first durable-format change the package makes that a downgrade cannot read.
- Five rows render in the settings card, and the capture hint now names the mouse.
- The label contract changed shape: `bindingParts` yields slots instead of strings and `formatBinding` takes an optional labeler. Only the mouse word is locale-owned — modifier and key legends stay the English keycap legends they always were, so a Chinese card reads `Ctrl/Cmd` + `[diagram] 中键`, not translated modifiers.
- Accessibility rests on the word, not the picture: the glyph is `aria-hidden` and the button's accessible name is its visible text. A future glyph-only variant must add an `aria-label` (or hidden text) in the same change, or the name disappears.
- The shipped default is a global middle click, so that cost is paid out of the box rather than only by users who opt in: autoscroll, primary-selection paste, and middle-click open-link-in-new-tab are claimed by the sidebar toggle on every install. Both READMEs put it at the top of 已知限制 / Known Limitations together with the one-click escape (rebind to a chord).
- No new dependency, no peer-dependency change, no lockfile change, `minHost`/`verifiedHost` unchanged, and no host change is required — both actions were already reachable through public verbs.
- Verification: the package's own suite (46 tests) covers the mouse vocabulary (capture, matching, formatting, equality), the durable schema's acceptance of `button: 1|2` and its rejection of `0`, `3`, and unknown modifiers, dispatch through `ISession.command`, the probed right-column service with and without it, the seat gate's stand-down when the service answers "no mounted surface", the shipped middle-click default, the right-button binding owning the context menu, mouse dispatch and its `auxclick` suppression, the `yield` tier for mouse gestures, and the recording-time stand-down. The READMEs' action tables and 已知限制 follow the shipped behavior.
