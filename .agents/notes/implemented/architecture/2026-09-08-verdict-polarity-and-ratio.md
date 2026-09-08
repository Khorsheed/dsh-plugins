# Agent Note: criterion polarity lives in the rubric, partial credit lives in the verdict

Status: implemented

[中文](2026-09-08-verdict-polarity-and-ratio.zh.md)

## Problem

`dataseek.verdict/1` carries exactly one boolean, `pass`, and it means **the criterion holds** — the same thing the criterion's own wording says. That is right, and it is also why the report was wrong.

A rubric's negative criteria word a DEFECT: F2's `A-N2` is «the tradeoff says worth-the-cost — the brief already said the host must not change», F3's `A-N1` is «the design pushes protocol knowledge onto the user». A verdict of `pass: true` on one of those is the defect being observed. The report's main axis was «passed criteria», so observing a defect made a cell score one point HIGHER. Pilot A worked around it the only way an operator could: it left every negative criterion out of the human-final pass entirely, discarding a real observation (F2 × codex × rep2 did put `worth-the-cost` in a tradeoff).

The escape hatch — weighted scoring, where a negative weight subtracts — was unavailable in practice. Rubrics live in the `grading` layer, a run's automatic export includes the visible layer only (correctly: the leak gate exists because the grading layer is the answers), and the report's weight reader looked in the bundle's dataset layers. So `weightsAvailable` was structurally false on every self-contained bundle, and the reader only understood JSON while every real rubric is YAML.

A third, smaller gap rode along. Some criteria are not binary at all: F2/F3's `C1` and `C2` say «scored proportionally» in the rubric. Probes had no field for that, so T19 put the proportion in an `evidence` prefix (`通过 6/9 …`) as a stopgap. That makes every consumer parse prose, and the parsing breaks silently the first time the prose is reworded.

## Decision

