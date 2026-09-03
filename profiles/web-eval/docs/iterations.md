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
| submit 预校验按意向边（G1） | 服务面 + 工具 + CLI | ⬜ | I1 · T4 | 现对当前态全部出边合取，分支状态机无法提交 |
| file-check 目录项要求非空（G2） | guard | ⬜ | I1 · T4 | 现只查存在性，空目录放行 |
| CLI 数据根环境变量缺省（G4） | CLI | ⬜ | I1 · T4 | 实例 patch 的 dataDir 对 CLI 不可见 |

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
| headless 不被 `plugin install` 挂进宿主 bundles（G3） | 打包 | ⬜ | I1 · T6 | 全新 profile boot 报 duplicate code-runtime |
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
| 安装路径：未发布成员 tarball + overrides（G5、G6） | profile | ⬜ | I1 · T5 | T1 实测 npm 路径装不通 |
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
| 题集级镜像构建验证、digest 入指纹 | 题库 + lab | ⬜ | I3 · T16 | Dockerfile 已写未构建 |
| 四家 Linux CLI 安装方式与版本 pin | 题库 | ⬜ | I3 · T16 | `versions.lock` 的 TODO |
| 本地包镜像 | 运维 | ⬜ | I3 · T16 | 断外网仍能装依赖 |
| 白名单代理 | 运维 | ⬜ | I3 · T16 | 只放行模型端点 |
| 各家凭证可写卷 | 运维 | ⬜ | I3 · T16 | claude 续期回写是硬要求 |
| 资源限制进复合指纹 | lab | ⬜ | I3 · T18 | |
| docker socket 只归编排器 | profile | ⬜ | I3 · T21 | 冻结决策 12 |
| 归档排除清单与先归档后释放 | lab + eval | ⬜ | I3 · T20 | |

## 二、逐迭代

每个迭代：目标、任务（编号全局递增）、验收、进入下一迭代的信号。任务类型：**代码**（隔离会话即可）、**运维**（需要全权限会话，真机跑）、**数据**（改题库仓库）。

### I1 · 走通一格 + 三份契约

目标：手工把一格跑通，把操作手册里的 ❌ 全部换成脚本或明确步骤；同时定死 condition / plan / verdict 的形状。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T1 ✅ | 运维 + 数据 | P0 × dsh × 阶段一二手工走通；bench 模板、stage schema、`prompts/`；操作手册更新；走通日志 | 无 | 题库 `i1-walk` @ `3173651`、`exports/i1-walk-bundle/`、`docs/i1-walk-log.md` |
| T2 | 代码 | `packages/eval` 骨架；三份 schema 进协议；`validate` 与 `conditions hash`；哈希规则含拒绝清单 | 无 | 分支 `feat/eval-validate` |
| T3 | 代码 | local-agent：kimi effort 可配；`effectiveSettings`；status 面附带快照 | 无 | 分支 `feat/local-agent-eval-pins` |
| T4 | 代码 | mission：`retry` reason + 类别；ns 报告 `writtenBy`；G1 submit 按意向边；G2 目录非空；G4 数据根环境变量 | T1 | 分支 `feat/mission-retry-reason` |
| T5 | 代码 | web-eval 安装路径：未发布成员 tarball + overrides，install.sh 源码模式（G5、G6） | T1 | 分支 `feat/web-eval-install` |
| T6 | 代码 | local-agent-dsh-headless 不被 reconcile 挂进宿主 bundles（G3） | T1 | 分支 `fix/local-agent-dsh-headless-reconcile` |

**I1 走通结果（2026-09-03，T1 验收通过）**：一格全流程在宿主上手工走通，两次委派的 prompt 与参考拼接逐字节一致（冻结决策 6 在现有机制上成立），反例在 submit 预校验即被拒，file-check 拒绝过一次后放行，bundle 导出且 ns 报告如实标出缺失的 llm-draft 与 human-final。合计约 5 小时，其中环境搭建与调试约 2.5 小时、纯评测流约 1.5 小时。发现的缺口按严重度：G1 mission submit 对全部出边合取校验（已绕行，T4 修）；G2 file-check 空目录放行（T4）；G3 headless 被 reconcile 挂进宿主（T6）；G4 CLI 与实例数据根割裂（T4 顺带）；G5、G6 模板成员 npm 状态与 overrides（T5）；G7 到 G10 体验项记入走通日志不单独立任务。契约侧填不出的字段与词表问题已写成 T2 的「字段决定」。

