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

### The room (R3)

- **One reader.** `restart-interrupted.ts` (shared by service and browser) answers "did a restart cut this round off?": the new mark `endedBy: 'restart'` on `room/delivery-state` / `room/run-state` (optional fields on existing events — no new event type), or any legacy shape — a delivery's `uncertain` edge, a run failed with the old English reason, a 「按没做完处理」/「任务已被停止」 cancellation, a 「被取代」 queued message. Read by data, never by date. `RoomDelivery.interruptedAt` keeps when the cut-off was first journaled, so rewriting a legacy edge never makes an old round look like this restart's.
- **Recovery closes, never reports.** A delivery whose core row is closed as interrupted (or left `uncertain` by an older core), a running delivery the core holds no row for (the room's own agent, a delivery from before S7), and a legacy `uncertain` edge get `cancelled` + `endedBy: 'restart'` on the delivery and its open card. No report goes to the dispatcher. An outcome a human once reconciled in the core is journaled as that outcome. The projection (`view`) reads every shape as `cancelled` + `endedBy: 'restart'`; `waiting: 'reconcile'` is never produced.
- **Obsolete restart reports are retired.** A queued report whose text is the legacy 「Execution outcome is unknown…」, 「被重启打断前排队，已被后续消息取代」, 「已并入下一条消息一起送达」 or 「Human reconciled task …」 is closed (`OBSOLETE_RESTART_REPORT_TEXT`) instead of delivered.
- **What queued behind an interrupted round waits for its continuation.** A member with an open interrupted message round (not continued, not stopped; `openInterruptedRounds`) admits only a dispatch that `continues` it; everything else stays queued. The room's auto-continue appends and dispatches the continue message in one synchronous stretch, then runs a recovery pass, so the continuation heads the member's core queue and the rest follows in order — never merged, never superseded (open item 4 B).
- **Any first message is a continuation (D-4).** A human message, an edited message, a late answer, a cross-room help request and a coordinator's or member's task send to such a member record `continues`; `assemblePrompt` puts one line in front of its words (「你上一轮被实例重启打断了。先核对上一轮已经做过什么，再处理下面这件事。」). The continue message itself and a goal's new attempt say it in their own words.
- **The continued round's result reaches the original dispatcher (D-3).** When a dispatch that `continues` a member's interrupted delivery settles, a follow-up report goes out on that delivery (`reportFollowUp`, keyed on the continuing delivery): same recipient, task and goal cadence. Skipped when the continuing dispatch itself reports to the same recipient.
- **The human's two actions.** `continueInterrupted` (「全部继续」: the same continue message as the room's, `continues` recorded; a goal resumes) and `stopInterrupted` (「停止」: one more closing edge `RESTART_STOPPED_TEXT` on each round, the dispatcher hears 「被重启打断，已停止」 once, and what queued behind it goes out). Stopping a task (`stopJob`) stops its interrupted rounds the same way. A task is never 「需要处理」 because of an interrupted round.
- **Removed.** `moveOnFromLostRounds` (its close, merge and supersede), `supersededByMoveOn`, `waitForReconcile` and the 待对账 refusal (`MEMBER_UNRECONCILED_TEXT`), `reconcileInCore` / `reconcileCore`. `reconcileDelivery` stays one release and answers `delivery-not-uncertain`. A core refusal for an operator-paused queue still reads `MEMBER_PAUSED_TEXT` (reworded: no longer "after a restart").

### Formal goals (R4)

