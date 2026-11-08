# Agent Note: Above the room composer, member-level queue state only

Status: implemented

## Problem

Once a human message's delivery state reads on its receipt line ([receipt note](2026-11-08-room-message-receipt.md)), the rows above the room composer repeated the same message: the coordinator's room deliveries as preview rows, and the core ledger's inbox (`MemberInboxView`) with a 「协作间派活」 row per room round plus the pause button. Room timeline design B line, step B2 (pending item 3, decided A).

## Decision

- **Capsules, not rows** (`src/client/queue-capsules.ts`, `RoomQueueCapsules.tsx`, rendered through a new optional `extra` seat of `RoomTaskCapsule`): 「⏳ N 条消息在等 X ↑」 per member with queued human deliveries that have a bubble (a count — the click scrolls to the first one's receipt), 「⏸ X 的队列已暂停 · 继续」 per member in `restartFacts.queuePaused` (继续 resumes through the core; without the control it opens the member's session), and the coordinator's 「⚠ X 上一轮待核对 · 去核对」 when it has an uncertain or reconcile-waiting delivery (opens its session).
- **Rows only for what has no bubble**: the strip keeps the host's `next-turn` queue and the coordinator's human deliveries whose message is not in the log yet (the native coordinator's direct path; step C1 extends this).
- **local-agent**: `LocalAgentUi.renderRoomMemberInbox` renders `MemberInboxView` with `room`: the room's own queued rows (`caller: 'room'`) and the pause control are left out; other callers' rows, failures and 待对账 stay. `LocalAgentUi.controlMemberQueue(childSessionId, 'pause' | 'resume')` backs the 继续. Both are optional; the room falls back to `renderMemberInbox` on an older core. The members page's inbox is unchanged.
- The receipt's 继续队列 uses the same control.

## Alternatives considered

- **Keep listing every queued message above the composer** (pending item 3 B): each waiting message would read twice.
- **Remove the strip entirely** (item 3 C): the native coordinator's not-yet-written messages would have nowhere to show.
- **A 「另有 1 条来自成员页在等」 capsule**: the room's inbox copy already lists those rows with their own text and cancel; a capsule that only links to the members page would hide that text. Not built.
- **Change `renderMemberInbox`'s signature**: a new optional method keeps older rooms and cores compatible and does not touch the signature line other work edits.

## Consequences

- Pausing the queue is no longer offered from the room (only resuming); the members page keeps both.
- The paused capsule appears only when the core holds composer input behind a paused queue (`CoreLedgers.paused`), as `restartFacts.queuePaused` already defined.

## Testing

`room-composer.client.spec.tsx`: two queued messages with bubbles → one 「⏳ 2 条消息在等 ada」 capsule, no message text, no strip; a paused member gets its capsule, which resumes through `controlMemberQueue`. `local-agent` `member-inbox.client.spec.tsx`: the room's copy drops room rows and the pause control, keeps a composer row, and renders nothing when only room rows wait.