T2 到 T6 五个任务互不依赖，可并行；T2 用题库 i1-walk 的两份示例作夹具。

验收：README「迭代计划」I1 行的三条已达成；T2 到 T6 各自的完成判据；`pnpm gate` 全绿。

进入 I2 的信号：五条分支合入 main；T4 修好后题库的 bench-v1 模板把 halted 边的 guard 带回并重跑 lint。

### I2 · 编排器 v0 + pilot A

目标：一格全自动跑完；F2 + F3 × 四家 × 3 rep 出第一份带保留条款的结论。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T7 | 代码 | eval：`generateTemplate`（manifest → 模板，须复现 T1 手写模板） | T1 T2 | |
| T8 | 代码 | eval：run 循环 v0（阶段一二、宿主目录、随机交错、超时与取消、prompt 哈希、orchestrator ns、retry 策略） | T2 T4 | `dsh-eval run` |
| T9 | 代码 | eval：判官委派（去指纹、判官条件、双采样、verdict 解析入 llm-draft） | T8 | |
| T10 | 代码 | eval：`report`（results.jsonl、summary.md、四条不变量核对、配对差值、n 与置信区间、判官一致性、样本不足拒绝排名） | T8 | |
| T11 | 代码 | local-agent：四家模型回读，写入委派记录与进度事件 | T3 | |
| T12 | 代码 | datasets：金丝雀字段 + validate；`tools` 分组配置 | 无 | |
| T13 | 代码 | mission：`tools` 分组配置 | 无 | |
| T14 | 代码 | eval：只读工具 `eval_conditions` / `eval_plan_validate` / `eval_run_status` | T8 | |
| T15 | 运维 | pilot A：F2 + F3 × 四家 × 3 rep，阶段一二，每格独立 cwd；bundle + report；把结论与保留条款写成 methodology.md | T7–T13 | 第一份结论 |

验收：README I2 行的三条；report 开头四条不变量全部成立；判官一致性有数字。

进入 I3 的信号：pilot A 的结论写完；T15 的卡点清单变成 I3 任务。

### I3 · 容器化 + 阶段三四

目标：容器内一格全流程，release 经闸；四家在容器内跑通同一题。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T16 | 运维 | 验证题集级镜像构建；四家 Linux CLI 安装方式实测；本地包镜像与白名单代理；各家凭证可写卷；`versions.lock` 填实 | 无 | 镜像 digest、代理与镜像源的地址与快照标识 |
| T17 | 代码 | local-agent：决定「容器内 exec 包装」还是「CLI 驱动抽成独立包」，写 Agent Note 后实施其一 | T16 | |
| T18 | 代码 | lab：复合指纹 | 无 | |
| T19 | 数据 | F2 阶段三的 verify 探针脚本与 `verify/helpers/`，按 `dataseek.verdict/1` 输出 | 无 | |
| T20 | 代码 | eval：容器路径（acquire / populate / checkpoint / verify / archive 交 lab；销毁路径唯一） | T17 T18 | |
| T21 | profile | eval preset：不挂 Bash 与 docker | 无 | |
| T22 | 运维 | 容器内跑 F2 阶段三一格；再跑四家同一题 | T16–T21 | |

验收：README I3 行；lab `status` 表里四格 TASK 哈希一致；release 被闸拒绝过至少一次且容器仍在。

### I4 · 放宽因子

目标：同 harness 两条件的配对结果。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T23 | 代码 | local-agent：每次委派可覆盖 scoped home / 配置 | T3 | |
| T24 | 代码 | local-agent：每 provider 的模型参数（codex / claude / kimi / dsh） | T23 | |
| T25 | 代码 | eval：`conditions provision` + 条件注册表数据面 | T23 | |
| T26 | 代码 | capability-catalog：按 preset scope 的能力清单哈希 | 无 | |
| T27 | 运维 | pilot B：dsh × 两模型；pilot C：claude × 两模型；pilot D：同 harness 两 preset | T23–T26 | 三份配对结果 |

验收：README I4 行；report 的因子列由 condition diff 自动推出。

### I5 · agent 配实验 + 界面

