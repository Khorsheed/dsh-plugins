# Agent Note: the experiment design page reads as "check this experiment before starting it" (T84)

Status: implemented

## Problem

The design page (`packages/eval/src/client/DesignPage.tsx`) is where a person approves an experiment an agent planned. The design walk-through `profiles/web-eval/docs/t84-design-inspect.md` collected five pieces of feedback on it:

- **Items.** 「用哪些题」 offered only 看题面. A reviewer could not see the stage prompts, the rubric, the probe scripts or the reference material the verdict rests on.
- **Judge prompt.** What the judge is shown could not be seen at all, before or after a run.
- **Readiness.** 「检查项」 said 「就绪」 per group and nothing about what had been checked.
- **Stages.** 「阶段 stage1, stage2」 sat in 高级设置, far from the items it limits.
- **Send-back.** 「让 agent 改…」 led nowhere.

The walk-through also found three defects:

- **Full score.** The full score counted criteria from stages the run does not execute. F2 showed 100 while stage3/4's 35 points could never be earned.
- **Recheck.** 「重新检查」 claimed to re-probe the groups. It only re-ran validate.
- **已退回 note.** The note never cleared when validate passed.

## Decision

The coordinator's rulings on the walk-through's open questions are part of this decision.

### Full score is the in-stage criteria only, everywhere

- **Where the filter lives.** `leafStages` / `inStageScope` (`weights.ts`) decide whether a rubric leaf belongs to a stage the plan runs. The same filter is used in three places:
  - the design page's full score, shown as `65 / 100` with a hover naming the dropped leaves;
  - report scoring and the exported weight table. `run.meta` records the plan's stages, and the report drops out-of-scope verdicts and says so. Bundles from before this change are scored over all criteria, with a note;
  - the judge. `judgedCriteria` (`judge.ts`) filters llm-draft leaves by the plan's stages, so a run sends the judge only in-scope criteria.
- **Binding a leaf to a stage.** A leaf binds to a stage through an explicit `stage(s)` field, `stageN.json` / `stageN.md` evidence, or `verify.json` → `runIn`. A plan without stages falls back to every criterion.
- **Why.** Before this, a leaf of a stage the run never executed was still sent to the judge and still counted in the denominator.

### Page order follows the check

Sections run in this order:

1. question;
2. 比什么;
3. 在哪些题上比, with the stage-scope line and a 本次阶段 column;
4. 怎么判;
5. 规模与花费, with the plan grid under 作答份数 and the per-cell budget / judge samples;
6. 准备好了没有;
7. 原始文件（核对用）.

**原始文件.** `plan.json` is shown in full, in the page, read-only. The author's note and the verbatim validate lines sit here too.

### Send-back

退回给 agent… opens a panel at the page head. It contains:

- suggestion chips built from the blockers;
- a free-text box.

**Where the draft goes.** By default the draft is pre-filled into the **current session's** composer. The session that drafted the plan is an optional switch. Delivery tries each step in turn until one takes it:

1. the drafting session, when it was picked;
2. this session;
3. the clipboard;
4. the text left on the page.

It never sends by itself.

**The 已退回 note.** It clears when the plan's sha changes or when validate passes. While it waits, the page re-reads the plan offline every 8 seconds.

### Item drawer (right side; the whole page at phone width)

**查看** on an item row opens a drawer with five tabs:

- 题面;
- 阶段说明;
- 判据;
- 检查脚本;
- 参考材料.

**Where the content comes from.** Everything is read at the commit the plan pins, through two Remotes:

- `itemMaterials` returns the file list per tab and the rubric rows with their stage scope;
- `datasetFile` reads one file, with the same size limit as `experimentArtifact`.

**Read path.** Reads go through `DatasetsFace.read`. Set-level files that face does not serve (`schemas/<stage>.json`) go through the optional `DatasetsFace.readPassthrough`. When the datasets package lacks it, those files show as unreadable and nothing fails.

**Order and scope marks.**

- Each tab opens on the file a reader wants first: `task.md` first, then the item's own files (markdown first) before set-level files.
- Rubric leaves outside the run's stages are greyed.
- Each tab states who reads it: the players, the judge, or neither.

