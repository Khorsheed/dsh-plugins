# dsh-eval

中文 | [English](README.en.md)

**web-eval 编排器：dataseek 契约 schema、plan/condition 校验、条件与 scoped home 哈希、由题集 manifest 生成 run 模板、阶段一二的 run 循环（逐格物化、逐字节委派、提交推进、归档闸、bundle 导出）。** run 的发起是人的动作（`/eval run`，发起会话即所有委派的父会话）；判定的两条机器通路（探针写 `script`、判官盲评写 `llm-draft`）随 T9 落地，`human-final` 仍归人。不依赖任何兄弟插件——四个上游服务（`datasets` / `mission` / `localAgent` / `lab`）在 run 时经 `ctx.get` 探测，缺哪个就拒绝并列出哪个，绝不炸启动；前三个每次 run 都要，`lab` 只在 plan 带 `unit` 段（容器路径）时才要——没有 unit 段就在宿主目录里跑，拒绝文案会说「挂上 dsh-lab 插件，或去掉 unit 段」。

给 agent 的模型工具是五个读工具、一个起草工具与一扇分析的门（见「模型工具」一节）；run、finalize 与注解都不给模型。

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
9. **判定、归档、过闸**：格子停在终态后先判（见下节），判定落 `archive/verdicts/`，再把格子目录拷到 `archive/workspace/`，`transition(archived)`，然后推 `releasable → released`——**T57 起这是缺省，逐格进行**；file-check 要求 verdicts/ 非空：两条源里任一有产出即可过闸，两条都没有就如实记 `finalize-refused` 并停在 archived。`--keep-units` 是调试用的退出口：开了之后每格停在 archived、容器留着。
10. **导出**：结束时 export bundle 到所属实验的 `exports/`（旧 plan 路径起的 run 仍是 `<题库仓库>/exports/`；`--out` 可改），只收 visible 层（modelFacing:true，无需泄题闸确认）。

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
8. **`archive`**：lab 导出 `workspace/` 与 `manifest.json` 到该 attempt 的 `archive/`；`verdicts/` 早已在旁边（判在归档之前，闸要求它非空）。

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

- **过闸即销毁**：`archived → releasable` 一过就销毁，然后才 `→ released`。位置是刻意的：`isReleasable` 读的是**当前**状态，而模板的 releasableStates 只有 `releasable`——先走到 `released` 再销毁，闸会答否，于是每个容器都活着。`finalize` 走的是同样三步、同样顺序，事后回收容器才成为可能。
- **过闸是缺省（T57）**：它曾经要显式开，因为 v0 没有判官、填不满闸要的 `verdicts/`。自从每格归档前都先判，旧缺省在实践中只意味着一件事：每个容器都活过它那一格，计划的第 4 格撞上 lab 的 `maxConcurrentUnits` 起不来——于是**跑循环的缺省悄悄决定了矩阵能有多大**。想要旧行为（留个容器进去看）就用 `--keep-units`（CLI 旗标，以及批准对话框的「保留单元」）。
- **闸拒绝即留下**：开了 `--keep-units`、或 verdicts 为空导致 `releasable` 过不去，销毁照样问一次、照样被拒，**容器留着**并在格子上记一条 `{kind: 'unit-retained', reason}`。没人看过的格子，现场比容器数值钱。
- **异常路径先归档再释放**：格子抛错（基础设施失败、schema 拒绝、归属错误）时先 `collect` 再 `archive` 再走同一条闸——不归档就 release 等于毁证据（lab README「失败恢复循环」）。同样不带 force，所以失败的格子会留着它的容器。
- **`force` 在本文件里只有一处**：就绪检查的探活单元。它不绑 mission，因而没有闸；lab 要求这种销毁必须显式 `force`，正是为了让「无闸销毁」是一句判决而不是一个默认。

### 已知取舍

- **串行**。容器路径固定 `concurrency: 1`（显式给 >1 会被拒），并发单元归 I4。`acquire` 撞上 `maxConcurrentUnits` 当缺陷报出来，不排队——而且拒绝原文**点名占着名额的是谁**：lab 只说「先释放一个」，不说是哪个，于是编排器补上每个占着名额的单元的 run id、单元 id、容器名与格子，外加能结束它们的两条命令。这份名单加在这边而不是 lab 里，因为 lab 不知道什么叫一次 run。
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
- **provision 先把 preset 组进 scope。** 条件声明了 preset 时，`conditions provision` 在哈希作用域目录**之前**调 `localAgent.provisionScope(harness, scope, { preset })`：preset 是**受试对象**的属性，做主的该是条件文档，而不是一个实例只有一份的插件设置（pilot D 之前只能手工把 roster 层追进每个 scope 的 patch，而那一层会被下一次重启静默抹掉）。顺序不是随意的——scope 自带的那份 preset 副本就在作用域目录里面，先哈希再组进去会锁下一个描述不存在目录的 `home.sha`。门面没有这个动词就退回从前：有什么读什么。
- **provision 写下实物。** `conditions provision`（T31）在 `provisioned` 里多记两项：`preset` 从写出去的子 profile 回读，`capabilities.sha` 是 capability-catalog 对那份已配好的环境算出的**能力哈希**（规范形取技能的 name/source/正文 sha 与工具的 name/channel/parameters——描述措辞不进，改一次文案不该换一个受试对象）。测量由**实例内的探针**做（T32b，见下）；没有 catalog 的组合里探针不在，条件照样落 lock 但不带能力记录，并按名报 `CAPABILITIES_UNMEASURED`——之后就绪检查再拒一次。
- **就绪检查还比新鲜度。** lock 记的是 provision 当时的哈希；run 起来时就绪检查**再量一次**，两者不等即判该条件不就绪、点名「preset 在 provision 之后变了」。少了这一步，lock 会永远读作「已核对」而它量的那个 preset 在底下被改——而改技能**正文**不会动任何别的已记哈希（`home.sha` 只哈希配置类文件，不含 SKILL.md），只有这一步看得见。量不出来（catalog 不在、preset 挂不起来）时，原记录照旧算数：测不到是关于 catalog 的证据，不是关于受试对象的。改的若是 scope 自带那份副本，还有第二道、且不需要 catalog 的检查：重算 `capabilities.snapshot.sha`，不等即拒。**`validate` 与 `conditions list` 也核这一条**（在实例里跑、拿得到作用域目录解析器时）——T32b 记下的「离线读到 ready、run 起来才被拒」就此对上；能力面本身仍然要活的 catalog 才量得到，纯 CLI 的 validate 因此仍看不见它。
- **就绪检查核对。** 声明了 preset 而 lock 里没有能力记录，或记录取自另一个 preset——在花掉任何一次委派**之前**就判该条件不就绪。preset 进哈希却没人量过，等于两个纸面上的受试对象、事实上的一个。

编排实例自己的能力哈希另算一回事：它记在 `run.meta.orchestrator.capabilities` 里，是**取证**。报告的「程序一致」把它列出来，不做任何比较——编排器不回答题库的任何一道题，把它做成通过/不通过的输入，等于「我们升级了规划 agent」就判一条不变量违反。组合里没挂 capability-catalog 就不记这一行。

## `finalize`：跑完之后的再入口

run 自己那次过闸发生在每格跑完的当下，而「判官与终评」是归档**之后**的工作。pilot A 因此人手把十二格逐个 `dsh-mission transition` 推过去。`/eval finalize <runId>` 就是这条路，机械化：对 run 内每个 `archived` 的格子走同一条闸（`archived → releasable → released`，含归档闸对 `verdicts/` 非空的 file-check），非 `archived` 的格子逐格列出状态并跳过。它是 `--keep-units` 之后、取消之后、以及闸拒了而后来有人修好之后的再入口。

它不 force。闸拒绝按格记 `{kind: 'finalize-refused', from, error}` 到 orchestrator ns，格子停在闸拦下它的地方——闸正是「归档」这两个字有意义的原因。它也不碰没走到 `archived` 的格子：pending 或半途的格子是**没做完的工作**，不是**没释放的工作**。跳过按 `already-released` / `interrupted` / `not-started` 归类，一整个 run 一行就能说清。

**它也回收容器（T57）**。每个过闸的格子，单元在两次 transition 之间销毁——同一个位置、同一个顺序、同样不 force，与跑循环一致。在此之前这条路只动账本：一次容器 run 事后 finalize，会走到 `released` 而每个容器还 Up 着，且再没有任何一道闸能放行它们（T39 · G18）。报告写清销毁了哪些、还剩哪些，逐条给原因：闸拒了它的格子；格子已经过闸，只剩 `dsh-lab release <unit> --force`，那是人的决定；或者格子根本没跑完。单元面是**可选**的——组合里没有 lab 就把名单报成**未知**，绝不报 `0`。

