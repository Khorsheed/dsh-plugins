# dsh-web-eval 迭代文档

本文把 [README](../README.md) 的目标架构拆到**插件 × 层**的粒度，标注每一项是已满足、需改还是待建，落在哪个迭代；然后给出逐迭代的任务、依赖与验收。能力与文件的全貌见 [architecture.md](architecture.md)。

协作方式：协调者给任务指引与最终验收，实施 agent 在各自 worktree 里做；每个任务回报 commit、Agent Note 路径与 gate 输出。规则以 `AGENTS.md` 与 `docs/development.md` 为准。

状态标记：✅ 已满足 ｜ 🔶 需改 ｜ ⬜ 待建 ｜ — 刻意不做

## 一、能力矩阵：插件 × 层

### datasets

| 能力项 | 层 | 现状 | 落地 | 说明 |
|---|---|---|---|---|
| list / show / describe / read / snapshot / worktree_path / put_item / validate | 服务面 | ✅ | — | 编排器与判官取层走这里，显式指定层 |
| 同名 8 个 `datasets_*` 工具 | 工具 | ✅ | — | eval 域全开读类与作者类 |
| 工具分组配置 `tools: all / read / none` | 配置 | ⬜ | I2 | preset 挑不掉 profile 层工具，只能由插件按组注册 |
| `dsh-datasets` 全动词 + `bind` | CLI | ✅ | — | |
| datasets tab（绑定条、层树、预览） | UI | ✅ | — | |
| 金丝雀字段 + `validate` 检查 visible 层每个文件 | 协议 + 校验 | ⬜ | I2 | 成本极低，第一次真实 run 前就要有 |
| item 级外部源指针（repo + commit + path） | 协议 + 服务面 | ⬜ | I6 | 外部评测集不把仓库塞进 git |

### mission

| 能力项 | 层 | 现状 | 落地 | 说明 |
|---|---|---|---|---|
| runCreate / lint / transition / submit / annotate / attest / retry / setRefs / addArtifact / addCheckpoint / isReleasable / get / runStatus | 服务面 | ✅ | — | 编排器的账本 |
| `retry` 必须带 reason 与通用类别 | 服务面 + 工具 + CLI | ⬜ | I1 · T4 | 报告分开计数基础设施失败与结果失败 |
| ns 完整性报告带 `writtenBy` | 导出 | ⬜ | I1 · T4 | `human-final` 若由 `tool:` 写入，报告标出 |
| 12 个 `mission_*` 工具 | 工具 | ✅ | — | eval 域只开 4 个读工具 |
| 工具分组配置 `tools: all / read / none` | 配置 | ⬜ | I2 | 同 datasets |
| `dsh-mission` 全动词，`export` 带 TTY 泄题闸 | CLI | ✅ | — | |
| missions tab（队列、详情、重跑、释放检查、导出对话框） | UI | ✅ | — | 格子详情大半靠它 |
| run.meta 承载 planSha / evalVersion / snapshot | 数据 | ✅ | — | meta 不透明，无需改 |
| schema-check `inputFrom: run-meta` 钉快照 | guard | ✅ | — | 生成的模板在最早转移上用它 |

### lab

| 能力项 | 层 | 现状 | 落地 | 说明 |
|---|---|---|---|---|
| acquire / populate / collect / checkpoint / verify / archive / release / status | 服务面 | ✅ | — | |
| 复合指纹（镜像 digest + 资源限制 + 挂载布局 + env 键） | 服务面 | ⬜ | I3 | 现在只有镜像 digest |
| 模型工具 | 工具 | — | — | 刻意不开，评测里由编排器调用 |
| `dsh-lab` 全动词，`status` 进度表 | CLI | ✅ | — | |
| 单元状态进实验台 | UI | ⬜ | I5 | lab 无自有 UI，由 eval 的 tab 呈现 |

### local-agent 家族

