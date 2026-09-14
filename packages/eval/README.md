# dsh-eval

中文 | [English](README.en.md)

**web-eval 编排器：dataseek 契约 schema、plan/condition 校验、条件与 scoped home 哈希、由题集 manifest 生成 run 模板、阶段一二的 run 循环（逐格物化、逐字节委派、提交推进、归档闸、bundle 导出）。** run 的发起是人的动作（`/eval run`，发起会话即所有委派的父会话）；判定的两条机器通路（探针写 `script`、判官盲评写 `llm-draft`）随 T9 落地，`human-final` 仍归人。不依赖任何兄弟插件——四个上游服务（datasets / mission / localAgent）在 run 时经 `ctx.get` 探测，缺哪个就拒绝并列出哪个，绝不炸启动。

给 agent 的模型工具只有四个读工具（见「模型工具」一节），run、finalize 与注解都不给模型。

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
2. **出网自检（T29d，plan 声明了 `unit.egressCheck` 才有）**：`acquire` 之后、`populate` 之前，经 `lab.verify` 在单元里跑一次 plan 声明的那条命令，退出码 0 才继续。**先问再用**的理由是实测出来的：`eval-net` 是 `--internal` 网络，出网全靠边车代理；边车停掉时 codex 在单元里正常起来、读到自己的模型与沙箱档位、跑满 230 秒，然后 `task_complete` 的 `last_agent_message` 是 **null**——一个空回答，没有一句网络错误。上面每一层只能读成「探针失败」，而同样的四分钟会在每一格重演。就绪探针的单元同样先问、且在**委派之前**问，所以出网断了是一次 `EGRESS_UNAVAILABLE` 拒绝，**一次委派都不花**。命令与目标写在 plan 里（与网络放在一起），编排器自己不持有任何地址；声明为空或含空词，run 以 `EGRESS_CHECK_MALFORMED` 拒绝。plan 有 `network` 却没声明自检时，run 在日志里说一次——能跑，但这一轮分不清「网络不通」与「模型没话说」。
3. **`setRefs({resource, fingerprint})`**：编排器自己写，acquire 之后立刻。lab 也写，但那是 warn-and-skip 的尽力而为，而「环境一致」这条不变量不能建在允许跳过的写上——pilot A 的指纹列整轮是空的，报告整轮 `unverifiable`。
4. **`populate`**：宿主物化目录 → `/workspace`，`manifestPath` 指向该 attempt 的 `materialization.json`，由 lab 算哈希、写文件、登记 artifact。编排器不再另算一份：两个同名 `materialization.json` 带两个不同哈希，比任一个单独存在都糟。工作区里因此**只有题面字节**——没有清单，也就没有宿主路径进单元。
5. **每阶段一轮委派**：`exec = {container, workdir: '/workspace', env: {<VAR>: <容器内路径>}}`，**不传 `cwd`**（单元里宿主 cwd 没有意义；作用域目录变量不点名的话 T17 会当场拒绝这一轮）。
6. **每阶段结束 `checkpoint({name: <阶段 id>})`**（ref 经 lab 进 mission），再 `collect('/workspace' → 格子目录)`。格子目录在容器路径上是**工作区的宿主镜像**：收产出、结构校验、`submit`、判官取材都在它上面，因此第 7、9 两步的代码两条路径共用。
7. **判定在单元内**：探针经 `lab.verify` 跑，判定材料走 verify 自己的 scratch（`/run/dsh-lab/verify`，跑完即删）；`--out` 写到 `/run/dsh-lab/verdicts/<探针>/`，**不在 `/workspace`**——归档是选手的产物，不该带判定输出。全部跑完一次 `collect` 把整棵 verdict 树收回该 attempt 的 `probe-verdicts/`，在宿主上解析、判定，再删掉单元内那个目录。退出码三态、`task` / `by` 先回填后校验的顺序，与宿主路径逐字相同。
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

## 能力面：`preset` 从声明变成事实

条件文档里的 `preset` 一直是一句**没有对应物**的话。它进条件哈希，所以两条只差 preset 的条件在账面上是两个受试对象；但从来没有任何东西把 preset 写到哪里去过，也就没有任何东西能与它不符。T32 给了它对应物：

- **谁可以声明。** 只有 `dsh`。它的作用域目录里那份子 profile 是评测实例自己写的，preset roster 是那份 patch 的一层。三家外部 CLI 跑厂商自己的编排，本家族组不了——给它们写 preset 由 validate 报 error（`PRESET_NOT_FOR_HARNESS`），只能写 `null`。它们那侧的等价物是 `skills.pack`，同样尚未落地（I6）。
- **provision 写下实物。** `conditions provision`（T31）在 `provisioned` 里多记两项：`preset` 从写出去的子 profile 回读，`capabilities.sha` 是 capability-catalog 对那份已配好的环境算出的**能力哈希**（规范形取技能的 name/source/正文 sha 与工具的 name/channel/parameters——描述措辞不进，改一次文案不该换一个受试对象）。测量由**实例内的探针**做（T32b，见下）；没有 catalog 的组合里探针不在，条件照样落 lock 但不带能力记录，并按名报 `CAPABILITIES_UNMEASURED`——之后就绪检查再拒一次。
- **就绪检查还比新鲜度。** lock 记的是 provision 当时的哈希；run 起来时就绪检查**再量一次**，两者不等即判该条件不就绪、点名「preset 在 provision 之后变了」。少了这一步，lock 会永远读作「已核对」而它量的那个 preset 在底下被改——而改技能**正文**不会动任何别的已记哈希（`home.sha` 只哈希配置类文件，不含 SKILL.md），只有这一步看得见。量不出来（catalog 不在、preset 挂不起来）时，原记录照旧算数：测不到是关于 catalog 的证据，不是关于受试对象的。**注意 `validate` 看不见这件事**：它是离线的、量不了，所以一份 preset 已被改过的 lock 在 `dsh-eval validate` 与 `conditions list` 里仍读作 ready，直到 run 起来时就绪检查拒掉它。
- **就绪检查核对。** 声明了 preset 而 lock 里没有能力记录，或记录取自另一个 preset——在花掉任何一次委派**之前**就判该条件不就绪。preset 进哈希却没人量过，等于两个纸面上的受试对象、事实上的一个。

