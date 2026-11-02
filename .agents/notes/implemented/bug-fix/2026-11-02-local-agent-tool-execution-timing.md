# Agent Note: External CLI mirrors preserve tool execution time in result metadata

Status: implemented

## Problem

Context Lens computed tool execution time as `tool/result.time − tool/call.time`. Kimi, Claude Code and Codex mirrors write both events only after the external result is known, so those timestamps measure mirror writing, not execution. A Kimi turn with 48 calls showed 0.1s while the original wire's parallel-adjusted execution interval was 1.579s. Real samples also showed 58.620s of Claude Code tool time mirrored as 5ms and 552ms of Codex tool time mirrored as 1ms. The host currently offers no standard execution-span field and is not accepting an upstream change.

## Decision

- The local-agent family writes a versioned transitional `tool/result.meta.localAgentTiming` with `provider`, `startedAt`, `endedAt`, and `source`. The shared constructor lives in `packages/local-agent/src/tool-timing.ts` and is re-exported through `./types`. Event envelope times continue to mean when the mirror appended the event.
- Kimi uses wire event times, Claude Code uses record timestamps, and Codex pairs incremental `item.started` / `item.completed` notification times. Result merging updates timing even for empty output. Post-hoc Codex batch parsing does not invent an interval, and incomplete or invalid spans produce no metadata.
- Context Lens reads the metadata structurally in both the live `session/event` lane and the persistence backfill lane, then replaces the mirrored `ToolExecSpan`. Missing or invalid metadata retains the legacy behavior. During aggregation, known tool execution takes precedence over unclassified request `other`; only parallel tool executions share overlap. This prevents an external mirror's coarse model-call span from halving the recovered tool time.
- `docs/upstream-proposals/2026-11-02-tool-execution-timing.md` proposes the standard `tool/result.execution` capability. Seam S23 tracks its retirement conditions.

## Alternatives considered

**Rewrite the event envelope time to the execution time.** Rejected: append time and execution time are different facts, and doing so would reorder mirrored event history and make write-side diagnostics misleading.

**Delay `tool/call` until the real start and `tool/result` until the real end.** Rejected: the mirror already receives completed items, so delaying cannot recover accurate history and would make live presentation and persistence needlessly late.

**Persist only `durationMs`.** Rejected: start and end are required to place the lane on the timeline and to deduplicate parallel executions.

**Add a Context Lens dependency on local-agent.** Rejected: the reader stays a structural, optional probe with a legacy fallback, preserving independent installation.

## Consequences

New mirrors carry accurate execution intervals without changing model-visible content, step atomicity, or released-log relationships. Context Lens is fixed; the host's own `sessionStats.toolMs` remains on the old envelope-time basis until the upstream capability lands. Old mirror logs cannot be corrected from themselves; [the model-stream and historical-timing decision](2026-11-02-external-cli-model-stream-timing.md) defines their read-only recovery from original CLI records. The transitional metadata can be removed after producers and consumers migrate to the standard field.

## Testing

Provider suites cover timestamp capture, empty results, incremental and resident Codex paths, valid released logs, and no fabricated batch timing. Context Lens suites cover live and reconstructed reads, invalid-metadata fallback, and execution-over-slack precedence (255ms stays 255ms rather than becoming 127.5ms). The original Kimi turn's read-only acceptance reconstructs all 48 intervals and a 1,579ms union.