进程外没有 mission 服务，所以 `dsh-eval finalize` 以子进程调用 `dsh-mission` 的 CLI（`--data-dir`、`--mission-cli`、`$DSH_MISSION_CLI`）——正是人手工用的那条缝。eval 仍然不 import mission 包的任何东西。那个子进程是账本不是 lab，所以 CLI 这一面不释放任何容器，并且每次都说出来。

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
4. **算 `home.sha` 并写回声明** —— 作用域目录的配置内容哈希（见[哈希规则](#哈希规则)，凭证形状的文件按名与按目录整棵排除）。声明里的 `home.sha` 是 null 或与实测不符时，**provision 就地把实测值写进条件文档并重算条件哈希**，第 5 步的 lock 因此锚的是改完之后的那份文档——所以「条件变 ready」是一次动作。`--no-write-back` 恢复旧行为：只报 warning、文档一字不动，人抄一次哈希再 provision 一次（T58 之前只有这一条路，走查里第 4 步的四次多余人工有一半出在这儿）。写回只碰 `home.sha`、只在不一致时发生、只写部署的条件库（T73 之前写的是 `--repo` 指的题库工作副本）。
5. **写 lock** —— `{schema, condition, sha, home:{sha}, provisioned:{at, cliVersion, effective:{model, reasoningEffort, permissions, endpoint}}}`。`provisioned` 是 `dataseek.condition-lock/1` 的**增补字段**，没有它的 lock 是 provision 之前写的，validate 读作「没人核对过」而不是违约。

validate 用**同一个函数**复核 lock 里的 `provisioned.effective`：两条 error 级字段对不上即「未就绪」并点名字段。sha 还匹配却对不上，只可能是这份 lock 不是 provision 写的——这正是要看见的那种伪造。

### 能力探针（T32b）

第 5 步之前还有一步，只对 `preset` 非 null 的条件跑：

1. **回读 roster** —— 扫作用域目录下每个 `profiles/*/cordis.patch.yml`，找挂 `@deepseek-ai/dsh-agent-presets` 的 insert 行，取它的 `default`。认的是**包名**，不是生成的注释横幅、也不是 profile 目录名——子 profile 名字可配，改了名照样读得到。读不到就不测量：把声明抄进 `provisioned.preset` 正是唯一会让这个字段失去意义的做法。
2. **确认两边读的是同一份 preset 目录** —— catalog 按**评测实例自己**的 roster 根解析 preset id，子 dsh 按作用域目录的根解析。两种形态：
   - 作用域目录**不自带** preset（`source: "instance-root"`）：两边读的就是部署的 preset 根，照测。但单元 bind 挂进去的只有作用域目录，所以这种条件**只在宿主轮解析得到 preset**，探针会把这句话记进日志。
   - 作用域目录**自带**一份 `<scope>/.agent-presets/<id>`（`source: "scope-snapshot"`，容器轮唯一可行的形态）：只有当**做出这份副本的 provisioning**（`localAgent.provisionScope`）报告它与部署那份**逐字节相同**时才测。凭什么转移得过去：规范化的能力面里**没有任何文件系统路径**（技能只进 name/source/正文 sha，工具只进 name/channel/parameters），所以两份逐字节相同的目录哈希必然相同——T32 的真机轮从另一头测到过这件事（同样内容换个 preset id，哈希一字不差）。没人担保、或副本的组合里有**绝对路径**、或它不是一棵纯文件树（有软链，过不了 bind mount），一律拒测并说出是哪一条。
3. **量** —— `ctx.capabilityCatalog.snapshotFor(<回读到的 id>)`，取快照自带的 `sha`。preset 挂不起来时 catalog 是**抛错**而不是退回全局层（T32 的决定），那句拒绝就是这里的答案。

探针还顺手把那份副本**整棵哈希**（每个文件都算，`SKILL.md` 也算）记进 `capabilities.snapshot.sha`。这不是对能力面的第二种说法，而是**离线**判断「受试对象还是被量过的那一个」的唯一凭据：`home.sha` 按设计只哈希配置后缀的文件，改技能正文它不动；能力面要有活的 catalog 才量得到。就绪检查与 `validate` 都核它——**T32b 记下的那个缺口（「validate 把过期的 lock 报成 ready」）就此关上**，至少对改正文这一类；validate 拿到作用域目录解析器（实例里跑时有，纯 CLI 里没有）才做这件事，拿不到就与从前逐字节一样。

**它量的是什么**：该 preset 的能力面**在评测实例这份 composition 里**的样子，不是子 dsh 自己那份（dsh-base + headless patch + roster）。作为因子它是真的——两个 preset 两个哈希，改技能正文哈希就变——但它不是子 dsh 的整张面。要量后者得把子 profile 启起来、问挂在里面的 catalog，那条启动路留给后续；到那天为止写下的 lock 会在新的量法下读作过期，而这正是上面那条新鲜度比对会说的话（「去重新 provision」），不是一次无声的错比。

provision 需要 local-agent 服务（作用域目录、凭证等级、effectiveSettings 都在那儿）与——为了探针——capability-catalog 服务，所以它和 `/eval run` 一样从活会话起：`/eval conditions provision <条件 id> [--no-write-back]`。CLI 进程外没有服务面，照旧拒绝。部署的条件库（`$DSH_HOME/state/eval/conditions`）是它唯一能写的地方；题库仓库从不被写。

界面上同一件事是**实验室 › 条件页每行的「provision」按钮**（T58）：它走同一个服务动词，写进部署的条件库，回执是同一张 `ok / warn / error` 清单（与计划审阅页同一个组件）。条件页还能改**一个**已有声明的字段——`model.endpoint`，就绪闸必看而此前没有任何入口的那个。改它是改因子：条件重算哈希、旁边的 lock 随即过期，页面直说这件事并把「再 provision 一次」留给人点，而不是替人重锚一个受试对象。两个动作都没有模型工具孪生（R1）。

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

## 实验：部署级对象（T73）

T73 之前，一份实验就是题库仓库里的 `datasets/<题集>/plans/<名称>.json`，条件住在它旁边，而评测读哪个仓库由**会话绑定**决定。那样一来，评测自己的记录（计划、条件、lock、分析初稿、导出）全都写进一个多 agent 共用的检出。T73 把两者分开：**题库仓库是只读输入，钉在一个 commit 上；实验是部署自己的对象**。

```
$DSH_HOME/state/eval/
├── experiments/<experimentId>/
│   ├── plan.json        # 计划，逐字节（起草时序列化，导入时原样）
│   ├── meta.json        # name、originSession、createdAt、dataset {registry, set, commit}、experimentId
│   ├── analysis/        # 分析初稿（eval_analysis_write 的唯一写入区）
│   └── exports/         # 缺省导出目录；plan.exports 与 --out / exportsDir 仍优先
└── conditions/<id>.json + <id>.lock.json   # 条件库，所有实验共用；哈希与 lock 语义不变
```

- **id 规则**：`<slug>-<yyyymmdd>-<4hex>`。slug 取名称的 `[a-z0-9-]`，至多 40 字符；日期取 UTC（同一时刻在哪台机器上都是同一天）；尾巴随机，撞了就重铸。目录先写进一个隐藏临时目录、一次 rename 就位，再把 `plan.json` 读回来比对字节——列表永远看不到写了一半的实验，崩溃只留下一个列表会跳过的点目录。
- **版本钉**：`eval_plan_draft` / 新建实验表单收 `dataset: "<登记 id>/<题集>"` 与可选的 `commit`。候选 = 登记跟踪分支的最新 commit，加上**同题集、共用条件**的已有实验钉住的 commit。候选的 `items/` 与 `schemas/` 树哈希全部相同就不算歧义，静默钉最新；否则拒绝，回答里列出候选，并要 agent 用 `ask_user_question` 问人、人跳过就停。给了不在候选里的 commit 同样拒绝并列出候选。原文：

```
version is ambiguous for <登记 id>/<题集>: these commits hold different items/ or schemas/, and results pinned to different ones do not compare:
  …候选清单（一行一个 commit 与来由）…
Ask the person which version this experiment should pin with ask_user_question, then draft again with that `commit`. If they skip the question, stop — do not pick one yourself.
```

- **validate 读物化目录**：实验按 `meta.dataset` 从 datasets 登记把整个题集在那个 commit 物化成只读视图，契约文件（阶段 schema、题目、探针）从那里读，条件从条件库读。plan 自己的 `dataset` 段不再用来定位任何东西。「plan 同级的 `plans/` 往上找」这条回退只留给**旧路径**（没导入过的旧 plan 文件）。
- **配对**：新 run 的 `run.meta` 带 `experimentId`，列表按它把 run 归到实验。旧 run 没有这个字段，依次按 planSha（导入逐字节保留计划正是为此）、再按 planPath（对导入实验的来源路径）配对；谁也认不领的 run 照样列出，标「旧运行（未关联实验）」。
- **导入**：`dsh-eval import --from <登记 id>@<ref> [--plan 名称] --instance URL`（Remote `importExperiments`）。只用 `git show` 读 `datasets/<题集>/plans/*.json`，计划字节原样；实验钉 plan 自己的 `dataset.commit`，没有就钉 ref 解析到的 commit。计划点名的条件进条件库：哈希相同就是同一条件、原地不动；**同 id 不同内容整个导入拒绝**，逐字段列出差异，一个字节都不写。同一份计划在同一 commit 再导一次是空操作，回执会说。
- **起跑**：`/eval run <experimentId>`、`dsh-eval run --experiment <id> --instance URL`、实验设计页的「批准并启动」。旧的 plan 路径入口仍在，只为没导入过的旧计划；那样跑出来的结果不属于任何实验。
- **绑定的尾巴已删**：eval 这边不再读任何绑定（`DatasetsBindingFace`、`resolveRepoScope` 的绑定分支、repo 配置兜底都删了），界面上不再有「未绑定」。旧绑定文件**不自动删除**，位置见 datasets 的 README（`$DSH_HOME/state/datasets/bindings/<session>.json`）；确认迁移无误后可以手动删掉。
- 没设 `DSH_HOME` 的实例没有状态根：实验与条件库相关的动词拒绝，错误页显示「这台实例没有评测状态目录」；列表退化成只列 run（全是旧运行）并附一句说明。

## 服务面 `ctx.dshEval`

服务的 cordis 名是 `dshEval`，**刻意不叫 `eval`**：loader 用 `with (ctx) { return eval(expr) }` 求值配置里的 `!!js` 表达式，ctx 上的 `eval` 属性会遮蔽全局 `eval`，凡挂载本包的组合一遇 `!!js` 即炸（真实 3171 实例踩出）。包名、入口 id（`eval`）与 `/eval` slash 名不受影响。

| 方法 | 作用 |
|---|---|
| `validatePlan(planPath, {roots?})` | 校验 plan schema 与语义（判官≠选手、judge/expectedNs 交叉检查、预算下限），解析条件声明与 lock，lint 阶段 schema，并交叉核 `expectedNs` 与每道题**实际能产出什么**——声明 `script` 但 `verify/probes/` 无可执行探针、声明 `llm-draft` 但没有 rubric 或 rubric 无 `kind: llm-draft` 叶子，两者都按 warning 报出（T23；题库侧的检查归 T26）。`roots` 给了就只从它读（实验的物化视图与条件库）；不给则走旧路径解析。数据问题以 diagnostics 返回（`errors` / `warnings` 各带稳定 code），从不 throw |
| `validateExperiment(experimentId)` | 实验的 validate：按 `meta.dataset` 物化题集视图，以它和条件库为 `roots` 调同一个 `validatePlan`（T73） |
| `hashCondition(condition)` | 条件哈希 = 规范化 JSON（键排序、无空白）的 sha256，`notes` 不参与（改注释不是换条件）。非法文档抛 `EvalContractError` |
| `hashHome(homeDir)` | scoped home 内容哈希：只取配置类文件，按拒绝清单跳过凭证形状的路径；内容只进摘要，绝不返回或打印 |
| `generateTemplate(manifestPath, opts?)` | 由题集 manifest 生成 run 模板（可选项：`stages` 子集、`missions` 格批次、`name`、schemaPath 前缀）。纯函数：不探测 schema 文件，探测归 mission 的 runCreate lint |
| `run(planPath, options?)` | run 循环本体（见上节）。缺 datasets / mission / localAgent 任一即拒绝并列出哪个；`dryRun` 选项只做校验 + 模板 + 矩阵 + 顺序，不需要任何上游 |
| `conditions()` | 列出条件库里的条件：harness、声明模型与 endpoint、条件哈希、就绪（lock 在不在、还对不对、home 是否核过）、lock 里的 `provisioned` 快照、未解析字段。条件库是部署的（`$DSH_HOME/state/eval/conditions`），与会话无关 |
| `conditionDiff({a, b})` | 两份条件声明的逐字段差异（规范化深比较；`notes` 进差异清单但不影响 `identical`）。两侧各可以是条件 id 或路径。**只展示，不推荐**：哪些字段不同、各自取值，就这些——这对条件值不值得跑，取决于文件里没有的东西 |
| `provision(conditionPath, {repo, writeBack?})` | 把声明变成实物并写 `<id>.lock.json`，见下节。**lock 的唯一写入者**；`repo` 是它能写的那个目录（T73 起调用方只传部署的条件库），声明不在它里面就拒绝。缺省把实测 `home.sha` 写回声明再锚 lock，`writeBack: false` 恢复旧的两步形状 |
| `provisionLibraryCondition(id, {writeBack?})` | 按 id provision 条件库里的一条，slash 与条件页都走它 |
| `provisionCondition({condition, keepDeclaration?})` | 条件页的 provision：同一个动词，写进部署的条件库；回执是 `ok / warn / error` 清单加改完之后的那一行 |
| `setConditionEndpoint({condition, endpoint})` | 改一条已有声明的 `model.endpoint`——任何面能改的既有声明字段只有这一个。改的是因子，所以回执点名旁边的 lock 已过期 |
| `experiments({session?})` | 实验室列表的投影：一行一个实验，**草稿与 run 同列**。实验取状态根下的 `experiments/`；run 取账本里 `run.meta.evalVersion` 有值的那些，按 experimentId → planSha → planPath 配到实验，配不上的标 `legacy`（旧运行）。每行带题库钉（`<登记>/<题集> @ 短哈希`）、条件与判官 id、题数、rep、因子（条件两两 diff 推出）、状态、进度、开始时间。降级不拒绝：没挂 mission 只列实验、没有状态根只列 run，缺哪块就在 `notes` 里写一句 |
| `experiment(runId)` | 一次已启动实验的概览：上面那一行，加只有 run 才有的部分——run.meta 摘要、就绪检查记录**原文**、桶与阶段两张直方图、未释放清单、本实例还留着的 job。草稿没有 run，它的概览就是列表那一行；草稿自己的那一页是 `planReview` |
| `planReview({experimentId} \| {planPath})` | 计划审阅页的载荷（实验按 id，带上 meta 的版本钉；旧 plan 按路径）：plan 自己的字段（快照、题目、条件、判官与采样、rep、阶段、顺序种子、预算、期望 ns、重试、导出目录、环境、作者备注）+ `validatePlan` 的结论摊平成 `ok / warn / error` 逐条。**同一个函数**——页面和 `dsh-eval validate` 不可能对「这份计划能不能批」给出两种答案。`ok` 那几条是已解析的条件：只报问题的审阅页，会把一份干净的计划渲染成空白 |
| `conditionsPage()` | 条件页的表：`conditions` 的投影，一行一条——harness 与 drive、声明模型、scope、preset、lock（在不在、还对不对、home 有没有哈希、provision 记了什么）、就绪词 |
| `conditionDiffPage({a, b})` | 条件页的 diff：`conditionDiff` 的投影，**只带不同的字段**，每侧的值是规范化 JSON 文本（`null` = 这一侧没有这个字段，本身就是一种不同）|
| `approve(experimentId, {parentSessionId, cwd?, keepUnits?})` | **人的动作**（界面规格 R1、第 5 步）：先按实验 validate，有 error 就拒绝、`runStart` 一次都不碰——条件都解析不出来的计划一旦起跑，就要用真委派去发现一个离线检查早就知道的事实。warning 不拦。通过则以批准的这个会话为父会话、它的工作区为 cwd 起 run，run 带上 experimentId。**拒绝是返回值不是异常**：页面两种情况渲染同一张 check 列表，理由就该贴在解释它的那张表旁边；接线失败（没有 job 注册表、没有活着的父 agent）同理原样进 `refusal` |
| `matrix(runId, {column?, groupBy?, filter?, stuckMs?})` | 矩阵页的排布（I5·T35b）：**行永远是题**，列是调用方选的那一个因子，其余因子分组或钉死。因子集合就是 run.meta 里各条件文档两两 diff 的键并集；格内四样——rep 圆点（实心 ≥ judged / 半心进行中 / 空心未起）、阶段（各 rep 一致就是那个态，否则 `mixed`）、卡格（在态时长超阈值，缺省 30 分钟，已判的格不算卡）、题面哈希是否与同题其余格一致。物化哈希从 run 循环自己写的 `materialization.json` 读；mission 面报不出 `dataDir` 就记「无法核验」，绝不猜 |
| `cell(runId, missionId)` | 一格的全部（格子详情抽屉）：各次 attempt（含重跑原因与类别）、检查点、产物、refs、各注解命名空间的条数与最近一条摘要、**verify 原样输出全文**、**选手**委派的子会话 id、**判官各轮的子会话**、以及这一格此刻可不可释放 |
| `cellArtifact(runId, missionId, attempt, path)` | **一件产物本身**（I5·T69）。路径对着那次 attempt 的运行数据目录解，先按字面判越界、再对两侧 `realpath` 判一次——前者不看磁盘，所以 `../` 不论目标在不在都按越界拒（拒绝语句的差别不能被用来探测文件存在）；后者抓的是归档里指向外面的软链，字面判看不出来。只认文本扩展名（md / json / txt / yml / yaml / log / jsonl），超 256 KB 返回开头并说明截断，目录返回条目，其余按**名字**拒并说明。**不去指纹**：这一页的页眉本来就写着对比组，去指纹只会挡住排查的人而保护不了任何人——盲的那份是判官台的 |
| `cellRows(runId, query)` | 格子页表格要的那几列，由同一个 `cells` 投影收窄而来——模型读整份，tab 读这份，一份实现 |
| `retryCell(runId, missionId, {reason, category, by?})` | 带原因重跑，原样转发给 mission。**原因是必填**：空原因在这里就被拒，不劳 mission 再拒一次——没人说得清来由的 attempt 比没有更糟 |
| `releaseCheck(runId, missionId)` | 释放检查：这一格的资源现在能不能销毁。答案是状态机自己的 `releasableStates`，eval 不加意见 |
| `exportPlan(agent, request)` / `exportRun(agent, request)` | 导出 bundle 的两步，转发给 **mission 自己的 Remote**。guarded 层怎么算（经 datasets 探测）与 fail-closed 的闸都在 mission 那边，eval 只转发调用方的确认，既不能放宽也不能收窄——泄题闸有第二份实现，就有第二个地方会错。组合里没有 mission 的 Remote 就整个拒绝导出，而不是在这边把闸再写一遍 |
| `itemRuns(datasetId, itemId)` | 一道题的「作答记录」：哪些评测 run 跑过它、各格在哪个态、各 ns 各有几条判定。按 `task` label 与 `meta.datasetId` 认题，与矩阵同源；给题集 tab（T47）用，没挂 mission 就空列表加一句话 |
| `runStatus(runId)` | 投影一次 run：run.meta 摘要（planSha、快照 commit、条件、随机顺序与种子、启动时间）+ 逐格一行（题、条件、rep、attempt、状态、桶、编排器最近一条注解、submission-rejected 次数）。缺 mission 服务即拒绝并说明原因 |
| `finalize(runId, options?)` | 把 run 内每个 `archived` 的格子走一遍 `archived → releasable → released`（与跑循环逐格走的是同一条闸），并**在两次 transition 之间销毁过闸格子的单元**；非 archived 的格子逐格列出状态，仍在的容器逐条给原因。闸拒绝按格记录，不 force。lab 是探测来的、不是必需的：没有就把单元名单报成未知。组合里没有 mission 服务即拒绝并说明原因 |
| `runUnits(runId)` | 此刻 **lab** 为这次 run 持有的容器，与每格在账本里的状态 join 起来。刻意不用 mission 的 `unreleased`——那是账本按格子 refs 推出的**判断**；值得看的恰恰是两者不一致的那种：账本已经 released、容器却还 Up 着。组合里没有 lab 就答 `available: false`（未知），而不是空名单 |
| `report(bundleDir, {out?})` | 把 mission export 的自包含 bundle 变成 `results.jsonl` + `summary.md`（见下节）。只读 bundle，写入缺省 `<bundleDir>/report/`，重复运行覆盖（报告是派生态，bundle 本身只增不改） |
| `runReport(runId, {outDir?})` | 报告页的载荷（I5·T38）：先**找**这个 run 导出的 bundle——调用方刚导的目录 → plan 自己的 `exports` → 所属实验的 `exports/`（T73；旧运行仍试 `<题库仓库>/exports`），逐个试 `<runId>-bundle`——再交给同一个 `analyzeBundle` 分析，把五条有效性校验、配对差值、效率表与判官数字投影出来。**一个字节都不写**：落盘仍是 `dsh-eval report --out`，报告去哪儿是人的决定。还没导出的 run 返回 `bundleDir: null` 加找过的目录清单——「还没导出」和「没有报告」是两件事，只有前者有按钮 |
| `finalizeView(runId, by?)` | 报告页那颗 finalize 按钮背后的 `finalize`：同一条闸、同一次走，把逐行进度**原文**一起收下来，页面因此能按格显示闸说了什么，而不是只有一个成功数 |
| `judgeQueue(runId)` | 判官台的**盲**队列（I5·T37）：每格一条——序号 + 不透明 ticket、去指纹产物原文（复用 run 循环那个 `deidentify`，规则由 `run.meta.conditions` 重建）、rubric 里 `kind: human` 的判据、各判官各样本的 llm-draft、已有的 human-final，外加按**活账本**实时算出的一致性。载荷里没有条件 id、harness、模型，也没有 missionId——盲是载荷的属性，页面漏不出它没收到的东西 |
| `draftExperiment(request, {session?})` | 起草一个实验：定版本钉、铸新条件进条件库、建实验目录并读回、再 validate（见上节与 `eval_plan_draft`）。从不起跑 |
| `importExperiments({from, plan?})` | 从登记仓库导入旧计划为实验（见上节）；拒绝时什么都不写 |
| `writeAnalysis({experimentId, path, content, overwrite?})` | 往一个实验的 `analysis/` 写一个文本文件；回执带「在结果对比页可看」 |
| `experimentArtifact({experimentId, path})` | 读一个实验目录里的一个文件：只在这个实验目录里（字面判越界 + realpath 再判），只内联文本，超 256 KB 截断并说明 |
| `humanFinal(runId, ticket, verdicts, sessionId)` | 把一格的终评记进 `human-final` ns——**这个 ns 在整个家族里唯一的写入口**。ticket 在服务端反解回格子；转发 mission 的 `annotate`，只追加不改写；注解的 `by` 记 `tab:<sessionId>`（不是 `tool:` 前缀），verdict 文档的 `by` 记 `judge-bench`。每条判定必须带证据，空的拒绝。**没有对应的模型工具，将来也不会有**（界面规格 R1） |

## 报告（report）

输入是 mission export 的 bundle（manifest.json、run.json、missions/<id>/attempt-N/{meta,annotations,artifacts}、dataset/<layer>/），输出三份文件：

- **results.jsonl** — 一行一个判定：`{task, condition, conditionSha, rep, attempt, stage, ns, criterion, pass, ratio?, weight?, negative?, toolCalls?, evidence, by}`（`toolCalls` 是该**格**各轮工具调用之和，本格没有任何一轮报过就整个键缺位——因此在旧 bundle 上复算出的 results.jsonl 逐字节不变）。ratio 只在判定声明了可用的 `{passed, total}` 时出现；weight / negative 只在该判据的极性可知时出现（见下）；stage 取自注解记录的 stage 字段（判定契约本身不含 stage，未记录即 null）。
- **summary.md** — 开头先核五条有效性校验：前四条是不变量（题面一致 / 环境一致 / 受试对象一致 / 程序一致），**任一项不成立或无法核验，只输出事实表，不输出比较**；第五条「判定覆盖一致」逐对核，不过只把那一对降为描述（见下文 T71）。比较启用时：因子由 run.meta.conditions 的条件文档两两 diff 推出（只差一项即因子名，差多项标「多因子」只做描述统计）；配对以题为区组、rep 为重采样单元，输出逐题差值（得分判据数与加权分）、n、自助法 95% 置信区间（seed 确定性，统计手写无依赖；有差值的题少于 3 道时不给区间）；判定覆盖不一致、n < 3、因子未知/多因子或没有区间时打印「不可排名」并拒绝名次。判官一致性按 criterion 算**同一判官**双采样的一致率与 Cohen κ（面板里每位判官各算各的，不把两位判官的分歧算成某一位的噪声），列了多个判官时另加一行跨判官一致性（每位先按自身多数定调，再比判官之间）；human-final 在场时算 llm-draft 对终评的一致率；自评判据单列一行提醒单独读。「每格由谁判」一表在比较启用时进比较节，否则进判官一致性节——谁判的是事实，不因不变量拦下比较而消失。效率并列不合成，且每一项**只统计已完成的格子**（`judged` / `archived` / `releasable` / `released`）：活跃时长（委派 durationMs 之和）、工具调用（各轮 `toolCalls.count` 之和；没有任何一轮报过计数就打「—」而不是 0——「没人报过」不是「一次没用」）、标价成本（run.meta.pricing 给了才有）、委派轮次（只在双方都完成的题上比）、token 只在同模型内比。未完成格子的委派时长买到的工作量未知，混进来得到的数没有意义——pilot A 两家活跃时长同为 21.0 min，那个巧合就是一格只跑了阶段一的 dsh 格子撑出来的。被排除的格子按条件与状态在表下单列一行；`results.jsonl` 不受影响。「程序一致」一节在 run 记了 `run.meta.subset` 时把它打印出来，只覆盖了一部分 plan 的 run 因此不会被读成完整的。expectedNs 里某 ns 的判定全由 `tool:` 写入时 summary 顶部红字标出。

- **usage.jsonl** — **一轮委派一行**的花销台账：`{run, cell, attempt, condition, task, stage, round, counted, observedModel?, cliVersion?, durationMs?, usage?, toolCalls?}`。这里不聚合、不计价——效率表由它汇总，外部计价也只读它。`counted` 说明这一轮是否在效率表口径内（当前 attempt 且已完成，T23 规则）：把某条件 `counted: true` 的行加起来，就逐项等于它在效率表里的那一行；`counted: false` 的行是表**有意排除**的花销，留在这里而不是丢掉，好让外部按自己的口径取用。取不到的字段一律缺位，绝不补零——「没人报过」和「花了 0」是两件事。

判定源**逐条判据**按权威排序取（human-final > llm-draft > script，同判据多样本按多数计），所以一格的得分可以来自多层，报告把这个混合标出来；rep 是独立样本，attempt 只算基础设施重试——所有 attempt 的判定都进 results.jsonl，聚合只用各格最新 attempt。

### 判据极性与权重表（协议 §6.5）

`pass` 恒为「判据成立」。负分判据的 criterion 写的是缺陷，成立即缺陷存在——所以报告的主轴是**得分判据数**：正向判据成立计 1，负向判据成立计 0、不成立计 1；加权分 = Σ weight × 该判据得到的比例，负 weight 自然扣分。摘要另出一张「负向判据命中」表（哪格、哪条、比例、证据），那是缺陷清单。

「按比例给分」的判据（F2 / F3 的 C1、C2）在判定里带可选的 `ratio: {passed, total}`（协议 §6.5）：报告按 `passed / total` 计分而不是布尔（负向判据计其余量 `1 − passed/total`），同判据多样本取所给比例的均值。`pass` 仍是那个布尔事实（判据**完整**成立），`ratio` 只是细化它——读不懂 ratio 的消费者退回严格布尔，只会低估。比例只走字段：报告**从不**去解析 `evidence` 里的「通过 6/9」之类前缀；`total ≤ 0` 或 `passed` 越界的比例按缺失处理并在附注里点名。

极性来自 rubric，不来自 verdict。rubric 住在 grading 层、不进 bundle，所以 run 在导出后从 grading 层**派生**一份权重表写进 `<bundle>/report/rubric-weights.json`（`dataseek.rubric-weights/1`：`{task, id, weight, negative, kind, axis}`，只有编号与数字，**不含 criterion 文字与 evidence**，因而不经泄题闸）。报告优先读它，其次读 bundle dataset 层里的 rubric（有意开闸导出时）。两者都没有时，报告只出计数，并明确打印「极性未知，计数按正向处理」、把负向判据数记为 unknown——不把「无从判断」显示成「没有缺陷」。`report` 只读这个文件，从不改写它。

## 模型工具（五读、一草、一份分析，七个）

**本包不再注册任何模型工具（BREAKING）**：下面这七个工具与 `tool:eval` 提示词段归伴生行 `@khorsheed/dsh-eval-tool`，由 agent preset 按会话授予。迁移两步：把伴生包作为依赖安装，并在目标 preset 的 `agent.cordis.yml` 里加两行——`- id: eval-tool` 与 `  name: '@khorsheed/dsh-eval-tool'`（该行可带 `config: { tools: none }`）。下面的清单、配置与行为描述自此描述的是**伴生行**的工具面；服务面与 CLI 仍归本包，而 `/eval` slash 的**注册**自 preset 可见性收口（A3）起也归伴生行——落进 preset 的 scope 层，只有授予会话的补全列表可见（官方 `/goal` `/plan` 同款机制）；handler 与定义仍在本包 `src/slash.ts`，由伴生行带它的 scoped ctx 调 `registerEvalSlash` 接入，handler 内另有 roster 兜底守卫（读不到一律放行）。

agent 在一次实验里只出现两次：规划期起草、分析期读结论。规划期要写的是一个实验（plan 与它引用的新条件）；分析期要写的只有一份初稿，落在那个实验的 `analysis/`。所以模型工具是**五个读、一个起草、一扇分析的门**，并且刻意没有起跑的那一个：能起 run 的 agent 就能起一次人没批准的 run，而起草与写初稿都起不动任何东西。

第四个 `eval_cells` 是 I5·T46 加的：评测预设自那以后不再挂 mission 的伴生行（界面规格 R6「评测模式下 mission 这个词不出现」），原先用 `mission_list` / `mission_get` 读逐格细节的路没了，这个工具用 eval 自己的投影答同一个问题——数据仍经 `ctx.mission` 的结构面算，但算在服务端，模型侧与前端都不碰 mission。

| 工具 | 答什么 |
|---|---|
| `eval_conditions` | 部署条件库里有哪些条件、各自的哈希与就绪状态、lock 里的 provisioned 快照、哪些字段还是 null；`diff`（恰好两条条件）改为逐字段比较两份声明——只展示差异，不推荐哪条值得跑。T73 起没有 `repo` / `dataset` 参数：条件库是部署的，不跟会话走 |
| `eval_plan_validate` | 一个实验（`experiment`: id）的校验结果：`ok` / `errors`（不能跑）/ `warnings`（还没解析）与解析出的条件 sha，读的是实验钉住的题集视图与条件库。`plan`（路径）只留给没导入过的旧计划。校验从不启动任何东西；`eval_plan_draft` 建完自己已经验过一遍 |
| `eval_plan_draft` | **这一行的第一个写**（I5·T34）：建一个实验（T73）：`dataset` 写 `"<登记 id>/<题集>"`，`commit` 可选——不给就按[版本钉](#实验部署级对象t73)的规则定，歧义时拒绝并要 agent 问人。新条件写进部署的条件库，plan 写进新实验目录，随即 validate，返回 experimentId 与结果；题库仓库一个字节都不写。与界面「新建实验」表单同一个服务面动词（`draftExperiment`），所以人建与 agent 建的是同一种对象、同一个列表。新条件一律从现有条件**复制**再改点名字段（harness / 模型 / **endpoint** / scope / preset / 权限 / 推理强度，T58 起七个），不从零造；改了零个字段会被拒（那是同一个被试换了个名字）。`model.endpoint` 是七个里最晚进来的一个，理由是它是就绪闸必看的字段却谁都改不了，于是每份起草出来的 plan 都得先拿编辑器改两份 JSON 才跑得起来，而两份还必须填同一个值，否则凭空多一个因子。计划声明了 `unit_image` 而源条件没有 `unit` 段时，复制件的 `unit.scopedHome` 与对应的 `env.keys` 一项按**该家的默认凭证挂载点**补齐（四家各一行，表在 `unit.ts`），并写进 notes；表里没有的 harness 一个字都不补，validate 照旧按名报 `UNIT_SCOPED_HOME_MISSING`——猜一个挂载点比报错更糟。validate 不过的实验**照样建出来**——它就是一份「草稿」，报错原文交给人，比什么都不留下有用。从不覆盖已有条件 |
| `eval_analysis_write` | **这一行的第二个写**（I5·T60 · G16；T73 由 `eval_repo_write` 改名收窄）：往一个实验（`experiment`: id）的 `analysis/<path>` 写一个文本文件，任意深度；实验目录里别的路径（plan、meta、exports/）一律拒绝，并把白名单原样回给调用方。缺省不覆盖（要改传 `overwrite`），空内容拒绝。回执说「在结果对比页可看」——分析初稿在报告页第 ⑤ 块「分析初稿」列出（缺省折叠、最新一份展开，只列文件名，没有就不出现）。存在的理由是授予的尺寸要配得上动作的尺寸：为一份 markdown 放开整台机器（`danger-full-access`）不划算 |
| `eval_run_status` | 一次 run 的 run.meta 摘要与逐格状态；数据源是 `mission.runStatus` 与 orchestrator ns |
| `eval_cells` | 给了 `run_id` 就答一次 run 的**逐格**细节：题 / 条件 / rep 与其余 labels、桶、当前阶段与已停留时长、attempt、该次 attempt 持有的单元（`resource` 与环境指纹）、检查点名、各注解命名空间的条数、委派的子会话 id；`bucket` / `task` / `condition` 三个精确过滤。**不给 `run_id` 就改答「有哪些实验」**（I5·T35a）：每个实验与每个 run 各一行（配不上实验的 run 标「旧运行」），列与实验室 tab 同源（同一个 `experiments` 投影，两个面不可能各说各话）——这是 T46 摘掉 `mission_run_list` 之后留下的缺口，先这么问拿到 run id，再带着它问一次 |
| `eval_experiment_get` | **一个实验，按实验室那一页的读法，一次答完**（I5·T76 · D3）：`experiment` 收 experimentId、列表行 id 或 run id。答的是列表那一行（去掉 plan 路径）、这个实验的全部 run id（新的在前）、最新一次 run 的摘要（与 `eval_run_status` 同源，去路径）、各桶格数，外加一份**作答索引**——每个 题 × 组 × 次 一条，带阶段、桶、检查点、注解条数、选手子会话，以及那次 attempt 登记的**文件名**（相对 attempt 目录的名字，绝不是路径：分析要引用的是能在别的机器上找回的名字），最后是 `analysis/` 里已有的分析初稿名。只读，别的什么都不带：不起跑、不 finalize、不 provision，也没有通往人工评估出口的门（界面规格 R1）。以前 agent 要拼三次读才得到同一个答案，引用作答时还得问人要路径 |

除这两个写之外的写类动词一个都不开：run 由人在会话里用 `/eval run`（或在计划审阅页按「批准并启动」）发起，materialize / submit / transition / annotate / archive / export / finalize 归编排器服务面与人的 CLI（profile 的[「工具按域开放」](../../profiles/web-eval/README.md#工具按域开放)）。`eval_plan_draft` 能给模型，靠的正是这条线的另一面：草稿是文件不是动作，批准、登录、provision、终评一个都没挪位。

### 没有 `repo` 参数

T58 把工具的 `repo` 参数收窄成「只能复述本会话的 datasets 绑定」，起因是 agent 被告知没有绑定之后用 glob 搜磁盘、在一个多 agent 共用的检出里改了别人正在跑的 pilot 计划（走查缺口 G1）。T73 把这条路整个拆了：工具不再有 `repo` 参数，评测也不再读任何绑定——题库只以 `<登记 id>/<题集> @ commit` 的形式被读（`git show` / 物化视图），评测自己的东西写进部署的状态目录。agent 没有「指一个路径」的余地，也就没有绕行道。

配置项 `tools: 'all' | 'none'`（缺省 `all`）随之搬到**伴生行**，本行不再有这个键。没有更细的分组，因为没有可分的：模型工具面一个写工具都不注册。`none`（或没有引用这一行）时模型看不到这七个工具；本包的服务面与 CLI 照常，`/eval` slash 随伴生行的 preset 授予显隐（`tools: none` 只关模型面，人类面不分层——行在 preset 里，命令就在）。

工具注册走**延迟注入**（`ctx.inject(['tools'], …)`）而不是 apply 期的 `ctx.get('tools')` 探测：探测会和工具注册表自己的挂载顺序赛跑并且输，工具静默地一个都注册不上，还没有任何东西会说（room 与 worktrees 都踩过并修过同一处）。延迟注入在注册表出现时才触发，在没有注册表的组合里永不触发——那样的组合保留 slash、CLI 与服务面，绝不炸启动。`tool:eval` 提示词段同理走 `systemPrompt` 的延迟注入。

## 发起一次 run：三个入口，一条取消路径

run 是**后台 job**，不是一句回复。`/eval run` 把它注册成一个 `eval-run` job 后**立即返回** job id 与 run id：轮次结束、会话关掉、浏览器标签页关掉，run 照跑——它此前活在发起那一轮里，发起端一断整个 run 就没了（I3·T22 第 5 步）。

| 入口 | 用在哪 | 形态 |
|---|---|---|
| `/eval run <experimentId>` | 人在实例里发起（缺省） | 起 job，立刻回 `job <id> · run <id>`；日志用 `job_output` 读 |
| `/eval run <experimentId> --wait` | 交互式的短跑（`--dry-run`、一格的 plan） | 老形态：轮次内等到跑完再回复，逐字节与本改动之前相同 |
| `dsh-eval run --experiment <id> --instance <url>` | CI（没有浏览器） | 经实例的 Remote 面起同一个 job，跟着日志跑到结束，退出码即 job 结局 |

- **取消只有一条路**：`job_kill <jobId>`。它触发 job 的 cancel → run 的 `AbortSignal` → 与每格预算计时器同一条杠杆（对每个在跑的委派 `localAgent.cancel`）。被取消时正在跑的格子**不重试、不强推状态**，停在当时那一步——`finalize` 因此把它归入 `interrupted`（T23 的分类）；一格都还没开的格子留在 `pending`，那是 `not-started`，两件不同的事。run 自己在 `run.meta.cancelled` 记一笔，bundle 照常导出（被取消的格子也是证据）。
- **父会话**：委派要的是**活的 agent**，不只是一条会话记录（家族门面 `requireLiveParent` 的要求）。`/eval run` 起的 job 用发起会话作父（它的 agent 活过标签页），发起会话没有活 agent 时（Remote/CI 就没有）job 自己开一条会话作父，run 结束时关掉。回复里会说明用的是哪一种。**自己开的那条会话带工作目录**（T29d）：run 自己的格子根 `<stateRoot>/cells/<runId>`，开之前先建出来。容器轮**不传每轮 cwd**（单元里宿主路径没有意义），provider 于是回落到父会话的 cwd——没有 cwd 的父会话让每个容器条件都以「the parent session has no working directory to run the CLI in」被拒，一句在讲编排器自己的管道、却像是 harness 的错的话（I4·T29c 记的）。两条起法的就绪原文因此逐字相同，测试钉住了这一点。
- **没挂 jobs 服务的组合**：不拒绝，退回同步等待，并在回复**首行**写明这一轮的等待意味着什么。

```sh
/eval run <experimentId> [--wait] [--concurrency N] [--dry-run] [--keep-units] [--out DIR] [--retries N]
                         [--only id,id] [--max-cells N] [--ignore-readiness]
/eval finalize <runId>
```

run 的发起仍是人的动作，不注册任何 run 类模型工具——写类动词归编排器服务面与人。模型面能看到的是 job：`job_list` / `job_output` / `job_kill`（评测预设里已经有这三个）。

## slash 与 CLI

从 PATH 或 pnpm 的 `.bin` 软链调用与直连 `lib/cli.js` 等价：入口守卫先把 `argv[1]` 解析成真实路径再比对，软链路径不会让它静默空跑。

```sh
dsh-eval validate <plan.json>             # 校验 plan；报告 JSON 走 stdout
dsh-eval run <plan.json> --dry-run        # 离线彩排：校验 + 模板 + 矩阵 + 顺序
                                          #   [--only id,id] [--max-cells N] 彩排一个子集
dsh-eval run --experiment <id> --instance URL  # 在一台**在跑的实例**上起一个实验的 run 并跟日志到结束（CI 入口）
                                          #   [--token T]（或 $DSH_TOKEN）带实例的启动 token
                                          #   [--no-follow] 只打印 job/run id 就返回
                                          #   [--keep-units] 每格停在 archived、容器留着；停它用实例上的 job_kill
                                          #   旧计划没导入过：run <plan.json> --instance URL（路径按实例上的解析），结果不属于任何实验
dsh-eval import --from <id>@<ref> --instance URL [--plan NAME]
                                          # 把登记仓库里的旧计划导成实验（git show、逐字节、条件进条件库；冲突整体拒绝）
dsh-eval finalize <runId>                 # 把 archived 的格子走一遍释放闸
                                          #   [--data-dir DIR] [--mission-cli PATH]；以子进程调 dsh-mission CLI
                                          #   是账本不是 lab：这一面不释放任何容器
dsh-eval template <manifest.yml> [--stages a,b]  # 打印生成的 run 模板
dsh-eval conditions hash <condition.json> # 打印 { id, sha, warnings }
dsh-eval conditions list                  # 条件库逐条件：哈希、lock 状态、home 是否核过、provisioned 快照
dsh-eval conditions diff <a> <b>          # 两份声明的逐字段差异（各侧是条件库里的 id 或路径）
dsh-eval conditions provision <id>        # 需要 local-agent 服务，进程外没有——CLI 如实拒绝
                                          #   并指向 /eval conditions provision
dsh-eval report <bundleDir> [--out DIR]   # 出 results.jsonl + summary.md；摘要 JSON 走 stdout
```

plan 路径与 `--out`（以及 `report` 的 bundle 路径）在服务边界统一展开 `~`：slash 参数没经过 shell，CLI 参数为了活过 shell 常被引号裹住，两边都到不了 `$HOME` 展开——所以展开放在三个入口共用的那一层，而不是各记各的。

数据走 stdout JSON，诊断走 stderr；退出码 0 ok / 1 失败 / 2 用法错误（与 `dsh-lab` 一致）。CLI 直连内核，不需要宿主在跑——脚本场景与已挂载插件行为完全一致。进程外没有活的父 Agent、也没有 datasets/mission/localAgent 三个服务，所以**不带 `--instance` 的 `run` 只做 `--dry-run`**；`--instance` 时 CLI 不再假装自己是编排器，而是做 CI 真正需要的那件事：当调用方。它走的是实例普通的 Remote RPC（`POST <base>/api/dshEval/<method>`，`{args:{…}}` 进、`{ok,value}` 出，token 走 `?token=`），四个动词与 slash 用的是同一套 job 层。`finalize` 不需要父 Agent、只需要 ledger，所以它在进程外以子进程调 `dsh-mission` CLI 照常工作；任一格闸拒绝即退出码 1。

## 实验室 tab（浏览器半边，I5·T35a、T36）

本包自此有 client 半边：会话的 `conversation.view` tab 环里多一个**实验室 / Experiments**（order 40）。插件 id 仍是 `eval`——仓库里的 `lab` 是容器单元插件，两个名字不撞（界面规格 R5）。

- **自隐**：当前会话的 preset 组合里点了 `@khorsheed/dsh-eval-tool` 行才注册这个 tab，没点就**不注册**——tab 条的按钮是按注册枚举的，返回 null 的组件只会在条上留一个空壳按钮。判据读官方 `pluginInventory` Remote，**每条读不到的路都失败开放**（可见）：宿主没有这个命名空间、RPC 还没回来或失败、preset 组不存在或标了 `broken`、会话根本没有 preset。判据是那一行**在不在**，不另设逃生口：隐掉一个只读视图不会弄坏任何已有的 run。**「当前会话的 preset」自 I5·T60 起是沿父链取到的第一个**（I5·T39 · G13）：成员子会话（选手那次委派的会话）自己没有 preset（条件里 `"preset": null` 是常态），单看它就走失败开放那一支，于是父会话正确隐掉的 tab 全部出现在选手的对话里。走到父那里才是这条判据的诚实读法——子会话继承的是父的组合，答案自然也该继承；既没 preset 也没有父的会话照旧失败开放。
- **列表**：一行一个实验，**草稿与 run 同列**——对着手要规划下一次比较的人来说它们是同一类东西（界面规格 §五）。列：名称、题库快照、条件数（+ 判官）、题数、rep、因子、状态、进度、开始时间。动作只有「新建实验」，本轮是占位（归 T36）。
- **状态**由纯函数 `deriveExperimentStatus` 从四处推出——plan 的 validate 结果、账本里每格的阶段、后台 job 的结局、人留下的**收尾标记**（T72）：草稿 → 待批准 → 运行中 → 评估中（所有格子到了 `judged` 或更后）→ 已完成（人走了人工评估四个出口里的前三个）；另有被拒（job 以 failed 落地）、已取消（job 被 kill）、**评估不成立**（第四个出口，灰）与**停滞**（橙）。**已完成只有人能给**：全格 `released` 而没人收尾的 run 仍是评估中——「判官做完了」与「人说了结果是什么」是两件事。**停滞是算出来的、从不写账**：非终态、本实例没有活 job、账本（格子进入当前阶段的时刻、注解）超过 `STALL_THRESHOLD_MS`（`src/experiments.ts`，10 分钟）没动；全格已判的 run 等的是人，等人不叫停滞。粗糙的边写在函数注释里，不抹平：job 层把「就绪检查拒绝」和「跑到一半抛错」记成同一种 `failed`；一格都没有的 run 读作运行中（过了阈值读作停滞）；实例重启后 job 记录没了，被拒与已取消够不着；另一个进程里健康的 CLI run 在单个阶段待满 10 分钟也会读成停滞——账本记的是转移，不是心跳。
- **详情**是**四个阶段**的壳（实验设计 · 运行记录 · 结果对比 · 人工评估，按界面规格 §五 v2；v1 的七个子页见 git 历史，T67 改的就是这一层）。每个阶段页顶一条**状态 + 一个主动作**，动作由状态机定：草稿 →「去校验」，待批准 →「批准并启动」，运行中 →「看运行记录」，评估中 →「去人工评估」，已完成 →「看结果」，被拒 →「重新检查」。改的理由是规格缺口而不是执行缺口——§五 v1 只定了每页装什么，没定人在每页做什么，于是七页长成了七堆标签正确的字段（概览与计划审阅几乎同一份定义列表，两页都没有动作）。本轮**批准并启动**也挪到了这条 bar 上：它是人的动作（R1），该在人站的地方按，而不是翻到某个子页去找。批准之后页面**留在实验设计**——就绪检查拒绝只写在下面那段运行日志里，把人带去空网格等于把他要找的原因留在身后；状态一转，bar 自己变成「看运行记录」。
- **实验设计**（T67，吃掉原概览 + 计划审阅 + 条件三页）：① **实验规模与对比变量**——「4 题 × 2 组 × 2 次」、对比变量（人话，键名只在悬停）、题库版本、判官与采样数，四行。② **对比组与就绪**——**就绪徽章**（全过一枚「✓ 环境就绪」，否则一个红叉一行 +「重新检查」，就绪原文折进详情）、validate 里**需要读的那几条**（通过的折起来：一条干净的检查不是新闻）、对比组表（只列**本实验**用到的那几个，仓库里其余声明不是这一页的事；判官那行挂一枚「判官」chip），以及**计划网格**——行是题、列是对比组、格内「计划 n 次」。网格是**同一个组件**，跑前跑中两用：v1 在这里什么都没有，实验的形状要等 run 起来才变成一张图，而那时已经晚了。③ **高级设置**（默认折叠）——顺序种子、阶段、每格预算、判定来源、重试、题目清单、导出目录、环境、计划文件路径、就绪原文、job 日志、run.meta 原文，以及**作者备注**（保留换行；它在 v1 是糊在页上的一整段）。
- **新建实验是四步向导**（T67，界面规格 §五 v2）：① 题库与题目 ② 对比组（选已有的，或从一个已有的复制改点名字段）③ 判官、次数、阶段与每格预算 ④ 环境与确认（都有缺省）。原来是一张一次问二十个问题的裸表，没有顺序、也不知道还剩多少；而前两步决定了后面几步**能提供什么**。每一步都能回退，回退不丢答案（答案存在步骤之外），最后一步的动作才是「保存草稿并 validate」——**启动不在向导上**（R1）。向导只是收集的方式：同一个 `draftExperiment` 动词在最后收到同一份文档，所以人填的计划和 agent 一句话起草的计划仍是同一个列表里的同一份文件。
- **计划文件不在了**走错误态三段式（原来直接把 `cannot read plan file: /Users/…` 渲染在页上）；**计划点名、仓库里没有的对比组**在表里有一行「缺失」而不是被静默省略，就绪徽章按**计划自己的受试对象清单**计数，所以一个谁都不认识的对比组不会从分母里消失、把徽章留成「✓ 环境就绪」。每个红叉行尾带一句人话的原因，是从 review 的**结构**读的（status / 有没有锁 / 锁还配不配 / 家目录有没有哈希过），只有「端点未解析」没有结构字段可读，才按 validate 自己写的 `condition <id>: ` 前缀从检查列表里取——没有一处是去解析句子的**含义**。
- **题库版本那一行**写 `<登记 id>/<题集> @ 短哈希`（T73），列表的题库版本列同样写法；页面上没有「未绑定」、没有路径。T73 之前这里有一个「绑定题库」按钮和一段去题集 tab 绑定的说明，随绑定一起删了：实验自带版本钉，没有什么要绑。
- **运行记录**（T67，吃掉原矩阵 + 格子两页）：顶上是**同一个网格**，这回由账本填——每格 rep 圆点、运行状态、**判定**（有就显示）、告警；下面一行一条运行记录：题 × 对比组 × 次 · 运行状态 · 得分 · 耗时 · 尝试次数。筛选是 §五 v2 的五档（全部 / 运行中 / 完成 / 失败 / 阻塞），**在浏览器里筛**、一个 run 只读一次：「失败」根本不是桶（`halted` 被 mission 投进 `done`，它确实结束了），服务端按桶筛只能答三档，另外两档照样得把整份拿回来，而 chip 旁边的计数就会开始数两拨人。网格的判定也是从这份列表载荷里 join 出来的（按 missionId），不用给投影加字段。
- **走查一轮收完的呈现层**（T67 补，2026-09-18）：chip 的五色**真的落到了 tokens**——`ok` 原来取的是品牌蓝、`busy` 取的是正文色，于是「已完成」蓝、「运行中」灰；现在 `ok` → `state-success-primary`、`busy` → `state-business-primary`，题集 tab 那份手抄的副本同改，`tests/tones.spec.ts` 读样式表把这条钉住（chip 的颜色是样式表里的 token，jsdom 两样都不算，客户端用例抓不到）。运行记录的「在态时长」对**终态**显示「—」：账本是从最后一次转移量到**现在**，终态下那只是「这次 run 多久以前结束的」。阶段时间轴每行的灰条原来是 chip 被 grid 拉满格拉出来的，现在是**按时长在本条记录内归一**的真比例条，没量到时长的段不画条。人工评估的并排两列不再被裁（判据表并进每列之后，第三列的模板还留着，把作答区挤成 509 px）；每列的产物**默认折叠**，判据表置顶——几千行 stage json 压在上面时，两列永远不会同时露出打分框。
- **得分这一列目前只显示判定的来源**（终评 / 判官初判 / 脚本判定 / 未判），不是数值。格子投影里没有分数，而分数是 `report.ts` 从**导出的 bundle** 算的——判据的正负极性来自 rubric、**逐条判据**取最权威的那一层、同判据多样本按多数计、带权重时再算一遍加权。照着活账本再算一份，等于让运行记录和结果对比对同一格给出两个数；宁可不给数，也不给第二套算法。数值（连同它每条判据取到了哪一层）在结果对比页。
- **条件页并进实验设计之后**（T36、T58 的能力一个没丢）：每行的**「provision」**按一次就把声明落成实物、写回 `home.sha`、写 lock，回执是同一组件的 `ok / warn / error` 清单；**endpoint 单元格点开就地改**，空值即「未解析」，改完回执点名旁边的 lock 已过期、请再 provision 一次。点两行出 diff，**只列不同的字段**。原来的「新建条件」占位没了——**选模型即新建对比组**，所以单对比组实验的网格上方直接给「添加对比组」，按下去开的是新建实验向导（同一个 `draftExperiment` 写面，一次写出对比组和用它的计划）。
- **批准之后看什么**：`runCreate` 之前账本里没有这个 run，而就绪检查拒绝**恰好发生在那之前**——被拒的 run 在账本里一行都不会有。所以批准返回的 job 与 run id 会留在页面上，并按 job id 拉一次 `runOutput`，把**运行日志原样**贴出来：`readiness <条件>: NOT READY — <原因>` 就写在那里，别处没有。这一块现在只在实验设计页上，批准之后人也留在那里。
- **没有状态根的实例**（没设 `DSH_HOME`）：列表只列 run、附一句说明；进实验的动作走错误态「这台实例没有评测状态目录」，修法是用设置了 `DSH_HOME` 的方式启动。
- **错误态三段式**（界面规格 §九）：所有子页的失败位共用一个 `ErrorState`——第一行一句人话（登记的题库路径不是 git 仓库 / 不是题库 / 路径不存在 / 没有状态目录 / 服务不在），第二行怎么修，异常原文与路径折在「详情」里；页面上不再出现 `error.message` 与绝对路径。原因是从消息文本认出来的（域内错误码过不了 Remote 线），所以 `tests/error-state.client.spec.tsx` 拿真实服务抛出的真实句子喂真实分类器——宿主改措辞，测试先红。题集 tab 用的是同一份实现的副本（客户端包不 import 兄弟插件，界面规格 §八）。一格被拒的**就绪原文**与运行日志不在此列：它们是证据，照旧原样贴出。
- **前端零兄弟包依赖**：mission 与 datasets 的投影都在服务端算好再下发，浏览器只读 eval 自己的 Remote（界面规格 R2 与 §八）。Remote 上的浏览器动词带会话参数，只为「本会话发起的」这个默认筛选与批准时的父会话；T73 起会话不再决定能看见哪个题库——实验与条件库是部署的。写的是 `approve`、`draftExperiment`、`importExperiments`、条件页的 provision 与改端点，以及三个收尾动作。CI 的四个动词 `runStart` / `runStatus` / `runOutput` / `runCancel` 一个字没动，它们不带 agent 正是因为 CI 没有；`runOutput` 现在也是浏览器读运行日志的那一个，同一个动词，没有第二份实现。**没有 approve 类模型工具，也不会有**（界面规格 R1）：启动动词只给界面。

## 网格、运行记录与记录详情（I5·T35b、T67）

实验室详情的第四、第五个子页，与 T35a 的壳同一套注册、同一份 Remote。

- **矩阵页**：行永远是题——比较是「同一个问题问不同的受试对象」，让人把题放到列上，就等于把两个不同的问题摆成一行读差值。列是人选的那一个因子，其余因子「分组」成带，或用筛选钉成一个值；两样都不选的因子**随格同行**，那一格的条件列表于是列出不止一个 id，看得见而不是被藏起来。格内固定四样：rep 圆点、阶段、卡格告警、题面哈希是否与同题其余格一致（不一致的那一格描红边；读不到哈希是「未知」，不是「不一致」）。底部一行 run 级汇总：物化哈希、环境指纹（都用报告的四条不变量的词）、未释放单元数、判官一致性（报告没出就写「待报告」，绝不自己算）、卡格数。
- **运行记录列表与详情**（T35b 起，T67 重做详情）：列表是原 missions 队列按本 run 过滤，右侧是**一条运行记录的详情**。详情按 §五 v2 的顺序答三个问题：**头部**——这格带的判定（来源，不是数值）与「成功 / 异常」（`halted` 是唯一说「停了」的状态）；**阶段时间轴**——每段多久，由账本自己的 transition 时间算，进入某态的那次转移是它的起点、离开的那次是它的终点，最后一个态没有终点所以没有时长（跑到「现在」会让页面每次渲染都报一个账本没记过的数），中间少记一次转移就两边都断开而不是跨着空洞量；**参数配置键值表**——题 / 对比组 / 次 / 尝试次数 / 判定来源 / 题面物化 / 环境指纹 / 单元，加上账本给这格打的其余 label，不摊 JSON；**附件区**——产物按人话命名（题面物化 / 归档工作区 / 判定记录 / 阶段提交 / 评测日志），路径放悬停，**每一行就是打开它的那个控件**（I5·T69）：点开就地读全文（`<pre>` 原样，不按 markdown 渲染——`stage1.md` 在这页是证据不是文档，渲染器会把没闭合的围栏悄悄吞掉，而那在这页是发现），再点一下收起；目录（归档、判定记录）列出条目，条目点进去还是同一扇门；拒掉的二进制说清是什么、多大。一次只展开一件，换一条记录就收起——另一条记录的产出不该留在这条的页眉底下。收据（历次尝试、检查点、注解 ns）折起来，verify 输出照旧原样。三枚动作不变：**带原因重跑**（原因必填、类别取 mission 自己的 infrastructure / operator / outcome）、**释放检查**、**导出 bundle**；另有「打开子会话」，把选手那次委派的会话交给宿主的子对话视图**读**——成员 composer 与 dock 是 local-agent 的；这一格没记子会话时按钮禁用并说明原因。**判官各轮同样有一颗**（I5·T69）：判官也是一次委派，它的转录与选手的是同一种东西，只是这页一直没有门，于是「为什么判成这样」只能从判定那一行 evidence 里猜；没起成会话的那一轮保留成一行，按钮禁用、错误原文写在旁边——「这轮判官没跑起来」是个答案，删掉这行会让人以为判官根本没判。

  这页**不自己渲染转录**。容器轮的选手是单元里的 sub-dsh，它的会话由 local-agent-dsh 的 session-mirror 逐轮并进**宿主侧的子会话**（`persistChildSession` 落盘），所以它从一开始就是宿主会话——`session/list` 里就有（`origin: subagent`），宿主的子对话视图按 subagent 地址开得出全部消息与工具调用。要拷会话目录、或另画一条时间线，都是在解一个不存在的问题。

  **地址要带父会话**（I5·T69 真机验收翻出来的）：`sessions.open(childSessionId)` 会选中那一行然后历史加载失败——*subagent Sessions require their durable parent address (session/agent-busy)*——这颗按钮自上线起在两条路上都是这个结果。格子详情因此带上 run 的 `originSession`（决策 1：run 的父会话就是它每次委派的父），客户端先刷该父的 catalog 再交 `{parentSessionId, childSessionId, mode: 'one-shot'}` 给宿主；没记父、刷新被拒、catalog 不认这个孩子，一律回落到按 id 选中。
- **verify 原样输出**：这条线上**没有 `lab` 注解命名空间**。探针（容器轮经 `lab.verify`、宿主轮直跑）由编排器记成 `kind: 'probes'` 的 orchestrator 注解，抽屉展示的就是它，整段原样——退出码与「本轮不适用」的原因正是人打开这个抽屉要看的东西，摘要会把它们摘掉。把它说成「lab 的」会指认一个不存在的来源。
- **导出闸不在 eval 这边**：`exportPlan` / `exportRun` 转发给 mission 自己的 Remote，guarded 层的判定与「每一层都确认过才写」的 fail-closed 复核都留在那里。对话框的职责只是让人逐项**有意识地**勾；改了任何一个字段就作废已勾的确认，因为那些确认属于当时看到的那一套层。
- **前端仍然零兄弟包**：读与写都走 eval 自己的 Remote（`matrix` / `cells` / `cell` / `cellArtifact` / `retry` / `releaseCheck` / `exportPlan` / `exportRun`，都带会话参数），浏览器半边一次都没有提到 mission。

## 结果对比页（I5·T38、T67）

四个阶段的第三个，八步流程的第 7 步（finalize · 判官 · 报告）在界面上的落点。

- **它读 bundle，不读账本**：报告是**导出**的投影。所以这一页先找 bundle——你刚在导出对话框里敲的目录、**run 自己的导出注解记下的目录**（T60）、plan 自己的 `exports`、`<题库仓库>/exports`，依次试 `<runId>-bundle`——找不到就显示「还没有 bundle」加**找过哪些目录**，并给一颗导出按钮和一个「换个目录找」的输入框（带 `--out` 跑的 run，`run.meta` 对导出去了哪里只字未记，没有这个框就只能再导一次）。「还没导出」和「没有报告」是两件不同的事，把前者显示成后者会让人去查一个并没有坏的 run。导完再看，页面按刚写的那个目录重读（对话框收的是自由文本路径，不记住它就会对着刚导好的 bundle 说「未导出」）。
- **比较闸在服务端合上，前端打不开**：前四条不变量任一不成立或无法核验时，配对数据**根本不过线**——`pairs` 是空的，页面想渲染也没有东西可渲染，只有界面规格要的那一行「比较节未开：<哪几条没过>」。一个「允许比较」的布尔值加一份照发的数据，等于把这条口径交给前端去记得检查。
- **五条校验五行**：`ok / violated / unverifiable` 三态各说各的词（不是合成通过/不通过），每条把 `details` 原样列在下面——没有事实垫着的状态词只是一个意见。
- **配对差值表**：一行一道题——两侧得分、Δ、逐 rep Δ、n，以及**这一行由谁判**。判官条件与模型是从该题两侧格子的判官归属里取的；其中任一格是自评（判官模型 = 该格选手模型），整行标**自评**——决策 9 放宽后判官可以是选手，报告的做法是逐格披露而不是排除，而一个只标在部分格上的提醒等于没提醒。rubric 带权重时多两列加权差；置信区间与**名次判定原文**（包括「n = 2 < 3，不排名」这种拒绝排名的原文）照抄报告。
- **判据 × 对比组表**（T54 补一，2026-09-18）：配对表只答「哪边赢」，答不了「赢在哪个维度、凭什么」——用户看完结果页的原话是「看不出来每个维度的得分对比和评委的评判依据」。数据一直都在（`results.jsonl` 每行就是一条判定），缺的是投影：现在每题一张表，行是判据（id、维度 = rubric 的 axis、权重、极性），列是对比组，格里是该判据在该组的结论（`✓` / `✗`，负向判据成立即缺陷、用 ✗ 的颜色；按比例给分的写比例；多 rep 写成立次数），格下小字是这格的**得分来源**——`人 1 / 判官 3` 这样的混合，正是逐判据合并之后每条判据取到了哪一层。**点开一格**是逐条判定的原文：证据（默认折成一行）、判官条件名与模型（报告页揭盲）、多样本逐条列出；人改判过的那条标「人已改判」，**判官原判仍留在下面**。底行是本题总分，取的是 `scoreOf` 自己的数而不是本表的列和——同一份计算，两处不会打架。**比较闸照旧**：不变量没全过时这一节与 `pairs` 一样根本不下发；**单对比组的 run 也给这张表**（一列），判官依据不依赖比较。`summary.md` 里是同一张表，证据原文折在 `<details>` 里。每格去运行记录走的是**与配对表同一条路**（T69）：格里带着每条判定的 `missionId`，只有一条记录就直接打开那条，多条就落到运行记录列表并挂上那枚筛选 chip——不另写第三种跳转。
- **效率表并列**：活跃时长、委派轮次、工具调用、输出 / 输入 / cacheRead token，一行一个条件，不合成分数。**「—」不是 0**：没有任何一轮报过工具调用计数就打破折号，「没人报过」不是「一次没用」。表下两句：多于一个模型时提醒 token 跨模型不适用（冻结决策 10），以及被效率口径排除的未完成格子（T23）。
- **判官一致性**：同判官重采样（多样本判据数、一致率、Cohen κ）与跨判官（多判官判据数、全体一致率、κ）分两行——把两位判官的分歧算成某一位的噪声是两件事混成一件。κ 在退化情形是 NaN，过线时转成 `null`：JSON 里没有 NaN，与其让它变成一个悄悄的 null，不如在能写下理由的地方转。
- **两个动作**：**finalize** 走 `finalize` 动词，把本 run 每个 `archived` 的格子过一遍释放闸；它在一张只读页上做整 run 的写，所以**先问一次**再走，结果按格显示——闸拒了哪一格、原话是什么、每个容器的下场，加上那次走的日志原文。**导出**复用运行记录那个对话框（闸仍在 mission 侧）。
- **T67 给这一页加了两样**。四条有效性校验各带一句**悬停解释「为什么这条影响比较」**：那句话按不变量 id 是常量，所以它是**文案**、进词典（宿主端一个中文字符串给不了英文），而旁边逐条的 `details` 是这次 run 自己的事实、照旧从 bundle 来。效率表下面加一组**柱状图**：活跃时长 / 输出 token / cache read 三组，每组**在自己这一项里**按最大值归一——三项没有公度，一把共用的尺子就是给谎话配一张图；数字仍在柱子旁边（柱子给的是一眼看出的比例，数字才是事实）；不引第三方库，就是 CSS，用宿主的 tokens；某一项谁都没量到就写一句话，不画两条空轨道。
- **T71 把结论校准到数据撑得住的程度**（提案 D7）。校验从四条变成**五条**：第五条「判定覆盖一致」逐对核——同题同次的两格，每条判据要么两侧都有判官 / 人的判定（human-final 或 llm-draft），要么都没有；一侧只剩脚本判定或什么都没有就不成立（pilot-d 的 dsh-full 格判官两次调用都失败，另一侧有判官初判，两侧按不同来源相减得出「Δ = 4」）。它和前四条的作用域不同：前四条是整个 run 的前提，任一不过仍整节不开；第五条是**这一对**的属性，不过只把这一对降为描述——逐题得分与逐次差值留着，区间与名次去掉，`rankReason` 写「判定覆盖不一致：<题> 的 <判据…> 在 <组> 没有判官 / 人的判定（判官缺席 / 仅脚本）」；`comparisonAllowed` 与判据表的闸仍只看前四条。「判官缺席」读的是 bundle 里本来就有的 `judge-parse-failed` 注解，失败原因原样进明细。人只改了一条判据不触发——人的判定本来就算「已判」。**置信区间按题数给**：有差值的题 k < 3 时不给区间（`ciWithheld: {tasksWithDelta}`，页面与 summary 写「只有 k 道题有差值，给不出区间」）；k ≥ 3 照算，但 n < 3 时标 `ciAdvisory`、页面写「仅供参考，未达排名条件（每题需跑满 3 次）」。排名门槛不变：n ≥ 3 且区间不含 0。
- **一次导出写两样东西**（I5·T60 · G15）：mission 写 bundle，eval 随即把 `report/summary.md`（连同 `results.jsonl` / `usage.jsonl`）写进这个 bundle，用的就是 `dsh-eval report` 调的那个函数——回执点名落了哪几个文件。此前页面导完还剩一条命令行要人去终端跑，于是一次**每个面都在屏幕上**的走查还是以敲命令收尾。run 自己结束时的那次自动导出同样一并写报告。CLI 动词保留：任何来路的 bundle 都还能补一份报告。报告渲染失败不撤销导出——回执说清楚并把命令打出来。
- **bundle 去哪了，记在 run 上**（I5·T60 · T53）：每次导出都往 run 记一条注解（`orchestrator` ns，写在本 run 第一格上，读的时候扫全部格子取最新），里面是导出目录、bundle 目录、时刻、收录的层与快照引用。带 `--out` 跑的 run 从此不再「不知所踪」——报告页优先按注解找，「换个目录找」那个输入框退化成兜底而不是唯一出路。
- **bundle 早于终评就说出来**（I5·T60 · G17）：页面显示 bundle 自己 `manifest.json` 里的 `exportedAt`，与本 run 最后一条 `human-final` 比；早了就是一句人话加一颗**重新导出**——终评是在 bundle 写完之后才落的账，它进不去那份已经写好的目录，而下游每个数字都是从 bundle 读的。重新导出**重复**上次记下来的那次导出（同一批层、同一个快照引用），进 `<原目录>/re-<时间戳>/` 这个**新目录**，报告一并写，旧目录一个字节不动。它只重复不放宽：guarded 层一个都不重新确认，mission 仍按一份新鲜的 plan 复核，某一层若已变成 guarded 就整体拒绝，人回对话框有意识地勾。判官台上同一句话、同一颗按钮——写终评的那一页正是该说这件事的地方。
- **未回收单元**（T57 · G18）：页顶数出本 run 还没放掉的容器，数据来自 `runUnits`——lab 自己的名单，不是账本的判断。大于零就给一个**回收**，它调的还是 `finalize`，而不是第二条路：回收一个容器**就是**它那格过闸，一个绕开账本的动词正是这条缝拒绝的 force。下面那节逐个列容器与它那格的状态，因为正是这个状态决定「回收」还收不收得动（`archived`）、还是只剩 `--force`（`released`）。没挂 lab 的实例显示**未知**，绝不显示 `0`：一个从没去看过的东西给出笃定的零，正是持有的容器藏起来的方式。

## 人工评估（I5·T37、T67）

四个阶段的第四个，八步流程的**第 8 步**（终评与分析初稿）在界面上的落点，也是 `human-final` 这个 ns 在整个家族里**唯一的写入口**（界面规格 R1：批准、登录、终评永远是人的动作）。

- **队列按题，同题各份作答并排**（T67，界面规格 §五 v2）：左边一行一道题，写着它有几份作答、评掉了几份；点进去，那道题的各份作答**并排铺开**，每一份自己一列——去指纹、按 run 自己的种子顺序编号、各带一份完整的判据表与自己的按钮。理由是标准：一个人连着读同一道题的四份答卷会对四份用同一把尺，一页一页翻着读则第一份和最后一份之间尺子会走形。**这不是二选一**——判定契约一个字没改，每格仍是一份分数、按它自己的判据写；并排改变的是判官**看得见**什么，不是账本收到什么。为此在途的答案改成按 ticket 存（几份同时在写，一份提交只清它自己那一列），证据输入框的 aria-label 也带上作答编号（并排四个「证据 H1」，读屏软件分不出来）。

- **盲是载荷的属性，不是页面的自律**：`judgeQueue` 送下来的东西里没有条件 id、没有 harness、没有模型——**也没有 missionId**。编排器给格子起的名字是 `<题>-<条件 id>-rep<N>`，而条件 id 十有八九带着 harness 的名字，把它发给浏览器等于把受试对象写进 DOM。所以每个格子以**序号 + 不透明 ticket** 出现（ticket = `sha256(runId\0missionId)` 前 16 位，写入时在服务端反解回格子），判官面板显示**判官 A / 判官 B**（按 run 自己的判官排序，稳定但不具名）。序号按 run 自己那份（按 seed 洗过的）顺序排，这本身也是盲的一部分：相邻的号码不透露哪两格共用一个条件。**揭盲在报告页**——判定落定之后再揭盲，改不了判定。
- **去指纹只有一份实现**：中栏的产物用的就是 run 循环喂给 LLM 判官的那个 `deidentify`，规则也由同一份 `run.meta.conditions`（各条件的 `model.declared` 与 `harness.name`）重建。自己再写一个洗法，就是给同一条红线开第二个可能出错的地方，而且第一次往别名表里加一个 harness 时两边就会分叉。原文从**归档**里读（`archive/workspace/`，宿主路径的目录拷贝与容器路径的 `lab.archive` 都写这里），所以格子的临时目录清掉之后判官台照常能用。每份文件标明**替换掉几处指纹**——这是判官唯一能看出洗法确实跑过的数字。
- **右栏三件事并排**：rubric 里 `kind: human` 的判据（`objective` 归探针、`llm-draft` 归判官，都不在这里问——出题人标成 `human` 的那条，就是他判断不该由模型定的那条）、该判据**各判官各样本**的 llm-draft 值与证据（自评样本带「自评」标）、以及人自己的输入。判据的**极性来自 rubric**：`pass` 恒为「判据成立」，负向判据成立即缺陷存在，所以行首把「负向」「一票否决」「权重」直接标出来——这是防止判官把答案答反的唯一办法。
- **一层给一条判据算分，不是给一格算分**（I5·T54，2026-09-18 用户定）：报告**逐条判据**取最权威的那一层（`primaryPass`，`human-final` > `llm-draft` > `script`）——人改过的判据用人的，没改的仍用判官的，没判官的用脚本的，同一格的得分来源可以混合，但报告必须标出来。**旧口径按格整体取**，于是一格上第一条 human-final——哪怕只答了一条 `kind: human` 判据——就让其余只有 llm-draft 判定的判据全部出局（T37 实测：判官打了 4 条，人改了 1 条，得分只剩 1 条，另外 3 条静默消失；合成 bundle 上配对均值从 4 掉到 1）。一条代价在支付的当下看不见的规则是错的规则；改判据合并之后，判官台按钮前那句话也从「会让其它判据出局」改成「只覆盖你打的这条，其余仍用判官的」，并照旧点名是哪几条（`draftOnlyCriteria`）——它们不再是代价，而是这条记录的得分从此有两个作者。**历史报告重算后数字会变**：不迁移旧 bundle，重新导出即按新口径。
- **只追加，不改写**：`humanFinal` 转发 mission 的 `annotate(ns: human-final)`，别的什么都不做。同一格再评一次是**追加**一条注解，报告按每条判据的最新值读数，先前那条仍留在账本里——所以页面对已评的格子明说「再记一次是追加」。一模一样的重复提交被 mission 判为空操作，页面照实说「这次没有写入」，不谎称写了。
- **`by` 是会话**：注解的 `by` 记 `tab:<sessionId>`，与格子抽屉的 retry、报告页的 finalize 同一套口径；verdict 文档自己的 `by` 记 `judge-bench`（协议给这个来源的词）。报告顶部那条红字警告盯的是 `tool:` 前缀——从这里写出去的终评**不可能**触发它，因为这条路上根本没有模型。
- **每条判定都要证据**：`dataseek.verdict/1` 的 `evidence` 是「可核对的事实，不是观感」，空白的会被服务端拒绝，页面也在按钮上先拦一道——判官当时的依据一旦丢了，这条判定就永远无法复核了。没答的判据**不发**：没碰过的判据不是一条「不成立」。
- **顶部一致性用账本实时算**：同判官 κ、跨判官、llm-draft 对 human-final，走的是报告页那同一个 `judgeConsistencyOf`（这次为它加了一个结构化的入参，不是抄一份）。区别只在数据源：报告读 bundle，判官台读**活账本**——判官刚打的那一条必须立刻反映在他自己看得见的数字上，而不是等一次重新导出。
- **没有模型工具，将来也不会有**：`@khorsheed/dsh-eval-tool` 不注册 `humanFinal` 的任何孪生动词。R1 的「终评是人的」在这里成立，靠的是工具面**根本没有通往这段代码的路**，不是靠一个检查把模型挡回去。

## 四个阶段的旅程与结论先行（I5·T72）

T67 把详情收成四个阶段，每页一条「状态 + 一个主动作」；T72 把同一个思路推到列表、就绪、收尾与结果页，让人在每一处都只需要回答「现在该我做什么」。

- **列表按「该谁动」分组**：**需要你处理**（草稿、待批准、停滞、被拒、评估中——判官做完了、轮到人）、**运行中**、**已完成**（含评估不成立、已取消）、**已归档**（折叠，只在最后）。列是名称、题库版本、对比组数（+判官）、题数、次数、对比变量、状态、进度、开始时间，外加一列行内动作：停滞行的**重跑**、有 run 的行的**归档 / 取消归档**。交互稿 v5 把停滞放在运行中组里；这里放进需要你处理，因为停滞的 run 没有任何东西在推它，不去管它就永远停在那里。
- **默认只看本会话发起的**：run 的 `originSession` 等于当前会话的算本会话，草稿（还没有 run）一律算。组头写「另有 n 个不属于本会话」，点一下切到「全部」；这个开关存在 `localStorage`（读写都包在 try/catch 里，隐私窗口里读不到就回到默认），它只是每个浏览器自己的偏好。
- **重跑就是再批准一次**：停滞的 run 没有「从断点续」的动词（续跑要知道每格停在哪一步、单元还在不在，那是编排器的事，不是这一页的），所以重跑按同一份 plan 起一个**新 run**，旧的那行留着，回执建议把它归档。
- **归档只改分组**：ns `eval-archive`，与导出注解同一个写法（写在本 run 第一格，读时扫全部格子取最新），状态规则一眼都不看它。
- **就绪清单**：待批准页的就绪分**阻塞项**与**提醒**两组，每行一句人话（词典 `readiness.<CODE>`，中英各一份，原始 code 与原文在悬停），行尾是修法：**provision** / **改端点** / **让 agent 处理**（T73 前还有一个「登记仓库」，开绑定说明；绑定删了，它也删了）。阻塞项是 validate 的 error，加上「受试对象没就绪」的 warning；其余 warning 是提醒。状态 bar 的主动作就是**第一条阻塞项的修法**，全绿才是「批准并启动」。
- **让 agent 处理只填不发**：它把「实验 <名> 的就绪清单第 k 条：<原文>」写进**本会话输入框的草稿**（宿主的会话输入面 `ctx.sessions.scope(sid).get('conversation').input.for(scope).setDraft`），不发送——发不发、要不要改一句，是人的事。输入面拿不到时退到剪贴板，并说「已复制，粘到输入框」。
- **人工评估的四个出口**，写在 ns `eval-closure`：① **提交终评**；② **带标记提交**（必须写理由，比如「判官缺席、这对不该比」）；③ **不做终评直接收尾**（只用判官初判）；④ **放弃终评**（必须写理由，run 从此是「评估不成立」）。最新的一条生效；④ 之后再写任何出口都被拒——作废说的是「这次评估站不住」，之后一条「终评」悄悄把撤回的结果变回来是这条缝要挡的。队列里点名**判官缺席**的格子（判官调用全部失败、只剩脚本判定），给一个可选的**补判**：它走「让 agent 处理」，因为重新判是一次委派，而委派的发起人该是一个会话。
- **结果页结论先行**：顺序是**结论卡 → 判据表 → 效率 → 审计（默认折叠）**。结论卡第一行说来源：终评或带标记 →「来源：判官初判 + 人终评」（带标记的把理由放在最上面）；没收尾或选了 ③ →「判官初判，未经人工确认」。第二行是**有效性校验 5/5 ✓ / 4/5 ⚠**，点开就是审计节。④ 之后整页只剩「评估不成立：<理由>」和一个去运行记录的链接——一份被作废的结果没有「但是数字还是可以看看」这一说。
- **`eval_run_status` 说同一套词**：工具回的 `status` / `stalledMinutes` / `closure` / `archived` 与列表这一行取自同一个 `experimentDetail`，agent 告诉人「这个 run 停滞了」时，用的就是人在页面上看到的那个词。
- **所有字都在词典里**：状态词、按钮、就绪句、收尾回执、组名，中英两份；服务端只下发结构字段（code、condition、exit、分钟数），不下发句子。颜色只用宿主 tokens。

## 会话面：工具行上的实验卡（I5·T76 · D3）

agent 在会话里起草了一个实验之后，这件事在会话里只剩一行通用的工具调用：工具名、一段 JSON、两条绝对路径。人要知道「起草了什么、现在怎样、去哪儿看」，得自己切到实验室 tab 找。

- **`eval_plan_draft` 的工具行挂宿主的 `tool.call.toolview`**（键 `eval_plan_draft`），渲染成一张实验卡：实验名、人的问题原文（protocol v1-rev14 的 `question`，有才出现）、规模（题 × 组 × 次 = 格）、题库版本（`<登记>/<题集> @ 短哈希`）、状态。卡片读的是**这次调用自己的块**——参数与 `EvalDraftResult`——所以几天前的调用照样指向它建的那个实验；只有状态是活的（挂载时读一次实验室列表的那一行）。结果里的 `planPath` / `conditionPaths` 不进卡片的模型，页面上无从出现。
- **一个动作「打开实验」，没有批准按钮**（界面规格 R1）：启动花算力，是人在设计页、就绪清单旁边做的决定。宿主没有让插件切换会话标签的接口（`dsh.conversation` 的 `openView` 只注入给会话框架与标签头），所以动作退一步：在实验室 tab 的列表里**标出这一行**（回到列表、行不在本会话范围就切到「全部」但不写偏好、滚到可见、一圈主色细框），卡片下说一句「切到那个标签就能看到」。实验室 tab 没挂载时请求留着，下次挂载时取走。
- **不依赖 `@deepseek-ai/dsh-client-ui-tool`**：slot 由它声明，本包只按结构注册（`slots.inject` 等 slot 声明了再注册）；没有这个包的组合里工具行照旧是宿主的通用行。卡片不跟 preset 自隐——能出现这一行，本身就说明这个会话被授予了 `eval_plan_draft`。
- **标签上不显示计数**：想过在「实验室」标签上显示「进行中 n」，但宿主只在订阅 slot 或切语言时重读标签（ui-conversation 的 `refreshViews`），标签不会随状态重绘；用 DOM 锚点去改字违反约定。所以不显示。
- **进度不回流会话**（S18 退路）：没有芯片、没有通知，agent 要知道进度就读 `eval_run_status` / `eval_experiment_get`。rc.1 上看过的候选都不合适，记在 Agent Note 里，没有接线。

## 视觉与文案收口（I5·T63）

六个子页原本各长各的样子：矩阵页把条件文档里**所有**不同的键当成平等的因子摊开（`unit.scopedHome.var`、64 位的 `home.sha` 都在筛选行里），列头是 `["DEEPSEEK_API_KEY","DSH_HOME"]` 这种数组，格内阶段写着 `mixed (archived / ws-ready)`，报告页把英文异常与绝对路径直接打在页上。界面规格 §九 把硬规则写死，这一轮按它把两个 tab 从头到尾过了一遍。**功能与数据面没动**：服务端的投影、pivot、报告计算一个字节没改（只有两处哈希宽度 16 → 12），改的全是呈现与文案。

- **一张状态词表**（`src/client/vocab.ts`）：账本阶段（待起 / 工作区就绪 / 阶段一…／已判 / 已停 / 已归档 / 可释放 / 已释放）、mission 的五个桶（就绪 / 排期 / 阻塞 / 进行中 / 完成）、重跑类别、条件文档的每个叶子字段，都在这里落成一个词典键，中英各一套。查表是**全函数**：没见过的标识照样有词，原标识留在 `title` 上给要 grep 账本的人。阶段名是按 manifest 位置生成的（`stage-<n>`），所以它不是闭合枚举——前六个有专门的词，再往后走参数化的那条键，而不是现编一个数字。
- **「多态」不再靠解析宿主的句子**：`mixed (archived / ws-ready)` 是英文标识拼英文标点，页面若把它拆回来翻译，宿主一改措辞就碎。格内阶段改为从 `cell.reps[].state` 自己算。
- **矩阵的列头永远是条件 id**，因子值作副标题（界面规格 §九）。pivot 没改——一列本来就是一个因子值，`column.conditions` 早就说了它带哪些条件，只是标题与副标题换了边。
- **设计因子与随动字段分开**。`conditionFactors` 诚实地报告每一个不同的键，于是一个只换模型的 run 也会「不同」在 `home.sha`、`env.keys`、`unit.scopedHome.var` 上——这几个是**被另一个因子决定的**（harness 决定凭据变量名，家目录落地才有指纹），人没法把它们钉住来做对照。所以只有 §九 点名的那几个字段能做列 / 分组 / 筛选，其余在矩阵底部折叠成一行报告出来，不做成控件。默认的列也由这一侧选：pivot 不给 `column` 时取**字典序**第一个差异键，这正是 `env.keys` 当上列头的原因；浏览器半边知道哪个是设计因子，于是第一次答案回来时纠正一次（`matrixColumn` 随即非 null，这个分支跑不了第二次）。
- **单因子的矩阵页没有筛选行**，多因子时「换列 · 分组 · 筛选」收在一个默认折叠的 disclosure 里：矩阵才是这一页要给的东西。
- **同一套组件**：状态 chip、空态、区块、圆点图例、表格、抽屉在两个 tab 里是同一份写法（`Chip` / `EmptyState` / `Section` / `Detail`，题集 tab 有逐字相同的副本——客户端包不 import 兄弟插件，§八）。chip 的底色是 `currentColor` 的 12%，跟着 tone 走，所以明暗两套只有宿主 tokens 一处真相。
- **空态说下一步**：还没导出就是一句话加一枚「现在导出」，不是一段英文；工具条上的按钮照旧常驻，空态里那枚用自己的措辞（「新建第一个实验」），两者不会读成同一枚按钮被复制了一遍。
- **页面上不出现绝对路径、JSON 与完整哈希**：计划文件、bundle 目录、题库根都只露最后一段，整条路径在 `title` 与「详情」里；`run.meta` 与就绪记录原文折进「详情」（它们是证据，所以留着，只是不占版面）；哈希统一缩到 12 位。
- **宿主写的句子仍然原样保留**，只是折起来：就绪闸的拒绝原文、finalize 的走查日志与逐格拒绝原因、report 找 bundle 时的说明——这些是唯一记着「为什么」的地方（被拒的 run 在账本里一行都没有），摘要掉就没了。
- **已知缺口（数据面，本轮只记不改）**：`pivotMatrix` 的汇总句、`report` 的四条不变量明细与 `rankReason` 都是**宿主端拼好的中文**，英文界面下会中英混排。要修就得让它们下发结构化字段、由浏览器半边组句——那是数据面的改动，按文案要求记下来不顺手扩。

### 术语表 v2 与数字格式（I5·T63 补二）

用户走查之后，界面规格 §九 加了三条（术语表 / 色彩语义 / 数字与句子），这一轮按它把两个 tab 的**文案、颜色、格式**过了一遍——结构一律不动，那些归 T67。

- **术语表 v2**：条件 → 对比组、因子 → 对比变量、格子 → 运行记录、快照 → 题库版本、矩阵形状 → 实验规模、四条不变量 → 实验有效性校验、判官台 → 人工评估（判官仍叫判官）；矩阵这一页按 §九 的写法叫**网格**。列头里的英文术语一并换：canary → 防泄标记、validate → 校验、attempt → 尝试次数、rep → 次数，harness 保留。条件页的键名列头（`model.declared` / `model.endpoint` / `scope` / `preset` / `lock`）换成模型 / 端点 / 作用域 / 预设 / 锁，键名留在 `title`；动作词 `provision` 在词典里定一次为**准备环境**，两处一致。改的不只是列头——正文里的「条件 / 格子 / 快照」一并扫干净，否则列头说「对比组」而句子说「条件」，正是 §九 那张词表要防的不一致。
- **桶与阶段并成一列「运行状态」**：阶段是具体事实，永远显示；桶只在它说了阶段说不出的事时才出现——「阻塞」（有依赖没满足）与「排期」（在等一个时钟）。其余四个桶都由阶段蕴含，两枚 chip 说同一件事正是这一轮要去掉的噪音。
- **色彩语义只有五档**：绿 = 完成 / 成功，蓝 = 进行中，灰 = 未开始，红 = 失败 / 阻塞，橙 = 警告。一处反直觉但 §九 点了名：**「已归档 / 可释放 / 已释放」是灰不是绿**——跑到流水线尽头是「结束了」，不是「成功了」；绿留给「已判」，那才是真有结论的状态。桶里的「阻塞」也从橙改红。
- **数字与句子**：token 计数压成 `31.5k`（一千以下一个不舍，那些数小到每一位都有意义）；时长走词典组句（「4 分 48 秒」与 `4m 48s` 不是同一个串换个数字）；判官一致性从三个数字变成一个词——「评分者一致性：高（κ 0.85）」，κ 挂在悬停上，κ < 0.6 时多一句「建议增加判官」，因为那是这一页上读者真能据以行动的唯一一个数。宿主给的判定句改成温和提示：「当前为单对比组实验，无对比数据，下方是基线表现」，比较节未开也从橙框改成普通提示——那是一种状态，不是一个错误。
- **人工评估队列**按 §九 命名为「P0-placeholder · 第 1 次」（题 + 第几次，不露对比组），序号退成安静的后缀；队列加筛选（全部 / 未评 / 已评，题多于一道时再加一行按题）。筛选是视图本地状态，且**从不重排**——种子顺序本身是盲评的一部分。

新的纯函数（`compactCount` / `durationParts` / `agreementBand`）在 `tests/vocab.spec.ts` 里钉住，连同「它们要的每条文案两份词典都有」。

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

- 七个工具（T73 起 `eval_repo_write` 改名 `eval_analysis_write`）与 `tool:eval` 提示词段归伴生行 `@khorsheed/dsh-eval-tool`，走延迟注入：组合里没有工具注册表 / systemPrompt 时它们不注册，CLI 与服务面照常，不炸启动；`tools: 'none'`（或没有引用这一行）只是让模型看不到这七个工具。发布顺序有约束：引用伴生行的 pack 必须先有伴生包被发布 / 安装——行解析失败只让该 preset 组合报 broken，实例 boot 不受影响。浏览器半边（I5·T35a）的实验室 tab 按同一行自隐，判据读不到时失败开放；没有 `conversation.view` slot 的组合（TUI、headless）不注册它，服务面与 CLI 照常。矩阵的物化哈希要 mission 面报得出 `dataDir`，报不出就记「无法核验」；导出的两步要 mission 的 Remote 在场（没有 Typert 网关的组合就没有），不在场即整体拒绝——泄题闸绝不在 eval 这边重写一遍。
- 面向早于 T11 的 local-agent：委派 `cwd` 被忽略、子代理继承父会话 cwd，格子因收不到产出文件而如实拒绝（submission-rejected），不会错记；`delegationOf` 与 settled 回读均缺席时 `usage` 与 `model.observed` 记 null，「受试对象一致」在报告里降为不可核验，而不是假定成立。判官同样靠 `cwd` 收 `verdicts.json`，没有 cwd 时该样本按解析失败记，不会误判。
- `human-final` 不由本包写：它只从判官台或 `dsh-mission annotate --ns human-final` 进来（I5）。
- 没有 `ctx.lab` 的组合照常跑宿主路径；只有带 `unit` 段的 plan 会因为缺 lab 而被拒绝，并在拒绝语里点名。
- 实验与条件库（T73）住在 `$DSH_HOME/state/eval/`：没设 `DSH_HOME` 的实例没有状态根，实验相关的动词拒绝并点名，列表退化成只列 run（全标旧运行），不炸启动。起草与 validate 要 datasets 的登记面（`registration` / `registryShowFile` / 物化视图）；没挂 datasets 时它们拒绝并点名，旧 plan 路径的 validate 与 CLI dry-run 照常。eval 不再读 datasets 绑定，旧绑定文件（`$DSH_HOME/state/datasets/bindings/<session>.json`）不自动删除。

## 状态

I2：T2 离线动词、T8/T8b 编排器 v0（模板生成、矩阵展开、run 循环阶段一二、格子锚点、T11 回读回填、slash、CLI dry-run）、T10 `report`（results.jsonl / summary.md / 四条不变量 / 配对差值与置信区间 / 判官一致性 / 效率并列）、T9 判官（探针契约、去指纹、双采样盲评、`--finalize` 过闸）、T14 三个只读模型工具已落地。I3：T23 补上 pilot A 暴露的四条编排器缺口——开跑前就绪检查（G4）、`finalize` 再入口（G13）、效率表只计完成格（G15）、`--only` / `--max-cells` 记进 `run.meta.subset`；T28 补上 T19 探针自测暴露的三条——题集级 verify 层物化与共享探针执行、退出码三态、`task` / `by` 先回填后校验。T20 落地容器路径：plan 的 `unit` 段一格一单元（acquire → populate → 逐阶段委派与 checkpoint → 探针经 `lab.verify` 在单元内 → archive → 过闸 release），`refs.fingerprint` 由编排器写入，四条不变量之二从此可核验。provision（I4）、并发单元（I4）、界面（I5）按 web-eval 迭代计划推进。I5：T46 加第四个只读工具 `eval_cells` 与它背后的服务面 `cells(runId)`，评测预设同时摘掉 mission 的伴生行；T35a 从零搭起 client 半边——实验室 tab 的列表与详情壳（只填概览页）、服务面 `experiments` / `experiment` 与它们的 Remote 读动词 `runs` / `run`、七态状态推导，`eval_cells` 同时补上「不给 run_id 就列实验」的模式；T36 填上计划审阅页与条件页，并加上人的那一个写动词 `approve`——validate 过闸、以批准会话为父，背后不配任何模型工具；T35b 填上矩阵页与格子页：`matrix` / `cells` / `cell` 三个读面、`retry` / `releaseCheck` 两个动作转发、`exportPlan` / `exportRun` 转发 mission 的导出闸（闸仍在 mission 侧），外加给题集 tab 用的 `runsForItem`。T38 填上报告页：`report` / `finalize` 两个 Remote 动词与服务面的 `runReport` / `finalizeView`——四条不变量、配对差值、效率表、判官一致性都由同一个 `analyzeBundle` 算出后投影，比较闸在服务端合上；T37 填上判官台，七个子页至此填满：`judgeQueue` 出盲队列（序号 + ticket、去指纹产物、`kind: human` 判据、各判官各样本的 llm-draft、已有 human-final），`humanFinal` 是 `human-final` 这个 ns 的唯一写入口（转发 mission 的 annotate，只追加，`by` 记会话），rubric 解析与判官一致性各自收归一份实现。T34 补上第 2 步「一句话起草」：服务面 `draftExperiment` 一次写下 plan 与它引用的新条件（新条件一律从现有条件复制再改点名字段）并 validate，Remote 的 `newExperiment` / `draftOptions` 给「新建实验」表单用，`eval_plan_draft` 给 agent 用，两个面同一个动词；随 pack 装的 `eval-planning` 技能教 agent 走这条路，并点名批准、登录、provision、终评都不是它的。T57 把释放闸从一个旗标变成 run 的缺省，并把容器交给这条路：每格跑完当场过闸、单元在那里销毁（`--keep-units` 与批准对话框的「保留单元」可退出），`finalize` 也会销毁过闸格子的单元——事后回收的 run 这才真的被回收；`acquire` 撞上 `maxConcurrentUnits` 时点名占着名额的 run 与单元；报告页数出 lab 还持有多少，并给一个走同一条闸的「回收」。

## 许可

[MIT](../../LICENSE)
