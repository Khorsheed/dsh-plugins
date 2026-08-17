# Agent Note: message-timeline centering box counts the composer band

Status: implemented

English | [中文](2026-08-17-message-timeline-centering-counts-composer.zh.md)

## Problem

The floating timeline panel's vertical centering box ended at the top of the sticky composer seat: `measureGeometry` subtracted the measured `[data-composer-seat]` height from the panel box. The chat transcript is bottom-anchored — the newest messages render just above the input box — while a short centered list floated in the middle of the window. Measured on the live GUI (1440×900, a 126px composer, 3 user rows): the rows sat at 398–487px and the blue reading-position tick (the latest message) at ~457px, roughly 270px above the actual latest message at the bottom of the transcript. The timeline read as hovering above the conversation. A separate double-deduction (the tab strip is physically above the scrollport, so deducting it only shifts the box) was analyzed and left alone — its effect is small (~17px) and it is not the perceived defect.

## Decision

The composer seat is no longer subtracted from the panel box: the centering box now spans the full column below the header — the chat area plus the input band — so a short list centers over chat + input instead of floating above the conversation (`measureGeometry` in `rail-tracker.ts`). The box stays transparent and pointer-transparent at rest (`.panel` has no background and `pointer-events: none`), so covering the input band changes nothing visually until rows light up, and a short centered list stays inside the chat area anyway (the 3 rows move from 398–487 to ~456–546 on the measured window). Long overflowing lists gain the extra band as scrollable room; the box never extends past the column bottom minus the 8px padding. The composer ResizeObserver observation is retained — a composer resize republishes identical geometry, which the `same()` gate skips.

## Verification

The `measureGeometry` test is updated: a composer seat inside the scrollport no longer shortens the box (height 284 instead of 244 on the fixture, `tests/rail-tracker.client.spec.ts`). All 81 package tests pass; `pnpm build` green.

## Alternatives considered

**Bottom-anchor the list** (latest tick flush with the input box top, aligned with the newest message). The most faithful fix for "the tick floats above the message", but it changes short lists from centered to flush-bottom — a bigger design shift the user did not choose.

**Remove the tab-strip double deduction** (the tabs render above the scrollport, so deducting them shifts the box down ~17px). Directionally makes the list sit higher — the opposite of the reported "feels high".

**Keep the overlay over the chat area and only bias the centering.** Flex auto-margins cannot center against a virtual taller box without a spacer that counts as content and moves the rows the wrong way; a transparent overlay makes extending the box harmless.

## Consequences

Short lists sit lower, closer to the conversation, at the cost of the panel box covering the input band (invisible at rest; only a long list's bottom rows paint over the input card's left padding when hovered). The centering box no longer shrinks when the composer grows (e.g., a taller textarea), so the list's vertical position is stable across composer sizes.