| 能力项 | 层 | 现状 | 落地 | 说明 |
|---|---|---|---|---|
| start / resume / cancel 门面 | 服务面 | ✅ | — | 编排器委派用 |
| exec / live 可配（live 默认关） | 配置 | ✅ | — | 冻结决策 2 |
| codex `sandbox`、claude `permissionMode` 可配 | 配置 | ✅ | — | 冻结决策 3 |
| kimi 推理强度可配（现写死 high） | 配置 | ⬜ | I1 · T3 | 冻结决策 4 |
| `effectiveSettings(harness)` 只读快照 | 服务面 + status | ⬜ | I1 · T3 | condition 的取证来源，不含凭证 |
| 模型回读：从四家输出流记录实际模型 | 服务面 + 记录 | ⬜ | I2 | 冻结决策 5 的后半 |
| 容器内 exec 包装，或 CLI 驱动抽成独立包 | 架构 | ⬜ | I3 | 二选一，I3 开头决定 |
| 每次委派可覆盖 scoped home / 配置（每条件一个 home） | 服务面 | ⬜ | I4 | 同 harness 多条件的前提 |
| 每 provider 的模型参数 | 服务面 | ⬜ | I4 | 冻结决策 5 的前半 |
| `subagent_<harness>` 工具 | 工具 | ✅ | — | 规划 agent 不需要 |
| slash `status / login / records` | CLI | ✅ | — | |
| 设置卡、成员 dock、成员续聊 | UI | ✅ | — | |

### capability-catalog

| 能力项 | 层 | 现状 | 落地 | 说明 |
|---|---|---|---|---|
| `list_capabilities` | 工具 | ✅ | — | |
| 按 preset scope 的可哈希能力清单 | 服务面 | ⬜ | I4 | 进 condition 取证 |
| catalog tab | UI | ✅ | — | |

### eval（待建，`packages/eval`）

| 能力项 | 层 | 现状 | 落地 | 说明 |
|---|---|---|---|---|
| 包骨架、`validatePlan`、`hashCondition`、就绪检查（对既有 home） | 服务面 | ⬜ | I1 · T2 | 三份 schema 同步进协议 |
| `dsh-eval validate` / `conditions hash` | CLI | ⬜ | I1 · T2 | |
| `generateTemplate`：题集 manifest → run 模板 | 服务面 | ⬜ | I2 | 模板不再手写 |
| run 循环 v0：阶段一二，宿主目录代替容器 | 服务面 + CLI | ⬜ | I2 | 探测四个上游，缺一即拒 |
| 判官委派：去指纹 + 判官条件 + verdict 解析 | 服务面 | ⬜ | I2 | 判官 ≠ 选手，双采样 |
| `dsh-eval report`：results.jsonl + summary.md | CLI | ⬜ | I2 | 四条不变量核对在开头 |
| 只读工具 `eval_conditions` / `eval_plan_validate` / `eval_run_status` | 工具 | ⬜ | I2 | 不开 run |
| 容器路径：acquire / populate / checkpoint / verify / archive 交 lab | 服务面 | ⬜ | I3 | |
| `conditions provision`：创建每条件 home 并回算哈希 | CLI + 服务面 | ⬜ | I4 | 依赖 local-agent 的 home 覆盖 |
| 条件注册表数据面（Remote） | UI 数据 | ⬜ | I4 | |
| `eval-planning` skill | 引导 | ⬜ | I5 | |
| 实验台 / 计划审阅 / 判官台 / 报告视图 | UI | ⬜ | I5 | client 半 |
| 外部评测集适配脚本 | 脚本 | ⬜ | I6 | |

### profile 与题库

| 能力项 | 层 | 现状 | 落地 | 说明 |
|---|---|---|---|---|
| 目录、脚本、README、CHANGELOG | profile | ✅ | I0 | |
| 评测 pin 进 pack 自带 patch 层还是用户层 | profile | ⬜ | I1 决定 | |
| eval preset：不挂 Bash 与 docker | profile | ⬜ | I3 | 冻结决策 12，容器出现时才有意义 |
| 独立 `$DSH_HOME` 的评测实例 | 运维 | ✅ | — | `docs/ops.md` 已有规程 |
| 镜像仓 + agent 照 README 安装验证 | 分发 | ⬜ | I6 | |
| 题库：P0 / F2 / F3 三层内容 | 数据 | ✅ | — | 私有仓库 |
| 题库：bench 模板、stage schema JSON、题集级 `prompts/` | 数据 | ⬜ | I1 · T1 | |
| 题库：`conditions/` 与 `plans/` 目录 | 数据 | ⬜ | I1 · T1 起 | |
| 题库：verify 探针脚本、题集级镜像验证、四家 Linux CLI | 数据 + 运维 | ⬜ | I3 | |

### 运行环境

组件归属与内容见 [architecture.md](architecture.md)「运行环境」一节。

