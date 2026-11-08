# Agent Note: The members page's queue shows what a room round asks

Status: implemented

## Problem

A CLI member's queue on the members page (`MemberInboxView`) lists every caller's waiting rounds, but a room round had no text on its ledger row — only room composer rows keep `text`, because only they replay — so it read 「协作间派活」 and the human could not tell which message it was. Room timeline design B line, step G1 (pending item 8, decided A).

## Decision

- **Optional `preview` on the core ledger row** (`LocalAgentMemberInput.preview`), set from a new optional `LocalAgentExecutionRequest.preview` (trimmed, at most 120 characters) and carried through `ExecutionPlan` into `MemberInbox.submit`. It is display only: it never counts as replayable input (a queued row without `text` is still dropped on load, as before) and takes no part in admission.
- **The room passes it** for every non-compaction round: the dispatch's own words (`previewOf`, whitespace folded, 120 characters), not the assembled prompt with the room's briefing.
- **The members page reads it**: a room row with a preview shows 「来自协作间：…」 (en 「From the room: …」); without one (older rows, older rooms) it keeps 「协作间派活」. Pause and cancel stay where they were — the members page is that member's console.

## Alternatives considered

- **Keep 「协作间派活」** (pending item 8 B): the human cannot tell rows apart.
- **Store the room round's full `text`**: `text` means "replay this after a restart", which room rows must not do (the room resubmits its own deliveries); a separate display-only field keeps that meaning intact.
- **Have the browser look the text up in the room**: the members page would have to read the room's journal and match delivery keys; the ledger row is already what it renders.

## Consequences

- An older core ignores the request field; an older members page ignores the row field; a newer core reading a ledger written before this note simply has no previews. No migration.
- The ledger file grows by at most 120 characters per room row (terminal rows are capped as before).

## Testing

`local-agent` `member-inbox.spec.ts`: a preview is stored durably on the row and is not `text`; a row without one has none. `member-inbox.client.spec.tsx`: a room row with a preview reads 来自协作间：…, one without keeps the caller name. `room` `real-core.host.spec.ts`: a human dispatch's ledger row carries the message's words as its preview.
