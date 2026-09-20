# Agent Note: local-agent live transcript mirroring during runs (per provider)

Status: implemented

English | [中文](2026-08-19-local-agent-live-mirror.zh.md)

## Problem

Every CLI provider mirrored its transcript into the dsh child session only AFTER the CLI process exited, so a caller watching the child session (room's "in progress" view) saw silence for the whole run. M2 added the progress channel (`reportRunProgress` → `localAgent/run-progress` event + per-call `onProgress`); M3 makes the mirroring itself live and reports each mirrored line as a `{ kind: 'delta', text }` progress. This is milestone M3 of the [delegation-API proposal](../../../proposals/closed/2026-08-18-local-agent-delegation-api.md).

## Decision

All four providers mirror live; none stays settle-only. The settle-time final mirror stays on every provider and is idempotent — when live mirroring kept up, it appends nothing.

**Durability path (corrected 2026-08-19, joint room × member-channel acceptance):** the kimi mirror's fold used to persist via `sessionPersistence.append(childSession.id, childSession.events)` — the FULL event log. That violates the coordinator's contiguous-batch contract: the first pass in a process lands (cursor 0), every later pass throws `append seq mismatch` (caught per poll as a warn), the in-memory child session accumulates re-mirrored duplicates, and the offset never advances past a restart. The mirror now persists through the session store's flush barrier (`ctx.get('sessions')?.flush(childSession)`): the persistence coordinator buffers every appended event via `session/event`, so flush writes exactly the pending delta, turn boundaries included.

- **kimi** (`local-agent-kimi`): a 2s poll (`liveMirrorIntervalMs`, injectable for tests) re-reads the kimi session's `wire.jsonl` via the existing `readKimiTranscript` once the session id is known (resume: up front; fresh: from the stderr resume hint — until then the tick skips, since the newest-session heuristic would risk cross-mirroring a concurrent delegation). Polls and the settle mirror serialize through a per-run queue, and both go through the extracted `mirrorKimiSessionDelta` fold so live and settle cannot drift. The offset stays the shared `kimiMirroredLines` bookkeeping. Two fold changes make polling safe: usage records now attach in the half-open range `(fromLines, newTotal]` (each record attaches to exactly one pass — the old unbounded `>= fromLines` filter would double-count once a round mirrors in several passes), and assistant step numbering continues from the child session's existing steps instead of restarting per pass. Accepted loss, documented in the fold's doc comment: a `usage.record` flushed only after its line was mirrored belongs to no pass (kimi flushes content and usage together per request, so this is a flush race, not the norm).
- **codex** (`local-agent-codex`) and **claude-code** (`local-agent-claude-code`): identical NDJSON pattern (`codex exec --json`, `claude -p --verbose --output-format stream-json`). Each provider's whole-stream parser was split into a per-line fold shared by the batch parse (settle, unchanged behavior) and a new incremental `CodexStreamParser` / `ClaudeStreamParser` fed from stdout `data` chunks. The live mirror flushes each completed line as it arrives EXCEPT the last line, which is held until the stream's terminal event (`turn.completed` / `result`): it may still merge a trailing tool output (`function_call_output` / `tool_result` mutate the last line) and it is the round's usage carrier — so usage keeps riding the final assistant message exactly as the settle fold places it. The per-run counters (`mirroredLines`, `userMirrored`) are the settle path's offset: the settle mirror slices the full parse from them.
- **dsh** (`local-agent-dsh`): the sub-dsh session log is readable mid-run (write-behind flushes one zstd frame per batch; the mirror's multi-frame reader already skips a torn tail frame), so the same 2s poll applies with NO new offset state: `mirrorDshSession` now skips the round's already-mirrored prefix (the child session's messages after its last `turn/start`), which makes the settle pass idempotent by construction — the note's "restart-safe by construction" property extends to live polling. It returns the newly mirrored texts + total so the provider (not the mirror module) reports progress.

Every provider reports `{ kind: 'delta', text }` per mirrored line (user prompt and folded tool/rendering text included) plus `{ kind: 'mirror', mirroredLines }` when a live pass advances and at settle (the settle report is the authoritative final count). Poll/parse failures degrade to `logger.warn`; the settle mirror remains the fallback. No `@khorsheed/dsh-local-agent` core change was needed.

## Alternatives considered

- **Usage attached by the old unbounded `line >= fromLines` filter (kimi)** — rejected: correct only when each round mirrors in ONE pass; with live polls a record trailing a batch's last line would be re-attached by the next pass (double count). The `(fromLines, newTotal]` range makes attachment exactly-once using only the existing offset (no second counter to persist in M4).
- **Holding back every assistant line until its usage record arrives (kimi)** — rejected: usage arrival is not knowable, and holding the final answer until settle would defeat liveness for the line that matters most.
- **Usage-only assistant messages for late-arriving usage (codex/claude)** — rejected: the hold-back-last-line rule gives usage its natural carrier (the final line flushes at the terminal event, before process exit), so no synthetic empty-content messages appear anywhere.
- **A shared cross-package live-mirror driver** — rejected: the fold and offset semantics differ per provider (file poll vs stream push; registry offset vs child-session prefix); the three similar driver loops stay local per AGENTS.md's no-premature-abstraction rule.
- **Buffering `function_call_output` / `tool_result` into the child session as separate lines** — rejected: the append-only session log cannot take the later merge, so the tool line is held until its result lands (the settle fold's merge semantics carry over unchanged).

## Consequences

- A watcher sees each delegation's transcript grow during the run, and room gets one `delta` progress per mirrored line through the M2 channel; settle-time content is unchanged (same events, same usage placement) when live mirroring kept up, and unchanged in total when it did not (the settle mirror always runs).
- Kimi's usage accounting is now exactly-once across passes; the two pinned resume-mirror tests still pass with the tighter range.
- Event volume is bounded: one delta per transcript line (not per token), one mirror report per advancing pass.
- codex/claude hold back the newest line until the terminal event — at most one event of lag; kimi/dsh lag by one poll interval.
- M4 inherits no new offset state: kimi keeps `kimiMirroredLines`, codex/claude/dsh keep their per-run counters / child-session prefix.

## Testing

Per provider, a scripted run with mid-run transcript growth asserts: content mirrors while the process is still running, `delta` reports fire, the settle pass adds no duplicates, and usage lands on the final assistant message. kimi: `kimi-cli-provider.spec.ts` live-growth test (offset advances 2→3, steps continue 1,2). codex/claude: held-last-line flushes at the terminal event with usage; tool-line merge before mirroring (claude). dsh: provider-level live poll test plus mirror-level incremental pass tests (`texts`/`total` returns). Regression: kimi 56/56, codex 32/32, claude 25/25, dsh 33/33, local-agent 95/95, tool-subagent 10/10.

## Cross-references

- [Run progress channel](2026-08-19-local-agent-run-progress.md) — the M2 reporting channel these deltas ride.
- [Delegation facade](2026-08-18-local-agent-delegation-facade.md) — the M1 facade (unchanged by M3).
- [dsh session mirror](2026-08-18-local-agent-dsh-session-mirror.md) — the settle-time dsh mirror this extends to live.
