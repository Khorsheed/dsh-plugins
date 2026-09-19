# Agent Note: local-agent public delegation facade (start / resume / cancel) with the reattach recipe

Status: implemented

English | [中文](2026-08-18-local-agent-delegation-facade.zh.md)

## Problem

Plugins acting on the user's behalf (the proposed room plugin, future orchestrators) had no supported way to delegate to a local coding-agent CLI: the family's delegation protocol — per-(parent, provider) intent FIFO, resume locks, ownership-checked delegation records — was only reachable by re-implementing the model tool's internals, and a naive re-implementation re-opens the orphan-intent window (a staged intent left in the FIFO when `ctx.subagents.start()` throws before the provider consumes it gets misconsumed by the next same-(parent, provider) start). Cross-restart resume had a second gap: the dsh child session is not live after an in-process unload, and the family providers fail loud on that. This is milestone M1 of the [delegation-API proposal](../../../proposals/active/2026-08-18-local-agent-delegation-api.md).

## Decision

`LocalAgentRegistry` (`ctx.localAgent`) grows a public facade in `packages/local-agent/src/index.ts`:

- `start(parentSessionId, provider, prompt, opts?)` / `resume(parentSessionId, provider, childSessionId, prompt, opts?)` — one call performs the provider pre-check, (resume only) the unchanged `resolveDelegation` ownership check and the new read-only `isResumeLocked` probe, live-parent resolution via `ctx.agents.get`, the reattach recipe below, then stages exactly one intent and awaits `ctx.subagents.start()` in the same synchronous flow. A start failure rolls the intent back through the new `unstageDelegationIntent` (removes the exact intent object by reference; a no-op once the provider consumed it) — closing the orphan-intent window for facade callers.
- `cancel(childSessionId)` aborts the registry-owned `AbortController` tracked per in-flight run (fused with the caller's `opts.signal` via `AbortSignal.any`, the harness's own fusion primitive); the entry clears itself on any settle of `run.result`. Miss returns `false`.
- `DelegationCallOptions` (`{ label?, signal? }`) is deliberately additive — `onProgress`/`reattach` arrive with later milestones.
- The registry hard-injects nothing new: `subagents` / `agents` / `sessions` / `sessionPersistence` are read lazily via `ctx.get` and a facade call that needs an absent service throws an error naming it (degrade-don't-explode for the core, fail-loud for the call).

**The reattach recipe** uses a cached write handle to read stored events, prepares the child, appends the constructor suffix, and enters then announces the restored live session. The detach disposer and write handle stay owned until plugin disposal; a failed announcement rolls both back. The former enter-only decision is superseded by the [member history continuity fix](../bug-fix/2026-09-19-member-stream-replay.md): creation observers must see the new process lifecycle and constructor suffix even though no host agent runs on the CLI child.

## Alternatives considered

- **`enter` + `announce` (mirroring `agentLoop.resume`'s publish)** — rejected: `announce` exists to emit `session/created`, and re-firing creation for an already-created identity re-runs creation listeners on a restore; nothing in the resume path consumes that event.
- **Heavy `ctx.agentLoop.resume()` for the absent child** — rejected (proposal §现状): it brings up a full agent loop, the wrong tool for a transcript-container child session with no agent driving it.
- **Hand-rolled abort-signal fan-out for `cancel()` + `opts.signal`** — rejected: `AbortSignal.any` is the primitive the harness itself uses (agent-loop's resume), one line and no listener bookkeeping.
- **Hard `inject` of `subagents`/`agents`/`sessionPersistence` into the core** — rejected: the core must install and run alone (AGENTS.md); lazy `ctx.get` keeps the record-and-login composition working unchanged while facade calls fail loud naming the missing service.

## Consequences

- Room and similar plugins can delegate, resume, and cancel with one call each, without touching the intent FIFO; the resume handle still never enters prompt text, and the three family invariants (ownership check, exactly-once pairing, one in-flight resume per child) are preserved — the ownership check guards plugin callers against mistakes, not against malice (same-process trust), which the doc comments state.
- `unstageDelegationIntent` also fixes the pre-existing orphan-intent window for any caller that adopts it; the model tool path is deliberately untouched (byte-identical behavior) — its window closes when it later routes through the facade.
- In-process-unloaded child sessions resume through the reattach recipe; **cross-restart resume still does not work** until M4 persists the delegation mapping (`resolveDelegation` misses after a restart) — the milestone boundary is intentional.
- `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-subagent` join the core's peerDependencies (the facade's public types); runtime load without them is unaffected — the imports are type-only.

## Testing

`packages/local-agent/tests/delegation-facade.spec.ts` (15 tests) mounts the real SessionStore/CommandRuntime/AgentRegistry with a fake `subagents` provider (recording intent consumption) and a fake `sessionPersistence.prepare` that rebuilds through the real store: fresh-start pairing + run tracking + settle cleanup, resume with and without reattach, reattach release on plugin dispose, every fail-fast path staging nothing, both orphan-rollback arms, and cancel hit/miss plus caller-signal propagation. `pnpm --filter @khorsheed/dsh-local-agent test` (89 tests) and `pnpm --filter @khorsheed/dsh-local-agent-tool-subagent test` (10 tests) stay green with the tool package untouched.

## Cross-references

- [Delegation-API proposal](../../../proposals/active/2026-08-18-local-agent-delegation-api.md) — the milestone plan this implements (M1).
- [CLI sub-agent resume](2026-08-16-local-agent-resume.md) — the tool-side resume mechanism the facade wraps.
- [dsh sub-agent session mirror](2026-08-18-local-agent-dsh-session-mirror.md) — the transcript mirroring the reattached child session receives.
