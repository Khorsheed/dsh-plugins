# Agent Note：eval——选题（全部 / 随机 N 题固定种子 / 手选）钉成计划题目；一个坏实验不再清空列表；模板找得到自己的 schema

Status: implemented

## 问题

T89 之后在走查实例上发现三处缺口。

- **选题（T90 第二段）。** 新建实验对话框只能逐题手选。想要「这套题里随机 5 题」的人没有办法表达。抽题还必须可复现：同一题集版本、同一种子，永远抽到同一组题。同一套题上的两个实验仍然可以选得不一样。
- **T93。** 实验列表对每个未开始的实验都要经 `validate` 读一遍计划。实验的数据集读不出来时（比如登记没了）这个调用会抛错。`draftRow` 没有接住，于是一个这样的实验就让 `experiments()` 拒绝，整个列表显示 “Failed to load the experiments”。
- **T92。** `runPlan` 把生成的 mission 模板写在计划旁边，守卫路径用默认的 `../schemas/<file>`。这个默认值对放在题集 `plans/` 下的仓内计划是对的。T73 之后计划在 `state/eval/experiments/<id>/plan.json`，`../schemas` 在那里指向 `experiments/schemas/`。这个目录不存在，所以 mission 的模板 lint 拒绝了这次运行。

## 决定

**选题只是写出 `dataset.items` 的一种方式，绝不是运行时再执行一遍的规则。**

- `packages/eval/src/contract/item-selection.ts`（不 import 任何东西，对话框和宿主共用）在钉住的提交上、对题集的题目解析三种模式之一：
  - `all`——所有非占位题；
  - `random`——按 `seed` 抽 `count` 题；
  - `pick`——勾上的题。
- `eval_plan_draft` 接受 `items` 或 `selection`，两者不能同给。它写出显式的 `dataset.items` 列表和一块来历记录 `dataset.selection`（`mode`、`pool`；随机模式另有 `count`、`seed`、`algorithm`）。这是协议 v1-rev15；schema 和协议文档的两个语言版本都已更新。
- **抽法（`hash-rank/1`）。**
  - 题池里每个 id 的键是 `cyrb53("<seed>\0<id>")`。
  - 键最小的 `count` 个入选；键相同时按 id 定。
  - 入选的题按题池顺序（UTF-16 码元排序）返回。
  - 抽题从不碰 `Math.random`、时钟或区域设置。唯一的不确定调用是生成默认种子；生成后它和自选的种子一样，显示出来、可以改、并被钉进计划。
- **对话框。**
  - 一个 `SegmentedControl`（全部 / 随机 N 题 / 手选）。
  - 随机模式有题数框、带「换一个种子」按钮的种子框，以及标着提交号的抽题实时预览。
  - 手选模式是勾选清单，题多时带筛选框。
  - 规划 skill 默认 `selection: {mode: "all"}`，并说明三种模式。

**T93：坏实验变成该行自己的原因。**

- `draftRow` 接住 validate 的失败。这一行得到可选的 `broken: {kind, registry, message}`，列表照常列出。
- `kind` 由宿主按拒绝文本里的标记归类：
  - `unregistered`——datasets 的 `notRegistered`；
  - `setMissing`——`datasetView` 的 “has no set”；
  - `noRegistry`——eval 自己的「没有题集登记服务」拒绝；
  - `unreadable`——其他一切。
- 有一个测试从源文件里读这些句子，所以措辞一改就有测试失败，而不是悄悄退化。
- 这一行仍是未检查的草稿。它按错误态三段式显示原因：出了什么事、怎么修、原文折叠在「详情」里。状态词汇不变。

**T92：用指向已校验数据集根目录的绝对 schema 路径。**

- `runPlan` 传入 `schemaPathPrefix: join(datasetRoot, 'schemas')`。
- `datasetRoot` 是钉住提交的物化视图，按内容寻址（旧的仓内计划则是题集自己的目录）。所以这个绝对路径指向的正是 validate 检查过的那些 schema，不管计划放在哪个目录。
- mission 本来就原样接受绝对 `schemaPath`（`resolveSchemaPath`），其他包不用改。
- `dsh-eval template` CLI 写进题集的 `templates/`，保留原来的相对默认值。

## 考虑过的其他方案

**选题：**

- **用带种子的伪随机数打乱题池。** 不采用。抽题结果会依赖题池的顺序和其中每一个成员，题集加一题就会全部重洗。用逐 id 的哈希排名，新题只有在自己的键胜过当前最后一个时才会进入抽题结果。
- **来历只记在 `meta.json`。** 不采用。计划才是导入、导出和打包都会带走的可移植产物，能让人重做抽题的那份记录应该在计划里。
- **存规则、运行时再执行一遍。** 不采用。题集加题后行跟着变的计划谈不上被钉住。每种模式最终都落成显式的 `items` 列表。
- **只在服务端抽题、不给预览。** 不采用。人必须在把计划交出去之前看到某个种子抽到哪些题。共用同一个纯函数模块，预览和宿主的答案由构造保证一致。
- **不带种子的 `Math.random`。** 不采用，因为不可复现。

**T93：**

- **在浏览器里归类，给 `ErrorState.tsx` 加标记。** 不采用。那个文件在 datasets 包里有一份刻意保留、手工保持一致的副本，而并行分支正在改 datasets。何况宿主本来就知道钉住的登记 id。
- **从列表里去掉坏实验，只留一条备注。** 不采用。人会看不到自己需要去修的那个实验。

**T92：**

- **（B）把题集的 `schemas/` 复制到 `experiments/<id>/schemas/`，前缀用 `./schemas`。** 这样模板在计划旁边是自包含的。没有选它，因为每次运行都要复制一份数据、需要覆盖策略，还会在实验里放一个没有别处读取的目录。绝对路径只改一行，而且已经钉住了该提交的 schema。
- **（C）改 mission 的解析方式，比如改成相对 run-meta 里的某个根目录解析。** 不采用：跨包，而且 mission 已经支持绝对路径。
- **从模板出发的相对路径**（`relative(templateDir, datasetRoot/schemas)`）。不采用。效果相同，却会产生一长串 `../../..`，任何一棵目录树一移动就断，没有好处。

## 影响

- 由选题起草的计划仍然显式列出题目。忽略 `dataset.selection` 的旧读者照常读取；计划 schema 只接受按声明形状写的这一块。
- 改动哈希运算或平局规则会改变抽题结果，必须随之换一个新的 `SELECTION_ALGORITHM` 名称；旧计划保留它们记下的 `algorithm`。
- 坏实验在列表里看得见、有解释。打开它仍会看到设计页自己的错误态。
- 生成的模板现在带有绝对的、与机器相关的路径。它们是部署时生成的产物，每次运行都重新生成，从不导出进打包，所以没有任何可移植产物携带它们。如果某个提交的物化缓存在运行仍未结束时被删掉，守卫会读不到 schema。运行的 `snapshotDir` 本来就有同样的情况。

## 测试

- `item-selection.spec.ts` 钉住了哈希值和一次固定抽题（种子 42，20 题抽 5 题）。它还检查与顺序无关、加入无关题目时抽题结果稳定，以及 schema 校验。
- `draft.spec.ts`、`tools.spec.ts`、`organize.spec.ts` 和 `NewExperiment.client.spec.tsx` 端到端覆盖三种模式。
- `experiments.spec.ts` 覆盖一个未登记实验与一个正常实验并列的情形、兜底归类和标记钉。`LabView.client.spec.tsx` 覆盖行内原因。
- `run.spec.ts` 端到端跑一个部署库布局的计划。修复前它复现出了 `experiments/schemas/` 的 ENOENT。
