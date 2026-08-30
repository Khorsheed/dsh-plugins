# Agent Note: message-timeline filters dead rows for withdrawn user messages

Status: implemented

English | [中文](2026-08-30-message-timeline-filter-withdrawn-rows.zh.md)

## Problem

Live bug (message-timeline × message-tools): after withdrawing a user message, the timeline rail kept showing a row for it, but clicking it did nothing — the transcript did not jump. The withdrawn message appeared in the view yet was un-jumpable.

A second live symptom surfaced together with it: the newest user message could render second-to-last in the rail. An in-place edit of an **older** message materializes a `message-tools-edited` bubble whose `anchorSeq` is genuinely older than the newest `order` row, but the bubble was appended at the very end by walking the store — whose iteration order is not seq order.

Root cause is not the rail's kind filter. A message-tools **withdraw** (unlike an **edit**) leaves the withdrawn original `user` node **visible in the host `order`** — the projection has no suppression seam, so the original is never hidden from `order`. The sibling `message-tools-withdrawn` divider (an edit materializes a `message-tools-edited` bubble the same way) carries the span it covers as `{ hiddenStartSeq, seq }`, and the message-tools DOM hider hides those rows purely by CSS on `[data-chat-flow-key]`. So `s.chat.order` still lists the withdrawn original, the rail's `order` loop renders it as a normal row, but its transcript row is `display:none` — `jumpRow` targets a zero-size row and the click scrolls nowhere.

The existing append loop surfaced `message-tools-edited`/`message-tools-restored` bubbles but had no notion of a covered span, so a withdrawn original in the order was never skipped.

## Decision

- **Fold the withdrawn spans once from the store, then filter both loops.** `foldHiddenSpans`/`isSeqHidden` read the `{ hiddenStartSeq, seq }` pair off every `message-tools-withdrawn` / `message-tools-edited` node in `s.chat.nodes.values()` (the same pair list message-tools' own `foldHiddenRanges` builds: inclusive start, exclusive end). Any row — from the `order` loop or the append loop — whose node `anchorSeq` falls inside a span is a dead row and is dropped.
- **The baseline is byte-identical.** An ordinary session carries no span node, so `foldHiddenSpans` returns `[]` and nothing is filtered; every order row still renders. The fix never alters the baseline, and the span fold is computed in the same defensive try/catch as the append, so a store read failure degrades to no spans (baseline rows still render).
- **The span end stays a row.** A divider/edited bubble anchors at `seq`, the exclusive span end, so `isSeqHidden` is false for it — the live replacement or divider is never filtered, only the covered originals (which are hidden and un-jumpable).
- **Appended bubbles are re-sorted to their transcript position.** The `order` loop is seq-sorted, but the append loop walks the store in non-seq order, so a bubble for an older message landed at the very end, past the newest row. After both loops the combined rows are sorted by `node.anchorSeq` ascending. JS sort is stable, and an ordinary session has no appended bubbles (its order-loop result is already seq-sorted), so this never reorders the baseline. The withdrawn-original filter runs before the sort, so a dropped dead row never resurfaces.

## Verification

Regression tests: a withdrawn original that still sits in `order` is dropped while the untouched user row after the span renders; a `message-tools-edited` node that anchors inside a span is filtered while one anchored at the span end is kept; the pure fold returns `[]` for an ordinary session and folds withdrawal + edit spans in start order; an older appended bubble is ordered before a newer user row (`tests/hidden-spans.client.spec.ts`, `tests/TimelineRail.client.spec.tsx`). 98 package tests pass; `pnpm build` and `typecheck` green.

## Alternatives considered

**Filter on `node.visibility === 'hidden'` alone.** Not sufficient for a withdraw: the left-behind original stays `visibility: 'visible'` (only the DOM hider hides its row), so the rail's `order` loop still picks it up. The span fold is the signal that matches the DOM hider.

**Read the message-tools module to reuse `foldHiddenRanges`.** Rejected: message-timeline must stay independent (read the store, never import a sibling's package). `foldHiddenSpans` re-derives the same span list from generic store node data.

**Reparent withdrawn originals under the divider as a row.** Rejected: the originals are hidden (no jump target), the divider owns that history, and the rail is a user-message index — a dead row is worse than no row.

## Consequences

A withdrawn user message no longer appears as a dead row in the rail (clicking a row always lands), and appended edited/restored bubbles sit at their true transcript position so the newest message is always last. Ordinary sessions are byte-for-byte unchanged; edited bubbles anchored at the span end still render and stay jumpable. The span fold and the append are per-session and defensive, so a transient bad store read never hides the baseline.
