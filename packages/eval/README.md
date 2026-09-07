# dsh-eval

中文 | [English](README.en.md)

**web-eval 编排器：dataseek 契约 schema、plan/condition 校验、条件与 scoped home 哈希、由题集 manifest 生成 run 模板、阶段一二的 run 循环（逐格物化、逐字节委派、提交推进、归档闸、bundle 导出）。** run 的发起是人的动作（`/eval run`，发起会话即所有委派的父会话）；判定的两条机器通路（探针写 `script`、判官盲评写 `llm-draft`）随 T9 落地，`human-final` 仍归人。不依赖任何兄弟插件——四个上游服务（datasets / mission / localAgent）在 run 时经 `ctx.get` 探测，缺哪个就拒绝并列出哪个，绝不炸启动。

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

## run 循环 v0（阶段一二，宿主目录）

`ctx.eval.run(planPath, options)` 是本体；`/eval run` 是人的发起动作。流程：

1. **校验先行**：plan 有 error 即拒绝，什么都不执行；条件 lock 与现算哈希不符即拒绝（缺 lock 记 warning，用现算哈希——完整就绪检查归 I4 provision）。
2. **快照**：`datasets.snapshot` 钉 commit，进 run.meta。
3. **模板 + 矩阵**：生成模板写到 plan 旁；`expandMatrix` 展开（题 × 条件 × rep），`orderCells` 按 `plan.order.seed` 洗牌、interleave 时优先同条件不连续；顺序与并发数写进 run.meta。
4. **逐格**（并发缺省 1）：格子独立目录 `$DSH_HOME/state/eval/cells/<runId>/<missionId>/attempt-<N>/`，物化该题 visible 层内容并写 `materialization.json`（排序逐文件 sha256 + 整体 sha，addArtifact kind `materialization`）；每阶段一条 prompt = 题集 visible 层 `prompts/<stage>.md` 字节 + 一个换行 + 该题 `task.md` 字节，sha256 记入 orchestrator ns；编排器直接调 `ctx.localAgent.start`（首轮）/ `resume`（续轮），格子目录经委派 `cwd` 选项传给子代理（local-agent 家族的 cwd 支持，T11）。
5. **推进**：委派返回后从格子目录收 `<stageId>.json` / `<stageId>.md`，`submit({to, json, files})`（意向边预校验），`transition(to)`；`halt_on` 命中走 `halted`。schema 违规不重试：记 `{kind: 'submission-rejected', violations}`，格子停在当前态。
6. **失败策略**：委派启动失败、门面报错、超时取消 → `retry(reason, 'infrastructure')` 重做该格，预算缺省 1 次（`--retries` 可调）；超限记 `{kind: 'cell-skipped'}` 并跳过。超时 = `plan.budget.activeMinutes` 的每格累计委派时长，到点 `cancel(childSessionId)`。
7. **判定与归档**：格子停在终态后先判（见下节），判定落 `archive/verdicts/`，再把格子目录拷到 `archive/workspace/`，`transition(archived)`。缺省停在 archived；`--finalize` 显式推 `releasable → released`，file-check 要求 verdicts/ 非空——两条源里任一有产出即可过闸，两条都没有就如实记 `finalize-refused` 并停在 archived。
8. **导出**：结束时 export bundle 到 `<题库仓库>/exports/`（`--out` 可改），只收 visible 层（modelFacing:true，无需泄题闸确认）。

run 开始时先为每格写一条锚点 `{kind: 'cell', task, condition, conditionSha, rep}`——在任何工作之前，所以连被跳过的格子也可归属；报告只认这条锚点定格子身份（bundle 里没有 labels，mission id 是有损的）。

每次委派在 orchestrator ns 记 `{kind: 'delegation', stage, round, childSessionId, promptSha, startedAt, durationMs, usage, model: {declared, observed}}`；`observed` 取自 T11 的回读——本轮 settled 事件优先，其次 `delegationOf(childSessionId)` 的记录。读记录要**等**：provider 在 settle 后的收尾遍里才并入观测，而门面在 result 落定的同一刻就清掉了带着 `onProgress` 的在跑记录，所以真实门面上 settled 事件根本到不了编排器、记录也要晚一拍才有值——run 结束即读会读空（第一次两格真跑的现场）。编排器因此在 settle 后有界地轮询记录（缺省 10s，`readbackWaitMs` 可调），等到与本轮开始前不同的观测即采用；等超时仍返回记录当前值（续轮跑的是同一模型时两者本就无从区分，记录本身的语义就是「该委派最近一次观测」），两处都没有才记 null。`usage` 只走 settled 事件：门面先清在跑记录的情况下这里拿不到，记 null 是诚实答案。回读到的模型与条件 `model.declared` 不符即当场失败（冻结决策 5：这次 run 归属错了），不按基础设施失败重试。

