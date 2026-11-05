# Agent Note: chat quote attribution and draft deletion

Status: implemented

## Problem

A quote taken from an assistant reply showed an excerpt of its own body instead of naming the chat, making the composer chip and preview harder to recognize. The preview's close button only dismissed the card: the draft chip itself could be removed with Backspace, but no visible action removed it.

## Decision

- **Source labels fall back to the current chat.** The priority is the content's declared `data-quote-source`, then the current session's `displayTitle`, then the body excerpt. The first two produce a named attribution on the model-facing wire block; the excerpt fallback keeps the bare attribution. The side-chat ref uses the same resolved label. Explicit file/article labels and their `data-quote-ref` locators still win.
- **Deletion is separate from dismissal.** The chip preview keeps ×, Escape, and outside click as close-only gestures. Its explicit 删除引用 / Delete quote action carries the `openReference` session id and ref, and deletes only that draft chip. Sent quote cards are unchanged; the plain-text fallback remains directly editable.
- **Deletion preserves the rest of the draft.** The implementation finds one unique quote occurrence, converts its clipboard offset to the one-character detect span, and sends empty text through `slash/input-insert-text` with the current `draftRev`. It re-reads and retries once after a CAS refusal, then closes the preview and refocuses the composer only on success. It never replaces the whole draft or flattens other chips.
- **Ambiguous duplicates refuse.** The host's `openReference` payload has no occurrenceId. If the same quote ref occurs more than once, the action returns false and leaves the preview and draft unchanged; Backspace remains the manual path.

## Alternatives considered

- **Always naming the current chat.** Rejected: a file or article's own title is more specific and must remain authoritative.
- **Making × delete the chip.** Rejected: users expect × on a preview to dismiss it; deletion needs a distinct, visible action.
- **Removing the quote through `setDraft`.** Rejected: the public text-only write flattens every other reference chip in the composer.
- **Deleting the first matching duplicate.** Rejected: identical refs can occupy different draft positions, and the host gesture cannot identify which one was clicked.

## Consequences

- This supersedes the sourceless no-attribution part of [the quote locator decision](./2026-10-24-quote-locator.md) when a current session title exists. Its explicit source and locator rules remain in force.
- Duplicate-ref preview deletion is deliberately unavailable until the host activation payload carries occurrence identity; no upstream change or minimum-host bump is introduced for the ordinary unique-ref path.
