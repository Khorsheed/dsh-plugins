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
| 工具分组配置 `tools: all / read / authoring / none` | 配置 | ✅ | I2 · T12 | preset 挑不掉 profile 层工具，只能由插件按组注册；eval 域建议 authoring |
| `dsh-datasets` 全动词 + `bind` | CLI | ✅ | — | |
| datasets tab（绑定条、层树、预览） | UI | ✅ | — | |
| 金丝雀字段 + `validate` 检查 visible 层每个文件 | 协议 + 校验 | ✅ | I2 · T12 | 协议 v1-rev3；CANARY_MISSING 逐文件报，未声明不查 |
| item 级外部源指针（repo + commit + path） | 协议 + 服务面 | ⬜ | I6 | 外部评测集不把仓库塞进 git |

### mission

| 能力项 | 层 | 现状 | 落地 | 说明 |
|---|---|---|---|---|
| runCreate / lint / transition / submit / annotate / attest / retry / setRefs / addArtifact / addCheckpoint / isReleasable / get / runStatus | 服务面 | ✅ | — | 编排器的账本 |
| `retry` 必须带 reason 与通用类别 | 服务面 + 工具 + CLI | ✅ | I1 · T4 | 报告分开计数基础设施失败与结果失败 |
| ns 完整性报告带 `writtenBy` | 导出 | ✅ | I1 · T4 | `human-final` 若由 `tool:` 写入，报告标出 |
| 12 个 `mission_*` 工具 | 工具 | ✅ | — | eval 域只开 4 个读工具 |
| 工具分组配置 `tools: all / read / none` | 配置 | ✅ | I2 · T13 | read = run_list / run_status / list / get；is_releasable 留在 all |
| `dsh-mission` 全动词，`export` 带 TTY 泄题闸 | CLI | ✅ | — | |
| missions tab（队列、详情、重跑、释放检查、导出对话框） | UI | ✅ | — | 格子详情大半靠它 |
| run.meta 承载 planSha / evalVersion / snapshot | 数据 | ✅ | — | meta 不透明，无需改 |
| schema-check `inputFrom: run-meta` 钉快照 | guard | ✅ | — | 生成的模板在最早转移上用它 |
| submit 预校验按意向边（G1） | 服务面 + 工具 + CLI | ✅ | I1 · T4 | 现对当前态全部出边合取，分支状态机无法提交 |
| file-check 目录项要求非空（G2） | guard | ✅ | I1 · T4 | 现只查存在性，空目录放行 |
| CLI 数据根环境变量缺省（G4） | CLI | ✅ | I1 · T4 | 实例 patch 的 dataDir 对 CLI 不可见 |

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
| kimi 推理强度可配 | 配置 | ✅ | I1 · T3 | 冻结决策 4；默认仍为 high |
| `effectiveSettings(harness)` 只读快照 | 服务面 + status | ✅ | I1 · T3 | condition 的取证来源，不含凭证 |
| 已配置模型进 effectiveSettings 快照 | 服务面 + status | ✅ | I1 · T3b | condition.model.declared 的就绪比对来源；只读不选 |
| headless 不被 `plugin install` 挂进宿主 bundles（G3） | 打包 | ✅ | I1 · T6 | headless 撤 dsh.bundle 声明，provision 按文件名读 patch |
| 模型回读：从四家输出流记录实际模型 | 服务面 + 记录 | ✅ | I2 · T11 | 冻结决策 5 的后半；写入委派记录与 settled 事件 |
| 委派 cwd 选项（每格独立目录落到子代理） | 服务面 | ✅ | I2 · T11 | resume 时 cwd 与首轮不一致 fail loud |
| 容器内 exec 包装，或 CLI 驱动抽成独立包 | 架构 | ⬜ | I3 | 二选一，I3 开头决定 |
| 每次委派可覆盖 scoped home / 配置（每条件一个 home） | 服务面 | ⬜ | I4 | 同 harness 多条件的前提 |
| 每 provider 的模型参数：首轮委派指定、成员内固定、resume 不换；provider 设置卡「默认模型」 | 服务面 + 工具 + UI | ⬜ | I4 · T24 | 冻结决策 5 的前半；dev 域直接受益；候选不硬编码目录 |
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
| 包骨架、`validatePlan`、`hashCondition`、就绪检查（对既有 home） | 服务面 | ✅ | I1 · T2 | 三份 schema 同步进协议 |
| `dsh-eval validate` / `conditions hash` | CLI | ✅ | I1 · T2 | |
| `generateTemplate`：题集 manifest → run 模板 | 服务面 | ✅ | I2 · T8 | 与 bench-v1 等价测试钉住 |
| run 循环 v0：阶段一二，宿主目录代替容器 | 服务面 + CLI | ✅ | I2 · T8 | 服务键 `dshEval`；`/eval run` 为人的发起，CLI 只 dry-run |
| 判官委派：去指纹 + 判官条件 + verdict 解析 | 服务面 | ✅ | I2 · T9 | 协议 §6.7 探针契约、§6.8 判官契约；--finalize 过闸 |
| `dsh-eval report`：results.jsonl + summary.md | CLI | ✅ | I2 · T10 | 四条不变量核对在开头；i1-walk bundle 输出「不可比较」事实表 |
| 只读工具 `eval_conditions` / `eval_plan_validate` / `eval_run_status` | 工具 | ⬜ | I2 | 不开 run |
| 容器路径：acquire / populate / checkpoint / verify / archive 交 lab | 服务面 | ⬜ | I3 | |
| `conditions provision`：创建每条件 home 并回算哈希 | CLI + 服务面 | ⬜ | I4 | 依赖 local-agent 的 home 覆盖 |
| 条件注册表数据面（Remote）：模型等因子只展示、可 diff，不给选 | UI 数据 | ⬜ | I4 · T25 | 选模型即新建 condition，走 provision 与批准 |
| `eval-planning` skill | 引导 | ⬜ | I5 | |
| 实验台 / 计划审阅 / 判官台 / 报告视图 | UI | ⬜ | I5 | client 半 |
| 外部评测集适配脚本 | 脚本 | ⬜ | I6 | |

### profile 与题库