## 判定：探针（script）与判官盲评（llm-draft）

格子跑完阶段、停在终态后，编排器在归档前跑两条机器通路。完整契约见 [协议 §6.7 / §6.8](../../docs/dataset-authoring-protocol.md)；这里是实现侧的读法。

**探针（`script`）** —— 题目 verify 层下任意 `probes/` 段里的 `.mjs` / `.sh`。调用约定 `<probe> --cell <格子目录> --rubric <rubric 路径> --out <verdicts.json>`：**退出码 0 = 已判定**（含 `pass: false`），非 0 = 探针失败不产生判定；退出 0 却写不出可读的 `--out`，同样按失败记。verify 层整层物化进宿主临时目录并以它为 cwd，跑完删除（I3 起交 `lab.verify` 进容器，契约不变）。产出写 `script` ns 与 `archive/verdicts/script.json`；题目没有探针就什么都不写。

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
| `validatePlan(planPath)` | 校验 plan schema 与语义（判官≠选手、judge/expectedNs 交叉检查、预算下限），解析条件声明与 lock，lint 阶段 schema。数据问题以 diagnostics 返回（`errors` / `warnings` 各带稳定 code），从不 throw |
| `hashCondition(condition)` | 条件哈希 = 规范化 JSON（键排序、无空白）的 sha256，`notes` 不参与（改注释不是换条件）。非法文档抛 `EvalContractError` |
| `hashHome(homeDir)` | scoped home 内容哈希：只取配置类文件，按拒绝清单跳过凭证形状的路径；内容只进摘要，绝不返回或打印 |
| `generateTemplate(manifestPath, opts?)` | 由题集 manifest 生成 run 模板（可选项：`stages` 子集、`missions` 格批次、`name`、schemaPath 前缀）。纯函数：不探测 schema 文件，探测归 mission 的 runCreate lint |
| `run(planPath, options?)` | run 循环本体（见上节）。缺 datasets / mission / localAgent 任一即拒绝并列出哪个；`dryRun` 选项只做校验 + 模板 + 矩阵 + 顺序，不需要任何上游 |
| `report(bundleDir, {out?})` | 把 mission export 的自包含 bundle 变成 `results.jsonl` + `summary.md`（见下节）。只读 bundle，写入缺省 `<bundleDir>/report/`，重复运行覆盖（报告是派生态，bundle 本身只增不改） |

## 报告（report）

输入是 mission export 的 bundle（manifest.json、run.json、missions/<id>/attempt-N/{meta,annotations,artifacts}、dataset/<layer>/），输出两份文件：

- **results.jsonl** — 一行一个判定：`{task, condition, conditionSha, rep, attempt, stage, ns, criterion, pass, weight?, evidence, by}`。weight 只在 bundle 的 dataset 层带有 weight 的 rubric 时出现；stage 取自注解记录的 stage 字段（判定契约本身不含 stage，未记录即 null）。
- **summary.md** — 开头先核四条不变量（题面一致 / 环境一致 / 受试对象一致 / 程序一致）。**任一项不成立或无法核验，只输出事实表，不输出比较**。比较启用时：因子由 run.meta.conditions 的条件文档两两 diff 推出（只差一项即因子名，差多项标「多因子」只做描述统计）；配对以题为区组、rep 为重采样单元，输出逐题差值（通过判据数与加权分）、n、自助法 95% 置信区间（seed 确定性，统计手写无依赖）；n < 3 或因子未知/多因子时打印「不可排名」并拒绝名次。判官一致性按 criterion 算双采样一致率与 Cohen κ，human-final 在场时算 llm-draft 对终评的一致率。效率并列不合成：活跃时长（委派 durationMs 之和）、标价成本（run.meta.pricing 给了才有）、委派轮次（只在双方都完成的题上比）、token 只在同模型内比。expectedNs 里某 ns 的判定全由 `tool:` 写入时 summary 顶部红字标出。

