# Agent Note: The room composer takes images and files

Status: implemented

English | [中文](2026-10-27-room-composer-attachments.zh.md)

## Problem

The room takes over the official composer and carries text only, from the composer through `postMessage` to every member. A room could not receive a screenshot or a file, though the official composer it replaces can.

## Decision

- **Drafts are the official ones.** The composer re-uses the official conversation service's draft attachments: `createDrafts` (files start uploading to the room session on pick), `fileUploads`, `resolveDraftAttachments`, `serializeDraftAttachments` and `releaseDraftAttachment`. The draft ids live on the session's input machine (`addAttachments` / `removeAttachment` / `pruneAttachments`), beside the draft text, so they survive navigation the same way. A host without these offers no attachments.
- **Entry points.** A paperclip button leads the composer's tool row, and files can also be pasted into the textarea or dropped on the card.
- **The rail is redrawn.** It uses the official geometry and tokens: 64px thumbnails with the primitives' `ImageLightbox`, and 240×64 file cards showing upload state, retry and a hover ✕. `@deepseek-ai/dsh-client-ui-attachment` exposes no client component a plugin bundle can import: its rail renders only inside the official bar's own child slot.
- **The host admits attachments like its prompt path.** `postMessage` takes `attachments` in the official wire form: an image's base64, or a file's upload receipt. Receipts resolve through `fileUploads.resolve` against the room session's agent, and a cold room is woken first. `attachments.admitPromptContent` stores the images, the human `user/message` carries the durable blocks (rendered by the official user node), and the receipts are bound to the message.
- **Members get local paths.** Every addressed member's dispatch text gains a list of local paths (`imageHostPath` / `fileHostPath`), opened with the member's own read tool. One form reaches CLI and native members alike. The dispatch records the paths, so a retry re-sends them.

## Alternatives considered

**Native image input per CLI** (claude stream-json images, codex `-i`). Deferred: there are four wire formats to keep in step, while a path works for every member today.

**Import ui-attachment's rail.** Not possible: the bundle gate keeps official client packages external, and that package's client entry exports only `apply`.

## Consequences

- An attachment-only message dispatches as 「（见附件）」.
- A host whose attachment store is not file-backed gives no path, and the member is told it cannot open the attachment.
- Desktop file drops upload the file rather than becoming the official composer's path chips.
