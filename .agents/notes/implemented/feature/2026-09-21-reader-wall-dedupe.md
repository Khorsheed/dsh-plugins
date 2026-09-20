# Agent Note: the wall folds republished duplicates

Status: implemented

## Problem

Aggregated feeds republish the same article — the reader's 3080 wall had "An Alien Mind" under both an aggregator feed and the original blog, and a wall of subscriptions is measurably worse when the same piece appears twice. The reader approved the shape: dedupe as a wall-level narrowing, default ON, hidden — never deleted.

## Decision

- **Detection is never fuzzy** (`dedupeRows` in `client/selectors.ts`, pure): THREE tiers, a match on any one grouping — ① **same entry id** (the strongest: `stableEntryId` shares one id across copies by design — a shared guid buys shared fetch/read/translation state — so a guid collision is the publisher saying "same item", and it folds even when the copies' links differ); ② **normalized link** — scheme, `www.` and trailing slashes stripped, tracking parameters (`utm_*`, `fbclid`, `gclid`, `spm`, `ref`, …) removed, the rest of the query sorted; ③ **folded title + same published day** — case/accents/punctuation folded, both dates mandatory, six-character floor on the folded title. Tiers compose transitively (an id-match and a link-match bridge two groups into one). A miss costs one duplicate card; a false positive costs an article. The asymmetry decides every edge.
- **All fold bookkeeping is positional** (row indexes), never id-keyed — the day-one bug, measured live: two feeds carried the same article with an identical guid, so both copies shared ONE entry id, and id-keyed folding kept both (the survivor's id IS the hidden copy's id). Only the badge lookup (`dupesBy`) is keyed by entry id, which is safe: the surviving card is the only rendered row carrying it.
- **Survivor choice**, in order: a member whose body the host already holds (a `ready` fetch state — that copy opens instantly) beats a NEWER member; a tie keeps the input order. Between same-id copies the ready signal is shared (the fetch-state record is id-keyed), so the input order always wins among them — they share every annotation anyway. The "non-aggregator source" signal is deliberately skipped: nothing on a row derives it honestly, and a guessed aggregator ranking would be the fuzzy logic the gate exists to avoid. The survivor sits at its own position in the sort.
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

`packages/dsh-reader` (+14): `tests/selectors.spec.ts` (+10) pins the grouping (same-id fold — including copies whose links DIFFER —, link normalization across protocol/www/utm, folded title + same day, undated/short-title/different-query misses, transitive id×link bridging), the survivor rules (newest wins, a `ready` body wins over newer, same-id copies share the id-keyed signals so input order wins, position preserved) and the read merge both directions — plus badge/hiddenCount correctness when the survivor shares the hidden copy's id. `tests/ReaderPane.client.spec.tsx` (+4): one card with the badge and the footer note; the popover toggle shows both copies and persists across a remount; opening either copy reads the card; and the live 3080 case — two feeds, one guid, differing links — folds to one card, with the read-merge pinned so nobody "fixes" the id collision without reading this note. The filter-panel row-count guard moved 5 → 6 (the new toggle row).
