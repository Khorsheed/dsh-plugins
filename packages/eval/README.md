# dsh-eval

中文 | [English](README.en.md)

**web-eval 编排器的离线一半：dataseek 契约 schema、plan/condition 校验、条件与 scoped home 哈希、bundle 配对报告。** 只声明与检查、只读 bundle——`run` / `provision` 属编排器的执行半（I2 起补齐）。无 client 半、无 inject、不依赖任何兄弟插件，单独安装即用。

## 它管什么

三份契约 schema 与一条 lock 记录（全文见 [dataset-authoring-protocol §6](../../docs/dataset-authoring-protocol.md)，代码里集中在 `src/schema.ts` 一个模块，测试钉住文档与代码不漂移）：

| schema | 是什么 |
|---|---|
| `dataseek.condition/1` | 受试对象：harness、模型声明、permissions（按 harness 词表）、scoped home 哈希、env 键名 |
| `dataseek.plan/1` | 一次 run 的全部输入：题 × 条件 × rep × 阶段 × 顺序 × 预算 × 判官 × 期望判定源 |
| `dataseek.verdict/1` | 判定输出：探针与判官共同遵守的格式 |
| `dataseek.condition-lock/1` | 条件哈希与 scoped home 的实物记录；plan 的 sha 从这里解析 |

校验器遵循 I1 定下的字段决定：condition 的可空字段（`harness.version`、`model.declared`、`model.endpoint`、`home.sha`）的 null 是「未解析」，validate 列为 warning；`plan.conditions` 写条件 id，sha 从 `conditions/<id>.lock.json` 解析，缺 lock 即「未就绪」（同样是 warning——拦截归 run 前的就绪检查）；`judge` 可缺省，缺省时 `expectedNs` 不得含 `llm-draft`；plan 不含 template 字段。

## 服务面 `ctx.eval`

| 方法 | 作用 |
|---|---|
| `validatePlan(planPath)` | 校验 plan schema 与语义（判官≠选手、judge/expectedNs 交叉检查、预算下限），解析条件声明与 lock，lint 阶段 schema。数据问题以 diagnostics 返回（`errors` / `warnings` 各带稳定 code），从不 throw |
| `hashCondition(condition)` | 条件哈希 = 规范化 JSON（键排序、无空白）的 sha256，`notes` 不参与（改注释不是换条件）。非法文档抛 `EvalContractError` |
| `hashHome(homeDir)` | scoped home 内容哈希：只取配置类文件，按拒绝清单跳过凭证形状的路径；内容只进摘要，绝不返回或打印 |
| `report(bundleDir, {out?})` | 把 mission export 的自包含 bundle 变成 `results.jsonl` + `summary.md`（见下节）。只读 bundle，写入缺省 `<bundleDir>/report/`，重复运行覆盖（报告是派生态，bundle 本身只增不改） |

## 报告（report）

输入是 mission export 的 bundle（manifest.json、run.json、missions/<id>/attempt-N/{meta,annotations,artifacts}、dataset/<layer>/），输出两份文件：

- **results.jsonl** — 一行一个判定：`{task, condition, conditionSha, rep, attempt, stage, ns, criterion, pass, weight?, evidence, by}`。weight 只在 bundle 的 dataset 层带有 weight 的 rubric 时出现；stage 取自注解记录的 stage 字段（判定契约本身不含 stage，未记录即 null）。
- **summary.md** — 开头先核四条不变量（题面一致 / 环境一致 / 受试对象一致 / 程序一致）。**任一项不成立或无法核验，只输出事实表，不输出比较**。比较启用时：因子由 run.meta.conditions 的条件文档两两 diff 推出（只差一项即因子名，差多项标「多因子」只做描述统计）；配对以题为区组、rep 为重采样单元，输出逐题差值（通过判据数与加权分）、n、自助法 95% 置信区间（seed 确定性，统计手写无依赖）；n < 3 或因子未知/多因子时打印「不可排名」并拒绝名次。判官一致性按 criterion 算双采样一致率与 Cohen κ，human-final 在场时算 llm-draft 对终评的一致率。效率并列不合成：活跃时长（委派 durationMs 之和）、标价成本（run.meta.pricing 给了才有）、委派轮次（只在双方都完成的题上比）、token 只在同模型内比。expectedNs 里某 ns 的判定全由 `tool:` 写入时 summary 顶部红字标出。

判定源按权威排序取各格的主判定（human-final > llm-draft > script，同判据多样本按多数计）；rep 是独立样本，attempt 只算基础设施重试——所有 attempt 的判定都进 results.jsonl，聚合只用各格最新 attempt。

## CLI

```sh
dsh-eval validate <plan.json>             # 校验 plan；报告 JSON 走 stdout
dsh-eval conditions hash <condition.json> # 打印 { id, sha, warnings }
dsh-eval report <bundleDir> [--out DIR]   # 出 results.jsonl + summary.md；摘要 JSON 走 stdout
```

数据走 stdout JSON，诊断走 stderr；退出码 0 ok / 1 失败 / 2 用法错误（与 `dsh-lab` 一致）。CLI 直连内核，不需要宿主在跑——脚本场景与已挂载插件行为完全一致。

## 哈希规则

- **条件哈希**：规范化 JSON（键全排序、无空白）的 sha256 小写十六进制；`notes` 除外。
- **home.sha**：只哈希配置类文件（`.json .jsonc .yml .yaml .toml .ini .cfg .conf .xml .properties`），按相对路径排序后对 `<relPath>\0<content>\0` 逐文件喂 sha256。拒绝清单：`auth.json`、`.env*`；文件名含 `token` / `key` / `credential` / `secret` / `password` / `auth`（不分大小写）；`credentials/`、`oauth/`、`sessions/`、`keys/`、`secrets/` 目录整棵跳过；符号链接与超大文件（>1 MiB）跳过。文件内容绝不读入日志、绝不打印。

## 兼容性

- npm release line（`@deepseek-ai/dsh@0.1.0-rc.6+`）：✅ —— 只消费 `Context.provide`，不依赖宿主能力。
- source line（deepseek-harness master）：✅ —— 同上。

降级 / 缺席项（与 package.json 的 `dsh.compat` 同步）：无。报告只读 bundle、不依赖宿主能力。执行动词（`run` / `readiness` / `generateTemplate` / `provision`）尚未存在，见「状态」。

## 状态

I2 · T2：离线动词与契约已定稿。I2 · T10：`report`（results.jsonl / summary.md / 四条不变量 / 配对差值与置信区间 / 判官一致性 / 效率并列）落地。执行半其余动词按 web-eval 迭代计划推进（run/readiness I2、provision I4、界面 I5）。

## 许可

[MIT](../../LICENSE)
