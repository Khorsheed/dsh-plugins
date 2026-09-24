# Agent Note: 实验成为部署级对象

Status: implemented

[English](2026-09-23-eval-experiments-deployment-level.md) | 中文

## Problem

T73 之前，一个评测实验是题库工作副本里的一个 plan 文件：`datasets/<set>/plans/<name>.json`，条件在旁边的 `datasets/<set>/conditions/`，分析由 `eval_repo_write` 写进同一个检出的某处。仓库经由会话绑定到达 eval。[题库登记](2026-09-23-dataset-registry.zh.md)（T73 分支 1）已经把 agent 面的绑定换成只读引用的登记表，eval 这边还剩四个问题：

- **自己的记录放在别人的检出里。** 起草把 plan 和条件写进多个 agent 共用的工作副本；每一份分析初稿都是往那棵树里写，写入门（四个前缀的白名单）得替一个不归它管的目录把关。
- **实验不钉输入。** 草稿把 `dataset.commit` 留空，由 run 去钉工作副本当天的内容。题库一动，「再跑一次」就悄悄变成另一个实验；两个实验能不能比，全靠人去核对。
- **用哪个仓库是会话事实。** `resolveRepoScope` 读会话绑定：新会话没有绑定，绑错的会话把 eval 指向错误的树。
- **运行说不清自己属于哪个实验。** run 记的是 `planPath` 和 `planSha`，plan 一挪或一改，关系就断了；实验室列表只能按路径分组。

## Decision

### 实验目录

评测产出的一切都放在部署的状态根下，题库只是只读输入：

```
$DSH_HOME/state/eval/
  experiments/<expId>/plan.json    plan，起草或导入时的字节原样保存
                     /meta.json    {schema: dsh.eval.experiment/1, experimentId, name,
                                    originSession, createdAt, dataset: {registry, set, commit},
                                    source?: {from, path}}
                     /analysis/    eval_analysis_write 唯一的门
                     /exports/     默认的导出位置
  conditions/<id>.json             条件库
  conditions/<id>.lock.json
```

布局归 `packages/eval/src/experiment-store.ts` 管。条件库放在 `<stateRoot>/conditions/` 是有意的：所有读条件的地方本来就解析 `<root>/conditions/<id>.json`，状态根就是条件库的根，就绪规则只需要一份实现。`plan.exports` 和调用方的 `exportsDir` 仍可覆盖 `exports/`。状态根是 `$DSH_HOME/state/eval/`；没有设 `DSH_HOME` 的实例没有状态根，实验室列表为空并说明原因（`noStateRoot`），不会退回某个自选的路径。

**id 规则。** 实验 id 是 `<slug>-<yyyymmdd>-<4 位十六进制>`：

- slug 由名字转小写得来，`[a-z0-9]` 之外的连续字符压成一个 `-`，截到至多 40 字符且不以 `-` 结尾，什么都不剩时用 `experiment`；
- 日期取 UTC，同一时刻在每台机器上得到同一个日期；
- 四位十六进制是随机数。

每次读都校验 `EXPERIMENT_ID_RE`，所以 id 永远不可能是路径。创建是原子的：先把全部内容写进 `experiments/` 下的隐藏目录 `.tmp-<pid>-<hex>`，再 rename 成新铸的 id（撞名就重铸），最后回读 `plan.json` 逐字节比对。不一致就报错，不会留下半个实验。列举时跳过点目录；某个 `meta.json` 坏了会作为问题报出来，但不会让整个列表变空。

### 版本钉定

`eval_plan_draft` 接受 `dataset: "<登记 id>/<set>"` 和可选的 `commit`。草稿一定钉一个完整 commit，由 `src/dataset-version.ts` 决定。候选有两类：

- 跟踪分支的最新 commit；
- 同一 `<registry>/<set>` 上、与本草稿至少共用一个条件的既有实验所钉的每个 commit。读者要拿来对比的正是这些实验。

若所有候选的 `items/` 和 `schemas/` 树完全相同（按 git 树 id 比较），选哪个都不影响结果，静默取最新。否则拒绝草稿，原文如下：

```
version is ambiguous for ${registry}/${set}: these commits hold different items/ or schemas/, and results pinned to different ones do not compare:
${listing}
Ask the person which version this experiment should pin with ask_user_question, then draft again with that `commit`. If they skip the question, stop — do not pick one yourself.
```

显式给出、但不在候选里的 `commit` 同样被拒并附上候选清单，手误或随手填的 ref 也绕不过这个问题。

### 校验读物化视图

`validateExperiment` 以及实验目录里的 plan，都对照题库登记在钉定 commit 上的只读物化视图（`datasetView`，`_full` 键）来校验，条件从条件库取。plan 同级回退（`items/` 旁的 `plans/`、plan 旁的条件）只留在旧路径上：按文件路径就地校验的 plan，以及旧 plan 导入之前的读取。

### 运行与实验配对

从实验启动的 run 会在 `run.meta` 里记下 `experimentId`。`pairRun`（`src/experiments.ts`）按三个键配对，由强到弱：