**Polarity is data, and its single source is the rubric leaf.** `negative: true` states it; a negative `weight` states the same thing (making the two agree is `validate`'s job, T26). The verdict contract gains no polarity field, probes and judges never invert, and the report does the arithmetic. Three reasons, recorded in protocol §6.5:

- Verdict sources do not interpret. A probe and a judge answer one checkable question; letting them invert would bury the scoring policy in two independent, replaceable implementations, and the same criterion would come back with opposite `pass` values from each, both sides honestly reporting.
- A verdict is a record, not a score. An added `negative` / `score` / `polarity` field gives one fact two statements, and annotations are append-only — change the scoring rule once and every historical verdict is void.
- Polarity is the dataset author's editorial call, frozen with the run's commit, so every historical verdict can still recover the polarity it was judged under.

**The export derives a weight table into the bundle.** After `exportRun`, the run reads each task's grading-layer rubric with an explicit single-layer scope and writes `<bundle>/report/rubric-weights.json` (`dataseek.rubric-weights/1`): `{task, id, weight, negative, kind, axis}` per leaf. Identifiers and numbers only — no criterion text, no evidence pointer, no note — which is exactly why it needs no leak gate while the layer it came from does. The rubric itself and the executable probes still stay out of the bundle. Deriving is best-effort: a task whose grading layer cannot be listed or read is logged and skipped, a run never fails over its weight table, and a table with no rows is not written at all (an empty file would claim the polarity is known and every criterion positive).

**The report's main axis is the SCORED criterion count.** A positive criterion scores its credit, a negative one scores what is left of it; the weighted score is Σ `weight` × credit, so a negative weight subtracts with no second rule. `summary.md` gains a «negative criteria that held» table — which cell, which criterion, what proportion, what evidence — because that defect list, not the count, is what a reader comes for. The report prefers the derived table and falls back to a rubric inside the bundle's dataset layers (a deliberately guarded export); that fallback now reads YAML, which is what a real rubric is. With neither present the behaviour is unchanged (counts only) but the report says so: «极性未知，计数按正向处理», with the negative-criterion count reported as unknown. "Cannot tell" is never rendered as "no defects".

**Partial credit is a field.** `dataseek.verdict/1` gains an optional `ratio: {passed, total}`; `additionalProperties` stays `false` and the property is declared, so the field is allowed and nothing else is. `ratio` REFINES `pass` rather than replacing it — `pass` still means the criterion fully holds (`passed === total` for a proportional one), so a consumer that ignores `ratio` degrades to the strict boolean and can only under-count, never over-count. Credit is `passed / total` (a negative criterion earns the remainder), and the weighted score multiplies the same fraction. The proportion travels in the field alone: §6.5 and §6.7 now say plainly that a verdict source must not encode it in an `evidence` prefix, which retires T19's stopgap (the probes themselves change in T19b). `total` is the denominator the verdict source actually judged, dilution guarding included, so the report never re-derives it.

The schema subset the validator supports has no numeric bounds, so the report checks them: `total > 0`, `0 ≤ passed ≤ total`, both integers. A ratio that fails is treated as absent — the verdict falls back to its boolean — and counted in the summary notes. Bad data must not quietly become a score.

Multi-sample aggregation keeps the established rule and extends it: booleans are still the majority across samples, and a proportional criterion is the mean of the proportions its samples actually declared (samples without a usable ratio are not averaged in). With no `ratio` anywhere the arithmetic is bit-for-bit the boolean one it generalizes.

Protocol version moves to **v1-rev4**. §6.5 gains the polarity rules, the `ratio` rules, and the derived table's shape; the verdict schema block gains `ratio` verbatim from `packages/eval/src/schema.ts`, and §6.5 now publishes two verdict examples (boolean and proportional), each pinned to its own fixture.

## Alternatives considered

- **Add `negative` (or a signed `score`) to `dataseek.verdict/1`.** Rejected: it duplicates a fact the rubric already owns, in an append-only record, and lets two verdicts of the same criterion disagree about what the criterion is.
- **Let probes and judges invert the boolean for negative criteria.** Rejected for the same reason T19 rejected it: `pass` would stop meaning what the criterion says, and the two independent implementations would drift.
- **Include the grading layer in the run's export so the report can read the real rubric.** Rejected: that is the leak gate, and it exists because the grading layer is the answers. Deriving numbers is the narrow thing actually needed.
- **Write the derived table into the bundle's `dataset/` tree.** Rejected: `dataset/` is a copy of dataset layers and its content hashes are recorded in the manifest; the derived table is report input, so it lives beside the report. `writeEvalReport` overwrites `results.jsonl` and `summary.md` only and never touches it.
- **Keep the proportion in `evidence` and parse it.** Rejected — that was the stopgap being retired. A report that regex-matches its inputs' prose is a report that breaks on a reworded sentence and says nothing.
- **Let `ratio` replace `pass` (drop `pass` for proportional criteria).** Rejected: `pass` is required by the contract and every existing consumer reads it. Refining it keeps old readers correct-but-conservative instead of wrong.
- **Treat a negative criterion's partial hit as no hit.** Rejected: one occurrence of a defect is an observation. A proportional negative criterion enters the defect list as soon as any of it holds, with the proportion printed beside it.

## Consequences

- The report's per-task columns are now «得分» rather than «通过», and the weighted columns appear whenever the bundle carries the table. On the pilot-a-round1 copy with the table added and the dropped observation restored as a human-final verdict, F2 × codex × rep2 moves from 18 «passed» to 17 scored with a weighted score of 35 — the `A-N2` weight of −2 deducted, not added — and `A-N2` appears in the defect table with its evidence.
- That copy's summary still refuses the paired comparison: pilot A records no environment fingerprint, so the 环境一致 invariant is unverifiable and the honesty gate holds. The weighted columns live inside the comparison section, so they stay absent there by design; the per-cell arithmetic above is what changed.
- `results.jsonl` rows gain `ratio?` and `negative?`. Both are present only when known — `negative` distinguishes "positive" from "polarity unknown" rather than collapsing them.
- Bundles exported before this change carry no table. They report exactly as before, plus one note saying the polarity is unknown; nothing about them is retroactively reinterpreted.
- `validate` does not yet reject a rubric whose `negative: true` disagrees with its `weight` sign, nor a verdict whose `pass` disagrees with `passed === total`. Both are rubric/contract enforcement and belong to T26; until then the report is deliberately tolerant (either statement of polarity is accepted) and says what it assumed.
- T19's probes still write the proportion as an `evidence` prefix — `verify-results.mjs`'s `rollUp()` returns `{pass, evidence}` with `通过 N/M` in front, and `probe-kit.mjs`'s `out.add(criterion, pass, evidence)` has nowhere else to put it. Those two are the seam T19b changes; the report ignores the prefix from now on, so until T19b lands `C1` / `C2` score as the strict boolean they already declare (`pass` is true only when every standard in the denominator passed, which is exactly the convention §6.5 now writes down). Dilution guarding stays where it is: `applySkippedStandards` already removes excluded standards before the denominator, which is the `total` the field wants.
- The derived table omits `veto`. The one-vote-veto criterion (`X-no-patch`) therefore reads as a 0-weight positive criterion in the table; veto handling is not part of this scoring axis and no consumer reads it yet.
- The harness-comparison dataset needed no rubric edits: every leaf in F2, F3 and P0 already carries `id` / `axis` / `weight` / `kind`, every negative weight already carries `negative: true`, and no `negative: true` lacks one.
