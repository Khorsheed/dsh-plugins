# Agent Note: Message timeline drops the header toggle and follows the reading position

Status: implemented

English | [中文](2026-08-16-message-timeline-toggleless-follow.zh.md)

## Problem

Two follow-ups surfaced after [the flat-list note](2026-08-15-message-timeline-flat-list.md) shipped. The header toggle chip — carried over from the dot-rail era — was the most visible element of a feature whose design goal is to disappear, and its collapse action was nearly useless once the rest state became ambient ticks. And the panel positioned itself only once at open: a newly sent message's row could sit outside the scroll window with no signal.

## Decision

The header toggle and its per-session `open` store are removed; the panel is always on while the chat view shows, and the `enabled` config remains the off switch. The panel scrolls the lit row into view whenever the current row changes (`scrollIntoView({ block: 'nearest' })`): it follows the reading position — a sent message keeps its row visible — without yanking mouse browsing, because the hovered row is the current row and always sits under the pointer; keyboard preselection keeps its own row in view.

## Alternatives considered

**Keep the toggle for temporary hiding.** Rejected: the rest state is already near-invisible, and a permanent header icon costs more attention than the bar it hides.

**Follow only on tracker changes, never on preselection.** Rejected as unneeded complexity: scrolling an already-visible row with `block: 'nearest'` is a no-op, so one unconditional rule covers open, follow, and keyboard navigation.

**Click the lit row to jump back to the bottom.** Rejected by the product owner: the official chat view owns a scroll-to-bottom button, and two click semantics on one row would be ambiguous.

## Consequences

The header-utilities entry renders nothing visible — it anchors the plugin into the session scope while the UI lives in the portal. `createTimelineStore`/`TimelineStoreState`/`TimelineStore` leave the public exports, and the `rail.toggle`/`rail.toggleAria` locale keys collapse into `rail.panel`. Turning the timeline off is a cordis.yml edit (`enabled: false`), not a click. The toggle-era sentences in [the flat-list note](2026-08-15-message-timeline-flat-list.md) point here.
