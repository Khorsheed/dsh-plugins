# Agent Note: One layer scores a criterion, not a cell

Status: implemented

English | [中文](2026-09-18-eval-report-per-criterion-merge.zh.md)

## Problem

The report scored a cell from ONE verdict layer: `primaryPass` walked `human-final` > `llm-draft` > `script`, took the first layer that held ANY verdict for the cell, and scored the whole cell from that one. Every criterion judged only by a lower layer dropped out.

The rule had a cost that was invisible at the moment it was paid. Measured on I5·T37: a judge answered four criteria on a cell, a person re-judged one of them at the bench, and the cell's score fell from 4 to 1. The other three criteria did not appear anywhere as excluded — no count, no note, no line in `results.jsonl`. The judge bench knew (it printed a warning naming `draftOnlyCriteria` before the button), which is the only reason anyone found out at all; the report itself said nothing.

Two things made this worse than a debatable convention:

- **The act that triggers it is the one the flow wants.** `human-final` is the only layer a person can write, and R1 makes the final verdict a person's act. Discouraging a partial human verdict is discouraging the thing the bench exists for.
- **A `kind: human` rubric leaf is normally ONE criterion.** The rubric splits criteria by who should judge them — `objective` to probes, `llm-draft` to judges, `human` to a person. So the intended path through the bench is exactly the path that dropped the judge's work.

## Decision

**Each criterion independently takes the most authoritative layer that judged IT** (`human-final` > `llm-draft` > `script`). A criterion a person re-judged scores on their word; one they did not still scores on the judge's; one no judge touched scores on the script's. One cell may therefore score from several layers at once — and the report must SAY which, everywhere the number appears.

- `primaryPass` returns the layer **per criterion** (`ns: Map<criterion, ns>`) plus `sources`, the cell's layer → criteria-count mix, in authority order so the JSON is stable. It also keeps `samples` (the verdicts the score was taken from) and `superseded` (the lower-layer verdicts the merge passed over) — «a person re-judged this» is only readable beside the judgement it replaced.
- Both call sites — the per-cell score and the defect list — take the layer from the criterion. `scoreOf` is unchanged: it already summed over `credit`, and `credit` is now the merged map.
- Every line of `report/results.jsonl` carries its own `ns` (unchanged) and the cell's `sources` (new), repeated per row exactly as `toolCalls` is.
- The judge bench's sentence changed with the rule, from «it drops your other criteria» to «it covers only what you answer; the rest stays the judge's». `draftOnlyCriteria` survives: the fact is still owed, it is simply no longer a cost.
- Consistency numbers: the multi-sample κ is untouched (it only ever looked at the judge layer). `llm-draft` vs `human-final` was already counted per criterion, and now SAYS so — the sentence states that the denominator holds only criteria both sides judged, and names how many human criteria no judge ever judged.

**A second projection ships with it**, because the merge made a question askable that the page could not answer. After reading the results page the user's words were: «I cannot see the per-dimension scores, nor what the judges based their verdicts on.» Every fact was already in the bundle and none of it crossed the wire. So there is now one **criteria × comparison-group** table per item: rows are criteria (id, the rubric's `axis` as the dimension, weight, polarity), columns are the groups, each cell is that criterion's conclusion there — with the layer it scored from in small print under it, which is precisely what the merge decides. Opening a cell gives the verdicts verbatim: evidence folded to one line, the judge's condition and model (the report is where the blind comes off), every sample, and the replaced judgement kept underneath its replacement.

Three properties hold it to the rest of the report:

- **The same gate.** `criteriaTables` is empty unless all four invariants hold, exactly as `comparisons` is. A refused comparison cannot be reopened one criterion at a time.
- **The same computation.** The bottom row is `scoreOf`'s own number, not this table's column sum, so the criteria table and the pair table cannot disagree about one item.
- **Not a comparison.** A single-group run gets the table too (one column): the grounds a judge gave do not depend on there being a second column to compare against.

There is no criterion TITLE, and that is not an omission. The derived weight table is built from the grading layer and deliberately carries ids, weights, polarity, kind and axis — never the criterion's text, which is the layer's own content and the reason an automatic export leaves that layer behind. `axis` is the honest label, and it happens to be the DIMENSION the question was asked along.

## Consequences

- **Historical reports move when recomputed.** Re-running `dsh-eval report` over a bundle with a partial human verdict raises its score. Old bundles are NOT migrated and no number already written is rewritten in place; re-exporting is what puts a run on the new rule, and the README says so.
- Measured before/after on a reconstruction of the T37 shape over a real gate-passing bundle (`run-20260918054718-8o0o`, judge on B2/D1–D4, script on X-no-patch, one human verdict added on D1): the item's score goes **0 → 3**, and the cell's mix reads `human-final 1 / llm-draft 4 / script 1`.
- Two real bundles with human verdicts recompute byte-identically apart from the new `sources` field and the denominator sentence — on both, the person had answered a superset of the judge's criteria, which is the case the old rule handled correctly.
- **The configuration guard comes first.** `primaryPass` still returns nothing at all for a cell whose reasoning effort was read back as something other than its condition declared (the frozen-configuration rule, `e5106df6`). The two rules answer different questions — per-criterion merging asks which LAYER answers for a criterion, the guard asks whether the cell answers for its condition at all — and merging must never turn an unattributable cell into a partially usable one. The criteria table carries the same filter `comparePair` does, redundantly on both (a mismatch violates the SUBJECT invariant, so the gate shuts first), so that softening the invariant later cannot make the two tables disagree.
- **A criteria cell is a door to its records** (T69): every sample carries the `missionId` it was written on, so a cell with one record behind it opens that record and one spanning several reps lands on the record list under its filter chip — the same two store actions the pair table's numbers use, never a third.
- The schema is untouched. `dataseek.verdict/1` still carries one criterion, one boolean, one evidence string; nothing about a verdict changed, only which verdicts the report reads.

## Alternatives considered

- **Keep the per-cell rule and warn harder.** This is what the bench already did, and T37 is what it bought: the warning was read, the person answered one criterion anyway (which is what the rubric asked of them), and three judged criteria vanished from the score. A rule that needs a warning in front of the only door into it is a rule that is wrong at the door.
- **Keep the per-cell rule and require a full human re-grade.** Honest, and rejected on cost: re-judging every criterion of a cell to fix one of them makes the bench a place people avoid, and the criteria a person would be re-typing are exactly the `objective` ones the rubric assigned to a probe. It also does not help a cell whose human verdict was written before the rule changed.
- **Merge per criterion but let a cell declare one source anyway** (majority of criteria, say). Cheaper to render and a lie in one word: a cell that scored three criteria on a judge's word and one on a person's is not «a judge's cell», and printing it as one is how the old rule's invisibility would come back through the label.
- **Compute the criteria table's bottom row as the table's own column sum.** It is the number a reader would check by hand, and it is linear in the per-criterion means — until a rep is missing a criterion, where the two denominators part ways. Taking `scoreOf`'s number keeps one computation behind both tables; the per-group rep count is printed so a ragged matrix is visible rather than silently averaged.
- **Show the criteria table whenever a bundle has verdicts, gate or no gate.** Rejected: a criterion-level table IS a comparison when it has two columns, and the four invariants exist to say when comparing is meaningless. The single-group case is the part that genuinely is not a comparison, and it is the part that ships ungated.
- **Ship the evidence as a flat list instead of an expandable table** (what `summary.md` had for negative criteria). Rejected for the page: the question is «which dimension moved», and a list of verdicts cannot be read as a grid. `summary.md` keeps both — the grid, and the evidence folded into a `<details>` underneath.