- **An attempt a restart cut off is closed and uncounted.** `recoverPlan` turns an unsettled `running` attempt into `cancelled` + `interrupted: 'restart'` (task back to `pending`); `queuePlanAttempt` counts only `countedAttempts` against `maxAttemptsPerTask` / `maxAttempts` (an interrupted attempt, a legacy `uncertain` one, or one carrying a legacy restart error does not count). The attempt keeps its number: the history reads 「第 1 次 · 被重启打断」「第 2 次 · …」. An unsettled `submitted` attempt keeps its evidence and settles for review.
- **The goal follows the room's auto-continue rule (open item 1 A).** It stays `running` — the scheduler opens the new attempts at once — unless the setting is off or the room paused, the interrupted attempt belongs to the member whose round requested the restart, the interrupted attempt already continued an interrupted one (`again`), or the attempt started before the previous host process (stale; every legacy shape counts as stale). Then the goal pauses with 「被重启打断」 and the human's 「全部继续」 (`continueInterrupted` → `PlanService.continueAfterRestart`, a human `resume`) continues it; 「停止」 (`stopAfterRestart`) leaves it paused as the human's own pause (「已停止」).
- **The new attempt's brief.** When the previous attempt was interrupted after it had started, the brief adds 「上一次尝试（{id}）被实例重启打断。先核对已经做完的部分……然后照常用 room_plan submit 提交证据。」 and the dispatch records `continues` (the old round), so the banner does not offer it again. An attempt that never started gets a plain brief.
- **Every closed delivery settles its attempt.** `syncAttempts` (at the once-per-process recovery and before every goal command) settles an unsettled attempt whose delivery the room already closed — a restart's closing or a legacy 「被取代」 as interrupted, anything else as that outcome — and the room's own closings (`closeInterrupted`, goal-closed cancellations) call the `settled` hook. An attempt never stays `queued` behind a delivery that will not run (the incident's `zhaoyao-rules`).
- **Upgrade, by data.** A legacy `uncertain` attempt becomes interrupted; a `failed` task whose attempt it was goes back to `pending`; the old pause reasons (「Reconcile uncertain attempts…」, 「Host restarted…」, 「Interrupted attempts reconciled…」) read as 「被重启打断」 and the goal stays paused for the human.
- **Removed.** `resume`'s `uncertain` check, the human `reconcile` transition and `PlanService.reconcileDelivery` (its 「Human reconciled task …」 message). The `reconcile` command stays in the schema this release and is refused with 「重启打断的尝试会自动重开，不需要对账」 (open item 9); remove it from the schema next release.

### The interface: each thing in one place (R5)

| What | Its one place | Removed |
|---|---|---|
| This round was cut off by a restart | the round's own card, kept closed: dashed, its title line 「{member} · 被重启打断」 in the quiet tone, no button, its output up to the cut-off when the page still holds it (`RoomRunView`; the run Definition keeps a `cancelled` + `endedBy: 'restart'` card visible) | receipt 「等核对 · 去核对」/「结果待核对」, the 「⚠ N 件需要处理」 count, the coordinator's 「上一轮待核对」 capsule, the fallback reconcile panel (`RoomRecoveryView`), the member card's restart line, the edit dialog's 待对账, the members page's 结果待核对 + evidence box, the goal panel's 「结果未知，需对账」 |
| It was continued | the continuing round's own card; its reply says 「已汇报给 …」 when the original would have reported | the 「重启后已自动继续 N 位成员」 half of the banner, the member card's 「重启后已继续」 |
| The room pressed 继续 itself | its node: 「房间 · 自动」, the message, 「设置」 | the 「已自动继续：…（重启打断）」 line |
| The human decides whether to continue | one line above the composer: 「N 位成员被重启打断：A、B · 停止 · 全部继续」, or 「这个目标被重启打断」 for a goal the restart paused; a reason only where the human cannot see it (interrupted again after an automatic continue, the member requested the restart, its queue is paused in the member session) | —— |
| A goal's attempt | the attempt history: 「第 1 次 · 被重启打断」「第 2 次 · …」; 「尝试 N / M」 counts only counted attempts; a restart's pause reason is not repeated in the panel | 「对账为待验收 / 对账为失败」 and the evidence box |

No hint words the human can infer (「已核对」「不用对账了」「不计入预算」). Legacy shapes render through the same reader: a restart-failed card with the old English reason reads 「被重启打断」 without the reason; a legacy 待对账 wait row (a message that never ran) renders nothing. Locale keys of the removed surfaces are gone; the legacy statuses still in a type union (`plan.status.uncertain`, `team.status.uncertain`) read 「被重启打断」.

The members page (local-agent `MemberInboxView`) lost its `uncertain` rows and evidence box; the continuation row reads its preview 「重启后继续」; the paused notice no longer mentions a restart. The edit dialog keeps only 「启动失败 · 对账并重试」 (a failed native start — another matter).

**R2 and R3 ship together.** With R2 alone, a room still waits for the core to say `uncertain`; it would read the closed row as an ordinary cancellation and lose its auto-continue. Deploy room and the local-agent family together.

## Alternatives considered

**A new ledger status `interrupted`.** Rejected: an older core's `validRow` rejects a ledger holding a status it does not know, blocking every admission of that member after a rollback. `cancelled` plus an optional flag reads correctly on both sides.

**Keep the human reconciliation, only fix where it shows.** Rejected: the incident's reconciliation was a guess. The member has the evidence; the human has not.

**Continue the same round across the restart.** Not possible: no supported CLI resumes a round cut off mid-flight; continuing is always a new round.

**Merge what queued behind the lost round into the continuation (open item 4 A, the old move-on).** Rejected: it needed the merge, the 「被取代」 closing of rows an older move-on skipped, and a report mapping for every merged row; goal attempts could never be merged anyway. Queued messages now wait for the continuation and then run one by one — more rounds, far less code.

**Continue `subagent` tool rounds too.** Rejected (open item 3): the parent's tool call is gone, nobody would receive the result, and a parent that re-issues the call would collide with the continuation.

## Consequences

- The member may redo an external action it had already done before the restart (a publish, a deploy). The continuation text asks it to check first; a tool that cannot be repeated safely needs its own idempotency rather than a human gate.
- More automatic paid rounds after a restart (members-page continuations). Bounded by one continuation per row and restart, the self-restart guard, and the operator's pause.
- Rolling R2 back leaves rewritten rows `cancelled`: an older room reads them as ordinary cancellations and reports 「已取消」 to the dispatcher — noise, not a block.

## Testing

- `packages/local-agent/tests/member-inbox.spec.ts`: a running row closes as interrupted for every caller and blocks nothing; the members-page continuation heads the queue and runs before typed input; none for an operator pause, the self-restart member, or a tool round; an older core's ledger (fixture `tests/fixtures/restart-ledgers.ts`) closes its `uncertain` rows, lifts the boot pause and replays the held input; `interruptedMembers` counts only this restart's rows.
- `packages/local-agent/tests/run-entry.spec.ts`: through the real registry, the interrupted row's key reads as that closed execution and the next room delivery is admitted at once.
- `packages/room/tests/restart-recovery.host.spec.ts`: the dispatcher gets nothing while a round is cut off and exactly one normal report (`followUpOf` the original delivery) after the auto-continued or human-continued round; 停止 sends the one sentence and releases the queue; the incident fixture's obsolete reports are retired and its legacy 「按没做完处理」 round is not offered again.
- `packages/room/tests/plan.host.spec.ts`: a restart closes the running attempt uncounted (a second attempt fits `maxAttemptsPerTask: 1`); the pause rule (setting off, restart initiator, two interruptions in a row, stale); an unsettled submission settles for review; legacy fences rewritten by data; `reconcile` refused.
- `packages/room/tests/restart-recovery.host.spec.ts` (goals): the incident goal after the upgrade (both attempts interrupted and uncounted, both tasks pending, paused 「被重启打断」); 全部继续 opens second attempts — the started one's brief says it was interrupted and `continues` the old round — and the member submits the new attempt while the old one is refused as superseded; with auto-continue on the goal keeps running and opens the next attempt at once, telling the coordinator nothing in between.
- `packages/room/tests/restart-recovery.client.spec.tsx`: the closed card (new mark and legacy shapes, output bounded at the cut-off, no button, no reconcile words), the 待对账 wait row and an ordinary cancellation render nothing, the run Definition's visibility; the goal panel's attempt history and budget count, no reason line for a restart pause.
- `packages/room/tests/restart-continue.client.spec.tsx`: the composer line (names, 停止 / 全部继续, reasons only where invisible, the goal line, legacy pause reasons) and the auto-continue node; `receipt`, `tasks`, `room-composer`, `member-recovery` client specs and local-agent's `member-inbox.client.spec.tsx` pin the removals.
- Screenshots of `packages/room/tests/preview/restart.html` (scenes t1 t2 c1 g1 m1, 1280 and 390, light and dark) compared against the prototype's 「改后」 frames; images are never committed.
- `packages/room/tests/restart-interrupted.client.spec.ts`: the new mark and the four legacy shapes; handled rounds; obsolete reports.
- `packages/room/tests/dispatch.host.spec.ts`, `real-core.host.spec.ts`, `jobs.host.spec.ts`, `help.host.spec.ts`: recovery closes without replay or report, the continuation runs first and the queue follows, D-4 continuations from a human message and a help request, the real core admits the next delivery at once and writes the `uncertain` end for the interrupted execution.
