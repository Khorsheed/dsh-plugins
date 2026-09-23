# Agent Note: the reader's chrome gets out of the way — clearable search, fitted filter search, deletable tags, one compact settings row

Status: implemented

## Problem

Four things about the inspiration space's controls, reported together with screenshots:

1. **The search box could not be cleared.** Text had to be selected and deleted by hand, which is worse here than in a plain search field: the box also carries the filter values (`#sourceId`, `@tagId`), so what looks like "the thing I typed" may be a narrowing the reader never typed at all.
2. **The filter popover's source search ran past the panel's right edge.** `.filterSearch` was `flex: none` inside the panel's column flex, and its input was `width: 100%` — a percentage resolved against a parent sized from that input's own intrinsic width. The field was wider than the panel it lived in.
3. **Tags could be created but never deleted.** `deleteTag` and `pruneTags` have been on the reader's Remote since the tag vocabulary shipped; **no surface called either**. A tag added by a typo stayed in the vocabulary, in every entry's chips and in the filter popover forever.
4. **The subscription page spent three lines on each of two settings and eight loose chips on the filter.** Daily refresh time and article retention each owned a full-width bordered block with a paragraph of help, and the kind/order chips were two unlabelled rows — on the page whose actual job is a list of sources.

## Decision

- **The wall's search field clears itself.** An `×` renders inside it whenever it has text; the click clears `query`, which clears the typed term and any narrowing at once (`#sourceId` / `#rss` / `#link` / `@tagId` are all just the query). Both search fields reserve the button's 24px in their right padding, so the text never sits under it and the field never reflows when the button appears or disappears.
- **The filter search is a flex-sizing fix, not a width value.** `.filterSearch` becomes `flex: 1 1 auto; min-width: 0`, and its input gets `box-sizing: border-box`. A parent that shrinks to fit its child, holding a 100%-wide child, cannot be repaired by a magic `width`.
- **Tags are deletable where they are used.** Each row of the filter popover's `By tag` section gets a quiet `×` (always visible — a hover-only control is invisible on touch) that calls the existing `deleteTag`. Two follow-ups are part of the decision, not polish: the active narrowing is dropped when it was that tag, and a new store action `dropTag` prunes the vocabulary, the usage counts **and** every entry's tag ids — three client-side structures hold a tag id, and a stale one draws a chip that can no longer match anything.
- **The subscription page is compressed into a settings row and two labelled chip groups.** Daily refresh time and article retention share one row (each keeps its long explanation as its `title`); the chips get inline group labels (`By type`, `Sort`) and tighter metrics. The controls, their ids and their behaviour are unchanged.
- **The cache-policy help text now describes what ships.** It promised "after the deadline, opening it offers the fetch again" — since opening an entry fetches a missing or expired body, the copy says that instead.

## Alternatives considered

**A native `type="search"` clear button.** Rejected: the affordance is engine-dependent and cannot be styled or relied on across the browsers this pane targets, and the pane's own `×` is three lines of CSS with one behaviour everywhere.

**A clear button outside the field, beside the filter and sort tools.** Rejected: the toolbar's width is already the scarce resource on a narrow sidebar, and the ask was explicitly "inside the field".

**A fixed pixel width for the filter search.** Rejected: it would overflow at other panel widths and fight the scrollbar; the defect was intrinsic sizing, which the flex fix removes for every width.

**Deleting a tag behind a confirmation, or on its own management page.** Rejected for now: a tag is a name, re-creating it means typing it again, and a dialog for a reversible act of naming is heavier than the act. The consequence is recorded below.

**Hiding the two settings behind an "advanced" disclosure.** Rejected: the daily refresh time is a setting readers change, and a disclosure makes the common case one click deeper; compressing keeps both visible.

**Keeping the inline help paragraphs.** Rejected: they are read once and cost a line each on every visit. The `title` keeps them reachable, and each control still carries a visible inline label, so no control's meaning depends on the tooltip alone.

## Consequences

- **Deleting a tag is immediate and global, with no undo.** It removes the tag from every entry that carried it. That is the semantics the wire verb already had; the UI now exposes it. A reader who wants it back types the name again.
- **`dropTag` is required client state hygiene, not decoration.** Without it the vocabulary, the counts and the per-entry chips disagree, and the popover renders a filter that cannot match.
- **The wall's `×` clears filter values too.** That is intended (it clears "the narrowing"), and the value was visible in the box, so nothing is cleared invisibly.
- **The subscription page's help is now hover-only**, and a `title` on a `<label>` is not a screen-reader description. Each control keeps a visible inline label, so the label itself is never the tooltip.
- **No wire change.** `deleteTag` already existed; this change wires it up and adds one client store action.

## Testing

`packages/dsh-reader` runs 201 tests (3 new in `ReaderPane.client.spec.tsx`):

- The `×` appears only when the field has text, clears the value, and disappears again.
- Deleting a tag from the popover calls `deleteTag` with that id and clears the active narrowing (`@tag-id`) with it.
- The compressed settings row still exposes both controls (`#reader-refresh-time`, `#reader-cache-ttl`).