| 能力项 | 层 | 现状 | 落地 | 说明 |
|---|---|---|---|---|
| 独立 `$DSH_HOME` 的评测实例 | 运维 | ✅ | — | 规程已有 |
| 四家 CLI 在宿主直跑，各自 scoped home | 运维 | ✅ | I1–I2 | 隔离只到每格独立 cwd |
| 题集级镜像构建验证、digest 入指纹 | 题库 + lab | ⬜ | I3 · T14 | Dockerfile 已写未构建 |
| 四家 Linux CLI 安装方式与版本 pin | 题库 | ⬜ | I3 · T14 | `versions.lock` 的 TODO |
| 本地包镜像 | 运维 | ⬜ | I3 · T14 | 断外网仍能装依赖 |
| 白名单代理 | 运维 | ⬜ | I3 · T14 | 只放行模型端点 |
| 各家凭证可写卷 | 运维 | ⬜ | I3 · T14 | claude 续期回写是硬要求 |
| 资源限制进复合指纹 | lab | ⬜ | I3 · T16 | |
| docker socket 只归编排器 | profile | ⬜ | I3 · T19 | 冻结决策 12 |
| 归档排除清单与先归档后释放 | lab + eval | ⬜ | I3 · T18 | |

## 二、逐迭代

每个迭代：目标、任务（编号全局递增）、验收、进入下一迭代的信号。任务类型：**代码**（隔离会话即可）、**运维**（需要全权限会话，真机跑）、**数据**（改题库仓库）。

### I1 · 走通一格 + 三份契约

目标：手工把一格跑通，把操作手册里的 ❌ 全部换成脚本或明确步骤；同时定死 condition / plan / verdict 的形状。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T1 | 运维 + 数据 | P0 × dsh × 阶段一二手工走通；bench 模板、stage schema、`prompts/`；操作手册更新；走通日志 | 无 | 题库 commit、bundle、`docs/i1-walk-log.md` |
| T2 | 代码 | `packages/eval` 骨架；三份 schema 进协议；`validate` 与 `conditions hash`；哈希规则含拒绝清单 | 无 | 分支 `feat/eval-validate` |
| T3 | 代码 | local-agent：kimi effort 可配；`effectiveSettings`；status 面附带快照 | 无 | 分支 `feat/local-agent-eval-pins` |
| T4 | 代码 | mission：`retry` reason + 类别；ns 报告 `writtenBy`；旧格式兼容 | 无 | 分支 `feat/mission-retry-reason` |

四个任务互不依赖，可并行。唯一串行点：T1 回报「plan 与 condition 还缺哪些字段」后，T2 改 schema 模块再验收。

验收：README「迭代计划」I1 行的三条；T2 到 T4 各自的完成判据；`pnpm gate` 全绿。

进入 I2 的信号：操作手册无 ❌；P0 的 plan 两次哈希相同；三条分支合入 main。

### I2 · 编排器 v0 + pilot A

目标：一格全自动跑完；F2 + F3 × 四家 × 3 rep 出第一份带保留条款的结论。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T5 | 代码 | eval：`generateTemplate`（manifest → 模板，须复现 T1 手写模板） | T1 T2 | |
| T6 | 代码 | eval：run 循环 v0（阶段一二、宿主目录、随机交错、超时与取消、prompt 哈希、orchestrator ns、retry 策略） | T2 T4 | `dsh-eval run` |
| T7 | 代码 | eval：判官委派（去指纹、判官条件、双采样、verdict 解析入 llm-draft） | T6 | |
| T8 | 代码 | eval：`report`（results.jsonl、summary.md、四条不变量核对、配对差值、n 与置信区间、判官一致性、样本不足拒绝排名） | T6 | |
| T9 | 代码 | local-agent：四家模型回读，写入委派记录与进度事件 | T3 | |
| T10 | 代码 | datasets：金丝雀字段 + validate；`tools` 分组配置 | 无 | |
| T11 | 代码 | mission：`tools` 分组配置 | 无 | |
| T12 | 代码 | eval：只读工具 `eval_conditions` / `eval_plan_validate` / `eval_run_status` | T6 | |
| T13 | 运维 | pilot A：F2 + F3 × 四家 × 3 rep，阶段一二，每格独立 cwd；bundle + report；把结论与保留条款写成 methodology.md | T5–T11 | 第一份结论 |

验收：README I2 行的三条；report 开头四条不变量全部成立；判官一致性有数字。

进入 I3 的信号：pilot A 的结论写完；T13 的卡点清单变成 I3 任务。

### I3 · 容器化 + 阶段三四