目标：一句话 → 计划 → 批准 → 跑完 → 报告，人只做审批与终评。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T28 | 代码 | `eval-planning` skill：起草 condition 与 plan，跑 validate，向人提交 | T14 T25 | |
| T29 | 代码 | eval client 半：实验台 tab | T14 | |
| T30 | 代码 | eval client 半：计划审阅（批准是人的动作） | T28 | |
| T31 | 代码 | eval client 半：判官台（human-final 唯一入口） | T9 | |
| T32 | 代码 | eval client 半：报告视图（Pareto、配对表、导出走既有闸） | T10 | |
| T33 | 运维 | 端到端：一句话到报告，记录人介入的次数与位置 | T28–T32 | |

验收：README I5 行；人介入点只剩批准与终评两处。

### I6 · 外部评测集与开放

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T34 | 代码 | datasets：item 级外部源指针 | 无 | |
| T35 | 代码 + 数据 | SWE-bench 适配脚本（visible = problem + base_commit，verify = FAIL_TO_PASS / PASS_TO_PASS，grading = gold patch） | T34 | |
| T36 | 代码 + 数据 | Terminal-Bench 适配脚本 | T34 | |
| T37 | 数据 | train / dev / test 标签进协议与题集 | 无 | |
| T38 | 分发 | 镜像仓、agent 照 README 安装验证、npm 第二波 | 全部 | |

验收：README I6 行。

## 三、指引文案

可直接转发给实施 agent。每段自包含，含分支与 worktree 要求。T1 已完成（2026-09-03，题库仓库 `i1-walk` @ `3173651`），其文案保留作记录。

### T1 · 手工走通一格（已完成）

原文见 git 历史（`profiles/web-eval/docs/iterations.md` 在 `a1581e4`），走通结果见本文第二节 I1 小节。

### T2 · `packages/eval` 骨架 + 三份契约定稿 + `dsh-eval validate`

```text
# 任务 T2：新建插件 @khorsheed/dsh-eval（离线动词）+ 三份契约定稿

## 背景
评测 profile web-eval 需要一个编排器包，本轮只做离线部分：契约 schema、校验器、条件哈希、就绪检查。T1 已手工走通一格，它手写的契约示例在题库仓库 ~/.dsh/scratch/dataseek-eval 的 i1-walk 分支：datasets/harness-comparison/conditions/dsh-exec.json、plans/i1-walk.json、templates/bench-v1.json、schemas/*.json。你的 schema 必须让这两份示例通过，或明确说明为什么改字段。

## 先读
AGENTS.md「Package conventions」、docs/development.md、profiles/web-eval/README.md「契约层的三份 schema」「工具按域开放」、profiles/web-eval/docs/architecture.md、docs/dataset-authoring-protocol.md、packages/lab（host-only 骨架模板）、packages/mission/src/schema.ts（手写 JSON Schema 子集校验器，不引 ajv）、packages/datasets 的 validate 动词；题库仓库 i1-walk 分支的上述文件与 docs/i1-walk-log.md 里「契约」相关段落。

## 分支
dsh-plugins：从 main 开 worktree ../dsh-plugins-wt-eval-validate，分支 feat/eval-validate。显式路径 stage，不 push。题库仓库只读。

## T1 已定下的字段决定（照此实现）
1. condition 的 harness.version、model.declared、model.endpoint、home.sha 允许为 null；validate 把它们列为「未解析」而不是 error，run 前的就绪检查才拦。
2. permissions 用协议给定词表：dsh 为 unrestricted；claude 为 skip 或 normal；codex 为 danger-full-access、workspace-write 或 read-only；kimi 为 auto-approve。validate 检查值在词表内。
3. plan.conditions 写 condition 的 id，不写 sha；sha 从 conditions/<id>.lock.json 解析，缺 lock 即「未就绪」。run.meta 记录解析后的 sha。
4. plan.judge 可缺省；缺省时 expectedNs 不得含 llm-draft（validate 交叉检查）。
5. plan 不含 template 字段，模板由 manifest 生成（I2）。
6. 契约文件在题库里的位置是题集级透传区 templates/、schemas/、conditions/、plans/，写进协议；datasets validate 对它们报 UNREGISTERED_FILES 属预期，协议注明。
7. 阶段的 structured schema 以 schemas/<stage>.json 为权威（JSON Schema 子集），manifest 的 output_schema 改为引用文件名，不再自创 type: enum 与 markdown 记法；协议写明，题库侧的改动由后续任务做，你只定协议。

## 交付
1. packages/eval 骨架：身份三角（cordis.patch.yml 引号 name、src/invariant.ts 的 PACKAGE_NAME）、dsh.bundle、dsh.compat、双语 README + README.i18n.yaml、tests。无 client 半。
2. 服务面 ctx.eval：validatePlan(planPath)、hashCondition(conditionPath)、readiness(planPath)；CLI dsh-eval validate <plan.json> 与 dsh-eval conditions hash <condition.json>；退出码 0/1/2 与 lab 一致；数据走 stdout JSON，诊断走 stderr。
3. 三份 schema 进 docs/dataset-authoring-protocol.md 新章节（dataseek.condition/1、dataseek.plan/1、dataseek.verdict/1）；协议里的每个 JSON 示例直接作为校验器夹具；T1 的两份示例经补全后也进夹具。
4. 哈希规则写进协议：条件哈希 = 规范化 JSON（键排序、无空白）的 sha256；home.sha 由 scoped home 目录内容算，拒绝清单（auth.json、credentials/、oauth/、sessions、任何含 token 或 key 的文件），只哈希配置类文件，绝不读入或打印内容。
5. 同步更新 profiles/web-eval/README.md 与 README.en.md 里的三份示例（对应上面第 1 到 5 条），重记 README.i18n.yaml。
6. schema 集中在一个模块。

## 约束
不 import 任何 @khorsheed 包，不 inject；不改 mission、datasets、lab；带 Agent Note（proposed 或 implemented/feature）。

## 完成判据
题库 i1-walk 的 plans/i1-walk.json 与 conditions/dsh-exec.json 经 validate 通过，未解析字段以 warning 列出；同一 condition 两次 hash 相同；pnpm run build && pnpm run test 绿；pnpm check:plugins 零违规；pnpm gate 通过。

## 回报
commit、worktree 路径、Agent Note 路径、gate 输出、validate 对 i1-walk 两份示例的实际输出。
```

