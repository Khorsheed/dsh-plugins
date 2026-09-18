# Agent Note: the withdrawal divider dropped the images it had just hidden

Status: implemented

## Problem

Two reports about withdrawing a message that contained an image, and both came from the same fold.

**The image was gone from the replay.** Expanding 「已撤回 N 条消息」 showed the withdrawn user text and the assistant text, but never the image that had been withdrawn with them. `collectWithdrawnEntries` (the node-store fold behind the expand area) joined only `type: 'text'` blocks and pushed an entry only when that joined text was non-empty, so a `type: 'image'` block was invisible to it.

**An image-only message read as an empty span.** With no text and no recognized content, an image-only message produced *zero* entries. The divider's title is `countHiddenInSpan`, which is defined as `collectWithdrawnEntries(...).length`, so withdrawing an image-only message rendered 「已撤回 0 条消息」 — and expanding it showed 「撤回的内容不在当前已加载的历史中」, the copy reserved for a span whose rows fell out of the loaded window. Both statements were false: the message was loaded, on screen one second earlier, and then hidden.

The asymmetry is what made this a fold bug rather than a missing capability: the shadowed user renderer already rendered a withdrawn message's images on the live surface, and the restore path already replayed them (an edit or restore replacement carries `content` verbatim, so `type: 'image'` blocks travel with it). Only the divider's read-only replay — the one place a withdrawn message is shown *after* it left the surface — lost them.

## Decision

**The replay carries what the withdrawal hid.** `WithdrawnEntry` gains `images`, holding the durable arm of the attachment gallery's `MessageImageSource`. `collectWithdrawnEntries` folds `type: 'image'` blocks with an attachment out of user, steering, edited, and restored nodes, and keeps an entry when it has text **or** images.

**The count follows the replay.** `countHiddenInSpan` stays `collectWithdrawnEntries(...).length`; fixing the fold fixes the number, so an image-only message counts as one message and the empty copy is once again reserved for a genuinely unloaded span. Deliberately not a second, independent node count: two folds would drift, and the honest definition of the number is "how many messages the replay shows".

**Images render through the host's own gallery slot.** The divider renderer takes the `renderMessageImages` owner prop that every `conversation.chat.node` renderer already receives and calls it with `{ images, align: 'end' }`, so the replay's images are the same component (sizing, preview, viewer) as the transcript's. The prop is widened to `| undefined` before use so a composition without the attachment UI replays text only instead of throwing while expanding a span.

**Assistant entries carry no images.** The replay vocabulary stays "user originals plus assistant text": assistant image blocks are not folded, and `WithdrawnEntry.images` is always empty on an assistant entry.

## Alternatives considered

**Render each image with an `<img>` bound directly to `loadImage`.** Rejected: it duplicates the official gallery — object-URL lifecycle, sizing, the click-to-open viewer — and would drift from the message bubble's presentation the moment upstream changes the slot. Every chat node already receives the slot-backed closure, so the plugin needs no loader of its own.

**Give `countHiddenInSpan` its own node-counting fold.** Rejected: the count and the replay would then be two definitions of "a hidden message" that can disagree, which is exactly the state that produced 「已撤回 0 条消息」. The bug was the replay's filter, not the count's derivation.

**Keep skipping image-only entries and only count their nodes.** Rejected: it repairs the number while leaving the reported symptom (nothing to see when expanding).

**Fold assistant image blocks into the replay as well.** Rejected for this change: assistant entries are text summaries by design (`withdrawn.entryAssistant`), no report covered them, and widening the vocabulary would need its own decision about where an assistant image sits relative to its text.

**Backfill the withdrawn images into the composer in the same change.** Rejected here — it is a different surface and a different contract. The host has no public "set draft text + images" API: `SessionInput.setDraft` is text-only, attachments are a separate id plane, and the only code that mints a draft attachment from a `File` is `ConversationController.createDrafts`, which is not on the declared `IConversation` face that `ctx.conversation` exposes. Image backfill therefore means fetching the bytes back through the session-authorized image URL and re-registering them as a fresh upload, through a method outside the declared interface. That trade-off is recorded in both READMEs' known limitations, and the upstream question (expose the mint, or an atomic draft write) is separate from this fix.

## Consequences

- Withdrawing an image-bearing message now shows those images in the divider's expand area, and the title counts an image-only message as one message.
- The images are the host's gallery component, so they look and behave like transcript images; a composition without the attachment presentation slot degrades to the previous text-only replay rather than failing.
- The count is no longer "entries that have text": an image-only message contributes one entry with empty text, which the renderer skips (no empty text row).
- Restored rows re-withdrawn into a later span replay their images too, because the fold reads the restore event's replayed `content`.
- Not carried anywhere: images into the composer draft. Edit resend and withdrawal backfill remain text-only (README known limitations).
- The 「撤回的内容不在当前已加载的历史中」 copy means what it says again: only a span with no materialized nodes.

## Testing

`packages/message-tools` runs 186 tests (5 new or updated):

- `tests/withdrawn-node.client.spec.ts`: every entry carries `images`; a mixed text-and-image message keeps both; an image-only message yields one entry and `countHiddenInSpan` returns 1 where it returned 0 before; a re-withdrawn restore row replays the images from its replayed content; reasoning-only assistant steps still count and carry no images.
- `tests/divider-restored.client.spec.tsx`: expanding calls `renderMessageImages` with `{ images, align: 'end' }` and renders the gallery's image; an image-only span shows 「已撤回 1 条消息」 with no empty copy; a composition whose gallery prop is absent still replays the text.

README.md and README.en.md document the replay's image content and the text-only backfill limitation.
