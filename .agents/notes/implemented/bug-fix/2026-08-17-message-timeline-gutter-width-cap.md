# Agent Note: message-timeline panel width caps to the left gutter and hides when the gutter cannot hold 120px

Status: implemented

English | [中文](2026-08-17-message-timeline-gutter-width-cap.zh.md)

## Problem

The floating timeline panel rendered at the configured fixed width (`panelWidth`, default 360px, clamped 120–640) regardless of the conversation layout. The official chat column is centered and capped at `--dsh-chat-content-width: 748px` (`ConversationRoot.module.css`), so the scrollport's left gutter is 32px of scroll padding plus the centering remainder — roughly 220px on a typical wide column. A 360px panel anchored 6px inside the scrollport's left edge therefore extended across the gutter into the message flow, overlaying the start of every message (~150px of text on an 1180px column). Because the column width is fixed, the overlap existed at every window width, not just narrow ones; a viewport-relative ratio cap would not have fixed it (40% of a 1200px scrollport still exceeds 360px).

## Decision

The panel width adapts to the measured left gutter, and the panel hides when the gutter is too small for a usable width:

- The rail tracker now publishes the scrollport width and the message flow's left edge (`flowLeftX`: the first `[data-chat-flow-kind]` row's rect.left, which sits flush in the centered column) alongside the existing geometry (`rail-tracker.ts`, `TimelineRailState`).
- The component caps the width at `min(panelWidth, flowLeft - rail.left - 24px)` — a 16px visible breathing gap plus the panel's 8px right padding (`PANEL_PADDING_X`) — so the timeline text never crosses the message flow.
- When the gutter cannot hold the minimum usable width (`PANEL_WIDTH_MIN`, 120px, exported from `config.ts`), the panel hides entirely instead of rendering a sliver that only intercepts the transcript.
- When the flow probe is unanswered (official structure change), the width degrades to `min(panelWidth, max(120, scrollportWidth × 0.4))` — never throws, never covers more than the fallback.

## Verification

Unit tests pin the policy: the width caps to the gutter, keeps the configured width when the gutter is wider, renders at the 120px floor when the gutter exactly fits it, hides below it, and degrades to the scrollport fraction when `flowLeft` is null (`tests/TimelineRail.client.spec.tsx`). The tracker tests cover the new state fields and the `flowLeftX` probe (`tests/rail-tracker.client.spec.ts`). `pnpm build` + `pnpm test` for the package pass (81 tests).

## Alternatives considered

**Cap by a fraction of the scrollport width.** The column is fixed-width and centered, so the scrollport barely shrinks with the window; the cap would rarely engage and would not fix the overlap on wide windows.

**Hide below a viewport-width threshold.** Window width does not map to the conversation column (sidebars absorb resizes); the measured gutter is the actual constraint.

**Reserve a gutter in the official layout via a slot or CSS variable.** Requires host changes; this repo's discipline is the upstream-change pipeline, not local forks.

## Consequences

On typical wide windows the panel now shows about 200px of preview text in the left margin instead of 360px over the messages; the config `panelWidth` became a preferred maximum. Very narrow columns lose the timeline entirely (no ticks), trading away the ambient affordance on those windows for never covering the transcript.
