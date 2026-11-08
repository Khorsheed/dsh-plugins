# Agent Note: A reply says which message it answers when a later one waited

Status: implemented

## Problem

The room orders by what happened (pending item 1, decided A): a member's reply lands where it finished, which can be below a later message the human sent it while the round ran. Read top to bottom, the reply looks like an answer to the later message, which the member had not even received. Room timeline design B line, step B4.

## Decision

- `replyTarget(runId, speechTime, state)` (`src/client/reply-target.ts`) reads the deliveries only: the reply's own delivery (a human message), and the first later human delivery to the same member with a bubble that was sent after this round started and before the reply landed, was not taken into the round as an answer, and was neither withdrawn nor held.
- When there is one, the reply card opens with the quiet 「↑ 回复的是 21:56 那条 · 你 22:05 那条刚开始处理」 line, in the same place and style as the existing cause line. A click scrolls to the later message's receipt (the earlier message, taken in at once, has no receipt row to scroll to; the official bubble carries no id).
- Pure display, no data added: old logs get the line wherever their deliveries show the shape.

## Alternatives considered

- **Keep a waiting message below the running round until it is received** (pending item 1 B): new replies would land above the message the human just sent; they would have to look up.
- **Split the round at the waiting message** (item 1 C): treats a message the member never saw as an interaction point — misleading.
- **Scroll to the answered message itself**: impossible without a DOM handle on the official bubble; a zero-height marker row under every human bubble would add a gap to every message.

## Consequences

- 「刚开始处理」 is literally true when the reply lands; read later, the next round's card or reply sits right below, so the line still points the right way.
- The line names clock times only; two messages within the same minute read the same time.

## Testing

`tests/reply-target.client.spec.tsx`: the incident's shape gives the reply the line (target: the second message's receipt) while the second reply gets none; no later message, a message sent after the reply, or one taken as an answer give no line; the speech card renders it.