1. `experimentId`；
2. `planSha`，即 plan 规范 JSON 的 sha256。plan 后来被导入的旧 run，哈希仍然一致；
3. `planPath` 以某个已导入实验的 `source.path` 结尾。这是兜底，留给跑完之后 plan 又被改过的 run。

没有实验认领的 run 照样列出，名字取自它自己的 `run.meta`，标为「旧运行（未关联实验）」。

### 导入

`dsh-eval import --from <id>@<ref> [--plan <name>] --instance <url>` 与 Remote `importExperiments` 实现在 `src/import.ts`，把仓库里的旧 plan 搬成实验：

- **读取。** 一律经登记面在该 ref 上 `git show`，不 checkout 任何东西。
- **plan 字节。** 原样写入，所以 `planSha` 与旧 run 记下的一致。
- **钉定 commit。** plan 自带 `dataset.commit` 就钉它，否则钉该 ref 解析出的 commit。
- **条件。** plan 点名的每个条件（选手与裁判）连同 lock 一起进条件库：
  - 与库里那份条件哈希相同（字节排版不计）即视为同一条件，保持不动；
  - 同 id 但内容不同，则拒绝整次导入。拒绝信息逐字段列出差异（`<path>: library X ≠ imported Y`），并要求改掉其中一方的名字。
- **不会写一半。** 全部检查在第一次写入之前做完，被拒的导入什么都不写。
- **重复导入。** 同一 commit 上再次导入同一 plan 是空操作，报告里写明（`created: false`）。

报告给出：新建与已存在的实验数、跳过的文件及原因、新增与相同的条件数。

### 分析的门

`eval_repo_write` 改名为 `eval_analysis_write`，参数 `{experiment, path, content, overwrite?}`，只写该实验的 `analysis/<path>`（`src/analysis-write.ts`）：

- **门。** 任何磁盘访问之前先做字符串检查，再对父目录做 realpath 检查，拦住经由符号链接的逃逸。`plan.json`、`meta.json` 和 `exports/` 永远不可写。
- **写入。** 已存在的文件只有在设了 `overwrite` 时才会被替换，空内容直接拒绝。
- **回执。** 确认语点名实验，并写明「在结果对比页可看」。

页面这一侧通过 Remote `experimentArtifact({experimentId, path})`（`src/experiment-artifact.ts`）来读，规则与读单元产物的那个读取器相同：

- 路径必须在该实验目录之内，先做字面检查，再在真实路径上检查一次；
- 只读文本文件；
- 超过 256 KB 的部分截断，只返回文件开头，并注明已截断。

结果对比页的第 ⑤ 块「分析初稿」按新到旧列出该实验 `analysis/` 下的文件名：

- 整块默认折叠，其中最新一份展开；
- 实验没有分析时整块隐藏；
- 从不显示路径。

### 启动运行

run 从实验启动，入口有三个：

- `/eval run <experimentId>`；
- `dsh-eval run --experiment <id> --instance <url>`；
- 实验室的批准（`approve(experimentId, …)`）。

旧的 `run <plan.json>` 保留，给状态根之外的 plan 用。

### 绑定的尾巴

以下内容已删除：

- `DatasetsBindingFace`；
- `resolveRepoScope` 的绑定分支；
- 配置里的默认仓库回退；
- 模型工具上所有的 `repo` 参数；
- 实验室里和绑定有关的界面（「未绑定」那一行、绑定修复项、`normalizeRepoPath`）。

datasets 那一侧已在 1cdea3f4 落地。eval 如今只经由登记面（`DatasetsRegistryFace`）接触题库。设计页的题库版本行显示为 `<id>/<set> @ 短哈希`，实验室列表的对应列也一样，两处都不显示路径。

**发布说明：** 旧绑定文件永远不会被自动删除。它们仍在 `$DSH_HOME/state/datasets/bindings/<session>.json`，`importBindings` 仍能把它们并入登记。除此之外没有代码再读它们；需要的登记都建好之后，可以由人手动删除。

### 本次不涉及

- **不在本次范围：** eval-planning SKILL 与 presets（分支 3），以及任何 agent 行为试点。
- **3171：** 它的 runs 目录不动。
- **共享题库检出：** 只用 `git show` / `archive` / `rev-parse` 读取。
- **25 个旧托管 worktree：** 仍按登记笔记交协调者清理。

## Alternatives considered

**实验留在题库里，只是改由登记表查找。** 改动最小：plan 仍放在 `datasets/<set>/plans/`，只换查找方式。但登记表之所以把题库设为只读输入，是有意为之。按这个方案，起草和分析仍会往别的 agent 正在用的检出里写，写入门仍得替别人的树把关。描述*本部署*实验的记录，应当归部署所有。

**按名字或内容哈希给实验编号。** 用名字，第二次改一点再跑「pilot-d」就撞名。用内容哈希，plan 一改哈希就变，分析和 run 都会找不到自己的实验。现在的 id 只在创建时铸一次、此后不再推导：带可读的 slug、UTC 日期，外加足够的随机性，让同一天的两份草稿不撞。

