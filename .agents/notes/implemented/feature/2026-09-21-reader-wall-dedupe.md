# Agent Note: the wall folds republished duplicates

Status: implemented

## Problem

Aggregated feeds republish the same article — the reader's 3080 wall had "An Alien Mind" under both an aggregator feed and the original blog, and a wall of subscriptions is measurably worse when the same piece appears twice. The reader approved the shape: dedupe as a wall-level narrowing, default ON, hidden — never deleted.

## Decision

- **Detection is never fuzzy** (`dedupeRows` in `client/selectors.ts`, pure): group by normalized link first — scheme, `www.` and trailing slashes stripped, tracking parameters (`utm_*`, `fbclid`, `gclid`, `spm`, `ref`, …) removed, the rest of the query sorted — and only when no link groups, fall back to the title folded (case/accents/punctuation) **plus the same published day**, with both dates mandatory and a six-character floor on the folded title. A miss costs one duplicate card; a false positive costs an article. The asymmetry decides every edge.
- **Survivor choice**, in order: a member whose body the host already holds (a `ready` fetch state — that copy opens instantly) beats a NEWER member; a tie keeps the input order. The "non-aggregator source" signal is deliberately skipped: nothing on a row derives it honestly, and a guessed aggregator ranking would be the fuzzy logic the gate exists to avoid. The survivor sits at its own position in the sort.
- **Hidden rows are reported, not deleted**: the surviving card carries a 「N 个重复来源」 badge whose tooltip names the other sources (v1: a tooltip; a click-through list is the judged-not-needed upgrade), and the footer notes 「已隐藏 M 条重复」 whenever anything folded.
- **Read state merges across the group**: any copy read → the card displays as read. The merge happens at display time; the per-entry read cursor stays per-entry underneath.
- **The toggle is a narrowing, so it lives where narrowings live**: the filter popover's read-state section, one row under 只看未读 — not a new toolbar button (the header is full). Default ON; it rides the same session-snapshot restore as `unreadOnly` (hydrate, mirror, and the [unmount flush](../bug-fix/2026-09-21-reader-unmount-narrowing-flush.md) — dedupe state survives the split that lost the filter).
- **The fold applies to everything the wall shows**: the row list, the header's unread count, the match line, the empty state, and the backfill's work pool (a hidden copy is not fetched — the survivor answers; re-enabling the view re-pools, and `backfillTried` keeps it from storming).

## Alternatives considered

**Dedupe inside `selectRows` (before the 300-row slice).** Rejected: `selectRows` is the wall's local predicate, and the survivor signal wants the fetch-state mirror, which that function has never needed. A separate pass over its output keeps both pure and keeps the cap honest (it counts pre-fold rows — a render bound, not a content bound).
**Fuzzy title similarity.** The DOI resolver's two-factor gate exists because title-only matching misfires on real data; the wall has no author corroboration to pair with, so the wall's answer is exact-match-plus-day or nothing.
**Deleting the duplicates' entries or merging the read cursors at write time.** The fold is a VIEW: a hidden copy's own state (tags, fetch record, its feed's window) stays intact, and the merge is computed at display so "read" never needs an un-read inverse.
**The badge opens a list of the duplicates.** v1 keeps the tooltip: the badge's job is provenance, not navigation; the duplicates are one toggle away.

## Consequences

- A republished article is one card; the badge keeps the group discoverable and the tooltip names the other sources.
- The unread count and the match line read what the reader sees (post-fold), so a folded wall and its counters never disagree.
- Dedupe keys are derived per render from rows that are already computed; no new fetch, no new wire field, no host state.
- Known edges, accepted by design: two genuinely different posts sharing a short title on one day fold (the 6-char floor makes this rare); an undated saved link never title-groups (its link is its identity); the unreadOnly filter applies before the fold, so a read copy hidden by that filter leaves an unread duplicate standing alone as unread — the filter's own semantics win.

## Testing

`packages/dsh-reader` (+9): `tests/selectors.spec.ts` (+6) pins the grouping (link normalization across protocol/www/utm, folded title + same day, undated/short-title/different-query misses), the survivor rules (newest wins, a `ready` body wins over newer, position preserved) and the read merge both directions. `tests/ReaderPane.client.spec.tsx` (+3): one card with the badge and the footer note; the popover toggle shows both copies and persists across a remount; opening either copy reads the card. The filter-panel row-count guard moved 5 → 6 (the new toggle row).
