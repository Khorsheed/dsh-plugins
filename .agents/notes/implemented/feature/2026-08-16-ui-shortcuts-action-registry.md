# Agent Note: Shortcut action registry (ctx.shortcuts)

Status: implemented

English | [中文](2026-08-16-ui-shortcuts-action-registry.zh.md)

## Problem

The plugin's action set was compile-time fixed: a closed `SHORTCUT_ACTIONS` union, one store per action in the policy, a closed settings schema, and a hardcoded row list. A second plugin needing its own chord (the split-screen plugin's new-session-and-split, Ctrl/Cmd+Shift+O) would have had to fork the entire capture/persist/render stack. The host ships no general action registry to ride: `dsh-commands` handlers are bound to agent+text semantics, and `ctx.commandUi` accepts only popupSelect contributions.

## Decision

ui-shortcuts becomes the provider of a shortcut action registry, following the capability-seam pattern so consumers see an official-looking cordis service:

- **Service Definition** (`client/contract.ts`): `ShortcutRegistry.registerAction(contribution): disposer`, with a Context declaration merge. A contribution carries `id` (convention `<plugin>.<action>`; duplicate ids fail loud), label/description locale seats in the *contributor's* namespace, `defaultBinding`, `layering`, an optional dispatch-time `available()` gate, and the `run` closure.
- **`layering` is an enum, not a when-expression language**: `'global'` (capture phase, browser default suppressed) and `'yield'` (bubble phase, three-part yield rule) cover every chord the host has today; a third kind can be added when a real consumer needs it.
- **Persistence is an open dict**: `ShortcutSettingsSchema = z.dict(PreferenceSchema)` keyed by action id; only user-written entries persist, missing ids fall back to the registered default at read time. The three built-in ids (`pause`/`steerSend`/`newSession`) are unchanged, so existing settings documents need no migration.
- The built-in actions register through the public face (dogfooding); the Settings row renders from the registry's reactive stores, so late-registered actions appear without reopening the panel.

## Alternatives considered

**Ride `dsh-commands` or `ctx.commandUi`.** Rejected: their handler contracts carry slash-command semantics (agent invocation, session log, popupSelect-only UI) that pure UI actions like split-view do not have.

**A slot for plugins to render their own settings rows.** Rejected: every plugin would re-implement the keycap recorder, unbind semantics, and persistence, and the section's interaction language would fragment.

**VS Code-style when-expression.** Rejected as complexity without a consumer; `available()` plus the layering enum covers the same ground for today's actions.

## Consequences

`ShortcutBindingsPolicy` is absorbed into `ShortcutRegistryRuntime` (actions/preferences/capturing stores); `policy.ts` and its spec are replaced by `registry.ts` and `registry.client.spec.ts`. Dispatch order is registration order when chords collide — documented, not surfaced in the UI yet. The API is deliberately unannounced beyond the README's plugin-author section: the split-screen plugin is the first external consumer, and the contract may still move while integrating it.
