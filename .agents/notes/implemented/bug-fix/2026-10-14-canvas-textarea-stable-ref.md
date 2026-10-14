# Agent Note: Stable ref callback for the auto-sizing card textarea

Status: implemented

## Problem

The canvas detail page's edit mode walked back to the top every few seconds while the user scrolled through a long card. The board tab polls every 4 s and bumps the store rev; the detail view subscribes to that rev, so every poll re-rendered the open editor. CardTextarea ran its autosize from an inline ref callback — a new identity per render, which React detaches and re-attaches on every commit — and the autosize collapses the textarea to 0 px and reads `scrollHeight`, forcing a synchronous layout with the textarea collapsed. While the content is shorter than the scroll offset the browser clamps the scroll position, and the clamped offset is not restored when the height comes back. Every poll tick repeated this for every text block of the block editor, walking the page to the top.

## Decision

CardTextarea's ref callback is a stable `useCallback` that stores the element and autosizes on mount; unmount clears the ref. Re-renders no longer touch the element's height: typing still sizes through `onInput`, and the former mount-only `useEffect` was redundant with the ref attach and went with it.

## Alternatives considered

**Stop the rev subscription from re-rendering the detail view.** The rev is the designed cross-tab freshness channel, and the re-render itself is harmless — the defect was the per-commit ref side effect. Weakening the channel to protect one child inverts the ownership.

**Autosize without the collapse-to-zero frame (mirror element, grow-only).** Changes shrinking semantics to dodge a symptom; unnecessary once sizing runs only on mount and input.

**Memoize CardTextarea with `React.memo`.** Trims render churn but leaves the hazard in place for every render that does happen (a placeholder or hint change re-attaches the inline ref). The stable callback removes the mechanism itself.

## Consequences

The 4 s board poll no longer moves the scroll position of the card editor, the source pane, or the comment box; height behavior on mount and per keystroke is unchanged. The same pattern was checked elsewhere: sidechat's composer holds a stable ref object and sizes only on input and send, and room's composer sizes only on change — neither re-runs sizing per render.