目标：容器内一格全流程，release 经闸；四家在容器内跑通同一题。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T14 | 运维 | 验证题集级镜像构建；四家 Linux CLI 安装方式实测；本地包镜像与白名单代理；各家凭证可写卷；`versions.lock` 填实 | 无 | 镜像 digest、代理与镜像源的地址与快照标识 |
| T15 | 代码 | local-agent：决定「容器内 exec 包装」还是「CLI 驱动抽成独立包」，写 Agent Note 后实施其一 | T14 | |
| T16 | 代码 | lab：复合指纹 | 无 | |
| T17 | 数据 | F2 阶段三的 verify 探针脚本与 `verify/helpers/`，按 `dataseek.verdict/1` 输出 | 无 | |
| T18 | 代码 | eval：容器路径（acquire / populate / checkpoint / verify / archive 交 lab；销毁路径唯一） | T15 T16 | |
| T19 | profile | eval preset：不挂 Bash 与 docker | 无 | |
| T20 | 运维 | 容器内跑 F2 阶段三一格；再跑四家同一题 | T14–T19 | |

验收：README I3 行；lab `status` 表里四格 TASK 哈希一致；release 被闸拒绝过至少一次且容器仍在。

### I4 · 放宽因子

目标：同 harness 两条件的配对结果。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T21 | 代码 | local-agent：每次委派可覆盖 scoped home / 配置 | T3 | |
| T22 | 代码 | local-agent：每 provider 的模型参数（codex / claude / kimi / dsh） | T21 | |
| T23 | 代码 | eval：`conditions provision` + 条件注册表数据面 | T21 | |
| T24 | 代码 | capability-catalog：按 preset scope 的能力清单哈希 | 无 | |
| T25 | 运维 | pilot B：dsh × 两模型；pilot C：claude × 两模型；pilot D：同 harness 两 preset | T21–T24 | 三份配对结果 |

验收：README I4 行；report 的因子列由 condition diff 自动推出。

### I5 · agent 配实验 + 界面

目标：一句话 → 计划 → 批准 → 跑完 → 报告，人只做审批与终评。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T26 | 代码 | `eval-planning` skill：起草 condition 与 plan，跑 validate，向人提交 | T12 T23 | |
| T27 | 代码 | eval client 半：实验台 tab | T12 | |
| T28 | 代码 | eval client 半：计划审阅（批准是人的动作） | T26 | |
| T29 | 代码 | eval client 半：判官台（human-final 唯一入口） | T7 | |
| T30 | 代码 | eval client 半：报告视图（Pareto、配对表、导出走既有闸） | T8 | |
| T31 | 运维 | 端到端：一句话到报告，记录人介入的次数与位置 | T26–T30 | |

验收：README I5 行；人介入点只剩批准与终评两处。

### I6 · 外部评测集与开放

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T32 | 代码 | datasets：item 级外部源指针 | 无 | |
| T33 | 代码 + 数据 | SWE-bench 适配脚本（visible = problem + base_commit，verify = FAIL_TO_PASS / PASS_TO_PASS，grading = gold patch） | T32 | |
| T34 | 代码 + 数据 | Terminal-Bench 适配脚本 | T32 | |
| T35 | 数据 | train / dev / test 标签进协议与题集 | 无 | |
| T36 | 分发 | 镜像仓、agent 照 README 安装验证、npm 第二波 | 全部 | |

验收：README I6 行。

## 三、I1 指引文案

可直接转发给实施 agent。每段自包含。

### T1 · 手工走通一格（需要全权限会话）

