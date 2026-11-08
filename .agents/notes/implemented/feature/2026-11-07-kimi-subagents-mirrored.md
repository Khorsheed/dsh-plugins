# Agent Note: A Kimi member's own subagents, mirrored as grandchild sessions

Status: implemented

## Problem

A Kimi member can call its own `Agent` tool, or `AgentSwarm`, which starts several subagents under one call. Kimi records every subagent in full, but dsh mirrored none of it. The member session showed a plain tool row. The subagents' spend was in no reading at all, because Kimi writes it to the subagent's own wire and never to the member's.

The approved design `proposals/active/2026-11-06-member-cli-subagents.md` (not in the repository) mirrors each subagent as a grandchild session under the member. Step M2 ([the core writer note](2026-11-06-cli-subagent-sessions-core.md)) added the writer, and step M4 ([the Claude Code note](2026-11-06-claude-subagents-mirrored.md)) is the reference integration. This note covers step M3, the Kimi integration, on both the live path and the exec path.

## Decision

A new module `packages/local-agent-kimi/src/subagent-mirror.ts` holds `KimiSubagentMirror`. It reads; the core's `openCliSubagent` writes.

**Reading the member wire.** `readKimiSubagents(sessionDir)` in `session-view.ts` reads the member wire's `subagent.spawned` and `subagent.completed` lines. It returns one entry per call, in spawn order.

- A completion belongs to the subagent's latest spawn before it.
- The n-th spawn of the same `subagentId` is a resumed call, with `ordinal` n.
- Spawns that share a `parentToolCallId` form an `AgentSwarm` group. The place comes from `swarmIndex`, which is 1-based on the wire and 0-based in the cause.
- `subagent.*` times are seconds on the wire, so they are converted to ms. Loop events are already in ms.
- `subagent.completed.usage` is the subagent's **running total**, not this call's spend. Local wires show this: each resumed completion equals the sum of all its rounds so far. A call's `providerReportedUsage` is therefore the difference from the previous completion of the same subagent. The design had assumed per-call numbers.

The design asked for `readKimiTranscript` itself to emit the list. It is a separate reader instead. Between rounds a background subagent needs the list with no member mirror pass running, and adding a field to the transcript would change every existing transcript test.

**Reading a subagent's wire.** `readKimiTranscript(dir, { agent })` and `wirePath(dir, agent)` read `agents/<agent>/wire.jsonl`. The fold is the member's own, with two differences for a subagent's wire:

- A `turn.prompt` with origin `system_trigger`/`subagent` is the call's task. It opens the next turn, so the wire has one turn per call, and it is never an injection. The member fold would have folded every resumed call into turn 1.
- `turn.ended` reasons are reported as `endedTurns`.

The member's own read is unchanged.

**Mirroring.** Each pass reads the member wire and admits every call spawned after the mirror's baseline.

- A call is admitted through `openCliSubagent` and `beginExecution`, right away and before any content. The start record then resolves the member's open execution while the round still runs. The cause carries `callId`, `name`, `group`, `background` and `resumed`, and the spawn time.
- The pass folds the call's turn, one wire step per grandchild step: the prompt as `user/message`, a `request/header` from `llm.request`, and the step's own `usage.record`.
- Mid-call, a step the wire has not closed yet holds the fold, and so does a step whose tool has no result.
- A resumed call's execution is admitted only after the previous one is closed.

**Closing.**

- **`subagent.completed`.** The turn is flushed. The execution ends `done` at Kimi's completion time, with the per-call share as `providerReportedUsage`.
- **Subagent turn ended `cancelled`/`error`.** The execution ends `cancelled` or `failed`.
- **A later spawn of the same subagent.** Kimi resumes only an idle subagent, so the earlier call is over. It ends `uncertain`.
- **Member round settles.**
  - A foreground call still open ends `cancelled`, and its cut-off step is marked `interrupted`. It ends `done` instead when its turn already ended `completed` and only the completion line lags.
  - A background call stays open. On the exec path the process has exited, so it ends `cancelled`.
- **Member process gone** (reclaim, `onDead`). Every open call ends `uncertain`.

**No backfill.** The baseline is the member wire's line count when the mirror attaches. A live round attaches after `session/new` or `session/load` and before the prompt goes out. An exec resume attaches before spawning. A fresh exec session attaches at line 0. Calls before the baseline are never mirrored, and a mirror built after a restart does not re-read history.

**Wiring.**

- **Live** (`live-driver.ts`). The driver keeps one mirror per member. It outlives the round.
  - Every member mirror pass is followed by a tail, including passes in a self-opened turn.
  - At round settle, the mirror's `settleRound` runs after `settleMirror` and before the member's turn closes.
  - `reclaim` and `onDead` call `lost()`.
  - While any call is open, a poll re-reads it every 2 s (`subagentPollMs`), even when no ACP update arrives.
- **Exec** (`kimi-cli-provider.ts`). The exec poll tails the mirror. At settle, `settleRound({ processExited: true })` runs before the turn closes.

**Background task link.** `readKimiBackgroundTasks` takes an optional `subagentSessionOf` lookup. Kimi's task state names the subagent (`agentId`). The Kimi harness's task read sets `LocalAgentBackgroundTask.subagentSessionId` only when the member's log holds that grandchild's catalog row, so the link is a recorded fact.

Every failure degrades. It is logged once, the subagent is not mirrored, and the member's round is untouched.

## Alternatives considered

**Treat `subagent.completed.usage` as per call, verbatim.** Rejected. The local wires show a running total. Taking it verbatim would count a resumed subagent's earlier calls again on every resume, and the usage-equality invariant would break.

**Mirror every spawn the member wire holds.** Rejected. That would backfill old logs, which the user decided against, and it would duplicate steps after a restart, because the fold cursor lives in memory.

**Admit a call only when its first content lands** (the M4 shape). Rejected. A background call's start record must resolve the member's execution while that execution is still open. Admitting at discovery also gives the card something to open immediately.

## Consequences

- Kimi gets no core change. The M2 API is used as is.
- A grandchild log uses the member mirror's fold and the shared step writer, so tool results are truncated by the same rules (user decision: truncation same as the member mirror).
- A reused subagent is one session, and each call is one execution and one turn (user decision).
- The sub-wire is re-read in full on each pass while a call is open (2 s poll). Kimi sub-wires reach about 1 to 2.5 MB, which is acceptable for now; an offset cursor is the next step if it shows up.
- The member's own events are unchanged apart from one `subagent/catalog` row per subagent.

## Testing

Synthetic fixtures come from builders in `tests/subagent-fixtures.ts`, and no real content is used. `tests/subagent-mirror.spec.ts` has 12 cases:

- `readKimiSubagents`: order, resume numbering, the running-total share, the 3-member `AgentSwarm` group, background `taskId`, and seconds converted to ms;
- a subagent wire numbered one turn per call;
- a foreground call mirrored mid-call, closed on completion, then resumed as the same session's second execution, with per-call usage equal to `providerReportedUsage` for each execution;
- `AgentSwarm` with 3 grandchildren;
- a call Kimi never closed, ended `cancelled` with an interrupted step;
- history before the baseline left unmirrored;
- background: open past the round, task linked, `done` later;
- background `uncertain` on `lost()`;
- exec `cancelled`;
- degrade cases;
- a mirror snapshot of a resumed subagent, whose summed call usage equals Kimi's final total;
- an exec round run with and without a home, asserting that the member's events are identical apart from the catalog row.

Every grandchild log passes `assertReleasedV4Relationships`.

Not covered: there is no live-driver ACP spec with a subagent. The wiring is the four call sites listed above. No real Kimi process was run.
