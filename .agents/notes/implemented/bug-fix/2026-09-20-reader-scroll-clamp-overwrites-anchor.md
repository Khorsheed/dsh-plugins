# Agent Note: a browser's scroll clamp is not reader input — the remount that ate the anchor

Status: implemented

## Problem

The report from the production instance: read partway down a long article, click another sidebar tab, come back — the article is back at the top. The pane's position machinery (the block anchor, the settle window, the echo guard — [the state-boundaries note](../architecture/2026-09-19-reader-state-boundaries.md), with the text offset from [the restore-fidelity note](2026-09-20-reader-restore-fidelity.md)) had already survived three rounds of "the reader forgot X", and the pane's own remount specs passed.

Reproduced live on a throwaway instance with the browser driving: dockkit's `TabPanel` renders only the active tab's body, so a tab switch fully unmounts the reader pane and returning is a fresh mount. The anchor was recorded faithfully (`{block: 75, offset: 3, top: 7853, …}` in `sessionStorage`). On the remount the translation rebuild shrank the document under the scrolled scroller (scrollHeight 13382 → 4557); the browser clamped the offset and fired scroll events. Those events are indistinguishable from the reader's by value, and `onDetailScroll` treated them as the reader's: the stored anchor was overwritten with the clamped value, and the "reader took over" flag tripped, ending the settle window that would have re-anchored. On return the reader sat at scrollTop 0 with an anchor of `{block: 0, top: 0}` — the true anchor destroyed mid-restore.

The gap was test-invisible: jsdom never clamps `scrollTop` (an assignment past the maximum simply sticks), so the pane's remount specs never produced a clamp event; and the first real-browser scratch harness restored fine because its fake translator GREW the document — a clamp needs a shrink.

## Decision

**Recording is gesture-gated.** A scroll event counts as the reader's only when a human scroll gesture (`wheel`, `touchmove`, or a key down — the page keys) landed on that scroller within the last `SCROLL_GESTURE_WINDOW_MS` (400 ms). The pane's own writes were already caught by the echo guard; the browser's writes (clamps) have no gesture anywhere near them, and the window check drops them. Both scrollers obey it — the article's (`onDetailScroll`, stamped by the existing takeover listeners) and the wall's (`onWallScroll`, with gesture listeners of its own, keyed `[view, rows.length]`).

The "reader has taken over" flag (`readerScrolledRef`, the thing that ends the restore's settle window) is now set by the gesture listeners only — a scroll event never sets it, so a clamp can neither overwrite the anchor nor end the window that re-applies it.

## Alternatives considered

**Compare scroll offsets to tell programmatic from human.** Already rejected by the state-boundaries note for the echo case, and it fails harder here: a clamp IS a real offset change carrying a real event — there is nothing in its value to compare against.
**Suppress recording only during the restore/settle window.** The window is exactly when the reader may also genuinely scroll (they see the article land and adjust); and a clamp can arrive any time the document shrinks — a body swap, a filter narrowing the wall — not only at restore. The gesture window covers every shrink without gating real input.
**Treat a downward jump as suspicious (never record a smaller value).** Scrolling up is the normal reading act; the rule would refuse to record half of what the reader does.
**Keep the tab mounted (a host/dockkit change).** The unmount-on-switch is upstream behavior, not this package's to change; and the remount is only where the bug was REPORTED — the clamp hazard exists on every shrink, so the fix belongs in the pane's recording rule regardless of the host's mounting policy.

## Consequences

- A browser clamp can no longer overwrite a position or end the restore window, on either scroller — the reported flow (tab away, tab back, translation re-applies) restores to the recorded block.
- **A reader who scrolls ONLY by dragging the scrollbar is no longer recorded** — a drag fires `scroll` with no `wheel`/`touchmove`/`keydown` near it. Their already-recorded anchor still restores, and any wheel, touch, or key scroll resumes recording. Accepted knowingly: the alternative (counting `mousedown` on the scroller as a gesture) also stamps text-selection clicks, re-opening the hole for a clamp that follows a click.
- The six scroll specs now stub a `wheel` before the scroll they want recorded: a bare `scroll` event is programmatic by definition, and the specs say so.
- jsdom cannot clamp, so the two new specs state the clamp's shape by hand (the clock aged past the gesture window, then a gesture-less `scroll` event at a smaller offset). Both are red against the pre-gate code and green after; the remount specs stay green on both sides.

## Testing

`packages/dsh-reader` runs 324 tests (+4 over the translation-persistence line):

- `tests/ReaderPane.client.spec.tsx`: the reported flow end to end — scroll, unmount, fresh mount, the place is back (plain, and with the globe on, landing on the same translated sentence); the wall's place survives the same remount; and the two clamp cases above.
