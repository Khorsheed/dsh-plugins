# Agent Note: datasets——题干层归类、探针缺口措辞与可判性说明本地化

Status: implemented

## Problem

用户在看 T96 整理出的 HumanEval（`items/he-000/{prompt/prompt.py, verify/test.py, grading/canonical_solution.py}`，层为 `prompt`（modelFacing）、`verify`、`grading`）时问：`prompt.py` 是故意归成「其他文件」，还是应该算题干？题目详情页上有三处毛病：

- `packages/datasets/src/slots.ts` 里的 `slotOfPath` 只认 `task.md` 和复数的 `prompts/` 目录。约定布局下，显示路径不带层名，所以 `prompt` 层里的 `prompt.py` 一条规则都对不上，回落到 `slotOfRole('player')` = `other`。结果文件树写着「其他文件 · 选手看得到」，题干过滤也把它漏掉了。`canonical_solution.py` 在另一个角色上撞了同一个缺口：它是参考答案，却回落成了 grading 层的默认归类「评估标准」。
- 「只有判官和探针看得到」那一栏列出了 `verify/test.py`，紧接着又说「没有检查脚本」（`detail.noProbes`）。实际意思是「没有可执行的探针定义」：`test.py` 是检查材料，只是没接成探针。现在这样写，这一栏自相矛盾。
- 可判性说明由 `src/brief.ts` 生成英文句子，中文页面上原样显示「this item ships no rubric in its grading layer…」。

## Decision

### 归类：在路径规则和角色回落之间加一层按角色的规则

`classifyFile` 现在分三步决定 slot：先走 `slotOfPath`（不变），再走新增的 `slotOfRolePath(role, layer, displayPath)`，最后才是 `slotOfRole`。新增这一步收的规则都要结合「谁看得到这个文件」才成立：

- **选手看得到 → 题干**：层名在 `PROMPT_LAYERS`（`prompt` / `prompts` / `task`）里；或者某一级目录名在里面（这样登记布局的 `prompt/prompt.py` 和约定布局结果一致）；或者文件名以 `prompt` 或 `problem_statement`（SWE-bench 的字段名）开头。
- **只有判官看得到 → 参考答案**：文件名以 `canonical_solution`、`solution`、`answer`、`gold`、`patch` 开头。HumanEval、MMLU、SWE-bench 整理后的答案文件就叫这些名字。

两条规则都不跨角色生效。grading 层里的 `prompt_for_judge.md` 不是题干；选手看不到的 `prompt` 层也不是题干；发给选手的 `solution.py` 是起始文件，不是答案。路径规则仍然优先：题干层里的 `oracle/` 目录照样算参考答案。这个函数继续放在 `slots.ts` 里，不引入依赖，浏览器文件树、slot 过滤和宿主侧的 `slotLayerMap` 仍然调用同一份代码，得出同一个结果。

**选手看得到、但任何规则都没点名的文件，仍回落到「其他文件」，不改成题干。** 可见层里不只有题目：SWE-bench 给选手的是整份仓库快照，别的题集也会带夹具和数据文件。全都默认成题干，真正的题目会被几百个源码文件淹没，题干过滤也就没用了。常见情形已经由层名规则覆盖，因为整理过的题集都会把题目放进 `prompt` 或 `task` 层。错标成「其他」，读者多看一眼就行；错标成题干，等于告诉读者这堆代码就是题目。

`tests/slots.spec.ts` 为每种布局各钉一组最小夹具：

- HumanEval：`prompt/prompt.py`、`grading/canonical_solution.py`、`verify/test.py`；
- MMLU：`task/question.md`、`grading/answer.txt`；
- SWE-bench Lite：`problem_statement.md`、仍算「其他」的 `repo` 层、`grading/patch.diff`、`verify/test_patch.diff`。

另外还钉住了登记布局与约定布局一致、两条角色限制，以及路径规则优先。夹具只是 (layer, path) 对，没有复制任何基准数据。

### 两种探针缺口，两句话

`probes + sharedProbes` 为空时，「只有判官和探针看得到」这一栏会看它列出的文件里有没有 `verify` 层的：

- **有材料、没探针**（`detail.probesNotWired`）：「有检查材料，但没接成可执行的探针：跑实验时不会自动判分」/ "Check material is here, but no executable probe is wired up: runs will not be scored automatically"。悬停提示（`detail.probesNotWiredHint`）说明什么是探针（verify 层 `probes/` 下的 `.mjs` 或 `.sh`，实验在单元里执行它），并说明材料没接上之前，这道题只能靠评估标准打分。
- **什么都没有**（`detail.noProbes`）：不变，「没有检查脚本」/ "no check scripts"。

### 可判性说明改为带 code 传输

`Judgeability.notes` 从 `string[]` 改成 `JudgeNote[]`，即 `{ code, params, text }`：

