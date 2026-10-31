# Agent Note: a late settle report goes to the round it observed, not the round that started after it

Status: implemented

## Problem

A provider computes a round's settle observation (model, usage) after `run.result` resolves, so the facade parks the call's progress route for `RUN_PROGRESS_SETTLE_GRACE_MS`. But `trackRun` dropped that parked route as soon as a new round started on the same child session. A room member with a queued message starts its next round the moment the previous result resolves. So the previous round's settle landed on the NEW round's `onProgress`, and the room wrote its `room/execution-metadata` under the new run id. In room 5d4f0d41, the reply of run 414 showed no usage, while run 421 carried 414's. The 14:56 failed run 388 had its usage filed under 394. The same thing happened all through the earlier history, whenever a backlog was queued.

## Decision

- A new round no longer drops the previous round's parked route; the route's grace timer still bounds it.
- `reportRunProgress` sends a `settled` report to the parked (older) route first, which then closes. Every other kind of progress goes to the running round as before.

## Alternatives considered

- **Carry a round identity on `recordRoundSettled`.** That is exact, but it touches every provider and the shared channel's signature. Rounds settle in order, so ordering is enough.

## Consequences

A member's reply keeps its own usage even when its next round starts immediately. One edge case remains: a provider that never reports a settle for a round, followed by a next round that settles within the 60 s grace, would hand that next settle to the older round. No current provider skips a settle on a normal path. Records already misfiled stay as they are.

## Testing

`local-agent` (422): a facade spec resumes a child, settles the result, then resumes again before the observation arrives. The late settle reaches the first call. Live progress, and the second round's own settle, reach the second call.
