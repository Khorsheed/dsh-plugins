# Agent Note: queueing and restart recovery of CLI members belong to the local-agent core

Status: implemented

## Problem

Batch 5 (the unified execution entry, design `proposals/active/2026-11-03-unified-execution-entry.md`, outside the repo) step S7. After S5 every CLI member round went through the core's `run()` and its per-member ledger, but room still kept a layer above it. It had its own per-member `queues`/`scheduled` sets. It had its own restart verdict: `recover()` turned any running delivery into `uncertain` and wrote a failed run edge, and `view()` projected every running run it did not hold in memory as failed. So there were two uncertain states that did not know about each other. A room round cut off by a restart was uncertain in both places, and reconciling it in the room left the core's row uncertain. The member then refused every later room round, including the message that was supposed to "move on" from the lost round. An uncertain members-page input made room deliveries fail with `MEMBER_UNRECONCILED_TEXT`. A round another caller started (`execution:<id>`) read failed in the room after a restart while the core said uncertain (the S5 gap). S4 also noted that `reconcileExecution` left the execution's start record open in the member's log.

## Decision

- **No room queue for CLI members.** `DispatchEngine.dispatch` hands a CLI delivery straight to `run()`. Microtask order keeps dispatch order, because the core's submit is synchronous. The core's ledger orders the rounds, and its key dedup plus the room's `claimed` set make a delivery submitted twice one execution. `queues`/`scheduled` survive only for the room's own agent, renamed `agentQueues`/`agentScheduled`. The room's agent is not a CLI member, so its path is unchanged. `inFlight` stays as a tracker for `idle()`/`hasPending`; it is not a queue. `holdRun`/`releaseRun` now feed a `followed` set (outside rounds the service follows).
- **The core says what became of a round** (`src/core-ledger.ts`: `CoreLedgers`, `reconcileCore`). `recover()` reads each CLI delivery's ledger row, by the run's `executionId`, else by key = delivery id:
  - `uncertain` → `room/delivery-state uncertain` and a failed run edge (`RESTART_UNKNOWN_TEXT`) that closes the card;
  - `done`/`failed`/`cancelled` → that outcome, with the row's `error` (the reconcile evidence) as text, plus a terminal run edge;
  - `queued`/`running` → left alone;
  - a queued delivery with no row → resubmitted under its key.

  A row the process itself follows is skipped. Outside rounds (`execution:<id>`) get the same treatment from their execution id. `recover()` passes are serialized per room.
- **The projection reads the core** (`view()`). A CLI run or delivery whose row is `uncertain` projects as `uncertain` (a new projection-only state on `RoomMemberRun`; the journal never carries it). One the core settled or reconciled projects as that outcome. A queued delivery of a member with an uncertain row gets `waiting: 'reconcile'`. `getState` on a live room runs a recovery pass when the journal is behind the core (`behindCore`), so a members-page reconcile reaches the room's records on its next read.
- **One reconciliation.** `reconcileDelivery` calls `reconcileExecution` first and journals only if the core accepted (a refusal answers `reconcile-failed`). Moving on from a lost round (a new human message, help-in), stopping its task, and reconciling a goal attempt also settle the core's row. Reconciling on the members page or in the edit dialog reaches the room through the projection plus `behindCore`. So decision 3 holds in all directions.
- **A member waiting for 待对账 does not fail room work.** When the core refuses a delivery because the member has an uncertain row, the delivery stays queued (no delivery edge). Room writes one run row with `MEMBER_WAITING_TEXT`, which projects as `uncertain` + `waiting: 'reconcile'`. Recovery resubmits the delivery once the row is reconciled. A legacy relay (no delivery to wait) still fails with `MEMBER_UNRECONCILED_TEXT`. `settle()` now ignores terminal edges older than the run's latest running edge, and replay drops the earlier failure reason when a run starts again under the same id.
- **The core closes reconciled executions** (S4 deviation 5, now done). The ledger row records `reconciledAt`. `ExecutionRecorder.closeReconciled` writes `local-agent/execution` end records with `reconciled: true`, the operator's outcome, the turns in the execution's range, and `endedAt` = reconciliation time. It writes them for every start without an end whose ledger row was reconciled: at once from `reconcileExecution` when the child is live, else at the member's next admission before its start record. Executions open in this process are never touched. It is small, keeps the log closed for readers (lens, `readExecution`), and needs no host change.
- **Compatibility.** A running delivery or run with no ledger row the room can name keeps the old verdict (uncertain delivery, failed run). These are rounds from before this deploy, or a core without the ledger. The branches are marked `COMPAT(batch 5 S7, remove one release after)`.
- **Client.**
  - `RoomRunView` resolves its card through `executions` by the node's new `runId`, so a projected `uncertain` reads 「{member} 的这一轮待对账」 with a hint and no stop button. A waiting row reads 「{member} 待对账，这条消息还没发出」, and a waiting row superseded by the run starting again hides.
  - `RoomDispatchView` shows 待对账 instead of 排队中 for a waiting recipient.
  - The composer's coordinator queue counts waiting rows as blocked. "Continue" covers projected-uncertain room runs, not outside ones.
  - The team page shows member status 待对账.