编排实例自己的能力哈希另算一回事：它记在 `run.meta.orchestrator.capabilities` 里，是**取证**。报告的「程序一致」把它列出来，不做任何比较——编排器不回答题库的任何一道题，把它做成通过/不通过的输入，等于「我们升级了规划 agent」就判一条不变量违反。组合里没挂 capability-catalog 就不记这一行。

## `finalize`：跑完之后的再入口

`--finalize` 只在 run 启动的那一刻存在，而「判官与终评」恰恰是归档**之后**的工作。pilot A 因此人手把十二格逐个 `dsh-mission transition` 推过去。`/eval finalize <runId>` 就是这条路，机械化：对 run 内每个 `archived` 的格子走同一条闸（`archived → releasable → released`，含归档闸对 `verdicts/` 非空的 file-check），非 `archived` 的格子逐格列出状态并跳过。

它不 force。闸拒绝按格记 `{kind: 'finalize-refused', from, error}` 到 orchestrator ns，格子停在闸拦下它的地方——闸正是「归档」这两个字有意义的原因。它也不碰没走到 `archived` 的格子：pending 或半途的格子是**没做完的工作**，不是**没释放的工作**。跳过按 `already-released` / `interrupted` / `not-started` 归类，一整个 run 一行就能说清。

进程外没有 mission 服务，所以 `dsh-eval finalize` 以子进程调用 `dsh-mission` 的 CLI（`--data-dir`、`--mission-cli`、`$DSH_MISSION_CLI`）——正是人手工用的那条缝。eval 仍然不 import mission 包的任何东西。

## 条件 provision：声明 → 实物 → lock（I4·T31）

condition 是**声明**；`conditions/<id>.lock.json` 是「这份声明对过一次实物」的锚点。T8b 立了锚点与它的两个读者——validate 报 `LOCK_STALE` / `HOME_NOT_PROVISIONED` / `HOME_MISMATCH`，run 遇过期 lock 直接拒——但在 T31 之前**没有任何东西写它**。`dsh-eval conditions provision` 是那个写入者，而且刻意是唯一的：手写一份 lock 等于声称作用域目录核对过，而其实没有。

五步，每步都能停：

1. **取作用域目录** —— 按条件的 `(harness, scope)` 问 local-agent 要 `homeDir`；读即物化。
2. **核凭证** —— `credentialState` 不是 present（`present-unverified` / `verified`）就停下，并打印该跑的登录命令 `/<家> login [--scope <名>]`。**provision 从不代登录，也从不从别的 scope 复制凭证**——登录是人的事。
3. **逐项核声明** —— 读该作用域的 effectiveSettings，与条件逐字段比：

   | 条件字段 | 对什么 | 不一致 |
   |---|---|---|
   | `harness.version` | CLI 自报版本 | warning（声明为 null 时把实测值**回填进 lock**，不改条件文档） |
   | `model.declared` | harness 缺省模型 | warning——T30b 之后声明是**按次请求**的值，与缺省不同是常态；跑错仍由回读拒 |
   | `reasoning.effort` | `reasoningEffort` | warning（harness 没这旋钮就是诚实的「没有」） |
   | `permissions` | codex `sandbox` / claude-code `permissionMode` / kimi `autoApprove`（dsh 无旋钮） | **error，拒写 lock** |
   | `model.endpoint` | 无 base URL 即 `"default"`，否则端点主机名（声明写整个 URL 会先取 host 再比） | **error，拒写 lock** |

   两条 error 不是随手挑的：`permissions` 是审批边界（冻结决策 3）、`model.endpoint` 是上游路由（冻结决策 5），这两项**就是**受试对象，对不上说明这份条件描述的实验没人跑过。
