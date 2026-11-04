# Agent Note: Chapter ideas become ordinary requests and archive on real writes

Status: implemented

## Problem

Readers notice awkward transitions, over-explained rules and missed emotional beats while reading a chapter, but selecting and copying each passage into a conversation breaks the reading flow. Turning every comment into a local patch would also create candidate texts and version chains even though these ideas are often prompts for reconsidering the whole chapter rather than exact replacement instructions.

## Decision

- The chapter reader owns a lightweight selection-comment popover and an on-demand floating idea panel, not another application sidebar or a permanent reading-column rail. Selecting text opens only the host quote menu; its contributed `quoteActions` item opens the comment popover with the host-provided session. Registration follows Cordis `internal/service` notifications so a quote provider that becomes ready after the novel still gains the action, and removal retracts it; read-only canvases never register it. A selection records the complete quotation, raw offsets, surrounding context, body fingerprint and the person's thought. Whole-chapter questions stay in the ordinary conversation instead of duplicating them in another input. The idea panel stays unmounted until the chapter's compact Ideas button opens it, portals directly below that button, and closes on outside click or Escape; narrow screens clamp it inside the reader.
- Active ideas can be deleted and restored. Each batch is prepared in `chapter-feedback.json` under the work's existing novel state directory, with every write protected by the calling session's fence and the store's version guard. It is separate from the cross-chapter 灵感 material library.
- 「填入对话」 appends plain editable text to the host conversation input and focuses it. Existing text is preserved, nothing is submitted by the plugin, and there is no JSON or hidden batch marker in the request. Every quoted original travels beside its thought and explicitly does not restrict the edit to that selection. An unmodified generated block can be restored on recall; user-edited composer text is never removed. Multiple open batches are independent: a later idea can be prepared and sent while an earlier batch is still unresolved.
- Archiving requires three correlated facts: the final composer draft actually entered the turn, the same session wrote the same chapter, and the turn completed normally. The browser watches the official input state and submits the last non-empty draft as a candidate. `agent/pre-step` records the actual turn text. Submission matching accepts exact text or the complete trailing block after a host-added prefix, never a batch quoted before unrelated instructions. Writes through the novel tool leave a receipt. Direct file writes count only when this turn's successful `tool/call` / `tool/result` pair targets the chapter manuscript and its final fingerprint differs from the batch baseline; reads, failed calls, unrelated files and panel edits do not qualify. The store keeps bounded turn text, write receipts and turn outcomes so a composer candidate arriving after the write or turn end can still be matched conservatively.
- The batch carries the body fingerprint at preparation. A later conflicting chapter version refuses the write as `stale`. Discussion without a write, cancellation, errors and conflicts leave ideas available rather than archiving them. Completion is idempotent, and new ideas belong to a new open batch. A `byUser` chapter flag does not suppress an Agent rewrite; only a `byPerson` panel edit is excluded from completion.
- Archives retain ideas, quotations, actual submitted text and structured write receipts only. There are no candidate manuscripts, artificial revision numbers or prose parsing to infer completion. Old quotations and older whole-chapter ideas remain readable in their batches. Repeated quotations are relocated only when offsets or surrounding context identify a unique match.

## Alternatives considered

- **Per-comment patches and candidate versions.** Rejected: the person is collecting directions for an ordinary writing request, not approving exact local replacements. Storing every intermediate manuscript would add complexity without helping that workflow.
- **A hidden batch id or automatic model call.** Rejected: the composer must stay an ordinary editable request and the user must decide whether to send it. Actual turn text, not an invisible marker, correlates the batch.
- **Archiving on turn end alone, or on any chapter write.** Rejected: both can archive the wrong ideas. The session, turn, final draft and chapter write must agree, with conservative recovery whenever the correlation is absent.
- **A novel-owned selection popup or permanent idea rail.** Rejected: the private popup competes with the host quote menu for the same gesture, while the permanent rail compresses the reading column even when empty. Quote owns selection; the chapter's on-demand panel owns batch review.
- **Moving the comment system into quote, or replacing the existing 灵感 page.** Rejected: quote owns selection and quoting, while the novel owns chapter anchors, batches and writing completion. The material library and chapter-specific revision ideas serve different purposes.
- **Changing the upstream host.** Not needed: the official conversation input, quote action registry, agent pre-step and turn-stopping seams already cover the workflow.

## Consequences

- A batch whose submission cannot be correlated may remain open until the user recalls it. This is intentional: uncertain evidence never auto-archives.
- Multiple open batches are allowed per session, work and chapter. Their candidate watchers, composer blocks, write receipts and completion states remain independent.
- Ordinary canvas card comments are unchanged; this iteration covers novel chapter text only.
- Without the optional quote plugin there is no new-comment gesture. Existing ideas and archived batches remain readable; whole-chapter questions use the ordinary conversation.
- A direct file write with no successful, chapter-targeted tool call in the same turn stays unarchived. A changed file alone is not sufficient evidence.
- The archived quotation is a snapshot, not a promise that the same words still exist in the current chapter. Missing or ambiguous anchors degrade to the snapshot instead of highlighting the wrong passage.
- A write that lands before a late composer candidate is claimed only if the final draft matches the actual turn text or its complete trailing block after a host prefix. Otherwise the batch remains unarchived and can still be recalled.

## Validation

- Store lifecycle tests cover edited submissions, host-prefixed turns, normal and late candidates, unrelated messages, unsent drafts, other chapters, conflicting versions, interruption, deletion/undo, idempotent archiving, direct Bash writes and multiple open batches.
- Pure tests cover durable normalization, complete request text, repeated-quote relocation, raw block offsets, trailing-block matching and successful versus failed/read-only/other-file tool calls. DOM selection tests cover highlighted nodes and cross-paragraph selections.
- Component tests cover the initially hidden panel, button anchoring, outside-click and Escape dismissal, no private selection popup, quote-action session propagation, later-batch fill, composer fill without submission, unavailable-composer rollback and archived originals with the actual request. A real Cordis composition test covers late quote-service arrival, ref/session gating and removal. Existing novel tests continue to pass with the new Remote mocked.
