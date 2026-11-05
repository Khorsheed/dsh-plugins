# Agent Note: Context Lens reads the execution records and stops inferring attribution

Status: implemented

## Problem

Batch 5 (the unified execution entry, design `proposals/active/2026-11-03-unified-execution-entry.md`, outside the repo) step S8. Steps S1–S7 and S9 made the write side record its facts: every member execution writes `local-agent/execution` start/end records in its child session (S1), a `/compact` always leaves a compaction fact with an `unrecorded` mark (S2), codex live writes one step per call (S3), room runs carry `executionId` and a `childTurn` taken from the settlement (S5), and `room/decision` / `room/help` name their task and run (S9). Context Lens still guessed all of this from time:

| Inference (before) | Where |
|---|---|
| A run's requests = child requests within its time span ±2 s; an unended run cut at the member's next run or dispatch | `store.ts` `roomTurns` (`- 2000`/`+ 2000`), `laterRuns`, `openRunEnd`, `laterChildTurns` |
| A run without a child session id took the child catalogued closest to its start within 10 s | `store.ts` `childOfRun` |
| A decision belonged to the latest listed turn that started before it | `store.ts` `decisionsByTurn` |
| A between-turns `/compact` belonged to the turn that closed last | `log-lane.ts` `buildCliCompaction` (`lastTurnHost`) |
| Usage-less external steps were stitched into one request | `log-lane.ts` `deferred` / `flushDeferred` / `joinCall` |
| An external step's start was the previous event's time | `log-lane.ts` `MIRROR_LAG_MS` / `stepPrevAt` |
| A dispatch without `messageId` found its human message by text | `service.ts` `humanMessageBefore` |

## Decision

