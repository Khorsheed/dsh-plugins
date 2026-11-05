# Agent Note: Setting reconciliation searches before it creates and lets the person resolve duplicates

Status: implemented

## Problem

Reconciliation gave the extraction subagent no setting roster. A formal company name and a descriptive reference could therefore become two cards, while a combined name such as “A 与 B” could duplicate both A and B. Exact-name matching could not repair this, but an unbounded roster would make every chapter's prepare pack grow with the book, and fuzzy automatic merging would put canon at risk. New names earlier in the same payload did not participate in suspicion, normalized equivalents bypassed the raw-string namesake check, and a combined name offered only its first match as a merge target.

## Decision

- The extract pack carries at most 100 relevant setting rows, ordered by chapter matches, recent use and board order. Each row has a ref, name and shelf; an omitted count points to search instead of printing the whole catalog.
- `novel_read(what=settings)` searches names and content by `query` and `kind`, and reads selected `refs` in full. Archived cards do not match.
- A memory may name an existing setting by `ref`. The ref wins over its descriptive name; new, nonduplicate content appends with its chapter and evidence, never replacing the old text. An invalid ref drops the row.
- World names also match exactly after removing draft-status parentheses, case, whitespace, punctuation and symbol differences. That normalized exact match supplements the existing card; it is not an alias inference.
- Name containment and combined names create a `duplicate` pending item. Earlier new settings in the same payload join the candidate check, with provisional batch ids resolved to their real card ids after the cards land. These rows never follow reconciliation's automatic materialization path.
- A pending row retains every plausible candidate's id and display name. The person chooses a target and then “merge into existing,” or chooses “create separate.” The store rejects a target outside that row's candidate list; a combined name with no candidate still waits for the separate-card confirmation.
- Search, matching and pending persistence are deterministic. No alias is invented and no fuzzy company match is treated as proof.

## Alternatives considered

- **Put every setting into every prepare pack.** Rejected: the cost repeats per chapter and grows with the book. The bounded roster handles the common case, search handles the tail, and import still checks the full catalog.
- **Merge similar names automatically.** Rejected: containment and combined names are hints, not identity. Both merging and creation need an explicit decision.
- **Always merge a combined name into its first match.** Rejected: the first match is arbitrary and can silently attach the chapter's fact to the wrong entity. The person sees every candidate and chooses.
- **Replace the existing card on an explicit ref.** Rejected: a chapter supplies another fact, not authority to erase prior canon. Appending preserves both the old text and the evidence trail.

## Consequences

- Reconciliation can update a formal setting from a descriptive chapter reference without creating a second card, even when the roster omitted that setting. Normalized equivalents and same-payload overlaps no longer bypass that protection.
- A suspected duplicate can remain undecided without blocking other imports. Reconciliation of that chapter supersedes its unresolved duplicate rows on the next run; decided cards stay.
- The separate-card decision checks exact duplicates again before writing, so a card created since the review opened is not duplicated. Splitting one pending line into several target cards is deliberately not automatic; the person can repeat a supplement with an explicit ref when needed.
- Tests cover search by keyword, kind and refs, a real chapter 1 → chapter 2 ref supplement, same-payload containment, normalized equivalents, choosing either combined-name target, confirmed separate creation and the browser target selector.
