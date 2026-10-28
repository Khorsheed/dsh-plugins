# Agent Note: a member's live preview is withdrawn when its own step opens

Status: implemented

## Problem

A live round's member card showed one message twice: a frozen copy cut off mid-sentence above a live copy. The Codex and Claude Code live drivers stream a message that cannot open its log step yet (an earlier step is still open) as a browser-only preview, keyed `<turn>:<provisional step>:<itemId>`. Once the step opens, the message streams under its durable key `<turn>:<step>`. The preview was cleared only when the message finished (`finish(stream.step)`), so for the rest of the message both items stood in the live store. The room's live card renders every item, which is how the duplicate appeared.

## Decision

`LiveStreamPublisher.dropPreview(step, itemId)` withdraws the preview's item from the live registry. Both drivers call it in `openStreamStep`, the moment the message moves to its durable key. The call is optional-chained, so a driver running against an older core keeps today's behaviour. Kimi only previews and never moves to a durable key, so it is unaffected.

## Alternatives considered

- **Have `update` drop any preview of the same item.** Previews do not record the durable step they will take, and `update` is not told the item id, so this would need a lookup the drivers already have for free.

## Consequences

No double text while a message streams. The final rendering is unchanged.

## Testing

`local-agent`: a live-stream spec previews an item, drops its preview, updates it under its durable step, and expects a follower's baseline to hold only the durable item. The codex and claude-code suites stay green.
