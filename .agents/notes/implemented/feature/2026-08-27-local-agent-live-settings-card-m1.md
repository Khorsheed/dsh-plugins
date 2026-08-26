# Agent Note: local-agent live settings card M1 — kimi template (hot-swappable driver generations + per-provider settings card)

Status: implemented

English | [中文](2026-08-27-local-agent-live-settings-card-m1.zh.md)

## Problem

The live driver's configuration (`live`, `liveMirrorGranularity`) was Cordis loader config only: flipping it meant editing profile YAML and reloading the plugin — invisible to end users. The official Plugins → 可配置插件 tab has a keyed card slot (`settings.plugin.item`) with family precedents (ui-shortcuts, context-guard), and the live-driver proposal deliberately left this configuration face out of scope. This is milestone M1 (kimi template) of the [live settings card proposal](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md).

## Decision

**Three-tier config, native to the settings service.** Each provider registers a settings namespace (`local-agent-kimi` here) with the Cordis config as the composition `base` layer (`ctx.settings.register(ns, schema, { base })`): resolution is schema defaults ← YAML ← user layer, so the card stores only deliberate overrides, and "restore default" is simply clearing the user-layer field (`scope.unset`). No hand-rolled merge anywhere.

**Hot switching by driver generations, never by interrupting work.** `packages/local-agent-kimi/src/live-switch.ts` (`LiveDriverSwitch`) watches the scope and mirrors the resolved value into driver generations:

- Toggle ON builds the next generation lazily (no process until the first round). Toggle OFF retires the current generation via a new `driver.drain()`: new rounds are refused with `LiveChannelUnavailableError` (the provider's existing catch falls back to exec), in-flight rounds finish on their runtime undisturbed, idle runtimes are reclaimed immediately. `drain()` is deliberately NOT `disposeAll()` — unload still disposes (interrupts), settings changes drain (never interrupt).
- A granularity change rides the SAME generation (`setLiveMirrorGranularity` — the driver reads granularity per round), so flipping 按消息折叠/逐字流式 never recycles a process.
- Handoff gate: the provider now takes a per-member resolver `(childSessionId) => driver | undefined` (a bare driver still works — backward compatible). While a retiring generation still hosts a member's runtime, that member's next round resolves to undefined → exec, so two processes never load the same kimi session. Same-child concurrency was already impossible (the resume lock); the gate closes the spawn-in-flight corner.

**Client: one card per provider, shared auth block from the core.** The kimi package grew a browser half (`settings.plugin.item` card keyed `local-agent-kimi`): the family core's new shared `ProviderAuthBlock` (extracted byte-identically from `LocalAgentSettingsSection`, which now composes it — the section stays until M3) plus the live block (switch, granularity radio, override badge + restore). Explanation copy sits behind ⓘ hover/focus bubbles (official `Tooltip`), so card rows stay one line each. The card reads the core's gateway Remote lazily via `ctx.get('remote.localAgentGateway')`, so boot order between the two client plugins never matters.

## Alternatives considered

- **Re-registering the provider on every settings change (the dsh `enabled` toggle's generation pattern)** — rejected: dsh's toggle swaps whole registrations because it gates existence; the live switch gates a MODE, and re-registering the provider mid-round would strand in-flight run bookkeeping. Draining the driver keeps the provider registration stable.
- **Hand-merged `settings ?? yaml ?? default` reads** — rejected: the settings service's composition base already implements exactly this, including the user-presence signal the override badge needs; duplicating it invites drift.
- **Rebuilding the driver on granularity changes** — rejected: granularity is read per round; a rebuild would kill resident runtimes for a display-only preference.
- **Keeping the ⓘ explanations as always-visible body copy (the proposal's first sketch)** — rejected per review: the card stays one line per row; hover bubbles carry the prose.

## Consequences

- `KimiAcpLiveDriver` grew `drain()`, `hasRuntime(key)`, and `setLiveMirrorGranularity()`; M2 (codex/claude-code/dsh) must replicate all three per driver — the drain semantics are the part to get right (rounds chain synchronously at `startRound`, so the drain snapshot sees every accepted round).
- The kimi package now has a client face (`dsh.client`, `clientBundle('@khorsheed/dsh-local-agent-kimi')` — identity triangle intact); its tsconfig split into host/client projects, with the host project auto-including new host sources like `live-switch.ts`.
- Downstream consumers of the core client types must `import type {} from '@khorsheed/dsh-local-agent/remote'` themselves: declaration emit elides the core's own empty type-only import, and the gateway type silently degrades to `any` under skipLibCheck otherwise. Every M2 client needs that line (documented in the kimi client's header comment).
- The auth block is a pure UI move: zero host-side auth/credential code changed (the review's red line — claude-code's auth is currently broken and untouched).

## Testing

- kimi host: `apply.spec.ts` rewritten around a fake settings service (namespace registration, base carries the YAML payload, off/on/hot-switch/granularity-rides-generation); `live-driver.spec.ts` +6 (drain refuses new rounds immediately, in-flight rounds finish then reclaim, queued round dequeues into refusal, granularity flips without rebuild, resolver gates to exec, resolver backward compat). 105 total green.
- client: core `provider-auth-block.client.spec.tsx` (9, incl. two section-vs-block parity suites — the 14 pre-existing section tests pass unchanged), kimi `settings-card.client.spec.tsx` (9: three-state render, scope-routed writes, badge appear/disappear, restore-default, unavailable disables controls, in-card login flow).
- Repo-wide: `pnpm run build` and `pnpm run test` both exit 0 (22 packages); `check:plugins` 0 findings; `check:hygiene --all` 0 findings.
- Real-instance acceptance (3080: card toggle → live round → token flow → off → exec fallback; one re-auth round trip through the card) is pending — kimi + codex only; claude-code exempt per the proposal (auth currently broken there).

## Cross-references

- [Live settings card proposal](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md) — the milestone plan this implements (M1).
- [Live driver proposal](../../../proposals/closed/2026-08-20-local-agent-live-driver.md) — the four drivers this switch hot-swaps.
