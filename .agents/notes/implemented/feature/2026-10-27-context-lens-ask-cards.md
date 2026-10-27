# Agent Note: Context Lens shows ask_user_question as a question card

Status: implemented

## Problem

When a member or the main agent called `ask_user_question` (bare, or behind an MCP prefix such as `mcp__dsh-member__`), Context Lens showed the raw arguments and the raw `{"answers":[…]}` result. Reading what was asked, which option the human chose, and how long they took meant parsing JSON by eye. Member mirrors written before the drivers' 10-27 fix also dropped the nested `questions` argument, so those calls showed nothing at all.

## Decision

A tool call whose name ends with `ask_user_question` renders as a card titled 「问你」. Each question gets a line with its `header` as a small tag. Its options follow, with the chosen ones marked. The answer line 「你的回答」 follows, then any free text as 「其他：…」. The card also shows a status and the wait.

- Questions come from the call's own arguments. When those are missing, they come from the room's `room/question` record, so old logs are covered without rewriting them.
- The room record is matched by `runId` first: the run's `childSessionId` must be the request's scope, and its `childTurn` the request's host turn. When the run cannot confirm the turn, the question must also fall within 30 minutes of the call. The fallback matches the same member within 30 minutes, prefers a record whose answers equal the call's result, and otherwise takes the nearest in time.
- The wait is the room's asked → answered time, or the call's own span when there is no room record.
- Status:
  - A room answer wins over the call's result, because a late answer arrives after the call has already failed. The call's own failure then shows as a footnote.
  - Cancelled in the room reads as 「已过期，仍可回答」, and `late: true` reads as 「已补答」.
  - Failure text maps as follows: `-32001` / "Request timed out" → 等待超时, "aborted before the user answered" → 已中止, "user cancelled" → 已取消, expired → 已过期. Anything else shows its text.

## Alternatives considered

- **Rewrite old member logs with the room's questions.** Logs are append-only history, and the room already holds the truth.
- **Match by member and time only.** Several questions from one member in a session are common, so `runId` first avoids crossing them.

## Consequences

Context Lens only reads. Neither room nor any CLI driver changed. A call with no arguments and no matching room record says the question text was not recorded.

## Testing

`context-lens`: `tests/ask.spec.ts` covers name recognition, argument and room sources, expired/late/timeout/aborted/cancelled, runId matching, the member fallback, and refusing an unconfirmed `runId` hours away. `tests/client-tool-results.spec.tsx` renders the card's answered and expired states.
