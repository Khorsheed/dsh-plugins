# Agent Note: reference chips in the room composer

Status: implemented

## Problem

The room composer takes over the official input bar with a plain textarea, while the draft stays in the session's official input machine. A quote chip landed in the machine fine, but the textarea showed the machine's clipboard projection: the whole `> …` block and its `—— 引用` line as raw text, which any edit then flattened. A second defect sat in quote itself: the chip ended at its attribution line, and the editor's caret lands right after the chip, so a question typed there (in any composer) extended the attribution line, fell into the blockquote, and the sent card no longer matched.

## Decision

- **Chips get their own row; the textarea holds only the typed text.** The composer reads the machine's `occurrences` and shows each chip above the textarea (label, click to preview, ✕ to remove). The textarea value is the draft with every chip's clipboard text removed (`draft-chips.ts`).
- **Edits map back as detect-span replacements.** A textarea change is reduced to its common prefix/suffix and applied through `inputActions.insertText` in detect coordinates (each chip folds to one character), against the then-current `captureInsertion().draftRev`. A caret on a chip boundary types before the chip; a range swept across a chip deletes the text on both sides, never the chip; ✕ deletes the chip's one placeholder. Mentions write through the same path. Sending is unchanged: the dispatched text is the clipboard projection, quote text included.
- **Preview** goes through the session's input-trigger controller (`inputTriggers.sessionOf(scope).openReference`), the same route as the official editor's chip click. It is probed at click time and declines without the service.
- **Fallback**: a host without `occurrences` or `insertText` keeps the previous plain form.
- **quote closes its block with a newline**, on both the chip and the plain-text fallback, so text typed next opens its own line. The chip preview drops it when parsing.

## Alternatives considered

- **Inline chips inside a contenteditable.** Rejected: it would re-implement the official editor that the takeover hides. The row reads clearly at both desktop and phone widths.
- **`setDraft` with references.** Rejected: the public `setDraft` signature takes text only. The draft-with-references form is an implementation detail of the facade, not a contract.

## Consequences

- Chips typed mid-sentence in the main composer show in the room as part of the row; their position in the sent text is kept, because edits never move them.
