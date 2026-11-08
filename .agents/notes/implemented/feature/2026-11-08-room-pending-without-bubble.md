# Agent Note: A room message with no bubble yet waits above the composer

Status: implemented

## Problem

The room's native dsh coordinator takes a message the human sends while it is busy only when its turn comes: until then the message is not in the room log (writing it would insert it into the running turn — the host derives every step's history from the log), so there is no bubble to carry a receipt ([receipt note](2026-11-08-room-message-receipt.md)). The queue row above the composer showed only its text, with no word that it had not arrived and no way to take it back. Room timeline design B line, step C1 (pending item 5, decided A).

## Decision

- **One rule**: a message with a bubble shows its state on the bubble; a message with no bubble yet is a row above the composer.
- **"No bubble yet" is data, no field**: the delivery replay notes whether the dispatch's `messageId` is already among the log's human messages (`RoomDelivery.bubble`, from the receipt step); absent means not in the log yet. Old logs have every such message written long ago, so no row appears.
- **The row**: every human delivery with a message id, no bubble, still queued or running reads 「待送达 · <text>」 in the composer's queue strip, with 撤回 while it is queued (the same `withdrawDelivery` Remote as the receipt). It leaves when the message lands in the log (`bubble: 'after'`), not when the delivery turns running — the host writes the bubble a moment after the room's running edge, and the row must not vanish before the bubble appears.
- The host's own `next-turn` queue rows stay as they were.

## Alternatives considered

- **A dashed 「待送达」 bubble at the bottom of the timeline** (pending item 5 B): a room node can only anchor at a log position, and while the native coordinator runs that position is inside its turn — the bubble would be drawn into the turn's process, folded with it when it ends (the mechanism of the 10-29 card-out-of-folded-turn fix), and would read as inserted into the turn.
- **Write the message into the log at once**: that is a steer into the running turn (T0 ③), not a queued message.

## Consequences

- The coordinator's 「等上一轮核对」 wording is kept for its blocked rows.
- A native-coordinator message with attachments still takes the room's write-first path (T0 ③): it has a bubble and a receipt, and the running turn already sees it on its next step — a known mismatch the design leaves as is.

## Testing

`room-composer.client.spec.tsx`: a native-coordinator message not yet in the log reads 「待送达 · …」 with 撤回 (calling the Remote with its dispatch seq and member), a CLI member's queued message with a bubble is not listed, and the row is gone once the bubble is in the log even while the delivery runs. `receipt.client.spec.tsx` pins that such a message has no receipt in the timeline.