| 能力项 | 层 | 现状 | 落地 | 说明 |
|---|---|---|---|---|
| 目录、脚本、README、CHANGELOG | profile | ✅ | I0 | |
| 评测 pin 进 pack 自带 patch 层还是用户层 | profile | ⬜ | I1 决定 | |
| 安装路径：未发布成员 tarball + overrides（G5、G6） | profile | ✅ | I1 · T5 | `install.sh --source <checkout>`；npm 模式字节不变 |
| eval preset：不挂 Bash 与 docker | profile | ⬜ | I3 | 冻结决策 12，容器出现时才有意义 |
| 独立 `$DSH_HOME` 的评测实例 | 运维 | ✅ | — | `docs/ops.md` 已有规程 |
| 镜像仓 + agent 照 README 安装验证 | 分发 | ⬜ | I6 | |
| 题库：P0 / F2 / F3 三层内容 | 数据 | ✅ | — | 私有仓库 |
| 题库：bench 模板、stage schema JSON、题集级 `prompts/`；manifest 引用 schema 文件 | 数据 | ✅ | I1 · T1、T1b | |
| 题库：`conditions/` 与 `plans/` 目录 | 数据 | ✅ | I1 · T1 | lock 文件待 I4 provision |
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
| T2 ✅ | 代码 | `packages/eval` 骨架；三份 schema 进协议；`validate` 与 `conditions hash`；哈希规则含拒绝清单 | 无 | 合入 main `094a46b`；越界的 ankh-guard 测试提交剥离到分支 `test/ankh-guard-supervise-load` 待 owner 评审 |
| T3 ✅ | 代码 | local-agent：kimi effort 可配；`effectiveSettings`；status 面附带快照 | 无 | 合入 main `85c485a`；一次打回（测试读宿主 env），补丁 `fafe35f` |
| T4 ✅ | 代码 | mission：`retry` reason + 类别；ns 报告 `writtenBy`；G1 submit 按意向边；G2 目录非空；G4 数据根环境变量 | T1 | 合入 main `e0ad2fb` |
| T5 ✅ | 代码 | web-eval 安装路径：未发布成员 tarball + overrides，install.sh 源码模式（G5、G6） | T1 | 合入 main `de90120`；全新 DSH_HOME 端到端 22 成员 |
| T6 ✅ | 代码 | local-agent-dsh-headless 不被 reconcile 挂进宿主 bundles（G3） | T1 | 合入 main `6a67517`；根因是 headless 的 dsh.bundle 声明，已撤 |
| T1b ✅ | 数据 | 题库：bench-v1 带回 halted guard 并 lint；manifest output_schema 改引用 schemas 文件；用合入后的 mission 重放 submit --to | T2 T4 | 题库 `i1-walk` @ `954b7af` |
| T3b ✅ | 代码 | local-agent：effectiveSettings 带已配置模型（只读，不加选择） | T3 | 合入 main `47972ba` |

**I1 走通结果（2026-09-03，T1 验收通过）**：一格全流程在宿主上手工走通，两次委派的 prompt 与参考拼接逐字节一致（冻结决策 6 在现有机制上成立），反例在 submit 预校验即被拒，file-check 拒绝过一次后放行，bundle 导出且 ns 报告如实标出缺失的 llm-draft 与 human-final。合计约 5 小时，其中环境搭建与调试约 2.5 小时、纯评测流约 1.5 小时。发现的缺口按严重度：G1 mission submit 对全部出边合取校验（已绕行，T4 修）；G2 file-check 空目录放行（T4）；G3 headless 被 reconcile 挂进宿主（T6）；G4 CLI 与实例数据根割裂（T4 顺带）；G5、G6 模板成员 npm 状态与 overrides（T5）；G7 到 G10 体验项记入走通日志不单独立任务。契约侧填不出的字段与词表问题已写成 T2 的「字段决定」。

T2 到 T6 五个任务互不依赖，可并行；T2 用题库 i1-walk 的两份示例作夹具。

**验收记录（2026-09-05）**：T4、T2、T3 依次合入 main（`e0ad2fb`、`094a46b`、`85c485a`），三个 worktree 的测试都在验收机上重跑过。T2 携带的 ankh-guard 测试加固提交越界，剥离到 `test/ankh-guard-supervise-load` 等 owner 评审；datasets 协议夹具的提取范围限定是 §6 加入后的必然后果，接受。T3 有一处测试读宿主的 `ANTHROPIC_BASE_URL`，打回后以 `fafe35f` 补丁合入。T1b 已把 halted guard 带回、完成 manifest 迁移并用新 mission 重放了 submit --to。T5、T6、T3b 于 2026-09-05 合入（`de90120`、`6a67517`、`47972ba`），三个 worktree 的测试与独立性检查都在验收机上重跑过。**I1 收口。**

验收：README「迭代计划」I1 行的三条已达成；T2 到 T6 与 T3b 各自的完成判据；`pnpm gate` 全绿（ankh-guard 的偶发 flake 由其 owner 处理，不计入本线）。

进入 I2 的信号：已达成（2026-09-05）。遗留给 owner 的一件事：`test/ankh-guard-supervise-load` 分支上的 ankh-guard 测试加固待其 owner 评审。

### I2 · 编排器 v0 + pilot A