判定源按权威排序取各格的主判定（human-final > llm-draft > script，同判据多样本按多数计）；rep 是独立样本，attempt 只算基础设施重试——所有 attempt 的判定都进 results.jsonl，聚合只用各格最新 attempt。

## slash 与 CLI

```sh
/eval run <plan.json> [--concurrency N] [--dry-run] [--finalize] [--out DIR] [--retries N]
```

run 的发起是人的动作：在 web-eval 实例的会话里执行，该会话即 originSession 与所有委派的父会话。不注册任何 run 类模型工具——写类动词归编排器服务面与人。

```sh
dsh-eval validate <plan.json>             # 校验 plan；报告 JSON 走 stdout
dsh-eval run <plan.json> --dry-run        # 离线彩排：校验 + 模板 + 矩阵 + 顺序；不带 --dry-run 一律拒绝
dsh-eval template <manifest.yml> [--stages a,b]  # 打印生成的 run 模板
dsh-eval conditions hash <condition.json> # 打印 { id, sha, warnings }
dsh-eval report <bundleDir> [--out DIR]   # 出 results.jsonl + summary.md；摘要 JSON 走 stdout
```

数据走 stdout JSON，诊断走 stderr；退出码 0 ok / 1 失败 / 2 用法错误（与 `dsh-lab` 一致）。CLI 直连内核，不需要宿主在跑——脚本场景与已挂载插件行为完全一致；进程外没有活的父 Agent，所以 CLI 的 `run` 只做 `--dry-run`。

## 哈希规则

- **条件哈希**：规范化 JSON（键全排序、无空白）的 sha256 小写十六进制；`notes` 除外。
- **planSha**：plan 全文档规范化 JSON 的 sha256（含 notes——审阅时改注释也会换 plan，这正是「同 plan 即同一套程序」的口径）。
- **home.sha**：只哈希配置类文件（`.json .jsonc .yml .yaml .toml .ini .cfg .conf .xml .properties`），按相对路径排序后对 `<relPath>\0<content>\0` 逐文件喂 sha256。拒绝清单：`auth.json`、`.env*`；文件名含 `token` / `key` / `credential` / `secret` / `password` / `auth`（不分大小写）；`credentials/`、`oauth/`、`sessions/`、`keys/`、`secrets/` 目录整棵跳过；符号链接与超大文件（>1 MiB）跳过。文件内容绝不读入日志、绝不打印。
- **materialization.json**：该题 visible 层文件按路径排序后逐文件 sha256，整体 sha 按排序 `<path>\0<fileSha>\0` 折进 sha256——同题各格可被证明题面一致。

## 兼容性

- npm release line（`@deepseek-ai/dsh@0.1.0-rc.6+`）：✅ —— 消费 `Context.provide` 与 `commands`；run 时探测三个兄弟服务，缺席即拒绝，不炸启动。
- source line（deepseek-harness master）：✅ —— 同上。

降级 / 缺席项（与 package.json 的 `dsh.compat` 同步）：

- 面向早于 T11 的 local-agent：委派 `cwd` 被忽略、子代理继承父会话 cwd，格子因收不到产出文件而如实拒绝（submission-rejected），不会错记；`delegationOf` 与 settled 回读均缺席时 `usage` 与 `model.observed` 记 null，「受试对象一致」在报告里降为不可核验，而不是假定成立。判官同样靠 `cwd` 收 `verdicts.json`，没有 cwd 时该样本按解析失败记，不会误判。
- `human-final` 不由本包写：它只从判官台或 `dsh-mission annotate --ns human-final` 进来（T20 / I5）。

## 状态

I2：T2 离线动词、T8/T8b 编排器 v0（模板生成、矩阵展开、run 循环阶段一二、格子锚点、T11 回读回填、slash、CLI dry-run）、T10 `report`（results.jsonl / summary.md / 四条不变量 / 配对差值与置信区间 / 判官一致性 / 效率并列）、T9 判官（探针契约、去指纹、双采样盲评、`--finalize` 过闸）已落地。只读工具（T14）、provision（I4）、界面（I5）按 web-eval 迭代计划推进。

## 许可

[MIT](../../LICENSE)
