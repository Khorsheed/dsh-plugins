# Agent Note: local-agent run progress — provider-reported + facade heartbeat, reattach opt-out

Status: implemented

English | [中文](2026-08-19-local-agent-run-progress.zh.md)

## Problem

A facade-started delegation run was invisible until it settled: a caller (room) could not render "in progress", and the only progress-adjacent data (kimi's mirrored-line count) sat in the registry's own bookkeeping. The proposal's M2 draft had the facade heartbeat read `kimiMirroredLines` off the registry — rejected in review as a cross-package smell: the facade would reach into provider-specific bookkeeping, and progress would be limited to what the facade happens to know. Progress must be **provider-reported**; the facade only forwards. This is milestone M2 of the [delegation-API proposal](../../../proposals/closed/2026-08-18-local-agent-delegation-api.md).

## Decision

Three additions to the M1 facade (`packages/local-agent`):

- **`LocalAgentRegistry.reportRunProgress(childSessionId, progress)`** — the provider-facing reporting channel. The registry re-emits every report as the cordis event `localAgent/run-progress(childSessionId, progress)` (declared in the `Events` augmentation after the `localAgent/harness-added` precedent) and routes it to the `opts.onProgress` callback of the matching facade-tracked run. Reports for untracked child sessions still emit the event — a run tracked only by its provider stays observable — and invoke no callback.
- **Facade heartbeat**: while a facade-tracked run is in flight, the registry reports `{ kind: 'heartbeat', elapsedMs }` (through `reportRunProgress`, so event and callback stay in lockstep) every `RUN_PROGRESS_HEARTBEAT_MS` (5s), measured from run registration. The timer is `unref()`'d so it never keeps the process alive, cleared on any settle of `run.result`, and all heartbeat timers are cleared on plugin dispose. The heartbeat carries NO provider data — mirrored-line counts arrive only via provider reports.
- **`opts.reattach`** on `DelegationCallOptions` (default true): `false` makes `resume` fail loud on a non-live child session, skipping the M1 reattach recipe — the pre-facade behavior.

`LocalAgentRunProgress` (in `types.ts`) is the union `{ kind: 'heartbeat', elapsedMs } | { kind: 'mirror', mirroredLines } | { kind: 'delta', text }`; the `delta` member is declared now so M3 needs no type change, and no provider emits it yet.

The kimi provider reports `{ kind: 'mirror', mirroredLines }` from `mirrorKimiAfterExit` (the provider, which owns the registry call conventions — not the mirror module) right after `setKimiMirroredLines`, so observers reading the offset in response see the new value. No live tailing — that is M3.

## Alternatives considered

- **Facade heartbeat reading `kimiMirroredLines` (proposal's M2 draft)** — rejected in review: the facade would reach into kimi-specific bookkeeping, and progress would be capped at what the facade knows. Provider-reported progress keeps provider data with the provider; the facade stays a dumb forwarder and the heartbeat degenerates to a pure liveness signal.
- **`onProgress`-only delivery without the cordis event** — rejected: room subscribes at the plugin level, not per call, and provider-only runs (started via the model tool) have no `opts` to carry a callback — the cordis event is the only channel that covers them.
- **Emitting the cordis event only for tracked runs** — rejected: a provider-resumed run the facade never saw would go silent; observability must not depend on which entry point started the run.
- **Leaving `LocalAgentRunProgress` open via a generic record instead of declaring `delta`** — rejected: a closed union forces M3 call sites into the typed shape and costs nothing now.

## Consequences

- A facade caller renders "in progress" with zero provider support (heartbeat), and gets real data the moment a provider reports it; plugins observe every family run — facade- or tool-started — through one cordis event.
- Providers gain one new registry call convention (`reportRunProgress` after each mirror); kimi implements it, codex/claude/dsh inherit the convention when their mirrors adopt it (no forced change — reporting is additive).
- `resume` callers can pin the pre-facade absent-child behavior with `reattach: false`; the default stays reattach-on.
- The heartbeat is per tracked run: many concurrent runs mean many 5s timers, all unref'd and settle-cleaned — accepted as negligible.
- Live transcript deltas (`{ kind: 'delta' }`) remain undelivered — that is M3, provider by provider.

## Testing

`packages/local-agent/tests/delegation-facade.spec.ts` adds six tests: heartbeat fires during an in-flight run and stops at settle (fake timers) and on plugin dispose, provider reports route to the matching run's `onProgress` and the cordis event (two runs stay separate), untracked-child reports still emit the event without throwing, and `reattach: false` fails loud on a non-live child (staging nothing, preparing nothing) while succeeding on a live one. `packages/local-agent-kimi/tests/kimi-cli-provider.spec.ts` adds the mirror-report assertion (`{ kind: 'mirror', mirroredLines: 2 }` after the settle-time mirror) and `reportRunProgress` stubs on the fake `localAgent` services. Suites: local-agent 95/95, local-agent-kimi 55/55, local-agent-tool-subagent 10/10.

## Cross-references

- [Delegation-API proposal](../../../proposals/closed/2026-08-18-local-agent-delegation-api.md) — the milestone plan this implements (M2).
- [Delegation facade](2026-08-18-local-agent-delegation-facade.md) — the M1 facade this extends.
- [dsh sub-agent session mirror](2026-08-18-local-agent-dsh-session-mirror.md) — the settle-time mirror the kimi report follows.
