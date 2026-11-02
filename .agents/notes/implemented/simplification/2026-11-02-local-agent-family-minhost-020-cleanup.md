# Agent Note: local-agent family raises its floor to host 0.2.0 and drops the older-host branches

Status: implemented

## Problem

The local-agent family (core, the four providers, `local-agent-dsh-headless`, `bundle-local-agent`) still declared `engines.dsh >=0.1.5-rc.1`. To honor that floor it carried code for hosts nobody runs any more (production runs 0.2.1-rc.5):

- a second settings path: the 0.1.5 `settings.register(namespace, schema, { base })` service on the host and `settingsScope.bind` on the client, with a per-provider `legacySchema`/`legacyBase`, `*_SETTINGS_SCHEMA`, exported `*_SETTINGS_NAMESPACE` constants and a `volatilize` helper that called `.volatile()` only when schemastery had it;
- client probes for older host shapes: `typeof configForms.whileServed !== 'function'`, the `SessionListState.current` fallback in `mainSessionId`, and the `interactions` array in `selectCliMember` (its comment had the old and new shapes reversed);
- an optional probe of `interruptedTurnClosers`, exported by `@deepseek-ai/dsh-session` since 0.1.5-rc.1;
- "core too old" duck-typing inside the family (`ensureChildLive`, `trackDelegationRun`, `syncChildSession`, `reportAuthFailure`, `recordRoundSettled`, `activeDelegations`), although pack-dist publishes `workspace:*` as `^<version>`, so a provider never runs against an older core;
- leftovers of the removed DeepSeek delegation switch in `local-agent-dsh` (`enabled` in the config, schema and resolved settings; a write-only `generation`; `currentEnabled`; an empty `unwatch`; a card description that still mentioned a toggle);
- the four 0.1.5-era `XxxSettingsCard` components that nothing registers, and test-only exports (`assertModelExecOnly`, `assertScopeExecOnly`, `listDelegations`).

## Decision

- The floor becomes host 0.2.0: `engines.dsh` is `>=0.2.0-rc.1 <0.3.0-0` and `dsh.compat.minHost` is `0.2.0-rc.1` (the host evaluates the range with `includePrerelease`). Compat notes and the README Compatibility sections drop the 0.1.5 / 0.1.7-alpha lines.
- `settingsFace` keeps only the row-config path (`read` plus `settings/document-updated`). `bindSettingsScope` keeps only the deferred `configForms` probe; it still degrades to an unavailable scope without the settings client.
- Providers mark their settings fields with `.volatile()` directly. The schemastery dependency floor moves to `^3.18.4`, the version host 0.2.0-rc.1 vendors and the first with `.volatile()`.
- Intra-family calls go straight to the core. Probes that guard against the core not being provided at all stay (`ctx.get('localAgent')` returning undefined in `persistChildSession` and the live drivers).
- `local-agent-dsh` registers once at startup with no switch state. A profile row that still carries `enabled: false` is accepted: schemastery objects are non-strict, and the real-composition spec now boots with that key.
- The four standalone `XxxSettingsCard` components, their props types and their chrome CSS are deleted. Their behavioral specs now render `XxxCardSection`. The two kimi specs that tested the collapsed-header credential dot were removed with the header. Generated `icons.tsx` modules that no longer have an importer were deleted.
- `assertModelExecOnly`, `assertScopeExecOnly` and `listDelegations` are deleted. Their tests use `getDelegation` or were removed. `readSubProfilePreset` and `readSubProfilePermissions` stay because `docs/reference.md` documents them as `./provision` API.

## Alternatives considered

**Keep the dual-line code until 0.3.0.** Rejected: no deployment runs below 0.2.0, and each branch was untested against a real old host. It kept test fakes of the 0.1.5 settings service alive and could hide regressions on the path that actually runs.

**Drop the model brokers' `setMemberModel` probe in the same pass.** Deferred: when the core lacks `setMemberModel`, the probe falls back to a whole broker-local override store and runtime-retire path with its own tests. Removing it is a behavior decision, not probe cleanup.

**Remove the standalone `plugins.item` fallback for cores without `registerHarnessCard` (B7).** Not done here (investigate-only); see Consequences.

## Consequences

- Hosts below 0.2.0 refuse these packages at install instead of half-working.
- Provider `apply` specs drive settings the way the host does: volatile `{ get() }` references plus a `settings/document-updated` emit, which replaces the fake `settings.register` service.
- Left in place, still guarded: the `setMemberModel` broker probes; claude-code's `recordRoundSettled` probe in `live-driver.ts` (that file was owned by concurrent work); the `interruptedTurnClosers` probe in `child-log-guard.ts` (outside the listed items); and the standalone `plugins.item` card fallback. Because `registerHarnessCard` is a same-version core API, that fallback now fires only when the core client is not composed. It is a candidate for a follow-up pass.
