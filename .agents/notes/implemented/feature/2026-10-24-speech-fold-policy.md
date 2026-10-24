# Agent Note: A room speech folds by who it is for and how recent it is

Status: implemented

English | [中文](2026-10-24-speech-fold-policy.zh.md)

## Problem

Every room speech over 600 characters started folded ([2026-08-30-speech-readability-and-roster-on-change](2026-08-30-speech-readability-and-roster-on-change.md)). The owner found that tiring: the reply they had just asked for was folded too, so they clicked 展开全部 on nearly every answer, and the click was lost on reload. Showing everything unfolded instead makes the room very long.

## Decision

The fold default depends on the speech. The newest speech addressed to the room (no `reportedTo`) starts unfolded, because it is the one the human is reading. It folds back once a newer reply lands. Reports to another member and older replies start folded.

Room's replay adds `latestReplySeq` to `RoomState`. The view treats a speech whose seq is at or past that value as the newest, because the client's state refresh is debounced and a just-arrived reply must not render folded first.

The human's own expand or collapse overrides the default. It is remembered per speech seq in browser storage (`dsh-room:speech-fold:<sessionId>`, the newest 200 choices kept), so a reload or a session switch keeps it. Storage is a per-viewer convenience: when it is unreadable, the default applies.

Clicking the fade unfolds the speech too, not only the 展开全部 link.

## Alternatives considered

**Unfold every reply addressed to the human.** Rejected: in a long room every answer stays open and the history grows as long as before.

**A headings outline in the folded state.** Deferred: the owner agreed to try the cheaper policy first.

## Consequences

- The previous newest reply folds when a new reply arrives, so the transcript above the new reply shrinks.
- Tests cover the default per speech (newest, newer than the cached state, older, report), the remembered choice, and the fade click.
