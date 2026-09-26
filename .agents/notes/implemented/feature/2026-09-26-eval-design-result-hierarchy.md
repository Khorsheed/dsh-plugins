# Agent Note: eval — the design and results pages ordered after interaction draft v5 (T80d)

Status: implemented

## Problem

The T79 walkthrough (P1-4, P1-5, P2-12, P2-13) found that the design and results pages already carried the information, but not in any order. The design page was a dozen blocks of equal weight. Its comparison table listed every field whether or not the groups differed on it. The readiness block repeated 准备环境, and its reminders did not say what they cost. On the results page, the conclusion, the validity audit, the export controls and the units all sat on one level. The card's answer only existed when the plan carried a question (T74), so a plan without one got a pair table instead of an answer.

## Decision

- **Design page order**: question → 对比组 → 用哪些题 → 怎么判 → scale and cost (one sentence) → 就绪. Only the question block and the stage bar are raised. The planned grid folds under 「计划网格 · N 次运行」.
- **Comparison columns come from the rows** (`compareColumns`, `packages/eval/src/client/ConditionsPage.tsx`):
  - A column shows when the declared rows disagree on it, or when it is the endpoint and some endpoint is unresolved.
  - When nothing differs, the table falls back to harness and model.
  - The footer names the shared fields. When more than one field differs it warns 「不同处：N 个（…），结论只能描述」, in the order `splitFactors` gives the factors.
  - The sha is hover-only. 「开跑时 / 当前」 appears only when home moved after the start.
- **用哪些题** has the columns 题 / 怎么判, and 怎么判 is written in full: 判官 / 人工终评 / 检查脚本. Without a plan review, 怎么判 still names the row's judges and omits the two layers it cannot know.
- **Reminders** say 「不影响启动」 plus one consequence sentence, keyed by code (`reminderConsequenceKey`, `journey.ts`). A code without a sentence shows none, never a raw key.
- **Report projection** gains two fields, each unit-tested (`report-face.spec.ts`):
  - `pair.verdict` — `ranked` / `tied` / `withheld`, read off the gates `comparePair` already walked.
  - `pair.coverage` — the coverage gaps folded to (group, why).
  - No algorithm changed.
- **Conclusion card**:
  - The answer is 暂时不能下结论 / A 优于 B / 未分高下 whether or not there is a question.
  - Each group gets one large score and the delta gets one sentence.
  - A withheld pair lists its reasons as plain-word items: ✗ blocks, ! cautions.
  - At most three next actions: 补判 (the first group with a coverage gap), 并排看作答, 让 agent 写分析初稿. The two agent actions go through the page's existing `handToAgent`: input box, else clipboard.
- **Folds**:
  - The validity checks and 「导出与来源」 (close-out, export, re-export, units) are folded. Their summary lines carry ✓ / ✗ and the export state.
  - The criteria table is grouped by dimension, shows a 未判 chip for missing values, orders its columns like the card, and folds the note on how to read it.
  - Efficiency keeps the bars and folds the detail table.

## Alternatives considered

- **Fill 考什么 / 满分 / 看题面 from the rubric or the dataset.** Rejected. `planReview` carries no per-item data for them, and guessing them would put a claim on the page that no file backs. The columns are hidden under the brief's 「缺数据的列不显示」, and the gap is reported to the coordinator.
- **Drive the highlight from `conditionDiff`.** Rejected. That diff needs a picked pair and reads the declarations, not the rows on screen. Computing from the rows means the highlighted cells are exactly the differences shown.
- **Derive the verdict in the browser from `rank` / `ciWithheld` / `n`.** Rejected. It would be a second copy of `comparePair`'s gates. The projection states it once, next to the gates.
- **A Remote verb for 补判.** Rejected. A re-judge is a run decision (R1), and a new write surface was out of scope. Handing a sentence to the agent reuses the path the readiness checklist already has.
- **Hide the validity checks when all pass.** Rejected. A fold with ✓ in its summary is still one click from the evidence, and T72's card promised that link.

## Consequences

- Test fixtures that build `EvalReportPair` by hand need `verdict` and `coverage`.
- An item id now appears twice on the design page (用哪些题 and the grid). Specs that queried it with `getByText` now count occurrences.
- If per-item topic, points or prompt ever reach `planReview`, 用哪些题 gains the columns without a layout change: they are data-gated, not removed.
