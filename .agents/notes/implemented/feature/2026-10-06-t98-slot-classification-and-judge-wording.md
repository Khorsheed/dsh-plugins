# Agent Note: datasets — prompt-layer classification, probe-gap wording, and localized judgeability notes

Status: implemented

## Problem

Looking at HumanEval as T96 organized it (`items/he-000/{prompt/prompt.py, verify/test.py, grading/canonical_solution.py}`, layers `prompt` (modelFacing), `verify`, `grading`), the user asked whether `prompt.py` was meant to be "other files" or the task statement. Three defects on the item page:

- `slotOfPath` in `packages/datasets/src/slots.ts` only knew `task.md` and the plural `prompts/` directory. In the convention layout the display path omits the layer name, so `prompt.py` in the `prompt` layer matched no rule and fell back to `slotOfRole('player')` = `other`. The tree said "other files · the player sees it", and the task-statement filter dropped it. `canonical_solution.py` hit the same gap one role over: it fell back to the grading layer's default, the rubric, when it is the reference answer.
- The "only judges and probes see" box listed `verify/test.py` and then said "no check scripts" (`detail.noProbes`). The real meaning was "no executable probe definition": `test.py` is check material that was never wired up as a probe. As written, the box contradicted itself.
- The judgeability notes came from `src/brief.ts` as English sentences, so a Chinese page showed "this item ships no rubric in its grading layer…" verbatim.

## Decision

### Classification: role-bound rules between the path rules and the fallback

`classifyFile` now resolves the slot in three steps: `slotOfPath` (unchanged), then a new `slotOfRolePath(role, layer, displayPath)`, then `slotOfRole`. The new step holds rules that only make sense together with who sees the file:

- **player-visible → 题干 (task statement)**: the layer is in `PROMPT_LAYERS` (`prompt` / `prompts` / `task`), or a register directory segment is (so the register form `prompt/prompt.py` agrees with the convention form), or the basename starts with `prompt` or `problem_statement` (SWE-bench's field name);
- **judge-only → 参考答案 (reference answer)**: the basename starts with `canonical_solution`, `solution`, `answer`, `gold` or `patch`. These are the answer keys that HumanEval, MMLU and SWE-bench organize into.

Neither rule fires in the other role. A `prompt_for_judge.md` in the grading layer is not a task statement, a `prompt`-named layer the player never sees is not one, and a `solution.py` handed to the player is a starter file. Path rules still win: an `oracle/` segment inside a prompt layer is still the answer key. The function stays dependency-free in `slots.ts`, so the browser tree, the slot filter and the host's `slotLayerMap` keep computing the same answer from the same code.

**A player-visible file that no rule names still falls back to 其他文件 (other files), not 题干.** A visible layer is not only the question. SWE-bench hands the player a repository snapshot, and other sets ship fixtures or data files. Defaulting all of that to 题干 would bury the actual prompt under hundreds of source files and make the task-statement filter useless. The layer-name rule already covers the common case, since organized sets put the question in a `prompt` or `task` layer. A wrong "other" costs a reader one glance. A wrong 题干 tells them that code is the question.

`tests/slots.spec.ts` pins one minimal fixture per layout: HumanEval (`prompt/prompt.py`, `grading/canonical_solution.py`, `verify/test.py`), MMLU (`task/question.md`, `grading/answer.txt`) and SWE-bench Lite (`problem_statement.md`, a `repo` layer that stays other, `grading/patch.diff`, `verify/test_patch.diff`). It also pins the register-form agreement, both role guards, and path-rule precedence. The fixtures are (layer, path) pairs. No benchmark data is copied.

### Two probe gaps, two sentences

When `probes + sharedProbes` is empty, the judge-only box now checks whether any file it lists sits in the `verify` layer:

- **material, no probe** (`detail.probesNotWired`): 「有检查材料，但没接成可执行的探针：跑实验时不会自动判分」 / "Check material is here, but no executable probe is wired up: runs will not be scored automatically". Its hover (`detail.probesNotWiredHint`) explains what a probe is (a `.mjs` or `.sh` under `probes/` in the verify layer, executed in the unit) and says that until the material is wired up, only the rubric can score the item;
- **nothing** (`detail.noProbes`): unchanged, 「没有检查脚本」 / "no check scripts".

### Judgeability notes travel as codes

`Judgeability.notes` changes from `string[]` to `JudgeNote[]` = `{ code, params, text }`:

| code | params | zh | en |
|---|---|---|---|
| `no-rubric` | `layer` | 这道题的 {layer} 层里没有评估标准（rubric），LLM 判官和人工评审都无从打分 | This item ships no rubric in its {layer} layer, so no LLM judge or human verdict has anything to score |
| `no-grading-layer` | `layer` | 这个题集没有声明 {layer} 层，判分约定（协议 §6.8）对它不适用 | This dataset declares no {layer} layer, so judging conventions (protocol §6.8) do not apply to it |
| `rubric-invalid` | `path`, `detail` | 评估标准没通过检查：{detail} | The rubric does not pass its check: {detail} |
| `rubric-unreadable` | `path`, `detail` | 读不到评估标准 {path}：{detail} | Could not read the rubric {path}: {detail} |

The browser translates by code (`judgeNote.<code>`). A code the build does not know falls back to `text`, the English sentence the host has always produced. This mirrors the review page's existing `findingText` (code + params, English message as fallback). Only the client consumes `Judgeability`, and both halves ship in one tarball, so the field changes shape instead of growing a parallel one.

### Untranslated notes still on screen (inventory, not fixed here)

- **`rubric-invalid`'s `detail`**: `checkRubric`'s rule messages (`src/rubric.ts`) stay English inside the translated frame. They are the validate vocabulary, which is also shown raw on:
- **the validate detail lines** on the set page (`DatasetsView.tsx`, `validatedRow.errors[].message`, with the code in the title). The descriptor/rubric/hygiene rules in `dataset.ts` / `rubric.ts` are a large message surface. Localizing them means giving every rule params, the way `proposal.ts` problems already have them.
- **the answer-record notes** on the item page (`DatasetDetail.tsx`, `runs.notes`). These come from eval's `runsForItem` (`packages/eval/src/design/experiments.ts`): "no mission service: …", plus the ledger-listing failures.
- **eval's own notes**, shown verbatim in its client: experiment list notes (`LabView.tsx`, from `listExperiments`: unreadable plan.json, mission cannot list runs, no state root), `AnswerView.tsx`, `JudgingPage.tsx`, `DesignPage.tsx` (`facts.notes`) and `Inspect.tsx`. These belong to the eval package and were left untouched.
- Raw Remote error messages are not on this list: `ErrorState` already classifies them and folds the raw text under 「详情」. Proposal `reason` fields are agent-authored content, not system copy.

## Alternatives considered

**Fall back to 题干 for every unnamed player-visible file.** This was rejected for the SWE-bench reason above. The fallback would be right for HumanEval and badly wrong for any set that hands the player a workspace, and the layer-name rule already covers the HumanEval/MMLU shapes without it.

**Fold the new rules into `slotOfPath`.** `slotOfPath` sees only the display path. In the convention layout that path never contains the layer name, which is the very reason `prompt.py` was missed. Making the basename rules role-free would also call a judge's `prompt_*.md` a task statement. A separate role-aware step keeps `slotOfPath`'s contract ("the path alone") honest.

**Add a slot field to `dataset.json`.** That still costs a descriptor format fork for a display label, the same verdict `slots.ts` already records. Per-dataset slot names remain deferred.

**Translate the notes on the host from a locale passed with the request.** This was rejected. The host does not otherwise know the viewer's language, the same projection can be cached and shared, and the CLI wants English. Codes keep the wire language-neutral and match the review page's pattern.

**Keep `notes: string[]` and add a parallel `noteCodes`.** That would leave two lists to keep in step, for a type only this package's own client reads.

**Wire `verify/test.py` up as a probe.** This is out of scope by ruling (2026-10-03: no scoring yet). It belongs to the scoring stage's SKILL change. The new wording names that gap instead of hiding it.

## Consequences

- HumanEval-, MMLU- and SWE-bench-shaped sets now read correctly in the tree, the 题干 filter and the list page's slot ← layer cell. A visible file outside the new rules is still "other". That is deliberate, and a reader may occasionally have to look twice.
- The judge-role oracle rule is a basename guess. A grading-layer file named `answers_rubric_notes.md` would be called the reference answer. The path rules (`rubric*`, `standards-notes*`, `oracle/`) run first, which narrows this.
- `Judgeability.notes` changed shape. A browser half that expects strings would print `[object Object]`. Both halves ship in one tarball, so this only matters for a hand-mixed install.
- The validate vocabulary and eval's notes remain English (inventory above). They are the next candidates if the page is to be fully bilingual.
- Verified on a throwaway 0.2.0-rc.2 instance with a three-item HumanEval-shaped set: the tree marks `prompt.py` 题干 · 选手看得到, `canonical_solution.py` 参考答案 · 只有判官 and `test.py` 检查脚本 · 只有探针. The judge box shows the material-without-probe sentence, and the no-rubric note reads in Chinese.