目标：一格全自动跑完；F2 + F3 × 四家 × 3 rep 出第一份带保留条款的结论。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T7 ✅ | 代码 | eval：`generateTemplate`（manifest → 模板，须复现 T1 手写模板）。**并入 T8 的交付**，不单独派发 | T1 T2 | 随 T8 合入 |
| T8 ✅ | 代码 | eval：模板生成 + run 循环 v0（阶段一二、宿主目录、随机交错、超时与取消、prompt 哈希、orchestrator ns、retry 策略；`/eval run` 为人的发起动作，CLI 只 dry-run） | T2 T4 T11 | `/eval run`、`dsh-eval run --dry-run`、`dsh-eval template`；合入 main `d65b17b`（服务键改为 dshEval；引入 js-yaml 解析 manifest；收尾见 T8b） |
| T8b ✅ | 代码 | eval 收尾：接 T11 回读填 usage 与 observed、cell 锚点注解、协议补 retry / exports、install.sh --fresh、真跑两格并让报告三条不变量成立 | T8 T10 T11 | 合入 main `9069b1b`；真跑两格三条不变量成立；修了报告按物化字节哈希的假阴性 |
| T9 ✅ | 代码 | eval：探针契约（script）+ 判官委派（去指纹、判官条件、双采样、verdict 入 llm-draft）+ --finalize 过闸 | T8b | 合入 main `0c75673`；协议补 §6.7 探针契约与 §6.8 判官契约；真跑判官双采样 κ 1.0 |
| T10 ✅ | 代码 | eval：`report`（results.jsonl、summary.md、四条不变量核对、配对差值、n 与置信区间、判官一致性、样本不足拒绝排名） | T8 | 合入 main `11b322f` |
| T11 ✅ | 代码 | local-agent：四家模型回读，写入委派记录与进度事件；门面 start / resume 的 cwd 选项（T8 的每格独立目录依赖它） | T3 | 合入 main `2f05c1b` |
| T12 ✅ | 代码 | datasets：金丝雀字段 + validate；`tools` 分组配置 | 无 | 合入 main `2ce8910` |
| T13 ✅ | 代码 | mission：`tools` 分组配置 | 无 | 合入 main `fbf90f6` |
| T14 | 代码 | eval：只读工具 `eval_conditions` / `eval_plan_validate` / `eval_run_status` | T8b | |
| T15 | 运维 | pilot A：step 0 把评测 pin 写进 web-eval 的 cordis.patch.yml 并决定该文件归 pack；F2 + F3 × 四家 × 3 rep，阶段一二，每格独立 cwd；bundle + report；把结论与保留条款写成 methodology.md | T8b T9 T14 | 第一份结论 |

**第一波验收（2026-09-06）**：T11（`2f05c1b`）、T10（`11b322f`）、T8（`d65b17b`）依次合入 main。T8 与 T10 在 `packages/eval` 的六处冲突全是「两边都加」，协调者按两边保留解决，合并后 eval 127 个测试全绿。T8 的真实一格 P0 × dsh 全自动到 archived，两轮 prompt 哈希与 I1 人肉走通逐字节相同，纯评测流 9.5 分钟对比 I1 的 1.5 小时。两个要记住的发现：服务键不能叫 `eval`（loader 的 !!js 用 with(ctx) 求值，同名属性遮蔽全局 eval，已改 `dshEval`）；profile 内 file: tarball 重打包后 pnpm 按 lockfile 复用旧解包，重装要清 node_modules。T12、T13 未回报。

**第二波验收（2026-09-07）**：T13（`fbf90f6`）、T12（`2ce8910`）、T8b（`9069b1b`）、T9（`0c75673`）依次合入 main。T8b 与 T9 在 `packages/eval` 的六处冲突全是两边各加一段，协调者按两边保留解决；合并后唯一挂掉的用例是「判官等于选手」——T8b 给夹具选手填了实测模型而 T9 仍假设 null，测试改为复用同一声明模型（`7842cba`），eval 178 个测试全绿。四个发现：一、报告曾按物化记录的字节哈希而非其 sha256 字段，两格因 source.reused 不同被判「题面不一致」，T9 发现、T8b 修复，真实两格 bundle 的三条不变量首次全部成立；二、回读读早一拍，门面在 settle 后才合并观测，T8b 改为有界轮询，四轮 observed 全部非空且与 declared 一致；三、judge.ts 源码里有一个字面 NUL 字节让 git 把它当二进制，合并时改为 \u0000 转义；四、两个 agent 共用 ~/.dsh-lab 的 web-eval 实例互相覆盖过 tarball，T9 另开 web-eval-t9（3181，验收后已停）。gate 的 test 步会把 root 包一起选中而 root 的 test 脚本是 pnpm -r，作用域形同虚设，ankh-guard 的偶发 flake 因此拦住每一个人——归 mainline。T14 未回报；T15 等 T14 合入后发。

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
| T24 | 代码 | local-agent：每 provider 的模型参数，首轮委派指定、成员内固定、resume 不换；provider 设置卡「默认模型」（dev 域 UI，自由输入加最近值，不硬编码模型目录） | T23 T3b | |
| T25 | 代码 | eval：`conditions provision` + 条件注册表数据面（模型等因子只展示与 diff，不给选） | T23 | |
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

可直接转发给实施 agent。每段自包含，含分支与 worktree 要求。

### I1 的文案（已全部完成）

T1 到 T6 与 T1b、T3b 的原文见 git 历史（本文件在 `a1581e4`、`3cd87b3`、`a5abb7d` 三次提交中的版本）；结果与合入记录见第二节 I1 小节。

I1 已收口（2026-09-05）。I2 的目标：一格全自动跑完；F2 + F3 × 四家 × 3 rep 出第一份带保留条款的结论。分两波：**第一波** T8、T10、T11、T12、T13 互不依赖可并行；**第二波** T9、T14、T15 在 T8 落地后发，它们的形状取决于 T8 实际产出的 run 记录与 ns 载荷。下面是第一波的五段文案。

### T8 · eval 编排器 v0：模板生成 + 阶段一二的 run 循环（宿主目录）

