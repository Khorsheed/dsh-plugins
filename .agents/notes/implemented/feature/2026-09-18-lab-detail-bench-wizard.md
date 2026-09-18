# Agent Note: the record, the bars, the answers side by side, and four steps instead of twenty questions

Status: implemented

English | [中文](2026-09-18-lab-detail-bench-wizard.zh.md)

## Problem

The second half of the user's walkthrough of the lab tab, and the second milestone of T67. With the four stages in place (the first milestone), four things inside them were still built out of whatever the projection happened to hand them:

- **The cell drawer** printed a mission id, `archive/workspace (archive)`, a list of annotation namespaces and a JSON receipt, and left a reader to work out whether the cell had succeeded and where its time had gone.
- **The results page** was a set of tables. The four validity checks each had a title and its own facts, and no reader who saw a ⚠ could tell what it cost them. Three efficiency numbers per group sat in a row of digits.
- **The judge bench** made a person click 「格子 1」, then 「格子 2」, and hold the first in their head — which is how one standard becomes two between the first answer and the last.
- **New experiment** was one bare form asking twenty questions at once, with no order and no sense of how far along you were.

## Decision

**The run-record detail answers three questions, in the order they are asked.** The head: the verdict this record carries and 成功 / 异常 — which is the ledger's, not a judgement (`halted` is the one state that says it stopped rather than finished). Then the stage timeline, then the parameters, then the attachments. The receipts a reader needs once — attempts, checkpoints, annotation namespaces — fold away; the verify output stays verbatim, because an exit code nobody translated is the whole reason the panel is opened.

**The timeline is measured, not narrated.** A state starts at the transition that entered it and ends at the one that left it, so the LAST state has no duration — running it to «now» would have the panel report a number the ledger never recorded, and re-report it every render. One untimed transition breaks the chain on both sides rather than measuring across the hole.

**Artifacts are named and honest about what cannot be done with them.** `kind` becomes a word (item material / archived workspace / verdicts / stage submission / run log), the path moves to the hover, and one sentence under them says preview and download need a host file service this tab does not have. The brief already recorded download as not-done; preview needs the same thing, so it is recorded beside it rather than faked.

**Each validity check says why it affects the COMPARISON, on hover.** That sentence is constant per invariant id, which makes it copy rather than data — so it lives in the dictionary, where it exists in both languages, and not on the projection (a host-composed Chinese string cannot). The `details` beside it stay what they were: this run's own facts, from the bundle.

**The efficiency bars are scaled inside their own metric.** Active time, output tokens and cache read have no common unit, so one shared scale would be a lie with a picture attached; each group is normalized against its own largest value, the number stays beside the bar, and a metric nobody measured says so rather than drawing empty tracks. CSS over the host's tokens — no charting library, for three numbers per group.

**The bench queues by ITEM and lays that item's answers out side by side**, de-identified, in the run's own seeded order, each column carrying a full criteria form and its own button. It is NOT a choice between them: the verdict contract is untouched — one score per cell, written against that cell's own criteria — and side by side changes what a grader can see, not what the ledger receives. In-flight answers are keyed by ticket so one submission clears only its own column, and each evidence box carries its answer's number in its label.

**New experiment became four steps**: ① dataset and items ② comparison groups ③ judges, reps, stages and budget ④ environment and confirm. Every step goes back, back discards nothing, and only the last step's action writes. Starting is still not on it (R1).

## Consequences

- `packages/eval` 843 → 850 tests; `tsc -b --noEmit` clean; the gate green.
- **Neither of the two data-plane additions the brief allowed was needed.** `EvalCellAttempt.history` already carries `{from, to, at}` per transition, so the timeline is computed from what the drawer is handed today; and the invariant sentence is copy, so it went to the dictionary. The projections are untouched by both milestones.
- `judgeTicket` became `judgeTask` and `judgeDraft` gained a ticket level — the store change that side-by-side grading needs. `openJudgeCell` → `openJudgeTask`, and `clearJudgeDraft(ticket)` replaces the blanket clear on submit.
- **15 more dictionary keys died** with the drawer and the one-cell bench (`drawer.title`, `drawer.refs`, `judge.cell`, `judge.submit`, `judge.filterTask`, …). Eight keys that were already unreferenced before T67 are still left alone.
- **Still not done, and recorded**: the score NUMBER in the run records and the grid (milestone one's note explains why it is not a client-side computation); artifact preview and download (both need a host file service); and the 绑定题库 button opening the datasets tab's own import form (no bind verb on eval's Remote, no cross-tab navigation from the host).

## Testing

`pnpm test` and `tsc -b --noEmit` in `packages/eval`, then `pnpm gate`. The new pure helpers are pinned directly: `timelineOf` for the four cases that matter (measured segments, the last state having no duration, an untimed transition breaking both sides, and no history being no timeline) and `byItem` for the grouping AND for never reordering inside an item, because the seeded order is part of the blind. The client specs assert the shapes rather than the old fields: the record panel's head / timeline / parameter table / named attachments, the bars' per-metric scaling (100% and 71% off the fixture's own numbers), the four hovers by invariant id, one item's answers side by side with per-column drafts and per-column buttons, and the wizard's four steps including that Back keeps what was typed.

## Alternatives considered

### Why not one shared scale across the three efficiency metrics?

Because the three are milliseconds, tokens generated and tokens read from a cache. A bar chart's whole claim is "these lengths are comparable", and across those units it is not true — the longest bar would just be whichever metric happens to have the largest raw magnitude, which for these three is always cache read. Scaling within each metric makes each group answer one honest question ("which group spent the most time?"), and the numbers beside the bars carry everything the picture cannot.

### Why does the bench pick an item rather than showing every cell at once?

A run is items × groups × reps, and a wall of every answer in the run would be the same data dump in a new shape — and it would also break the comparison the layout exists for, because answers to DIFFERENT questions have nothing to be read against each other. An item is the unit a rubric applies to, so it is the unit a grader holds one standard over. The reps of one group appear as their own columns too, which is correct: a rep is another independent answer to the same question and is scored on its own.

### Why keep one submit button per column instead of one for the whole item?

Because the write is per cell and always has been, and a single button would either send several `humanFinal` calls behind one click — with no sensible thing to say when the third of four is refused — or imply that the four verdicts are one act. They are not: a grader may be sure about two answers and want to look again at a third. Per-column buttons also make the disabled state legible: it says which answer still has no evidence.
