# Agent Note: A round Kimi opens on its own is an execution of its own

Status: implemented

## Problem

This is step M4 of the design `proposals/active/2026-11-06-member-self-started-rounds.md` (gitignored). When a background task of a Kimi member ends while the member is idle, Kimi opens a round on its own. On the wire that round is a `turn.prompt` with `origin.kind: 'task'`, an `origin.notificationId`, and no `promptId`. Until this step:

- ACP pushes nothing for that round, so nobody watched it.
- The 11-01 fold ([kimi-fold-skips-closed-turns](../bug-fix/2026-10-27-kimi-fold-skips-closed-turns.md)) put the round's content into the human's next round. Its answer never appeared on its own, and nobody was told.

The user decided on 2026-11-06 to take every recommendation in the design. Earlier steps already landed what this one builds on:

- [member-activity-core-types](2026-11-06-member-activity-core-types.md): the `cli` caller and the `self` cause.
- [kimi-keepalive-background-tasks](2026-11-06-kimi-keepalive-background-tasks.md): the resident process stays alive while tasks run.
- [kimi-prompt-waits-for-self-turn](../bug-fix/2026-11-06-kimi-prompt-waits-for-self-turn.md): a prompt waits for a self turn, and the driver follows the wire after a collision.

Room's reporting of the round (`followUpOf`, the 「后台任务完成后继续」 line) is step M5. This step does not touch room.

## Decision

**Core: `admitSelf`** (`packages/local-agent/src/index.ts`). The call is `registry.admitSelf({ childSessionId, provider, cause, taskCallId?, follow })`.