```text
# 任务 T8：@khorsheed/dsh-eval 编排器 v0——模板生成 + 阶段一二的 run 循环

## 背景
I1 已把一格评测在宿主上手工走通（题库仓库 ~/.dsh/scratch/dataseek-eval 的 docs/i1-walk-log.md 逐步记了耗时与人肉动作），三份契约与 validate 已落地（packages/eval）。你的任务是把手工走通的那条路变成程序：读 plan，生成 run 模板，展开矩阵，逐格委派、提交、推进、归档、导出。本轮只覆盖阶段一二（写文档的两个阶段）、宿主目录代替容器、不做判官（T9）、不做报告（T10）。

## 先读
AGENTS.md、docs/development.md、profiles/web-eval/README.md（理想流程、冻结决策）、profiles/web-eval/docs/architecture.md（第二节轨迹表第 8 到 18 步、第五节四条不变量）、profiles/web-eval/docs/iterations.md、docs/dataset-authoring-protocol.md §6（契约）、packages/eval 现有源码、packages/mission/README.md 与 src/service.ts（runCreate / submit --to / transition / annotate / retry / export）、packages/datasets/src/service.ts（snapshot / worktree_path / read）、packages/local-agent/src/index.ts 的门面 start / resume / cancel 与 LocalAgentRunProgress、proposals/active/2026-08-18-local-agent-delegation-api.md；题库仓库 i1-walk 分支：templates/bench-v1.json、schemas/、manifest.yml、visible/prompts/、docs/i1-walk-log.md。scripts/integration-triad.mts 是同类驱动的先例。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-run，分支 feat/eval-run-v0。显式 stage，不 push。题库仓库只读，需要的模板与示例从 i1-walk 分支读。

## 已定决定（照此实现）
1. run 的发起是人的动作：slash `/eval run <plan.json> [--concurrency N] [--dry-run]` 在 web-eval 实例的会话里执行，该会话即 originSession，也是所有委派的父会话。CLI `dsh-eval run` 只做 `--dry-run`：校验、生成模板、展开矛阵、打印顺序，不委派（CLI 进程外没有活的父 Agent）。不注册任何 run 类模型工具。
2. 模板由 manifest 生成：`generateTemplate(manifestPath, opts)` 读 stages，生成 pending → ws-ready → stage-<id>… → judged / halted → archived → releasable → released 的状态机，stage 转移带 schema-check（schemaPath 指向 manifest 引用的 schemas 文件），halt_on 生成 halted 边及其 const 校验，进入 releasable 带 file-check [workspace/, verdicts/]，最早转移带 run-meta schema-check（datasetId、commit）。生成结果必须与题库 i1-walk 的 templates/bench-v1.json 等价（状态、转移、guard 逐项相同，允许键序不同），写一个对比测试钉住。
3. 每格独立 cwd：`$DSH_HOME/state/eval/cells/<runId>/<missionId>/attempt-<N>/`，物化 = datasets.worktree_path（显式 visible 层）后复制该题的 visible 内容进去，写 materialization.json（排序后逐文件 sha256 + 整体 sha）并 addArtifact(kind materialization)。委派时把这个目录作为子代理 cwd（依赖 T11 给门面加的 cwd 选项；T11 未合入前用临时分支联调或先 mock）。
4. prompt 逐字节：题集级 visible 层 prompts/<stage>.md 的字节 + 一个换行 + 该题 task.md 的字节；sha256 记入 orchestrator ns。母 agent 不参与，编排器直接调 `ctx.localAgent.start` 或 `resume`。
5. harness → provider：从 condition.harness.name 经 local-agent 注册表解析 delegationProvider；条件的 drive 必须是 exec，否则拒绝启动。
6. 每次委派记一条 orchestrator ns 注解：{kind: 'delegation', stage, round, childSessionId, promptSha, startedAt, durationMs, usage, model: {declared, observed}}；observed 来自 T11 的回读，未合入前置 null。
7. 阶段推进：委派返回后从 cell 目录收 stage<N>.json 与 stage<N>.md，`submit({to, json, files})`，`transition(to)`；halt_on 命中走 halted。schema 违规不重试：记 orchestrator ns {kind: 'submission-rejected', violations}，该格停在当前态。
8. 失败策略：委派 spawn 失败、门面报错、超时取消 → `retry(reason, category: 'infrastructure')` 后重做该格，上限 plan.retry.infrastructure（缺省 1）；超限记 orchestrator ns 并跳过。超时 = plan.budget.activeMinutes 的每格累计委派时长，到点 `cancel(childSessionId)`。
9. 顺序：按 plan.order.seed 对（题 × 条件 × rep）洗牌，同一条件不连续排列优先；`--concurrency` 缺省 1；顺序与并发数写进 run.meta。
10. run.meta：{planSha, planPath, evalVersion（包版本 + 仓库 HEAD 短 sha，取不到则包版本）, snapshot, conditions: [{id, sha}], order: {seed, sequence}, concurrency, startedAt}；进入 releasable 前把 cell 目录拷到 attempt 的 archive/workspace/，verdicts/ 在 T9 前放一个 .keep 之外的占位文件会违背 G2，所以本轮 released 由 `--finalize` 显式触发且要求 verdicts/ 非空，默认停在 archived。
11. 结束时 export bundle 到 plan.exports 目录（缺省题库仓库 exports/），只收 visible 层。
12. 服务面 `ctx.dshEval.run(plan, {parentSessionId, concurrency, dryRun})` 是本体；slash 与 CLI 是薄封装。缺 datasets / mission / localAgent 任一服务即拒绝启动并列出缺哪个。

## 交付
1. packages/eval：generateTemplate、expandMatrix、run 循环、slash `/eval run`、CLI `dsh-eval run --dry-run`、`dsh-eval template <manifest>` 打印生成的模板。
2. 测试：用假的 datasets / mission / localAgent 服务面跑完整一格（含 halt 分支、schema 违规、基础设施重试、超时取消、顺序种子可复现）；模板等价测试；dry-run 输出快照测试。真实集成不在单测里。
3. README 双语、compat、Agent Note；profiles/web-eval/README.md 的成员表把 dsh-eval 加进 22 个成员后的第 23 行，中英与 sidecar 同步。
4. 在 ~/.dsh-lab 的 web-eval 实例上真跑一次 P0 × dsh × rep 1（照 I1 的环境，T5 的 install.sh --source 装最新成员），回报实际耗时与卡点。

## 约束
不 import 任何 @khorsheed 包，四个上游只经 ctx.get 探测；不改 mission / datasets / local-agent 的代码，需要它们加东西的写进回报；不碰 3080；不进容器。

## 完成判据
假服务面下一格全自动跑完且十二条决定各有测试；模板等价测试通过；真实实例上 P0 × dsh 一格自动跑到 archived 并导出 bundle；pnpm run build && pnpm run test 绿；check:plugins 零违规；pnpm gate 通过。

## 回报
commit、worktree、Agent Note、真实一格的 run.json 摘要（脱敏）与耗时、对 T9 / T14 的接口建议（run 记录里哪些字段是稳定的）。
```

### T10 · eval 报告：results.jsonl + summary.md