4. **算 `home.sha`** —— 作用域目录的配置内容哈希（见[哈希规则](#哈希规则)，凭证形状的文件按名与按目录整棵排除）。声明里的 `home.sha` 还是 null，或与实测不符，都以 warning 报出并把实测值原样给出——provision **不改条件文档**（`home.sha` 进条件哈希，改它是改条件，那是人的决定）。
5. **写 lock** —— `{schema, condition, sha, home:{sha}, provisioned:{at, cliVersion, effective:{model, reasoningEffort, permissions, endpoint}}}`。`provisioned` 是 `dataseek.condition-lock/1` 的**增补字段**，没有它的 lock 是 provision 之前写的，validate 读作「没人核对过」而不是违约。

validate 用**同一个函数**复核 lock 里的 `provisioned.effective`：两条 error 级字段对不上即「未就绪」并点名字段。sha 还匹配却对不上，只可能是这份 lock 不是 provision 写的——这正是要看见的那种伪造。

### 能力探针（T32b）

第 5 步之前还有一步，只对 `preset` 非 null 的条件跑：

1. **回读 roster** —— 扫作用域目录下每个 `profiles/*/cordis.patch.yml`，找挂 `@deepseek-ai/dsh-agent-presets` 的 insert 行，取它的 `default`。认的是**包名**，不是生成的注释横幅、也不是 profile 目录名——子 profile 名字可配，改了名照样读得到。读不到就不测量：把声明抄进 `provisioned.preset` 正是唯一会让这个字段失去意义的做法。
2. **确认两边读的是同一份 preset 目录** —— catalog 按**评测实例自己**的 roster 根解析 preset id，子 dsh 按作用域目录的根解析。作用域目录里自带一份 `<scope>/.agent-presets/<id>` 时，同名不同物，测出来的是另一个 preset——直接拒测，让人把子 profile 的 `roots` 指到实例的 preset 根上。
3. **量** —— `ctx.capabilityCatalog.snapshotFor(<回读到的 id>)`，取快照自带的 `sha`。preset 挂不起来时 catalog 是**抛错**而不是退回全局层（T32 的决定），那句拒绝就是这里的答案。

**它量的是什么**：该 preset 的能力面**在评测实例这份 composition 里**的样子，不是子 dsh 自己那份（dsh-base + headless patch + roster）。作为因子它是真的——两个 preset 两个哈希，改技能正文哈希就变——但它不是子 dsh 的整张面。要量后者得把子 profile 启起来、问挂在里面的 catalog，那条启动路留给后续；到那天为止写下的 lock 会在新的量法下读作过期，而这正是上面那条新鲜度比对会说的话（「去重新 provision」），不是一次无声的错比。

provision 需要 local-agent 服务（作用域目录、凭证等级、effectiveSettings 都在那儿）与——为了探针——capability-catalog 服务，所以它和 `/eval run` 一样从活会话起：`/eval conditions provision <condition.json> --repo <工作副本>`。CLI 进程外没有服务面，照旧拒绝。`--repo` 指的那份工作副本是它唯一能写的地方，且**不 commit**——共享检出只读，要写就指自己的 worktree。

## 判定：探针（script）与判官盲评（llm-draft）

格子跑完阶段、停在终态后，编排器在归档前跑两条机器通路。完整契约见 [协议 §6.7 / §6.8](../../docs/dataset-authoring-protocol.md)；这里是实现侧的读法。

**探针（`script`）** —— 任意 `probes/` 段里的 `.mjs` / `.sh`，来源有两处：**题内**（该题 verify 层，只判这道题）与**题集级共享**（题集级 verify 层，对每道题各跑一次；`shared/no-patch.sh` 这类「所有题共用同一把尺子」的判据归这里）。调用约定 `<probe> --cell <格子目录> --rubric <rubric 路径> --out <verdicts.json>`。

**退出码三态**：`0` = 已判定（含 `pass: false`），记 `judged`；`3` = **本轮不适用**（探针没坏、判据也没不成立，只是输入不在位——阶段三没跑、harness 工作树不在格子里），记 `probe-skipped` 并附 stderr 首行，**不算失败**；其余非 `0` = 探针失败，记 `probe-failed`。退出 `0` 却写不出可读的 `--out`，按失败记。用 `3` 不用 `2`：`2` 是 getopt 传统的「用法错误」码，读成「判不了」会咽下每一次误调用。

**执行环境**：**两个 verify 层都整层物化**进宿主临时目录，相对布局与题库一致（`<tmp>/verify/…` 与 `<tmp>/items/<题 id>/verify/…`），题内探针因此能用在题库里同样成立的相对路径 import 题集级共享库（`../../../../verify/helpers/lib/x.mjs`）。cwd 一律是该题 verify 层的根，共享探针也一样。跑完整个目录删除（I3 起交 `lab.verify` 进容器，契约不变）。

**`task` / `by` 先回填、后校验**——两项都是 `required` 且 schema `additionalProperties: false`，反过来会把探针没写这两项的完整判定判成废品。`by`：题内探针 = 它在该题 verify 层的 display 路径；共享探针 = `shared/` + 它在题集级 verify 层的 display 路径。探针写了但与编排器不一致的，以编排器为准并把 `overwritten` 记进 orchestrator ns。带 `ratio` 的判定在源头核两条数值约束（`total > 0` 且 `0 ≤ passed ≤ total`、`pass === (passed === total)`），不符按产物不合契约记——报告侧的退回布尔是兜底，不是唯一的闸。

产出写 `script` ns 与 `archive/verdicts/script.json`；两个层都没有探针就什么都不写。每次探针运行的记录（`{probe, origin, exitCode, outcome, ok, verdicts, durationMs, error?, reason?, overwritten?, dropped?}`）进 orchestrator ns 的 `kind: 'probes'`。

**判官盲评（`llm-draft`）** —— 判官本身是一份 condition，由 `plan.judge.conditions` 指定（可以列**多个**，即一个判官面板），`plan.judge.samples`（缺省 2）是每个判官条件的采样数。约束由编排器强制（决策 9，2026-09-10 放宽）：

- **判官显式 pin 模型**：`model.declared` 为 null 的判官条件被 validate 判为 error、被 run 拒绝——判官跑什么由它家 harness 的缺省决定时，「这格是不是自评」无从判定，报告只会安静地错。
- **判官可以与选手同模型，但每格由谁判要进报告**：不同 id、同 `(harness, model)` 不再拒绝。每条 `llm-draft` 判定带 `judge`（判官条件 id、模型、`selfJudged`、样本号），summary.md 逐格列出这一格由谁判，判官模型等于该格选手模型的格标「**自评**」。仍然拒绝的只有两件事：同一个 id 同时出现在 `conditions` 与 `judge.conditions`（那不是面板，是记账错误），以及同一个判官 id 列两次。
  - 为什么不做全局排除：要评的就是全部模型时，评委必然与某个选手重合。公开榜单（MT-Bench、AlpacaEval、Arena-Hard）都让选手模型当评委并如实记录自评偏好，补救是**多评委面板 + 标出「谁判了谁」**；根本不想要模型评委的（SWE-bench 一类）用确定性打分器。旧规则的代价是实测过的：T22 第 5 步里判官声明一个模型、实际跑另一个，改声明就与选手撞车，两种声明都跑不了。
- **判前去指纹**：`stage1.json` / `stage1.md` / `stage2.json` / `stage2.md` 里的 harness 名、CLI 名、成员自报名字换 `<harness>`，plan 各条件的模型标识换 `<model>`；替换表与次数记 `{kind: 'deidentify', files, table, total}`，**原件不动**，判官只看副本。
- **双采样**：每个样本是**全新委派**（续聊会让判官看见自己上一次的答案），独立 cwd = 判官材料目录。

judge prompt = 该题 grading 层 rubric 里 `kind: llm-draft` 的判据（`objective` 归探针、`human` 归判官台，都不给判官看）+ 去指纹材料 + 输出要求。判官把 `dataseek.verdict/1` 数组写进自己 cwd 的 `verdicts.json`；读不出来记 `{kind: 'judge-parse-failed'}` 并**重试一次**，再失败该样本如实丢弃。每个样本一条 `llm-draft` 注解 `{sample, judgeCondition, judgeSha, judgeModel, selfJudged, promptSha, verdicts}`，并落 `archive/verdicts/llm-draft-<判官条件>-<样本号>.json`；`task` 与 `by` 由编排器回填（判定方只是回声，写错会污染报告的每一次 join）。

判官的用量与耗时记 `{kind: 'judge', judgeCondition, judgeSha, judgeModel, selfJudged, sample, attempt, childSessionId, promptSha, startedAt, durationMs, usage, model}`——`kind` 不是 `delegation`，所以**不进报告的选手效率表**。判官材料目录（`$DSH_HOME/state/eval/judge/<runId>/…`：prompt + 去指纹材料 + 判官的回答）在 run 结束后保留，供复核；探针目录跑完即删。

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
| `conditions({repo?, dataset?, session?})` | 列出题库声明的条件：harness、声明模型、条件哈希、就绪（lock 在不在、还对不对、home 是否核过）、lock 里的 `provisioned` 快照、未解析字段。`repo` 缺省时取会话的 datasets 绑定，并遵守绑定的题集白名单——agent 能看哪些题集是人的决定 |
| `conditionDiff({a, b, repo?, dataset?, session?})` | 两份条件声明的逐字段差异（规范化深比较；`notes` 进差异清单但不影响 `identical`）。两侧各可以是条件 id 或路径。**只展示，不推荐**：哪些字段不同、各自取值，就这些——这对条件值不值得跑，取决于文件里没有的东西 |
| `provision(conditionPath, {repo})` | 把声明变成实物并写 `conditions/<id>.lock.json`，见下节。**lock 的唯一写入者**；只写 `repo` 指的那份工作副本，不 commit |
| `experiments({repo?, dataset?, session?})` | 实验室列表的投影：一行一个实验，**草稿与 run 同列**。run 取账本里 `run.meta.evalVersion` 有值的那些；草稿取题库 `datasets/<题集>/plans/*.json` 里还没有对应 run 的（按解析后路径或 planSha 配对）。每行带题库快照、条件与判官 id、题数、rep、因子（条件两两 diff 推出）、状态、进度、开始时间。降级不拒绝：没挂 mission 只列草稿、会话没绑题库只列 run，缺哪块就在 `notes` 里写一句 |
| `experiment(runId)` | 一次已启动实验的概览：上面那一行，加只有 run 才有的部分——run.meta 摘要、就绪检查记录**原文**、桶与阶段两张直方图、未释放清单、本实例还留着的 job。草稿没有 run，它的概览就是列表那一行（计划审阅页归 T36）|
| `matrix(runId, {column?, groupBy?, filter?, stuckMs?})` | 矩阵页的排布（I5·T35b）：**行永远是题**，列是调用方选的那一个因子，其余因子分组或钉死。因子集合就是 run.meta 里各条件文档两两 diff 的键并集；格内四样——rep 圆点（实心 ≥ judged / 半心进行中 / 空心未起）、阶段（各 rep 一致就是那个态，否则 `mixed`）、卡格（在态时长超阈值，缺省 30 分钟，已判的格不算卡）、题面哈希是否与同题其余格一致。物化哈希从 run 循环自己写的 `materialization.json` 读；mission 面报不出 `dataDir` 就记「无法核验」，绝不猜 |
| `cell(runId, missionId)` | 一格的全部（格子详情抽屉）：各次 attempt（含重跑原因与类别）、检查点、产物、refs、各注解命名空间的条数与最近一条摘要、**verify 原样输出全文**、委派的子会话 id、以及这一格此刻可不可释放 |
| `cellRows(runId, query)` | 格子页表格要的那几列，由同一个 `cells` 投影收窄而来——模型读整份，tab 读这份，一份实现 |
| `retryCell(runId, missionId, {reason, category, by?})` | 带原因重跑，原样转发给 mission。**原因是必填**：空原因在这里就被拒，不劳 mission 再拒一次——没人说得清来由的 attempt 比没有更糟 |
| `releaseCheck(runId, missionId)` | 释放检查：这一格的资源现在能不能销毁。答案是状态机自己的 `releasableStates`，eval 不加意见 |
| `exportPlan(agent, request)` / `exportRun(agent, request)` | 导出 bundle 的两步，转发给 **mission 自己的 Remote**。guarded 层怎么算（经 datasets 探测）与 fail-closed 的闸都在 mission 那边，eval 只转发调用方的确认，既不能放宽也不能收窄——泄题闸有第二份实现，就有第二个地方会错。组合里没有 mission 的 Remote 就整个拒绝导出，而不是在这边把闸再写一遍 |
| `itemRuns(datasetId, itemId)` | 一道题的「作答记录」：哪些评测 run 跑过它、各格在哪个态、各 ns 各有几条判定。按 `task` label 与 `meta.datasetId` 认题，与矩阵同源；给题集 tab（T47）用，没挂 mission 就空列表加一句话 |
| `runStatus(runId)` | 投影一次 run：run.meta 摘要（planSha、快照 commit、条件、随机顺序与种子、启动时间）+ 逐格一行（题、条件、rep、attempt、状态、桶、编排器最近一条注解、submission-rejected 次数）。缺 mission 服务即拒绝并说明原因 |
| `finalize(runId, options?)` | 把 run 内每个 `archived` 的格子走一遍 `archived → releasable → released`（与 `--finalize` 同一条闸），非 archived 的格子逐格列出状态。闸拒绝按格记录，不 force。组合里没有 mission 服务即拒绝并说明原因 |
| `report(bundleDir, {out?})` | 把 mission export 的自包含 bundle 变成 `results.jsonl` + `summary.md`（见下节）。只读 bundle，写入缺省 `<bundleDir>/report/`，重复运行覆盖（报告是派生态，bundle 本身只增不改） |

## 报告（report）

输入是 mission export 的 bundle（manifest.json、run.json、missions/<id>/attempt-N/{meta,annotations,artifacts}、dataset/<layer>/），输出三份文件：

- **results.jsonl** — 一行一个判定：`{task, condition, conditionSha, rep, attempt, stage, ns, criterion, pass, ratio?, weight?, negative?, toolCalls?, evidence, by}`（`toolCalls` 是该**格**各轮工具调用之和，本格没有任何一轮报过就整个键缺位——因此在旧 bundle 上复算出的 results.jsonl 逐字节不变）。ratio 只在判定声明了可用的 `{passed, total}` 时出现；weight / negative 只在该判据的极性可知时出现（见下）；stage 取自注解记录的 stage 字段（判定契约本身不含 stage，未记录即 null）。
- **summary.md** — 开头先核四条不变量（题面一致 / 环境一致 / 受试对象一致 / 程序一致）。**任一项不成立或无法核验，只输出事实表，不输出比较**。比较启用时：因子由 run.meta.conditions 的条件文档两两 diff 推出（只差一项即因子名，差多项标「多因子」只做描述统计）；配对以题为区组、rep 为重采样单元，输出逐题差值（得分判据数与加权分）、n、自助法 95% 置信区间（seed 确定性，统计手写无依赖）；n < 3 或因子未知/多因子时打印「不可排名」并拒绝名次。判官一致性按 criterion 算**同一判官**双采样的一致率与 Cohen κ（面板里每位判官各算各的，不把两位判官的分歧算成某一位的噪声），列了多个判官时另加一行跨判官一致性（每位先按自身多数定调，再比判官之间）；human-final 在场时算 llm-draft 对终评的一致率；自评判据单列一行提醒单独读。「每格由谁判」一表在比较启用时进比较节，否则进判官一致性节——谁判的是事实，不因不变量拦下比较而消失。效率并列不合成，且每一项**只统计已完成的格子**（`judged` / `archived` / `releasable` / `released`）：活跃时长（委派 durationMs 之和）、工具调用（各轮 `toolCalls.count` 之和；没有任何一轮报过计数就打「—」而不是 0——「没人报过」不是「一次没用」）、标价成本（run.meta.pricing 给了才有）、委派轮次（只在双方都完成的题上比）、token 只在同模型内比。未完成格子的委派时长买到的工作量未知，混进来得到的数没有意义——pilot A 两家活跃时长同为 21.0 min，那个巧合就是一格只跑了阶段一的 dsh 格子撑出来的。被排除的格子按条件与状态在表下单列一行；`results.jsonl` 不受影响。「程序一致」一节在 run 记了 `run.meta.subset` 时把它打印出来，只覆盖了一部分 plan 的 run 因此不会被读成完整的。expectedNs 里某 ns 的判定全由 `tool:` 写入时 summary 顶部红字标出。

- **usage.jsonl** — **一轮委派一行**的花销台账：`{run, cell, attempt, condition, task, stage, round, counted, observedModel?, cliVersion?, durationMs?, usage?, toolCalls?}`。这里不聚合、不计价——效率表由它汇总，外部计价也只读它。`counted` 说明这一轮是否在效率表口径内（当前 attempt 且已完成，T23 规则）：把某条件 `counted: true` 的行加起来，就逐项等于它在效率表里的那一行；`counted: false` 的行是表**有意排除**的花销，留在这里而不是丢掉，好让外部按自己的口径取用。取不到的字段一律缺位，绝不补零——「没人报过」和「花了 0」是两件事。

判定源按权威排序取各格的主判定（human-final > llm-draft > script，同判据多样本按多数计）；rep 是独立样本，attempt 只算基础设施重试——所有 attempt 的判定都进 results.jsonl，聚合只用各格最新 attempt。

### 判据极性与权重表（协议 §6.5）

`pass` 恒为「判据成立」。负分判据的 criterion 写的是缺陷，成立即缺陷存在——所以报告的主轴是**得分判据数**：正向判据成立计 1，负向判据成立计 0、不成立计 1；加权分 = Σ weight × 该判据得到的比例，负 weight 自然扣分。摘要另出一张「负向判据命中」表（哪格、哪条、比例、证据），那是缺陷清单。

「按比例给分」的判据（F2 / F3 的 C1、C2）在判定里带可选的 `ratio: {passed, total}`（协议 §6.5）：报告按 `passed / total` 计分而不是布尔（负向判据计其余量 `1 − passed/total`），同判据多样本取所给比例的均值。`pass` 仍是那个布尔事实（判据**完整**成立），`ratio` 只是细化它——读不懂 ratio 的消费者退回严格布尔，只会低估。比例只走字段：报告**从不**去解析 `evidence` 里的「通过 6/9」之类前缀；`total ≤ 0` 或 `passed` 越界的比例按缺失处理并在附注里点名。

极性来自 rubric，不来自 verdict。rubric 住在 grading 层、不进 bundle，所以 run 在导出后从 grading 层**派生**一份权重表写进 `<bundle>/report/rubric-weights.json`（`dataseek.rubric-weights/1`：`{task, id, weight, negative, kind, axis}`，只有编号与数字，**不含 criterion 文字与 evidence**，因而不经泄题闸）。报告优先读它，其次读 bundle dataset 层里的 rubric（有意开闸导出时）。两者都没有时，报告只出计数，并明确打印「极性未知，计数按正向处理」、把负向判据数记为 unknown——不把「无从判断」显示成「没有缺陷」。`report` 只读这个文件，从不改写它。

## 模型工具（只读，四个）

**本包不再注册任何模型工具（BREAKING）**：下面这四个只读工具与 `tool:eval` 提示词段归伴生行 `@khorsheed/dsh-eval-tool`，由 agent preset 按会话授予。迁移两步：把伴生包作为依赖安装，并在目标 preset 的 `agent.cordis.yml` 里加两行——`- id: eval-tool` 与 `  name: '@khorsheed/dsh-eval-tool'`（该行可带 `config: { tools: none }`）。下面的清单、配置与行为描述自此描述的是**伴生行**的工具面；服务面、CLI 与 `/eval` slash 仍归本包。

agent 在一次实验里只出现两次：规划期起草、分析期读结论。两次都不需要写。所以模型工具**四个全是读**，并且刻意没有写的那个——能起 run 的 agent 就能起一次人没批准的 run。

第四个 `eval_cells` 是 I5·T46 加的：评测预设自那以后不再挂 mission 的伴生行（界面规格 R6「评测模式下 mission 这个词不出现」），原先用 `mission_list` / `mission_get` 读逐格细节的路没了，这个工具用 eval 自己的投影答同一个问题——数据仍经 `ctx.mission` 的结构面算，但算在服务端，模型侧与前端都不碰 mission。

| 工具 | 答什么 |
|---|---|
| `eval_conditions` | 题库里有哪些条件、各自的哈希与就绪状态、lock 里的 provisioned 快照、哪些字段还是 null。参数 `repo`（缺省取会话的 datasets 绑定）、`dataset`（缺省扫全库），以及 `diff`（恰好两条条件，改为逐字段比较两份声明——只展示差异，不推荐哪条值得跑）|
| `eval_plan_validate` | 给定 plan 路径的校验结果：`ok` / `errors`（不能跑）/ `warnings`（还没解析）与解析出的条件 sha。校验从不启动任何东西 |
| `eval_run_status` | 一次 run 的 run.meta 摘要与逐格状态；数据源是 `mission.runStatus` 与 orchestrator ns |
| `eval_cells` | 给了 `run_id` 就答一次 run 的**逐格**细节：题 / 条件 / rep 与其余 labels、桶、当前阶段与已停留时长、attempt、该次 attempt 持有的单元（`resource` 与环境指纹）、检查点名、各注解命名空间的条数、委派的子会话 id；`bucket` / `task` / `condition` 三个精确过滤。**不给 `run_id` 就改答「有哪些实验」**（I5·T35a）：每个 run 与每份还没启动的 plan 各一行，列与实验室 tab 同源（同一个 `experiments` 投影，两个面不可能各说各话）——这是 T46 摘掉 `mission_run_list` 之后留下的缺口，先这么问拿到 run id，再带着它问一次 |

写类动词一个都不开：run 由人在会话里用 `/eval run` 发起，materialize / submit / transition / annotate / archive / export / finalize 归编排器服务面与人的 CLI（profile 的[「工具按域开放」](../../profiles/web-eval/README.md#工具按域开放)）。

配置项 `tools: 'all' | 'none'`（缺省 `all`）随之搬到**伴生行**，本行不再有这个键。没有更细的分组，因为没有可分的：模型工具面一个写工具都不注册。`none`（或没有引用这一行）时模型看不到这四个工具，本包的服务面、CLI 与 `/eval` slash 照常。

工具注册走**延迟注入**（`ctx.inject(['tools'], …)`）而不是 apply 期的 `ctx.get('tools')` 探测：探测会和工具注册表自己的挂载顺序赛跑并且输，工具静默地一个都注册不上，还没有任何东西会说（room 与 worktrees 都踩过并修过同一处）。延迟注入在注册表出现时才触发，在没有注册表的组合里永不触发——那样的组合保留 slash、CLI 与服务面，绝不炸启动。`tool:eval` 提示词段同理走 `systemPrompt` 的延迟注入。

## 发起一次 run：三个入口，一条取消路径

run 是**后台 job**，不是一句回复。`/eval run` 把它注册成一个 `eval-run` job 后**立即返回** job id 与 run id：轮次结束、会话关掉、浏览器标签页关掉，run 照跑——它此前活在发起那一轮里，发起端一断整个 run 就没了（I3·T22 第 5 步）。

| 入口 | 用在哪 | 形态 |
|---|---|---|
| `/eval run <plan.json>` | 人在实例里发起（缺省） | 起 job，立刻回 `job <id> · run <id>`；日志用 `job_output` 读 |
| `/eval run <plan.json> --wait` | 交互式的短跑（`--dry-run`、一格的 plan） | 老形态：轮次内等到跑完再回复，逐字节与本改动之前相同 |
| `dsh-eval run <plan.json> --instance <url>` | CI（没有浏览器） | 经实例的 Remote 面起同一个 job，跟着日志跑到结束，退出码即 job 结局 |

- **取消只有一条路**：`job_kill <jobId>`。它触发 job 的 cancel → run 的 `AbortSignal` → 与每格预算计时器同一条杠杆（对每个在跑的委派 `localAgent.cancel`）。被取消时正在跑的格子**不重试、不强推状态**，停在当时那一步——`finalize` 因此把它归入 `interrupted`（T23 的分类）；一格都还没开的格子留在 `pending`，那是 `not-started`，两件不同的事。run 自己在 `run.meta.cancelled` 记一笔，bundle 照常导出（被取消的格子也是证据）。
- **父会话**：委派要的是**活的 agent**，不只是一条会话记录（家族门面 `requireLiveParent` 的要求）。`/eval run` 起的 job 用发起会话作父（它的 agent 活过标签页），发起会话没有活 agent 时（Remote/CI 就没有）job 自己开一条会话作父，run 结束时关掉。回复里会说明用的是哪一种。**自己开的那条会话带工作目录**（T29d）：run 自己的格子根 `<stateRoot>/cells/<runId>`，开之前先建出来。容器轮**不传每轮 cwd**（单元里宿主路径没有意义），provider 于是回落到父会话的 cwd——没有 cwd 的父会话让每个容器条件都以「the parent session has no working directory to run the CLI in」被拒，一句在讲编排器自己的管道、却像是 harness 的错的话（I4·T29c 记的）。两条起法的就绪原文因此逐字相同，测试钉住了这一点。
- **没挂 jobs 服务的组合**：不拒绝，退回同步等待，并在回复**首行**写明这一轮的等待意味着什么。

```sh
/eval run <plan.json> [--wait] [--concurrency N] [--dry-run] [--finalize] [--out DIR] [--retries N]
                      [--only id,id] [--max-cells N] [--ignore-readiness]
/eval finalize <runId>
```

run 的发起仍是人的动作，不注册任何 run 类模型工具——写类动词归编排器服务面与人。模型面能看到的是 job：`job_list` / `job_output` / `job_kill`（评测预设里已经有这三个）。

## slash 与 CLI

```sh
dsh-eval validate <plan.json>             # 校验 plan；报告 JSON 走 stdout
dsh-eval run <plan.json> --dry-run        # 离线彩排：校验 + 模板 + 矩阵 + 顺序
                                          #   [--only id,id] [--max-cells N] 彩排一个子集
dsh-eval run <plan.json> --instance URL   # 在一台**在跑的实例**上起 run 并跟日志到结束（CI 入口）
                                          #   [--token T]（或 $DSH_TOKEN）带实例的启动 token
                                          #   [--no-follow] 只打印 job/run id 就返回
                                          #   plan 路径按**实例上**的路径解析；停它用实例上的 job_kill
dsh-eval finalize <runId>                 # 把 archived 的格子走一遍释放闸
                                          #   [--data-dir DIR] [--mission-cli PATH]；以子进程调 dsh-mission CLI
dsh-eval template <manifest.yml> [--stages a,b]  # 打印生成的 run 模板
dsh-eval conditions hash <condition.json> # 打印 { id, sha, warnings }
dsh-eval conditions list [--repo DIR]     # 逐条件：哈希、lock 状态、home 是否核过、provisioned 快照
                                          #   [--dataset ID] 只看一个题集
dsh-eval conditions diff <a> <b>          # 两份声明的逐字段差异（各侧是条件 id 或路径）
                                          #   [--repo DIR] [--dataset ID]
dsh-eval conditions provision <cond.json> # 需要 local-agent 服务，进程外没有——CLI 如实拒绝
                  --repo DIR              #   并指向 /eval conditions provision
dsh-eval report <bundleDir> [--out DIR]   # 出 results.jsonl + summary.md；摘要 JSON 走 stdout
```

plan 路径与 `--out`（以及 `report` 的 bundle 路径）在服务边界统一展开 `~`：slash 参数没经过 shell，CLI 参数为了活过 shell 常被引号裹住，两边都到不了 `$HOME` 展开——所以展开放在三个入口共用的那一层，而不是各记各的。

数据走 stdout JSON，诊断走 stderr；退出码 0 ok / 1 失败 / 2 用法错误（与 `dsh-lab` 一致）。CLI 直连内核，不需要宿主在跑——脚本场景与已挂载插件行为完全一致。进程外没有活的父 Agent、也没有 datasets/mission/localAgent 三个服务，所以**不带 `--instance` 的 `run` 只做 `--dry-run`**；`--instance` 时 CLI 不再假装自己是编排器，而是做 CI 真正需要的那件事：当调用方。它走的是实例普通的 Remote RPC（`POST <base>/api/dshEval/<method>`，`{args:{…}}` 进、`{ok,value}` 出，token 走 `?token=`），四个动词与 slash 用的是同一套 job 层。`finalize` 不需要父 Agent、只需要 ledger，所以它在进程外以子进程调 `dsh-mission` CLI 照常工作；任一格闸拒绝即退出码 1。

## 实验室 tab（浏览器半边，I5·T35a）

本包自此有 client 半边：会话的 `conversation.view` tab 环里多一个**实验室 / Experiments**（order 40）。插件 id 仍是 `eval`——仓库里的 `lab` 是容器单元插件，两个名字不撞（界面规格 R5）。

- **自隐**：当前会话的 preset 组合里点了 `@khorsheed/dsh-eval-tool` 行才注册这个 tab，没点就**不注册**——tab 条的按钮是按注册枚举的，返回 null 的组件只会在条上留一个空壳按钮。判据读官方 `pluginInventory` Remote，**每条读不到的路都失败开放**（可见）：宿主没有这个命名空间、RPC 还没回来或失败、preset 组不存在或标了 `broken`、会话根本没有 preset。判据是那一行**在不在**，不另设逃生口：隐掉一个只读视图不会弄坏任何已有的 run。
- **列表**：一行一个实验，**草稿与 run 同列**——对着手要规划下一次比较的人来说它们是同一类东西（界面规格 §五）。列：名称、题库快照、条件数（+ 判官）、题数、rep、因子、状态、进度、开始时间。动作只有「新建实验」，本轮是占位（归 T36）。
- **状态**七个词，由纯函数 `deriveExperimentStatus` 从三处推出——plan 的 validate 结果、账本里每格的阶段、后台 job 的结局：草稿（validate 没过或没跑）→ 待批准（过了，没人起）→ 运行中（job 还活着，或还有格子在动）→ 评估中（所有格子到了 `judged` 或更后，且还没 finalize）→ 已完成（全格 `released`）；另有被拒（job 以 failed 落地）与已取消（job 被 kill）。三处**粗糙的边**是写在函数注释里的，不是抹平的：job 层把「就绪检查拒绝」和「跑到一半抛错」记成同一种 `failed`（是哪种看状态详情那句话）；job 跑完但格子停在中途读作运行中，因为账本里确实还有没跑完的格子，而第八个词不存在；一格都没有的 run 同理；实例重启后 job 记录没了，那条 run 就只按格子读，被拒与已取消于是够不着。
- **详情**是七个子页的壳（概览 · 计划审阅 · 条件 · 矩阵 · 格子 · 报告 · 判官台，按界面规格 §五）。本轮只填**概览**：快照、矩阵形状、因子、判官与采样数、环境（镜像 / 网络 / 用户，宿主路径就直说）、就绪检查原文、run.meta 摘要，外加桶与阶段直方图、未释放清单、后台 job。其余六页各留一句点名归哪个任务（T36 / T35b / T38 / T37）——一个假装自己是空的 tab 比一个说明谁在建它的 tab 更糟。草稿的概览直接由列表那一行渲染，不多花一次 RPC：它没有 run 可读。
- **前端零兄弟包依赖**：mission 与 datasets 的投影都在服务端算好再下发，浏览器只读 eval 自己的 Remote（界面规格 R2 与 §八）。Remote 上为此新增两个**带会话参数**的读动词 `runs` / `run`——会话决定了这个浏览器能看见哪个题库（datasets 绑定是人的决定），而 CI 的四个动词 `runStart` / `runStatus` / `runOutput` / `runCancel` 一个字没动，它们不带 agent 正是因为 CI 没有。

## 矩阵页、格子页与格子详情（I5·T35b）

实验室详情的第四、第五个子页，与 T35a 的壳同一套注册、同一份 Remote。

- **矩阵页**：行永远是题——比较是「同一个问题问不同的受试对象」，让人把题放到列上，就等于把两个不同的问题摆成一行读差值。列是人选的那一个因子，其余因子「分组」成带，或用筛选钉成一个值；两样都不选的因子**随格同行**，那一格的条件列表于是列出不止一个 id，看得见而不是被藏起来。格内固定四样：rep 圆点、阶段、卡格告警、题面哈希是否与同题其余格一致（不一致的那一格描红边；读不到哈希是「未知」，不是「不一致」）。底部一行 run 级汇总：物化哈希、环境指纹（都用报告的四条不变量的词）、未释放单元数、判官一致性（报告没出就写「待报告」，绝不自己算）、卡格数。
- **格子页**：原 missions 队列按本 run 过滤——题 × 条件 × rep、桶、阶段、attempt、在态时长——右侧是格子详情抽屉。抽屉里三枚动作：**带原因重跑**（原因必填、类别取 mission 自己的 infrastructure / operator / outcome）、**释放检查**、**导出 bundle**。另有「打开子会话」，用宿主的 `sessions.open(childSessionId)` 把选手那次委派的会话开出来**读**——成员 composer 与 dock 是 local-agent 的；这一格没记子会话时按钮禁用并说明原因，而不是点了没反应。
- **verify 原样输出**：这条线上**没有 `lab` 注解命名空间**。探针（容器轮经 `lab.verify`、宿主轮直跑）由编排器记成 `kind: 'probes'` 的 orchestrator 注解，抽屉展示的就是它，整段原样——退出码与「本轮不适用」的原因正是人打开这个抽屉要看的东西，摘要会把它们摘掉。把它说成「lab 的」会指认一个不存在的来源。
- **导出闸不在 eval 这边**：`exportPlan` / `exportRun` 转发给 mission 自己的 Remote，guarded 层的判定与「每一层都确认过才写」的 fail-closed 复核都留在那里。对话框的职责只是让人逐项**有意识地**勾；改了任何一个字段就作废已勾的确认，因为那些确认属于当时看到的那一套层。
- **前端仍然零兄弟包**：读与写都走 eval 自己的 Remote（`matrix` / `cells` / `cell` / `retry` / `releaseCheck` / `exportPlan` / `exportRun`，都带会话参数），浏览器半边一次都没有提到 mission。

## 哈希规则

- **条件哈希**：规范化 JSON（键全排序、无空白）的 sha256 小写十六进制；`notes` 除外。
- **planSha**：plan 全文档规范化 JSON 的 sha256（含 notes——审阅时改注释也会换 plan，这正是「同 plan 即同一套程序」的口径）。
- **home.sha**：只哈希配置类文件（`.json .jsonc .yml .yaml .toml .ini .cfg .conf .xml .properties`），按相对路径排序后对 `<relPath>\0<content>\0` 逐文件喂 sha256。拒绝清单：`auth.json`、`.env*`；文件名含 `token` / `key` / `credential` / `secret` / `password` / `auth`（不分大小写）；`credentials/`、`oauth/`、`sessions/`、`keys/`、`secrets/` 目录整棵跳过；符号链接与超大文件（>1 MiB）跳过。文件内容绝不读入日志、绝不打印。
- **materialization.json**：该题 visible 层文件按路径排序后逐文件 sha256，整体 sha 按排序 `<path>\0<fileSha>\0` 折进 sha256——同题各格可被证明题面一致。
- **能力哈希**（`provisioned.capabilities.sha`、`run.meta.orchestrator.capabilities.sha`）：由 capability-catalog 算，本包只记不算——规范形是它的契约，而 eval 不依赖任何兄弟包。两边各有一份逐字节相同的 `canonicalJson`，由各自的测试钉住。

## 兼容性

- npm release line（`@deepseek-ai/dsh@0.1.2-rc.1`）：✅ —— 消费 `Context.provide` 与 `commands`；run 时探测三个兄弟服务，缺席即拒绝，不炸启动。minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- source line（deepseek-harness master）：✅ —— 同上（verifiedHost: 0.1.2-rc.1）。

降级 / 缺席项（与 package.json 的 `dsh.compat` 同步）：

- 四个只读工具与 `tool:eval` 提示词段归伴生行 `@khorsheed/dsh-eval-tool`，走延迟注入：组合里没有工具注册表 / systemPrompt 时它们不注册，slash、CLI 与服务面照常，不炸启动；`tools: 'none'`（或没有引用这一行）只是让模型看不到这四个工具。发布顺序有约束：引用伴生行的 pack 必须先有伴生包被发布 / 安装——行解析失败只让该 preset 组合报 broken，实例 boot 不受影响。浏览器半边（I5·T35a）的实验室 tab 按同一行自隐，判据读不到时失败开放；没有 `conversation.view` slot 的组合（TUI、headless）不注册它，服务面与 CLI 照常。矩阵的物化哈希要 mission 面报得出 `dataDir`，报不出就记「无法核验」；导出的两步要 mission 的 Remote 在场（没有 Typert 网关的组合就没有），不在场即整体拒绝——泄题闸绝不在 eval 这边重写一遍。
- 面向早于 T11 的 local-agent：委派 `cwd` 被忽略、子代理继承父会话 cwd，格子因收不到产出文件而如实拒绝（submission-rejected），不会错记；`delegationOf` 与 settled 回读均缺席时 `usage` 与 `model.observed` 记 null，「受试对象一致」在报告里降为不可核验，而不是假定成立。判官同样靠 `cwd` 收 `verdicts.json`，没有 cwd 时该样本按解析失败记，不会误判。
- `human-final` 不由本包写：它只从判官台或 `dsh-mission annotate --ns human-final` 进来（I5）。
- 没有 `ctx.lab` 的组合照常跑宿主路径；只有带 `unit` 段的 plan 会因为缺 lab 而被拒绝，并在拒绝语里点名。

## 状态

I2：T2 离线动词、T8/T8b 编排器 v0（模板生成、矩阵展开、run 循环阶段一二、格子锚点、T11 回读回填、slash、CLI dry-run）、T10 `report`（results.jsonl / summary.md / 四条不变量 / 配对差值与置信区间 / 判官一致性 / 效率并列）、T9 判官（探针契约、去指纹、双采样盲评、`--finalize` 过闸）、T14 三个只读模型工具已落地。I3：T23 补上 pilot A 暴露的四条编排器缺口——开跑前就绪检查（G4）、`finalize` 再入口（G13）、效率表只计完成格（G15）、`--only` / `--max-cells` 记进 `run.meta.subset`；T28 补上 T19 探针自测暴露的三条——题集级 verify 层物化与共享探针执行、退出码三态、`task` / `by` 先回填后校验。T20 落地容器路径：plan 的 `unit` 段一格一单元（acquire → populate → 逐阶段委派与 checkpoint → 探针经 `lab.verify` 在单元内 → archive → 过闸 release），`refs.fingerprint` 由编排器写入，四条不变量之二从此可核验。provision（I4）、并发单元（I4）、界面（I5）按 web-eval 迭代计划推进。I5：T46 加第四个只读工具 `eval_cells` 与它背后的服务面 `cells(runId)`，评测预设同时摘掉 mission 的伴生行；T35a 从零搭起 client 半边——实验室 tab 的列表与详情壳（只填概览页）、服务面 `experiments` / `experiment` 与它们的 Remote 读动词 `runs` / `run`、七态状态推导，`eval_cells` 同时补上「不给 run_id 就列实验」的模式。T35b 补上矩阵页与格子页：`matrix` / `cells` / `cell` 三个读面、`retry` / `releaseCheck` 两个动作转发、`exportPlan` / `exportRun` 转发 mission 的导出闸（闸仍在 mission 侧），外加给题集 tab 用的 `runsForItem`。计划审阅与条件页归 T36，报告归 T38，判官台归 T37。

## 许可

[MIT](../../LICENSE)
