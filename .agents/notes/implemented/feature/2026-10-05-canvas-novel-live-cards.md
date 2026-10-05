# Agent Note: canvas-novel agent cards land live, marked new

Status: implemented

## Problem

Every card the model created was a ghost card (canvas `proposed`) that stayed out of the brief and the ledger until the user accepted it with ✓. After one import on the temp instance the board held a pile of ghosts the user had not reviewed, and the plan could only name foreshadows by description: the nine foreshadow ghosts had no ledger ref the model could cite. With many cards, accepting each one is a chore, yet the user still needs to see what this round added.

## Decision

- **Agent cards are live by default (canvas)**: `proposeCard` takes `live: true`, which lands the card `kept` with `unseen: true`. A live card enters the brief and the ledger at once and can be named by ref.
- **The 「新」 mark is generic canvas behavior**, keyed on the `live` flag, so a canvas without a genre (or one whose writers never pass `live`) behaves exactly as before.
  - The card face shows an amber ✦ inside its top-right corner (red is kept for 待审) (it fades while the card is hovered, focused or selected, making room for the card actions) while `unseen` is set, and new cards sit at the front of the grid. The front set is frozen per visit (every card unseen when the canvas opened, plus later arrivals), so seeing a card never moves it under the reader or the detail's ‹n/m›.
  - Opening a card clears its mark (writable boards only); archiving clears it too (`patchCard` drops `unseen`, `normalizeCard` never keeps it on an archived card).
  - Each category chip (and 全部) with unseen cards carries a small dot, and a ✓✓ icon at the right end of the filter row (next to the 管理分类 icon, lit only while there are new cards) marks them all seen, backed by the new `markSeen({ canvasId, cardIds? })` remote (no ids = all; `missing` when nothing is unseen). No separate strip row.
- **canvas-novel drops the ghost-card concept**:
  - `writeCard` and every card the import writes pass `live: true`; the import's gate 3 now means "new settings, foreshadows and characters land live", and the report's `proposedCards` became `newCards`.
  - The card-level `autoImported` note and `RuleView.autoImported` are gone (nothing is auto vs. accepted any more); memories carry their confidence and evidence in the card comment.
  - `reviewCard` became `archiveCard`: on a card, `novel_write(review)` accepts only `archive`; accept/discard stay for the pending queue, and retract stays for auto-imported experiences.
  - The `putCard` slice member is removed; canvas-native `proposed` cards (a person's own proposals) are still honored and still stay out of the brief.
- **The pending queue is unchanged**: medium/low-confidence mentions and experiences and missed plans still wait for a person.

## Alternatives considered

- **Keep ghosts, add "accept all".** Still leaves foreshadows without refs until the user acts, which is the problem the plan exposed.
- **A genre-only 「新」 mark.** The mark is useful to any agent-written canvas and costs nothing when unused, so it lives in the canvas, behind the `live` flag.
- **A full-width strip explaining the mark, and a 「新」 text pill.** The first cut; the user found the pill too quiet and the strip a wasted row, so the counts moved onto the chips and the pill became a red dot (later an amber ✦, with the chip counts reduced to a dot).
- **Clear the mark on hover or on board open.** Too easy to clear without looking; opening the card or the explicit button is the signal.

## Consequences

- The model can cite every card it wrote by ref (`#19`, `w3`, `c2`) immediately, in plans and reconciliation alike.
- A wrong agent card now reaches the brief until the user fixes or archives it; the 「新」 mark and the board strip are what keep that visible.
- Existing ghost cards are not migrated automatically; on the temp instance they were converted by hand to `kept` + `unseen`.
