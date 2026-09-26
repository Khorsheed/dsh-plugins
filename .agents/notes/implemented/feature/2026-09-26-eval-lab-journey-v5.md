# Agent Note: eval — the lab list, run records, human review and answer view brought to interaction draft v5 (T80c)

Status: implemented

## Problem

The T79 close-out walkthrough compared the lab's pages on a real instance with interaction draft v5 (`proposals/prototypes/eval-journey-redesign.html`). It found the same problem on four surfaces: each page showed what the ledger knows rather than what the person came to do.

- **List**
  - Every row carried the same two buttons, so nothing said what this experiment needs next.
  - Twenty-one legacy runs no experiment owns sat in 需要你处理 (needs you) with no way to clear them in one step.
  - A row could say 评估中 (judging) beside a progress of 0/1, because the status rule and the progress counter read two different sets of states (P1-3).
- **Run records**
  - A one-cell pilot rendered the grid, then the same cell again as a list.
  - The status word was 已释放 (released), a template-internal state.
  - The summary led with 未释放单元 (unreleased units) and 卡住的记录 (stuck records).
- **Human review**
  - The page opened on an empty 「先选一道题」 (pick an item) panel.
  - A block of dashes (the agreement numbers of a pilot) sat above the queue.
  - The judge-absent notice was a grey line.
  - A scoring hint showed raw `**` because it is rendered as plain text.
- **Answer view**
  - At 400px the second answer was a sliver at the right edge.
  - A side the judge never reached repeated 「这条判据未判」 (not judged on this criterion) once per criterion.

## Decision

### Status scope (P1-3)

- `JUDGED_OR_BEYOND` = {judged, halted, archived, releasable, released} lives in `packages/eval/src/cell-states.ts`, a module with no imports. The host and the browser bundle read the same file.
- `progress.done` counts exactly that set. The status rule already switches to 评估中 on that set, so 评估中 now always coincides with done = total.
- `eval_run_status` reports `progress` as well, so the agent quotes the same number the list shows.
- The run-records card says 「完成」 (done) for exactly that set (`recordPhrase` in `vocab.ts`).

### List (P1-1, P1-2)

- Each row is a card: the name, the question verbatim, the scale (题 × 组 × 次, items × groups × runs), and **one** primary button chosen by status.
  - The table is `ROW_ACTIONS` / `rowAction` in `client/journey.ts`: draft → 去校验 (validate), pending-approval → 去批准 (approve), stalled → 重跑 (re-run), judging → 去人工评估 (to human review), done → 看结论 (see the conclusion), refused → 看原因 (see why), running / cancelled / void → 看运行记录 (see the run records).
  - A stalled run with no experiment, or an archived one, falls back to 看运行记录: there is no plan to approve again.
- 归档 / 取消归档 (archive / unarchive) moves into a ⋯ menu on the card.
- 归档 N 条旧运行 (archive N legacy runs) appears in the 需要你处理 header when `legacyInAttention` finds any.
  - It opens an inline confirm that says the move only changes the grouping and can be undone.
  - It then archives the rows one by one and reports partial refusals.

### Stage shell (P2-1, P2-9, P2-11)

- Each stage tab carries a dot (`stageDots`). The state goes in `data-dot` and the tab's title; the dot itself is `aria-hidden`, so the tab's accessible name stays the stage name.
- The stage bar never offers a button to the page it is on. It says 「下面逐个落地」 (the steps are below) / 「逐份评完，再在页底选这次评估怎么结束」 (grade each answer, then choose how the review ends at the foot of the page) / 「对比就在下面」 (the comparison is below) instead.

### Run records (P1-7)

- At ≤ 12 cells (`CARDS_MAX`) the page is the cells as cards, with no grid and no list.
  - Each card shows the group, the status word (`recordPhrase` / `recordTone`), 题 · 第 N 次 (item · run N), and the elapsed time.
  - A click opens the stage timeline and 看作答 (see the answer) inline below the cards.
- Larger runs keep the grid, the filters and the list, and those use the same status word.
- The elapsed time is `attemptElapsedMs` (host side, `read.ts` → `EvalCellRow.elapsedMs`): from the attempt's first state to its first judged-or-beyond state, or to now while it is still moving.
- The run summary becomes 实验卫生 (run hygiene), a `<details>` whose summary line reads 「题面一致 · 环境一致 · 未释放单元 · 停滞」 (item text identical · environment identical · unreleased units · stalled).
  - It opens by itself when an invariant breaks, and stays folded otherwise.

### Human review (P1-6, P1-9)

- **Landing.** The page opens on `landingItem`: the first item with an ungraded answer, else the first item.
  - It lands once per visit and only when nothing (or a pick this run does not have) is selected.
  - After that the open item is the grader's choice, and a submission never moves the page.