```text
# 任务 T10：dsh-eval report——从 bundle 出配对报告

## 背景
mission export 的 bundle 是自包含的（manifest.json、run.json、missions/<id>/attempt-N/{meta,annotations,artifacts}、dataset/<layer>/），judge 与人终评的结果以 verdict 记录住在 script / llm-draft / human-final 三个 ns 里。你的任务是把 bundle 变成两样东西：一行一个判定的 results.jsonl，和一份按题配对的 summary.md。方法论已经定死在 profiles/web-eval/README.md「把它当对照实验来设计」和冻结决策 9 到 11。

## 先读
AGENTS.md、profiles/web-eval/README.md、profiles/web-eval/docs/architecture.md 第五节四条不变量、docs/dataset-authoring-protocol.md §6（condition / plan / verdict 契约）、packages/mission/src/export.ts（bundle 结构、nsReport、writtenBy）、packages/eval 现有源码、题库仓库 ~/.dsh/scratch/dataseek-eval 的 exports/i1-walk-bundle（真实样本）与 datasets/harness-comparison/docs/dimensions.md（效率指标为什么并列不合成）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-report，分支 feat/eval-report。显式 stage，不 push。

## 交付
1. `dsh-eval report <bundleDir> [--out DIR]` 与服务面 `ctx.dshEval.report(bundleDir)`；输出 `report/results.jsonl`（每行 = {task, condition, conditionSha, rep, attempt, stage, ns, criterion, pass, weight?, evidence, by}）与 `report/summary.md`。
2. summary.md 开头先核四条不变量：题面一致（同题各格 materialization 哈希相同）、环境一致（refs.fingerprint 同 run 相同，缺失时如实写「本 run 无指纹」）、受试对象一致（labels.condition 的 sha 与 run.meta.conditions 一致；model.observed 与 declared 一致）、程序一致（run.meta.evalVersion 与 planSha 存在）。任一项不成立，报告只输出事实表，不输出比较。
3. 因子由 condition diff 推出：把 run.meta.conditions 对应的 condition 文档两两 diff，只差一项即该项为因子名（harness / model / preset / skills）；差多项则标「多因子」并只做描述统计。
4. 配对比较：以题为区组，对每对条件输出逐题差值（通过的 criterion 数、加权分若 rubric 提供 weight）、n（rep 数）、自助法 95% 置信区间（重采样 rep）；n 小于 3 或不变量不成立时打印「不可排名」并拒绝输出名次。
5. 判官一致性：llm-draft 有多次采样时按 criterion 算一致率与 Cohen κ；human-final 存在时算 llm-draft 对 human-final 的一致率。
6. 效率并列不合成：每条件的活跃时长（orchestrator ns 的 durationMs 之和）、标价成本（若 plan 或 condition 给了单价，否则留空）、委派轮次（只在双方都完成的题上比）。token 只在同模型内比，跨模型列「不适用」。
7. writtenBy 若显示 expectedNs 里某 ns 全由 tool: 写入，summary 顶部红字标出。
8. 测试用合成 bundle 夹具覆盖：单条件、两条件单因子、多因子、不变量失败、n 不足、缺 human-final、判官双采样。

## 约束
不 import 任何 @khorsheed 包；只读 bundle，不读 mission 数据根；不引入统计库，自助法与 κ 手写并有测试；不出图（Pareto 图到 I5 的界面）。

## 完成判据
对 exports/i1-walk-bundle 跑通并输出「单条件、不可比较」的事实表；合成夹具全部测试通过；pnpm run build && pnpm run test 绿；check:plugins 零违规；pnpm gate 通过。

## 回报
commit、worktree、Agent Note、对 i1-walk bundle 的 summary.md 全文。
```

### T11 · local-agent：模型回读 + 委派 cwd 选项

```text
# 任务 T11：local-agent 模型回读 + 委派 cwd 选项

## 背景
评测要证明「实际跑的模型 = 声明的模型」（冻结决策 5），现在四家的输出流里都有模型标识但没人记；编排器（T8）还需要把每格的独立目录作为子代理的 cwd，而门面现在只用父会话的 cwd。两件都是门面与 provider 的增量，无行为变化。

## 先读
AGENTS.md、profiles/web-eval/README.md「冻结决策」5 与 6、packages/local-agent/src/index.ts（门面 start / resume、DelegationCallOptions、recordDelegation、delegations.jsonl）、四个 provider 的流解析（claude 的 system/init 与 result、codex 的 thread / turn 事件、kimi 的 wire.jsonl、dsh 的 session 事件）、docs 里 engineering.md 提到的 resolveChildCwd 第二参数（~/.dsh/scratch/dataseek-eval/datasets/harness-comparison/docs/engineering.md ①）、T3 / T3b 的 Agent Note。

## 分支
从 main 开 worktree ../dsh-plugins-wt-local-agent-observed-model，分支 feat/local-agent-observed-model-cwd。显式 stage，不 push。

## 交付
1. 模型回读：每家 provider 从自己的输出流取实际模型标识（claude：system/init 或 result 的 model；codex：thread 或 turn 事件里的 model；kimi：wire.jsonl 的 usage 或 request 记录里的 model；dsh：子会话事件里的 model），写进委派记录 delegations.jsonl 的新字段 observedModel，并随 LocalAgentRunProgress 增加一种 {kind: 'settled', observedModel?, usage?} 事件；门面新增只读 `delegationOf(childSessionId)` 返回记录（不含 cliSessionId）。取不到即缺位，不猜。
2. cwd 选项：DelegationCallOptions 增加 `cwd?: string`，start 与 resume 都接受；provider 用它替代父会话 cwd（resolveChildCwd 的覆盖位）；缺省行为一字不变。resume 时若与首轮 cwd 不同，fail loud。
3. 测试：四家各一条「流里有模型则记录 observedModel」与「没有则缺位」；cwd 覆盖生效与 resume 不一致被拒的测试；旧 delegations.jsonl 无该字段照常读。
4. 四包 README 与 compat 同步；Agent Note 新开一篇（这是新能力，不是 T3 的延伸）。

## 约束
不改任何默认行为；不 spawn 额外进程；observedModel 不进 prompt、不进模型可见面；家族内按既有 sanctioned 边改。

## 完成判据
五包 build + test 绿；check:plugins 零违规；pnpm gate 通过（ankh-guard 偶发 flake 注明即可）。

## 回报
commit、worktree、Agent Note、四家 observedModel 的一份真实样本（脱敏）。
```

