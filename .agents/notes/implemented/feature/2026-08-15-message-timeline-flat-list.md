# Agent Note: Flat always-on timeline list without the dot rail

Status: implemented

English | [中文](2026-08-15-message-timeline-flat-list.zh.md)

## Problem

The full-height panel from [the full-height panel note](2026-08-15-message-timeline-full-height-panel.md) still missed the intended experience in three ways: hovering showed the dot rail's horizontal dashes and the panel's vertical ticks at the same time — two competing marker systems; the panel kept card chrome (border, background, shadow, a visible scrollbar), so it read as a boxed list that needs its own scrolling; and it anchored to the top instead of centering vertically when short.

## Decision

The dot rail is removed; the timeline is a single flat list toggled by the header chip (no hover-open — with no rail there is nothing to hover). At rest only the row ticks show, dimmed (deepseek-400 at opacity 0.55) as ambient markers — row text stays invisible so the page does not read as cluttered — and only the tick strip (each row's first 20px) is pointer-sensitive while the panel itself takes no pointer events, so crossing the list toward the session sidebar never lights it; a 90ms delay on the text fade absorbs the briefest crossings. The current reading position's tick stays blue (row opacity 0.75) and defaults to the latest message until the tracker answers; hovering the strip or keyboard-focusing the panel widens the rows and reveals every row's text at full opacity with the blue row still on top, and the hovered or arrow-key row stays the bold preselection. The panel is frameless — no border, background, shadow, or visible scrollbar — and vertically centers through auto-margin spacers before and after the rows (they collapse on overflow, so a long list top-anchors and scrolls invisibly); the centering box insets the conversation tab strip's height at the top, since centering reads against the whole window. Pagination survives intact and bootstraps: while on a chat view the panel pulls history pages until the first user message materializes (a huge assistant turn can push every user message past the loaded event window, leaving zero rows and no way to start paging) and up to initialPages pages total, plus the scroll-to-top `loadOlder` trigger. Config loses `dotPitch` with the rail; `TimelineDot` (its `time` was only used for dot tooltips) becomes `TimelineItem` (`{ key, node }`); `rail.dotAria` and `formatTime` go with the dots. The highlight derivation (`focusKey`, then the tracker's `activeKey`, then the latest message) is unchanged in shape — "selected" remains the reading position, which a jump sets — and the tracker's `activeKey` anchors to the nearest user row above the viewport when no user row is visible, so reading inside a long assistant answer keeps the lit tick on the question being answered instead of falling back to the session's latest message.

## Alternatives considered

**Keep the dot rail as the collapsed overview.** Rejected: the dots (horizontal dashes) and the row ticks (vertical bars) are two competing marker systems; the flat list alone carries both navigation and position.

**Hover-open over a hot zone instead of the toggle.** Rejected: with no rail there is nothing to hover, and an invisible hot zone is undiscoverable; the existing header chip already owns expand/collapse.

**Rows bloom text next to fixed dots.** Rejected, as analyzed in the previous note: the 10px dot pitch is too dense for text rows, so the position metaphor breaks once rows need ~26px.

**Opaque card background for readability.** Rejected for now: the flat list overlays transcript text by design, and the rest-dimmed state keeps the overlap ambient. A subtle platform background can return without structural change if readability reports come in.

## Consequences

One marker system, no box, no visible scrollbar; the timeline reads as part of the page. The rest state intercepts pointer events only on the tick strip, so the list never blocks the transcript beneath it. `dotPitch` joins the previously dropped preview keys as an unknown config field (pre-release stance: no compatibility shim). This note supersedes the interaction half of [the full-height panel note](2026-08-15-message-timeline-full-height-panel.md) — its "replace the dot rail" alternative won; the pagination and highlight-derivation decisions there still stand. Coverage: the component spec drives rows, highlight, keyboard, and paging; the CSS-only brightening layers are not unit-asserted (jsdom computes no hover styles).
