# T73 实施计划：数据集按仓库登记 + 实验写入模型（提案 D1 / D2）

> 状态：第一步交付，待协调者与用户评审。本页只定方案，不改代码、不改协议、不动题库仓库、不碰 3171。
> 评审（2026-09-23）：通过，定 (b)，rev13 归 T73、D5 字段顺延 rev14。随分支 1 第一个提交按评审意见修订六处，各处以「修订 N」标出。
> 依据：提案 `proposals/active/2026-09-23-eval-journey-redesign.md` §4 D1+D2、`ui-spec.md` §四–§六、协议 v1-rev12 §6.1，以及对共享检出 `~/.dsh/scratch/dataseek-eval` 的只读勘查（下文「现场」）。

## 〇、现场：模型 (a) 其实已经在跑，而且跑坏了

对共享检出只做了 `git log / ls-tree / worktree list`，没改 HEAD，也没写任何东西：

| 事实 | 数据 |
|---|---|
| 共享检出 HEAD | 停在 `i3-probes`，不在 main |
| main（d69f043，09-03） | 0 份 plan、0 份 condition、3 道题 |
| 实验分支 | 共 16 个本地分支；i1-walk 有 18 份 plan、25 份 condition、10 份 lock，领先 main 65 个提交；i4-pilot-d 领先 58 个，i5-walkthrough 领先 49 个。**一个都没合回 main** |
| analysis/、exports/ | 所有分支都是 0 个文件 |
| `git worktree list` | 38 条。大多是 `~/.dsh-lab/state/datasets/worktrees/` 下锁住的托管 worktree，另有测试残留的 `/private/var/folders/…/t20-*` |
| items/ 的树哈希 | main 和 i3-probes 各不相同；i1-walk、i4-pilot-d、i5-walkthrough 三个分支相同（4e7df0c） |
| 3171 的会话绑定 | 3 个文件指向同一个仓库，但走了三条路径。其中 `…-wt-t60` 那个 worktree 已不存在，绑定悬空 |
| pilot-d 的 plan | `dataset.repo` 写的是 worktree 路径 `…/dataseek-eval-wt-pilot-d`，`commit: null` |
| condition 文件 | 带 `scope`、`preset`、`unit.scopedHome`、`home.sha`，都是部署事实；lock 是机器测量值 |

结论：「每个实验开分支 + 人工合并」这条路已经走了一个月，实际结果是分支从不合并，所以「最新版」说不清楚；部署事实被提交进了共享仓库；共享 `.git` 里堆满了 worktree 登记；T68 那一类过期路径也反复出现。

## 一、写入模型：推荐 (b)，不设过渡期 (a)

我同意提案倾向的 (b)，并补一条：**condition 和 lock 同样搬到部署级**，不留在仓库里。它们描述的是「这台部署上的哪个 scope、哪个 preset、测出来的 home.sha」，不是数据集内容。

