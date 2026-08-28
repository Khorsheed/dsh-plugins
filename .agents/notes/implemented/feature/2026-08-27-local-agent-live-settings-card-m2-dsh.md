# Agent Note: local-agent live settings card M2 — dsh replication (enabled × live composition + row-action migration)

Status: implemented

English | [中文](2026-08-27-local-agent-live-settings-card-m2-dsh.zh.md)

## Problem

Milestone M2 of the [live settings card proposal](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md): replicate the M1 kimi template ([M1 note](2026-08-27-local-agent-live-settings-card-m1.md)) onto local-agent-dsh. dsh differs from the other three providers in two ways: it already owns a settings namespace (`local-agent-dsh`, schema `{ enabled }`) whose generation+sync controller registers/disposes the whole harness+provider+tool composition, and its DeepSeek delegation switch lives in the family core's 本地 Agent section via the `local-agent.settings.row-action` sub-slot — both had to be preserved/composed, not steamrolled by the kimi shape.

## Decision

**One namespace, three fields, composition base unchanged in shape.** `local-agent-dsh`'s schema grew to `{ enabled, live, liveMirrorGranularity }`; the YAML config's `live`/`liveMirrorGranularity` feed the register-time `base` layer exactly as in kimi (schema defaults ← YAML ← user layer). `enabled` has no YAML counterpart and stays settings-only, so the card's override badge and 恢复默认 cover the live fields only.

**`enabled` gates EXISTENCE, `live` gates MODE — and they compose by containment.** The `LiveDriverSwitch` (`packages/local-agent-dsh/src/live-switch.ts`) is constructed INSIDE one enabled generation (index.ts builds it only while harness/provider/tool are registered, and disposes it with them):

- An `enabled` flip keeps the historical hard semantics: the whole composition unregisters and the switch's `dispose()` runs `disposeAll()` — an unload, which may interrupt. The sync watcher now early-returns when `enabled` is unchanged, so a live/granularity write no longer re-registers the provider (previously any namespace write did, because `enabled` was the only field).
- A `live` flip inside an enabled generation rides the kimi semantics: the retiring driver generation is DRAINED (new rounds refused → provider falls back to exec; in-flight rounds finish undisturbed; idle runtimes reclaimed at once), the next generation builds lazily. The provider registration stays stable — it takes the switch's per-member resolver `(childSessionId) => driver | undefined` (a bare driver still works).
- A granularity flip needs no generation: `setLiveMirrorGranularity` rides the same driver, read per round.
- While `enabled` is off the live value is inert (no provider exists to resolve it) and applies when the toggle turns back on — the card leaves the live controls editable in that state on purpose: they edit a standing preference, not a running process.

**Card: the row-action seat is vacated.** The dsh client half no longer contributes to `local-agent.settings.row-action`; it registers one `settings.plugin.item` card keyed `local-agent-dsh` carrying three blocks: the core's shared `ProviderAuthBlock` (harness id `dsh` — the gateway reports `loginable/logoutable: false` for a harness without login/logout, so the block renders status only, plus a hint that credentials come from the host), the DeepSeek delegation switch (the old row-action feature, moved verbatim), and the kimi-shaped live block (switch, granularity radios, override badge + restore, ⓘ hover copy). The core's section stays until M3; only dsh's contribution left it. `DeepSeekSettingsAction.tsx` and its spec are deleted — the card supersedes them.

**Mirror fix, same bug class as kimi.** Both `mirrorDshSession` and the live driver's per-message `persist()` re-appended the FULL event list to `sessionPersistence` — for a live child session that violates the store's contiguous-seq contract ('append seq mismatch'), and in the live driver the rejected persist queue killed the settle pass before the authoritative mirror report. The new exported `persistIfStandalone` (session-mirror.ts) appends only when the session is absent from the `sessions` service; a live session's own write-behind owns durability.

## Alternatives considered

- **One fused controller re-deriving everything from `{enabled, live}`** — rejected: it would make an enabled flip drain-or-dispose distinguishable only by diffing inputs, duplicating the switch's generation logic inside the sync path. Containment (switch inside the enabled generation) keeps each toggle's semantics single-purpose: existence = unregister + disposeAll, mode = drain.
- **Disposing the live runtimes immediately on `enabled` off (today's behavior) vs draining them** — kept the hard dispose deliberately: while disabled the provider is gone, so a drained-then-idle runtime could never serve another round anyway; draining would only delay reclamation. The interrupt window is unchanged from before M2.
- **Gating the card's live controls on `enabled`** — rejected: the live fields are preferences layered over the YAML base, meaningful before the delegation is ever turned on; disabling them would imply a coupling the host composition deliberately does not have.
- **Keeping `DeepSeekSettingsAction` as a dead export for compatibility** — rejected: nothing outside the package imports it (tree-wide grep), and the checker-enforced package boundary makes the client face internal to the card.

## Consequences

- `DshLiveDriver` grew `drain()`, `hasRuntime(key)`, and `setLiveMirrorGranularity()`; its `config.liveMirrorGranularity` is now mutated per generation, so the switch hands each generation its own spread config object.
- The dsh package's client face changed shape: `dsh.client.inject` gained `@deepseek-ai/dsh-api-remotes` and `@deepseek-ai/dsh-client-ui-primitives`; peer deps gained the client packages + react (all optional); the client entry carries the mandated `import type {} from '@khorsheed/dsh-local-agent/remote'` line (see the M1 note's Consequences for why).
- `persistIfStandalone` changes persistence behavior for STANDALONE-vs-live sessions only; the exec path's `sessionPersistence.create` call is untouched, and no host-side auth/credential code changed (the proposal's red line).
- M2's remaining providers (codex, claude-code) replicate the kimi shape directly; dsh was the odd one out. M3 can now retire the section's row-action sub-slot once codex/claude-code land — dsh no longer consumes it.

## Testing

- host: `apply.spec.ts` rewritten around a fake settings service (12 tests: namespace registration + base payload, enabled on/off, inert-live-while-disabled, driver build on enabled+live, live applied on enable, hot-switch without provider re-registration, granularity riding the generation, enabled-off disposes / enabled-on rebuilds, independent toggles). `live-driver.spec.ts` +7 (drain refuses new rounds immediately, in-flight finishes then reclaims, queued round dequeues into refusal, granularity flips without a new generation, resolver gates to exec, resolver backward compat, strict-persistence live round still folds once and reports the mirror).
- mirror: `session-mirror.spec.ts` +1 (persist fires for a standalone child, never for a live one).
- client: `settings-card.client.spec.tsx` (9: default three-block render with NO login action, authenticated+on states, core-absent unavailable, enabled/live/granularity writes, badge appear/clear, unavailable disables every control) and `locales.client.spec.ts` (key parity). Package total: 90 green.
- Gates: `pnpm --filter @khorsheed/dsh-local-agent-dsh build` and `test` green; `pnpm check:plugins` 0 findings; `pnpm check:hygiene --all` 0 findings; repo-wide `pnpm run build` / `pnpm run test` exit 0.
- Real-instance acceptance is the proposal's shared M2 acceptance (kimi + codex only); dsh has no login flow, so the card's auth block is status-only by design.

## Cross-references

- [Live settings card proposal](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md) — the milestone plan (M2, dsh half).
- [M1 kimi template note](2026-08-27-local-agent-live-settings-card-m1.md) — the replicated shape.
- [Live driver proposal](../../../proposals/closed/2026-08-20-local-agent-live-driver.md) — the driver this switch hot-swaps.
