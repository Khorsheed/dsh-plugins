# Agent Note: quote blocks refilled into a draft turn back into chips

Status: implemented

## Problem

A sent quote travels as its plain `> ` block, because the codec serializes the chip to exactly that text. Anything that writes a sent message back into the composer lands the raw block instead of a chip: message-tools' withdraw refill, an edit, a paste of a copied message.

## Decision

- **quote watches the main-view session's draft** (`restore.ts`). When one change inserts a complete quote block, recognized by the same matcher as the transcript card in all three attribution forms, the block becomes the chip that 引用到当前会话 inserts. The closing newline rides inside the chip. A located or plain block is labeled by its source; a bare one by its body excerpt.
- **Typing never triggers it.** The block must lie wholly inside the span that the change inserted (common prefix/suffix), and a keystroke inserts one character at a time. Blocks already in the draft, or inside an existing chip, are left alone.
- **Same seam, same guard.** The restore uses the `slash/input-insert-reference` insert in detect coordinates, last block first. It runs only while the codec is mounted, outside the store notification (a microtask), and ignores the notification its own insert raises.

## Alternatives considered

- **message-tools restores chips on refill.** Rejected: it would have to know quote's chip source and ref format, which is an inter-plugin edge. Detection in quote covers every refill path and pastes too.
- **Restoring through `setDraft` with references.** Rejected: the public `setDraft` takes text only.

## Consequences

- Pasting a copied quote block also yields a chip, which reads the same as a fresh quote.