| 维度 | (a) 每实验一个 `exp/<id>` 分支 + worktree，人工合并 | (b) 实验是部署级对象，仓库只读 |
|---|---|---|
| 实验住哪 | 仓库分支 `datasets/<set>/{plans,conditions,analysis}` | `$DSH_HOME/state/eval/experiments/<expId>/`：`plan.json`、`meta.json`（name、originSession、createdAt、dataset 引用）、`analysis/` |
| condition / lock | 提交进仓库（现状） | 部署级条件库 `$DSH_HOME/state/eval/conditions/<id>.json` + `.lock.json`；provision 和改端点都写这里 |
| T35a 的 run↔plan 配对 | 不变（planPath / planSha） | 新 run 的 meta 写 `experimentId`，配对先看它；旧 run 回落到 planSha → planPath。**planSha 含义不变**：仍是 plan 文档的规范 JSON 哈希 |
| 旧 plan | 原地可用 | 兼容读 + 一次性导入（见 §五）。导入时 plan 文档**逐字节保留**，这样旧 run 的 planSha 还能配上；新字段只写进 meta.json |
| analysis 要不要「发布」步 | 需要（人得合并才算发布） | v1 不做站内发布。analysis 跟着实验走，随 export / bundle 带走。现场所有分支的 analysis 都是 0 个文件，没有人在用「提交进仓库」这条路 |
| 协议版本 | 不动 | **rev13**：plan 的 `dataset` 块改为 `{registry, set, commit}`，commit 必填不能为 null；`dataset.repo` 降为 legacy 只读字段；§6.1 的 conditions/plans/analysis 从「集合级直通区」挪到「部署侧」。原来记在 rev13 名下的 D5 字段顺延为 rev14（ui-spec §五 改一个词）。如果 T73 和 T74 同批落地，也可以合成一个 rev13，由协调者定 |
| G16 白名单 | 不变 | `eval_repo_write` 改名 `eval_analysis_write`，白名单只剩 `analysis/<path>`（根是实验目录）。docs/、plans、conditions 移出白名单：plan 只由起草和原地改数（T74）写，condition 只由起草、provision、改端点写 |
| `datasets_put_item` 写哪 | 共享检出（现状，会碰 HEAD 所在工作区） | 只写登记里人**明确指定的著作检出**（必须和登记是同一个仓库，比对 git common dir）。没指定就拒绝。eval preset 本来就不需要写题 |
| exports 默认位置 | `<仓库>/exports`（run.ts:2294） | `<实验目录>/exports`；plan.exports 和 options.exportsDir 的覆盖照旧 |
| run 入口（CLI / slash） | 不变（传 plan 路径） | `eval run --experiment <id>`（slash 同名参数）；plan 路径只用于导入与旧计划兼容读（修订 5，落在分支 2） |
| bundle | 不变 | 不变。run.meta 本来就自足（快照的 repo/commit、条件全文、order、judge），planSha 意义不变 |
| 最大代价 | 共享 `.git` 继续膨胀，靠人合并，但现场证明没人合并；「最新」永远有歧义 | 条件库搬迁 + 导入工具 + 配对改键，代码面最大；实验不再能经 git 在部署之间共享，只能经 bundle |

不设过渡期 (a)：提案的风险一节写明，过渡方案必须说清楚是否被 (b) 取代，否则会同时存在两套模型。(a) 已经在现场跑过，没有需要过渡去验证的东西。

## 二、登记表

- **存储**：`$DSH_HOME/state/datasets/registry.json`，部署级，只有人经表单能写。每条记录：

  ```json
  { "id": "dataseek-eval", "commonDir": "<git common dir 的 realpath>", "trackedRef": "main",
    "registeredAt": "…", "registeredCommit": "d69f043…",
    "sets": { "harness-comparison": { "layers": ["visible"] } },
    "authoringCheckout": null }
  ```

  以 git common dir 为身份，同一仓库的任何 worktree 路径都归到同一条记录。像 3171 那样三条路径指向一个仓库的情况，从此不会出现。
- **表单复用 BindForm 哪几段**：
  - 第 1 段复用：路径输入 + 原生选择器 + 实时 `previewRepo` 判定。去掉「会话 cwd」一键填，因为登记不属于会话。
  - 第 2 段复用：层级 chips，从「整库一份」改成「每个集合一份」，默认只勾 modelFacing。去掉数据集白名单（集合列表由仓库本身决定，不让人挑）。
  - 新增一行「跟踪分支」下拉，默认 main。
  - 确认。
  - BindingChip 删除，eval DesignPage 上的「未绑定」字样随之删除。
- **一仓多集怎么列**：按仓库分组，每个集合一行，显示 `set · trackedRef@短哈希 · 日期 · 可见层`。
- **「最新」怎么算**：取**登记时选定的跟踪分支**在当下的提交（`git rev-parse <trackedRef>`）。不读 HEAD，因为共享检出的 HEAD 现在停在 i3-probes；也不冻结在登记那一刻的提交，否则仓库更新了用户也看不到。`registeredCommit` 只作审计用。跟踪分支不存在时拒绝登记 / 取数，不回落到 HEAD。
- **3171 的正式登记跟踪 `i1-walk`**（修订 3）：它是协调者合并的集成分支；main 停在 09-03、0 份 plan、items 树与 i1-walk 不同，跟踪 main 等于让实验对着一份过期题库。上面示例里的 `"trackedRef": "main"` 只是字段形状；§六 试点为制造版本歧义而登记 main，**仅试点**。
- **只读取数**：单文件读取仍走 `git show <sha>:<path>`（现状）。整层读取改为 `git archive <sha> -- <paths>` 解到 `$DSH_HOME/state/datasets/materialized/<repoId>/<sha>/<set>/<layers-key>/`，按内容寻址，只读，替代 `ensureWorktree`。从此不向共享 `.git` 登记任何 worktree。已有的 38 条托管 worktree 登记，清理（unlock + remove + prune）会写共享 `.git`，属于共享资源，**第二步不自动做**，由协调者安排。

