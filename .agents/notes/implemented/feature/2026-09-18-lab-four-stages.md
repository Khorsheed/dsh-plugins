# Agent Note: four stages, one action each — the lab tab stops being a pile of correct labels

Status: implemented

English | [中文](2026-09-18-lab-four-stages.zh.md)

## Problem

T63 made the lab tab internally consistent and the user walked it. The verdict was that the problems were still substantial, and the examples were all the same shape: the overview and the plan review were very nearly the same definition list and neither had a button; the conditions page listed the whole repository beside a plan that used two of it; the matrix and the cells pages showed the same run twice, on two pages, so a reader had to remember one while looking at the other; an experiment's shape was an arithmetic expression (`4 × 2 × 2`) until a run turned it into a picture, by which time it could no longer be changed.

None of that is an execution failure. ui-spec §五 v1 fixed **what each of the seven sub-pages held** and never **what a person does on it**, so seven correct labels over seven piles of fields is exactly what it specified. §五 was rewritten to v2 — four stages, one primary action per stage, the glossary and the colour semantics §九 gained the same day — and this is the pass that implements it.

## Decision

**Four stages replace seven sub-pages**, and the merge is by the work rather than by the data: 实验设计 absorbs the overview, the plan review and the conditions page; 运行记录 absorbs the matrix and the cells page; 结果对比 and 人工评估 keep the report and the judge bench.

**A stage bar under the tab strip: the status, one sentence about it, and ONE action**, chosen by a table from the experiment's own status — draft → *validate it*, awaiting approval → *approve and start*, running → *see run records*, judging → *go to human review*, done → *see results*, refused → *check again*. Three of the six verbs move the reader; one re-reads; **批准并启动 is performed there**, because it is the human act (R1) and it belongs where the person is standing rather than behind a sub-page they have to find. It is disabled with its reason beside it while validate reports errors — a button that can only produce a refusal is worse than one that says why it is off — and the reason comes from the LIST row's own validate counts until the review walk lands, so it is never briefly enabled over a plan already rejected.

**Approving keeps the reader on 实验设计.** A readiness refusal is written in the job log on that page and NOWHERE else — the run never reaches `runCreate`, so the ledger holds nothing for it — and walking the reader to an empty grid would leave behind the reason they are about to look for. An approval made in this visit also outranks the list row's status for the bar: `runStart` answers before `runCreate`, so the row still reads 待批准 for a few seconds, and 批准并启动 offered over a run that is already going is the one mislabelled button here that could do real damage.

**One grid component, drawn twice.** Items down, comparison groups across. Before the run each seat says 计划 n 次; during it each seat carries the rep dots, the run state, the verdict where there is one, and the warnings. Two renderers over one table would drift; one table with two kinds of seat cannot. The planned grid is built from the plan review's digest (its item ids and group ids), which the design stage already reads.

**The comparison-group table is filtered to this experiment's subjects** — players and judges, with a 判官 chip on the judges' rows. A registry of every declaration in the repository, on a page about ONE comparison, is the data-dumping this pass removes; it also pushed the planned grid off the screen.

**The readiness badge replaces the readiness records.** One `✓ 环境就绪` chip when every subject passed, otherwise one red cross per subject with a count and a *check again*. The records stay, verbatim, under the fold beside it. Likewise the validate list now shows only the lines that need reading and folds the passing ones: a clean check is not news.

**The five run-record filters are applied in the browser over one read.** 「失败」 is not a bucket — `halted` is projected into `done`, because the cell IS finished — so a server-side bucket filter could answer three of the five and would have to fetch the whole run for the other two anyway, and the counts beside the chips would then be counting two different populations.

**The score column shows the verdict's SOURCE, not a number.** See *Alternatives considered*.

## Consequences

