# Agent Note: local-agent live settings card M2 — codex replication (settings-driven generations + settings card)

Status: implemented

English | [中文](2026-08-27-local-agent-live-settings-card-m2-codex.zh.md)

## Problem

M1 proved the live settings card pattern on kimi (settings namespace with the YAML config as composition base, hot driver generations via `LiveDriverSwitch`, the shared `ProviderAuthBlock` card). The codex provider still had its live driver frozen at apply time from the Cordis config — flipping `live` meant editing profile YAML and reloading. This is milestone M2 (codex replication) of the [live settings card proposal](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md); the [M1 note](2026-08-27-local-agent-live-settings-card-m1.md) owns the pattern's rationale.

## Decision

The codex package replicates the M1 template file-for-file, with codex-shaped names and one structural difference (the driver config carries a sandbox policy):

- **Host**: `src/index.ts` registers the `local-agent-codex` settings namespace (`live` / `liveMirrorGranularity`; `liveIdleMs` stays YAML-only) with the Cordis config as the composition `base`, injects `settings`, and hands the provider `liveSwitch.resolve`. The new `src/live-switch.ts` is the kimi `LiveDriverSwitch` verbatim except the generation constructor also forwards `sandbox` (codex's driver config requires it where kimi's did not). `CodexLiveDriver` grew the drain trio — `draining` flag with the two refusal checks (`startRound` entry and the dequeue point in `startRoundLocked`, so a queued round dequeues into the refusal instead of reaching the wire), `hasRuntime(key)`, `setLiveMirrorGranularity()` — and `CodexCliProvider` takes the per-member resolver `(childSessionId) => driver | undefined` at both call sites (fresh/resume), a bare driver still accepted.
- **Mirror persistence fix (the M2 mirror check)**: codex's fold paths had the same defect kimi's M1 mirror fix cured — three full-event-list `sessionPersistence.append(id, session.events)` calls on live sessions (the live driver's `persist()`, the exec live mirror's flush, and `appendCodexResponse`'s settle persist). All three now route through a shared `persistIfStandalone(ctx, childSession)` in `codex-cli-provider.ts` (exported for the live driver): a session registered with the sessions service persists through its own write-behind pipeline, and re-appending the full list violates the store's contiguous-seq contract. The live driver's round-start `user/message` self-write already existed — confirmed, untouched. Token-granularity stream/fold duplicate rendering stays out of scope (the proposal's recorded follow-up).
- **Client**: the codex package grew the same browser half as kimi — `settings.plugin.item` card keyed `local-agent-codex` (title `Local Agent · Codex`), the core's shared `ProviderAuthBlock` with `harness={{ id: 'codex', label: 'Codex' }}`, the live block (switch, granularity radios, override badge + restore, ⓘ hover copy), including the mandatory `import type {} from '@khorsheed/dsh-local-agent/remote'` line. Build face: `dsh.client` + `./client` export, `clientBundle('@khorsheed/dsh-local-agent-codex', ...)`, tsconfig split into host/client projects, `src/css-modules.d.ts`. The CSS module is the kimi card's stylesheet verbatim (comment header renamed) — the card chrome is meant to be identical across the family.

## Alternatives considered

- **Reusing kimi's `LiveDriverSwitch` from a shared family module instead of copying it** — rejected: the switch is 90 lines typed against each provider's own driver class; a shared abstraction would need a driver factory parameter for one call site per package, and the M1 note deliberately scoped sharing to the client auth block (the part that is byte-identical). The host halves stay per-provider copies, cheap to audit side by side.
- **Leaving the codex persistence appends as they were** — rejected: the kimi root cause (the 'append seq mismatch' throw killing the mirror pass before the offset advanced, then re-folding duplicated lines) applies to codex's identical full-list appends verbatim; the proposal's M2 brief made this mirror check mandatory.

## Consequences

- Two of four providers now hot-switch live from the settings page; claude-code and dsh remain for the rest of M2 (same template; dsh extends its existing namespace and absorbs the `enabled` toggle into its own card).
- `persistIfStandalone` lives in `codex-cli-provider.ts` (codex has no `session-mirror.ts` — its fold code sits in the provider/live-driver pair), exported so the live driver shares it; the kimi original stays module-private in `session-mirror.ts`.
- The codex package now has a client face (identity triangle intact: `cordis.patch.yml` row id, `clientBundle` id, `invariant.ts` PACKAGE_NAME all `local-agent-codex` / `@khorsheed/dsh-local-agent-codex`).
- Real-instance acceptance (3080: card toggle → live round → drain on off → exec fallback; one re-auth round trip through the card) is pending — kimi + codex only, per the proposal; claude-code exempt.

## Testing

- codex host: `apply.spec.ts` rewritten around a fake settings service (namespace registration, base carries the YAML payload, off/on/hot-switch/granularity-rides-generation — the pre-existing provisioning assertion kept); `live-driver.spec.ts` +6 (drain refuses new rounds immediately, in-flight round finishes then reclaims, queued round dequeues into refusal, granularity flips without rebuild, resolver gates to exec, resolver backward compat — the kimi suite ported onto the existing FakeAppServer fixture, driving hung turns with `fake.runTurn`).
- codex client: `settings-card.client.spec.tsx` (9: three-state render, scope-routed writes, badge appear/disappear, restore-default, unavailable disables controls, in-card login flow) and `locales.client.spec.ts` (2: namespace ownership, zh/en key parity). 90 total green (was 69).
- Gates: `pnpm --filter @khorsheed/dsh-local-agent-codex build` and `test` both exit 0; `check:plugins` 0 findings; `check:hygiene --all` 0 findings.

## Cross-references

- [Live settings card proposal](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md) — the milestone plan this implements (M2, codex half).
- [M1 kimi template note](2026-08-27-local-agent-live-settings-card-m1.md) — the pattern this replicates and its rejected alternatives.
- [Live driver proposal](../../../proposals/closed/2026-08-20-local-agent-live-driver.md) — the four drivers this switch hot-swaps.