## 三、可见性

- 读工具白名单改为**登记表里每个集合的 `layers`**。operator 调用照旧不过滤；集合没显式配置就用 modelFacing 下限（effectiveLayers 的三分支逻辑保留，只是输入从会话绑定换成登记表）。
- **会话收窄：不保留。** 理由：
  1. 全仓没有 eval 以外的消费者：canvas 只在笔记里提到 datasets，非 eval profile 都不装 datasets。
  2. 按会话存状态正是 3171 上三份绑定、其中一份悬空的根源。
  3. ui-spec 已定「可见性是数据集属性、只归人管」。

  将来如果真出现非 eval 场景，再按 companion 规则另开，本次不留口子。

## 四、agent 选择规则

> **语言（修订 4）**：本节的中文拒绝文本与 SKILL / preset 规则是**语义规格**。落地沿用现有语言：eval-tool、datasets-tool 的报错今天都是英文，SKILL.md 与 preset 前缀也是英文，逐字英文在各分支落地时给出（分支 1 的三类 datasets 拒绝文本见其 Agent Note 与 datasets-tool README）。唯一例外是 agent 停下时的回复句：按人的语言说，不规定逐字。

- **`datasets_list({ query? })` 返回形状**（**不含任何文件系统路径**，agent 没有路径可拿去 read / grep）：

  ```json
  { "datasets": [ {
      "ref": "dataseek-eval/harness-comparison",
      "title": "…", "trackedRef": "main",
      "latest": { "commit": "d69f043…", "date": "2026-09-03" },
      "layers": ["visible"]
  } ] }
  ```

  `query` 对 ref 和 title 做大小写不敏感的子串匹配。**不返回 `experiments`**（修订 1）：datasets-tool 只依赖 datasets，实验目录归 eval，不能反向依赖；版本候选本来就由 `eval_plan_draft` 判定（下面 SKILL 规则 2），「版本不唯一」的报错里列出相关实验即可。datasets_list 只回登记表的事实：ref、title、trackedRef、latest{commit, date}、layers。
- **参数形态**：`eval_plan_draft`、`eval_plan_validate`、`eval_conditions` 以及 datasets 读工具，原来的 `repo` 参数改为 `dataset: "<登记 id>/<set>"`，**只收登记 id，不收路径**。传了路径时，即使这个路径已登记也拒绝，并在拒绝文本里给出对应的 id，让 agent 学会用 id。
- **非唯一候选**（`dataset` 只给了集合名，或者子串命中多条）：

  ```
  数据集「harness」匹配到 2 个登记项，不能替人挑：
    - dataseek-eval/harness-comparison（跟踪 main，最新 d69f043，2026-09-03）
    - other-repo/harness-lite（跟踪 main，最新 1a2b3c4，2026-09-20）
  请用 ask_user_question 让人选择；人跳过就停下，不要起草。
  ```

- **版本不唯一**：起草时不传 `commit`，而候选版本的 `items/` 或 `schemas/` 树哈希不同（候选 = 跟踪分支最新 + 同集合里已有实验钉住的提交，且那些实验用到了本次请求的条件）：

  ```
  harness-comparison 的版本不唯一：
    - d69f043（main 最新，2026-09-03）
    - fd04079（实验 pilot-d-preset 所用；dsh-lean / dsh-full 在此版本上测过）
  两者的 items/ 不同。请用 ask_user_question 让人选择；人跳过就停下，不要起草。
  ```

  树哈希相同时不算歧义，直接用最新版。`commit` 传了但不在候选里，同样拒绝，并附上这份候选列表。
- **未登记仓库**：

  ```
  「~/code/foo」不在本部署的数据集登记里；eval 只用已登记的仓库。请人到「数据集 → 登记」页登记后再来。不要自己去读这个目录。
  ```