### T12 · datasets：金丝雀 + 工具分组配置

```text
# 任务 T12：datasets 金丝雀字段 + 工具分组配置

## 背景
两件小事，都是评测域的机制需要、对 dev 域零影响。金丝雀：Terminal-Bench 的做法，每道题的 visible 文件里埋一个全局唯一字符串，将来在模型输出里搜到它就证明题库进过训练语料，成本几乎为零。工具分组：eval 域的规划 agent 只该有读类与作者类工具，而 preset 挑不掉 profile 层注册的工具，只能由插件按组注册。

## 先读
AGENTS.md、profiles/web-eval/README.md「工具按域开放」、docs/dataset-authoring-protocol.md（§2 descriptor、§5 自验）、packages/datasets/src/index.ts（工具注册）、src/dataset.ts（descriptor 校验与警告）、tests/validate.spec.ts、tests/protocol.spec.ts（协议示例即夹具，注意 T2 把提取范围限定到了 §2）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-datasets-canary-tools，分支 feat/datasets-canary-tools。显式 stage，不 push。

## 交付
1. 金丝雀：dataset.json 可选字段 `canary: string`（建议格式含 dataset id 与一个 uuid）；validate 新增警告 CANARY_MISSING：声明了 canary 时，visible 层（modelFacing true 的层）里每个文本文件（按扩展名白名单：md / txt / yml / yaml / json / 无扩展名）都必须包含该字符串，缺的逐文件报。未声明 canary 不报。协议 §2 与 §5 同步，示例进夹具。
2. 工具分组配置 `tools: 'all' | 'read' | 'authoring' | 'none'`（默认 all，行为不变）：read = list / show / describe / read / snapshot / validate；authoring = read + put_item；all = authoring + worktree_path。配置在 schema 里声明，README 写明 eval 域建议 authoring。
3. 测试：三档注册的工具集合各一条；canary 的四种情形（未声明、全有、缺一、非文本文件跳过）。
4. README 双语、compat、Agent Note。

## 约束
不改默认行为；不引入依赖；不改 mission / eval。

## 完成判据
datasets build + test 绿；check:plugins 零违规；对题库 i1-walk 分支跑 validate，未声明 canary 时零新增警告；pnpm gate 通过。

## 回报
commit、worktree、Agent Note。
```

### T13 · mission：工具分组配置

```text
# 任务 T13：mission 工具分组配置

## 背景
eval 域的规划 agent 不能有 mission 的写工具：一个能 mission_transition 的 agent 就能绕过编排器改账，mission_attest 更是直接放行 guard（路线图待决「attest 的人机边界」的答案就是在 eval 域不给这个工具）。preset 挑不掉 profile 层注册的工具，只能由插件按组注册。

## 先读
AGENTS.md、profiles/web-eval/README.md「工具按域开放」、packages/mission/src/index.ts 与 src/tools.ts（12 个工具的注册）、packages/mission/README.md、T4 的 Agent Note。

## 分支
从 main 开 worktree ../dsh-plugins-wt-mission-tools-config，分支 feat/mission-tools-config。显式 stage，不 push。

## 交付
1. 配置 `tools: 'all' | 'read' | 'none'`（默认 all，行为不变）：read = run_list / run_status / list / get；all = 全部 12 个。系统提示词段（tool:mission）按档位只描述实际注册的工具。
2. 测试：三档注册集合各一条；read 档下 systemPrompt 段不提写工具。
3. README 双语、compat、Agent Note（可作为 T4 那篇的延伸小节，或新开，自定）。

## 约束
不改默认行为；服务面、CLI、slash、tab 不受影响；不出现评测词汇。

## 完成判据
mission build + test 绿；pnpm gate 通过。

## 回报
commit、worktree、Agent Note。
```


### 第二波（T8 合入后）

T8、T10、T11 已于 2026-09-06 合入 main。第二波四段：T8b 是 T8 的收尾，与 T9、T14 互不依赖可并行；T15 等三者合入后发。

### T8b · 编排器收尾：接 T11 回读、条件锚点、协议补字段、真跑两格

```text
# 任务 T8b：dsh-eval 编排器收尾——接 T11 回读、条件锚点、协议补字段、真跑两格

## 背景
T8 已合入 main（d65b17b），与 T10 的报告动词在同一包里合并；T11 的模型回读与委派 cwd 选项也已合入（2f05c1b）。T8 回报里留下四件收尾：usage 与 model.observed 还是 null、报告拿不到格子的条件身份、plan.retry 与 plan.exports 在协议里无法表达、profile 内 tarball 陈旧导致重装踩坑。本任务把它们收掉，并用两格 rep 真跑一次，让 T10 的四条不变量能在真实 bundle 上首次全部成立。

## 先读
packages/eval 现状（run.ts、faces.ts、report.ts、schema.ts）、packages/eval/README.md「状态」与降级项、.agents/notes/implemented/feature/2026-09-05-eval-orchestrator-run-v0.md 与 2026-09-05-eval-report-verb.md（接口约定）、packages/local-agent/src/types.ts 的 DelegationCallOptions.cwd、LocalAgentRunProgress 的 settled 事件、LocalAgentRegistry.delegationOf、.agents/notes/implemented/feature/2026-09-06-local-agent-observed-model-cwd.md、docs/dataset-authoring-protocol.md §6。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-run-b，分支 feat/eval-run-v0b。显式 stage，不 push。题库仓库允许一次数据提交（见交付 4），在 i1-walk 分支。

## 交付
1. 接 T11：委派 settle 后用 delegationOf(childSessionId) 或 settled 事件取 observedModel 与 usage，回填 orchestrator ns 的 delegation 注解；cwd 选项按 T11 的正式字段名传；README 里两条「等 T11」降级项删除。
2. 条件锚点：run 开始时为每格写一条 orchestrator ns 注解 {kind: 'cell', task, condition, conditionSha, rep}；run.meta.conditions 的每项带完整 condition 文档（字段名 condition）。报告端优先读 cell 注解与 run.meta.conditions[].condition 解析格子身份与因子，不再依赖 bundle 里不存在的 labels；「受试对象一致」的核验改为 cell 注解与 run.meta 一致 + observed 与 declared 一致。
3. 协议：dataseek.plan/1 增加可选 retry: {infrastructure: integer ≥ 0} 与 exports: string；schema 模块、协议 §6、夹具、web-eval README 示例同步；run 选项仍可覆盖。
4. 条件数据：把题库 i1-walk 的 conditions/dsh-exec.json 的 model.declared 与 harness.version 按 /dsh status 快照里的 effectiveSettings 填实（其余字段不动），提交到题库仓库 i1-walk 分支，提交信息写明来源。
5. 安装陈旧：profiles/web-eval/scripts/install.sh --source 重跑时若 profile 已存在 node_modules，打印提示并要求 --fresh 才清 node_modules 与 lockfile 后重装；README 安装节补一句。
6. 真跑：在 ~/.dsh-lab 的 web-eval 实例（先 install.sh --source --fresh 装最新 main）跑 plans/i1-walk.json 改 reps 2 的副本（P0 × dsh × 2），/eval run 后 dsh-eval report 该 bundle：题面一致、程序一致、受试对象一致三条必须成立，环境一致允许「本 run 无指纹」。把 summary.md 全文放进回报。

## 约束
不改 mission / datasets / local-agent 代码；不 import @khorsheed 包；不碰 3080。

## 完成判据
eval 测试全绿（新增：observed 回填、cell 注解、协议新字段、报告读 cell 锚点）；check:plugins 零违规；pnpm gate 通过；真实两格 bundle 的报告里三条不变量成立且 observed 非空。

## 回报
commit、worktree、Agent Note（在 T8 那篇上追加「收尾」一节）、真实 bundle 的 summary.md 全文、conditions/dsh-exec.json 的题库 commit。
```

