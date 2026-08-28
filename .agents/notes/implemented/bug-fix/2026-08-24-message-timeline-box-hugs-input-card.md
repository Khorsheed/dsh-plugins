# Agent Note: message-timeline panel box hugs the chat input card; short lists stay centered

Status: implemented

English | [中文](2026-08-24-message-timeline-box-hugs-input-card.zh.md)

## Problem

The panel box ended at the top of the whole `[data-composer-seat]`. The composer seat holds dock cards (goal/todo/queue) above the input card, so any open dock made the seat taller and pushed the panel bottom up off the chat box — the timeline detached from the conversation even at rest. A short-list bottom-rest experiment (list flush with the input card) was tried on 3080 and rejected: daily use should keep the short list centered in the box.

## Decision

- **The panel box ends at the chat input card, not the seat** (`measureGeometry` in `rail-tracker.ts`): the bottom is the `[data-composer-card]` top minus the 8px padding, so dock cards above the input never push the timeline up. Falls back to the `[data-composer-seat]` top, then the column bottom, when the markers are absent (degrade, don't explode).
- **Short lists stay vertically centered** in the box (`TimelineRail.module.css` `margin: auto` spacers); an overflowing list starts at the top and scrolls invisibly, its bottom-most row flush with the chat input card — "centered daily, hugging the chat box when long".

## Verification

`measureGeometry` tests cover the input-card bottom with a dock card above (the box ends at the input, ignoring the dock), the seat-top fallback, and the column-bottom fallback (`tests/rail-tracker.client.spec.ts`). The full package suite passes and `pnpm build` is green.

## Alternatives considered

**Bottom-rest short lists** (tried on 3080, rejected by the user): the list sat flush with the input card even with three rows, which felt wrong for daily use — centering is the resting behavior.

**Count the whole composer seat into the centering box** (tried earlier, reverted): moved the center down but left the tick above the messages, and dock cards still shifted the box.

## Consequences

Short lists center as before; when the list grows it fills down to the chat input card and its bottom-most row hugs the chat box. Dock cards no longer move the timeline at all.