- **Admission.** The CLI is already running the round, so it is never queued. `MemberInbox.runNow` writes a `cli` ledger row as `running` at once, and the row holds the member's slot. Executions asked for meanwhile queue behind it in the ledger. `MemberControls.hold` also holds the member's round queue, without taking a configuration lease.
- **Refusal.** `admitSelf` answers `undefined` in these cases:
  - the session is not this provider's member;
  - another row holds the slot (a dispatched round; the driver's own collision handling owns that case);
  - a row is uncertain;
  - the ledger cannot be written.
- **Record.** The child session is reattached, then one `local-agent/execution` start record is written: caller `cli`, cause `{ kind: 'self', reason: 'background-task', taskId, taskStatus, notificationId, startedBy? }`, and `task?`. Then the harness's `follow({ executionId, session, signal })` runs. Its result settles the row and the execution's end record, with the usual settle-report wait.
- **`startedBy`** follows recorded facts only. The chain is `taskCallId` (Kimi's `parentToolCallId`) → the mirrored tool call's turn → the execution whose turns hold it (`executionOfToolCall`). That execution's start `task` is copied verbatim (`executionTaskOf`), so the round's spend sums onto the task that started the work. If any link is missing, both fields are left out.
- **Restart.** A `cli` row still `running` when the ledger loads ends `failed` with `SELF_ROUND_RESTARTED`. It never turns `uncertain` and blocks nothing: nobody asked for that round, so nothing needs reconciling. At the next admission, `closeReconciled` closes its open start record with `outcome: 'uncertain'` and no `reconciled` mark. To allow that, the recorder's `reconciled` finding may now carry `reconciled: false`.

**What M5 uses.** The start record carries `cause.startedBy` and `task`. Room already observes every `local-agent/execution` start whose caller is not `room` (`observeMemberExecution`), so `cli` rounds enter that path with no change. `admitSelf` also returns `{ executionId, startedBy?, task?, settled }`. `selfExecutionOfTask` (from M1) finds the round by task id.

**Transcript: `readKimiTranscript(dir, { ownRounds })`** (`session-view.ts`).

- A self-opened `turn.prompt` whose `origin.notificationId` is in `ownRounds` numbers like a human prompt. If a fold is pending, it joins it; otherwise it takes the next turn. The human's next prompt then opens the turn after it.
- Its prompt line is still `injected: true`, so the mirror writes no user message for it. Its steps fold as usual and carry their own usage.
- Every other self-opened round keeps the 11-01 fold.
- When `ownRounds` is absent or empty, the transcript is the 11-01 one, line for line.

`ownRounds` comes from the member's own log (`ownSelfRounds`, core). It holds the notification ids of `self` start records that are followed by a `turn/start` before the next execution record. Two consumers compute it:

- The mirror (`mirrorKimiSessionDelta`) computes it from the child session it writes.
- The timing reader (`readKimiModelTiming`) receives the member's events through a new optional third argument of `LocalAgentTimingAdapter.read`.

The child log and the transcript decide from the same record, so both count a self round or both do not.

**Driver: the observer and the follow** (`live-driver.ts`, readers in `self-turn.ts`).

- **When it runs.** The observer starts on every round or preparation end (`armIdleTimer`), and when the tray read sees running tasks (`observeBackgroundTasks`). Each look `stat`s the wire every 2 s (`selfTurnObserveMs`) and reads it only when it grew. It skips while a round of ours is in flight. It stops when no task runs and no self turn is open, and with the process.
- **Which turn it offers.** `nextSelfTurn` picks the first self `turn.prompt` that meets all of these:
  - it comes after the wire's last user prompt (an earlier one was a round's to wait for);
  - it is stamped at or after the process's spawn (an unstamped or older one belongs to a process that is gone);
  - it is not handled yet. Each turn is offered once.
- **Which turns become executions.** Only a task notification that names its task, status and notification id is offered to `admitSelf`, which also needs the task's tool call: from `tasks/<id>.json`, else from the wire's `task.started`. Any other origin (`cron_job`, …) logs a warning and keeps the fold. So does a refusal, or a core without `admitSelf`.
- **The follow.** It opens the round's own turn. It folds the wire with `throughTurn` until the turn's `turn.ended`, which `readTurnAt` finds; a next prompt with no end in between reads as `interrupted`. It writes no user message. It then settles, closes the turn, records an auto-compaction if one happened, and reports the round's usage (`recordRoundSettled`). It holds the driver's round chain and the runtime's turn chain, so a reload or a prompt waits for it. A cancel, a dead process or the 10-minute bound only ends the following. `queuedTurnAbandoned` is set, so the next prompt waits for kimi's turn to end.

**`throughTurn`** (new mirror option). A unit of a later turn holds the pass, settle included, and so does a boundary usage record of that turn. Live rounds now pass their own turn. Without it, a self turn that started while a round was settling would fold into a turn the child log never opened, which corrupts the log. With it, that turn's lines wait for the execution, or for the next round, that opens the turn.

## Alternatives considered

**Put the self round through the ledger queue like any caller.** A queued row would wait behind whatever came first. Kimi is already running the round, though, so the mirror would fall behind the wire and the turn numbering would split. The design asks it to cut in line and never run concurrently. `runNow` does exactly that, and it refuses instead of waiting when the slot is taken.

**Mark the restart-cut row `uncertain` like every other caller's.** That row would block the member until an operator reconciled a round nobody sent. The design names this exception.

**Decide own rounds in the driver from its own memory.** The driver's memory dies with a restart, and the timing reader runs without the driver. The start record in the child log is the one durable fact both sides share.

**`fs.watch` on the wire.** A 2 s `stat` while work runs is enough: a self round lasts many seconds, and a short one that ends between looks is still offered, because a closed turn is followed too. A file watcher also needs per-platform care.

## Consequences

- A Kimi member's background task that ends while the member is idle now appears in the child log as a round of its own, recorded as an execution: caller `cli`, cause `self`, `startedBy`, and `task`. Room shows it as a round started elsewhere (run card, reply, end edge). Reporting it to whoever dispatched the work waits for M5.
- **Rollback.** An older core rejects the whole ledger file once it holds a `cli` row (see the core-types note). An older Kimi package never calls `admitSelf`, and start records already written read as ordinary executions to older readers. But an older Kimi mirror does not know `ownRounds`: for a member whose log already holds a self round of its own, it numbers every later wire round one turn below the child log. That is the misalignment 11-01 fixed. Roll back the core and Kimi together, and only before any self round was recorded. Otherwise the member needs a fresh session. Deploy the family together.
- The round's spend sums onto the dispatching task only when `startedBy` resolves. A task started before this step, or a tool call that was never mirrored, leaves the round without a task.
- **Not verified on a live process.** No live reproduction of a self-opened round was done: it needs a paid model call and a background task. The tests use FakeAcp plus synthetic wires.

## Testing

- `packages/local-agent/tests/run-entry.spec.ts` (real core stack), block "admitSelf":
  - the slot is taken at once;
  - the start record is caller `cli`, cause `self`, with `startedBy` and the task copied, and it lands before the round's `turn/start`;
  - a room run asked meanwhile waits in the ledger, then runs as turn 3;
  - a second self round is refused;
  - with no recorded link there is no `startedBy` or task;
  - it is refused for a non-member, for another provider, and while a round is dispatched;
  - a failed self round blocks nothing.
- `packages/local-agent/tests/member-inbox.spec.ts`: `runNow` takes the slot, queued rows wait, and a taken slot refuses. A `cli` row that a restart cut off ends `failed` with `SELF_ROUND_RESTARTED` and blocks nothing.
- `packages/local-agent/tests/execution-records.spec.ts`: a restart-cut self round closes `uncertain` without `reconciled`.
- `packages/local-agent-kimi/tests/session-view.spec.ts`:
  - with records, each self round takes its own turn;
  - a round without a record keeps the fold and joins a later owned self round;
  - with no records (an absent or empty set, or an id not on the wire), the transcript equals the 11-01 one.
- `packages/local-agent-kimi/tests/session-mirror.spec.ts`: a self round with a start record mirrors as its own turn, its step carries its usage, it writes no user message, and the next prompt opens turn 3. `throughTurn` holds a later turn's lines and usage, settle included.
- `packages/local-agent-kimi/tests/self-turn.spec.ts`: `selfTurnPrompts`, `nextSelfTurn` (after the last user prompt, stamped, handled once) and `readTurnAt`.
- `packages/local-agent-kimi/tests/live-driver.spec.ts`, block "a self-opened round becomes its own execution":
  - the observer admits the turn, with the task's tool call read from `task.started`;
  - it follows the turn while it runs and ends it on `turn.ended`;
  - it mirrors the turn with no user message and with its usage, reports the spend, and offers it once;
  - a prompt asked for during the follow goes out once, after the turn ends;
  - a refusal, a `cron_job` turn and a stale turn are not followed;
  - the observer stops when nothing runs, and the tray read restarts it.
- Read-only regression (`packages/local-agent-kimi/tests/transcript-regression.ts --baseline <main's session-view.ts> <dirs>`), run on 2026-11-06 over three real wires (5e754ac5, capcut ffc8cfe1, study-plan 99449949). The 6a56 room's wire named in the design is no longer under the scoped home. With no own rounds, all three are identical to main's reader. With every notification counted as own, the content is unchanged and only the turn numbers move. The script prints counts and hashes only, never wire content.