```text
任务：在宿主上手工走通一格评测（P0-placeholder × dsh × 阶段一二），不进容器，目的是把操作手册里的每个 ❌ 变成脚本或明确步骤，并记录耗时与卡点。

先读：dsh-plugins 仓库的 AGENTS.md、docs/development.md、docs/ops.md（环境拓扑）、profiles/web-eval/README.md 与 profiles/web-eval/docs/architecture.md（尤其「轨迹」表）；题库仓库 ~/.dsh/scratch/dataseek-eval 的 README.md、docs/tooling-brief.md、datasets/harness-comparison/docs/operating-playbook.md 与 manifest.yml。

步骤：
0. 题库侧准备：写 templates/bench-v1.json（状态机形状见 README「理想流程」；进入 releasable 的转移带 file-check；stage 转移带 schema-check），把 manifest.yml 的 output_schema.stage1/stage2 转成 mission 支持的 JSON Schema 子集写到 schemas/stage1.json、stage2.json；跑 dsh-mission run lint 与 dsh-datasets validate 到零 error。阶段提示词放到题集级 visible 层 prompts/ 下并版本化。新建 conditions/ 与 plans/ 目录，各放一份手写示例。
1. 环境：按 ops.md 在 ~/.dsh-lab 下用 profiles/web-eval 模板建 web-eval profile，成员从源码 pnpm pack-dist 打 tarball 安装，独立端口起实例。禁止碰 3080。
2. 会话里 /datasets bind 题库（layers 只勾 visible），datasets_snapshot 钉 commit。
3. mission_run_create 用 bench-v1，meta 记 {datasetId, commit, expectedNs: [script, llm-draft, human-final]}，一个 mission，labels {task: P0-placeholder, condition: dsh-exec, rep: 1}。
4. 物化：datasets_worktree_path 取 visible 层，复制进每格独立的临时 cwd，用 shasum 记物化哈希。
5. 委派阶段一给 subagent_dsh（exec 驱动），prompt 必须是 prompts/stage1.md 加 task.md 的逐字节拼接，不允许改写；记 prompt 的 sha256。
6. 收 stage1.json / stage1.md，mission_submit，转移过 schema-check；阶段二用 resume 句柄续聊，同样处理。
7. 对照 P0 的 checks/ 手工判定，按 README 里 verdict.json 的形状写一条，mission_annotate 到 script ns。
8. judged → archived（把格子目录拷进该 attempt 的数据目录 archive/）→ releasable（file-check）→ released；dsh-mission export 到题库仓库 exports/。
9. 每步记墙钟耗时、人肉动作、缺口。把 operating-playbook.md 里每个 ❌ 换成脚本路径或明确的人工步骤；另写 docs/i1-walk-log.md 记时间线与卡点。

约束：不改任何插件代码，发现 bug 记进走通日志并回报协调者；凭证、token 不得出现在任何日志里；题库仓库改动正常 git commit，dsh-plugins 仓库不动。

完成判据：operating-playbook.md 里没有 ❌；exports/ 下有一个 bundle；i1-walk-log.md 存在且每步有耗时。回报：题库仓库的 commit、bundle 路径、你认为 plan.json 与 condition.json 还缺哪些字段。
```

### T2 · `packages/eval` 骨架 + 三份契约 + `dsh-eval validate`

```text
任务：新建插件 @khorsheed/dsh-eval（行 id eval，bin dsh-eval），本轮只做离线动词：validate 与 conditions hash，外加就绪检查（对既有的四个 scoped home）。不做 run 循环。

先读：AGENTS.md「Package conventions」、docs/development.md、profiles/web-eval/README.md「契约层的三份 schema」与 docs/architecture.md、docs/dataset-authoring-protocol.md、packages/lab（host-only 插件骨架的模板）、packages/mission/src/schema.ts（手写 JSON Schema 子集校验器，不引 ajv）、packages/datasets 的 validate 动词（CLI 形态先例）。

交付：
1. packages/eval 骨架：身份三角、dsh.bundle、dsh.compat、双语 README + README.i18n.yaml、tests。服务面 ctx.eval 提供 validatePlan / hashCondition / readiness；CLI dsh-eval validate <plan.json> 与 dsh-eval conditions hash <condition.json>；退出码 0/1/2 与 lab 一致。
2. 三份 schema 写进 docs/dataset-authoring-protocol.md 新章节（dataseek.condition/1、dataseek.plan/1、dataseek.verdict/1），字段以 README 的示例为起点，plan 里没有 template 字段（模板由 manifest 生成，I2）；协议里的每个 JSON 示例直接作为校验器测试夹具。
3. 哈希规则：条件哈希 = 规范化 JSON（键排序、无空白）的 sha256；home.sha 由 scoped home 目录内容算，必须有拒绝清单（auth.json、credentials/、oauth/、sessions、任何含 token/key 的文件），只哈希配置类文件，绝不读入或打印内容。写进协议。
4. 就绪检查：plan 里每个 condition 的 home.sha 与当前 scoped home 回算一致才算就绪，否则 validate 报「未就绪」并列出差异项。
5. 校验器把 schema 集中在一个模块，T1 的发现可能要改字段。

约束：不 import 任何 @khorsheed 包，不 inject；本轮不需要探测 datasets/mission/lab；mission/datasets/lab 一行不改。worktree 开发，分支 feat/eval-validate，显式路径 stage，不 push。带 Agent Note。

完成判据：README 里的 plan 示例经补全后 validate 通过；同一份 condition 两次 hash 相同；pnpm run build && pnpm run test 绿；pnpm check:plugins 零违规；pnpm gate 通过。回报：commit、Agent Note 路径、gate 输出。
```