### T3 · local-agent 评测 pin

```text
# 任务 T3：local-agent 评测 pin，把公平性相关的旋钮全部显式化并可读回

## 背景
评测要把每个 harness 当前生效的设置写进条件哈希，现状是各 provider 的设置散在各自配置里，kimi 的推理强度还写死在 provision 里。不做模型参数，那是 I4。

## 先读
AGENTS.md、profiles/web-eval/README.md「冻结决策」2 到 4、packages/local-agent 与四个 provider 包的 README、packages/local-agent-kimi/src/provision.ts（thinking.effort 写死 high）、packages/local-agent-codex/src/index.ts（sandbox 配置）、packages/local-agent-claude-code/src/index.ts（permissionMode、baseUrl）、packages/local-agent-dsh/src/index.ts（live）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-local-agent-eval-pins，分支 feat/local-agent-eval-pins。显式 stage，不 push。

## 交付
1. kimi：thinking 的 effort 变成 provider 配置项，默认值保持现状 high，不改行为；README 与 dsh.compat 说明。
2. 注册表新增只读方法 effectiveSettings(harnessName)，返回该 harness 当前生效的公平性相关设置的纯 JSON：drive（exec 或 live）、沙箱或权限模式、推理强度、baseUrl 是否设置（只给布尔或主机名）、CLI 版本（若已有探测则复用）。绝不包含凭证。四家各自在注册时提供自己的快照。
3. 现有 status 面（slash 的 status 与 Remote 的 LocalAgentStatus）附带这份快照，字段增量添加，不破坏现有客户端。

## 约束
不改任何 provider 的默认行为；家族内按既有 sanctioned 边改；Agent Note；双语 README 与 compat 同步。

## 完成判据
四家 effectiveSettings 各有单测；kimi effort 配置有单测；pnpm run build && pnpm run test 绿；pnpm check:plugins 零违规；pnpm gate 通过。

## 回报
commit、worktree 路径、Agent Note 路径、四家快照的一份示例输出（脱敏）。
```

### T4 · mission 四项：retry 原因、writtenBy、G1 submit 预校验、G2 file-check 非空

