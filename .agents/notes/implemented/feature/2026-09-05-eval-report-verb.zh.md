# Agent Note: dsh-eval report 动词——bundle 先出事实，比较锁在不变量之后

Status: implemented

## Problem

web-eval 的 I2 需要编排器的报告半（任务 T10）：mission export 的 bundle 是自包含的（manifest.json、run.json、missions/<id>/attempt-N/{meta,annotations,artifacts}、dataset/<layer>/），三个判定 ns（script / llm-draft / human-final）都住在里面——但没有任何东西把 bundle 变成方法论要求的配对比较。方法论（web-eval README「把它当对照实验来设计」、冻结决策 9–11、架构 §5 的四条不变量、harness-comparison dimensions 文档的「效率并列不合成」）是一组诚实性约束，而一个天真的报告会全部违反：它会比较物化、环境、受试对象或程序从未被证明一致的格；会在 n=1 上排名；会把效率合成一个分数；会无声接受一个 `tool:` 写的 human-final。

## Decision

`report` 作为第三组动词加入 eval 内核，与 validate/hash 并列（`analyzeBundle` / `writeEvalReport`，服务面 `ctx.eval.report(bundleDir, {out?})`，CLI `dsh-eval report <bundleDir> [--out DIR]`）。它只读 bundle——不读 mission 数据根、不读题库仓库、不 import 任何 `@khorsheed/*` 包——把 `results.jsonl`（一行一个判定：`{task, condition, conditionSha, rep, attempt, stage, ns, criterion, pass, weight?, evidence, by}`）和 `summary.md` 写进 `<bundleDir>/report/`（重复运行覆盖：报告是派生态，bundle 本身只增不改）。

承重的规则，每条都落在代码里：

- **不变量给比较上闸。** 四条（逐题 materialization、refs.fingerprint、受试对象条件与模型回读、evalVersion+planSha）必须全部 `ok`——`violated` 或 `unverifiable`（数据缺席）都把整份报告降级为事实表。「无法核验」算「未成立」；缺指纹如实打印 本 run 无指纹，而不是当作相等。
- **因子是推出来的，不是声明的。** `run.meta.conditions` 条目里记录的条件文档按顶层字段两两 diff（`notes` 除外）；只差一项即因子名，差多项降级「多因子」（只做描述统计），文档缺席则该对的因子记未知——同样拒绝排名。
- **题是区组，rep 是重采样单元。** 每对条件每题：按 rep 配对的通过判据数差值（各格主判定源 = human-final > llm-draft > script，同判据多样本按多数计）、n、对每题均值做 seed 确定的自助法百分位置信区间。排名要求 n ≥ 3 且置信区间不含 0；其余一律打印 不可排名、不出名次。统计手写（`src/stats.ts`：mulberry32、FNV-1a 种子、bootstrapMeanCi、cohenKappa），测试用手工算的数值钉住——零统计依赖。
- **attempt 是行，最新 attempt 才进聚合。** 冻结决策 1：所有 attempt 的判定都进 results.jsonl；聚合只用各格最新 attempt；重试单独计数。
- **判官一致性只从 bundle 算。** llm-draft 双采样判据给一致率与样本两两平均的 Cohen κ（评分者恒定时 κ 无定义 → 不适用）；human-final 在场时给 llm-draft 对终评的一致率。
- **效率并列。** 活跃时长（委派 durationMs 求和）、委派轮次（只在双方都完成的题上比——halted 不算完成）、标价成本（run.meta.pricing 记了才有，否则留空）、token 只在同模型内比（跨模型列 不适用）。
- **红字在顶部。** expectedNs 里某 ns 的写入者全部是 `tool:` 前缀（manifest nsReport 的 writtenBy，旧 bundle 从注解回算）时，在四条不变量之前打印红字警告。

对编排器形状的容忍度钉在 T8 任务书（iterations.md）上：run.meta `{planSha, evalVersion, conditions: [{id, sha, condition?}]}`，orchestrator ns 委派记录 `{kind: 'delegation', stage, round, durationMs, usage, model: {declared, observed}}`。格子身份靠 `<task>-<conditionId>-rep<N>` 的 mission id 以 run.meta.conditions 的 id 清单为锚解析——没有锚（i1-walk bundle）时 condition/task 保持 null，绝不猜。verdict 载荷按 `dataseek.verdict/1` 校验，判定 ns 里的其他东西一律忽略。rubric weight 从 bundle 的 dataset 层容忍读取；weight 缺席时加权列留空。

## Alternatives considered

- **把报告做进 mission 的导出路径。** 拒绝：报告是评测语义（不变量、因子、配对），mission 拥有的是通用 bundle。读 bundle 目录让依赖方向干净，而且不需要宿主在跑。
- **引入统计库（如 simple-statistics）。** 拒绝：全部函数集就是三个小纯函数，为它们背一个依赖不值得。手写 + 手算 κ/CI 测试值让数字可审计。
- **当所有格同样沉默时把「无法核验」当作成立**（例如整 run 无指纹）。拒绝：那会让前编排器时代的 bundle 参与比较。i1-walk bundle 就是验收用例——它必须只出事实。
- **没有条件锚时从 mission id 猜 condition/task。** 拒绝：没有条件清单的 `p0-dsh-exec` 无法诚实地拆分；猜出来的因子比缺因子更糟。
- **效率用墙钟。** 拒绝：冻结决策 8——只用活跃时长（委派 durationMs 之和）；墙钟是解释变量，不是指标。

## Consequences

- i1-walk bundle 现在被诚实报告：两行判定，四条不变量全部无法核验或不成立（无 evalVersion、无指纹、无条件记录），比较被拒绝——即验收事实表。
- `dsh-eval` CLI 与 `ctx.eval` 拿到 report 动词而不动离线面；执行动词（run / readiness / provision）仍是别处拥有的 I2 工作。报告消费 T8 编排器的 run.meta/ns 形状；T8 落地前，只有手工 bundle（仅事实表）和合成夹具走得到比较路径。
- results 行的 `stage` 只有注解记录带 stage 字段才非 null——判定契约本身没有。T9 若想要按阶段归属的判定，注解级字段就是接缝。
- `weight` 只在 bundle 的 dataset 层带 weight 的 rubric 时出现（容忍读取 `{task, criteria: [{criterion, weight}]}` 形状）。导出通常不收 guarded 层，加权分通常需要特意带 guarded 层导出。
- 统计函数住在 `src/stats.ts` 并从包根导出，供 I5 报告视图使用；它们不是通用统计库。