### T9 · 判官：探针契约 + LLM 盲评 + 归档闸收口

```text
# 任务 T9：dsh-eval 判官——探针契约、LLM 盲评（llm-draft）、verdicts 归档

## 背景
编排器 v0 把格子跑到 judged 并停在 archived，verdicts/ 目录为空，所以 --finalize 过不了 G2 的非空闸。判定分三源：script 由确定性探针写，llm-draft 由判官条件写，human-final 由人写。本任务落地前两源的机制。方法论已定：判官本身是一个 condition，模型不得是选手之一；判前去指纹；双采样报一致性（README 冻结决策 9）。

## 先读
profiles/web-eval/README.md（冻结决策 9、理想流程判定期）、profiles/web-eval/docs/architecture.md 第二节第 16、19 步、docs/dataset-authoring-protocol.md §6 的 dataseek.verdict/1、packages/eval 的 run.ts（格子布局、archive 路径、--finalize）、report.ts（判定源与一致性的读法）、faces.ts 的 LocalAgentFace、packages/datasets/src/service.ts 的 read（显式层，取 grading 层的 rubric）；题库 harness-comparison 的 items/*/grading/rubric.yml（kind: objective / llm-draft / human 三类判据）、verify/checklist.yml、docs/dimensions.md。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-judge，分支 feat/eval-judge。显式 stage，不 push。

## 交付
1. 探针契约（script ns）：题集 verify 层下 probes/*.mjs 或 *.sh 的调用约定写进协议 §6：`<probe> --cell <格子目录> --rubric <rubric 路径> --out <verdicts.json>`，退出码 0 表示已判定（含 pass:false），非 0 表示探针失败；输出是 dataseek.verdict/1 的数组。编排器在格子进入 judged 后逐个执行存在的探针（宿主侧，I3 起交 lab.verify），结果写 script ns 并落到 attempt 的 archive/verdicts/script.json；没有探针即如实不写。
2. 去指纹：对送判材料（stage1.json / stage1.md / stage2.json / stage2.md）做替换：四家 harness 名、CLI 名、已知模型标识（取自 plan 各 condition 的 model.declared 与 observed）、成员自报名字（"I am Codex" 类）替换为 <harness>、<model>；替换表与替换次数记进注解，材料原件不动。
3. LLM 盲评：judge prompt = 该题 grading 层的 rubric（只取 kind 为 llm-draft 的判据）+ 去指纹材料 + 输出要求（写 verdicts.json 到 cwd，形状 dataseek.verdict/1，每条判据一条，evidence 引用材料原文）。用 plan.judge.conditions 逐条件、逐样本（plan.judge.samples，缺省 2）经 localAgent 门面委派（exec、独立 cwd = 判官临时目录），从 cwd 读 verdicts.json，解析失败记 orchestrator ns 后重试一次。每个样本写一条 llm-draft 注解 {sample, judgeCondition, judgeSha, promptSha, verdicts}，并落 archive/verdicts/llm-draft-<sample>.json。
4. 判官 ≠ 选手：启动前校验每个判官 condition 的 (harness.name, model.declared) 与 plan 任一条件都不同，否则拒绝并说明。
5. --finalize 路径：verdicts 落盘后 archived → releasable（file-check 非空通过）→ released；无判官条件时只要 script 有产出即可 finalize。
6. 判官的 usage 与 durationMs 记进 orchestrator ns（kind judge），报告的效率表不把判官成本算进选手。
7. 测试：假门面下的双采样、去指纹替换表、判官等于选手被拒、探针退出码三种情形、解析失败重试、finalize 过闸。

## 约束
不 import @khorsheed 包；rubric 的 grading 层只经 datasets 服务面显式层读取，绝不进选手格子；判官材料目录在 run 结束后保留供复核；不改 mission / datasets / local-agent 代码。

## 完成判据
eval 测试全绿；对 T8b 跑出的两格 bundle 加一个判官条件（dsh × 与选手不同的模型）真跑一次：llm-draft 双样本入库，report 的判官一致性一栏有数字，--finalize 到 released；pnpm gate 通过。

## 回报
commit、worktree、Agent Note、真跑的 summary.md 判官一致性段、去指纹替换表样本。
```

### T14 · eval 只读工具

