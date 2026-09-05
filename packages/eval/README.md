# dsh-eval

中文 | [English](README.en.md)

**web-eval 编排器：dataseek 契约 schema、plan/condition 校验、条件与 scoped home 哈希、由题集 manifest 生成 run 模板、阶段一二的 run 循环（逐格物化、逐字节委派、提交推进、归档闸、bundle 导出）。** run 的发起是人的动作（`/eval run`，发起会话即所有委派的父会话）；判定与报告属后续任务（T9 / T10）。不依赖任何兄弟插件——四个上游服务（datasets / mission / localAgent）在 run 时经 `ctx.get` 探测，缺哪个就拒绝并列出哪个，绝不炸启动。

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
4. **逐格**（并发缺省 1）：格子独立目录 `$DSH_HOME/state/eval/cells/<runId>/<missionId>/attempt-<N>/`，物化该题 visible 层内容并写 `materialization.json`（排序逐文件 sha256 + 整体 sha，addArtifact kind `materialization`）；每阶段一条 prompt = 题集 visible 层 `prompts/<stage>.md` 字节 + 一个换行 + 该题 `task.md` 字节，sha256 记入 orchestrator ns；编排器直接调 `ctx.localAgent.start`（首轮）/ `resume`（续轮），格子目录经委派 `cwd` 选项传给子代理（依赖 local-agent 家族的 cwd 支持，T11）。
5. **推进**：委派返回后从格子目录收 `<stageId>.json` / `<stageId>.md`，`submit({to, json, files})`（意向边预校验），`transition(to)`；`halt_on` 命中走 `halted`。schema 违规不重试：记 `{kind: 'submission-rejected', violations}`，格子停在当前态。
6. **失败策略**：委派启动失败、门面报错、超时取消 → `retry(reason, 'infrastructure')` 重做该格，预算缺省 1 次（`--retries` 可调）；超限记 `{kind: 'cell-skipped'}` 并跳过。超时 = `plan.budget.activeMinutes` 的每格累计委派时长，到点 `cancel(childSessionId)`。
7. **归档**：最后阶段过完把格子目录拷到 attempt 数据目录 `archive/workspace/`，`transition(archived)` 后停——verdicts/ 要等判官（T9）才有内容，空目录过不了 file-check，所以 `released` 只由显式 `--finalize` 触发且要求 verdicts/ 非空。
8. **导出**：结束时 export bundle 到 `<题库仓库>/exports/`（`--out` 可改），只收 visible 层（modelFacing:true，无需泄题闸确认）。

每次委派在 orchestrator ns 记 `{kind: 'delegation', stage, round, childSessionId, promptSha, startedAt, durationMs, usage, model: {declared, observed}}`；`usage` 与 `observed` 等 local-agent 家族的模型回读（T11）落地前为 null。

## 服务面 `ctx.eval`

| 方法 | 作用 |
|---|---|
| `validatePlan(planPath)` | 校验 plan schema 与语义（判官≠选手、judge/expectedNs 交叉检查、预算下限），解析条件声明与 lock，lint 阶段 schema。数据问题以 diagnostics 返回（`errors` / `warnings` 各带稳定 code），从不 throw |
| `hashCondition(condition)` | 条件哈希 = 规范化 JSON（键排序、无空白）的 sha256，`notes` 不参与（改注释不是换条件）。非法文档抛 `EvalContractError` |
| `hashHome(homeDir)` | scoped home 内容哈希：只取配置类文件，按拒绝清单跳过凭证形状的路径；内容只进摘要，绝不返回或打印 |
| `generateTemplate(manifestPath, opts?)` | 由题集 manifest 生成 run 模板（可选项：`stages` 子集、`missions` 格批次、`name`、schemaPath 前缀）。纯函数：不探测 schema 文件，探测归 mission 的 runCreate lint |
| `run(planPath, options?)` | run 循环本体（见上节）。缺 datasets / mission / localAgent 任一即拒绝并列出哪个；`dryRun` 选项只做校验 + 模板 + 矩阵 + 顺序，不需要任何上游 |

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

- 委派 `cwd`（每格独立目录落到子代理进程）依赖 local-agent 家族的 cwd 选项（T11）：未合入时选项被忽略、子代理继承父会话 cwd，格子因收不到产出文件而如实拒绝（submission-rejected），不会错记。
- `usage` 与 `model.observed` 等 T11 的回读落地前记 null。

## 状态

I2：T2 离线动词 + T8 编排器 v0（模板生成、矩阵展开、run 循环阶段一二、slash、CLI dry-run）已落地。判官（T9）、报告（T10）、只读工具（T14）、provision（I4）、界面（I5）按 web-eval 迭代计划推进。

## 许可

[MIT](../../LICENSE)
