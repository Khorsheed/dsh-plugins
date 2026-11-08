# Agent Note: A room round is cut at the questions it asks

Status: implemented

## Problem

A CLI member asks the human a question mid-round (`room/question`), the human answers, and the member goes on in the same round. Before this change the question card rendered only inside the running card and only while unanswered, so answering made it vanish; the member's next words grew in that same card, above where the human had just answered; when the round ended, the question reappeared embedded in the middle of one long reply. The human's reading position jumped twice. Design: `proposals/active/2026-11-08-room-timeline-interaction-order.md` step E1 (user decision 2026-11-08, pending item 6 = A).

## Decision

One rule: the timeline reads in the order things happened, and a member's round is cut where it stopped for the human. What it said before a question stays with the question card where it was asked; what it says after the answer grows below the answer, marked 「接着说」. No event type and no event field is added.

- **The question card is the round's card up to the question** (`RoomSegmentView`, reached through `RoomQuestionView` when the room-question renderer gets the new optional `segment` face). The `room-question` node is no longer hidden for a question with a `runId`. While it waits it carries the run-row header (「X 在等你回答」, elapsed, stop) and the run card renders nothing; once answered or expired it shows the identity row with a 「问了你」 chip and the folded question. The folded question follows the prototype's 问 + 答 (only on this card; the legacy in-reply look is unchanged): head 「问了你」, a green 「✓ 已回答」, the 「你」 chip and the answer in bold — or 「用下面这条消息回答了」 when the answer came by message (recognised by the room's answer-by-message head, mirrored client-side and pinned equal by a spec).
- **Its text, by data**: the landed reply's slice up to this question when the reply placed it; while the round runs, the member's live output from the previous question's settle time to this question's time (`renderMemberOutput` `since`/`until`); when that stretch has no live output (a refresh) or the round ended without placing it (stopped with no reply), 「……」 plus the `before` tail the question recorded.
- **The answer moves the round's card**: `answerQuestion` and an expiry while the round still runs append `room/run-moved` for the asker's run after `room/question-resolved` (this retires the 10-27 exception that question cards do not move running cards). Answering by message needs nothing extra: `postMessage` already floats running cards below the message.
- **The run card after an answer** shows only output since the latest settle and a 「接着说」 chip.
- **The landed reply** (`room/speech` with `asks`, every offset ≥ 0) shows only the text after the last question, headed 「接着说」. Copy still copies the whole reply.
- **Same-member grouping**: a 「接着说」 card that directly follows its round's question card in the rendered flow (nothing visible between) drops its avatar and name. Adjacency is read off the DOM (`data-chat-flow-key` seats; `data-room-seg=<runId>` on the question card), re-checked on render and on seat insertions. A message answering the question sits between, so that continuation keeps its avatar.
- **Replay** (`journal.ts`, state only): `RoomAsk` gains `before`, `resolvedAt` (first settle time), and `reply` (`seq`, `at`, `said` slice, `inline`), filled from the landed reply's `asks`.
- **local-agent**: `renderMemberOutput(id, startedAt, { since, until, empty })` (`MemberOutputOptions`); a live-output store's last unsubscribe now waits one macrotask, so one view handing the stream to another in the same commit (run card → question card) does not drop text of steps that already finished.

### Old logs (data, never dates)

- `asks[].at ≥ 0` → split as above.
- Any `at = -1` in a reply → that reply keeps its questions inside itself, first, marked 「提问于这一轮中途」; its question cards render nothing.
- A question without `runId` (pre-10-27) → its own row, unchanged.

## Alternatives considered

**Keep the question inside the run card but never let it vanish (pending item 6 B).** Smaller, but the answer and the member's next words still are not adjacent, and the landed reply still rereads the whole round. Rejected by the user.

**Cut without 「接着说」 or grouping (item 6 C).** The two cards then read as two different turns; grouping keeps it one member speaking twice.

**Grouping from the log instead of the DOM.** The view cannot know which visible nodes sit between two anchors without re-deriving the host's ordering; reading the seat before the card is exact and cheap.

**Storing the whole round text on the question event.** Would make the refresh case exact but changes what `before` means and bloats the log; the 160-char tail plus 「……」 is the design's agreed fallback.

## Consequences

- Room and local-agent must deploy together: an older local-agent ignores `since`/`until`, so both the question card and the continuation would show the whole live round.
- During a round, the live stretch boundaries use host `receivedAt` against room event times — both host clocks; a Kimi preview line still streaming at ask time may land in 「接着说」 instead of the question card (the 10-27 known gap).
- Quote/copy per card: the continuation's copy button still copies the whole reply (as in the member's own session); a quote tool picking card text gets only that card's part.
- Folding: the 600-char fold applies to the continuation's own text; the question card's slice is not folded.
- Briefly after an event, node state (immediate) and the room store's question log (debounced refresh) can disagree, e.g. the run card reappears one refresh after the answer.

## Testing

- `packages/room/tests/inline-questions.segments.client.spec.tsx`: replays at = 0 / at > 0 / at = -1 / no asks; in progress asking / answered (grouped) / answered by message (not grouped) / landed; stopped without reply keeps the tail.
- `packages/room/tests/questions.host.spec.ts`: answer → `room/run-moved` after the resolution, nothing moved with no running round, replayed `reply` slices and inline fallback.
- `packages/local-agent/tests/member-live-node.client.spec.tsx`: `[since, until)`, `empty`, finished text kept across a same-commit hand-off.
- Preview: `packages/room/tests/preview/segments.html?state=asking|answered|landed|message|legacy`, compared with the prototype 问题二 ⑥–⑩ at 1280 and 390.
