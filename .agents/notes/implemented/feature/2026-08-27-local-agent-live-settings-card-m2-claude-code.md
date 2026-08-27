# Agent Note: local-agent live settings card M2 — claude-code (hot-swappable driver generations + per-provider settings card)

Status: implemented

English | [中文](2026-08-27-local-agent-live-settings-card-m2-claude-code.zh.md)

## Problem

Milestone M2 of the [live settings card proposal](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md): replicate the M1 kimi template ([the M1 note](2026-08-27-local-agent-live-settings-card-m1.md)) onto the claude-code provider so its live mode (`live`, `liveMirrorGranularity`) becomes a user-level, hot-swappable preference in the official Plugins → 可配置插件 tab instead of reload-gated YAML. Claude's live driver is the stream-json realtime mode (control-protocol interrupt, per-runtime turn chain) rather than kimi's ACP session, so the drain semantics land on a different runtime shape; the fold path also needed the kimi `persistIfStandalone` mirror fix audited.

## Decision

**Host: the M1 three-tier pattern, verbatim.** `packages/local-agent-claude-code/src/index.ts` registers the settings namespace `local-agent-claude-code` (schema identical to kimi's) with the Cordis config as the composition `base`; the new `src/live-switch.ts` (`LiveDriverSwitch`) watches the scope and mirrors the resolved value into driver generations. Claude's one structural difference from kimi: a driver generation's config also carries the Cordis-only fields `permissionMode` and `baseUrl`, so the switch's constructor takes a `driverBase` (`Pick<Config, 'permissionMode' | 'baseUrl'> & { liveIdleMs? }`) that every generation inherits.

**The drain triplet on the stream-json driver.** `ClaudeLiveDriver` grew `draining` + `drain()`, `hasRuntime(key)`, and `setLiveMirrorGranularity()`, with the two refuse-new-round checks at `startRound` (before chaining, so the exec fallback never queues behind in-flight work) and at `startRoundLocked` (the chained-before-drained dequeue race). The kimi note's warning — rounds chain synchronously at `startRound`, so the drain snapshot sees every accepted round — holds for claude's identical `roundChains` shape; the refuse point additionally rides the per-runtime turn chain, but the round-level chain is the gate.

**Provider per-member resolver.** `ClaudeCliProvider` now accepts a driver OR a resolver `(childSessionId) => driver | undefined` (backward compatible, same as kimi) and resolves per round at both call sites (fresh and resume).

**Mirror audit: the fold path had the full-list append — fixed kimi-style.** `createClaudeLiveMirror` (the exec path's live fold) and `appendClaudeResponse` (the settle mirror) in `claude-cli-provider.ts` both called `sessionPersistence.append(childSession.id, childSession.events)` with the full event list. Both now go through an exported `persistIfStandalone` copied from kimi's `session-mirror.ts` (live sessions persist themselves through write-behind; the full-list append violates the store's contiguous-seq contract). The live driver's own `persist()` had the same full-list append and got the same fix — a silent production no-op before (its errors were swallowed by `persistQueue`), now skipped for live sessions. The live driver's round-start `user/message` append (the M1 streaming-order fix) was already present (live-driver.ts turn boundary) — confirmed, no change. Token-granularity stream/fold double-rendering is explicitly out of scope this round.

**Client: the kimi card, copied.** The package grew a browser half: `settings.plugin.item` card keyed `local-agent-claude-code` (`src/client/` — index, SettingsCard.tsx + module.css, locales.ts), the family core's shared `ProviderAuthBlock` with `harness={{ id: 'claude-code', label: 'Claude Code' }}`, the live block (switch, granularity radio, override badge + restore), ⓘ hover explanations, and the lazy gateway read. The auth block is a pure UI reuse — zero host-side auth/credential/login code touched (the red line); claude's manual-handoff login (pty + code paste) surfaces through the block's existing capability flags. `dsh.client`, the `./client` export, `clientBundle('@khorsheed/dsh-local-agent-claude-code', ...)`, the tsconfig host/client split, and `src/css-modules.d.ts` complete the identity-triangle-preserving client face.

## Alternatives considered

- **Leaving the live driver's `persist()` on the full-list append** (narrowest reading of the M2 mirror-audit scope) — rejected: it is the same kimi root cause (contiguous-seq violation), the append could never succeed for a live session, and the fix is a one-line reuse of the helper the audit already mandated; the report flags it as the one extension beyond the enumerated fold paths.
- **A claude-specific drain on the runtime turn chain instead of the round chain** — rejected: kimi's round-chain snapshot is the proven semantics, claude's `roundChains` has the same synchronous-chain property, and diverging would make the four-family template drift.
- **Skipping the card's auth block while claude auth is broken upstream** — rejected: the block degrades through the status capability flags by design, and the proposal exempts claude from real-instance acceptance, not from shipping the card.

## Consequences

- The claude-code package now has a client face and the same host/client tsconfig split as kimi; its `inject` grew `'settings'`, so a host without the settings service no longer boots the plugin (same M1 trade-off — official hosts all ship it).
- M2's remaining replications (codex, dsh) now have TWO templates for driver-config shape: kimi (granularity-only) and claude (extra Cordis-only fields via `driverBase`).
- The `persistIfStandalone` fix changes production persistence behavior of the exec-path mirrors: live sessions no longer see a (previously always-failing) full-list append; standalone sessions (tests, ad-hoc mirrors) keep it.

## Testing

- `apply.spec.ts` rewritten kimi-style around a fake settings service (namespace registration, base carries the YAML payload, off/on/hot-switch/granularity-rides-generation) while keeping the pre-existing pty-login harness assertions.
- `live-driver.spec.ts` +6: drain refuses new rounds immediately, in-flight rounds finish then reclaim, a queued round dequeues into the refusal, granularity flips without a rebuild, resolver gates to exec, resolver backward compat — on the existing FakeClaude fixtures.
- Client: `settings-card.client.spec.tsx` (9: three-state render, scope-routed writes, badge appear/disappear, restore-default, unavailable disables controls, in-card login flow asserting `/claude-code login`) and `locales.client.spec.ts` (en/zh key parity). 83 total green (host 72 + client 11).
- `pnpm --filter @khorsheed/dsh-local-agent-claude-code build` green; `check:plugins` 0 findings; `check:hygiene --all` 0 findings.
- Real-instance acceptance: exempt per the proposal (claude-code auth is currently broken upstream; kimi + codex carry M2 acceptance).

## Cross-references

- [Live settings card proposal](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md) — the milestone plan this implements (M2, claude-code half).
- [M1 kimi template note](2026-08-27-local-agent-live-settings-card-m1.md) — the pattern this replicates.
- [Live driver proposal](../../../proposals/closed/2026-08-20-local-agent-live-driver.md) — the claude stream-json driver this switch hot-swaps.