```text
# 任务 T4：mission 四项改动（retry 原因、writtenBy、G1 submit 预校验、G2 file-check 非空）

## 背景
T1 手工走通一格时确认了 mission 的两个机制缺口，记录在题库仓库 ~/.dsh/scratch/dataseek-eval 的 i1-walk 分支 docs/i1-walk-log.md 的 G1、G2；加上评测线原本要的两项，四项都在 mission 包内，一起做。

## 先读
AGENTS.md、packages/mission/README.md、proposals/active/2026-08-19-mission-tasks.md、packages/mission/src/service.ts（submit 的预校验循环约在 462 到 476 行；file-check 约在 365 到 376 行；retry 在 538 行起）、src/export.ts 的 ns 完整性报告、src/cli-core.ts；题库仓库 i1-walk 分支的 docs/i1-walk-log.md 与 datasets/harness-comparison/templates/bench-v1.json（G1 的绕行是把 stage-2 到 halted 这条边的 guard 去掉，你修好后这条边要能带回 guard）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-mission-retry-reason，分支 feat/mission-retry-reason。显式 stage，不 push。

## 交付
1. G1：submit 的预校验现在对当前状态所有出边的 schema-check（inputFrom 为 submission）做合取，分支互斥的状态机（judged 与 halted）永远提交不了合法 payload。改为：submit 增加可选的意向转移参数 to；给了 to 只按那条边校验；没给 to 时，若当前状态只有一条 schema-check 出边照旧，多条则要求 to，用法错误的报错文本列出候选边。transition 时的 guard 校验不变，作为兜底。服务面、工具、CLI --to 三面同语义。
2. G2：file-check 的 expectedFiles 以 / 结尾的目录项要求非空，至少一个常规文件，递归；错误文本区分「缺失」与「为空」。
3. retry 必须带 reason：自由文本 reason 加通用类别枚举（建议 infrastructure、operator、outcome，不得用评测词汇），记录在新 attempt 上并进 history；服务面、工具、CLI 的 --reason 与 --category 三面同语义；缺 reason 即用法错误。
4. ns 完整性报告（run status 与 export manifest）每格每 ns 增加 writtenBy：该 ns 所有注解 by 的前缀集合（tool: 、cli、service、slash:）；expectedNs 里某 ns 的写入者全是 tool: 时如实标出，不做判断。
5. G4 顺带：CLI 的数据根支持环境变量 DSH_MISSION_DATA_DIR 作为 --data-dir 的缺省，优先级为 --data-dir、环境变量、$DSH_HOME/state/mission、cwd；README 写明实例 patch 的 dataDir 对 CLI 不可见，CLI 与实例共用数据根要显式指定。
6. README 双语与 compat 同步；通用性 grep 通过（源码不出现 stage、rubric、score、verdict、player、judgment、contestant）。

## 约束
不新增依赖；存储格式向后兼容（旧 run 文件无 reason 照常读）；Agent Note。

## 完成判据
G1：用 i1-walk 的 bench-v1 模板（halted 边恢复 guard）建 run，feasible 为 true 的 payload 带 to=judged 可提交、不带 to 报错并列出两条候选边、feasible 为 false 带 to=halted 可提交，各有测试。G2：空目录被拒的测试。retry 无 reason 被拒与三面一致的测试。writtenBy 含「仅 tool: 写入」情形的测试。旧格式回归测试。pnpm run build && pnpm run test 绿；pnpm gate 通过。

## 回报
commit、worktree 路径、Agent Note 路径、gate 输出。
```

### T5 · web-eval 的安装路径可用（G5、G6）

```text
# 任务 T5：web-eval 的安装路径可用（G5、G6）

## 背景
T1 按 profiles/web-eval 模板装 profile 时发现两处问题，记录在题库仓库 ~/.dsh/scratch/dataseek-eval 的 i1-walk 分支 docs/i1-walk-log.md 的 G5、G6：package.json 里 capability-catalog、inline-html-render、local-files 三个成员标着 npm 范围但实际未发布；未发布成员从 tarball 装时传递依赖走 registry 404，需要 pnpm overrides，deploy-3080 已有同款模式。web-dev 模板同样有此问题，本任务只改 web-eval。

## 先读
AGENTS.md、docs/development.md、docs/ops.md、docs/publishing.md、scripts/deploy-3080.mts 里 overrides 的写法、scripts/pack-dist.ts 的 --family 用法、profiles/web-eval/README.md「安装」、profiles/web-basic 与 web-dev 的 install.sh；题库仓库 i1-walk 的 docs/i1-walk-log.md 第 1 步的记录。

## 分支
从 main 开 worktree ../dsh-plugins-wt-web-eval-install，分支 feat/web-eval-install。只改 profiles/web-eval/ 下的文件；根目录 scripts/ 是共享层归 mainline，不碰。显式 stage，不 push。

## 交付
1. profiles/web-eval/package.json：未发布成员的处理方式与 README 一致，要么 file: tarball 占位并注明，要么保留 npm 范围但 install.sh 在源码模式下改写。选一种，Agent Note 说明取舍。
2. profiles/web-eval/scripts/install.sh 增加「源码模式」：给定 dsh-plugins 检出路径时，build、按 --family 打全部未发布成员的 tarball、写入 overrides、再 dsh plugin --profile web-eval install；npm 模式行为不变。
3. README 双语「安装」节改写为两条路径，重记 sidecar。
4. 用 mktemp 的 DSH_HOME 从零装一遍，不碰 3080，不碰 ~/.dsh-lab 的现有 profile；--dump-config 里 @khorsheed 成员 22 行。

## 完成判据
一次性 DSH_HOME 全新安装一次通过，行数正确；若撞上 G3 的 headless 重复行，记录并等 T6，不要在本任务里绕。pnpm gate 通过。

## 回报
commit、worktree 路径、Agent Note 路径、--dump-config 的成员行清单。
```

