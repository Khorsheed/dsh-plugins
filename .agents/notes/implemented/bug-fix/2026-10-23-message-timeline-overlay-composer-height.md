# Agent Note: message-timeline skips a hidden input card when measuring its height

Status: implemented

English | [中文](2026-10-23-message-timeline-overlay-composer-height.zh.md)

## Problem

In a Room session the timeline still did not show after [the narrow-layout tick strip](2026-10-23-message-timeline-narrow-layout-tick-strip.md): at most a few pixels of the blue tick appeared in the top-left corner, and the full rail flashed for a moment when the session opened. The cause is the panel height, not the width. The Room composer takes over the `conversation.composer` chain with `overlay: true`. The host keeps the official input bar mounted under a `display: none` fallback wrapper (`ui-renderer` `scoped-slots.tsx`, `data-chain-overlay-fallback`), so its `[data-composer-card]` is still the first card marker in the scrollport, and it measures as a zero rect at y=0. `measureGeometry` ended the box 8px above that card, and the height clamped to 0. The panel shrank to its 8px padding, and `scrollIntoView` on the current row left a sliver of the blue tick showing. The flash was the frame before the room composer was elected, while the fallback bar was still laid out.

## Decision

`measureGeometry` now takes the first laid-out `[data-composer-card]`, skipping zero-size rects (the same guard `flowLeftX` already applies to flow rows). With no laid-out card, it uses the existing fallback to the composer seat top, then the column bottom. For Room that means the box ends at the seat top, above the background-agent dock. That is acceptable, because the Room composer has no card marker that separates the dock from the input.

## Alternatives considered

**Ask the room composer to carry `data-composer-card`.** Rejected as the sole fix: any overlay composer would hit the same trap, and the hidden official card would still come first in DOM order.

**Scope the query to the elected overlay.** Rejected: `data-chain-overlay-fallback` is host render output, not a declared API. The zero-rect check does not depend on how the host hides the fallback.

## Consequences

The rail renders at full height in Room and in any other overlay-composer session. Coverage: a `measureGeometry` spec places a zero-rect card inside the seat and asserts that the seat-top height is used.
