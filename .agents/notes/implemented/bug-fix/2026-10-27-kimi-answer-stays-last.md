# Agent Note: a Kimi round's answer stays its last step

Status: implemented

## Problem

After 2026-10-26's write-order numbering (59c2cbb24), a Kimi member's chat showed only "已完成，用时 2 分 2 秒": the answer was folded into the process. The round's log ended with steps written after the answer:

- **Orphan duplicates.** From kimi's second round on, ACP reports a call as `1:tool_x`, while the wire records `tool_x`. The fold released reservations by the wire id, so the ACP reservation never matched. Settle then re-wrote every such call as an "interrupted" orphan, now after the answer. fbc8ba18 had 10 of these and 2e9c1ffb had 15. Before the write-order change they took earlier reserved numbers, which hid them, but those numbers were the out-of-order steps that corrupted logs.
- **The plan.** ACP plan updates were a think-styled stream finalized at settle, so the todo list became a reasoning step after the answer.

The chat takes a round's last step as its answer.

## Decision

- An ACP `toolCallId` is unprefixed (`^\d+:`) before any matching, so a call kimi logged is reserved once, released by its fold, and never re-written as an orphan.
- A plan update is the host's `todo/write` whole-list snapshot, written only when it changed. This is Claude's TodoWrite shape: log-only UI state, never a conversation step. The `todo/write` type is declared by the host's todo package, which this package does not depend on, so the append is cast and the item type is local.
- The two affected logs were repaired offline: orphan duplicate steps and plan-only reasoning steps were dropped, steps renumbered by position, and the logs validated before replacement.

## Alternatives considered

- **Strip the prefix on the wire side.** The wire's bare id is the one the fold, the log and tool results already use; only the ACP notification carries the prefix.
- **Keep the plan as a step, written before the answer.** The plan updates throughout the round and is complete only at settle, so it would be stale, and a settle write still lands last.

## Consequences

- New rounds end with the answer, so the chat shows it again.
- Repaired logs lose the plan snapshots that had been folded as reasoning steps. The plan was progress display, not model output.

## Testing

`local-agent-kimi` (291). A live-driver spec with an ACP `1:tool_x` and a wire `tool_x` asserts one call and the answer last; the previous code writes `['tool_x', '1:tool_x']`. The plan specs assert the `todo/write` snapshot, no plan reasoning, and the answer last.
