# Agent Note: Room tasks — work grouped by the human request that started it

Status: implemented

## Problem

The room recorded who dispatched what (`from`, `replyTo`, `hop`) but not what it was for. The team view could count deliveries per pair of members, and nothing could answer "how long did my request take and where did the time go" across several agents and rounds. Attributing work after the fact breaks down exactly where it matters: when the room's own agent answers the human directly its turn comes through the host's ordinary input path, not a room dispatch, so its delegations had no link back to the message; and with two requests in flight a coordinator round may carry results of both.

## Decision

A **task** is a human message that led to work (at least one delivery carries it) plus everything that work set in motion. Plain chat that dispatched nothing is not a task. Attribution is written at dispatch time, never inferred for new logs:

- Every `room/dispatch` records `task` (the root human message's `user/message` id, or the dispatch's own id for a human dispatch without a message, such as an invite's first task) and `parent` (the delivery the sender was working on, `<seq>:<memberId>`), so a member's sub-delegations nest under its own work.
- A member inside a room round sends under that round's task. The room's own agent answering the human directly sends under the task of the human message that started its turn (`trigger`).
- A new human message is filed by, in order: the composer's tag (`setTaskHint`, or `task` on `postMessage`) — `human`; else, while some task is still open, the decision model (`typesafe`, a choice between the open tasks and "new") — `model`, with its probability, and the coordinator reads a one-line 【任务归属】 note in that turn; else it starts a task of its own. Filings other than its own task are `room/task-link` events (latest wins).
- The coordinator overrides with `task` on `room_message` / the bridge tools (`"new"` or a 「任务 N」 number from `room_read`); from a turn the human started this also re-files that human message (`by: coordinator`).
- Reports and release rounds inherit their source's task. Older dispatches without `task` resolve by cause in the replay: a report takes its source's task, anything else the task of the latest human message before it.
- `RoomState.jobs` (`replayJobs`) lists tasks newest first with their number, title (leading @-mentions stripped), messages and how each was filed, status (running / attention when a delivery is uncertain / done / stopped), deliveries and members. Deliveries now carry their timing edges (dispatched, admitted, settled, held, released).
- `stopJob` stops a task: running deliveries are cancelled through the existing `cancel`, queued and held ones never run, ordinary rounds a restart left uncertain close as cancelled (stopping is the human giving up on them; an uncertain round otherwise blocks every later message to that member until reconciled), and `room/job-stopped` marks it. A human message to a member does the same for that member's uncertain ordinary rounds (the owner's call: a new message is moving on), so a lost round never blocks the human; formal-goal attempts keep explicit reconciliation. A task holding an uncertain round reads as needing attention even once stopped. The composer's queue strip says when the coordinator's messages wait behind such a round.

**Task page; what it replaced.** This supersedes [the room_task tool](2026-08-20-room-task-tool.md) and [the quest-bar capsules](2026-08-22-room-quest-bar-redesign.md). Tasks became the room's one way to see work, so overlapping surfaces were merged or removed (owner-approved):

- A right-sidebar **Tasks** page (kind `room-tasks`, param `task`): the room goal (editable) on top, filters running / needs you / done / all (the last 20 finished tasks by default), and a detail per task — what the human said with how each follow-up was filed, stop the whole task (in-place confirmation naming the members whose work stops), what needs the human (uncertain outcomes reconciled in place, relays held inside the task), the formal goal when the task's work belongs to it, the subtask tree from each delivery's `parent` (reports travel back up and are not nodes; a running subtask stops on its own), and a member swimlane timeline of queue / held / exec stretches.
- The page has no input. 「追问」 and 「＋ 新任务」 put a removable 「任务 N」 / 「新任务」 chip on the main composer (a client store shared by the page and the composer); the next send passes it as `postMessage`'s `task`. On a narrow window the page closes so the composer is in reach.
- The composer dock collapses to one task capsule (「● N 个任务进行中」, plus an amber 「⚠ N 件需要处理」 counting uncertain deliveries and pending relays) that opens the page; a fresh room shows the invite capsule instead. Without the right sidebar the capsule degrades to the inline reconcile view.
- Removed: the task board (`room/task-*` writes, the add/close/update remotes, the board capsule, the 「✓ 完成了」 chat line), the `room_task` tool (work is a `room_message`, filed under a task), the separate plan page and plan/agents capsules (`room_plan` stays; a plan shows inside its task, or under the list while no task has picked it up), and the pending-task transfer on member removal. Old logs still replay `room/task-*` into `RoomState.tasks`; no view reads it.

## Alternatives considered

**Infer tasks from the log afterwards (time windows, hop chains).** Rejected: the room's own agent's direct turns leave no room record to chain from, and concurrent requests interleave.

**Strict causality only (every human message is a task).** Rejected by the owner: a follow-up ("顺便让 codex 也测一下") would split one piece of work across cards. The coordinator decides, with the decision model's suggestion; the composer's tag forces either way.

**Key tasks by log seq.** Rejected: on the room agent's direct turns the attribution happens in `agent/pre-step`, before the host appends the human message, so only its id is known.

## Consequences

- One extra decision-model call per human message while tasks are open (bounded at 8 s, skipped without `typesafe`).
- Old rooms get tasks too, through the causal fallback.
- Native sub-agent sessions that the coordinator spawns outside room dispatch no longer have a room surface (the old agents capsule listed them); they remain in the host's own session list.
- Tests cover the task page (filters, detail, in-place stop, follow-up tags, per-subtask stop, the subtask tree and time segments), the task capsule and composer tag, and a task from an @-message joined by the agent's delegations, a model-filed follow-up re-filed as new by the coordinator, an unknown task reference, the composer's tag, a member's sub-delegation nesting under its delivery, stopping a task, and task-reference resolution.
