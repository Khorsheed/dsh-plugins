# Agent Note: the room shows what members send each other, and what each reply answers

Status: implemented

## Problem

In a room with an external coordinator (a Codex member as 游戏策划大师), the chat showed only replies. A coordinator's 派活 to 人物建模师, or a member's 告知, lived in the journal and the task view but never in the transcript. So a reply read like the coordinator talking to itself, and nothing on a member's reply said which request or report it answered.

## Decision

- **Member message rows (`room-dispatch`).** A one-line chat node per `room/dispatch` whose origin is `coordinator` or `member`: `↪ 游戏策划大师 派活给 人物建模师：…` (告知 for notify, drawn lighter). A click opens the full text. A recipient that has not picked the message up yet shows 排队中 (暂存 / 已取消 / 没送达 likewise). The state is read from the room state at render time, so the Definition claims only the dispatch event. Unclaimed:
  - the human's messages (official user node);
  - reports (the reply's 已汇报给 line and the gate row already carry them);
  - help and legacy relays (their own rows);
  - the native main agent's sends. Its tool call already shows in the chat. It joins with no id, and its sends carry the `legacy:<seq>` join identity, which is how they are told apart.
- **Cause line on a reply.** The reply's run id is its delivery id, so `speechCause` (client/speech-cause.ts) reads that delivery:
  - a member's send → 「回应 X 的派活：…」 or 「回应 X 的告知：…」;
  - a report → 「回应 X 的汇报」;
  - a release round → the held reports' senders, joined.
  
  A click scrolls to the source row and flashes it: the message row, or the reporter's reply (now tagged `data-room-run`). Human-started and help rounds get no line. `RoomDelivery` gains `reportFor` and `releases` for this.

## Alternatives considered

- **Fold 告知 into a count.** Rows for one exchange are not adjacent in the transcript, so a count has no natural place. A one-line, lighter row costs about as much space.
- **Claim `room/delivery-state` updates in the Definition.** Every human delivery would open an orphan Context with no start, because a Definition's match sees one event and cannot tell origins apart.

## Consequences

A room with an external coordinator now reads as a conversation: who asked whom, and what each reply answers. Rooms coordinated by native dsh look the same as before, apart from cause lines on member replies. Scrolling to a row that the chat has not rendered (far up) is a no-op.

## Testing

`room`: node specs cover which dispatches the Definition claims, the row (names, 排队中, opening the full text), and `speechCause` for a member send, a report, the native agent's send (no target), a release round and a human round.
