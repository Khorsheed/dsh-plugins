# Agent Note: A round a restart cut off is closed; the member checks and continues

Status: implemented

[English](2026-11-09-restart-recovery-consolidation.md) | [中文](2026-11-09-restart-recovery-consolidation.zh.md)

## Problem

Until 2026-11-09 a member round a host restart cut off had an **unknown outcome** that someone had to reconcile. The local-agent core turned the row `uncertain`, paused the member's queue at boot, and refused every later admission of that member; the room projected 待对账 onto the delivery, the run card, a receipt, two capsules and a fallback panel, and sent the dispatcher an English 「Execution outcome is unknown…」 *report*; a formal goal paused and fenced the attempt as `uncertain` until a human chose 「待验收」 or 「失败」 with evidence. The human was the one asked whether the work was done — a question only the member can answer (its files, tests, commits, deploys). In room 6a56367b (2026-11-09) the human's 「evidence」 was 「不确认是否做完」, the goal never learned of the reconciliation done on the members page, a superseded goal attempt sat `queued` forever, the coordinator got five identical release reminders and two non-reports, and the continued round's real result reached nobody.

Design: `proposals/active/2026-11-09-restart-recovery-consolidation.md` (all ten open items decided as recommended, 2026-11-09). This note supersedes the 2026-09-19 decision that refused to treat interrupted work as cancelled ([room restart reconciliation](../bug-fix/2026-09-19-room-restart-reconciliation.md)) and retires the reconciliation half of [queue and recovery in the core](2026-11-05-queue-and-recovery-in-core.md).

## Decision

**One rule.** A round a host restart cut off is closed as 「被重启打断」 — an outcome next to done, failed and cancelled, not an unknown. Continuing is a new round in which the member first checks what it had already done. The room's auto-continue, the human's 「全部继续」 and a goal's new attempt are the same action; the human otherwise only has 「停止」. Nothing waits for the interrupted round to be "cleared": it blocks no admission, pauses no queue, and reaches the dispatcher only through the continued round's normal report.

### The core ledger (R2, local-agent)

- **Load.** A row still `running` when a ledger file loads closes as `status: 'cancelled'`, `interrupted: 'restart'`, error 「被重启打断」, `settledAt` — whoever submitted it. A round the CLI opened itself keeps its own ending (`failed` + `SELF_ROUND_RESTARTED`). A row an older core left `uncertain` closes the same way (recognised by its data, never by a date) and is not this restart's.
- **No boot pause.** The core never pauses a ledger at boot; a file carrying an older core's `pausedBy: 'restart'` loads unpaused. An operator's own pause (no `pausedBy`) is untouched. `assertAdmission`, `pump`, `runNow` and `resume` have no `uncertain` branch any more.
- **M10.** `interruptedMembers()` lists a member whose row this process closed as interrupted on load (`interrupted === 'restart'` and in `cutOffThisBoot`), or whose unloaded file still says `running` and began after the previous host process started.
- **Execution records.** An interrupted execution's end is `{ outcome: 'uncertain', reconciled: false }` — the same exit a self-opened round cut off by a restart uses, which Context Lens already reads as 停了.
- **Members-page rounds continue on their own.** When this restart cut off a `composer` row, load inserts one continuation row at the head of the queue (`caller: 'composer'`, the room's continue sentence, `preview: '重启后继续'`, key `restart-continue:<row id>`); the input the human queued behind it follows. No continuation when the operator had paused the queue or the member's own round requested the restart (the `selfRestartGuard` record). Queued composer input replays on its own once the ledger loads (the provider must be registered).
- **`subagent` tool and plugin rounds only close.** Their parent's turn ended with the restart; whether to redo it is the parent's call. The closed row no longer blocks that member's room work.
- **Compatibility.** The row keeps the `cancelled` status an older core understands (a new status value would make an older core's `validRow` reject the whole ledger). `reconcile` / `reconcileExecution` / the gateway's `controlMemberInbox(…,'reconcile')` stay for one release and answer with the old refusal, since no row is `uncertain` once loaded.

**R2 and R3 ship together.** With R2 alone, a room still waits for the core to say `uncertain`; it would read the closed row as an ordinary cancellation and lose its auto-continue. Deploy room and the local-agent family together.

## Alternatives considered

**A new ledger status `interrupted`.** Rejected: an older core's `validRow` rejects a ledger holding a status it does not know, blocking every admission of that member after a rollback. `cancelled` plus an optional flag reads correctly on both sides.

**Keep the human reconciliation, only fix where it shows.** Rejected: the incident's reconciliation was a guess. The member has the evidence; the human has not.

**Continue the same round across the restart.** Not possible: no supported CLI resumes a round cut off mid-flight; continuing is always a new round.

**Continue `subagent` tool rounds too.** Rejected (open item 3): the parent's tool call is gone, nobody would receive the result, and a parent that re-issues the call would collide with the continuation.

## Consequences

- The member may redo an external action it had already done before the restart (a publish, a deploy). The continuation text asks it to check first; a tool that cannot be repeated safely needs its own idempotency rather than a human gate.
- More automatic paid rounds after a restart (members-page continuations). Bounded by one continuation per row and restart, the self-restart guard, and the operator's pause.
- Rolling R2 back leaves rewritten rows `cancelled`: an older room reads them as ordinary cancellations and reports 「已取消」 to the dispatcher — noise, not a block.

## Testing

- `packages/local-agent/tests/member-inbox.spec.ts`: a running row closes as interrupted for every caller and blocks nothing; the members-page continuation heads the queue and runs before typed input; none for an operator pause, the self-restart member, or a tool round; an older core's ledger (fixture `tests/fixtures/restart-ledgers.ts`) closes its `uncertain` rows, lifts the boot pause and replays the held input; `interruptedMembers` counts only this restart's rows.
- `packages/local-agent/tests/run-entry.spec.ts`: through the real registry, the interrupted row's key reads as that closed execution and the next room delivery is admitted at once.
