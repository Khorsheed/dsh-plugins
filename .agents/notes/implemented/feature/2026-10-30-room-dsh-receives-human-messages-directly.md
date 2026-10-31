# Agent Note: the room's own agent receives a human message as itself

Status: implemented

## Problem

A human message for dsh, the room's own agent, reached it twice. `postMessage` wrote the human's `user/message` into the room session, which is dsh's own session, so the words were already in its context. Then `runMainAgent` wrapped the same words with the briefing, room changes and held reports into a `source: room` message and sent it with `agent.followup`. The host renders a room-sourced turn opener as a 「收到执行请求」 trigger card (ui-chat `turn-trigger`), so the conversation showed the human bubble followed by a card repeating it, and the model paid for the words twice. Members, which are CLI agents, never had this: their copy lives in their own child session.

## Decision

- When a human message targets the main agent, carries no attachments, and the room's agent is live, `postMessage` no longer writes the `user/message` itself. It still files the message into a task, appends the `room/dispatch` and floats running cards. The engine gets `direct: human`, and `runMainAgent` calls `agent.followup(human)` with the human's own message: one write, the host's own turn, no trigger card. A busy agent queues it in its inbox as any session does, so the room's queue strip shows it, and the host's queue actions apply.
- The room's additions — briefing on the first round, room changes, notifications, held reports, and the outside-session note — are computed as before, minus the words. They are kept in `engine.directExtras` by message id. A new `agent/pre-step` hook inserts them as one room-sourced message just before the human's, on that turn's first step, and only when there are any. Most rounds therefore start with no card at all.
- `engine.directMessages` marks such messages, so that turn's other pre-steps leave them alone:
  - task filing already ran in `postMessage`;
  - held reports already ride the additions;
  - the CLI-coordinator guard treats the message as the room's own dispatch instead of re-routing it.
  
  The marks clear when the run ends.

## Alternatives considered

- **Keep the copy, but drop the words from it.** That removes the double context, but the host still draws a trigger card for every room-sourced opener, and the room cannot hide a host node.
- **Move attachments onto the direct path now.** Their upload receipts bind to the message the moment the room writes it into the log. On the direct path the host writes it later, or never if the queued message is withdrawn, so a receipt could be reclaimed or leak. Messages with attachments keep the old path for now.

## Consequences

A message to dsh shows once, as a plain bubble, and dsh's context holds it once. While dsh is mid-turn, the message waits in the queue strip and enters the transcript when its turn starts — the host's own behaviour. dsh's queue gains the host's queue actions (edit, remove, 插话), which the 插话 design can rely on.

## Testing

`room`:
- dispatch spec: the followup is the human's own message (source user, exact text), no room-written copy, the additions carry the briefing and `room_message` without the words, and the marks clear after the run.
- help spec: the outside-session note rides the additions.
