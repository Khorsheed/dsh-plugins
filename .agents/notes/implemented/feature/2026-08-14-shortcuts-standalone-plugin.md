# Agent Note: Standalone web shortcuts plugin (fixed actions, user-chosen keys)

Status: implemented

English | [中文](2026-08-14-shortcuts-standalone-plugin.zh.md)

## Problem

The composer had no conventional stop and priority-send bindings: stopping a running turn required the pointer, and queue-jumping the current draft required knowing the Cmd/Ctrl+Enter convention. Product wanted two discoverable shortcuts — a pause-the-task key and a steer-send-the-draft key — as an **installable, uninstallable plugin** rather than a hard-wired composer feature, and with the standard shortcut UX: the operations are fixed, the keys are user-chosen (rebindable, resettable, unbindable). An earlier in-composer implementation (the superseded `2026-08-14-composer-keyboard-shortcuts` note) proved the semantics but baked the feature into ui-conversation; this decision replaces it.

## Decision

**A standalone client plugin package `@deepseek-ai/dsh-client-ui-shortcuts` owns the feature, with zero core changes.** Two fixed actions — pause the running turn and steer-send the draft — are bound to persisted, user-rebindable keys. Defaults: `Esc` pauses, `Ctrl/Cmd+S` steer-sends (`Ctrl` and `Cmd` collapse into one `primary` modifier, mirroring the composer's Ctrl/Cmd chord convention). Keys are recorded in General Settings (click to capture, `Esc` cancels, `Delete`/`Backspace` unbinds, reset restores the default) and persist through a Host-backed `ui-shortcuts` settings section, following the `busyEnter` persistence pattern.

**The plugin is not in the default web bundle.** It ships as an installable package; a profile installs it with one Loader row (`- id: ui-shortcuts / name: '@deepseek-ai/dsh-client-ui-shortcuts'`) and uninstalls by removing or disabling that row. The row's node half registers the settings section; the browser half wires the keys and the settings row.

**The actions ride public services only.** Steer-send calls the public `conversation.input.for(scope).submit('steer')` facade; pause calls the scope-addressed public `conversation.cancel()` (the Stop-button action). The plugin never reaches ui-conversation internals — the earlier in-composer implementation's `ComposerBarInjected` faces stay package-private. The earlier implementation is fully reverted (InputBar branches, the `escPause`/`ctrlSSend` settings fields, the in-composer settings row, locales, tests, golden), leaving ui-conversation untouched.

**Escape relies on the composer's existing layering as a documented contract.** The pause keydown is handled only when the event target is the composer's textarea and only when the composer did not already consume the key (an open slash menu `preventDefault`s a consumed Escape). Modals, menus, and popupSelect keep their own Escape behavior because focus lives outside the textarea. IME composition and held-repeat keys never trigger either action.

## Alternatives considered

**Keep the feature in the composer (the superseded approach).** Initially chosen for its perfect layering access: the composer's internal arbitration and submit faces made the first implementation trivial and correct. Rejected as the shipped form because the product wanted an installable, uninstallable plugin — a feature baked into ui-conversation cannot be removed per profile — and because the composer should not own optional peripheral behavior. The layering need does not require baking: the composer's existing `defaultPrevented` contract is observable from a document listener.

**A global Escape handled at document level with an overlay registry.** Rejected: no shared overlay-consumer registry exists, and building one to make Escape pause from anywhere is a larger architectural change than the product asked for. The composer-scoped gate (target = composer textarea) keeps every existing Escape consumer authoritative without new plumbing.

**Ship the plugin in the default web bundle.** Rejected by the product decision that the plugin is community-installed; the default bundle stays unchanged and the settings dialog golden is untouched.

## Consequences

Users of the plugin get two discoverable, rebindable shortcuts with no core-code footprint; users without it get exactly the pre-feature behavior. The `ui-shortcuts` settings section persists independently of `ui-conversation`. The plugin's Escape is deliberately composer-scoped (a known limitation, documented in its README), and its keydown wiring is covered by an apply-level browser spec against fakes rather than an `apps/web` e2e because it is not in the default bundle. The superseded in-composer note's rationale is preserved here: its alternatives (a separate plugin, global capture, hard-coded behavior) and the composer-layering constraint it established remain the reasons the plugin is shaped this way.
