# Agent Note: a member's running card leaves a folded coordinator turn, and a message answers its waiting question

Status: implemented

## Problem

Room 75844e33: the coordinator (native dsh) invited 尼尔盖曼 in the middle of its own turn, so the member's `room/run-state` running edge was written inside that turn (between its steps). When the turn ended, the host folded the turn's process into 「已完成，用时 1分8秒」, and the member's live card went with it. The member then asked a question. The inline question block sat inside the folded card, and the composer's 「尼尔盖曼 等你回答 ↑」 capsule found no `[data-ask-id]` element to scroll to, so the click did nothing. The only way to answer was in the member's own session.

## Decision

- **On the room's `turn/end`, while members run**, `floatRunningCards` re-anchors their cards below the turn: one `room/run-moved` each, the same move a reply or human message already triggers. This runs in `observeActivity`, deferred a microtask so the move is not appended inside the event emit. Turn ends in member child sessions are ignored, because the active-run set is keyed by room.
- **When a member asks**, its card moves to the bottom right before the `room/question` is appended. The question renders inside that card, and the human is at the bottom.
- **A message to a member that is waiting on its question answers it.** In the same room, the human then @-messaged 尼尔盖曼 instead of answering. The message queued behind the waiting round, so nothing could move until the 30-minute question timeout. Now `postMessage` checks each recipient first. If its question has a live waiting call (and is not a consent gate), the message resolves the card as `answered`: the first question's custom answer is `没有选选项，直接回复了：<message>`. The delivery settles `done` (`ANSWERED_QUESTION_TEXT`), with no round of its own, and the member's call returns the answer right away.

## Alternatives considered

- **Cancel the question and deliver the message as a new round.** The member's round would continue without the human's words, and the queued round would then repeat the context. Answering through the waiting call keeps a single round.
- **Have the capsule unfold the host's turn fold.** That fold belongs to the host's chat view and has no public opening API. It would also leave the live card hidden for the rest of the round.

## Consequences

A member started mid-turn stays in view once the turn ends, and a question always shows where the capsule points. Talking to a member that is waiting on a question never stalls: the message is the answer. A run already folded before this change stays folded until its round ends or the next turn ends.

## Testing

`room`: the mid-round question spec now expects the asker's `room/run-moved` before the question. A new spec has a member running across a room `turn/end` and expects the move; a turn end with nothing running moves nothing. Another spec messages a member while its question waits: the call returns the message as the first question's custom answer, the delivery is done, and no provider round starts.
