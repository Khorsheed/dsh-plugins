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
- `stopJob` stops a task: running deliveries are cancelled through the existing `cancel`, queued and held ones never run, and `room/job-stopped` marks it.

## Alternatives considered

**Infer tasks from the log afterwards (time windows, hop chains).** Rejected: the room's own agent's direct turns leave no room record to chain from, and concurrent requests interleave.

**Strict causality only (every human message is a task).** Rejected by the owner: a follow-up ("顺便让 codex 也测一下") would split one piece of work across cards. The coordinator decides, with the decision model's suggestion; the composer's tag forces either way.

**Key tasks by log seq.** Rejected: on the room agent's direct turns the attribution happens in `agent/pre-step`, before the host appends the human message, so only its id is known.

## Consequences

- One extra decision-model call per human message while tasks are open (bounded at 8 s, skipped without `typesafe`).
- Old rooms get tasks too, through the causal fallback.
- Tests cover a task from an @-message joined by the agent's delegations, a model-filed follow-up re-filed as new by the coordinator, an unknown task reference, the composer's tag, a member's sub-delegation nesting under its delivery, stopping a task, and task-reference resolution.
