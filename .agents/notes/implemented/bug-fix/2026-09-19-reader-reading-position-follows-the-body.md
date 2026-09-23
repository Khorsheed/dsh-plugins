# Agent Note: the reading position follows its body

Status: implemented

## Problem

The reader reported: switching to another dsh session or another tab and coming back does not return to where they were reading — the article is there, but at the top.

Two causes, both in the position rather than in the article:

- **The position was applied once, from the restore path, right after the first body rendered.** A body that arrives in two steps — the feed's summary first, the fetched page after — clamps that one assignment against the SHORT version and then leaves the reader at the top of the long one. Nothing re-applied it, so the article was on screen, translated (after the previous fix) and at position zero.
- **Only the article's scroller was remembered.** The wall has its own scroller and its own position, and neither was ever saved, so a reader who was browsing the wall came back to the top of it.

## Decision

- **The SAVED position is the target, and it is re-applied whenever the body is (re)built** — a restored pane, a re-opened entry, a re-fetch landing after the summary, an element React recreated. The effect is keyed on `[openEntryId, articleHtml]`, exactly like the translation record, because both describe the same thing: this entry, as it currently stands on screen.
- **While the body is too short to reach the offset, the assignment is retried** for a short window (`SCROLL_SETTLE_ATTEMPTS`, ~30 frames). That covers images decoding, fonts settling and a fetch still in flight — the three reasons a scrollHeight is smaller than the position it is supposed to hold. It is not a polling loop: it stops as soon as the scroller can reach the offset, or the reader scrolls.
- **Only the reader's own scrolling is recorded.** Setting `scrollTop` fires a `scroll` event too, and saving that echo is how a position gets destroyed: when the body was short the browser CLAMPS the assignment, so the echo carries the clamped value and would overwrite the real target with it. The handler compares the event's offset with the value the last programmatic assignment actually landed on and drops the match.
- **The wall gets the same treatment**: its position is saved on the reader's scroll and restored once per entry into the list view (not on every row change, which would fight the reader's own filtering).

## Alternatives considered

**Throttle or debounce the save.** A dropped trailing event is exactly one scroll behind the reader — the same mistake the detail position already avoids by writing on every event.
**Anchor-based restore** (`scrollIntoView` on a remembered element id). Correct in principle, but it needs stable anchors in third-party markup that this package normalizes away; a pixel offset plus a settle retry gets the reader back without inventing an anchor vocabulary.
**Restore only on remount** (the original design). Misses the common case: the body of a summary-only feed is replaced *after* the pane was restored, while the reader watches.
**Re-apply the wall position whenever the rows change.** Filtering or searching changes the rows; jumping to the old offset then is a second bug, not a fix.

## Consequences

- "Where I was" is now body-keyed and durable within the page for both scrollers: panel switches, session switches, re-opens and body replacements all come back to the position, and only a reload resets it (the pane's memory is not persisted).
- The memory can no longer be corrupted by a clamp, because the clamp is the one case where the programmatic echo differs from the target — and it is recognised as programmatic.
- jsdom keeps `scrollTop` across an `innerHTML` replacement where a browser clamps it, so the detail-position test zeroes the scroller explicitly when it replaces the body. Without that, the assertion would have passed with no restore at all.

## Testing

`packages/dsh-reader` runs 256 tests (2 new, and both fail on the previous commit):

- `tests/ReaderPane.client.spec.tsx`: a reader scrolls into an article; its body is replaced and the scroller is clamped (as a browser would); the article must be back at the saved offset. And: a reader scrolls the wall, the pane unmounts and a new pane mounts over the same page; the wall must be back at the saved offset.
