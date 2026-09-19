# Agent Note: where the reader's state lives, and why

Status: implemented

## Problem

Three rounds of "the reader forgot X", each fixed on its own: the open article and the translation (page memory), the fetch that re-ran on every open, the position. The last round was not a wiring mistake but a **unit** mistake: the reading position was remembered as a pixel offset, in a document whose height is not final when it first renders.

The evidence, from the acceptance instance's own cache: the stored body of the paper the reader reported has **27 `<img>` tags and not one `width` or `height`** (`extract-article` keeps the site's markup). So after the body renders, the document keeps growing as each image arrives — and a pixel offset recorded against the settled page lands in the middle of a short one, the browser clamps it, and the reader is left at the top while the content moves under them. The retry loop that was supposed to catch this checked `scrollHeight >= target + clientHeight`, which is *true by construction* after a clamp, so it never retried at all.

So this note is the review that was asked for, and the change that came out of it.

## Decision

### The inventory

| State | Owner | Survives | Comes back from |
| --- | --- | --- | --- |
| Wall parse (entries) | pane, from host payloads | one mount | re-read + re-parsed on every mount — deliberately, so the wall is never stale |
| Article body (html / sidecar file) | **host** (`state.json` + `bodies/`, under the cache TTL and budget) | restarts | `getEntryBody` when an entry is opened |
| The place: view, open entry, article anchors, wall offset | **page memory + `sessionStorage`** | remounts, session switches, page restarts (same tab) | hydrated on mount; the anchors re-applied on every body rebuild and re-measured while the layout grows |
| Translated text | browser (`translate.ts` sentence memory, 4000 sentences) | the page | re-run from memory (usually no request) — never persisted |
| Translator session (per pair) | **page memory** | the page | reused — never built, because `create()` needs a gesture |
| Globe on/off + view (per entry) | **page memory** | the page | re-applied on every body rebuild |
| Tags, saved links, `recent` | **host** | restarts | host reads |
| Wall narrowing, sort, search, unread cursor | **page memory** | the page | hydrated on mount |
| Conversation draft, quote target | dsh session | the session | the host |

### The four boundaries and their rules

1. **Host state is the only authority on content.** Bodies, sources, tags and the recent list live there, keyed by entry id, shared by every session, and they are re-read rather than remembered.
2. **Page memory is "where the reader was", never "what the reader has".** It crosses pane remounts and dsh sessions (the reader is one person reading one wall). The PLACE is also written to `sessionStorage`, so a page restart (a reload, or anything that reinitialises the page) still finds the reader where they were; third-party content is never written anywhere.
3. **React state never crosses a mount.** Anything that must survive one is written to page memory by the effect that owns it, not kept in component state and hoped for.
4. **Browser memory (translator sessions, sentence memory) is page-scoped and never persisted**, because the translated text is a third party's and this package's rule is that it never leaves the page. Persisting the place and not the globe is deliberate: after a restart the article and its position come back, and the globe stays off (there is no translator session to restore it with, and building one needs a gesture).

### The rules that stop this becoming patch-on-patch

- **Restored state is re-applied on every REBUILD, and keyed by CONTENT, not by coordinates.** The position was an offset applied once; the translation record had the same shape of bug (read from a mount-time copy, armed once per entry). Both are now keyed on `[openEntryId, articleHtml]` — the body as it currently stands — and both re-apply. A coordinate (a pixel offset) is only ever a fallback.
- **A record is the source of truth, and the gesture that ends it deletes it.** "The globe is on for this entry" lasts until the reader turns the globe off or asks for a fresh fetch; the position lasts until they scroll somewhere else. No step keeps its own private copy of "what should be on".
- **A programmatic write must never be mistaken for reader input.** Setting `scrollTop` fires a `scroll` event, and a clamped assignment makes that echo differ from the target — saving it would overwrite the real position with the short document's height. The echo is recognised and dropped, and the one decision that really matters — "the reader has taken over" — is made from the gestures only a person produces (`wheel`, `touchmove`, the page keys), never by comparing scroll offsets.
- **Layout is measured once per layout CHANGE.** Reading geometry inside a scroll handler is what makes Chrome report a forced reflow, and an article has hundreds of blocks: the blocks are measured in one pass when the body renders and on each resize, cached, and the anchor is a binary search over the cache. A scroll handler must not read layout at all.
- **A restore is asynchronous, so the pane shows the surface it is restoring TO.** The entry id is known on the first render; the entry itself comes from the host's payloads. Rendering the wall in that window is the "the article disappeared and came back" flash, so the detail surface renders with a loading line instead — and a restore that settles on a missing entry closes the store's entry rather than sitting on an empty detail view forever.

### The change

- `client/session.ts`: the per-entry position is a `ReaderReadingAnchor` — the index of the article's top-level block the viewport top sits in, the offset into it, and the pixel offset as a fallback (`rememberReadingPosition`).
- `client/ReaderPane.tsx`: the anchor is read out of the DOM when the reader scrolls (skipping the translation's own reveal lines, which would otherwise shift the block ordinals), re-applied on every body rebuild, verified by whether the assignment actually REACHED the target, and re-applied on layout growth (a `ResizeObserver` on the article, for `POSITION_SETTLE_MS`) until the reader takes over by scrolling.
- The restore window renders the detail surface instead of the wall.

## Alternatives considered

**Keep the position as a pixel offset and retry harder.** The retry was already there and never ran (its condition is true by construction after a clamp); more retries of the same wrong unit would still land on different content once the document grew.
**Persist the position, the globe and the open article to disk so a reload keeps them.** Rejected for the reasons the earlier notes give: the translated text cannot be persisted, so a persisted globe record would be inert after a reload, and reader metadata has not earned a place in the deployment's state.
**Cache the parsed wall in page memory so a remount is instant.** Rejected for now: the parse is only valid for the payload it came from, and there is no payload version to invalidate against — a stale wall is worse than a moment of loading.
**Keep the pane mounted instead of remounting it.** Host behaviour (`RightbarRoot` renders only while no other main panel is active), not this package's to change.

## Consequences

### What is still true, and still a cost

- **Every pane mount re-reads and re-parses the wall's payloads from the host.** That is the "it loads again" the reader sees, and it is deliberate: a cached parse would go stale the moment a refresh lands. Making it instant would need a host-side payload version to invalidate against.
- **A reload, a restart, or a browser that discards the background tab resets all page memory** — position, translation, open article, narrowing. Host state (bodies, sources, recent) is untouched. Closing that would mean persisting reader state, which the translation rule forbids and which no report has justified yet.
- **An anchor is a block index**, so a body that is re-extracted into a different structure can shift it; out of range, the pixel fallback takes over.

## Testing

`packages/dsh-reader` runs 258 tests. The position tests state the geometry jsdom cannot provide (a 600px scroller, 300px blocks): one asserts that the saved anchor names the block the reader stopped in, and one asserts that the restore puts them at the block's offset even when the remembered pixel offset is nonsense — which is the case the reported bug lived in.