- **SKILL.md 规则（逐字，替换现有的 "The repository is not yours to pick" 一节）**：

  ```
  1. 数据集只从 datasets_list 里选。人说的名字对上唯一一项就用；对上多项或对不上，照工具报错里的候选用 ask_user_question 问人。
  2. 版本由 eval_plan_draft 判定。它报「版本不唯一」时，用 ask_user_question 问人，选项就是报错里列的版本。
  3. 人跳过或没选：本轮不起草、不调任何写工具，回复「等你选定版本后再起草。」然后停下。
  4. 不用 read / glob / grep / bash 看数据集仓库；要看题目用 datasets_* 读工具。
  5. 仓库没登记，就告诉人去登记。不替人登记，也不去读那个目录。
  ```

  同时删掉 "Do not commit anything. Drafts live in the repository working copy."，改成「草稿存在部署里的实验目录，仓库只读」。
- **preset 提示词（agent.cordis.yml 人设前缀，追加三行，逐字）**：

  ```
  数据集只认 datasets_list 里的登记项，不读仓库目录。
  名字或版本不唯一时用 ask_user_question 让人选；人跳过就停下，不起草。
  实验草稿写在部署里，不写数据集仓库。
  ```

- **「跳过 = 不起草、停下等人」怎么落实**：分两层。
  - 机械层：起草在歧义未消解时拒绝，没有静默默认值，agent 无法「先按最新版起草再说」。
  - 规则层：上面第 3 条规定跳过时不调工具、只回一句等人选定版本的话，试点检查（修订 4：回复句按人的语言，判据查语义不查逐字）。

  工具端无法核实 commit 是不是人选的，这一点只能靠规则 + 试点，本页明确承认这个边界。
- **可选收紧**：eval preset 去掉 `tool-fs-search`（glob / grep）。代价是 agent 失去读 profile 文档的能力。建议先不去，看试点第 5 条的结果再定。

## 五、迁移与兼容

- **会话绑定文件**：第二步之后没有代码读它们，**不自动删除**。发版说明列出路径，由人手删。另提供「从旧绑定登记」一键操作：按 common dir 去重，3171 的三份会合成一条；悬空的那份标红跳过。
- **旧 plan 的 `dataset.repo`**：兼容读，只在导入时使用。导入命令 `eval import --from <登记 id>@<ref>`：用 `git show` 从指定分支读 plans/conditions/locks，不建 worktree、不动 HEAD。
  - plan 原样存成 `experiments/<id>/plan.json`，meta.json 记 `{registry, set, commit}`；commit 来源依次为 plan 自身的 commit → 导入时 ref 的提交。
  - condition 进条件库：哈希相同视为同一个；同 id 不同内容则拒绝并列出差异，由人改名。
- **T68 规则**（`resolveDatasetRoot` 的 plan 同级目录回落）：只在导入路径上保留；新模型下数据集根一律来自「登记 id + commit 的物化目录」。导入工具退役时一并删除。
- **3171 旧 run**：runs 目录不动。未导入前，这些 run 在列表里显示为「旧运行（未关联实验）」，报告照常打开，因为报告只读 run.meta。导入后按 planSha 配对归位。
- **pilot-d bundle**：bundle 自足，读取不需要登记表。试点第 7 条专门验证。

## 六、验证：试点脚本

- **在哪跑**：**临时实例**（按「临时 web-eval 实例配方」），不上 3171。
- **要不要放行**：
  - 对共享检出只做 `git show` / `git archive` / `rev-parse`（读对象库），不建 worktree、不动 HEAD，不需要题库仓库的放行。
  - 临时实例的端口和模型配额属于共享资源，开跑前**报协调者**，不需要 3171 的放行。
- **准备**：
  1. 登记 `dataseek-eval`，跟踪 main，`harness-comparison` 可见层取默认。
  2. `eval import --from dataseek-eval@i4-pilot-d`，只导 pilot-d-preset 及其条件。
  3. 此时 main（items 2870f04）与 pilot-d 钉住的 fd04079（items 4e7df0c）树不同，版本歧义可以稳定复现。
  4. 记下共享检出的 `git rev-parse HEAD` 和 `git worktree list | wc -l`。
