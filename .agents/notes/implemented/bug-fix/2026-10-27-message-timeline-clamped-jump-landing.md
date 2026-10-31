# Agent Note: message-timeline keeps clicked landings when scrolling clamps

Status: implemented

English | [中文](2026-10-27-message-timeline-clamped-jump-landing.zh.md)

## Problem

The rail cleared its hover/focus preselection on click and relied entirely on the next reading-position computation. At the conversation's scroll floor, clicking the latest message or any later row already inside the viewport could not move `scrollTop` far enough to put that row at the top. The browser clamped the write, no new reading position arose, and `activeRowKey()` returned the first visible user row again. Repeated "继续" messages in a Room made this look like a content- or steering-specific failure, but their nodes were ordinary, visible user rows with unique keys.

## Decision

A successful jump now produces both the scroll write and a remembered landing. The shared `jumpTarget` helper returns the target row after writing; the tracker records its key, element, and the browser's actual clamped `scrollTop`, then publishes that key immediately instead of waiting for a scroll event that may never fire. Subsequent tracker updates retain the landing only while the position is unchanged and the row remains inside the bound scrollport. Real scrolling, row removal, scrollport attachment/rebinding, session switches, and disposal clear it and restore the unchanged `activeRowKey()` reading-position algorithm. Direct and outline jumps share this path, and the public API shape is unchanged.

## Alternatives considered

**Always select the latest row at the bottom.** Rejected: it fixes only the newest message and actively misattributes clicks on earlier visible rows, including the repeated "继续" case.

**Keep a sticky selection in `TimelineRail`.** Rejected: a second selection owner would duplicate tracker state and still could not reliably distinguish a clamped jump from later reader movement or DOM replacement.

**Only run the existing update once after `jumpTo`.** Rejected: it republishes the same first-visible row when the scroll write clamps, and a no-op scroll emits no event to repair it later.

## Consequences

Latest-message and middle-of-viewport clicks now select their actual target at the scroll floor, while ordinary long-answer anchoring stays unchanged. A remembered landing cannot cross a real reader move, a removed row, a rebind, or disposal. The tracker suite drives two successive "继续" clicks through the real tracker, checks immediate and post-update selection, releases on actual scrolling, and clears a removed target; the full package suite passes with 142 tests.