### T6 · headless 被 plugin install 挂进宿主 bundles（G3）

```text
# 任务 T6：dsh-local-agent-dsh-headless 被 plugin install 挂进宿主 bundles（G3）

## 背景
T1 在全新 profile 上 dsh plugin install 后 boot 失败，报 duplicate code-runtime。原因是 @khorsheed/dsh-local-agent-dsh-headless 声明了 dsh.bundle，宿主的 reconcile 把它当成可挂载插件追加进 bundles，而它其实是给子 dsh 的 headless profile 用的组合，与 web-app 的行重复。prod 3080 的做法是「装作依赖、不挂 bundles 行」，靠人手删。记录在题库仓库 ~/.dsh/scratch/dataseek-eval 的 i1-walk 分支 docs/i1-walk-log.md 的 G3。

## 先读
AGENTS.md、docs/development.md、packages/local-agent-dsh/README.md、packages/local-agent-dsh/cordis.patch.yml、packages/local-agent-dsh-headless/package.json 与 cordis.patch.yml、packages/local-agent-dsh/src/provision.ts（headlessBundleDir 如何解析 headless 包）、~/code/deepseek-harness 里 reconcilePlugins 的实现（只读，apps/cli/src/plugin.ts）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-headless-reconcile，分支 fix/local-agent-dsh-headless-reconcile。显式 stage，不 push。

## 交付
1. 先定根因：headless 是否应该成为 profile 的直接依赖；它的 dsh.bundle 声明是否应该存在（provision 是按路径读 patch 还是按 dsh.bundle 字段）。写进 Agent Note。
2. 按根因修其一：headless 不再声明 dsh.bundle 并让 provision 按已知文件名读 patch；或 local-agent-dsh 以 workspace 依赖携带 headless，使其不成为 profile 直接依赖；或两者。不改 harness。
3. 验证：一次性 DSH_HOME 里 dsh plugin add local-agent-dsh 的 tarball 后 --dump-config 无 headless 行、boot 成功、dsh 家的委派仍能 provision 出子 profile 并跑一轮（可照 T1 走通日志的做法）。
4. README 与 compat 同步；pnpm check:plugins 零违规。

## 完成判据
全新 profile 装 local-agent-dsh 后 boot 无 duplicate 行；子 dsh 委派一轮成功；pnpm gate 通过。

## 回报
commit、worktree 路径、Agent Note 路径、根因结论一句话、gate 输出。
```

I2 及以后的指引文案在 I1 收口时再写：每个迭代的卡点会改写下一迭代的任务，提前写只会过期。

## 四、验收规程

实施 agent 回报四样：分支名与 commit、Agent Note 路径、`pnpm gate` 输出、一份脱敏的示例输出。协调者做的事：

1. 在独立 worktree 里 checkout 该分支，`git pull --rebase` 后跑 `pnpm gate`。
2. 对照任务段的「完成判据」逐条核，缺一条即打回，不做「差不多」。
3. 读 Agent Note 的 Alternatives considered：没有记录真实取舍的不收。
4. mission / lab / datasets 的改动额外跑通用性 grep（红线词表见各提案验收标准）。
5. 多个分支同时绿时，按文件不重叠原则任意顺序合入；有重叠先合改动小的。
6. 迭代收口只看 README「迭代计划」里该行的完成判据；达到后把本文对应迭代的任务表状态更新，再写下一迭代的指引文案。