**`dataset.commit` 仍留空、由 run 钉（旧行为）。** 这恰恰是本次要堵的漂移：同一实验跑两次，可能读到两份题库。改成起草时钉定，决定就落在还能问人的那一刻。

**总是静默钉最新。** 更简单，但题集一动，新实验就会悄悄和它本该对比的那些实验比不上了。树哈希比较把「选哪个都无所谓」的情形全部留给静默路径，只在选择真正影响结果时才问。

**让 agent 自己在候选里挑。** 拒绝信息可以列出候选、让模型自己选。但一个实验该和哪个版本放在一起，是研究上的决定；模型一猜，悄悄漂移就又回来了。所以原文要求去问人，问题被跳过就停下。

**导入时复制工作树，或重新序列化 plan。** 按工作树复制，读到的是共享检出当时所在的分支。重新序列化会改变 `planSha`，让所有旧 run 失去归属。在显式 ref 上 `git show` 并保留原字节，配对才能保住。

**导入时覆盖冲突的条件，或让两份同 id 并存。** 两种做法都会让一场对比里出现同名的两个受试对象。拒绝整次导入并逐字段列出差异，让人有意识地给其中一方改名。

**只按 `planPath` 配对。** 路径随导入变了，旧 run 会全部显示成旧运行。新 run 用 `experimentId` 精确配对，导入过的旧 run 由 `planSha` 找回，不用改写它们的账本。

**保留 `eval_repo_write`，只收窄白名单。** 它的名字和参数（仓库路径）描述的都是旧形态，而任何通往题库的写入门都与登记表的只读原则相抵触。改名之后，这项授权说的就是它实际的范围：一个实验下的一个前缀。

**没有登记时退回绑定。** 留着这个回退，第二个仓库身份来源就会一直存活，而让 agent 解析到错误树的正是它。现在没有登记的实例会直说没有，修法是去登记。

## Consequences

- **换来的：**
  - 实验的题库输入是钉定的 commit，按构造就可复现；
  - 评测记录不再进入共享题库检出；
  - run 在挪动和导入之后仍认得自己的实验，旧历史导入一次后按哈希配上。
- **付出的：**
  - 没有 `DSH_HOME` 的部署根本没有实验；
  - 实验在部署之间迁移只能复制目录，没有导出实验的动词；
  - 条件库按部署各自一份，两个部署对同一个条件 id 的含义可能不同，要到导入撞上冲突时才会暴露；
  - 旧绑定文件会一直留着，直到有人删掉。
- **机制上：** 版本问题和条件冲突，是 eval 如今会停下来问人的两个地方。两处拒绝都点明下一步该做什么，而不只是报告失败。
- **提交顺序：** 协议文本（v1-rev13，`dataset: {registry, set, commit}`）单独成一个提交。`protocol.spec` 会拿文档 §6 的 schema 块和代码常量比对，所以两个提交都在时它才是绿的。

## Testing

- **`packages/eval/tests/experiment-store.spec.ts`：**
  - slug 与 UTC 日期规则；
  - plan 原样保存与 meta；
  - 不留临时目录；
  - 拒绝形如路径的 id；
  - 有坏目录时列表仍能列出；
  - plan 路径到实验的映射。
- **`packages/eval/tests/import.spec.ts`：**
  - 字节原样；
  - commit 规则；
  - 条件与 lock 逐字节复制；
  - 重复导入是空操作；
  - 排版不同但哈希相同；
  - 冲突拒绝且什么都不写；
  - 缺失的条件；
  - 未知的 plan 名或 ref。
- **`packages/eval/tests/analysis-write.spec.ts`：**
  - `analysis/` 任意深度都可写；
  - `plan.json`、`meta.json`、`exports/` 被拒；
  - 逃逸、符号链接与覆盖；
  - 「在结果对比页可看」的回执。
- **`packages/eval/tests/draft.spec.ts` 与 `validate.spec.ts`：**
  - 版本决定，包括版本不唯一与非候选两种拒绝；
  - 对照物化根校验。
- **`packages/eval/tests/cli-experiment.spec.ts`：** `run --experiment` 与 `import`，两者离线时都拒绝。
- **客户端测试：**
  - 题库版本行；
  - 旧运行行；
  - 第 ⑤ 块。
- **临时实例验收（rc.1 工具链，无 provider）。** 测试漏掉的两处，都已修：
  - 导入时用带尾斜杠的 `datasets/` 列目录，真实的登记面拒绝空路径段。`tests/helpers.ts` 里的假登记面现在套用同一条路径规则，`import.spec.ts` 本可以抓到它。
  - 名称列整格单行省略，名字稍长时吞掉「旧运行」徽标，400px 下每一行都被吞。现在名字单独省略，徽标不收缩。
- **真实数据上的配对。** 导入后的 pilot-d run 走的是 `planPath`，不是 `planSha`。它是从计划后来的一次修改（07fde763）起跑的，记录的 `planSha` 与 fd04079 处导入的字节不同。`planSha` 只能找回从导入字节原样起跑的 run，从改过的计划版本起跑的 run 靠 `planPath` 兜底。
