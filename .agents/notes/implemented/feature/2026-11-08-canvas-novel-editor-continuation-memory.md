# Agent Note: Chapter editing hands off through the composer and resumes locally

Status: implemented

## Problem

The chapter editor presented a selection-dependent Ideas button beside an unrelated Agent continuation button. The continuation could start a turn while the current draft existed only in browser storage, so the agent's required chapter read could return an older manuscript. The editor remembered draft text but not the chapter, mode, caret or scroll position, forcing the person to find their place again after reopening.

## Decision

- Editing keeps only cancel, character count and save in its top bar. The selection-to-Idea action is removed from the editor; the standalone Ideas page and preview's chapter-feedback flow are unchanged. A quiet continuation link sits inside the lower edge of the editor surface rather than adding another toolbar.
- Continuation first writes the current draft through the existing `editChapterBody` path and its `baseHash` conflict guard. Failure or `stale` leaves the draft, position and edit mode intact and does not touch the conversation. Success clears only the persisted draft, returns to preview and calls `draftToConversation`, never `sendToConversation`. Existing composer text is preserved and the person decides whether to edit and send the request. If the composer is unavailable, the entry is hidden; a failed fill after saving reports that the manuscript was saved but the request was not added.
- The generated request names the exact `novel_read(what=chapter, chapter=N)` call and requires a fresh read rather than conversation memory. It includes the last 80 characters saved at preparation time as a sanity check. A mismatch means a later version exists: the agent must use the newly read version and disclose the change rather than overwrite it with the prepared draft.
- The request defaults to continuing at the end without repeating earlier prose. Necessary earlier edits for continuity, contradictions or transitions are allowed, but the agent must identify each changed earlier passage and explain why. `novel_write` must receive the complete manuscript, including retained prose, necessary edits and the continuation, rather than only the new fragment.
- Browser-local, versioned records remember the last chapter and mode per canvas and the caret/selection plus textarea scroll per chapter. A fresh explicit navigation target wins over memory. Returning to the contents clears automatic chapter resume without deleting per-chapter edit positions. Cancel clears both draft and position; save and continuation preserve position. Existing draft keys and their plain-string values remain compatible.
- Position restoration clamps offsets to the current text, restores the selection and textarea scroll after layout, and brings the editor into view without focusing it. This avoids an unsolicited mobile keyboard. Selection changes persist immediately; scroll writes coalesce through `requestAnimationFrame`, with an unmount flush. Malformed, outdated or unavailable storage degrades to the previous behavior.

## Alternatives considered

- **A permanent selection toolbar or a textarea-following selection popup.** Rejected: editing should remain editing. The general quote menu deliberately excludes textareas, and a mirrored-text coordinate implementation would add fragility, especially around a phone keyboard.
- **Sending the continuation directly.** Rejected: the request must remain an ordinary editable composer draft. The person can add pacing or dialogue instructions and makes the final decision to send.
- **Drafting a continuation without saving first.** Rejected: the model reads the manuscript from the workspace, not browser-local draft text. Saving is therefore part of preparing an accurate request, even if the person later chooses not to send it.
- **Forbidding every earlier-prose edit.** Rejected: small changes can be necessary for a coherent continuation. Disclosure of the changed passages and reasons is the useful guardrail; silently rewriting the chapter is not.
- **Server-side editor positions or cross-device synchronization.** Not needed for this iteration and incompatible with the existing device-local draft promise. No host Remote, manuscript format or agent-tool schema changes are required.

## Consequences

- Clicking the continuation entry saves the current manuscript even when the person never sends the prepared request. This is intentional: “the current draft” must be the version the subsequent agent read can see.
- Returning to the contents is the explicit opt-out of automatic chapter/mode restoration. Per-chapter caret positions remain available when that chapter is edited again.
- Position memory is scoped to one browser on one device. It is a convenience, never manuscript truth; the saved workspace file and existing local draft remain authoritative.
- The continuation entry is disabled for an empty manuscript. A chapter that has not been started still uses the existing planning or conversation flow.

## Validation

- Component tests cover save-before-fill ordering, no automatic send, the exact chapter read and saved ending in the request, permission for explained earlier edits, stale-save preservation, chapter/mode/draft/caret/scroll restoration without focus, explicit navigation priority and contents clearing.
- Pure storage tests cover round trips, canvas/chapter isolation, offset clamping, malformed JSON, invalid ranges, storage denial and ending extraction. Existing draft preview/cancel/save behavior remains covered.
- `@khorsheed/dsh-canvas-novel`: 41 test files and 317 tests pass.
