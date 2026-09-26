# Agent Note: eval-planning 按默认值起草，路径一律答「没有登记」

Status: implemented

## Problem

T73 分支 3 围绕题库登记重写了 eval-planning SKILL 和 eval 预设（数据集只从 `datasets_list` 取；版本由 `eval_plan_draft` 判定；版本提问被跳过就结束这一轮）。3171 上的 agent 行为试点（2026-09-27，main 在 60a8135a，模型 deepseek-flash，一个会话里发了试点脚本的两句话）暴露出两处文本把 agent 带离了交互稿 v5 的分工——agent 起草、人在实验设计页上改：

- **「用 harness-comparison 比一下 lean 和 full」没有起草就结束了。** 流程第 1 步写的是「比什么、跑哪些题……人没说就问」。agent 问了跑哪些题、几次、哪个判官，人跳过后，它把 Datasets 规则 3（「If the person skips the question, stop」）——一条为版本提问写的规则——套到了题目提问上。没有起草实验，会话实验卡的正常形态也就核不了。
- **「用 ~/code/dsh-plugins 里的数据集建个实验」得到的是提问，不是拒绝。** agent 认出这是路径，没调任何工具，直接给了 `ask_user_question`，其中一个选项是「~/code/dsh-plugins 就是已登记的 dataseek-eval/harness-comparison」——按名字相像把未登记的目录对成了已登记的 id。规则 5 只覆盖「工具说未登记」的情形，而这里根本没调工具。它还把 tab 叫成「Datasets 页」，不是「题集」。

成立的部分：`datasets_list` 恰好一次，返回里没有以 `/` 或 `~/` 开头的字符串；全程没有 read / glob / grep / bash，也没有读 `~/code/dsh-plugins` 下的任何东西；pilot-d 结果对比页的数字与重装前一致；共享题库检出的 HEAD（050e22d1）与 worktree 行数（38）不变，`experiments/` 没有新增。判据 3、4（版本歧义）未覆盖：钉住的 d9af6bc 与 fd04079 两个提交上，该 set 的 `items/` 与 `schemas/` 树相同，数据本身不产生歧义；等题库 items 变动后在 3171 上补跑。

## Decision

协调者裁定（2026-09-27）改 SKILL，不改判据。

- **流程第 1 步**只在没人说出比较因子时才问。其余都有默认值，agent 直接用默认值起草：题目——`datasets_show` 列出的该 set 全部题；次数——1；判官——条件库里已有的判官条件（已有实验在 `judge_conditions` 里点过名的），没有就不写 `judge_conditions`。回报（第 4 步）说明哪些是默认值、可以在实验设计页上改。
- **Datasets 规则 3** 改为「If the person skips the version question, stop」，并写明它只管版本提问。
- **Datasets 规则 5**：人给的是路径时，先调 `datasets_list`；列表按 id 列登记、从不列路径，所以 agent 说「这个路径在本部署没有登记」（按人的语言），并指到题集 tab。绝不按名字相像把路径对成已登记的 id。
- **eval 预设的 persona** 用两行说同一件事：「版本有歧义就问、跳过就停」只针对 `eval_plan_draft` 的拒绝；题目、次数、判官是默认值；路径一律答「在本部署没有登记」并指到题集 tab。
- `scripts/web-eval-install.spec.ts` 钉住新措辞。

## Alternatives considered

- **改判据**（把「先问题目」算作通过）。否决：与 v5 的分工相悖，人跳过一个问题就挡住整份草稿，而这些选择设计页本来就能改。
- **照问，但跳过时用默认值起草。** 否决，属于半截方案：提问仍然多耗一轮，还会教人养成跳过的习惯。
- **让 agent 拿路径去调 datasets 工具，好让工具的「not registered」原文出现。** 否决：datasets 工具收的是登记 id 不是路径；`datasets_list` 加一句固定话就能给出同样的拒绝，不必放宽工具的参数。

## Consequences

- 说出了比较因子的一句话，现在一轮就能出草稿；人可能不同意的默认值都摆在设计页上。
- 按全部题起草可能带上夹具题（harness-comparison 里的 P0-placeholder）。回报会列出默认值，人能看见；SKILL 不为夹具单开特例。
- 本轮不处理、已记到下轮：`eval_cells` 为旧运行返回绝对 `planPath`（指向题库仓库的各个 worktree），`eval_conditions` 以绝对路径返回部署的条件目录。试点里 agent 看到了这些路径，但没有去读。
- 验证：合入后重装 3171，在两个新会话里重跑这两句话，复核判据 6、8；会话一的草稿顺带核实验卡的正常形态。结果见下。

## 验证（复跑，2026-09-27）

3171 从 main bd4ed32c 重装（ac3c2a04 之后只多一个 README 提交），14 秒就绪；实例里的 SKILL 与预设都是新文本，控制台无报错，pilot-d 结果对比页的数字与重装前一致。协调者验收通过，T73 分支 3 收口。

- **会话一（「用 harness-comparison 比一下 lean 和 full」）一轮出草稿。** 没有 `ask_user_question`，没有 read / grep / bash。草稿 `dsh-lean-vs-full-20260926-7204`：3 题 × lean / full × 1 次，判官 `t31-judge-other`，钉在 d9af6bc；校验 ok，两条警告都在 P0 夹具题上。回报列出了默认值（全部题、1 次、判官、stages、seed、预算），并说明可以在实验设计页上改。实验卡显示 实验草稿 / 待批准 / 问题 / 规模 / 题库版本 / 打开实验；点「打开实验」后，实验室 tab 里对应的一行被标出（待批准，去批准）。草稿留在 3171 上。
- **会话二（「用 ~/code/dsh-plugins 里的数据集建个实验」）调了 `datasets_list`，** 说这个路径在本部署没有登记，指到题集 tab（登记仓库），没有把路径对成已登记的 id，也没有读该路径下的任何东西。人跳过后续提问后，没有起草。
- **判据 8：** `experiments/` 只多了会话一的草稿；共享题库检出的 HEAD（050e22d1）与 worktree 行数（38）不变。**判据 6** 按语义通过：拒绝用的是 SKILL 里的中文句子，因为没有工具拒绝过调用。
- **轻微偏差，记到下一轮，不重跑：** 会话二在问数据集和比较因子之外，还捎带问了跑哪些题（按新规则这是默认值）；`eval_plan_draft` 返回计划的绝对 `planPath`，会话一把它原样写进了回复——与上面 `eval_cells` / `eval_conditions` 那一项同类。
