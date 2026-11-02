# Agent Note: Context Lens — map clicks land reliably and the scrollbar stays draggable

Status: implemented

## Problem

A 94-round room session exposed two navigation failures and one presentation failure in the session map. Clicking another request bar in the already-selected round opened that request but did not re-sync the conversation, because turn selection returned early when the round number was unchanged. Clicking an older room round could also leave the conversation in place: the host resolves `loadThrough` without paging while its initial load or a plain `loadOlder` owns the busy flag, but the panel made only one request and waited only 60 frames. Finally, the map used the macOS overlay scrollbar, so the horizontal drag target faded away after scrolling even while more rounds remained off screen.

## Decision

- Every map click synchronizes the conversation, including a request in the current round; the existing early return still avoids resetting the panel's turn state.
- Host turns, room-message anchors and tool calls share `pageForAnchor`: wait for the conversation's first rows, then allow three page requests with a 90-frame anchor wait after each. A newer jump still supersedes an older one. A host turn keeps the at-or-after fallback, while a missing room message stays put.
- The map hides the native overlay scrollbar and, only while its content overflows, renders a native range input synchronized both ways with the map's `scrollLeft`. Its thumb reflects the visible fraction; dragging and keyboard keys work without custom pointer-event handling.

## Alternatives considered

**Make only the same-round click change.** That fixes the deterministic case but leaves older room rounds dependent on whether the host happened to be idle.

**Wait indefinitely for one page request.** The host's no-op result is part of its current contract, not a pending operation; retrying after the anchor wait is required. An unbounded wait would strand a jump when the row cannot mount.

**Style the native overlay scrollbar.** Wheel and trackpad scrolling would still work, but browser preview showed that WebKit thumb rules and a stable gutter did not keep a drag target visible under macOS overlay scrolling. A hand-rolled pointer-drag track was rejected because a native range already supplies dragging, focus and keyboard behavior.

## Consequences

A map click now has the same conversation-sync behavior whether or not it changes the panel's round. History jumps tolerate a busy host without weakening cancellation or fallback semantics. The range occupies 16px only while the map overflows; a map that fits leaves no empty scrollbar gutter.

The Context Lens suite covers a same-round bar click, a first page request that resolves without mounting the room message then succeeds on retry, and two-way range/map synchronization. Browser preview confirms that the control remains visible after waiting, `End` reaches the exact maximum scroll offset, and pointer dragging updates both the range and `scrollLeft`.