- `packages/eval` 834 → 843 tests; `tsc -b --noEmit` clean; the gate green.
- `MatrixPage.tsx` and `PlanReviewPage.tsx` are gone, their contents living in `Grid.tsx` (the shared grid, the arrangement disclosure, the summary band) and `DesignPage.tsx`. `CellsPage.tsx` became `RunsPage.tsx`; `ConditionsPage.tsx` now exports `ConditionsTable`, a section rather than a page.
- The design stage is the LANDING stage, so opening an experiment now costs the plan review and the conditions read. That is the same spend the old plan-review tab made, moved to the page that is actually about it; the list still costs neither.
- **25 dictionary keys died** with the pages that used them (the histograms, `overview.draftNotice`, `review.approve*`, `conditions.new*`, `cells.bucketAll`, …) and were removed rather than left as dead copy. Eight keys that were already unreferenced before this pass were left alone — they are not this task's cruft.
- The bucket and stage **histograms** on the old overview are gone with no replacement, and deliberately: the grid shows every cell's state directly and the summary band counts what is stuck and unreleased, so a histogram of the same states is a third view of one fact.
- **Not delivered**: the brief asks 未绑定题库时「绑定题库」按钮弹出题集 tab 的导入表单（同一个组件）. The button exists and what it opens is a sentence, not a form — it says which tab, which action, and what that action will ask for, with no command line. It cannot be the datasets tab's own form: eval's Remote has no bind verb, a client bundle never imports a sibling plugin (§八), and the host exposes no way for one `conversation.view` registration to select another. Closing it needs one of those two, and both are outside 「不扩数据面」.

## Testing

`pnpm test` and `tsc -b --noEmit` in `packages/eval`, then `pnpm gate`. The client specs were updated rather than relaxed, and three of the updates are themselves the claim: `MatrixCells` now asserts that the five filters narrow rows **with `fetchCells` called exactly once**; `LabReview` asserts the planned grid draws 8 seats over 4 items × 2 groups before anything runs, that the table omits a group this experiment does not use, and that approving **stays** on the design stage and turns the bar into *see run records*; `LabView` asserts the bar's sentence and that its button performs the act. `vocab.spec.ts` pins the verdict authority order and the `failed` ≠ `done` rule.

## Alternatives considered

### Why not put a real score in the run-record list and the grid?

Because there are two scores and only one of them is defensible. The cell projection carries how MANY verdicts each namespace holds and never their values; the number a reader compares is `report.ts`'s, computed from the **exported bundle** — polarity per criterion read from the rubric, one namespace per cell (the most authoritative with anything recorded), majority across samples, and a second weighted pass where the rubric carries weights. Recomputing that against the live ledger would be a second scoring implementation, and the failure mode is specific: the run records and the results page would report different numbers for the same cell, with no way for a reader to tell which one lied. The brief also names the two data-plane additions that were allowed and this is not one of them.

So the column shows what the projection honestly holds: which source this cell carries (终评 / 判官初判 / 脚本判定 / 未判), on the same authority order the report uses, with the hover saying where the numbers are. The grid gets the same fact for free — the run-records list is already loaded on that page, so the seats join it by `missionId` rather than asking for a new projection field.

### Why did neither of the two sanctioned data-plane additions turn out to be needed?

The brief allowed two: transition timestamps on the cell projection (for the timeline) and a "why this affects the comparison" sentence per invariant (for the hover). Reading the code first removed both. `EvalCellAttempt.history` already carries `{from, to, at}` per applied transition and `checkpoints` already carry their times, so the timeline is computable from what the drawer is handed today. And the invariant sentence is CONSTANT per invariant id (`materialization` / `fingerprint` / `subject` / `procedure`) — it is copy, not data, so it belongs in the dictionary where it can exist in both languages, which a host-side Chinese string could not. Both are milestone two's, and both are client-side.

### Why is the primary action a real action rather than a link to the page that holds it?

A bar whose button sometimes navigates and sometimes acts is two buttons wearing one label. Making it always navigate would have kept 批准并启动 as a word on a bar pointing at a button somewhere below — which is the arrangement the walkthrough complained about. Making it always act is not possible for 看运行记录. The resolution is that the VERB is the state's, not the bar's: three states want the reader somewhere else and two want something done, the table says which, and the label always names what will happen.
