# Agent Note: the room records task and run references on help and decision events

Status: implemented

## Problem

Batch 5 (the unified execution entry, design `proposals/active/2026-11-03-unified-execution-entry.md`, outside the repo) wants a later per-task cost sum to be a plain addition with no attribution guessing. The sum is: every execution whose `task` is the task (step usage plus compaction usage), plus every `room/decision` call made for the task, plus every execution whose cause is `help` with `fromTask` pointing at the task. Migration row S9 asks room for the references this needs. Before S9:

- `room/help` did not say which task the asker was working on, so a helper's executions in another session could not be tied back to it.
- `room/decision` did not say which task or run it decided for. Its usage (S6: decision-model usage lives only on `room/decision.call`) could not be added to a task.
- A release round of the report gate (`releaseReason: 'timeout'`) found its `decision` cause by taking the latest `later` report-timing decision for the recipient. That is a guess: the latest decision is not necessarily the one whose hold the round ends.

## Decision

Optional fields on existing registered room events only. No new event types. Old events without the fields replay and map exactly as before; no inference is added for them.

- **`room/help.task`** (`RoomHelpEvent.task`): the asker's task (root message id) when it asked. It is taken from `sendContext(room, asker).task` in `askHelp` (`packages/room/src/index.ts`), the same source a member's sends use: a member's running delivery's task, or, for the room's own agent, the task of the human message that started its turn. Absent when the asker is outside any task.
- **`RoomHelpOrigin.task`**: a room-to-room request carries the asker's task as the asking room's task (`deliverToRoom`). It therefore rides the asked room's `room/dispatch.help` and `room/help-in`. On `room/help-in` it names a task of the *asking* room.
- **`help` cause `fromTask`**: `executionFacts()` (`packages/room/src/dispatch.ts`) writes `fromTask: { sessionId: help.room, id: help.task }` for a `help`-origin round when the request carried a task.
- **A help reply round in the asking room** (`reportFor: 'help:<id>'`): when the dispatch has no `task`, the execution's `task` is the thread's own `room/help.task`. This follows a recorded reference (the help id); it is not a guess. `fromTask` is not set here, because this execution already belongs to the task through `task`; setting both would count it twice in the sum.
- **`room/decision.task`**: task-filing → the task the message was filed under (`target.id`, or the message's own id for a new task); report-timing → the gated delivery's task.
- **`room/decision.runId` / `executionId`** (report-timing only): the delivery whose report was gated, and that run's local-agent execution from its running edge (`runExecutionId`). Task-filing decides for a human message (already in `about.message`), not a run, so it carries no run.
- **`room/dispatch.releaseDecision`**: a release round cites the `later` decision that held its oldest pending report (`holdDecision()`: the report-timing `later` decision whose `runId` equals the held dispatch's `reportFor`). Written for every release reason when one exists. `executionFacts()` uses it as the `decision` cause for a `timeout` (or unrecorded-reason) release; a release journaled before S9 keeps the older latest-decision reading.

### Report-gate findings (the design's open risk)

Checked in `report-gate.ts` and `DispatchEngine.gateReport`/`holdReport`/`releaseHeld`:

- A hold only ever comes from the decision model: `judgeReport` returns `hold: true` only with `reason: 'model'`. Every verdict except `setting` (the `each` setting) and `plan` (plan cadence) journals a `room/decision` before the hold. So every hold written since S9 has a citable decision, and every release round after such a hold cites it.
- No citable decision exists in these cases:
  - Releases of holds journaled before S9 (their decision carries no `runId`). `timeout` falls back to the old latest-decision reading; nothing is rewritten.
  - `manual` (the human's 现在交给) and `restart` (a restart lost the wake timer): a decision exists and is cited, but the cause stays `human` / `restart` as before, because the decision is not what woke the round.
  - Holds released by being carried on another round (`markHeldReleased`, reason `carried`): no release round is dispatched, so there is no execution to attribute.
  - `setting` / `plan` deliveries never hold, so they never produce release rounds.
- No new cause kind (`rule`) was needed.

## Alternatives considered

- **Record the deciding decision on the held dispatch** (`heldBy`). Rejected as redundant: the decision's own `runId` already equals the held dispatch's `reportFor`, so one field on the release round is enough.
- **Cite the latest hold's decision.** Rejected. The wake timer is armed by the first hold still pending and is not re-armed by later holds, so the oldest pending hold's decision is the one whose wait ends.
- **Put `fromTask` on the asking room's help-reply round too.** Rejected: that round already carries the task as its own `task`, so the sum would count it twice.
- **Write `task` on the help-reply dispatch.** Rejected for this step: it would move the reply into the task tree on the timeline (a UI change). The execution task is mapped in `executionFacts()` instead.

## Consequences

- No user-visible change. Context Lens reads room events structurally and ignores the new fields; its source is untouched.
- A later per-task sum can add help executions in other sessions (`cause.fromTask`), decision-model calls (`room/decision.task`) and help replies without inference.
- `room/help-in.task` names a task of another room. A reader of the asked room's tasks must not treat it as a local task id.

## Testing

- `packages/room/tests/dispatch.host.spec.ts`: `executionFacts` maps `fromTask`, the help-reply thread task (and the dispatch's own task winning), and a cited release decision over the latest one; the pre-S9 cases are unchanged.
- `packages/room/tests/report-gate.host.spec.ts`: the hold decision carries `runId` = the held report's `reportFor`, its task and the execution id; the manual release cites it.
- `packages/room/tests/help.host.spec.ts`: a room-to-room request's thread carries the asker's task, and the asked room's help dispatch carries it.
- `packages/room/tests/jobs.host.spec.ts`: a task-filing decision names the task it filed the message under.
- Room→lens contract fixture: regenerating with `UPDATE_ROOM_CONTRACT=1` produced no change, because its scripted lifecycle writes no help thread and no decision. The context-lens suite stays green. Coverage gap: the fixture does not pin the new fields for lens.