Lens reads the records. Decided per room round, by data, never by date or version (the design's 补充 「房间 Context Lens 对旧数据的兜底」, user-approved).

- **Round with records.** A run is recorded when it has an `executionId` or a `childTurn`. Its requests are the ones the child's records name: requests bracketed by the execution's start/end records (`StoredRequest.executionId`, set in the fold) plus requests of the turns its end record lists; without the child's records (not read yet, or a batch-4 run) the `childTurn` the room wrote. Runs only use `childSessionId` to find their child; there is no nearest match. The member view carries the execution's facts (`AgentScopeOverview.execution`: cause kind, outcome, `unrecorded`).
- **Round without records** (`TurnListItem.room.unrecorded`): no member scopes. `TurnOverview.roomFallback` lists each run's member, session and time span; the panel shows 「暂无房间维度的请求视图」 and one 「在成员会话里查看」 per member, which opens the member's own lens on the turn holding the run's start (new tab navigation `locateTime`, `openMemberSessionAt`). When no round of the session is recorded (`ListTurnsResult.roomRecords: 'none'`), the statement is shown once at the top and each round keeps only its doors.
- **未归轮 group** (`ROOM_UNATTRIBUTED_TURN`, `TurnListItem.roomUnattributed`): decision-model calls no record ties to a turn, and member compactions no recorded round claims (one with no enclosing execution, one inside an execution no room round is, e.g. a CLI auto compaction in a member-page round, a compaction of an unrecorded round).
- **`/compact` is a round.** Its run's execution brackets the compaction fact (provider- or core-written) in the member log, so the round shows it in its own 压缩 tab, with no model-request view of its own (the member view stands in only while the fact is not read). A decision naming an `executionId` lands on the round whose run is that execution. Listed last, unnumbered, never the landing turn (`isHollowTurn`).
- **Decisions.** Owner, in order: the run it names (`runId` → that run's round), the human message it filed (`about.message` → the round anchored on it), a main turn it was written inside, the task it names (`task` → the round that started the task), else 未归轮.
- **Member logs with records** (`SessionLogCursor.recorded`, set at the first `local-agent/execution` row): one `assistant/message` is one request (no stitching); a request without an original dispatch time starts at its stream's first chunk, else at its step's write time, marked `startUnrecorded`; a `per-call-usage` execution's usage step is marked `roundTotal` (整轮合计). Legacy logs (no records) keep the old fold, so a member's own lens over old history reads as before.
- **Compactions.** A between-turns CLI compaction has no turn (it is not filed under the last closed one) and carries the execution its records bracket. Its `unrecorded` marks are passed through and shown as 「未记录：用量、前后大小、摘要」.
- **Chat anchor.** A round's anchor is the `messageId` its dispatch recorded; without one there is none.

Lens stays dependency-free: `local-agent/execution` and the new room fields are read structurally (`readExecutionRecord`).

## Alternatives considered

- **Keep the time windows for old rounds, labelled 推断** (design 待定 1, option B). Rejected by the user (用户决定 1).
- **Decide per session or by host/plugin version.** Rejected by the user's 补充: per round, by data, so mixed sessions, community users on older plugins, and third-party providers that never write records all read correctly with one rule.
- **Group a call-boundaries execution's steps into one request.** Rejected: that is the stitching again. The steps stay rows, the member view says 「调用边界未记录」, and the usage row says 整轮合计.
- **Drop the legacy stitching for old logs too.** Rejected: user decision 1 keeps the member's own lens unaffected, and old codex logs would explode into per-item rows.
- **Put a `/compact`'s compaction in the member's previous round.** Rejected: no record says it belongs there; the `/compact` round's own execution does.
- **Keep `/compact` out of the rounds and send its compaction to 未归轮** (the first cut of this step). Rejected in review: the execution is a recorded attribution to that round.

## Consequences

- User-visible, room Context Lens only: old rounds show the fallback and a door into the member's lens; decisions and compactions without a recorded round move to 未归轮 (some decisions that used to sit in a round by time now sit there); a `/compact` is listed as a round of its own (numbered with the others) and shows its compaction in its 压缩 tab, no longer in the previous round's; member views show cause and not-recorded items; compaction relation line reads 「{name} 执行了 /compact」 and adds 未记录 items.
- Recorded member logs: codex exec rounds show each step as a row, the last marked 整轮合计. In a member's own lens, usage-less text-only steps with no original stream still stay history (the existing mirror-annotation rule, unchanged).
- Unchanged: per-reply 请求明细, the member's own lens over legacy logs, usage numbers.
- Not changed by this step: `attachedTurn`'s placement of main-session compaction pseudo-turns and the main-session `insideMainTurn` round test (both outside design section D).

## Testing

- `tests/room-rounds.spec.ts` (rewritten): per-round decision (legacy round fallback, batch-4 `childTurn` round, batch-5 execution round in one session), single top notice when no round is recorded, an execution never claims requests by time span, an unended execution holds its bracket, a `/compact` round's compaction in its 压缩 tab, an auto compaction in an unclaimed execution and an unrecorded round's compaction in 未归轮, decision owners by `runId` / `executionId` / `about.message` / main-turn containment / `task` / 未归轮, no text lookup for the chat anchor.
- `tests/room-contract.spec.ts`: replays room's real writers including the new `childRows` (shim-written execution records), a report-timing decision with `runId`/`task`/`executionId` and a help thread (fixture regenerated by `packages/room/tests/lens-contract.host.spec.ts`, extended for S9).
- `tests/local-agent-contract.spec.ts` (new): replays `tests/fixtures/local-agent-contract.json`, generated by the new `packages/local-agent/tests/lens-contract.spec.ts` from the real core (a live round, a codex-exec-shaped round declaring `call-boundaries`/`per-call-usage`, a core-written unrecorded compaction); also shows the same log without records folds the legacy way.
- `tests/cli-compaction.spec.ts`, `client-panel.spec.tsx`, `client-member-jump.spec.ts`, `client-aggregate.spec.ts`: the compaction's execution and marks, the fallback card and doors, the top notice, the execution note, 未归轮, `locateTime`.
- context-lens 311 → 335, room 530 → 531, local-agent 528 → 530, bundle-local-agent 5; `pnpm check:plugins` clean.
- Screenshots (1280 and 390) from `examples/workbench/room-records.html` on the real store with the local-agent fixture; not committed.
- Not verified: a live 3080 room, the door's session switch in a real host, a real codex exec log.
