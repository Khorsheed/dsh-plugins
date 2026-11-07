# Agent Note: a member's self-opened round reports back as a follow-up

Status: implemented

## Problem

Step M4 of the member self-started rounds design (`proposals/active/2026-11-06-member-self-started-rounds.md`, outside the repo) made a round that a member's Kimi CLI opens on its own after a background task ends into an execution of its own: caller `cli`, cause `{ kind: 'self', reason: 'background-task', taskId, taskStatus, startedBy }`. The room already showed such a round like any round another caller starts (`observeMemberExecution`). It had two gaps. Nothing said why the member was talking, and the result never reached the member that dispatched the work, even though the member had promised it ("完成后我会继续汇报").

## Decision

Step M5 (room, with a small Context Lens follow-through):

- **What the round continues on.** The running edge (`room/run-state`) and the reply (`room/speech`) of a self-opened round carry the optional `continues: { taskId, taskStatus, label?, runId? }` (`RoomRoundContinues`). `runId` is the room run whose running edge names `startedBy`. `label` is the task's description from local-agent's `memberBackgroundTasks` (probed), read while the round runs. If the read has not returned by the time the round ends, `label` is left out. The card reads 「X 正在处理后台任务的结果」. The reply gets the quiet line 「↻ 后台任务完成后继续 · <label>」, or 失败 / 超时 / 停止 instead of 完成, and a click on the line scrolls to the round that started the task.
- **Follow-up report.** The room finds the original delivery (`followUpDelivery`). When the starting run is itself a self-opened round (`execution:<id>`), the room follows its `continues.runId` back, up to 8 levels. A delivery that would have reported (a coordinator or member dispatch with `replyTo`) gets a follow-up through the existing `reportOutcome` → `gateReport`. The follow-up has its own dedupe key `room/dispatch.reportFor = execution:<self executionId>` and the new optional `followUpOf = <original delivery id>`. Recipient, task and plan cadence come from that delivery. Its own report, sent long ago, is untouched. The envelope reads 「#mN 的后续回报 · 来自 X · 后台任务完成」 (or 失败 / 超时 / 已停止). The reply carries `reportedTo` and shows 「→ 已作为后续回报交给 Y」.
- **No report** when the work came from the human (the human reads the reply in the room), or when the starting round came from the members page or the host `subagent` tool (`execution:` runs that are not room work). The quiet line still shows in both cases.
- **Cause and the 「收到…」 line.** `executionFacts` maps `reportFor` `execution:<id>` to `{ kind: 'execution', executionId }`. That is the same cause a report-triggered round already gets, so no new cause was added. `speech-cause.ts` `reporter()` recognises `execution:` (the member comes from the run, with the original delivery as fallback) and `background-task:` (M6). The recipient's reply reads 「收到 X 的后续回报」.
- **Context Lens.** The contract fixture gains step 10, a self-opened round after the coordinator's 「做甲」 send and its follow-up. In Lens, `roomSelfRounds` used to place a self round under a human round only through the collaboration tree. A coordinator's own send is outside that tree, so the round fell into 未归轮. Lens now also claims the round through the starting dispatch's `task` (`RoomDispatchLink.task`). This is the same `task` fallback that decisions already use.

## Alternatives considered

- **Dedupe the follow-up on the original delivery id.** Rejected: that key is already taken by the original report, so the follow-up would never go out.
- **A new cause kind for follow-up rounds.** Rejected: the round a report triggers is already `execution`.
- **Forward results the CLI folds into another round** (a task that ends while the member is busy). Rejected per the user's decision 5: that reply already reached that round's dispatcher. A marker for that case is not built here, because the fold is invisible to the room without a wire read.

## Consequences

- `room/dispatch.followUpOf`, `room/speech.continues` and `room/run-state.continues` are optional fields on registered types. Older builds ignore them.
- A self-opened round is shown only while its room is live in this host process (`observeMemberExecution` needs the room session). A self round of a room that nobody has open is mirrored in the member's session but not shown or reported in the room.

## Testing

- `packages/room/tests/dispatch.host.spec.ts`: a member-dispatched task's self round → running card `continues`, reply line with label and `reportedTo`, one follow-up through the gate with key `execution:exec-self` and `followUpOf`, envelope 「后续回报 · 来自 bill · 后台任务完成」, the recipient round's cause `execution`. A human-dispatched task → line only, no dispatch. A members-page round → line only, no dispatch.
- `packages/room/tests/nodes.client.spec.tsx`: `speechCause` for `execution:` / `background-task:` / an unknown execution; the reply's line, click and 「已作为后续回报交给」; the card title.
- `packages/room/tests/lens-contract.host.spec.ts` step 10. The fixture is regenerated. `packages/context-lens/tests/room-contract.spec.ts` asserts that the self round sits in 第三轮.
- Preview: `packages/room/tests/preview/self-round.html?state=running|selfdone|human`.