### T3 · local-agent 评测 pin

```text
任务：让四个 provider 的公平性相关设置都是显式配置且可以从一处读出，供评测把它们写进条件哈希。不做模型参数（那是 I4）。

先读：AGENTS.md、profiles/web-eval/README.md「冻结决策」2 到 4、packages/local-agent 与四个 provider 包的 README、packages/local-agent-kimi/src/provision.ts（thinking.effort 写死 high）、packages/local-agent-codex/src/index.ts（sandbox 配置）、packages/local-agent-claude-code/src/index.ts（permissionMode、baseUrl）、packages/local-agent-dsh/src/index.ts（live）。

交付：
1. kimi：thinking 的 effort 变成 provider 配置项，默认值保持现状 high（不改行为），README 与 dsh.compat 说明。
2. 注册表新增只读方法 effectiveSettings(harnessName)，返回该 harness 当前生效的公平性相关设置的纯 JSON：drive（exec/live）、沙箱或权限模式、推理强度、baseUrl 是否设置（只给布尔或主机名）、CLI 版本（若已有探测则复用）。绝不包含凭证。四家各自在注册时提供自己的快照。
3. 现有 status 面（slash 的 status 与 Remote 的 LocalAgentStatus）附带这份快照，字段增量添加，不破坏现有客户端。

约束：不改任何 provider 的默认行为；家族内按既有 sanctioned 边改；worktree 开发，分支 feat/local-agent-eval-pins，显式 stage，不 push；Agent Note；双语 README 与 compat 同步。

完成判据：四家 effectiveSettings 各有单测；kimi effort 配置有单测；pnpm run build && pnpm run test 绿；pnpm check:plugins 零违规。回报：commit、Agent Note 路径、四家快照的一份示例输出（脱敏）。
```

### T4 · mission：retry 带原因 + ns 报告带 writtenBy

```text
任务：给 mission 加两个记录端与读取端的小改动，保持插件通用、不引入评测词汇。

先读：AGENTS.md、packages/mission/README.md、proposals/active/2026-08-19-mission-tasks.md、packages/mission/src/service.ts 的 retry、src/export.ts 的 ns 完整性报告、docs/roadmap.md「待决」里关于重复实验建模的条目。

交付：
1. retry 必须带 reason：一个自由文本 reason 加一个通用类别枚举（建议 infrastructure / operator / outcome，可自行命名但不得用评测词汇），记录在新 attempt 上并进 history；服务面、模型工具、CLI --reason 三面同语义；缺 reason 即用法错误。
2. ns 完整性报告（run status 与 export 的 manifest）每格每 ns 增加 writtenBy：该 ns 所有注解的 by 前缀集合（tool: / cli / service / slash:）。expectedNs 里某个 ns 的写入者全是 tool: 前缀时，报告如实标出，不做判断。
3. README 双语与 compat 同步；通用性 grep 仍然通过（源码不出现 stage/rubric/score/verdict/player/judgment/contestant）。

约束：不新增依赖；存储格式变更向后兼容（旧 run 文件无 reason 字段照常读）；worktree 开发，分支 feat/mission-retry-reason，显式 stage，不 push；Agent Note。

完成判据：retry 无 reason 被拒的测试；三面 reason 一致的测试；writtenBy 报告的测试含「仅 tool: 写入」的情形；旧格式 run 文件读取的回归测试；pnpm run build && pnpm run test 绿。回报：commit、Agent Note 路径。
```

I2 及以后的指引文案在前一迭代收口时再写：每个迭代的卡点会改写下一迭代的任务，提前写只会过期。

## 四、验收规程

实施 agent 回报四样：分支名与 commit、Agent Note 路径、`pnpm gate` 输出、一份脱敏的示例输出。协调者做的事：

1. 在独立 worktree 里 checkout 该分支，`git pull --rebase` 后跑 `pnpm gate`。
2. 对照任务段的「完成判据」逐条核，缺一条即打回，不做「差不多」。
3. 读 Agent Note 的 Alternatives considered：没有记录真实取舍的不收。
4. mission / lab / datasets 的改动额外跑通用性 grep（红线词表见各提案验收标准）。
5. 多个分支同时绿时，按文件不重叠原则任意顺序合入；有重叠先合改动小的。
6. 迭代收口只看 README「迭代计划」里该行的完成判据；达到后把本文对应迭代的任务表状态更新，再写下一迭代的指引文案。
