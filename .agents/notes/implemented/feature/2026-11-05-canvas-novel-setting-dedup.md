# Agent Note: Setting reconciliation searches before it creates and lets the person resolve duplicates

Status: implemented

## Problem

Reconciliation gave the extraction subagent no setting roster. A formal company name and a descriptive reference could therefore become two cards, while a combined name such as “A 与 B” could duplicate both A and B. Exact-name matching could not repair this, but an unbounded roster would make every chapter's prepare pack grow with the book, and fuzzy automatic merging would put canon at risk.

## Decision

- The extract pack carries at most 100 relevant setting rows, ordered by chapter matches, recent use and board order. Each row has a ref, name and shelf; an omitted count points to search instead of printing the whole catalog.
- `novel_read(what=settings)` searches names and content by `query` and `kind`, and reads selected `refs` in full. Archived cards do not match.
- A memory may name an existing setting by `ref`. The ref wins over its descriptive name; new, nonduplicate content appends with its chapter and evidence, never replacing the old text. An invalid ref drops the row.
- Name containment and combined names create a `duplicate` pending item. These rows never follow reconciliation's automatic materialization path. The person chooses “merge into existing” to append the difference or “create separate” to make an independent card. A combined name with no candidate still waits for that confirmation.
- Search, matching and pending persistence are deterministic. No alias is invented and no fuzzy company match is treated as proof.

## Alternatives considered

- **Put every setting into every prepare pack.** Rejected: the cost repeats per chapter and grows with the book. The bounded roster handles the common case, search handles the tail, and import still checks the full catalog.
- **Merge similar names automatically.** Rejected: containment and combined names are hints, not identity. Both merging and creation need an explicit decision.
- **Replace the existing card on an explicit ref.** Rejected: a chapter supplies another fact, not authority to erase prior canon. Appending preserves both the old text and the evidence trail.

## Consequences

- Reconciliation can update a formal setting from a descriptive chapter reference without creating a second card, even when the roster omitted that setting.
- A suspected duplicate can remain undecided without blocking other imports. Reconciliation of that chapter supersedes its unresolved duplicate rows on the next run; decided cards stay.
- The separate-card decision checks exact duplicates again before writing, so a card created since the review opened is not duplicated.
- Tests cover search by keyword, kind and refs, descriptive-name updates, combined-name merging, confirmed separate creation and the two browser actions. The full novel suite passes 36 files and 282 tests.
