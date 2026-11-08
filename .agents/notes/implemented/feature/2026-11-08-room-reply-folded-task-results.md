# Agent Note: A member reply that took in a background task's result says so

Status: implemented

## Problem

A Kimi member's background task can end while the member is busy with another round. Kimi does not open a turn of its own for it in that case. It appends the task's notification into the running turn as a user-role `context.append_message` whose `message.origin` is `{ kind: 'task', taskId, status, notificationId }`. The round's reply goes to whoever asked for that round.

The design (`member-self-started-rounds` A④, last bullet 「轮内收到的结果」, decision 5 = A) says the room forwards nothing to the task's original dispatcher. It only marks that reply with a quiet line 「含后台任务结果 · <task>」, in the same family as M5's 「↻ 后台任务完成后继续」. The room never reads Kimi's wire, so the fact has to come from Kimi through the core.

## Decision

The fact travels on the existing settle report and execution end record. Every new field is optional, and no event type is added.

- **Kimi** (`self-turn.ts`).
  - `foldedTaskResults(wire, promptLine)` lists the task-origin user appends inside one turn, up to its `turn.ended` (or the next prompt when the turn was cut off). It drops the turn's own notification: a self-opened turn echoes its prompt as an append with the same notification id, and that echo is the turn's cause, not a result it received. Entries are deduplicated by notification id. The label is the task's `task.started` `info.description`, found anywhere on the wire.
  - `firstUserPromptLine(wire, fromLine)` finds a live round's own prompt.
  - The live driver reads the wire once when the round settles (live rounds and self-opened turns alike) and adds `taskResults` to `recordRoundSettled`. The idle timer is re-armed before that read, so keep-alive timing does not change.
- **Core.**
  - `recordRoundSettled` accepts `taskResults` and passes it to the open execution's observation.
  - The end record (`local-agent/execution`, phase `end`) carries `taskResults?: LocalAgentFoldedTaskResult[]` (`taskId`, `taskStatus`, `label?`, `notificationId?`), written only when the list is non-empty.
  - `LocalAgentExecutionReading` and `LocalAgentExecutionSettlement` pass the field through.
- **Room.**
  - Nothing is journaled. `getState` already attaches the core's reading to every run with an execution id.
  - `RoomSpeechView` shows `execution.reading.taskResults` as a `.cause`-styled line: 「含后台任务结果 · 部署 …、跑测试」. Labels are joined with the locale's separator; tasks without a label are left out, and with no label at all the line reads 「含后台任务结果」.
  - The line is not a link (there is no recorded run to jump to).
  - It works for the room's own deliveries and for rounds started elsewhere, because both read the same reading.

## Alternatives considered

**An optional field on `room/speech` or the terminal `room/run-state`.** The room writes the speech before the execution settles: `followCliRound` never waits for the settle report. Carrying the fact there would mean holding the reply back, or adding a second write after settlement. The reading is already joined to each run on every read, so the room needs no copy.

**Mark mirrored steps in the member log.** The in-round append is deliberately dropped from the mirrored transcript (`promptsMarkTurns`), and the mirrored events are host types. Putting a plugin field on them would spread one fact across steps when it belongs to the round.

**Also forward the result to the original dispatcher (decision 5 = B).** Rejected by the user. The reply already went to that round's dispatcher, and we cannot tell which part of it came from the background result.

## Consequences

- Old logs show nothing: their end records have no field, and the core never infers one later.
- Only Kimi reports the field. Other providers leave it absent.
- If the wire cannot be read at settle, the field is absent and the reply carries no line.
- A result that arrives in a self-opened turn for another task is marked too, because the same reader runs at that turn's settle.

## Testing

- `local-agent-kimi/tests/self-turn.spec.ts`: in-round collection with labels, the turn boundary, the self turn's own echo, other injections and duplicates.
- `local-agent-kimi/tests/live-driver.spec.ts`: a live round whose wire holds an in-round task append reports `taskResults` in its settle.
- `local-agent/tests/execution-records.spec.ts`: the report lands on the end record and in `readExecution`; a round with none writes no field.
- `room/tests/usage-reading.client.spec.tsx`: the line in zh and en, labels joined, no line without results.
- Preview `room/tests/preview/self-round.html?state=folded`, captured at 1280 and 390.