```text
# 任务 T14：dsh-eval 只读模型工具

## 背景
规划期的 agent 需要三样只读能力：看有哪些 condition 及其就绪状态、校验自己起草的 plan、看某个 run 跑到哪了。写类动作（run、finalize、annotate）一律不给 agent，这是 README「工具按域开放」的规则。

## 先读
profiles/web-eval/README.md「工具按域开放」、profiles/web-eval/docs/architecture.md 能力地图 eval 一行、packages/eval 现状（validate、readiness、run.ts 的 run.meta 与 orchestrator ns 形状）、packages/mission/src/tools.ts（defineTool 与 output 声明的先例）、AGENTS.md「Tool origin tagging」（标签是 Symbol.for('dsh.tool.origin') 键的属性，不 import capability-catalog，直接设该属性）、packages/datasets/src/index.ts 的工具注册与 systemPrompt 段。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-tools，分支 feat/eval-read-tools。显式 stage，不 push。

## 交付
1. eval_conditions：列出题库 conditions/ 目录下的条件（id、harness、model.declared、sha、就绪：lock 是否存在且一致、未解析字段清单）；参数 repo 或从会话的 datasets 绑定取。
2. eval_plan_validate：对给定 plan 路径调 validatePlan，返回 ok / errors / warnings 与解析出的条件 sha。
3. eval_run_status：给 runId，返回 run.meta 摘要（planSha、conditions、order、startedAt）与 cells[]（task、condition、rep、attempt、state、bucket、最近一条 orchestrator 注解的 kind 与时间、submission-rejected 的次数），数据源是 mission.runStatus + orchestrator ns；没有 mission 服务即返回可读错误。
4. 配置 tools: 'all' | 'none'（默认 all，本包只有读工具）；systemPrompt 段 tool:eval 向模型说明这三个工具只读，run 由人在会话里用 /eval run 发起。
5. 工具按 AGENTS.md 打 origin 标签（owner 为本包名），不 import 任何 @khorsheed 包。
6. 测试：三个工具的 execute 各有假服务面测试；tools: none 不注册。

## 约束
不注册任何写工具；不改上游包。

## 完成判据
eval 测试全绿；check:plugins 零违规；pnpm gate 通过；在 ~/.dsh-lab 实例的会话里让 agent 调 eval_run_status 读 T8b 的 run 一次，贴回输出。

## 回报
commit、worktree、Agent Note、eval_run_status 的真实输出（脱敏）。
```

### T15 · pilot A（T14 合入后发）

```text
# 任务 T15：pilot A——F2 + F3 × 四家 × 3 rep，阶段一二

## 背景
这是第一次真实对比，目的是出一份带保留条款的结论，并把判官、rubric、去指纹的问题全部暴露出来。不进容器，宿主上跑，隔离只到每格独立 cwd；结论只用于验证流程与判官，不用于发布。

## 先读
profiles/web-eval/README.md 全文、docs/architecture.md、docs/iterations.md I2 小节、packages/eval/README.md、题库 harness-comparison 的 README.md、docs/dimensions.md、docs/players.md、items/F2-*、items/F3-*；~/.dsh/scratch/dataseek-eval/docs/i1-walk-log.md 与 T8b 的回报。

## 分支
dsh-plugins：从 main 开 worktree ../dsh-plugins-wt-web-eval-pins，分支 feat/web-eval-pins，只改 profiles/web-eval/。题库仓库：i1-walk 分支继续。

## 步骤
0. 评测 pin 进 profile：把 mission tools read、datasets tools authoring、四家 live false、codex sandbox danger-full-access（宿主直跑阶段用 workspace-write 并在 methodology 里声明）、claude permissionMode skip、kimi thinkingEffort high 写进 profiles/web-eval/cordis.patch.yml；决定该文件归 pack（update.sh 也覆盖它），README 与 update.sh 同步，Agent Note 说明与 web-dev 的差异。
1. 条件：conditions/ 下建 codex-exec、claude-exec、kimi-exec（dsh-exec 已有），model.declared 与 harness.version 取自各家 /<harness> status 的 effectiveSettings；判官条件 judge-dsh：dsh × 与 dsh-exec 不同的模型（在 plan 里声明）。
2. plan：plans/pilot-a.json，items [F2-multi-agent-room, F3-self-restart-report]，conditions 四个，reps 3，stages [stage1, stage2]，order.seed 记录，budget.activeMinutes 60，judge {conditions: [judge-dsh], samples: 2}，retry.infrastructure 1，expectedNs [script, llm-draft, human-final]。dsh-eval validate 通过。
3. 运行：/eval run --concurrency 2（阶段一二 manifest 允许并发），过程中用 eval_run_status 观察；卡住的格子记录不手工干预，超时由编排器处理。
4. 判官与终评：run 结束后 llm-draft 已由 T9 自动入库；human-final 对每题每条件至少一个 rep 由你按 rubric 写入（dsh-mission annotate --ns human-final），其余如实缺失。
5. --finalize 后 export，dsh-eval report；报告的四条不变量必须成立，否则先修再跑。
6. 写 methodology.md：四家配置与已知不对称（players.md 的清单）、宿主直跑的隔离限制、判官模型选择理由、保留条款；结论按题配对呈现，不做总排名。
7. 回填缺口清单：过程中每个人肉动作与卡点，按 I1 走通日志的格式写 docs/pilot-a-log.md。

## 完成判据
24 格全部到 released；report 不变量全部成立；判官一致性有数字；methodology.md 定稿；pilot-a-log.md 存在。

## 回报
题库 commit、bundle 路径、summary.md 全文、pilot-a-log.md、profile pins 的 dsh-plugins commit。
```

## 四、验收规程

实施 agent 回报四样：分支名与 commit、Agent Note 路径、`pnpm gate` 输出、一份脱敏的示例输出。协调者做的事：

1. 在独立 worktree 里 checkout 该分支，`git pull --rebase` 后跑 `pnpm gate`。
2. 对照任务段的「完成判据」逐条核，缺一条即打回，不做「差不多」。
3. 读 Agent Note 的 Alternatives considered：没有记录真实取舍的不收。
4. mission / lab / datasets 的改动额外跑通用性 grep（红线词表见各提案验收标准）。
5. 多个分支同时绿时，按文件不重叠原则任意顺序合入；有重叠先合改动小的。
6. 迭代收口只看 README「迭代计划」里该行的完成判据；达到后把本文对应迭代的任务表状态更新，再写下一迭代的指引文案。
