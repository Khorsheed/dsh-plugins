# Agent Note: Room, local-agent and Context Lens share one contract each

Status: implemented

## Problem

Room, the local-agent core and Context Lens exchange events and services across package lines, and each side wrote its half separately. The halves had drifted:

- The local-agent core declares `RoomMemberMessageGate`; room implemented the shape without `implements`, with its own message type whose `provenance` was optional and JSON-valued while the core sends a required `Record<string, string>`.
- Room read the member session's `local-agent/compaction` event through a cast to a room-private shape instead of the core's `LocalAgentCompactionEvent`.
- A terminal `room/run-state` took `childTurn` from the child session's LAST `turn/start` at settle time, so a run that failed before its round started claimed the previous run's round, and Context Lens filed that round's requests under both.
- `/compact` recognition existed three times (core, room dispatch, lens store), plus inline copies in room's journal and composer.
- Room's `/compact` result used `findLast('local-agent/compaction')` across the whole member log: a provider that writes no compaction record (Claude Code and DSH) showed an earlier compaction's numbers, or "compacted" with none.
- Context Lens did `Number(head)` on the run id and silently dropped runs whose id is a bare UUID (room's id for a delivery with no journaled dispatch, i.e. a confirmed relay) or missing (legacy journals).

The earlier fixes of this contract (room writes `messageId`, lens reads `cancelled` and renames) are in [the batch-0 note](../bug-fix/2026-11-02-room-lens-contract-and-family-hazards.md).

## Decision

**The gate is the core's interface.** `RoomService extends TypertRemoteService implements RoomMemberMessageGate`. Room's `RoomMemberMessage` and `RoomMemberMessageReceipt` are aliases of the core's `LocalAgentMemberMessage` and `RoomMemberMessageReceipt`. `provenance` is the core's required `Record<string, string>`: its only caller (`member-channel.ts` `handToGate`) always sends the sender's delegation view as strings, and room resolves the sender by `provenance.provider`, so an optional or JSON-valued provenance described a call that never happens. Room keeps its runtime guard for malformed calls, and the `room/relay` event still stores provenance as JSON (a relay can also come from other paths).

**Compaction facts are the core's type.** `RoomMemberCompactedEvent`'s fact fields are indexed types of `LocalAgentCompactionEvent`, and `recordCompaction` narrows the child event through the core's `SessionEventMap` augmentation. This adds no dependency edge: room already imported the core's types (`check:plugins` stays at 0).

**A run owns a range of its child log.** The running `room/run-state` edge records `childFromSeq`: the child session's next seq at admission, or 0 for a member whose session does not exist yet. `runChildEvents(roomEvents, runId, child)` in `packages/room/src/dispatch.ts` returns the child events from that seq. When the child was not loaded at admission, it returns the events written since the run's `startedAt`. A run with no running edge (never admitted) gets none, and a legacy run without an id gets the whole log. Every terminal writer derives `childTurn` from this range: settle, cancel, stop-job, move-on, reconcile and plan reconciliation. The result is the last `turn/start` inside the range, or nothing.

**One `/compact` recognizer, in the core.** `COMPACT_COMMAND` and `isCompactCommand` live in the core's dependency-free `types.ts`, exported from `./types` and the package root. Room cannot call them at runtime: it takes the core as an optional peer with type-only imports, and a value import would make room fail to load without the family. Lens has no dependency at all. So each keeps exactly one named mirror (`packages/room/src/journal.ts`, `packages/context-lens/src/room.ts`). Every former inline check goes through the mirror: room's dispatch check, its previous-cursor skip and its composer routing, and lens's round filter. The mirrors are pinned to the core by the contract tests below.

**`/compact` reports only its own run.** `recordCompaction` reads the last `local-agent/compaction` in the run's range. If a completed round wrote none, the row is journaled `unreported: true`. It then reads "ran /compact · this member does not report compaction data" (zh: 「已执行压缩命令 · 该成员不报告压缩数据」), and the delivery's outcome text says the same. Claude Code and DSH members get this state today. Claude's provider was not taught to write a compaction event: it passes `/compact` through as a prompt and never parses a compaction report from the CLI, and that report could not be verified against a real CLI in this change.

**Lens keeps every run room writes.** A `<dispatchSeq>:<memberId>` id keeps its dispatch. A bare UUID is kept under its id with no dispatch seq. A missing id becomes `legacy:<member>:<startedAt>`. In every case the member id is resolved from the member's current name. Runs without a dispatch seq form no round, but they bound the member's earlier open run and keep their child turn to themselves.

## Testing

- `packages/room/tests/lens-contract.host.spec.ts` runs room's real writers (invite with a first task, human post, rename, a stopped run, a confirmed relay, `/compact`) on a deterministic clock and normalizes UUIDs. It then compares the room log with the checked-in `packages/context-lens/tests/fixtures/room-contract.json` and fails when room changes what it writes. `UPDATE_ROOM_CONTRACT=1 pnpm --filter @khorsheed/dsh-room test` regenerates the fixture. The suite also pins room's `/compact` mirror to the core.
- `packages/context-lens/tests/room-contract.spec.ts` replays that fixture through lens's parsers and checks:
  - each human dispatch becomes a round anchored on its `messageId`;
  - neither `/compact` nor relay deliveries form rounds;
  - a stopped run reads cancelled, with room's start and elapsed times;
  - a rename addressed by the current name reaches the roster;
  - a UUID run is kept for its member;
  - a compaction run claims no child turn;
  - lens's `/compact` mirror judges every case in the fixture's table exactly as the core does.
- Room: a run that fails before its round claims no `childTurn`, while the next one claims its own. `/compact` ignores an earlier compaction and marks the round unreported. The compaction row renders the unreported state in zh and en. Lens: a UUID run bounds a stuck run's window, and a legacy run is kept.

## Alternatives considered

**Room value-imports `isCompactCommand` from the core.** Rejected: room declares the core as an optional peer and its host half is plain `tsc` output, so the import survives to runtime. Without the local-agent family installed, room would fail to load, which breaks the declare-and-degrade rule the `check:plugins` allowlist sanctions the edge under ("type-only imports, an optional peer dep").

**Room asks the facade at runtime (`localAgent.isCompactCommand`).** Rejected: room's journal replay (`previousCursor`) and its composer are pure and have no context to probe. Half the call sites would still need a local copy, so this would add a second runtime contract without removing the mirror.

**Lens takes a devDependency on room and imports room's writers in its tests.** Rejected: this would add an edge from lens to room in the package graph for test convenience, and the plan keeps lens dependency-free. A fixture generated by room's own suite gives the same coverage, and the staleness check keeps it honest.

**Only time-based run ranges (`event.time >= startedAt`).** Rejected as the primary rule: two events written in the same millisecond can land on the wrong side of the boundary. The time rule is kept only for a child that was not loaded at admission, where room cannot know a seq.

**Teach the Claude Code provider to write `local-agent/compaction`.** Deferred, not rejected. It is the better answer when the CLI reports before and after token counts, but the provider today passes `/compact` as a plain prompt, and its report format was not verified against a real CLI. The unreported state is honest until then. The DSH provider (frozen `local-agent-dsh-headless` live path) is in the same position.

**Write "is an external CLI" onto a room event for lens (`member.kind` vs lens's `IN_PROCESS_PROVIDERS`).** Not done: the two answer different questions. Lens classifies any child session, room or not, from the host's `subagent/*` provider. Room's `kind` is roster data that lens already receives on `room/member-added`. Unifying them would need a host-side fact, not a room one.

## Consequences

- A field change on the gate's message or receipt, or on the compaction event's fact fields, now fails room's compile instead of drifting.
- Context Lens no longer double-counts the previous round under a run that failed before its round began, and relay deliveries now bound earlier open runs.
- Behavior change in room: a `/compact` to a member whose provider reports no compaction (Claude Code, DSH) now reads "does not report compaction data" instead of "compacted". It no longer borrows an earlier compaction's numbers.
- Behavior change for the main agent: a report steered into the agent's running turn writes no new `turn/start`. Its run therefore records no `childTurn`, where before it claimed the turn it joined.
- Cost: the three `/compact` mirrors stay as code. They cannot drift silently, because the core's own function decides the fixture's expected values. The fixture must be regenerated whenever room's writers change, including incidental changes such as an extra `Date.now()` call, since the clock is call-counted.
