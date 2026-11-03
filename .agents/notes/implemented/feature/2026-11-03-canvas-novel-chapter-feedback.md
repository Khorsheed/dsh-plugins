# Agent Note: Chapter ideas become ordinary requests and archive on real writes

Status: implemented

## Problem

Readers notice awkward transitions, over-explained rules and missed emotional beats while reading a chapter, but selecting and copying each passage into a conversation breaks the reading flow. Turning every comment into a local patch would also create candidate texts and version chains even though these ideas are often prompts for reconsidering the whole chapter rather than exact replacement instructions.

## Decision

- The chapter reader owns a lightweight comment popover and an in-page chapter idea area, not another application sidebar. A selection records the complete quotation, raw offsets, surrounding context, body fingerprint and the person's thought; whole-chapter thoughts need no quotation. The optional quote plugin contributes the selection-menu action through `quoteActions`, while the novel supplies its own recording entry when quote is absent.
- Active ideas can be deleted and restored. A batch is prepared in `chapter-feedback.json` under the work's existing novel state directory, with every write protected by the calling session's fence and the store's version guard. It is separate from the cross-chapter 灵感 material library.
- 「填入对话」 appends plain editable text to the host conversation input and focuses it. Existing text is preserved, nothing is submitted by the plugin, and there is no JSON or hidden batch marker in the request. Every quoted original travels beside its thought and explicitly does not restrict the edit to that selection. An unmodified generated block can be restored on recall; user-edited composer text is never removed.
- Archiving requires three correlated facts: the final composer draft actually entered the turn, the same session wrote the same chapter, and the turn completed normally. The browser watches the official input state and submits the last non-empty draft as a candidate. `agent/pre-step` records the actual turn text. The store keeps bounded turn text, write receipt and turn outcome evidence so a composer candidate arriving after the tool write or turn end can still be matched exactly. Unmatched drafts can always be recalled; unrelated messages, other sessions and other chapters cannot archive a batch.
- The batch carries the body fingerprint at preparation. A later conflicting chapter version refuses the write as `stale`. Discussion without a write, cancellation, errors and conflicts leave ideas available rather than archiving them. Completion is idempotent, and new ideas belong to the next batch. A `byUser` chapter flag does not suppress an Agent rewrite; only a `byPerson` panel edit is excluded from completion.
- Archives retain ideas, quotations, actual submitted text and structured write receipts only. There are no candidate manuscripts, artificial revision numbers or prose parsing to infer completion. Old quotations remain readable when their original location can no longer be found; repeated quotations are relocated only when offsets or surrounding context identify a unique match.

## Alternatives considered

- **Per-comment patches and candidate versions.** Rejected: the person is collecting directions for an ordinary writing request, not approving exact local replacements. Storing every intermediate manuscript would add complexity without helping that workflow.
- **A hidden batch id or automatic model call.** Rejected: the composer must stay an ordinary editable request and the user must decide whether to send it. Actual turn text, not an invisible marker, correlates the batch.
- **Archiving on turn end alone, or on any chapter write.** Rejected: both can archive the wrong ideas. The session, turn, final draft and chapter write must agree, with conservative recovery whenever the correlation is absent.
- **Moving the comment system into quote, or replacing the existing 灵感 page.** Rejected: quote owns selection and quoting, while the novel owns chapter anchors, batches and writing completion. The material library and chapter-specific revision ideas serve different purposes.
- **Changing the upstream host.** Not needed: the official conversation input, quote action registry, agent pre-step and turn-stopping seams already cover the workflow.

## Consequences

- A batch whose submission cannot be correlated may remain open until the user recalls it. This is intentional: uncertain evidence never auto-archives.
- Only one open batch is allowed per session, work and chapter. Ideas recorded during an active batch wait for the next one.
- Ordinary canvas card comments are unchanged; this iteration covers novel chapter text only.
- The archived quotation is a snapshot, not a promise that the same words still exist in the current chapter. Missing or ambiguous anchors degrade to the snapshot instead of highlighting the wrong passage.
- A write that lands before a late composer candidate is claimed only if the final draft matches the actual turn text. Otherwise the batch remains unarchived and can still be recalled.

## Validation

- Store lifecycle tests cover edited submissions, normal and late candidates, unrelated messages, unsent drafts, other chapters, conflicting versions, interruption, deletion/undo, idempotent archiving and the next batch.
- Pure tests cover durable normalization, complete request text, repeated-quote relocation and raw block offsets. DOM selection tests cover highlighted nodes and cross-paragraph selections.
- Component tests cover whole-chapter comments, composer fill without submission, unavailable-composer rollback and archived originals with the actual request. Existing novel tests continue to pass with the new Remote mocked.
