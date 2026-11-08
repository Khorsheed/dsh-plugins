# Agent Note: Withdraw a queued human message from its receipt line

Status: implemented

## Problem

The human notices on a message's receipt line ([receipt note](2026-11-08-room-message-receipt.md)) that it has not reached its member yet. The only way to take it back was the members page's inbox, which named the row only 「协作间派活」. Room timeline design B line, step B3 (pending item 4, decided A: withdraw on the receipt).

## Decision

- **Remote `withdrawDelivery({ sessionId, dispatchSeq, memberId })`** on the room service. Only a human delivery still `queued` can be withdrawn; anything admitted or settled is refused with the new failure code `not-queued`. The service journals `room/delivery-state cancelled` with `text: WITHDRAWN_TEXT` ('人撤回了这条', `src/delivery-notes.ts`) — an existing event type with its existing optional field — then asks the dispatch engine to take the delivery out of the queue.
- **CLI members**: `DispatchEngine` keeps each CLI delivery's abort controller while it waits in the core (`queuedStops`, removed at admission). `withdraw()` aborts it; local-agent's existing abort path cancels the queued ledger row — the same core action as the members page's 取消这条.
- **The room's own agent**: its deliveries wait in the room's own chain; `run()` already drops a delivery settled while it waited.
- **No double outcome**: `run()` records nothing more for a delivery that was never admitted and whose journal outcome is already terminal, so the core's 'cancelled' settlement does not write a second edge or a run row.
- **Receipt**: 撤回 (one recipient) or 撤回给X的 (several; one button per still-queued recipient). Afterwards the line reads 「已撤回 · 没有送到 X」; a refusal shows 「已经送到，撤不回了」 inline.

## Alternatives considered

- **Withdraw only from the members page** (pending item 4 B): the human finds the problem on the timeline; sending them elsewhere to act is the confusion this design removes.
- **Cancel the core row through the members-page control (`controlMemberInbox cancel`)**: it needs the core row's id or key from the browser and leaves the room's journal to catch up through the round's failure; journaling first and aborting the room's own handle keeps the room's record authoritative and the wording its own.
- **Delete or hide the bubble**: the room log is append-only and the message did happen; the receipt says it was withdrawn.

## Consequences

- A withdrawn message stays in the room's log. When the coordinator later becomes the native dsh agent, its history includes that message without a 「withdrawn」 mark (the design's accepted risk).
- A delivery admitted between the browser's render and the click is refused (`not-queued`), never stopped mid-round.

## Testing

`real-core.host.spec.ts` (real local-agent core): with one round running and two queued, the admitted one is refused, the second is withdrawn (one cancelled edge with `WITHDRAWN_TEXT`, its core row cancelled, no run of its own) and the third still runs next with only its own text. `receipt.client.spec.tsx`: 撤回 calls the face with the dispatch seq and member id and shows a refusal inline.
