# Agent Note: a Kimi round reports its final call's usage, and an early settle leaves no route behind

Status: implemented

## Problem

Room 75844e33, Kimi member 尼尔盖曼 (live ACP drive):

- **The last call's usage was never counted.** In the child session, every turn's last `assistant/message` carried no usage: turn 2 had usage on step 1 only, turn 4 on steps 1–2, and turn 3, a single call, had none. The settle report summed only the usage the turn's messages carry, so the 13:06 reply showed no usage and every other round under-counted. The final call's `usage.record` reaches the driver in a later mirror pass, after the file fold has already written that message. It sums into `roundUsage`, and that rest is attached only when settle itself finalizes the last stream. When the fold had written it, the rest went nowhere (the host has no usage backfill event).
- **The next round's settle landed on the previous round.** Yesterday's fix (`2026-10-28-late-settle-routes-to-its-round`) parks a finished round's progress route until its settle report arrives. Kimi's settle callback is chained on `run.result` before the facade's own result handler, so it reports while the round is still tracked. The facade then parked the route anyway, and the next round's settle went to it: run 60's usage was journaled under run 27.

## Decision

- **kimi**: the settle observation adds the uncarried `roundUsage` to the sum of the turn's message usage.
- **local-agent**: a tracked run that receives its `settled` report is marked `settled`, and the result handler does not park a run that owes nothing.

## Alternatives considered

- **Write the remainder onto the last message.** That would need an event that amends an appended message; the host has none. The child session's own message footers (and the host switcher's total) therefore still miss the final call. The room's usage, which reads the settle observation, is complete.

## Consequences

A Kimi reply shows its round's whole usage, and the room's per-member total stops under-counting. Rounds that settle early no longer pull in the following round's report. Records already journaled stay as written.

## Testing

`local-agent`: a facade spec settles a round before its result resolves, starts the next, and expects the next settle to reach the next call. `local-agent-kimi`'s existing settle-usage spec still holds.