### Judge prompt: view only (option A)

- **Before a run.** `judgePromptPreview` builds the prompt the judge would get for one item. It uses the same builder as a real run, with the in-scope criteria and placeholder materials. The prompt shows in 怎么判, split into its four parts: fixed text, 判据, 材料, 输出要求.
- **After a run.** `judgePrompt` returns the actual per-sample `prompt.md` the judge received. It is reached from 判定证据 in the answer view.
- **Not built: option B.** A plan-level "extra judge instructions" field is not built. It needs a plan-protocol revision, validation and freezing. The design doc keeps it as a follow-up.

### Readiness: 依据 per row, expandable, warnings attached to their row

`readinessTable` (`packages/eval/src/client/readiness-basis.ts`) turns the review into rows:

- the dataset;
- each group;
- each judge;
- the verdict sources.

**Row content.**

- Each row carries a one-line **依据** (for example 「声明=锁 · home 已登记 · 已准备」).
- Each row expands to every check with its evidence: declaration hash against the lock, home digest, provision record, judge model, stage schemas N/N.
- A judge on a player's model is marked **自评**.
- Before a start, each group's last line says the real probe happens automatically when the run starts.
- After a start, the real probe decides the state and leads the 依据. The expansion shows the observed model and the seconds, and a button to the probe's child session.

**Warnings.**

- A warning about a ready group, the dataset, or the verdict sources moves under that row, with its fix button.
- 提醒 keeps only the warnings no row owns.
- Blockers are unchanged (`splitReadiness`). A warning about an unready group stays a blocker.

**Numbering.** Lines are numbered in display order: row warnings, then blockers, then reminders. 「第 k 条」 in a send-back sentence names what the reader sees.

**Header.** The block header says whether the rows are an **offline file check (no tokens)** or a **real probe at the start**.

### Recheck is an offline re-validate, and says so

- **What it does.** 重新检查方案 re-reads `plan.json` and re-runs validate's offline checks. It does not re-run the readiness probe. The label, the hover text and the code comment all say this.
- **Why not re-probe.** The real probe sends one delegation per group and runs automatically at start. A button that silently spent a delegation per click would surprise the person approving. The wording was fixed instead of the behaviour.

## Alternatives considered

- **Judge prompt configuration now (option B).** Rejected for this round. It changes the plan protocol, validation, freezing and `judge.ts` together. Viewing the prompt (A) answers "what does the judge see" with no protocol change.
- **Full score unchanged, plus an explanatory note.** Rejected. Result pages would keep comparing scores whose denominators include points nobody could earn, and the judge would keep receiving out-of-scope criteria.
- **Inline item expansion (v5's 看题面).** Rejected. Five tabs of content do not fit inline. A right drawer keeps the item table readable, and it becomes the whole page at 400px.
- **Recheck re-runs the probe.** Rejected. It costs a delegation per group per click, and the start already probes. See the Decision.
- **Send-back defaults to the drafting session.** Rejected as the default. The lab tab already lives in a session, which is usually the same one. When it is not, the origin session is one click away.
- **Keep every warning in 提醒.** Rejected. A warning about one group, read far from that group's row, was the "看不出查了什么" complaint itself.

## Consequences

**Bought.**

- A reviewer can see:
  - every file the verdict rests on, at the pinned commit;
  - the judge's exact prompt, before and after a run;
  - what 「就绪」 means for each row.
- Scores are comparable across plans that run different stages.
- The judge no longer sees criteria for stages that were not run.

**Cost.**

- Four new Remotes: `itemMaterials`, `datasetFile`, `judgePromptPreview`, `judgePrompt`.
- An optional datasets face method, `readPassthrough`.
- A larger design page.
- Old and new results are not directly comparable. A run recorded with its stages is scored against the in-stage full score. A bundle from before this change keeps the all-criteria score, with a note.

**Verification.**

- Unit and client tests:
  - `tests/item-materials.spec.ts`;
  - `tests/inspect.client.spec.tsx`;
  - `tests/readiness-basis.spec.ts`;
  - the readiness cases in `tests/LabReview.client.spec.tsx`.
- Screenshots were taken per batch on a throwaway instance on the frozen baseline.