| code | params | 中文 | 英文 |
|---|---|---|---|
| `no-rubric` | `layer` | 这道题的 {layer} 层里没有评估标准（rubric），LLM 判官和人工评审都无从打分 | This item ships no rubric in its {layer} layer, so no LLM judge or human verdict has anything to score |
| `no-grading-layer` | `layer` | 这个题集没有声明 {layer} 层，判分约定（协议 §6.8）对它不适用 | This dataset declares no {layer} layer, so judging conventions (protocol §6.8) do not apply to it |
| `rubric-invalid` | `path`、`detail` | 评估标准没通过检查：{detail} | The rubric does not pass its check: {detail} |
| `rubric-unreadable` | `path`、`detail` | 读不到评估标准 {path}：{detail} | Could not read the rubric {path}: {detail} |

浏览器按 code（`judgeNote.<code>`）翻译。遇到当前版本不认识的 code，就显示 `text`，也就是宿主一直以来生成的那句英文。这和评审页已有的 `findingText` 一个路子（code 加 params，英文 message 兜底）。`Judgeability` 只有本包自己的客户端在读，前后两半又在同一个 tarball 里发布，所以直接改字段形状，不另开一个平行字段。

### 屏幕上仍未翻译的说明（只列清单，本次不改）

- **`rubric-invalid` 的 `detail`**：`checkRubric` 的规则信息（`src/rubric.ts`）仍是英文，嵌在已翻译的外框句里。它属于 validate 的那套措辞，下面这处也原样显示它：
- **题集页的 validate 明细**（`DatasetsView.tsx`，`validatedRow.errors[].message`，code 放在 title 里）。`dataset.ts` / `rubric.ts` 里的描述符、评估标准、卫生规则合起来是很大一片文案。要本地化，就得像 `proposal.ts` 的 problem 那样给每条规则配 params。
- **题目页的作答记录说明**（`DatasetDetail.tsx`，`runs.notes`）。它来自 eval 的 `runsForItem`（`packages/eval/src/design/experiments.ts`）：「no mission service: …」，以及读取账本失败时的说明。
- **eval 自己的说明**，在 eval 客户端里原样显示：
  - 实验列表说明（`LabView.tsx`，来自 `listExperiments`：plan.json 读不了、mission 列不出 run、没有 state 根目录）；
  - `AnswerView.tsx`、`JudgingPage.tsx`、`DesignPage.tsx`（`facts.notes`）和 `Inspect.tsx`。

  这些归 eval 包，本次没动。
- 宿主 Remote 的原始报错不在这份清单里：`ErrorState` 已经对它们分了类，原文折叠在「详情」里。proposal 的 `reason` 字段是 agent 写的内容，不是系统文案。

## Alternatives considered

**所有没被点名的、选手看得到的文件都回落成题干。** 没采用，原因就是上面说的 SWE-bench。这样做对 HumanEval 是对的，可对任何给选手一个工作区的题集都错得很离谱；而 HumanEval、MMLU 这类布局，层名规则已经覆盖了，用不着它。

**把新规则并进 `slotOfPath`。** `slotOfPath` 只看显示路径。约定布局下这条路径从来不带层名，这正是 `prompt.py` 被漏掉的原因。而且文件名规则一旦不分角色，判官的 `prompt_*.md` 也会被当成题干。单独加一个看角色的步骤，`slotOfPath` 才能继续守住「只看路径」这条约定。

**在 `dataset.json` 里加一个 slot 字段。** 为了一个显示标签分叉描述符格式，代价还是太大，和 `slots.ts` 里已经记下的结论一样。每个题集自定 slot 名的事继续往后放。

**请求时带上语言，由宿主翻译说明。** 没采用。宿主平时并不知道看页面的人用什么语言；同一份投影可以缓存、可以共享；CLI 也需要英文。用 code 传输，线上数据保持语言中立，也和评审页的做法一致。

**保留 `notes: string[]`，另加一个平行的 `noteCodes`。** 那样就有两份列表要保持同步，而这个类型只有本包自己的客户端在读。

**把 `verify/test.py` 接成探针。** 按 2026-10-03 的决定（先不跑分）不在本次范围内，那是判分阶段改 SKILL 的事。新措辞把这个缺口直接说出来，而不是掩盖它。

## Consequences

- HumanEval、MMLU、SWE-bench 形状的题集，现在在文件树、题干过滤和列表页的 slot ← 层那一格里都显示正确。新规则之外的可见文件仍算「其他」。这是有意的，读者偶尔需要多看一眼。
- 判官角色的参考答案规则只是按文件名猜。grading 层里一个叫 `answers_rubric_notes.md` 的文件会被当成参考答案。好在路径规则（`rubric*`、`standards-notes*`、`oracle/`）先跑，误判的范围因此收窄了。
- `Judgeability.notes` 改了形状，还按字符串读的浏览器端会显示 `[object Object]`。前后两半同在一个 tarball 里，只有手工混装时才会遇到。
- validate 的措辞和 eval 的说明仍是英文（见上面的清单）。要让页面完全双语，它们是下一批要改的。
- 在一台一次性的 0.2.0-rc.2 实例上，用一个三道题的 HumanEval 形状题集验证过：
  - 文件树把 `prompt.py` 标为「题干 · 选手看得到」，`canonical_solution.py` 标为「参考答案 · 只有判官」，`test.py` 标为「检查脚本 · 只有探针」；
  - 「只有判官和探针看得到」那一栏显示「有检查材料、没接成探针」那句话；
  - 「没有评估标准」的说明以中文显示。
