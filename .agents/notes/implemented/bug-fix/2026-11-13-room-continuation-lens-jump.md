# Agent Note: Restart continuations have a real row for Context Lens to locate

Status: implemented

[English](2026-11-13-room-continuation-lens-jump.md) | [中文](2026-11-13-room-continuation-lens-jump.zh.md)

## Problem

In room 6a56367b, selecting round 140 of 143 in Context Lens did not move the conversation. That round is the manual restart continuation recorded by `room/dispatch` at seq 1777, not host turn 140. The dispatch has `continues` and a `task`, but no `messageId`. Its `task` names the older user message that began the task, not the new continuation. Room's direct-dispatch continuation path produced no visible row for the event, so the lens had no anchor. An earlier automatic continuation at seq 1432 has the same text; matching prose would select the wrong round.

Selecting the already-selected round in the turn menu also returned before synchronizing the conversation, although clicking a request bar in that round already synchronized it.

## Decision

- Room's established `room-auto-continue` conversation node covers both automatic continuations and manual continuations recorded directly without a `user/message`. The latter carries `manual: true` and reads 「房间 · 手动」 / 「Room · manual」. Ordinary human messages keep their official user bubble. Existing journals are not rewritten.
- Context Lens retains the dispatch's `via` and `continues` facts. An automatic dispatch, or a continuation without a separate human message, exposes `room.continuationSeq`; its `startSeq` is that same dispatch seq. The locator pages to the seq and matches the exact `room-auto-continue` kind and engine-owned key `<kind length>:<kind><seq>`, using the existing landing and retry behavior.
- Selecting a round in the menu always synchronizes the conversation. The panel resets its turn and request state only when the selected round actually changes.
- The DOM workaround remains within [S20](../../../../docs/upstream-seam-registry.md). The two packages must ship together: Lens cannot locate a manual row that Room does not render, and Room's new row alone does not add Lens navigation.

## Alternatives considered

**Use `task` as the message id.** That would jump to the original task, not this continuation. It would also confuse task identity with the dispatch's own message identity.

**Find the continuation by its text.** Several distinct dispatches in the reported session have the same restart message. The recorded dispatch seq is the unique anchor.

**Use the numeric panel round as `data-chat-turn`.** Room round 140 is an ordinal shared with host turns, not host turn 140. Its panel address is `-1001777`; treating either number as a host turn would select an unrelated row or nothing.

**Append a synthetic user message or rewrite the old journal.** A visible projection of the actual dispatch is sufficient. Adding a new model-visible event or changing history is unnecessary and would alter the record.

## Consequences

Automatic continuations retain their existing node and label. Manual continuations that previously had no visible row now appear as room actions, accurately distinguished from automatic ones. Future and historical journals use the same projection. Missing nodes still degrade to no scroll; no host API is added and no persistence migration is needed.

## Testing

With the real host configured, Context Lens passes 41 files with 384 tests; Room passes 62 files with 737 tests. The added cases cover both continuation forms, the exact node and label, menu reselection without resetting the request, and paging to the node.

A replay of the actual session reconstructs ordinal 140 at dispatch seq 1777. Room's real Definition and the host's `conversationContextKey` produce `18:room-auto-continue1777`; the locator returns true on that exact node.

The real Web composition also passes a Chromium case with a registered Session whose manual continuation is ordinal 140. It verifies the 「Room · manual」 row, first selection, and reselection after manually scrolling away. It accepts the documented bottom-clamped landing when the target is visible, and observes no browser page errors. This is isolated browser acceptance, not a claim that the production session has already been clicked.

## Related

- [Restart recovery consolidation](../feature/2026-11-09-restart-recovery-consolidation.md) owns the continuation's lifecycle and persistence semantics.
- [Map clicks land reliably](2026-11-02-context-lens-map-jump-and-scrollbar.md) owns the shared paging and landing behavior.
