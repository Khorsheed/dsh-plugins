# Agent Note: message-timeline narrow layouts degrade to a tick strip instead of hiding

Status: implemented

English | [中文](2026-10-23-message-timeline-narrow-layout-tick-strip.zh.md)

## Problem

[The width-cap note](2026-08-17-message-timeline-gutter-width-cap.md) hid the whole panel whenever the left gutter could not hold the 120px minimum width. With a right sidebar open — the common state of a Room session (member/team panel) or any narrow window — the chat scrollport shrinks until the gutter is a few pixels, and the timeline vanished entirely. The user read it as "the timeline is gone in Room", not as a deliberate hide.

## Decision

A gutter below `PANEL_WIDTH_MIN` no longer hides the panel. It degrades to a narrow mode: a 24px tick strip resting inside the message flow's left padding (only ticks at rest, so no message text is covered), and on hover or keyboard focus the panel expands to `min(panelWidth, 60% of the scrollport)` with a solid background (`--dsw-alias-bg-layer-1`), rounded corners, and a shadow, so the preview text reads over the flow. The width cap by the gutter is unchanged on wide layouts, and the flow-probe failure fallback (a fraction of the scrollport) is unchanged. `tooNarrow` is gone from the hide condition; the panel renders as `css.panelNarrow` with the expanded width passed as the `--panel-wide` custom property (the hover rule needs `!important` to beat the inline rest width).

## Alternatives considered

**Keep hiding on narrow layouts.** Rejected: hiding was the original way to honor "never cover the message flow", but it makes the timeline unavailable in a very common layout; the narrow mode keeps it usable without covering anything at rest.

**Always overlay the flow, no rest-state distinction.** Rejected: the ambient rest state is the point of the rail; a permanent overlay would cover the start of messages, which the width-cap decision specifically avoids.

**Only shrink the minimum width.** Rejected: a 2px gutter still fits nothing; the problem is placement, not the threshold.

## Consequences

The timeline now survives right-sidebar and narrow-window layouts: at rest it is a tick strip in the flow's left padding, and only the deliberate hover/focus overlay covers content (with a background). The width-cap note's "hide below the minimum" clause is superseded; its cap-to-gutter rule stands. Coverage: the width-policy spec now asserts the narrow-mode class, the 24px rest width, and `--panel-wide` instead of the old hide; the hover expansion is CSS-only and is not unit-asserted. Verified live on a debug instance: with the right sidebar open the panel no longer disappears, and hovering expands it to 360px with a solid background.
