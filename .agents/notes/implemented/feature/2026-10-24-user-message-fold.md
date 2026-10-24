# Agent Note: Long user messages fold in every session

Status: implemented

English | [中文](2026-10-24-user-message-fold.zh.md)

## Problem

A long requirement pasted into a conversation stays at full height in the transcript forever, so scrolling back past it is tedious. The room had just gained this folding for member speeches ([2026-10-24-speech-fold-policy](2026-10-24-speech-fold-policy.md)), and the owner asked for the same behavior on the human's own messages in every session.

## Decision

message-tools already shadows the user-message bubble (`UserMessageView`, keys `user` / `steering` and its own edited / restored rows), so the fold lives there rather than in the host or the room.

- A message past 600 characters or 12 lines folds to about ten bubble lines. The clamp tracks the content font-size axis, and a fade in the bubble's own fill sits on the tail. 展开全部 / 收起 sits under the bubble, and the fade also expands.
- The session's newest user message stays unfolded, so what the human just sent stays readable while it is answered; it folds once the next one arrives. The newest message is read from the chat slice with `selectNewestUserSeq`.
- The human's own choice wins and is remembered per message seq in browser storage (`dsh-message-tools:fold:<sessionId>`, newest 200). Unreadable storage only means the default applies.

## Alternatives considered

**Shadow the host's `conversation.user.text.node` `text` renderer.** Rejected: it sees one inline text run, not the bubble, and the same renderer also draws queue previews and composer chips.

**Room only.** Rejected by the owner: long messages are a problem in every session.

## Consequences

- Only bubbles that message-tools renders fold. A composition without message-tools shows the host's bubble unchanged.
- Tests in `user-message-view.client.spec.tsx` cover the newest / older / short defaults, the remembered choice, and the fade click.
