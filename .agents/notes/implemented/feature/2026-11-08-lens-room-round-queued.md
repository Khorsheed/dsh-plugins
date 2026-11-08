# Agent Note: Context Lens says how long a room message queued

Status: implemented

## Problem

A human message to a busy CLI member waits in the core's queue until the member's current round ends. In Context Lens the room round that message opened started at the message's time, so a round that sat queued for over a minute looked like a member that took a minute to get going. Design: `proposals/active/2026-11-08-room-timeline-interaction-order.md` step H1 (user decision 2026-11-08, pending item 9 = A).

## Decision

A room round's title in Context Lens reads 「排队 1 分 19 秒后开始」 (en: "queued 1m 19s before it started") when the human's message waited noticeably.

- The wait is computed from data Lens already reads: the human `room/dispatch` time to the earliest `startedAt` among the runs that dispatch delivered (`roomQueuedMs` in `packages/context-lens/src/room.ts`).
- Under 3 seconds (`ROOM_QUEUED_SHOWN_MS`) counts as delivered at once and shows nothing; a round none of whose runs started yet shows nothing.
- It travels as the optional `room.queuedMs` on the turn record and summary, rendered beside the 「房间 → …」 source chip.
- Old logs need nothing: dispatch time and run starts are in every room log.

The room → Lens contract fixture is unchanged: the E1 `room/run-moved` after an answer happens outside the scripted lifecycle the contract records, and Lens does not read `room/run-moved` anyway.

## Alternatives considered

**No label (pending item 9 B).** The data was already there and the confusion is real; the user chose A.

**The latest run start, or one label per target.** A multi-target message whose first member starts at once did not wait from the human's point of view; one label from the earliest start keeps the title short.

**Showing every wait, however small.** Admission takes a few hundred milliseconds normally; labeling that is noise, the same reason the room's receipts stay quiet on immediate delivery.

## Consequences

- The threshold is a judgment call (3 s); a slow host admitting in 3–5 s would show a short wait.
- The label is only on the round title, not the turn menu.

## Testing

`packages/context-lens/tests/room-rounds.spec.ts` (79 s wait labeled, immediate start not); `packages/context-lens/tests/client-panel.spec.tsx` (minutes/seconds wording).
