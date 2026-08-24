# Agent Note: message-timeline short list rests on the chat box; dock cards never push it up

Status: implemented

English | [中文](2026-08-24-message-timeline-list-rests-on-chat-box.zh.md)

## Problem

The panel box ended at the top of the whole `[data-composer-seat]`, and a short list floated centered in the window while the conversation renders bottom-anchored — the reading-position tick sat far above the newest message. Worse, the composer seat holds dock cards (goal/todo/queue) above the input card, so any open dock made the seat taller and pushed the panel bottom further up, detaching the timeline from the chat box even in the resting state.

## Decision

- **Short lists rest on the bottom edge** of the panel box instead of centering (`TimelineRail.module.css`): the free space collects above the list (`::before { margin: auto 0 0 }`), so the reading position sits next to the conversation's newest messages; overflowing lists still fill from the top with their bottom flush at the composer.
- **The panel box ends at the chat input card, not the seat** (`measureGeometry` in `rail-tracker.ts`): the bottom is the `[data-composer-card]` top minus the 8px padding, so dock cards above the input never push the timeline up. Falls back to the `[data-composer-seat]` top, then the column bottom, when the markers are absent (degrade, don't explode).

## Verification

`measureGeometry` tests cover the input-card bottom with a dock card above (the box ends at the input, ignoring the dock), the seat-top fallback, and the column-bottom fallback (`tests/rail-tracker.client.spec.ts`). The full package suite passes and `pnpm build` is green.

## Alternatives considered

**Keep centering but count the composer into the box** (tried, reverted): made the list sit lower but still centered — the tick stayed above the messages, and the user found it too low overall.

**Anchor the list to the bottom only when it overflows.** An overflowing list already ends flush at the box bottom; the defect was the box itself ending above the chat box when docks are open, so the fix targets the box bottom, not the list alignment.

## Consequences

Short lists sit flush above the chat input box, aligned with the newest messages; dock cards no longer shift the timeline. The panel box still excludes the input card itself, so the timeline never overlaps the input.
