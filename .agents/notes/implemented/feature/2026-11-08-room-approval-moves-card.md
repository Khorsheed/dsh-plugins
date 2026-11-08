# Agent Note: Answering a tool approval moves the running card below it

Status: implemented

## Problem

A CLI member's mode tool that needs the human puts a 允许 / 拒绝 row in the room ([running cards float](2026-10-27-room-running-card-floats.md): asking does not move the running card, so the row needing action stays last). Once the human answers, the member goes on working — but its running card still sits above the approval row, so the output after the answer grows above the place the human just acted. The room timeline design counts an approval as an interaction point (the round took in the human's input); step E2 (pending item 7, decided B first).

## Decision

- `answerApproval` writes `room/run-moved` for the running members (`floatRunningCards`) right after `room/approval-resolved`, so the card continues below the approval row. Asking still moves nothing.
- Only the card moves; the round's text is not split at the approval. Splitting it needs a recorded cut point on the approval (a `before` tail) and is left for when steering adds `room/speech.marks` (design F).
- No new event type or field: `room/run-moved` is the existing move edge.

## Alternatives considered

- **Split the reply's text at the approval too** (pending item 7 A): needs new optional fields on `room/approval`/`room/speech`; deferred to the steering work that needs the same mechanism.
- **Leave approvals alone** (item 7 C): the post-answer output keeps growing above the human's action — the reading-position break this design removes.
- **Move only the asking member's card**: `floatRunningCards` keeps every running card below the latest thing that happened, the same rule replies and human messages already follow; moving one card would let another member's card sit above an answer it came before.

## Consequences

- A call that ends without the human (cancelled, the round stopped) moves nothing; the round is ending anyway.

## Testing

`tests/approvals.host.spec.ts`: with the asking member running, asking writes no move; the human's answer writes `room/run-moved` for that member after `room/approval-resolved`.
