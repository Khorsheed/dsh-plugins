# Agent Note: the core owns the compaction fact of every `/compact` execution

Status: implemented

## Problem

Batch 5 (the unified execution entry, design `proposals/active/2026-11-03-unified-execution-entry.md`, outside the repo) requires write-side facts 3 and 4: a compaction call's usage lives only on `local-agent/compaction`, the context sizes before and after are stored separately and never read as usage, and whatever a source cannot report is marked when the fact is written. Before this step, two gaps remained:

- Claude Code and DSH members write no `local-agent/compaction` when they run `/compact`. Room guessed: a completed compaction run whose range held no compaction event was marked `unreported` (`recordCompaction`, batch 4 note `2026-11-02-room-local-agent-lens-contracts`). That was room drawing a conclusion on local-agent's behalf.
- Codex's own automatic compaction (`contextCompaction` items in live) is written with no `usage`, and nothing said whether the usage was zero, lost, or never stated.

Step S2 closes both.

## Decision

- **`LocalAgentCompactionEvent.unrecorded`** (new, optional, additive): `Array<'usage' | 'before-after' | 'summary'>` (`LocalAgentCompactionUnrecorded`). It names what the source does not report, marked at write time. Absent means the source reported every field it has. The type comment on `beforeTokens`/`afterTokens` now states they are context sizes, never usage. The event type was already registered, so nothing changes in the registration.
- **The core writes the fallback fact** (`OpenExecution.writeCompactionFact`, `packages/local-agent/src/execution-records.ts`). When a `compact` execution ends, the core checks the child log after the admission watermark. If the provider wrote no `local-agent/compaction` there, the core appends one just before the execution's end record, so it sits inside the execution's range:

  ```ts
  { source: 'manual', outcome, provider, startedAt: <admittedAt>, endedAt, boundarySeq: <last seq>,
    unrecorded: ['usage', 'before-after', 'summary'] }
  ```

  `outcome` maps from the execution: `done` → `completed`, `failed` → `failed`, `cancelled` → `cancelled`. An `uncertain` end writes no fact, since nothing is known. `provider` is the member binding's delegation provider, passed through the new optional `ExecutionAdmission.provider`. Providers that write their own fact (Kimi live, Codex manual) are untouched, and the watermark check guarantees one execution never carries two. A compaction written before the admission (an earlier auto compaction) does not count.
- **Codex automatic compaction** (`recordRoundContext`, `packages/local-agent-codex/src/live-driver.ts`) now writes `unrecorded: ['usage']`. It is written while the round settles, before its result resolves, so it lands inside that round's execution. `beforeTokens` stays when codex stated it. Codex never gives a summary or an after-count. The design names only `usage` for this case, so it is the only mark.
- **Room reads the fact's mark** (`recordCompaction` + the exported `compactionUnreported`, `packages/room/src/dispatch.ts`). The run's fact is read within the run's range, as since batch 4. The row is `unreported` when the fact marks both `before-after` and `usage` as unrecorded. It is no longer `unreported` because the range lacks an event. The text is unchanged: 「{member} 已执行压缩命令 · 该成员不报告压缩数据」 / "{member} ran /compact · this member does not report compaction data". The delivery outcome still uses `COMPACT_UNREPORTED_TEXT`. A fact with numbers is copied as before.
- **What room still stores.** `room/member-compacted` still copies `beforeTokens`/`afterTokens`/`contextWindow`/`usage`/`summary` from the fact and writes `unreported: true` from the fact's mark. The design moves "room stores no numbers, reads `readExecution`" to S6 (migration row S6, fact 3's 「room 不再存数」), so S2 leaves the copy in place. The `unreported` field stays because the room client (`RoomCompactionView`) reads it. Since S2 it is a copy of the core's mark, not an inference.

## Alternatives considered

- **`unrecorded: true` (a boolean).** The design text says `{ outcome, unrecorded: true }` in one place but defines the field as an array in the same sentence. The array is used: Codex auto needs a partial mark.
- **Each provider writes its own "unreported" fact** (claude-code, dsh). Rejected. The fact would be written in two places, and a third-party provider that ignores `operation` would still leave a gap. The core is the one place that knows an execution was a compaction.
- **Room keeps its inference as a fallback when no fact exists.** Rejected per design 「用户决定 1」 (no inference on old data). A room running against a pre-S2 core shows a plain "compacted" row with no numbers.

## Consequences

- **User-visible:**
  - For Claude Code and DSH members, a member's own Context Lens now sees a `local-agent/compaction` event after `/compact`, with no numbers. The lens source is unchanged (S8 will show `unrecorded`), so it renders like Codex's number-less compactions do today.
  - The occupancy ring (`memberContextOf`) treats a completed compaction with no after-count as "occupancy unknown until the next report", already the Codex behaviour, so the ring for those members resets after `/compact`. This is correct: the CLI did compact.
  - The room row text is unchanged.
- **Mixed versions:** a new room with an old local-agent core shows "已压缩上下文" with no numbers for Claude/DSH `/compact`, because no fact is written and room no longer guesses.
- **Deployment:** local-agent and room should ship together. The new field is optional, so old readers ignore it.

## Testing

- `packages/local-agent/tests/execution-records.spec.ts`: the existing compaction case now also asserts that the provider's own fact is the only one and carries no mark. A new case covers a compact execution whose provider writes nothing: the core writes one fact, all three marks, `startedAt` = admission, no numbers, placed between the start and end records, and an earlier compaction outside the range is ignored. A new case covers a failed compaction that gets a `failed` fact. A recorder case covers cancelled (one fact), uncertain (none), and a prompt round (none). Every stored log passes `assertReleasedV4Relationships`.
- `packages/local-agent-codex/tests/live-driver.spec.ts`: the auto-compaction case asserts `unrecorded: ['usage']`, no `usage`, and that the fact is written before the round's result resolves.
- `packages/room/tests/dispatch.host.spec.ts`: the unreported case now feeds the core's unrecorded fact. A new case shows a run with no fact is not marked `unreported`. A unit case covers `compactionUnreported` (`['usage']` alone is not unreported).
- `packages/room/tests/lens-contract.host.spec.ts`: case 6 adds a second `/compact` to the same member whose fact is the core's unrecorded one (the row carries `unreported: true`). The case adds no new member, because a new member's round would change the lens round expectations, which S8 owns. The fixture was regenerated with `UPDATE_ROOM_CONTRACT=1`, and context-lens stays green (311 tests) with no change to its source or tests.
- Not verified against a real CLI or on 3080.