- **Judge absence** is a reminder card (`role="note"`). It names the blind numbers, says the human verdict is recorded either way, and carries 「补判（可选）」 (re-judge, optional). It never blocks.
- **Agreement** (评分者一致性, grader agreement) sits under the four exits as a folded `<details>`.
  - Its summary line reads 「数据不足：…」 (not enough data) when there is no llm resample, cross-judge or human-vs-draft pair.
  - Otherwise the summary line carries the three agreement fractions, plus a warn chip for self-judged criteria.
- **Markup.** `judge.scoringMix`, `judge.regrade` and `record.scoreMixed` lose their `**` markup: all three render as plain text.

### Answer view (P1-10, P2-10)

- **Narrow panes.** Every grid cell carries `--col: <column index>`.
  - A container query on the view (< 700px) drops the grid to one track, and `order: var(--col)` regathers each column's parts under its own head.
  - It is a container query because the view sits in a session pane whose width is not the window's.
- **Unjudged sides.** A column with no judge or human verdict (source `script` or `none`) says so once, on its first unjudged criterion: 「只有脚本判定：判官没有判这份作答（N 条判据未判）」 (script checks only: no judge reached this answer, N criteria unjudged), or its `none` counterpart.
  - The line carries 补判 when the face passes `onRejudge`.
  - Its later unjudged rows are empty `data-quiet` cells, so the other columns' criteria stay level. They are hidden when stacked.
  - The human-review face hands the agent the blind number. The named door hands it the group and the run.

## Alternatives considered

**Mission's `done` bucket as the progress numerator.** This is the bucket the list already had. It leaves `halted` out, and a halted cell is finished as far as the orchestrator is concerned. That is exactly how 评估中 and 0/1 appeared together. Two sets that must agree are one set.

**Keeping the grid for small runs and hiding only the list.** For a pilot, a 1 × 1 grid is a dot that must be clicked before it says anything. The card carries the same click plus the word, the run number and the time. The threshold of twelve is the one the T79 walkthrough set (P1-7). Past it, a page of cards is longer than the grid, and the grid is the better overview.

**Showing `inStateMs` as the card's time.** It measures from the last transition, so a released cell reads «two days»: that is how long ago the run ended (W4). The elapsed time stops at the first finished state because the judge's turn, the archive and the release are not time the cell spent running.

**Renaming 未释放单元 / 卡住的记录 in place instead of folding them.** They are hygiene invariants. A person needs them only when one breaks, and then the fold opens by itself. In plainer words but still at the top, they would push the cards down on every visit to say that nothing is wrong.

**Auto-landing on every render (selection derived, not stored).** The next ungraded item would replace the one on screen the moment a grader submitted the last answer of the current item, while they were still reading it. A one-shot landing gives the same first screen without taking the page away later.

**Rendering `judge.scoringMix` through MarkdownDoc.** The brief allowed either fix. The emphasis added nothing the sentence does not already say, and three plain-text strings would each need a markdown renderer only for one bold span. Removing the markup fixes all three in place.

**A media query for the stacked answer view.** The view sits in a session pane. On a wide window with a narrow pane, a media query would keep side-by-side columns in a 400px pane, which is the bug.

**Spanning the script-only summary across its column's criterion rows (`grid-row: span N`).** Auto-placement fills that correctly only when the unjudged rows are contiguous. A script verdict on a middle criterion breaks the run, and the span would then push other columns' cells out of level. Empty quiet cells cost nothing and never misplace.

## Consequences

- One status word per state across the list, the run-records card, the grid dot and the agent's `eval_run_status`. Changing what counts as finished is a one-line edit in `cell-states.ts`, and it moves all four.
- A pilot's run-records page is now a few cards and one folded line, and the grid only appears when it helps.
- The human-review first screen is the grading form. The agreement numbers are one click away at the foot of the page, and 「数据不足」 replaces a table of dashes.
- The answer view reads top-to-bottom in a narrow pane. The price is `!important` on `grid-template-columns`, overriding the inline column count, and every cell carrying a style attribute.
- 补判 is still a sentence handed to the agent, not a verb. There is no re-judge tool, and the page learns nothing about which groups the blind numbers are.

## Testing

- `packages/eval/tests/cell-states.spec.ts`: the shared set and `attemptElapsedMs`.
- `tests/journey.spec.ts`: `rowAction`, `legacyInAttention` and `stageDots`.
- `tests/LabView.client.spec.tsx`:
  - the card rows and their single button;
  - the ⋯ menu and the bulk archive confirm;
  - the stage bar on its own page;
  - the tab dots.
- `tests/MatrixCells.client.spec.tsx`: the compact card mode and the hygiene fold (open when an invariant is violated, folded otherwise).
- `tests/Judging.client.spec.tsx`:
  - landing and `landingItem`;
  - the absence card;
  - the agreement fold's position and its 数据不足 summary.
- `tests/AnswerView.client.spec.tsx`: the script-only summary with 补判 and level rows, and `--col` on every cell.

## Related

- [The lab's four-stage journey and conclusion-first results (T72)](2026-09-23-eval-lab-journey.md) — the stage shell and list groups this note refines.
