# dsh-eval

中文 | [English](README.en.md)

**web-eval 编排器：dataseek 契约 schema、plan/condition 校验、条件与 scoped home 哈希、由题集 manifest 生成 run 模板、阶段一二的 run 循环（逐格物化、逐字节委派、提交推进、归档闸、bundle 导出）。** run 的发起是人的动作（`/eval run`，发起会话即所有委派的父会话）；判定的两条机器通路（探针写 `script`、判官盲评写 `llm-draft`）随 T9 落地，`human-final` 仍归人。不依赖任何兄弟插件——四个上游服务（datasets / mission / localAgent）在 run 时经 `ctx.get` 探测，缺哪个就拒绝并列出哪个，绝不炸启动。

给 agent 的模型工具只有三个读工具（见「模型工具」一节），run、finalize 与注解都不给模型。

`report` 把 mission export 的 bundle 变成 results.jsonl 与 summary.md（见「报告」一节），只读 bundle、不依赖宿主。

## 它管什么

三份契约 schema 与一条 lock 记录（全文见 [dataset-authoring-protocol §6](../../docs/dataset-authoring-protocol.md)，代码里集中在 `src/schema.ts` 一个模块，测试钉住文档与代码不漂移）：

| schema | 是什么 |
|---|---|
| `dataseek.condition/1` | 受试对象：harness、模型声明、permissions（按 harness 词表）、scoped home 哈希、env 键名 |
| `dataseek.plan/1` | 一次 run 的全部输入：题 × 条件 × rep × 阶段 × 顺序 × 预算 × 判官 × 期望判定源 |
| `dataseek.verdict/1` | 判定输出：探针与判官共同遵守的格式 |
| `dataseek.condition-lock/1` | 条件哈希与 scoped home 的实物记录；plan 的 sha 从这里解析 |

校验器遵循 I1 定下的字段决定：condition 的可空字段（`harness.version`、`model.declared`、`model.endpoint`、`home.sha`）的 null 是「未解析」，validate 列为 warning；`plan.conditions` 写条件 id，sha 从 `conditions/<id>.lock.json` 解析，缺 lock 即「未就绪」（同样是 warning——拦截归 run 前的就绪检查）；`judge` 可缺省，缺省时 `expectedNs` 不得含 `llm-draft`；plan 不含 template 字段。

## 模板生成：manifest → run 模板

run 模板不由人或 agent 手写：它是题集 `manifest.yml` 的确定性函数（`generateTemplate`），测试逐项钉住与 I1 手写的 `templates/bench-v1.json` 等价：

```text
pending → ws-ready → stage-1 → … → judged → archived → releasable → released
                          └→ halted（halt_on 命中）→ archived
```

- 最早转移带 run-meta schema-check（`schemas/run-meta.json`：`datasetId` + `commit`），把快照钉进状态机；
- 每个阶段的**出边**带该阶段 structured schema 的 schema-check（manifest `output_schema.<stage>.structured` 指向的 `schemas/<stage>.json`；内联草记记法已废弃，遇到即拒绝）；
- 声明了 `halt_on` 的阶段生成 `→ halted` 边，guard 指向约定文件 `schemas/<stageId>-halted.json`（const 校验在 schema 文件里）；
- 进入 `releasable` 带 file-check（`archive/workspace/`、`archive/verdicts/`，目录须非空）。

阶段状态按 manifest 中的位次命名（`stage1` → `stage-1`）；格产出文件是 `<stageId>.json` / `<stageId>.md`（提示词里写明）。schemaPath 相对模板自身位置生成——编排器把模板写在 plan 旁（`plans/<plan>.template.json`），与手写模板的 `../schemas/…` 同一解析方式。

## run 循环 v0（阶段一二；宿主目录或容器单元）

`ctx.eval.run(planPath, options)` 是本体；`/eval run` 是人的发起动作。流程：