## Alternatives considered

- **Keep `scheduled` as the in-process dedup.** Rejected per the design. The core's key dedup is the guard, and `claimed` (execution ids this process follows) covers the window between a core settlement and room's own edges. `claimed` is now released only after the outcome is journaled.
- **Journal `uncertain` as a run-state value.** Rejected. It would change the room→lens contract and every reader of run states. The journal closes the card `failed` with the restart text (as before), and the projection says 待对账 from the core.
- **Show the refused delivery as an `uncertain` delivery** (S5 rejected this too). That would offer the room's "it ran, record the result" for a round that never ran. A queued delivery marked waiting is accurate.
- **Reattach a cold child just to write the reconciled end.** Not needed. The next admission reattaches it anyway, and the closer runs before its start record, so ordering is guaranteed without a second reattach path.

## Consequences

- User-visible (precise):
  1. After a restart, a room round cut off mid-run shows 「{member} 的这一轮待对账 · 重启打断了这一轮，结果不确定。在成员编辑弹窗的「待对账」里核对并填写结果」 (warning colour, no stop). Before, it showed 「{member} 运行失败 · Execution outcome is unknown after restart…」. The member page shows 待对账 instead of 失败.
  2. A round started from the members page or by the room's agent and cut off by a restart now reads the same 待对账 (before: failed).
  3. A message to a member with such a round no longer fails with 「没有发出：…再重新发送这条消息」. It shows 「{member} 待对账，这条消息还没发出」 and the member→member line shows 待对账. Once the round is reconciled anywhere, the message goes out by itself.
  4. Reconciling in the room's recovery card also clears the edit dialog's and members page's 待对账, and vice versa. A new message that "moves on" from a lost round no longer gets refused by the core.
- A live room's `getState` may now write (a recovery pass) when the core is ahead of the journal. A cold room still only projects.
- Room tests' `run-entry-shim.ts` now keeps a ledger (`readMemberInbox`, `reconcileExecution`, `seedLedgerRow`) unless the spec scripts its own.
- Context Lens source untouched. The room→lens fixture is unchanged (the contract run has no restart).

## Testing

- `packages/room/tests/dispatch.host.spec.ts` (new block "restart recovery through the core ledger", 8 cases):
  - an uncertain row projects 待对账 side-effect free, and recovery journals it and runs nothing, twice;
  - a room reconcile settles the core row, then the queued delivery runs once;
  - a core refusal of the reconcile leaves the room untouched (`reconcile-failed`);
  - a members-page reconcile clears the room's 待对账 via `getState`;
  - a delivery the core finished before the room journaled it is journaled from the core and never rerun;
  - a dropped queued delivery is resubmitted under its key and runs once across concurrent and repeated passes;
  - an outside round goes 待对账 → reconciled done;
  - a human move-on cancels the core row.

  Also: the members-page-uncertain case now waits (queued + 待对账 row) and goes out once after reconcile; a legacy relay still fails with the pointer.
- `packages/room/tests/real-core.host.spec.ts`: a crash helper drops the old room's writes, disposes room and core, restores the ledger file and mounts a fresh core and a fresh room module. Two cases replace the S5 refusal case:
  - (a) a tool round cut off reads 待对账 in the room and the core; a room message waits for it, not failed; a members-page reconcile releases it, it runs once, and the child log gains the `reconciled: true` end;
  - (b) a room delivery cut off: the core and room both say uncertain, repeated passes run nothing, the queued third message was dropped by the core, a room reconcile settles the core row (`reconciledAt`), the third runs once, and the child log closes the interrupted execution (`reconciled: true`, `turns: [2]`). Every stored log passes `assertReleasedV4Relationships`.
- `packages/room/tests/jobs.host.spec.ts`: move-on and stopping a task settle the core rows too.
- `packages/room/tests/room-recovery.client.spec.tsx`: 4 new cases (the uncertain card, reconciled hides, the waiting row and its supersession, the dispatch line).
- `packages/local-agent/tests/execution-records.spec.ts`: `closeReconciled` (nothing before reconcile, idempotent, before the next start, never an open execution). `run-entry.spec.ts`: no second end, and `reconciledAt` is set.
- local-agent 527 → 528, room 515 → 529 (51 files), context-lens 311 unchanged and green. The room→lens fixture is unchanged.
- Screenshots (not committed), from `packages/room/tests/preview/recovery.html?state=timeline|dialog` at 1280 and 390: `/tmp/s7-recovery/{timeline,dialog}-{1280,390}.png`.
- Not verified: a real CLI round across a real host restart, a live 3080 instance, and the dialog against a live gateway.
