# Agent Note: file placement and citation rules for proposal attachments and evidence

Status: implemented

## Problem

Content with no home had accumulated around the repo: a page-snapshot dump written
to the working-tree root, HTML prototypes with no stated location, and — the
damaging part — tracked documents citing paths a fresh clone cannot see. **25 tracked
markdown files pointed into gitignored `scratch-*/`**, so the evidence behind
implemented records (reviewer verdicts, verification screenshots) was readable on one
machine only, while AGENTS.md forbids scratch as a working location at all.

The proposal ledger had drifted the same way: three proposals sat `verified` weeks
past the 7-day rule, four proposals had no ledger row, four rows disagreed with their
file headers, and three headers used an ASCII colon where the template fixes `：`.
`.agents/notes/README.md` specified an archive tree, a skill, a verifier and four
`2026-06/07` Agent Notes that have never existed in this repository.

## Decision

Four placement rules now hold.

1. **A proposal's HTML attachment has a fixed home.** `proposals/` side:
   `proposals/prototypes/<slug>.html` (first occupant: the canvas-space storyboard,
   moved out of `scratch-storyboard/`). Upstream-proposal side: the prototype stays
   **beside** its document in `docs/upstream-proposals/` and the two cross-reference
   each other (`reader-prototype.html` ↔ `2026-09-17-reader-prototype-notes.md`) — that
   co-location is deliberate, not clutter. Either way the HTML is a visual attachment:
   decisions, acceptance results and facts live in the proposal body, never in it.
   Both rules are written into [proposals/README.md](../../../../proposals/README.md).
2. **A tracked file may cite scratch only by saying so.** Evidence that still exists is
   imported — review reports to `docs/acceptance/`, images an implemented record leans
   on to `docs/screenshots/` with `git add -f` (AGENTS.md's documented exception).
   Evidence that never ships keeps its scratch path but is now labelled
   `gitignored, never committed` / 本机 scratch、未入库. Evidence already deleted is
   stated as cleared rather than cited as available.
3. **The ledger and the file header are one fact.** A status change moves the file,
   edits the header and updates the row in the same commit; every file on disk has a
   row; header keys use `：`.
4. **The notes README declares its own drift.** The archive specification stays (it is
   still the intended mechanism), but the section now opens with this repository's
   state: no `archived/` tree, no `verify-archived-agent-notes.ts`, no
   `dsh-archive-agent-notes` skill, none of the four pre-2026-08 notes it links — and
   `implemented/AGENTS.md` / `docs/AGENTS.md` are not files of this repo, because
   `verify-agent-note-format` and `verify-agent-note-classification` carry their rules
   mechanically. `scripts/agent-note-tree.ts` already permits an `archived/` folder, so
   the gap is the tree and its verifier, not the classifier.

## Alternatives considered

**Delete the archive section from the notes README.** Rejected: it is a specification
someone will build against, and the classification script already reserves the folder
name. What was wrong was not the prose but its silence about not existing — hence rule
4 rather than removal.

**Leave scratch citations as they were, because they record what was true on the day.**
Rejected: an implemented record earns its keep by being re-checkable, and a bare path
into a gitignored directory reads as a claim of availability. Where the record cannot
be re-checked, the sentence now says so out loud instead of pretending.

**Import the whole `scratch-screenshots/` tree so no citation ever dies.** Rejected:
~17MB of debug PNGs for a repo whose tracked screenshots total 8.2MB, most of it cited
by nothing. Only the ten images a tracked document actually names came in (~1.1MB).

**Re-run the old verifications and attach fresh screenshots.** Rejected: a 2026-09
screenshot is evidence about 2026-09, not about the 2026-08-22 build the note describes.

**Move the upstream-proposal prototypes into `proposals/prototypes/` too.** Rejected
after checking: the html-in-`docs/upstream-proposals/` pairing is an existing convention
recorded in the prototypes themselves, and the two faces of the rule are one per tree.

## Consequences

- Every `scratch-*` path left in a tracked document is now explicitly local-only, so a
  concurrent agent can tell "not here" from "misplaced" without asking.
- The repo carries ~1.2MB of imported evidence and one new directory holding a single
  file; the directory is the point — the next attachment has somewhere to land.
- The ledger is checkable again: 42 rows, disk and headers agree. The three closed
  proposals' 46 inbound links were repointed across 30 files — 10 Agent Notes in both
  languages (sidecars re-recorded), the two ledgers, `docs/roadmap.md`, one eval-task
  brief, one sibling proposal, and three source comments — so
  `proposals/active/…delegation-api…` now resolves nowhere.
- `docs/roadmap.md` no longer marks member-channel a release blocker; what remains true
  is stated directly — the local-agent family is still unpublished to npm.
- `proposals/README.en.md`'s ledger is 28 rows behind the Chinese one (it froze around
  2026-08-28). The two rows whose files this change moved were repointed and synced;
  the row count was not. That sync is open work, not a placement question.
- Relative-link depth is a separate backlog: a scan of tracked markdown finds 284 dead
  links across 161 files, and 186 of them are one class — Agent Note citations of
  proposals written one level short (`../../../proposals/…` from a directory four
  deep). The defect predates this change and this change neither created nor repaired
  it; the sweep is mechanical.
- Whoever ships the archive edits rule 4 rather than rediscovering the gap; nothing in
  this change implements or blocks it.