1. **校验先行**：plan 有 error 即拒绝，什么都不执行；条件 lock 与现算哈希不符即拒绝（缺 lock 记 warning，用现算哈希——完整就绪检查归 I4 provision）。
2. **就绪检查（T23）**：建 run 之前，对 plan 里每个条件跑一次最小委派——同一门面、同一 provider、同一条 cwd 规则，见[「就绪检查」](#就绪检查每个条件一次真委派)。任一条件失败即整 run 不启动；`--ignore-readiness` 才允许带着失败条件开跑，此时该条件的格子一律记 `cell-skipped` 并给出理由。
3. **子集（T23）**：`--only <missionId,…>` 与 `--max-cells N` 在随机顺序上取一部分。选择落进 `run.meta.subset`（`{only, maxCells, totalCells, selectedCells}`），生成的模板只带被选中的 mission——ledger 里不会留下 run 永远不会驱动的格子。plan 契约不加字段：子集属于**一次执行**，不属于被审阅的那套程序。
4. **快照**：`datasets.snapshot` 钉 commit，进 run.meta。
5. **模板 + 矩阵**：生成模板写到 plan 旁；`expandMatrix` 展开（题 × 条件 × rep），`orderCells` 按 `plan.order.seed` 洗牌、interleave 时优先同条件不连续；顺序与并发数写进 run.meta。
6. **逐格**（并发缺省 1）：格子独立目录 `$DSH_HOME/state/eval/cells/<runId>/<missionId>/attempt-<N>/`，物化该题 visible 层内容并写 `materialization.json`（排序逐文件 sha256 + 整体 sha，addArtifact kind `materialization`）；每阶段一条 prompt = 题集 visible 层 `prompts/<stage>.md` 字节 + 一个换行 + 该题 `task.md` 字节，sha256 记入 orchestrator ns；编排器直接调 `ctx.localAgent.start`（首轮）/ `resume`（续轮），格子目录经委派 `cwd` 选项传给子代理（local-agent 家族的 cwd 支持，T11）。
7. **推进**：委派返回后从格子目录收 `<stageId>.json` / `<stageId>.md`，`submit({to, json, files})`（意向边预校验），`transition(to)`；`halt_on` 命中走 `halted`。schema 违规不重试：记 `{kind: 'submission-rejected', violations}`，格子停在当前态。
8. **失败策略**：委派启动失败、门面报错、超时取消 → `retry(reason, 'infrastructure')` 重做该格，预算缺省 1 次（`--retries` 可调）；超限记 `{kind: 'cell-skipped'}` 并跳过。超时 = `plan.budget.activeMinutes` 的每格累计委派时长，到点 `cancel(childSessionId)`。
9. **判定与归档**：格子停在终态后先判（见下节），判定落 `archive/verdicts/`，再把格子目录拷到 `archive/workspace/`，`transition(archived)`。缺省停在 archived；`--finalize` 显式推 `releasable → released`，file-check 要求 verdicts/ 非空——两条源里任一有产出即可过闸，两条都没有就如实记 `finalize-refused` 并停在 archived。
10. **导出**：结束时 export bundle 到 `<题库仓库>/exports/`（`--out` 可改），只收 visible 层（modelFacing:true，无需泄题闸确认）。

run 开始时先为每格写一条锚点 `{kind: 'cell', task, condition, conditionSha, rep}`——在任何工作之前，所以连被跳过的格子也可归属；报告只认这条锚点定格子身份（bundle 里没有 labels，mission id 是有损的）。

每次委派在 orchestrator ns 记 `{kind: 'delegation', stage, round, childSessionId, promptSha, startedAt, durationMs, usage, toolCalls?, cliVersion?, model: {declared, observed}}`（`toolCalls` 与 `cliVersion` 只在本轮 settled 事件带了才写，缺位就是「这一轮没人报过」）；`observed` 取自 T11 的回读——本轮 settled 事件优先，其次 `delegationOf(childSessionId)` 的记录。读记录要**等**：provider 在 settle 后的收尾遍里才并入观测，而门面在 result 落定的同一刻就清掉了带着 `onProgress` 的在跑记录，所以真实门面上 settled 事件根本到不了编排器、记录也要晚一拍才有值——run 结束即读会读空（第一次两格真跑的现场）。编排器因此在 settle 后有界地轮询记录（缺省 10s，`readbackWaitMs` 可调），等到与本轮开始前不同的观测即采用；等超时仍返回记录当前值（续轮跑的是同一模型时两者本就无从区分，记录本身的语义就是「该委派最近一次观测」），两处都没有才记 null。`usage` 只走 settled 事件：门面先清在跑记录的情况下这里拿不到，记 null 是诚实答案。回读到的模型与条件 `model.declared` 不符即当场失败（冻结决策 5：这次 run 归属错了），不按基础设施失败重试。

**声明的模型现在是「先请求，再核对」（T30b）。**从前 `model.declared` 只用来与回读比对，实际跑哪个模型全看 harness 自己的配置——判官条件声明 dsh v4-pro、实跑宿主默认 v4-flash，就绪检查因此拒（T22 第 5 步）。现在选手轮、判官委派、就绪探测三处都把非 null 的 `model.declared` 作为委派级 `model` 传给 local-agent，由它落成各家 CLI 的模型参数；声明为 null 就照旧不传。委派注解与 `run.meta.readiness` 各多一个 `requestedModel`，记的是「这一轮向 harness 要了什么」，与「读回来什么」并列。比对本身不变：请求了还回读到别的，仍是 MisattributedRun。resume 轮不带 model——local-agent 把首轮的请求记在委派记录里，之后每轮照它重发。

## 容器路径（I3·T20）

plan 里有 `unit` 段就走容器路径，没有就走宿主路径——后者与本节出现之前**逐字节相同**（pilot A 的 bundle 用本分支的 report 复算，`results.jsonl` 逐字节一致）。容器路径要 `ctx.lab` 在场；凭证不用另给——挂的是这台实例自己的作用域目录（见下）。

**一格一单元，顺序固定**（架构轨迹表第 11–17 步）：

1. **`acquire`**：镜像、网络、`user`、资源上限来自 plan 的 `unit` 段；**挂载只有一条**——该条件的凭证目录，`bind` 且可写（凭证续期要写回宿主，T17 的决定）；**env 只有**该条件 `unit.scopedHome.var` = 容器内路径，dsh 再加 `NODE_OPTIONS=--use-env-proxy`；`missionId` 与 `runId` 都带上。`workdir` 是 `/workspace`，并要求 lab 把它交给单元自己的用户（`ownWorkdir`）——docker 建出来的 workdir 归 root，非 root 单元写不进去。
2. **`setRefs({resource, fingerprint})`**：编排器自己写，acquire 之后立刻。lab 也写，但那是 warn-and-skip 的尽力而为，而「环境一致」这条不变量不能建在允许跳过的写上——pilot A 的指纹列整轮是空的，报告整轮 `unverifiable`。
3. **`populate`**：宿主物化目录 → `/workspace`，`manifestPath` 指向该 attempt 的 `materialization.json`，由 lab 算哈希、写文件、登记 artifact。编排器不再另算一份：两个同名 `materialization.json` 带两个不同哈希，比任一个单独存在都糟。工作区里因此**只有题面字节**——没有清单，也就没有宿主路径进单元。
4. **每阶段一轮委派**：`exec = {container, workdir: '/workspace', env: {<VAR>: <容器内路径>}}`，**不传 `cwd`**（单元里宿主 cwd 没有意义；作用域目录变量不点名的话 T17 会当场拒绝这一轮）。
5. **每阶段结束 `checkpoint({name: <阶段 id>})`**（ref 经 lab 进 mission），再 `collect('/workspace' → 格子目录)`。格子目录在容器路径上是**工作区的宿主镜像**：收产出、结构校验、`submit`、判官取材都在它上面，因此第 7、9 两步的代码两条路径共用。
6. **判定在单元内**：探针经 `lab.verify` 跑，判定材料走 verify 自己的 scratch（`/run/dsh-lab/verify`，跑完即删）；`--out` 写到 `/run/dsh-lab/verdicts/<探针>/`，**不在 `/workspace`**——归档是选手的产物，不该带判定输出。全部跑完一次 `collect` 把整棵 verdict 树收回该 attempt 的 `probe-verdicts/`，在宿主上解析、判定，再删掉单元内那个目录。退出码三态、`task` / `by` 先回填后校验的顺序，与宿主路径逐字相同。
7. **`archive`**：lab 导出 `workspace/` 与 `manifest.json` 到该 attempt 的 `archive/`；`verdicts/` 早已在旁边（判在归档之前，闸要求它非空）。

### 「环境一致」比的是环境类

`refs.fingerprint` 记的不是单元的完整指纹，而是**环境类**：单元的复合指纹分量减去**该条件自有的那几项**——它自己的作用域目录挂载 target、指向它的变量名、该 harness 的额外变量（dsh 的 `NODE_OPTIONS`）、以及条件 `env.keys` 里声明的键。剩下的是计划声明的那部分：image、资源上限、network、user、计划级挂载与 env 键。

不这么做的话这条不变量对本 profile 存在的理由恰好不成立：四家各挂自己的凭证目录、各设自己的变量（`CODEX_HOME` / `CLAUDE_CONFIG_DIR` / `KIMI_CODE_HOME` / `DSH_HOME`），同一个 run 必然四个指纹，报告按既有规则记 `violated` 并拒绝比较——而那四个环境在比较关心的每一个意义上都是同一个。

减法是**照着造 spec 的那段代码反着读**出来的，不是从分量里猜的：`acquireSpecFor` 放进去哪几项，`conditionOwnedComponents` 就取回哪几项。哈希规则不复刻——环境类经 `lab.fingerprintOf(components)` 算，与 `acquire` 用的是同一个函数，因此派生出来的类与单元自己的指纹天然可比。标签仍是 `lab-env:<sha256>`，分量 `version` 不变：它只是同一套算法作用在少了几项的分量上。

单元自己的完整指纹并没有丢：它记在该格 orchestrator ns 的 `unit` 注解里（连同被排除的项），也在 lab 写的 archive `manifest.json` 里。它**不进 refs**——mission 的 refs 只有 `resource` / `fingerprint` / `sessions` 三个键，加第四个是 mission 的改动，不属于本包。报告在不变量那一行下面把每格的单元指纹与排除项逐格列出，读者能看见差在哪儿，而不用信。

### 判定目录按题库的真实相对路径物化

题集级 verify 层是真目录（`datasets/<id>/verify/`），因此落在 `<判定目录>/verify/…`。**item 的层**是两种布局分岔的地方，错一层的代价正好是一个目录：

- 约定式：文件在 `items/<id>/verify/`，display 路径相对它（`probes/x.mjs`）；
- register：descriptor 把 item 目录里的自由文件归位到层角色，display 路径是 **item 相对**的（`checks/probes/x.mjs`），文件真的在 `items/<id>/checks/probes/x.mjs`。

两种都按 `items/<id>/verify/<display>` 物化，register 的题就深了一层，`../../../../verify/helpers/lib` 落到判定根之外——题内探针只能自带一份题集级 lib 的副本。现在每个文件落在它在题库里的真实相对目录：哪些 display 是被 register 归位过的，从 `datasets.show` 顺带返回的 descriptor 里读 `register` 判断（面上是可选字段，不报的门面退回约定式，与从前相同）。探针的 `by` 仍是 display 路径——那是判定的出处，不是磁盘上的位置。

探针的 cwd 是**该题 checklist 所在的目录**：约定式是 `items/<id>/verify`，register 归位后是 `items/<id>/checks`，两种布局下共享探针读到的都是这道题自己的 `./checklist.yml`。没有 checklist 的题回退到约定根。

### 一份物化哈希，两条路径

`materialization.json` 两条路径都由编排器按同一套算法算（排序后逐文件 sha256 再整体 sha256），因此同题同 commit 在宿主与容器里得到**同一个数**。此前容器路径记的是 lab populate 的 manifest 哈希，「题面一致」这条不变量只能在一条路径内部回答。lab 自己那份哈希没有丢，它换了个名字单独存在该 attempt 的 `populate-manifest.json` 里——那是另一个主张（「拷进单元的是这份」），不是同一个数的第二种写法。

### 目录与凭证约定

- 容器路径挂的是**评测实例自己的作用域目录**：`local-agent` 为该 harness 建的 `<homesRoot>/<家名>`，`bind` 到该条件 `unit.scopedHome.container` 声明的容器内路径，可写。凭证由这台实例上的 `/<家> login` 写进去，**不 stage 副本**；续期失败或目录被清空，就在这台实例上重登。
- 必须是同一个目录，不能是副本：容器轮的 CLI 把 rollout / session 写进被挂进去的那个目录，而委派回读按 `homeDir(家名)` 去找。指到两处不报错——回读永远为空，`model.observed` 每轮都是 null，就绪检查报 `ready, model —`，报告的「受试对象一致」停在 ⚠️。这正是 T20 用独立凭证树时的行为，pilot B 付过一次账。
- **每条件一份作用域目录**：条件可选的顶层字段 `scope`（只允许 `[a-z0-9-]`，是名字不是路径）把该条件的挂载源与委派换成 `<homesRoot>/<家名>@<scope>`——与缺省目录同级、各自登录的另一份。缺省即不写，行为与本字段出现之前逐字节相同。`scope` 进条件哈希：两条只差 scope 的条件是两个受试对象（登录的是两个账号），所以同一家在一次 run 里可以比两个账号。就绪检查按各自的 scope 探各自的目录，容器格挂各自的目录，`run.meta.unit.scopedHomes` 每条记下它的 `scope`（宿主路径照旧不进 bundle——那是运维事实）。
- 编排器只检查这个目录**存在、非空、属主**，绝不读内容。空目录的意思就是「这台实例上还没人登录过这一家」——开跑前拒绝，比二十四格各自 401 便宜。
- attempt 的运行数据目录多两样：`materialization.json`（编排器算的物化清单）与 `probe-verdicts/`（探针在单元内产出的原始判定）。工作区的宿主镜像不进 attempt 目录，位置记在 `workspace-mirror.json` 里。

### 销毁路径唯一

`run.ts` 里只有一个 `destroyUnit`，`lab.release` 只在它里面出现：

- **过闸即销毁**：`--finalize` 时 `archived → releasable` 一过就销毁，然后才 `→ released`。位置是刻意的：`isReleasable` 读的是**当前**状态，而模板的 releasableStates 只有 `releasable`——先走到 `released` 再销毁，闸会答否，于是每个容器都活着。
- **闸拒绝即留下**：没有 `--finalize`、或 verdicts 为空导致 `releasable` 过不去，销毁照样问一次、照样被拒，**容器留着**并在格子上记一条 `{kind: 'unit-retained', reason}`。没人看过的格子，现场比容器数值钱。
- **异常路径先归档再释放**：格子抛错（基础设施失败、schema 拒绝、归属错误）时先 `collect` 再 `archive` 再走同一条闸——不归档就 release 等于毁证据（lab README「失败恢复循环」）。同样不带 force，所以失败的格子会留着它的容器。
- **`force` 在本文件里只有一处**：就绪检查的探活单元。它不绑 mission，因而没有闸；lab 要求这种销毁必须显式 `force`，正是为了让「无闸销毁」是一句判决而不是一个默认。

### 已知取舍

- **串行**。容器路径固定 `concurrency: 1`（显式给 >1 会被拒），并发单元归 I4。`acquire` 撞上 `maxConcurrentUnits` 当缺陷报出来，不排队。
- **多家横比的指纹问题已由环境类解决**（见上）：`refs.fingerprint` 记环境类，单元自己的指纹记在 `unit` 注解与归档 manifest 里。
- **物化哈希两条路径统一**（见上）：`materialization.json` 由编排器按同一算法算，lab 的那份另存 `populate-manifest.json`。报告仍兼容旧 bundle 的 `sha` 字段。

## 就绪检查：每个条件一次真委派

`/<harness> status` 回答的是**形状**问题——scoped home 里有没有一份形状对的凭据记录。一份过期且刷不动的记录，读起来和一份能用的一模一样。pilot A 就照单全收了这个答案：`claude-code status` 报 `authenticated: yes`，而同一时刻每一次委派都 401，24 格里 6 格在开跑前就注定全废，而第一份证据要到第一次委派才出现。

判官条件同样在内。判官也是一次会失败的真委派，而失败的代价更大：一个选手条件挂了只损失它自己的格子，判官挂了损失的是整轮的 llm-draft 判定——pilot B 的两个判官样本全掉，run 却一路走到 `released`，llm-draft 命名空间是空的。所以判官按同一条规则探、同一条规则拒，结果以 `role: 'judge'` 记进 `run.meta.readiness`。判官在宿主上委派（判定是编排器发起的，不是格子发起的），因此容器路径下它也在宿主上探——探一个它根本不会遇到的环境毫无意义。

所以开跑前的检查不问，只花一次委派。`runCreate` 之前，对 plan 里每个条件用逐字节确定的一句话提示词 `READINESS_PROMPT`（回一个 `READY`，不用工具、不写文件）跑一次委派——**与正式格子同一门面、同一 provider、同一条按目录给 cwd 的规则**，不另开后门，所以探针证明的就是格子将要遇到的。条件只有在委派**既起得来又返回 `stopReason: 'completed'`** 时才算就绪；探针**请求**条件声明的那个模型（与格子将要请求的同一个），并回读实际模型，与 `model.declared` 不符即当场判该条件不就绪（冻结决策 5，在开跑前拦下，而不是等到第一个阶段轮次）。

每条判定是一条 `{kind: 'readiness', condition, harness, provider, ok, startedAt, durationMs, childSessionId, declaredModel, requestedModel, observedModel, reason?}` 记录，既进 `run.meta.readiness`，也作为 orchestrator ns 注解写到该条件的每一格上——问「这格为什么没产出」的人，在格子上就能看到答案。任一条件失败即整 run 不启动并打印原因（打印的是那句 401，而不是「有个条件失败了」）；`--ignore-readiness` 才允许开跑，此时该条件的格子一律记 `cell-skipped` 并给出理由，一次委派都不发。

## `finalize`：跑完之后的再入口

`--finalize` 只在 run 启动的那一刻存在，而「判官与终评」恰恰是归档**之后**的工作。pilot A 因此人手把十二格逐个 `dsh-mission transition` 推过去。`/eval finalize <runId>` 就是这条路，机械化：对 run 内每个 `archived` 的格子走同一条闸（`archived → releasable → released`，含归档闸对 `verdicts/` 非空的 file-check），非 `archived` 的格子逐格列出状态并跳过。

它不 force。闸拒绝按格记 `{kind: 'finalize-refused', from, error}` 到 orchestrator ns，格子停在闸拦下它的地方——闸正是「归档」这两个字有意义的原因。它也不碰没走到 `archived` 的格子：pending 或半途的格子是**没做完的工作**，不是**没释放的工作**。跳过按 `already-released` / `interrupted` / `not-started` 归类，一整个 run 一行就能说清。

进程外没有 mission 服务，所以 `dsh-eval finalize` 以子进程调用 `dsh-mission` 的 CLI（`--data-dir`、`--mission-cli`、`$DSH_MISSION_CLI`）——正是人手工用的那条缝。eval 仍然不 import mission 包的任何东西。

## 判定：探针（script）与判官盲评（llm-draft）

格子跑完阶段、停在终态后，编排器在归档前跑两条机器通路。完整契约见 [协议 §6.7 / §6.8](../../docs/dataset-authoring-protocol.md)；这里是实现侧的读法。

**探针（`script`）** —— 任意 `probes/` 段里的 `.mjs` / `.sh`，来源有两处：**题内**（该题 verify 层，只判这道题）与**题集级共享**（题集级 verify 层，对每道题各跑一次；`shared/no-patch.sh` 这类「所有题共用同一把尺子」的判据归这里）。调用约定 `<probe> --cell <格子目录> --rubric <rubric 路径> --out <verdicts.json>`。

**退出码三态**：`0` = 已判定（含 `pass: false`），记 `judged`；`3` = **本轮不适用**（探针没坏、判据也没不成立，只是输入不在位——阶段三没跑、harness 工作树不在格子里），记 `probe-skipped` 并附 stderr 首行，**不算失败**；其余非 `0` = 探针失败，记 `probe-failed`。退出 `0` 却写不出可读的 `--out`，按失败记。用 `3` 不用 `2`：`2` 是 getopt 传统的「用法错误」码，读成「判不了」会咽下每一次误调用。

**执行环境**：**两个 verify 层都整层物化**进宿主临时目录，相对布局与题库一致（`<tmp>/verify/…` 与 `<tmp>/items/<题 id>/verify/…`），题内探针因此能用在题库里同样成立的相对路径 import 题集级共享库（`../../../../verify/helpers/lib/x.mjs`）。cwd 一律是该题 verify 层的根，共享探针也一样。跑完整个目录删除（I3 起交 `lab.verify` 进容器，契约不变）。

**`task` / `by` 先回填、后校验**——两项都是 `required` 且 schema `additionalProperties: false`，反过来会把探针没写这两项的完整判定判成废品。`by`：题内探针 = 它在该题 verify 层的 display 路径；共享探针 = `shared/` + 它在题集级 verify 层的 display 路径。探针写了但与编排器不一致的，以编排器为准并把 `overwritten` 记进 orchestrator ns。带 `ratio` 的判定在源头核两条数值约束（`total > 0` 且 `0 ≤ passed ≤ total`、`pass === (passed === total)`），不符按产物不合契约记——报告侧的退回布尔是兜底，不是唯一的闸。

产出写 `script` ns 与 `archive/verdicts/script.json`；两个层都没有探针就什么都不写。每次探针运行的记录（`{probe, origin, exitCode, outcome, ok, verdicts, durationMs, error?, reason?, overwritten?, dropped?}`）进 orchestrator ns 的 `kind: 'probes'`。

**判官盲评（`llm-draft`）** —— 判官本身是一份 condition，由 `plan.judge.conditions` 指定，`plan.judge.samples`（缺省 2）是每个判官条件的采样数。三条约束由编排器强制（冻结决策 9）：

- **判官不得是选手**：除 validate 的 id 交集检查外，run 前再比一次 `(harness.name, model.declared)`——不同 id 指向同一受试对象照样拒绝，并说明撞在哪一条上。
- **判前去指纹**：`stage1.json` / `stage1.md` / `stage2.json` / `stage2.md` 里的 harness 名、CLI 名、成员自报名字换 `<harness>`，plan 各条件的模型标识换 `<model>`；替换表与次数记 `{kind: 'deidentify', files, table, total}`，**原件不动**，判官只看副本。
- **双采样**：每个样本是**全新委派**（续聊会让判官看见自己上一次的答案），独立 cwd = 判官材料目录。

judge prompt = 该题 grading 层 rubric 里 `kind: llm-draft` 的判据（`objective` 归探针、`human` 归判官台，都不给判官看）+ 去指纹材料 + 输出要求。判官把 `dataseek.verdict/1` 数组写进自己 cwd 的 `verdicts.json`；读不出来记 `{kind: 'judge-parse-failed'}` 并**重试一次**，再失败该样本如实丢弃。每个样本一条 `llm-draft` 注解 `{sample, judgeCondition, judgeSha, promptSha, verdicts}`，并落 `archive/verdicts/llm-draft-<判官条件>-<样本号>.json`；`task` 与 `by` 由编排器回填（判定方只是回声，写错会污染报告的每一次 join）。

判官的用量与耗时记 `{kind: 'judge', judgeCondition, judgeSha, sample, attempt, childSessionId, promptSha, startedAt, durationMs, usage, model}`——`kind` 不是 `delegation`，所以**不进报告的选手效率表**。判官材料目录（`$DSH_HOME/state/eval/judge/<runId>/…`：prompt + 去指纹材料 + 判官的回答）在 run 结束后保留，供复核；探针目录跑完即删。

grading 与 verify 层只经 datasets 服务面以显式单层 scope（`layers: ['grading']` / `['verify']`）读取，物化进宿主侧目录，**绝不进选手格子**。

## 服务面 `ctx.dshEval`

服务的 cordis 名是 `dshEval`，**刻意不叫 `eval`**：loader 用 `with (ctx) { return eval(expr) }` 求值配置里的 `!!js` 表达式，ctx 上的 `eval` 属性会遮蔽全局 `eval`，凡挂载本包的组合一遇 `!!js` 即炸（真实 3171 实例踩出）。包名、入口 id（`eval`）与 `/eval` slash 名不受影响。

| 方法 | 作用 |
|---|---|
| `validatePlan(planPath)` | 校验 plan schema 与语义（判官≠选手、judge/expectedNs 交叉检查、预算下限），解析条件声明与 lock，lint 阶段 schema，并交叉核 `expectedNs` 与每道题**实际能产出什么**——声明 `script` 但 `verify/probes/` 无可执行探针、声明 `llm-draft` 但没有 rubric 或 rubric 无 `kind: llm-draft` 叶子，两者都按 warning 报出（T23；题库侧的检查归 T26）。数据问题以 diagnostics 返回（`errors` / `warnings` 各带稳定 code），从不 throw |
| `hashCondition(condition)` | 条件哈希 = 规范化 JSON（键排序、无空白）的 sha256，`notes` 不参与（改注释不是换条件）。非法文档抛 `EvalContractError` |
| `hashHome(homeDir)` | scoped home 内容哈希：只取配置类文件，按拒绝清单跳过凭证形状的路径；内容只进摘要，绝不返回或打印 |
| `generateTemplate(manifestPath, opts?)` | 由题集 manifest 生成 run 模板（可选项：`stages` 子集、`missions` 格批次、`name`、schemaPath 前缀）。纯函数：不探测 schema 文件，探测归 mission 的 runCreate lint |
| `run(planPath, options?)` | run 循环本体（见上节）。缺 datasets / mission / localAgent 任一即拒绝并列出哪个；`dryRun` 选项只做校验 + 模板 + 矩阵 + 顺序，不需要任何上游 |
| `conditions({repo?, dataset?, session?})` | 列出题库声明的条件：harness、声明模型、条件哈希、就绪（lock 在不在、还对不对、home 是否核过）、未解析字段。`repo` 缺省时取会话的 datasets 绑定，并遵守绑定的题集白名单——agent 能看哪些题集是人的决定 |
| `runStatus(runId)` | 投影一次 run：run.meta 摘要（planSha、快照 commit、条件、随机顺序与种子、启动时间）+ 逐格一行（题、条件、rep、attempt、状态、桶、编排器最近一条注解、submission-rejected 次数）。缺 mission 服务即拒绝并说明原因 |
| `finalize(runId, options?)` | 把 run 内每个 `archived` 的格子走一遍 `archived → releasable → released`（与 `--finalize` 同一条闸），非 archived 的格子逐格列出状态。闸拒绝按格记录，不 force。组合里没有 mission 服务即拒绝并说明原因 |
| `report(bundleDir, {out?})` | 把 mission export 的自包含 bundle 变成 `results.jsonl` + `summary.md`（见下节）。只读 bundle，写入缺省 `<bundleDir>/report/`，重复运行覆盖（报告是派生态，bundle 本身只增不改） |

## 报告（report）

输入是 mission export 的 bundle（manifest.json、run.json、missions/<id>/attempt-N/{meta,annotations,artifacts}、dataset/<layer>/），输出三份文件：

- **results.jsonl** — 一行一个判定：`{task, condition, conditionSha, rep, attempt, stage, ns, criterion, pass, ratio?, weight?, negative?, toolCalls?, evidence, by}`（`toolCalls` 是该**格**各轮工具调用之和，本格没有任何一轮报过就整个键缺位——因此在旧 bundle 上复算出的 results.jsonl 逐字节不变）。ratio 只在判定声明了可用的 `{passed, total}` 时出现；weight / negative 只在该判据的极性可知时出现（见下）；stage 取自注解记录的 stage 字段（判定契约本身不含 stage，未记录即 null）。
- **summary.md** — 开头先核四条不变量（题面一致 / 环境一致 / 受试对象一致 / 程序一致）。**任一项不成立或无法核验，只输出事实表，不输出比较**。比较启用时：因子由 run.meta.conditions 的条件文档两两 diff 推出（只差一项即因子名，差多项标「多因子」只做描述统计）；配对以题为区组、rep 为重采样单元，输出逐题差值（得分判据数与加权分）、n、自助法 95% 置信区间（seed 确定性，统计手写无依赖）；n < 3 或因子未知/多因子时打印「不可排名」并拒绝名次。判官一致性按 criterion 算双采样一致率与 Cohen κ，human-final 在场时算 llm-draft 对终评的一致率。效率并列不合成，且每一项**只统计已完成的格子**（`judged` / `archived` / `releasable` / `released`）：活跃时长（委派 durationMs 之和）、工具调用（各轮 `toolCalls.count` 之和；没有任何一轮报过计数就打「—」而不是 0——「没人报过」不是「一次没用」）、标价成本（run.meta.pricing 给了才有）、委派轮次（只在双方都完成的题上比）、token 只在同模型内比。未完成格子的委派时长买到的工作量未知，混进来得到的数没有意义——pilot A 两家活跃时长同为 21.0 min，那个巧合就是一格只跑了阶段一的 dsh 格子撑出来的。被排除的格子按条件与状态在表下单列一行；`results.jsonl` 不受影响。「程序一致」一节在 run 记了 `run.meta.subset` 时把它打印出来，只覆盖了一部分 plan 的 run 因此不会被读成完整的。expectedNs 里某 ns 的判定全由 `tool:` 写入时 summary 顶部红字标出。

- **usage.jsonl** — **一轮委派一行**的花销台账：`{run, cell, attempt, condition, task, stage, round, counted, observedModel?, cliVersion?, durationMs?, usage?, toolCalls?}`。这里不聚合、不计价——效率表由它汇总，外部计价也只读它。`counted` 说明这一轮是否在效率表口径内（当前 attempt 且已完成，T23 规则）：把某条件 `counted: true` 的行加起来，就逐项等于它在效率表里的那一行；`counted: false` 的行是表**有意排除**的花销，留在这里而不是丢掉，好让外部按自己的口径取用。取不到的字段一律缺位，绝不补零——「没人报过」和「花了 0」是两件事。

判定源按权威排序取各格的主判定（human-final > llm-draft > script，同判据多样本按多数计）；rep 是独立样本，attempt 只算基础设施重试——所有 attempt 的判定都进 results.jsonl，聚合只用各格最新 attempt。

### 判据极性与权重表（协议 §6.5）

`pass` 恒为「判据成立」。负分判据的 criterion 写的是缺陷，成立即缺陷存在——所以报告的主轴是**得分判据数**：正向判据成立计 1，负向判据成立计 0、不成立计 1；加权分 = Σ weight × 该判据得到的比例，负 weight 自然扣分。摘要另出一张「负向判据命中」表（哪格、哪条、比例、证据），那是缺陷清单。

「按比例给分」的判据（F2 / F3 的 C1、C2）在判定里带可选的 `ratio: {passed, total}`（协议 §6.5）：报告按 `passed / total` 计分而不是布尔（负向判据计其余量 `1 − passed/total`），同判据多样本取所给比例的均值。`pass` 仍是那个布尔事实（判据**完整**成立），`ratio` 只是细化它——读不懂 ratio 的消费者退回严格布尔，只会低估。比例只走字段：报告**从不**去解析 `evidence` 里的「通过 6/9」之类前缀；`total ≤ 0` 或 `passed` 越界的比例按缺失处理并在附注里点名。

极性来自 rubric，不来自 verdict。rubric 住在 grading 层、不进 bundle，所以 run 在导出后从 grading 层**派生**一份权重表写进 `<bundle>/report/rubric-weights.json`（`dataseek.rubric-weights/1`：`{task, id, weight, negative, kind, axis}`，只有编号与数字，**不含 criterion 文字与 evidence**，因而不经泄题闸）。报告优先读它，其次读 bundle dataset 层里的 rubric（有意开闸导出时）。两者都没有时，报告只出计数，并明确打印「极性未知，计数按正向处理」、把负向判据数记为 unknown——不把「无从判断」显示成「没有缺陷」。`report` 只读这个文件，从不改写它。

## 模型工具（只读，三个）

agent 在一次实验里只出现两次：规划期起草、分析期读结论。两次都不需要写。所以本包注册的模型工具**只有三个，全是读**，并且刻意没有第四个——能起 run 的 agent 就能起一次人没批准的 run。

| 工具 | 答什么 |
|---|---|
| `eval_conditions` | 题库里有哪些条件、各自的哈希与就绪状态、哪些字段还是 null。参数 `repo`（缺省取会话的 datasets 绑定）与 `dataset`（缺省扫全库）|
| `eval_plan_validate` | 给定 plan 路径的校验结果：`ok` / `errors`（不能跑）/ `warnings`（还没解析）与解析出的条件 sha。校验从不启动任何东西 |
| `eval_run_status` | 一次 run 的 run.meta 摘要与逐格状态；数据源是 `mission.runStatus` 与 orchestrator ns |

写类动词一个都不开：run 由人在会话里用 `/eval run` 发起，materialize / submit / transition / annotate / archive / export / finalize 归编排器服务面与人的 CLI（profile 的[「工具按域开放」](../../profiles/web-eval/README.md#工具按域开放)）。

配置项 `tools: 'all' | 'none'`（缺省 `all`）。没有更细的分组，因为没有可分的：本包一个写工具都不注册。`none` 时插件只留 slash、CLI 与服务面。

工具注册走**延迟注入**（`ctx.inject(['tools'], …)`）而不是 apply 期的 `ctx.get('tools')` 探测：探测会和工具注册表自己的挂载顺序赛跑并且输，工具静默地一个都注册不上，还没有任何东西会说（room 与 worktrees 都踩过并修过同一处）。延迟注入在注册表出现时才触发，在没有注册表的组合里永不触发——那样的组合保留 slash、CLI 与服务面，绝不炸启动。`tool:eval` 提示词段同理走 `systemPrompt` 的延迟注入。

## slash 与 CLI

```sh
/eval run <plan.json> [--concurrency N] [--dry-run] [--finalize] [--out DIR] [--retries N]
                      [--only id,id] [--max-cells N] [--ignore-readiness]
/eval finalize <runId>
```

run 的发起是人的动作：在 web-eval 实例的会话里执行，该会话即 originSession 与所有委派的父会话。不注册任何 run 类模型工具——写类动词归编排器服务面与人。

```sh
dsh-eval validate <plan.json>             # 校验 plan；报告 JSON 走 stdout
dsh-eval run <plan.json> --dry-run        # 离线彩排：校验 + 模板 + 矩阵 + 顺序；不带 --dry-run 一律拒绝
                                          #   [--only id,id] [--max-cells N] 彩排一个子集
dsh-eval finalize <runId>                 # 把 archived 的格子走一遍释放闸
                                          #   [--data-dir DIR] [--mission-cli PATH]；以子进程调 dsh-mission CLI
dsh-eval template <manifest.yml> [--stages a,b]  # 打印生成的 run 模板
dsh-eval conditions hash <condition.json> # 打印 { id, sha, warnings }
dsh-eval report <bundleDir> [--out DIR]   # 出 results.jsonl + summary.md；摘要 JSON 走 stdout
```

数据走 stdout JSON，诊断走 stderr；退出码 0 ok / 1 失败 / 2 用法错误（与 `dsh-lab` 一致）。CLI 直连内核，不需要宿主在跑——脚本场景与已挂载插件行为完全一致；进程外没有活的父 Agent，所以 CLI 的 `run` 只做 `--dry-run`。`finalize` 不需要父 Agent、只需要 ledger，所以它在进程外以子进程调 `dsh-mission` CLI 照常工作；任一格闸拒绝即退出码 1。

## 哈希规则

- **条件哈希**：规范化 JSON（键全排序、无空白）的 sha256 小写十六进制；`notes` 除外。
- **planSha**：plan 全文档规范化 JSON 的 sha256（含 notes——审阅时改注释也会换 plan，这正是「同 plan 即同一套程序」的口径）。
- **home.sha**：只哈希配置类文件（`.json .jsonc .yml .yaml .toml .ini .cfg .conf .xml .properties`），按相对路径排序后对 `<relPath>\0<content>\0` 逐文件喂 sha256。拒绝清单：`auth.json`、`.env*`；文件名含 `token` / `key` / `credential` / `secret` / `password` / `auth`（不分大小写）；`credentials/`、`oauth/`、`sessions/`、`keys/`、`secrets/` 目录整棵跳过；符号链接与超大文件（>1 MiB）跳过。文件内容绝不读入日志、绝不打印。
- **materialization.json**：该题 visible 层文件按路径排序后逐文件 sha256，整体 sha 按排序 `<path>\0<fileSha>\0` 折进 sha256——同题各格可被证明题面一致。

## 兼容性

- npm release line（`@deepseek-ai/dsh@0.1.2-rc.1`）：✅ —— 消费 `Context.provide` 与 `commands`；run 时探测三个兄弟服务，缺席即拒绝，不炸启动。minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- source line（deepseek-harness master）：✅ —— 同上（verifiedHost: 0.1.2-rc.1）。

降级 / 缺席项（与 package.json 的 `dsh.compat` 同步）：

- 三个只读工具与 `tool:eval` 提示词段走延迟注入：组合里没有工具注册表 / systemPrompt 时它们不注册，slash、CLI 与服务面照常，不炸启动。
- 面向早于 T11 的 local-agent：委派 `cwd` 被忽略、子代理继承父会话 cwd，格子因收不到产出文件而如实拒绝（submission-rejected），不会错记；`delegationOf` 与 settled 回读均缺席时 `usage` 与 `model.observed` 记 null，「受试对象一致」在报告里降为不可核验，而不是假定成立。判官同样靠 `cwd` 收 `verdicts.json`，没有 cwd 时该样本按解析失败记，不会误判。
- `human-final` 不由本包写：它只从判官台或 `dsh-mission annotate --ns human-final` 进来（I5）。
- 没有 `ctx.lab` 的组合照常跑宿主路径；只有带 `unit` 段的 plan 会因为缺 lab 而被拒绝，并在拒绝语里点名。

## 状态

I2：T2 离线动词、T8/T8b 编排器 v0（模板生成、矩阵展开、run 循环阶段一二、格子锚点、T11 回读回填、slash、CLI dry-run）、T10 `report`（results.jsonl / summary.md / 四条不变量 / 配对差值与置信区间 / 判官一致性 / 效率并列）、T9 判官（探针契约、去指纹、双采样盲评、`--finalize` 过闸）、T14 三个只读模型工具已落地。I3：T23 补上 pilot A 暴露的四条编排器缺口——开跑前就绪检查（G4）、`finalize` 再入口（G13）、效率表只计完成格（G15）、`--only` / `--max-cells` 记进 `run.meta.subset`；T28 补上 T19 探针自测暴露的三条——题集级 verify 层物化与共享探针执行、退出码三态、`task` / `by` 先回填后校验。T20 落地容器路径：plan 的 `unit` 段一格一单元（acquire → populate → 逐阶段委派与 checkpoint → 探针经 `lab.verify` 在单元内 → archive → 过闸 release），`refs.fingerprint` 由编排器写入，四条不变量之二从此可核验。provision（I4）、并发单元（I4）、界面（I5）按 web-eval 迭代计划推进。

## 许可

[MIT](../../LICENSE)
