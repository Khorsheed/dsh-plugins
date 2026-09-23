# Agent Note: Settings dual-line binding across host 0.1.5 and 0.1.7 (configForms era)

Status: implemented

## Problem

Host 0.1.7-rc.1 deleted the settings faces every community package bound to: the
browser-side `ctx.settingsScope` service (with `SettingsScope`/`SettingsScopeSnapshot`)
became `ctx.configForms` (`ConfigForm`/`ConfigFormSnapshot`), and the host-side
`ctx.settings.register(ns, schema, opts)` owner-scope API became `SettingsForms`,
which serves a plugin entry's own `Config` schema and edits only its `.volatile()`
fields. Packages must keep working on the still-supported 0.1.5 line while gaining
the rc.1 surface — with runtime probes only, never version sniffing, and without
pending the plugin on a service that exists on one line only.

## Decision

Community settings consumers bind **both lines through one structural face plus a
deferred-probe channel**, in three parts:

1. **The two scope shapes are consumed as one duck type.** 0.1.5's
   `SettingsScopeSnapshot<T>` and rc.1's `ConfigFormSnapshot<T>` carry the same
   fields (`status/value/base/user/revision/writable`); the writes differ only in
   resolution (`Promise<void>` vs `Promise<boolean>`). Each package declares a
   minimal local interface (e.g. context-guard's `GuardScope`, ui-shortcuts'
   `ShortcutScope`) instead of importing either line's exported type.
2. **Late arrival is handled by a proxy, not by inject.** Neither `configForms` nor
   `settingsScope` sits in the plugin's `inject` list (each would pend the bundle on
   the other line). Two deferred `ctx.inject([...])` probes — rc.1's face first,
   0.1.5's second — arm a package-local channel (context-guard's `GuardScopeChannel`,
   taskpilot's `JobsChannel` for the jobs analogue) that publishes an
   `unavailable`/empty snapshot until one line binds it; the slots `hooks` seat
   points at the channel from registration time. Registries that only need a write
   target take a `bindHost` (ui-shortcuts' `ShortcutRegistryRuntime`), first bind
   wins.
3. **The host half serves the section per line.** The package's settings schema is
   exported as the plugin `Config` with each runtime-editable field marked
   `.volatile()` **through a feature probe** (0.1.5's schemastery 3.18.2 has no such
   method; the probe leaves the field plain there). Inside `ctx.inject(['settings'])`,
   `typeof settings.register === 'function'` selects the legacy 0.1.5 namespace
   registration; otherwise rc.1, where the entry's own Config is the served form and
   `settings.configure({ auto: false }, ctx.fiber)` keeps the auto-generated page out
   of the settings tree (every package here ships its own card). Config annotations
   are bare `z` — `z<T>` fails schemastery 3.18.4 variance under
   exactOptionalPropertyTypes (TS2375), and an unannotated export trips TS2742/TS2883
   on pnpm's layout.

Supporting rules that fell out of the same migration:

- **Volatile-aware config reads.** rc.1 resolves volatile fields into live
  `{ get() }` references, so any code reading its own entry config unwraps a
  maybe-Volatile (context-guard's `unwrapVolatile` in `resolveConfig`,
  capability-catalog's `readVolatile`).
- **Wholesale writes for replace-state blocks.** `SettingsForms.update` is a
  recursive merge, so a removed key inside a persisted block survives and comes
  back through the invalidation round-trip; a block that mirrors in-memory state
  (capability-catalog's `mcp`) writes through `replace` (wholesale over the live
  fields), with `update` as the fallback arm.
- **Reload channels are line-scoped.** rc.1's `settings/document-updated` and the
  fiber-scoped `loader/volatile-update` are consumed through duck-narrowed
  listeners; 0.1.5 keeps its `scope.watch`.
- **Fixtures follow the same probe.** Specs replace the deleted `SettingsProvider`
  base class and `stubSettingsScope` with plain fakes of the legacy `register`
  face and rc.1's `stubConfigForm`; the rc.1 locale plugin injects `configForms`,
  so benches provide it.

## Alternatives considered

- **Version sniffing (read the host version, branch once).** Rejected by the
  repo's standing rule: every adaptation is a runtime capability probe, so an
  unanticipated intermediate host degrades instead of mis-selecting.
- **Keep `settingsScope`/`settings.register` in `inject` and pend on 0.1.5-first
  hosts.** A service present on only one line in `inject` holds the whole plugin
  pending forever on the other line; the deferred two-probe arm is exactly the
  pattern the slot registrations already used (`plugins.bundle.config` vs
  `settings.plugin.item`).
- **Annotate Config schemas as `z.infer<typeof ...>` or keep `z<T>`.** Both lose:
  `z<T>` breaks on 3.18.4's variance, and the inferred object type cannot be named
  portably from pnpm's `.pnpm` layout; bare `z` is the convention the official
  packages and this repo's other rows already emit.
- **`update` for the mcp persist.** Rejected for correctness: merge semantics
  silently un-delete servers/credentials/tool toggles (see Decision).

## Consequences

- context-guard, ui-shortcuts, and capability-catalog run their settings surfaces
  on both host lines with no host edit; composing ui-settings out degrades to the
  composition-time fallback (button) or an invisible card, the same contract as
  before.
- The volatile probe means a 0.1.5 host never sees the marker and an rc.1 host
  gets live form editing; the marker itself is the only schema-level difference,
  so stored sections stay compatible across lines.
- `replace`-vs-`update` is a semantic load-bearing choice on rc.1: removing an MCP
  server now actually removes it from the profile document (verified against
  `SettingsForms.write`'s mergeLayers/replace implementations; no constructor-level
  spec harness exists for the arm — the gap is recorded here).
- Cost: every settings-owning package carries a small channel/probe module and a
  dual-path host arm; the deleted official types (`SettingsScope`,
  `SettingsProvider`) can no longer anchor fixtures, so fakes restate the legacy
  face by hand.