- **脚本**：新会话，测试者发送「用 harness-comparison 比一下 lean 和 full」。出现 ask_user_question 时选「跳过」。然后另开一个会话，发送「用 ~/code/dsh-plugins 里的数据集建个实验」。
- **判据（对会话工具日志和回复逐条核对）**：
  1. 起草前，datasets 家族的工具调用恰好是一次 `datasets_list`。
  2. `datasets_list` 的返回中没有以 `/` 或 `~/` 开头的字符串。
  3. `eval_plan_draft` 的返回包含版本不唯一的英文串（分支 2 落地时定逐字，如 `version is ambiguous`）和 `ask_user_question`（中英各一，任一命中即过），并且紧接着的下一次工具调用是 `ask_user_question`，选项里出现 `d69f043` 和 `fd04079`。
  4. 跳过之后，该轮不再有任何工具调用；回复只有一句，语义是「等人选定版本再起草」（按人的语言，不查逐字）；`experiments/` 目录下没有新增实验。
  5. 整个会话里，read / glob / grep / bash 调用的参数都不包含 `dataseek-eval`。
  6. 第二个会话里，工具拒绝文本包含 `is not registered in this deployment`（或中文「不在本部署的数据集登记里」，任一命中即过），并且没有对 `~/code/dsh-plugins` 做任何 read / glob / grep。
  7. 临时实例能打开 pilot-d bundle 的报告页，数字与 3171 上一致。bundle 取题库 `wt-t65` 工作树 `exports/` 下的 `run-20260918054718-8o0o-bundle`（T71 也用它；修订 6）。
  8. 跑完后，共享检出的 HEAD 与 worktree 数都和准备时记下的一致。

## 七、切片：第二步三条分支

| 顺序 | 分支 | 内容 | 与 T72 / T74 的交叠 |
|---|---|---|---|
| 1 | `feat/t73-datasets-registry`（datasets + datasets-tool） | 登记表 + Remote；登记表单（BindForm 改造，删 BindingChip）；`git archive` 物化替代 ensureWorktree；`datasets_list` 新形状；`dataset` 参数与三类报错文本；读工具白名单改读登记表；put_item 改写著作检出；旧绑定一键登记。**删**：会话绑定的写入口（`/datasets bind` 改为提示去登记、BindForm 的会话段、BindingChip）。**留给分支 2**（修订 2）：eval 还在用的两个面——`DatasetsBindingFace.binding()`（eval service 读绑定）与 `worktreePath` 的返回形状 `{path, commit, layers, reused}`（run 拿路径算 materialization）；分支 1 新增登记面与绑定面并存，物化换实现不换形状；绑定读路径与三句 "no dataset repository" 随分支 2 退场 | 不碰 eval 客户端，和 T72 / T74 无文件交叠，可以马上开 |
| 2 | `feat/t73-eval-experiments`（eval + eval-tool） | 实验目录 + 条件库；起草改写部署级并判定版本；配对改为 experimentId 优先；`eval_analysis_write`；exports 默认位置；validate 改读物化目录；导入命令；run 入口改 `eval run --experiment <id>`（slash 同名，plan 路径只作导入与旧计划兼容，修订 5）；退掉绑定读面与 "no dataset repository" 三句；rev13 协议文档；DesignPage 的「未绑定」改为登记下拉；**分析初稿的 GUI 查看**（用户 2026-09-23 提出，ui-spec §五 结果对比第 ⑤ 块）：Remote 加只读动词 `experimentArtifact({experimentId, path})`，规则同 `cellArtifact`（只读本实验目录、只读文本、超 256 KB 截断并说明），结果对比页的折叠块渲染 `analysis/` 下的 markdown，`eval_analysis_write` 写完的回读确认里加一句「在结果对比页可看」（分支 1 不做） | 碰 DesignPage / LabView，**等 T72 合入后在其上开分支**；**T74 在它之后开**，因为 T74 的原地改数要写回 plan，写入目标就是这里定的 |
| 3 | `feat/t73-skill-prompt`（SKILL + preset 提示词） | §四 的逐字规则；删掉「让人 `/datasets bind`」一节 | 只动 profile 文本；和分支 2 同批合入，或紧随其后（规则引用了分支 2 的报错文本） |

三条分支合完、按 §六 试点通过，才算 T73 验收。之后是 T74。
