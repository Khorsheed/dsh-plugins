# dsh-web-eval 迭代文档

本文把 [README](../README.md) 的目标架构拆到**插件 × 层**的粒度，标注每一项是已满足、需改还是待建，落在哪个迭代；然后给出逐迭代的任务、依赖与验收。能力与文件的全貌见 [architecture.md](architecture.md)。

协作方式：协调者给任务指引与最终验收，实施 agent 在各自 worktree 里做；每个任务回报 commit、Agent Note 路径与 gate 输出。规则以 `AGENTS.md` 与 `docs/development.md` 为准。协调者换人先读 [handoff-2026-09-25.md](handoff-2026-09-25.md)（现状、顺序、铁律、配方）。

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
| 每 provider 的模型参数：首轮委派指定、成员内固定、resume 不换；provider 设置卡「默认模型」 | 服务面 + 工具 + UI | ⬜ | I4 · T30 | 冻结决策 5 的前半；dev 域直接受益；候选不硬编码目录 |
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
| 只读工具 `eval_conditions` / `eval_plan_validate` / `eval_run_status` | 工具 | ✅ | I2 · T14 | 不开 run；配置 tools: all / none；整份 JSON 渲染给模型 |
| 容器路径：acquire / populate / checkpoint / verify / archive 交 lab | 服务面 | ⬜ | I3 | |
| `conditions provision`：创建每条件 home 并回算哈希 | CLI + 服务面 | ⬜ | I4 | 依赖 local-agent 的 home 覆盖 |
| 条件注册表数据面（Remote）：模型等因子只展示、可 diff，不给选 | UI 数据 | ⬜ | I4 · T31 | 选模型即新建 condition，走 provision 与批准 |
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
| T14 ✅ | 代码 | eval：只读工具 `eval_conditions` / `eval_plan_validate` / `eval_run_status` | T8b | 合入 main `2176535` |
| T15 ✅ | 运维 | pilot A：step 0 把评测 pin 写进 web-eval 的 cordis.patch.yml 并决定该文件归 pack；F2 + F3 × 四家 × 3 rep，阶段一二，每格独立 cwd；bundle + report；把结论与保留条款写成 methodology.md | T8b T9 T14 | pins 合入 main `eb2b6c1`，codex 修复 `ac7dd39`；实际 F2 + F3 × 两家，3 格 released，其余由协调者叫停（见第三波验收）；bundle 在题库 `exports/pilot-a-round1-bundle/`；第一份结论 = 14 条缺口 |

**第一波验收（2026-09-06）**：T11（`2f05c1b`）、T10（`11b322f`）、T8（`d65b17b`）依次合入 main。T8 与 T10 在 `packages/eval` 的六处冲突全是「两边都加」，协调者按两边保留解决，合并后 eval 127 个测试全绿。T8 的真实一格 P0 × dsh 全自动到 archived，两轮 prompt 哈希与 I1 人肉走通逐字节相同，纯评测流 9.5 分钟对比 I1 的 1.5 小时。两个要记住的发现：服务键不能叫 `eval`（loader 的 !!js 用 with(ctx) 求值，同名属性遮蔽全局 eval，已改 `dshEval`）；profile 内 file: tarball 重打包后 pnpm 按 lockfile 复用旧解包，重装要清 node_modules。T12、T13 未回报。

**第二波验收（2026-09-07）**：T13（`fbf90f6`）、T12（`2ce8910`）、T8b（`9069b1b`）、T9（`0c75673`）依次合入 main。T8b 与 T9 在 `packages/eval` 的六处冲突全是两边各加一段，协调者按两边保留解决；合并后唯一挂掉的用例是「判官等于选手」——T8b 给夹具选手填了实测模型而 T9 仍假设 null，测试改为复用同一声明模型（`7842cba`），eval 178 个测试全绿。四个发现：一、报告曾按物化记录的字节哈希而非其 sha256 字段，两格因 source.reused 不同被判「题面不一致」，T9 发现、T8b 修复，真实两格 bundle 的三条不变量首次全部成立；二、回读读早一拍，门面在 settle 后才合并观测，T8b 改为有界轮询，四轮 observed 全部非空且与 declared 一致；三、judge.ts 源码里有一个字面 NUL 字节让 git 把它当二进制，合并时改为 \u0000 转义；四、两个 agent 共用 ~/.dsh-lab 的 web-eval 实例互相覆盖过 tarball，T9 另开 web-eval-t9（3181，验收后已停）。gate 的 test 步会把 root 包一起选中而 root 的 test 脚本是 pnpm -r，作用域形同虚设，ankh-guard 的偶发 flake 因此拦住每一个人——归 mainline。T14 于同日合入（`2176535`，与 T9 的 README 冲突按两边保留解决，eval 合并态 189 个测试全绿；工具配置词表定为 all / none，read 不作同义值，理由见其 Agent Note）。I2 的代码任务全部落地，T15 pilot A 可发。

**第三波验收（2026-09-08）**：T15 的两条分支合入 main。`feat/web-eval-pins`（`eb2b6c1`）：评测 pin 进 profile 的 cordis.patch.yml，该文件归 pack，update.sh 也覆盖它；工具按域开放三行、四家 live false、codex workspace-write、claude permissionMode skip、kimi thinkingEffort high、claude 端点 pin 为官方端点 + 本机代理出网，Agent Note 记了三条备选与拒绝理由。`fix/local-agent-codex-non-git-cwd`（`ac7dd39`）：codex exec argv 补 `--skip-git-repo-check`，格子目录不必是 git 仓库；新 spec 把 flag 钉在首轮与 resume 两种 argv 上并断言 `--sandbox` 仍在；trust_level 与「父目录做成仓库」两条备选都实测排除过。合并态 gate 通过，local-agent-codex 包 112 个测试全绿。题库 i1-walk 分支 `558ec30` 定稿。

范围的裁决：任务段的完成判据写 24 格全部 released，实际 3 格。claude 的 scoped home 授权刷不动、kimi 月度额度耗尽，两家开跑前进不来，均属账号侧；剩下两家 12 格跑到 3 格 released 时由协调者叫停——methodology §0 已写明本轮结果不能用于任何能力比较（无容器；判官实物上与 dsh 选手同模型；只剩两家；推理强度只一家受控），多跑的格子买不到信息，只烧 codex 额度。迭代收口只看 README I2 行的判据（规程第 6 条），24 格是任务级数字。

核过的事实：bundle 77 文件；四条不变量三条成立，「环境一致」按约定记「本 run 无指纹」，据此 `comparisonAllowed: false`，报告只出事实表——比较闸第一次被真实触发；判官双采样 39 条判据一致 38，Cohen κ 0.655，方差全部来自 F3 × codex 一格（A2-2 fail、A2-3 两次分歧），另两格 24 条零方差，κ 是单格支撑的数字；llm-draft 对 human-final 38/39。报告把 codex-exec vs dsh-exec 自动判为多因子（env / harness / model / permissions 四字段）只做描述统计——跨厂商 harness 对比在当前条件 schema 下天然不是单因子，单因子路径是 I4 的同 harness 换模型。

pilot 的 14 条缺口见题库 `docs/pilot-a-log.md`。六条拦路的（G4 `authenticated` 只查形状不查活性、G6 F3 rubric 没有叶子、G7 codex argv、G11 verdict 无极性、G12 权重进不了 bundle、G13 `--finalize` 无再入口）加 methodology §5b（llm-draft 一档写的是「设计里存不存在 X」，完整设计整片通过，阶段一二的区分度只能来自 objective 档做成真探针）构成 I3 第一波。验收另发现三件：一、报告的效率表按条件对**所有**当前格子的委派时长求和，未完成的格子（F2 × dsh × rep3 只跑了阶段一）也计入，两家「活跃时长」同为 21.0 min 是巧合——效率表应只计已完成格子或逐格列出，记 G15 归 T23；二、ankh-guard 在实施 agent 的 worktree 里留下四个「checkpoint: web-eval install」提交（三个为空、一个带半截改动），随分支进了 main 历史，checkpoint 不该落在功能分支上，归 mainline；三、`proxyUrl: http://127.0.0.1:6152` 是本机出网细节进了 pack 文件，换机器装即失效，I4 provision 落地后移到按主机覆盖层，暂由文件注释兜住。文档漂移两处归 mainline：`docs/ops.md` 写 lab 的 local-agent 软链回 official，实际是独立目录（对评测这才是对的）；`docs/players.md` 的 claude 代理路径已过期。

**I2 收口（2026-09-08）**：README I2 行三条判据——一格全自动跑完（T8/T8b 的 P0 格与本轮 F2/F3 三格）✅；一份带保留条款的结论（bundle 内 methodology.md，结论是缺口清单而非名次）✅；判官一致性有数字（κ 0.655，单格支撑，读法随数字写明）✅。I3 已按「T15 的卡点清单变成 I3 任务」开启，任务表见下节，文案见第三节。

### I3 · 容器化 + 阶段三四

目标：容器内一格全流程，release 经闸；四家在容器内跑通同一题。**第一波先把 pilot A 的缺口做掉**：它们不依赖容器，且不做掉的话容器内的四家对比同样出不了可读的数字。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T16 ✅ | 运维 | 验证题集级镜像构建；四家 Linux CLI 安装方式实测；本地包镜像与白名单代理；各家凭证可写卷；`versions.lock` 填实 | 无 | 题库 `i3-env` `4004dfc`（并入 i1-walk `714b793`）；镜像 `sha256:ed988b33…`（linux/arm64）；`env/README` 与 `docs/i3-env-log.md`；dsh 是唯一被容器出网打破的选手 |
| T17 ✅ | 代码 | local-agent：容器内 exec 包装（exec 传输层；「CLI 驱动抽成独立包」推迟，理由进 Agent Note） | T16 T18b | 合入 main `8efac1c`；门面 `exec: {container, workdir, env?}`，四家 argv 换成 `docker exec -w … -e NAME …`，值不上 argv；env 必须点名容器内作用域目录，否则起进程前报错；容器轮 exec-only、无成员通道；dsh 自动补 NODE_OPTIONS 并跳过宿主侧子 profile；四家容器内真委派：codex / dsh 完成，claude 授权过期，kimi 配额 |
| T18 ✅ | 代码 | lab：复合指纹（镜像 digest + 资源限制 + 挂载布局 + env 键），分量可读 | 无 | 合入 main `b7dc599`；`lab-env:<sha256>` + 分量 JSON；acquire 真传 `--cpus` / `--memory` |
| T18b ✅ | 代码 | lab：`network`（挂指定网或 none）、volume 挂载、`user`——T16 的三条硬缺口 | T18 | 合入 main `68e23d2`；三分量都真加到容器上再进指纹，未声明的分量不入哈希（旧指纹不变）；`--volume` 与 `--mount` 分立；pid 目录以 root 建 1777，非 root 单元才起得来 |
| T19 ✅ | 数据 | 探针：F2 / F3 阶段一二的 objective 判据写成 `.mjs` 探针；F2 阶段三的 verify 探针与 `verify/helpers/` | 无 | 题库 `i3-probes` `050e22d`（并入 i1-walk `d3ee214`）；25 条判定过 schema；3 条 objective 判据无探针，理由在 `docs/probes-selftest.md` |
| T19b ✅ | 数据 | F3 补一条与 A-N2 同形的 objective 负分判据；两题 core/bonus 计数对齐 standards.yml；探针改出 T24 定下的比例字段 | T24 | 题库 `i3-probes-b` `2142daf`（并入 i1-walk `22bc6bb`）；F3 新增 D-N1（D1，−2，negative），底层取值三格 1/8、1/5、0/6，一格 false；C1 / C2 出 `ratio`，34 条判定 pass 与 ratio 一致、evidence 无比例；两题 core 口径统一含 G1 |
| T19c ✅ | 数据 | 探针接 T28 的运行器：EXIT_NOT_JUDGEABLE 2 → 3；删两题 verify/lib 副本，探针 import 题集级 lib；F3 rubric.md 三处悬空引用改现行 id；P0 最小探针；自测表重跑 | T19b T28 | 题库 `i3-probes-c` `e90aa42`（并入 i1-walk `fef040a`）；main 的真实运行器跑三格：共享探针与 verify-rollup 记 probe-skipped，题内探针经题集级 lib 判定，逐格 9 / 5 / 5 与 T19b 相同；validate 只剩 41 条 UNREGISTERED_FILES；P0 探针不 import 共享库——register 布局物化后多一层 verify/，相对路径差一层 → T20b |
| T20 ✅ | 代码 | eval：容器路径（acquire / populate / checkpoint / verify / archive 交 lab；销毁路径唯一） | T17 T18b T28 | 合入 main `0639947`；计划 `unit` 段作开关，条件 `unit.scopedHome`，一格一单元八个动词顺序固定，refs.fingerprint 取复合指纹，force 只在探活单元一处；真 docker 上 P0 一格跑到 released，闸拒绝过一次且容器仍在；「环境一致」首次成立。**未上 3171、未拉真 CLI**（委派由容器内 docker exec 写产出），真 CLI 一格归 T22；四家横比时指纹含各家不同的 env 键与挂载 target → T20b |
| T20b ✅ | 代码 | eval：「环境一致」的口径——去掉条件自有项再比；register 布局按题库真实路径物化；两条路径的物化哈希统一 | T20 T19c | 合入 main `d623952`；环境类 = 单元分量去掉条件自有挂载与 env 键后经 lab 新增的纯动词 `fingerprintOf` 再算；四个只差作用域项的条件同 run 环境类一致、单元指纹各异且逐格点名差异；宿主与容器路径的物化 sha 同题同 commit 相等；register 夹具题探针经题集级 lib 判定成功；pilot-a-round1 results.jsonl 逐字节不变。单元完整指纹进 orchestrator ns 注解与归档 manifest，进不了 refs（mission setRefs 只认三个键）→ 交出 |
| T19d | 数据 | F2 阶段三的数据缺口：prompts/stage3.md、schemas/stage3.json 的文件引用形态、L2 四个驱动型探针（T19 + T28 量级）；I3 收口不依赖它，跑阶段三的 token 另批 | T19c | |
| T21 ✅ | profile | eval preset：不挂 Bash 与 docker | 无 | 合入 main `e1e12f1`；工具 43 → 39，差集恰为 bash / exit_plan_mode / ralph / workflow；四个 `subagent_<harness>` 预设挑不掉 → T27 |
| T22 ✅ | 运维 | 容器内跑 F2 阶段三一格；再跑四家同一题 | T16–T21 T27 T28 | 第 5 步（2026-09-09）：profile `9396b2e`（撤 claude proxyUrl、pin dsh headlessBundleDir / cliLaunch、拒绝路径带证据），题库 `i3-env-b` `b869cb8`（并入 i1-walk `511e096`）；3171 实例上 P0 × 四家 × 1 rep 全部 released，四条不变量全 ✅、四个单元指纹各异且差异逐格点名、comparison allowed、效率表 token 四列有数；run B 三家 + 判官，判官就绪通过、κ 1.0（P0 无争议）；阶段三归 T19d。第 1–4 步：profile `126990b`（codex danger-full-access）、题库 `i3-env-b` `0bcd824`（并入 i1-walk `913be11`）；新镜像 `sha256:4da0cfff…` 两炉内容指纹逐行相同，dsh 与 claude 容器内 exec 首次真通；F2 × codex × rep1 阶段一二在容器内到 released，四条不变量首次全 ✅，A-N2 首次进缺陷清单；第 5 步等 T20c，走 3171 |
| T20c ✅ | 代码 | eval：容器路径挂 local-agent 的作用域目录而不是 `--creds-root`（回读才读得到 rollout）；就绪检查覆盖判官条件 | T20b | 合入 main `28c0c17`；`--creds-root` 删净，挂载源取 `homeDir(家名)`，契约 v1-rev7 只改描述；真机 P0 × codex 容器内真 CLI：就绪检查回读 gpt-5.6-sol，四条不变量全 ✅，报告第一次 comparison allowed；判官条件不通时 run 在就绪检查被拒（READINESS_FAILED，1 of 2），run 记录不创建；同一家两个条件今天共用作用域目录，「每条件一份」等 T29 |
| T23 ✅ | 代码 | eval：`finalize <runId>` 再入口（G13）；开跑前就绪检查做一次最小委派而不信 `authenticated`（G4）；效率表只计已完成格子（G15）；run 的 `--only` / `--max-cells` 记进 run.meta；validate 交叉核 plan.expectedNs 与题的判定源（G6 的 eval 半边） | 无 | 合入 main `0cd2139`；finalize 不强推、不碰 archived 以下；就绪检查每条件一次真委派，失败拒整 run；效率表只计已完成格子（pilot A 的 dsh-exec 21.0 → 11.9 min）；子集记 `run.meta.subset`；validate 对 expectedNs 出四种 warning；judge.ts 零改动 |
| T24 ✅ | 代码+数据 | 负分判据进报告（G11 + G12）：verdict 契约不动，极性取 rubric 叶子的 `negative` / 负 weight；导出时把权重表（id → weight、negative）写进 bundle `report/`，报告以「得分判据数」与加权分呈现；**追加**：比例字段进 §6.5 | 无 | 合入 main `979e624`；协议 v1-rev4：极性归 rubric、`ratio: {passed, total}` 进 §6.5、§6.7 禁止 evidence 前缀；导出写 `report/rubric-weights.json`（只有编号与数字）；报告主轴改「得分判据数」+ 缺陷清单表；题库三份 rubric 审计零改动 |
| T25 ✅ | 代码 | local-agent：`effectiveSettings.cliVersion` 填实（G1）；codex 回读在并发 run 里失效的原因与修复（G14）；status 增加「记录在、活性未知」一档（G4 的 local-agent 半边） | 无 | 合入 main `25e6196`；codex 回读失效的根因是 64 KB 尾窗而非并发，改为尾扫不到就有界整读、按本轮 cwd 定位、有歧义宁缺不错；四家 `cliVersion` 填实；`credentialState` present-unverified / absent 档；顺带修 usage 全 null（onProgress 路由 60 秒有界驻留） |
| T26 ✅ | 代码 | datasets：`validate` 增加可判性检查（G6）——rubric 有叶子、每个 kind 在该题上有判定源 | 无 | 合入 main `b37633a`；按判定布局 opt-in，5 条 error（NO_ITEMS / FIELD_MISSING / KIND_INVALID / POLARITY / UNREADABLE）2 条 warn（OBJECTIVE_NO_PROBE / RUBRIC_REF_DANGLING）；在 F3 补叶子前的 commit 上把 pilot A 的「判官全跳过」复现为 1 error |
| T27 ✅ | 代码 | local-agent-tool-subagent：`tools: all \| none` 注册开关（T12/T13 同款）；pack 的 patch 把四家委派工具行设为 none | 无 | 合入 main `c8ba619`；none 下不注册工具也不挂生命周期监听；patch 三行 none（整值替换，故重抄 provider / toolName 并以 name 守卫）；新装实例 36 个工具，叠 all 回 39，差集恰为三家委派工具；第四家 `subagent_dsh` 在 profile 层关不掉，要改 provider 包 |
| T28 ✅ | 代码 | eval 探针运行器：题集级 verify 层随题物化、题内探针可 import 共享库；退出码三态（判不了 ≠ 失败）；先回填 task / by 再校验，§6.7 措辞对齐 | 无 | 合入 main `a6395e1`；两个 verify 层镜像题库布局物化，题集级探针对每题各跑一次；退出码 0 / 3 / 其余（取 3 不取 2：2 是 getopt 的用法错误码）；先回填再校验，ratio 边界与 pass 一致性在源头拦；协议 v1-rev5；题库仍退 2、仍留 lib 副本 → T19c |

第一波（2026-09-08 发出）：T16、T18、T19、T21、T23、T24、T25、T26 已验收。第二波（2026-09-08 发出）：T18b、T17、T27、T28、T19b 已验收。第三波（2026-09-08 发出）：T19c、T20 已验收。第四波（2026-09-08 发出）：T20b、T30a 已验收；T22 第 1–4 步已验收，第 5 步等 T20c 合入后走 3171 实例。第五波（2026-09-08 发出）：T20c 已验收（2026-09-09）；T22 第 5 步已验收（2026-09-09）。**I3 收口（2026-09-09）**：README I3 行的两条完成判据都成立。阶段三是题库数据缺口，记 T19d，另批预算。

**第一波验收（2026-09-08）**：T21（`e1e12f1`）与 T18（`b7dc599`）合入 main，两条分支文件不重叠；合并态 gate 通过，lab 包 100 个测试在验收机上重跑全绿。T16 与 T19 在题库仓库：`i3-env`（`4004dfc`）与 `i3-probes`（`050e22d`）经临时 worktree 并入 `i1-walk`（`714b793`、`d3ee214`），未动共享检出的 HEAD；T16 的提交全文 grep 过凭据形状，无命中。

- **T21**：预设文件、install/update 整目录覆盖、patch 钉默认值、README 双语「冻结决策 12 的执行点」齐全，Agent Note 记了七条备选。挑不掉的四个 `subagent_<harness>` 工具是真缺口：它们由 provider 的 bundle patch 装在 profile 根，预设过滤不到，每个都在宿主上起一家 CLI。编排器驱动选手走的是 local-agent 门面（`run.ts` 只用 `LocalAgentFace`，不用模型可见工具），所以三条路径里取第一条——给 tool-subagent 包加 `tools: all | none` 注册开关，pack 的 patch 把四行设为 none——记 T27。「钉的是默认值不是可达集」与「评测实例不要设 DSH_TOOLS_MODE」两条边界已写进 README。
- **T18**：指纹 `lab-env:<sha256>`，分量 image / resources / mounts / envKeys，宿主路径与 env 值不入分量，旧裸 digest 仍被接受；`AcquireSpec` 顺带长出 `resources` 并真传 `--cpus` / `--memory`，否则指纹宣称的是容器不具备的上限。分量镜像落在 lab 状态目录这条与 8 月「lab 不持有状态文件」的立场相抵，实施者把它做成无权威的镜像（label 是权威，reconcile 重写，release 删除，写失败只 warn），Agent Note 记了取舍，接受。两处越界（triad spec 一行断言改成新形状、.gitignore 加 `.dsh-lab-state/`）都是不改就落不了地的，接受。
- **T16**：镜像可复现的含义定为「内容指纹逐行相同、image id 必然不同」，起点一致由 versions.lock + refs.fingerprint 两层保证；四家最小 exec 三家过，kimi 卡账号配额（宿主同样 403）；**dsh 是唯一被容器出网打破的选手**——node fetch 默认不读代理变量，要 `NODE_OPTIONS=--use-env-proxy`。三个「不报错、只毁起点」的缺陷（root 建镜像让 claude 拒绝 skip 档；registry 只写 root 的 .npmrc 被 pnpm 绕过；corepack shim 按 cwd 解析）都修在镜像里。lab 的三条硬缺口（无 `network` 字段、只拼 bind 挂载、原无资源字段——第三条 T18 已补）记 T18b；文档不符四条本次改掉三条（architecture 的网络行与宿主前置行、README 决策 3 补非 root），第四条（凭证卷 bind 还是 named volume）由 T17 决定。题库 players.md 的两处过期值已由 T16 更正。
- **T19**：16 次探针调用 25 条判定全过 VERDICT_SCHEMA，验收机上重跑 run-all 结果一致；rubric 只动 evidence 与 note，YAML 逐条比对过。区分度如方法论 §5b 所料——完整样本上 objective 判据全 true；但 A-N2 的底层取值三格不同（1/8、1/5、0/6），F3 没有同形判据接住，记 T19b。探针契约六条不足：题集级 verify 层不被物化、退出码无「判不了」态、§6.7 先校验后回填的顺序矛盾——三条归 T28；verdict 无数值字段归 T24 追加（比例进契约，不解析 evidence 散文）；两条 objective 判据的可判性与 kind 不匹配、两题 core/bonus 计数漂移归 T19b。

两条流程发现：题库仓库是多 agent 共享检出，T16 中途被 T19 的 `git checkout` 切走 HEAD、未提交改动漂到别人分支上，抢救后改用 worktree——自此题库任务一律 worktree，写进 I3 通用约束；协调者上一轮给 I3 编的 T23–T26 与 I4 既有编号撞车，本次把 I4–I6 的任务顺延为 T29–T44（尚未派发，无人受影响），I3 新增 T27、T28 与 T18b、T19b。

**第二波验收（2026-09-08）**：T18b（`68e23d2`）、T23（`0cd2139`）、T24（`979e624`）依次合入 main。T18b 与另两条文件不重叠；T23 与 T24 在 `packages/eval` 的四处冲突（report.ts 两边各加接口；README 双语同两条要点两边各改一半；sidecar），协调者按两边保留合并——results.jsonl 行取 T24 的字段清单，summary.md 行取 T24 的「得分判据数」加 T23 的「只计已完成格子」与子集句，sidecar 按合并后的 blob 重录；合并态 eval 253 个测试全绿（189 + T23 的 40 + T24 的 24），lab 120 个在验收机上重跑全绿。题库侧 T24 零提交：`i3-rubric-weights` 停在 i1-walk 的祖先上，已删。

- **T18b**：三个分量都是「真加到容器上再哈希」（`--network` / `--user` / `type=volume`），容器内实测 uid、网段地址、默认路由 0 条、卷已挂，与 docker inspect 对上。「未声明的分量不入哈希原像」取代了 T18「定义变宽必改所有指纹」的立场：两个 v1 指纹作字面基线钉进测试，改前改后相等；T18 的 Note 与 README 加了前向指针而不改写 rationale。代价写在 README——`network: null` 分不清「没人管过」与「确认过默认 bridge」，要断言隔离就得显式声明。顺带修了非 root 单元的硬伤：pid 目录原以容器用户建，非 root 建不了 /run 下的东西，每次非 root acquire 都会挂在那一行；现以 `exec --user 0` 建并置 1777，daemon 拒绝时回落。挂载分 `--mount` / `--volume` 两个标志而不从 source 形状猜，因为 docker `-v` 的推断在相对路径上恰好错且无声。一条给 T17 / T22 的事实：新建的 docker 卷是 root 所有 755，uid 1000 写不进，题库 `creds/stage.sh` 的 chown 正是为此。
- **T23**：五项全落在 `packages/eval`，judge.ts 零 diff（validate.ts 只 import 三个已公开的纯函数），T28 可干净合入。finalize 的两条负保证（不强推、不碰 archived 以下）与 `releasable` 归 interrupted 的判断都对；pilot A 副本实测 0 released / 12 skipped，另造两格 archived 的 run 验证了释放与拒绝两条路。就绪检查是一次真委派而不是读 status，同时回读模型核对声明——G4 现在在 run 建立前就拦住，代价是每条件一轮短委派。效率表改后 dsh-exec 从 21.0 min / 3 轮变 11.9 min / 2 轮，results.jsonl 逐字节相同。`--only` 点到矩阵外的 missionId 拒绝整 run 而非忽略，接受——那基本只会是打错字。ankh-guard 的 flake 又拦了它一次 gate（expected 190 observed 178，单跑两次都过），仍归 mainline。
- **T24**：极性归 rubric、verdict 契约只加可选 `ratio`，与追加文案一致；协议 v1-rev4 双语，两个 verdict 示例各钉夹具。权重表只有 `{task, id, weight, negative, kind, axis}`，实测 69 条判据里判据文字与 evidence 命中 0 处，泄题闸不受影响。报告对 ratio 做 `total > 0`、`0 ≤ passed ≤ total` 的边界检查，越界按缺失并在附注点名；表缺席时明说「极性未知」而不是显示成「没有缺陷」。pilot 副本上 F2 × codex × rep2 的 A-N2 进了缺陷清单、得分 18 → 17、加权 35；加权列没出现在 summary 是因为 pilot A 没记环境指纹、比较一节被诚实闸关着，不是实现缺口。两条接缝：T19 的探针仍把比例写在 evidence 前缀（T19b 改），权重表不含 `veto`（X-no-patch 读成 0 权重正向判据，暂无消费者）。`pass` 与 `passed === total` 的一致性校验不归 T26（datasets 看不到 verdict），追加给 T28 的 readVerdictFile。

**第三波验收（2026-09-08）**：T26（`b37633a`）、T27（`c8ba619`）、T28（`a6395e1`）、T25（`25e6196`）、T17（`8efac1c`）依次合入 main。前三条彼此文件不重叠；T25 与 T17 在 local-agent 与四个 provider 包重叠 24 个文件，冲突八处（五个 README sidecar、两个 index.ts 的导出 / 导入清单、一个 tsconfig 的 files 列表），全是两边各加一项，协调者按两边保留解决，sidecar 按合并后的 blob 重录。合并态在验收机上重跑：local-agent 204、codex 124、claude-code 106、kimi 143、dsh 101、tool-subagent 15、eval 275、datasets 114 全绿，八个包 build 通过。题库侧 T19b：`i3-probes-b`（`2142daf`）经临时 worktree 并入 `i1-walk`（`22bc6bb`），共享检出 HEAD 未动；用 T26 的新校验器跑该分支：0 error，45 条 warning（41 条 UNREGISTERED_FILES 与基线相同，3 条 RUBRIC_REF_DANGLING，1 条 OBJECTIVE_NO_PROBE）。

- **T25**：codex 回读失效的根因不是并发而是尾窗——turn_context 写在回合开头，回读只扫末尾 64 KB，一轮事件一多就被挤出窗口，38 KB 的 smoke 整文件在窗内才读得到，评测格 100–500 KB 读不到。修法是尾扫不到就补一次有界整读，并把本轮 cwd 算进定位，窗口有歧义又对不上目录时宁报缺位不报邻居。尾窗那一半用失败 run 的真实 506 / 488 KB 文件验证（undefined → gpt-5.6-sol），并发那一半用两条同时起的真委派验证；真机端到端跑出 >64 KB 一轮要更大的工具输出，没花那个 token，接受。顺带修的 usage 全 null 是另一半：门面在 settle 时就丢了 onProgress 路由，而 exec provider 的 settle 观测在那之后才算出来，现在路由有界驻留 60 秒。`credentialState` 只到 present-unverified 一档是对的——活性由 T23 的就绪委派验。
- **T26**：按判定布局 opt-in，判定约定之外的题集报告逐字不变。规则与编排器的 rubric / 探针选取逐字一致，两种布局都经 register 映射解析。在 F3 补叶子之前的 commit 上复现出 RUBRIC_NO_ITEMS，与 pilot A「判官全跳过」的事实对上。三条交出：`validate --commit` 是死参数（动词只读 HEAD），归 datasets 人体工学；`dataseek.rubric/2` 的 axes 没有形状（F2 嵌套 map、F3 / P0 列表，三份的叶子 axis 都索引不到），所以本次只查 axis 存在；`schema_version` 无人校验且已漂（F2 /2、F3 与 P0 /1，items 结构相同）——协议侧要么声明 /1 与 /2 叶子层同构、版本只是标签，要么钉死 /2 与 /1 的差别，未定前不加规则。建议里 F3 的三条悬空引用与 P0 无探针归 T19c。
- **T27**：none 下 apply 记一条日志就返回，不注册工具也不挂 provider 生命周期监听。与文案不同的一处是对的：applyEntryPatches 对 config 整值替换而不是深合并，只写 `tools: none` 会抹掉 provider bundle 写的必填 `provider`，三行都重抄了 provider / toolName 并带 name 守卫。36 个工具的清单不只靠 T21 的记录，同一实例叠 overlay 强推回 all 得 39，差集恰为三家委派工具。第四家 `subagent_dsh` 没有配置行——DeepSeek 开关 ON 时控制器用写死配置动态挂载，profile 层够不着，默认关所以清单里本就没有；要彻底关得改 provider 包，记为交出项。附带观察：`--dump-config` 有两条既有 loader 警告，两个 provider bundle 想 disable 的官方行在这个组合里不存在，归 profile 清理。
- **T28**：两个 verify 层镜像题库布局物化，题内探针在题库与物化目录里用同一条相对路径 import 共享库；题集级探针对每题各跑一次，cwd 是该题 verify 层的根。退出码取 3 不取 2 的理由成立：2 是 getopt 的用法错误码，本包夹具探针缺 `--cell` 正是退 2，读成「判不了」会把每次误调用都咽下去。先回填后校验，探针可以整个不写 task / by，写了不一致以编排器为准并记 overwritten；追加的 ratio 两条数值检查在同处，部分行坏仍交出好行。gate 只挂在 ankh-guard 的 inventory mismatch，干净 main 上逐字复现，其余每步单独跑绿，接受。三格实跑：共享探针从「一次都不跑」变成每格各跑一次，但 outcome 是 probe-failed——题库还退 2；实施者在游离 worktree 预演了 2 → 3、删副本、改 import 三步，判定条数逐条相同。这三步没人认领（T19b 的文案没写），记 T19c。
- **T17**：门面 `exec: {container, workdir, env?}` 随已 stage 的 intent 走，四家各在唯一的 spawn 处换成 `docker exec`，解析、settle、回读、记录零改动。与文案不同的一处是对的：`-e` 只带名字、值留在 docker 客户端环境里由它解析——`K=V` 会把子 dsh 的 API key 放进宿主进程表，Linux 上 /proc/*/cmdline 全局可读；name-only 语义先在 docker 28.1.1 上实测过。env 必须点名容器内作用域目录（CODEX_HOME / CLAUDE_CONFIG_DIR / KIMI_CODE_HOME / DSH_HOME），否则起进程前 fail loud，照转宿主路径会让 CLI 从空目录起步且原因不出现在任何输出里。容器轮 exec-only、无成员通道，两条都明确放弃。dsh 自动补 NODE_OPTIONS 并跳过宿主侧子 profile provisioning（符号链接在单元里解析不到）。四家容器内真委派：codex 与 dsh 完成且回读到模型；claude 是 OAuth 过期，宿主对照同一条消息（第一次对照的 401 是验证脚本用 process.env 而不是 scrubbedParentEnv 当基底漏了本会话的 key，已更正）；kimi 仍是 T16 那条配额。「CLI 驱动抽成独立包」推迟，重新考虑的条件是出现第二个消费者。**交回环境侧四条**：镜像要备好 dsh 家族 headless bundle 及依赖闭包（自带的 in-box headless 不认 `--session-id`）；整份作用域目录 bind 进单元会把宿主专用设置带进去（claude settings.json 的 https_proxy 在容器里 Connection refused），挂什么由调用方备好；白名单缺 console.anthropic.com（claude 续期链末端 403）；kimi 账号配额未变。前三条进 T20 / T22 的文案。
- **T19b**：D-N1 选 D1 而不是 F2 的 A3（dimensions.md 里 F3 不判 A3），F3 每轴负分额度都占满，所以在 D1 开 −2 预算，negative_max −12 → −14，正分 100 不动；docs/dimensions.md 在分支范围之外但 rubric 的 validation.note 明写与它逐轴对齐，只改一边立刻漂移，同步改了那一格，接受。两题 core 口径统一含 G1，理由写进 verify/README：G1 在 standards.yml 里就是 core 的一条，C1 问「达成多少条」、否决问「还算不算数」，两种用途不矛盾；F2 的 G1 从 X-no-patch 取反补上并写进 evidence。ratio 三条规矩都落实：pass === (passed === total) 34 条无一例外，total 记扣除防稀释之后的数（F3 C2 5 → 3 在判定方一侧），evidence 里比例数字 0 处。为拿带 ratio 的 VERDICT_SCHEMA 重建了 dsh-eval 的 lib/（gitignore 产物），无被跟踪文件改动。

交出 mainline 的累计清单又长三条：ankh-guard 的 lane inventory mismatch 本轮拦了 T26 一次、T28 一次（干净 main 复现）；datasets `validate --commit` 死参数；协议 `dataseek.rubric` 的 axes 形状与 schema_version 语义。profile 侧一条：`--dump-config` 的两条 tool-subagent 官方行不存在的 loader 警告。provider 侧一条：`subagent_dsh` 的注册开关要进 local-agent-dsh。

**第四波验收（2026-09-08）**：T20（`0639947`）合入 main，从 `17e0ce8` 开出、无冲突；合并态 eval 301、lab 124 在验收机上重跑全绿，双语 224 对同步。题库侧 T19c：`i3-probes-c`（`e90aa42`）经临时 worktree 并入 `i1-walk`（`fef040a`），共享检出 HEAD 未动；新校验器 0 error，RUBRIC_REF_DANGLING 与 OBJECTIVE_NO_PROBE 归零。

- **T19c**：三步机械改动如预演——EXIT_NOT_JUDGEABLE 2 → 3、no-patch.sh 两处 exit 3、六个探针 import 改题集级路径、副本 1434 行删光、`--check-shared` 撤掉；用法错误保持 exit 1。用 main 的真实运行器（tsx 直接 import judge.ts 与 datasets 服务面，未复刻）跑三格：共享探针与 verify-rollup 全记 probe-skipped，题内探针 judged，逐格 9 / 5 / 5，overwritten 与 dropped 皆空。三条要记住：一、**P0 刻意不 import 共享库**——register 布局的题物化后判定目录在 item 与 display 之间多一段 verify/（`items/P0/verify/checks/probes/x.mjs`），题库里没有（`items/P0/checks/probes/x.mjs`），相对路径差一层；任何用 register 布局的真题都会踩，运行器要按题库真实路径物化，记 T20b。二、F3 题眼标题的分数随 id 改了（`B2-3（5 分）` → `B5-1（3 分）`），rubric.yml 一字未动；散文里另一处「题眼 A2-1（6 分）：不给用户增加负担」按内容应是 A4-1，T26 不报（id 存在），未动，留给下一次碰 F3 散文的人。三、`dsh-datasets validate` 忽略 `--commit`（`resolveCommitAt(scope, undefined)` 永远走 HEAD），T19 / T19b 回报里「对基线无新增警告」的对比其实两边都在量 HEAD，结论数仍对；本次改前改后是拿临时 worktree 量的。
- **T20**：LabFace 八个动词、计划 `unit` 段、条件 `unit.scopedHome`（契约 v1-rev6 双语 + sidecar + 夹具）、执行器接口、`destroyUnit` 唯一——run.ts 与 judge.ts 里没有 docker 字样，force 只出现在探活单元那一处。真 docker daemon + 真 lab / mission / datasets 服务跑 P0 一格两次：不带 finalize 的那次 archived 后 release 被闸拒绝、容器仍在、记 unit-retained；带 finalize 的那次 releasable → release → released，容器已删，`docker ps -a --filter label=dsh-lab.managed` 为空；lab status 的 TASK 哈希与 mission 清单 sha 一致；报告四条不变量里「环境一致」首次 ok（pilot A 整轮 unverifiable）。三处偏离的裁决：一、**没上 3171、没拉真 CLI**——委派那一步由容器内 docker exec 写产出，凭证目录是占位文件。编排全流程是真的，CLI 在同一镜像里起得来是 T17 实测过的接缝，本次改的只是带 exec 还是 cwd，测试在 argv 层钉住。按「pilot 验机制、少花 token」接受，但 I3 完成判据的「容器内一格走完全流程」只算做了编排半边，真 CLI 一格归 T22 第 4 步（本来就要跑），报告的「受试对象一致 ⚠️ 无模型回读」正是这半边缺席的痕迹。二、**lab 动了三处**（约定只加不改）：`AcquireSpec.ownWorkdir`（`docker run --workdir` 把缺失目录建成 root，非 root 单元写不进自己的工作区）、/run/dsh-lab 根可写（否则 verify 在非 root 单元上死在自己的 mkdir）、verify 把材料交给单元用户（否则它自己的 rm -rf 逐文件失败，答案键留在单元里）。三处都是「不改就跑不起来」的 T18b 同类硬伤，各带测试、README 双语、sidecar，接受；ownWorkdir 不入指纹，它是单元自己用户的权限事实，eval 路径上恒为 true。三、**四家横比「环境一致」会 violated**——复合指纹含 env 键名与挂载 target，四家的作用域变量与容器内路径各不相同。实施者判归 I4，不同意：T22 第 5 步的四家同一题就靠这张比较表打开，不改就又是一份拒绝比较的报告，记 T20b。两条小的都接受：两条路径的物化哈希算法不同（run 内可比、跨路径不可比，报告两种字段都读）——T20b 统一；verify-translation-pairing 的 glob 加 docs，协议文档的 sidecar 从此受检。

**第五波验收（2026-09-08）**：T20b（`d623952`）与 T30a（`8633996`）合入 main，两条都从 `6b8a045` 开出、文件不重叠、无冲突。合并态在验收机上重跑：eval 311、lab 127、local-agent 204、codex 144、claude-code 127、kimi 166、dsh 101 全绿，双语配对同步。

- **T20b**：「环境一致」比的是环境类——单元分量去掉该条件的作用域挂载与 env 键，经 lab 新增的纯动词 `fingerprintOf` 算，标签沿用 lab-env；真 docker 上四个只差作用域项的条件各跑一格全部 released，四格环境类一致、四个单元指纹各异、被排除项逐格印出（dsh 多一个 NODE_OPTIONS）。物化 sha 两条路径统一为 eval 的算法，宿主 archived 与容器 released 的同题同 commit 是同一个数，lab 那份哈希改存 populate-manifest.json。register 布局按 datasets.show 顺带返回的 descriptor 判定，面上可选，不报即退回约定式；夹具题在两种布局下都经同一条相对路径 import 到题集级 lib。pilot-a-round1 复算 results.jsonl 逐字节不变。一处做不成：`refs.unitFingerprint` 写不进 mission——setRefs 只写 resource / fingerprint / sessions，其余静默丢弃，写了等于一个像记录的空操作；单元完整指纹改由该格 orchestrator ns 的 unit 注解（连同 envExcluded）与 lab 归档 manifest 承载，报告读注解。给 AttemptRefs 加第四个键是 mission 的改动，交出。
- **T30a**：四家里三家拿到可选 `model` 键：codex 一次性轮次 `exec -m`（排在 resume 子命令前，`exec resume` 不认自己的 -m 已实测）、常驻 `app-server -c model=`；claude 四种 argv 变体都带 `--model`；kimi 一次性 `-m`，常驻 acp 无旗标改为起进程前就地改写作用域 config.toml 的 default_model（幂等只动一行）。dsh 不给键：无头子 dsh 的启动面只接受 --session-id / --resume / --serve，模型来自宿主 agentDefaultModel 的当前选择，要按次传模型得先在 dsh-local-agent-dsh-headless 开路——README 写明「dsh 换模型 = 换宿主实例默认模型」，归 T30b 的前置。真机两轮回读：codex 与 claude 写键即回读到该模型、不写回到原值；kimi 两轮 argv 与请求记录都对但账号当月额度已尽、端点 403，模型选择验证到请求记录为止。两条判断接受：常驻驱动在 runtime spawn 时绑定模型，已持有 runtime 的成员保持原模型到回收（评测用的一次性轮次每轮取值）；kimi 键语义改为每轮生效，树内无 profile 钉过它，README 双语加了醒目警告。

T22 中途回报（2026-09-08）：第 1–3 步完成——镜像备好 dsh 家族 headless bundle 与 238 个依赖符号链接闭包、白名单加 console.anthropic.com、出网代理烧进镜像不占 env 键（否则复合指纹要多背四个与条件无关的键，接受）、泄题断言按整条路径给这一个包开例外并正面断言；凭证改成 `--creds-root DIR/<条件 id>`；codex sandbox 改 danger-full-access 并从装好的 profile `--dump-config` 验过。四家密封镜像里最小 exec：codex 与 dsh 答 4，claude OAuth 过期，kimi 授权失效且失败的续期把备好的凭证清空（与配额 403 是不同错误）——凭证目录必须是副本，宿主重登后要重新 stage。第 4 步发起通道协调者定为进程内 tsx 驱动（与 T20 同类偏离，回报写明），codex 的 pin 在 3171 上单独验；第 5 步必须走 3171 实例，让容器化后的实例路径（ctx.lab 经插件、`--creds-root` 与计划 unit 段经 /eval run）验一次。第 4 步预算只覆盖阶段一二加盲评（约 200–620k）；**阶段三是题库数据缺口**——缺 prompts/stage3.md、schemas/stage3.json 的文件引用形态、L2 四个驱动型探针，补齐是 T19 + T28 量级的两个任务，跑通后单格约 1.5–4M token、2–6 小时——记 T19d，I3 收口不等它，跑不跑由预算另定。

**第六波验收（2026-09-08，T22 第 1–4 步）**：profile 分支 `feat/web-eval-container-pins`（`f34b290`，已并 main）合入 main `126990b`，只动 profiles/web-eval 四个文件，gate 通过；题库 `i3-env-b`（`73a0b88`、`0bcd824`）经临时 worktree 并入 `i1-walk`（`913be11`），共享检出 HEAD 未动，新校验器 0 error、43 条 UNREGISTERED_FILES（新增文件），两条分支凭据形状 grep 无令牌本体。

- **做成的**：镜像 `eval-env:pinned` = `sha256:4da0cfff…`，备好 dsh 家族 headless bundle（@khorsheed/dsh-local-agent-dsh-headless@0.1.0-rc.6）+ 238 个 @deepseek-ai 符号链接闭包 + commander pin；两炉 --no-cache 内容指纹 15 行逐行相同（含新加的 egress / dsh-entry / dsh-closure）；白名单加 console.anthropic.com；出网代理烧进镜像不占 env 键。四家密封态最小 exec：codex 7.5 s、claude 5.4 s、dsh 63 s 都答 4——dsh 此前是假绿（跑的是不认 --session-id 的 in-box headless），claude 是 T17 记的缺口，两条首次真通；kimi 授权失效要重登。run-20260908144139-1ze5（F2 × codex × rep1，阶段一二，--finalize）released、容器已删、10.6 min / 2 轮；四条不变量首次全 ✅（受试对象一致：回读 gpt-5.6-sol 与声明一致）；权重表 39 条进 bundle；缺陷清单首次在容器内打开——A-N2 −2，host_change_risks 2/6 条 worth-the-cost，正是 pilot A 只能定性记一笔的 G11。比较节仍关着，单条件无可配对。日志 `docs/pilot-b-log.md`。
- **两处越界都接受**：一、改了四个条件文件——不补 `unit.scopedHome` 容器路径起不来（SCOPED_HOME_MISSING），codex 的 permissions 同步 danger-full-access 是第 3 步明写的；条件哈希从此与 pilot A 不同，对。二、F3 rubric.md 除追加要求的题眼指认（A2-1 → A4-1）外多改一句：「全表权重最高」不成立（C1 18、C2 7 更高，但那是阶段三四的汇总行），限定成「阶段一二判读里权重最高」；判读文字与权重未动。
- **途中两个坑**：一、creds/stage.sh 会灌空壳凭证且不报错——macOS keychain 同名 service 取第一条，这台机器那条 token 是空串，灌进单元后报「OAuth session expired」，与真过期逐字相同，宿主对照却答得出 4，读起来像容器出不去网；已改成逐个候选验 token 非空、取不到当场失败并打印该跑哪条 login。二、**容器轮的 rollout 写在 bind 进去的凭证目录，而 local-agent 回读读 homeDir(家名)**，两个宿主目录不是一处，指错不报错、只让回读永远为空——就绪检查报 ready, model —，报告「受试对象一致」只剩 ⚠️；T22 在 tsx 驱动里把 homeDir 指向凭证目录才拿到那条 ✅，3171 的产品路径没有这个手段，第 5 步会原样踩上。根因在 T20 的文案：T17 定的是「scoped home 是宿主目录，rw bind 进容器，回读直接读它」，T20 另立 `--creds-root DIR/<条件 id>` 与之分叉，是协调者的失误，记 T20c。
- **剩余缺口**：判官条件不进就绪检查（本轮判官两个样本全掉——判官那条链没构建——run 却照走到 released，同类失败在选手条件上会拒整个 run）→ T20c；token 四列缺席（G14 下半截，第 5 步走真门面时复核）；reportAuthFailure 收到普通流事件（日志里 `auth-failure(codex): {"type":"thread.started"…}`）→ local-agent 交出；kimi 重登后必须重灌——失败的续期会清空凭证目录，实测第二次直接 no credential configured；阶段三是数据缺口（T19d），output_schema.stage3 还是协议已退役的内联草记，wants 的 delivery.md 与 run 循环收的 <stageId>.json 对不上，L2 四个驱动型探针（room-identity / nonce-flow / dispatch-trace / stats-crosscheck）连文案都没有；P0 探针改回 import 题集级 lib 留到第 5 步后。

**T20c 验收（2026-09-09）**：`fix/eval-scoped-home-readiness-judge`（`437d98c`）合入 main `28c0c17`，只动 packages/eval 与协议文档，eval 316 全绿，gate --all 通过。`--creds-root` 删净；容器路径的挂载源取 LocalAgentFace 新声明的 `homeDir(家名)`（local-agent 服务类原有，只在 eval 的结构面上声明一行，local-agent 零改动），面上缺它时 fail loud 而不是静默挂错。真机一：P0 × codex 容器内真 CLI，就绪检查回读到 gpt-5.6-sol，报告四条不变量全 ✅，`comparison allowed`——报告第一次愿意做比较；run.meta.readiness 带 role / observedModel / unit。真机二：judge 换成 OAuth 已过期的 claude，`READINESS_FAILED · 1 of 2 · judge claude-exec … exceeded 120s and was cancelled`，run 记录未创建；此前同一份计划会走到 released 而判官命名空间为空。契约 v1-rev7 只改 `unit.scopedHome` 的描述，条件文件不动。写明的边界接受：homeDir 按家给不按条件给，同一家的两个条件今天共用一份作用域目录，只能在模型、推理强度这类不落在作用域目录里的因子上不同；「每条件一份」等 I4 的 T29。

**第七波验收（2026-09-09，T22 第 5 步）**：`feat/web-eval-container-pins`（`99bcb43`、`fb0d96f`，已并 main）合入 main `9396b2e`，只动 cordis.patch.yml 与 eval 的 slash.ts，eval 316 全绿；题库 `i3-env-b`（`f5e9bfc`…`b869cb8`）经临时 worktree 并入 `i1-walk`（`511e096`），共享检出 HEAD 未动，新校验器 0 error、46 条 UNREGISTERED_FILES。

- **做成的**：3171 实例上 `/eval run` 发起，P0 × 四家 × 1 rep（run A）四格 released，容器全部销毁；就绪检查四家都带回读模型（codex gpt-5.6-sol、claude claude-opus-5[1m]、kimi kimi-for-coding、dsh deepseek-v4-flash）；四条不变量全 ✅，「环境一致」下四个单元指纹各异、被排除项逐格列出；comparison allowed，六对配对全部列出并如实标「不可排名（n=1 < 3）」；效率表 token 四列首次在产品路径上有数（claude 输出 41k / cacheRead 702k，codex 9.8k / 235k，dsh 52k / 606k，kimi 9.4k / 297k）——第 4 步四列全空是 tsx 驱动那半的事，不是编排器缺口。run B 三家 + 判官：判官就绪通过，llm-draft 30 + script 3，双采样 κ 1.000（P0 判据无争议，不能当判官一致性的证据）。途中被拒的就绪原文都拿到了：claude 授权链断、kimi 实跑 kimi-for-coding 与声明 k3 不符、dsh cliLaunch 是宿主绝对路径、判官实跑 v4-flash 与声明 v4-pro 不符、JUDGE_IS_PLAYER——T23 的设计在产品路径上第一次完整兑现。
- **两处越界都接受**：一、slash.ts 的拒绝路径原先只留 error.message，把逐条就绪原因与 EvalRunRefused 的 diagnostics 都扔了——「打印那个 401 而不是『某条件失败』」正是 T23 的要点，产品路径上本来拿不到，改对了；分支声明只改 profile，实施者已把它单独成 commit。二、撤 claude 的 `proxyUrl` pin：provider 把它写进作用域 settings.json 的 env 块，T20c 之后容器轮挂的就是这个目录，127.0.0.1:6152 在单元里当场 Connection refused；provisionClaudeHome 在 proxyUrl 未配时直接 return 不退回宿主环境，单元出网由镜像烧进去的白名单代理给。与决策 5 不矛盾——决策 5 pin 的是端点（baseUrl 仍钉着），proxyUrl 是「从哪台机器怎么出网」的宿主事实，不该写进会被挂进单元的目录。README「当前 pin」段已由协调者同步。dsh 的 `headlessBundleDir` 与 `cliLaunch` pin 成宿主与单元里同时成立的路径：provisionDshSubProfile 写的是指向宿主安装的绝对符号链接，单元里悬空；「容器轮跳过 provisioning」防不住已经写在那儿的那条（判官走宿主 dsh 委派，就绪检查一探就重新 provision）。这是接缝不是答案，scoped home 该不该自足交回 local-agent-dsh。
- **交出**：local-agent-claude-code 两条——`syncClaudeCredentialFile` 用 `security find-generic-password -s <svc> -w` 不带 `-a`，同名 service 多条时取第一条，本机第一条是 token 全空的历史残留，于是 login 成功、status 已认证、每次委派报「OAuth session expired」，与真过期逐字相同；凭证两个存储 + 单向同步 + 容器轮会写文件，续期链一分叉即自毁，毁的是实例本体那一份。local-agent-dsh 一条：scoped home 里的 headless bundle 链接是宿主绝对路径。kimi 失败续期清空凭证目录要重登（已知）。**冻结决策 9（判官 ≠ 选手）与「四家同一题」互斥**：四家都当选手时判官没有第五个模型可用，本轮只能拆成 run A（四家无判官）与 run B（三家 + 判官）；要么第五个模型，要么 T30b 的按次委派模型让判官与选手同家不同模型——归 T31 一起定。eval / profile 三条小的记 T29b：`/eval run` 挂在会话轮次上，发起端一断整个 run 中止，CI 里没有浏览器，比 pilot A 的 G2 更硬；plan 路径不展开 `~`；install.sh 的 dsh 前置检查在最后一步才做，前面 pack / build 白做并留下半装 profile。
- **I3 收口（2026-09-09）**：README I3 行的完成判据「容器内一格走完全流程，release 经闸」由 T20c 的真机一（P0 × codex 真 CLI 到 released、闸拒绝过一次）成立；「四家在容器内跑通同一题」由本步 run A 成立。剩在 I3 表里的只有 T19d（阶段三的数据缺口，另批预算）。四不变量首次全部成立、比较节首次打开、token 列首次有数，都发生在同一份 run 上；pilot B 的结论仍是缺口清单而不是名次（P0 是占位题）。

验收：README I3 行；lab `status` 表里四格 TASK 哈希一致；release 被闸拒绝过至少一次且容器仍在；F2 阶段一二的 `script` 源非空且报告的负分判据方向正确。

### I4 · 放宽因子

目标：同 harness 两条件的配对结果。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T29 ✅ | 代码 | local-agent：作用域目录按 scope 命名，每次委派可指定 scope；登录、状态、记录、回读、exec 挂载源都跟着走；eval 条件加 `scope` 字段 | 无 | 合入 main `0d7b91b`（2026-09-10）；`homeDir(name, scope?)`，命名 scope 落 `<家名>@<scope>`，名字只许 [a-z0-9-]，读即物化；委派、记录、resume 核对、四个动词的 `--scope`、按目录取的 effectiveSettings 齐全；带 scope 撞 live 直接拒；真机缺省与命名各一轮各落各目录，命名 scope 自己 device-auth；两条件 run 就绪各过、b 格 archived、a 格被代理掐长流跳过（网络非机制）；缺省 scope 下 pilot A 复算逐字节相同；题库 `t29-scope` 并入 i1-walk `ce31e92` |
| T30a ✅ | 代码 | local-agent：四家 provider 插件配置加可选 `model`，不写 = 今天的表现，写了每轮委派以它起 CLI；改配置后新 run 走新值、进行中的 run 不受影响；`effectiveSettings.model` 报配置值并由回读核对；provider 设置卡「默认模型」（dev 域 UI，自由输入加最近值，不硬编码模型目录） | 无 | 合入 main `8633996`；codex `-m` / claude `--model` / kimi `-m`（常驻改写 default_model）；dsh 无按次传模型的启动面，不给键；真机 codex 与 claude 两轮回读命中，kimi 到请求记录为止（配额） |
| T30b ✅ | 代码 | local-agent：委派级 `model`——首轮指定、记录、resume 不换；四家 argv 或配置写入；dsh headless 加 `--model`；eval 把条件的 model.declared 作为每轮的请求模型传下去 | T29 T30a | 合入 main `e43faf0`（2026-09-10）；resume 带 model 抛错而非忽略；dsh 补上插件键与设置卡那一行；协议 v1-rev9 只改描述；真机 codex / claude / dsh 各轮回读等于委派级请求；判官 v4-pro + 选手 v4-flash 的 P0 计划就绪两条各回读到自己的模型 |
| T30c ✅ | 代码 | local-agent + eval：settle 观测加工具调用计数（次数 + 按名分布），效率表多一列；每轮的 token 与工具调用落进 bundle 的 `report/usage.jsonl`，计价留给 bundle 之外的非模型环节 | 无 | 合入 main `fc5141d`（2026-09-10）；四家都在已走过的折叠分支里数，byName 记各家自己的名字（codex 是 command_execution 不是卡片上的 Bash）；kimi / dsh 按本轮不按镜像窗口；usage.jsonl 每轮一行，多 `attempt` 与 `counted` 两列，效率表从 counted:true 加总复现；未报计数打「—」不补零；codex 的 function_call 未数（0.144.0 的 exec 流里 provider 本就不解析它）；只有 exec 路径报 settle 观测 |
| T29b ✅ | 代码 | eval + profile：`/eval run` 起一个 jobs 后台任务立即返回，发起端断开不中止，Remote 入口让 CI 无浏览器也能发起；plan 与 `--out` 路径展开 `~`；install.sh / update.sh 的 dsh 前置检查前移并覆盖预设残留 | 无 | 合入 main `cdba6f4`（squash，2026-09-10）；三扇门一条取消路；真机：起 job 后发起端退出、run 在实例里继续、另一进程读回全程日志；`dsh-eval run --instance` 从终端起 run 到 completed；install.sh 缺 dsh 时第一步退出、预设未碰。**格子到 archived 没拿到**：3171 跑 0.1.1-rc.2，main 的插件已迁到 0.1.2-rc.1 API（16d5602），resume 轮报 childSession.snapshotEvents is not a function——宿主线不匹配，不是 T29b 的缺口 |
| T29c ✅ | 运维 + 代码 | 评测实例上 0.1.5-rc.1：3171 用 rc-0.1.5-rc.1 工具链重装；评测家族 minHost / verifiedHost 标签对齐；跑迁移后回归清单第 2–6 项 | 无 | 合入 main `477c65f`（install.sh 宿主线前置检查 + 六包 compat 标签，`bbc66b3`、`a38bd4e`）；题库 `i4-host-line` 并入 i1-walk；3171 在 0.1.5-rc.1 上：24 成员 177 行 pin 逐条核过，回归第 2–6 项全部 ✅——第 5 项由 T29d 在 job 门起的容器格 P0 × codex 到 released 一并补齐（2026-09-12），第 6 项的 dsh 回读断口归 T30d 修好；worktree `../dsh-plugins-wt-eval-host-line` 是 ankh-guard 的 credentialRepo，重新 adopt 前不删 |
| T31 ✅ | 代码 | eval：`conditions provision` 写 lock（作用域就绪 + effectiveSettings 与声明逐项核对 + home.sha）；`conditions list / diff` 数据面（只展示与 diff，不给选）；决策 9 放宽：多判官面板、每格由谁判进报告、自评格标出不拒绝 | T29 T30b | 实施者自行合入 main `3d139f0`（`adbc9c2`）+ 修正 `4632738`（2026-09-11）；真机 lock 写入与拒写、diff 只差 scope、PROVISION_MISMATCH → unready、真实数据上第一个 ready 条件；判官面板真跑：双采样 κ 0.615、跨判官 κ 1.0、自评 5 条标出；CLI 的 provision 只能拒绝并指向 /eval（进程外问不到 local-agent） |
| T32 ✅ | 代码 | capability-catalog：`snapshotFor(presetId)` + 能力清单的规范化哈希；eval 把编排实例的能力哈希记进 run.meta；sub-dsh 的能力面按 scope 的子 profile 组 preset roster，条件的 `preset` 字段从此可被核对 | T29 T31 | 合入 main `9b8aaaa`（实施者以为已合，实际只并了 main 进分支）；三个 scope 两个哈希，改名不动、改正文动；preset 在 sub-dsh 上只能加不能减——pilot D 是「同工具 + 不同技能」；能力哈希的实测留成 ProvisionOptions.capabilities 钩子，未接线时 lock 报 CAPABILITIES_UNMEASURED 且就绪拒 → T32b |
| T30d ✅ | 代码 | local-agent-dsh：session-mirror 与 records 认 0.1.5 的 `session.v3.jsonl.zstd`（按前缀匹配而不是写死文件名）——dsh 的 observedModel / usage / toolCalls 在新宿主线上全丢，挡着 pilot B | 无 | 合入 main `590c7b0`（2026-09-12，`b35dee4`）；新 `session-log.ts` 按宿主自己的规则解析代次（`^session(\.v[1-9][0-9]*)?\.jsonl$`，去 .zstd 后匹配，取版本号最高，同代压缩优先），镜像与 `/dsh sessions` 走同一函数，回读带 `sessionLogFile`；真机两条工具链各一轮：0.1.5 线回读到模型 / 用量 / 工具调用与会话列表，0.1.2 线不变；pilot-a-round1 复算逐字节相同 |
| T29d ✅ | 代码 | eval：job 起的 run 走容器路径——job 造的父会话没有 cwd，容器条件就绪检查报 the parent session has no working directory；起格前加一次出网自检（单元断网时 codex 跑满超时交回空回答，无任何网络错误） | T29b T20c | 合入 main `e5649df`（2026-09-12，`6821eb8`、`550ac70`）；job 起的 run 父会话拿 run 的 cell 根目录做工作目录，两条起法就绪原文相同；计划契约加可选 `unit.egressCheck{command,timeoutMs}`（协议 v1-rev11），就绪探针与每一格各在 acquire 后跑一次，失败以 EGRESS_UNAVAILABLE 拒整个 run、零委派；就绪窗口缺省 420 秒；真机：Remote 门起 job 的容器格 P0 × codex 到 released，四条不变量 ✅；停掉 eval-proxy 同一计划秒级被拒、原文点名代理；题库 `i4-host-line` 加验收计划并入 i1-walk `346a0c3` |
| T32b ✅ | 代码 | eval：/eval conditions provision 在实例内接 capability-catalog 的 snapshotFor 填 ProvisionOptions.capabilities，preset 条件才能就绪；CLI 路径照旧拒绝 | T32 | 合入 main `376838f`（2026-09-12，四提交）；`instanceCapabilityProbe` 读回 scope 子 profile 实际 roster 的 preset、核对两边指向同一目录、再 `snapshotFor`；就绪检查再量一次，过期 lock 报「preset changed after provision」并指回 provision；探针拒测也进 CAPABILITIES_UNMEASURED（T32 遗留）；真机两 scope 两哈希、改技能正文旧 lock unready、重 provision 过；validate 离线仍报 ready（接受，见验收记录） |
| T33a ✅ | 运维 | 3171 回到 ankh-guard 守着的健康态（启动器透传 stdout 给看门狗）、源码模式重装到 main `376838f`（T30d / T29d / T32b 与 eval 预设的 persona 修正落地）、capability-catalog 能量 `eval` 预设 | T30d T29d T32b | 2026-09-12 验收：启动器透传后看门狗 18 秒证到就绪（此前四次 60 秒超时）、canary PASS，attempt log 由看门狗就地脱敏、无明文 token；`install.sh --source --fresh` 从 `b7fb020` 打 27 个成员、零 npm；四项 pin 在位，三个 core 行不带 tools、tier 在 eval 预设三行上；四件核验齐：run.meta.orchestrator 带 capabilities（caps 面 37 工具 3 技能）、dsh 委派回读到模型 / 用量 / 工具调用、T29d 计划到 released、eval 预设 37 工具含三套机制工具而 standard 28 个一套没有；deployment proof 因缺 preflight 绑定 FAIL、credentialRepo 仍指 T29c worktree——放行方案见验收记录（专用 worktree，不指主检出）；re-adopt 已做：活 spec 指 `../dsh-plugins-wt-eval-guard`（guard/eval-3171 @ b7fb020）、profile web-eval、带 preflight 块，看门狗从稳定目录起，restart evidence 与 composition preflight 首次 PASS；deployment proof 仍 FAIL——ankh-guard 要求 harnessRoot 也是 git 检出而工具链目录是 npm 装的，归 ankh-guard 线；T29c worktree、两条旧分支、主检出的 .dsh-guard-state/ 已由协调者清掉 |
| T33d ✅ | 代码 | eval / mission / datasets / lab 四个 CLI 的入口守卫拿 `process.argv[1]` 不 realpath 就与 `import.meta.url` 比——经 pnpm `.bin` 软链调用时永不相等，主体不执行、退出 0、零输出；lab 的 CLI 路径把 `dsh-mission is-releasable` 的退出码当释放闸，空跑的 0 会被读成放行 | 无 | 合入 main `a526d55b`（2026-09-17，`9ba18711` + `4e25c6ed`）；四处守卫比对前 `realpathSync(argv[1])`，抛错则按原字符串（旧行为）；四包各一条 tests/cli-entry.spec.ts 经软链 spawn 入口、无参数答 usage + exit 2；修前经 .bin 的 `dsh-eval --help` exit 0、0 字节，修后 6429 字节、首行 usage，`dsh-mission --help` 的 exit 2 来自主体；`import.meta.main` 因 engines 容 24.0 / 24.1（那里是 undefined）暂不用，写在 Note；盲区：eval / datasets / lab 只测源码平面（tsx），构建入口的回归两边都抓不住，Note 记了；接手了 9/12 的残留 worktree，改法与文案一致；gate --all 全绿 |
| T33e ✅ | 环境 | 题集镜像 `eval-env:pinned` 上 0.1.5 线：dsh 闭包从 rc-0.1.5-rc.1 工具链打、headless 包从主检出源码打 tarball 喂进镜像（不从 npm）、三家 CLI 版本与宿主对齐；四家容器就绪各过一次（只到就绪） | T33a | 题库 `i4-env-0.1.5`（三提交）并入 i1-walk `0cd3f7b`（2026-09-16）；镜像 `sha256:1fc8cd14…`，dsh 0.1.5-rc.1 落 /opt/dsh-toolchain、闭包 241 包、claude 2.1.272 / kimi 0.42.0 / codex 0.144.0 与宿主逐项相等，harness 源码树切 dsh-v0.1.5-rc.1 不再 build:lib（second_dsh_in_tree 记 lock）；包镜像快照 803e484d/958 → 004ac04b/1614 只追加一次密封；**根因比 T33b 的推测硬**：headless manifest 的 minHost 0.1.5-rc.1 高于旧镜像里的 dsh 0.1.1-rc.2，伪装成 provisioning 故障；headless 0.1.0-rc.6 两条线各一份、版本号认不了人，Dockerfile 改按 sha256 断言；容器轮就绪：dsh ✅（63 s）、kimi ✅、claude ❌（探针那一刻 .credentials.json 被清空——pilot-b-log G9 复现 → T55）、codex ❌（宿主轮也 error，auth 9/7 未续，根因未定）；第一跑是宿主轮（plan 无 unit 段，输出与容器轮一模一样）——回归清单加一条 |
| T33f ⏸ | 代码 | local-agent-dsh：sub-dsh 的 scoped home 在宿主与单元两侧都成立——宿主的 profiles/node_modules 愈合「补缺不换错」，同一 scope 先被哪侧碰过另一侧就坏；先出方案再改 | T29 T20c | **降为观察项（2026-09-16）**：T33e 证明 T33b 的失败根因是镜像里 dsh 版本低于 headless 的 minHost，两侧链混用是症状不是原因——dsh 在共用的默认 scope 上容器轮就绪通过。pilot D 若出现两侧混用导致的失败再做；文案保留 |
| T55 ✅ | 代码 | claude 容器轮把宿主登出：单元挂的是实例自己的 scoped home（可写），容器内续期消费了 refresh token，宿主再续被拒后 claude 清空 .credentials.json、实例随之登出（pilot-b-log G9，T33e 复现）。方案：claude 容器条件用容器专用命名 scope（T29 的 `scope` 字段），或挂载只读 + 续期不写回；先方案 | T29 T20c | 方案 `2ae0784d`、实现 `cba704ab` 合入 main `dbc76d7f`（2026-09-17）；定案 (a) 新者胜：syncClaudeCredentialFile 两边都读、按 access 过期时间比较，keychain 不比文件旧才写（新增 credentialAccessExpiry）；空壳治 / 删两路原样；两条 warn 不带 token，有测试断言；判定表 7 行各一测；判定步用伪造 token 的临时目录在 eval-env:pinned 上实测：容器里的 claude 2.1.272 认 CLAUDE_CONFIG_DIR、续期被拒即把文件清成空串 + expiresAt 0（与 T33e 形状逐字一致），(c) 只读挂载实测死路（projects/ 也在挂载目录）；eval 一字未动；claude-code 225；**活体验收待 3171 重装后在默认 scope 上做**（§三 补充）；(a2) 写回 keychain、(b) 命名 scope 作后续；顺带发现记 T64；**二期（同日下午，`a36cf6b6`）**：keychain 核对暴露第二处缺陷——keychainTimestamp 只认带空格的格式，security 打印的是紧凑 Zulu + 尾 NUL，所有 mdat 落 0、「最新写入优先」从未生效，3171 上 acct=unknown 的 9/16 旧条排在账号本人 9/17 新登录前面、每次同步都镜像旧代、重登也救不了；修：按真实格式解析、解析不了按最旧排（`49f14d2a` + `5a55ba45`），夹具改成逐字转录的真实 dump、三条新用例对旧源码全红；228；**T2 / T3 两次探针（09-17 16:27 与 09-18 01:19）**：文件侧修复证成——过期窗口里单元续期写回文件，宿主同步打出 AHEAD warn、文件未回退、实例未登出；但宿主轮随即失败：**macOS 上 claude 2.1.274 读写的是 keychain 不是文件**（三条证据：文件 access 未过期而宿主报续期被拒；失败那轮改写了 keychain 的 mdat；同一文件容器轮仍 ok），单元轮换让服务端把 token family 连坐作废，keychain 里那条随之失效，没有东西写回——完成判据第 4 条在轮换场景下不成立，Note 里「宿主会基于文件续期」的前提证伪。(a2) 写回 keychain 否决：security add-generic-password 的密文只能走 argv 或交互式提示，为修一条泄漏路径新开一条。**定案 (b)**：claude 的容器条件用容器专用命名 scope，宿主从不在该 scope 跑 claude，两边不是同一次授权、连坐无从发生；文件侧的新者胜保留（容器 scope 首次轮换后它的 keychain 项就与实际无关）。**第三步合入 main `a672db2a`（2026-09-18，`0c1d9780`）**：eval 加 claudeScopeDiagnostics，validate 与开跑前各查一次——容器化 claude 条件必须声明 scope（CLAUDE_CONTAINER_SCOPE_MISSING）、宿主侧条件含判官不得占用容器 scope（CLAUDE_CONTAINER_SCOPE_SHARED），只查 claude-code；claude-code README 按版本点名前提（2.1.236 写 keychain 读文件 / 2.1.274 macOS 读写 keychain / 2.1.272 Linux 读写文件）；题库 `i5-claude-container-scope`（`80ee5d2`）并入 i1-walk `90cf6a8`：新条件 claude-exec-c（只多 scope c-claude），四份容器计划换用，宿主计划仍用 claude-exec（scope 进条件哈希，不改旧条件）；反例第 3 步离线做完（三份计划 validate 分别 ok / MISSING / SHARED）；eval 830；**探针 1–2 通过，结案（2026-09-18）**：两个 scope 的 token 都已过期，容器轮（claude-exec-c，c-claude）8 s ready 并轮换（f3123dc2 → 6e203ea5，过期时间推后 8 小时），默认 scope 一个字节没动；随后宿主轮（默认 scope）claudeAuthenticated = true、0 warn、CLI ok——与前一夜共用 scope 时同一时序宿主报「续期被拒」相比，变量只有 scope 隔离；三份 Agent Note 互链；worktree 与分支已清。留坑：四份容器计划的 dataset.repo 指向旧检出（那里没有 claude-exec-c）→ T68。3171 再装一次后 **T1 绿（2026-09-17 16:13）**：指纹 f4b960b1 → c115fc1c，expiresAt 2026-09-17T13:31:20Z 与 keychain 该条 mdat 20260917053120Z 正好差 8 小时、refresh 窗口 10/08 → 10/15、access 未过期——两个修复各自的作用分得开（排序选中 9/17 那条，新者胜判 keychain 更晚而写入），3171 的登出状态自此愈合、没再重登；T2 / T3 见 §三 补充（三） |
| T33b ✅ | 运维 | pilot B：dsh × 两模型；pilot C：claude × 两模型——P0 先证机制与配对形状，真题预算先报 | T33a T33e | 2026-09-12 停在缺陷报告（根因后由 T33e 证实是镜像宿主线）；**补充二（2026-09-16）容器版跑了 2/3 格**（题库 `i4-pilot-b-container` 并入 i1-walk `768df21`）：两条 dsh 条件各挂各的命名 scope、各自回读到声明的模型（T30b 在容器轮成立）、判官双采样 κ 1.0；但计划在跑前被本任务之外的人加了 kimi-exec，环境类不再一致、比较未启用；第 3 格（dsh-v4-flash）撞 maxConcurrentUnits——不 finalize 的 run 每格留一个单元（→ T57）；两个单元未释放；真题预算已估（v4-pro 单格 F3 46–78 min / F2 62–93 min，output 22–45 万，flash 未测）停在放行点；C 等 T55。**2026-09-17 收口**：pilot B 以 T39 那次 run 为准（dsh × 两模型 × P0 容器轮，四条不变量全 ✅、比较节打开，两格 usage 都在 bundle 里），补充二那次是重复，补充四撤回；pilot C 不单独跑，等 T55 后并进第一次真题 run |
| T33c ✅ | 运维 | pilot D：sub-dsh × 两 preset（同工具、不同技能）——两 scope 各 provision、两 caps 哈希、P0 一轮；I4 三条判据里唯一没在真机 run 上证过的，跑一次 P0 即收 | T58 | **受阻收口（2026-09-17）**：容器轮里 sub-dsh 解析不到 preset——单元只挂 scope 目录，子 profile roster 的 roots 指宿主 preset 根；宿主轮能起但环境指纹 unverifiable、比较节不开。已拿到：两份 lock、两 caps 哈希（4/3 与 5/3 技能/工具）、conditions diff 三字段、就绪拒绝原文、容器内根因原文、单元起落归零；没跑 run（宿主轮多出的只是两格 token，比较节照样不开）。机制缺口立 T65，pilot D 随 T65 顺手收；原判据：P0 配对结果。**2026-09-18 收口（随 T65 第二步）**：run `run-20260918054718-8o0o`（3171 @ `4599ae89`）四条不变量全 ✅——环境一致那条拿到了：两格单元指纹相同 `lab-env:d58a1722f41f…`，各自的 /creds/dsh 挂载与 DSH_HOME / NODE_OPTIONS 作条件自有项逐格排除；比较节打开（逐题 Δ、bootstrap 95% CI、名次判定齐）。本轮 Δ 不作数：dsh-full 那格判官两次采样 stopReason error 被丢弃（就绪时判官 ready、事后 status 仍 verified，瞬时失败），Δ=4 是判官缺席的产物；按「只留必要测试」不重跑。报告在题库 `reports/pilot-d-preset-summary.md` |

T29（2026-09-10 文案发出，同日验收）：I4 的入口。同一家两个条件今天共用一份作用域目录（T20c 记的边界），模型之外的因子——登录身份、作用域配置——没法按条件分开；T30b、T31 都压在它上面。

**T30b 与 T29b 验收（2026-09-10）**：`feat/local-agent-delegation-model`（`3f67b7b`）合入 main `e43faf0`，五个 README sidecar 与主线撞了哈希、按合并后 blob 重录；`feat/eval-run-as-job`（`fa4782e`）以 squash 合入 `cdba6f4`——分支里混着五条 dsh-ankh-guard 自动打的 checkpoint 提交，一并抹掉；两条在 eval 的 run.ts / run.spec.ts / README 重叠，自动合并只剩 sidecar 一处。合并态 local-agent 224、codex 164、claude-code 151、kimi 185、dsh 124、dsh-headless 47、eval 347、脚本测试 107 全绿，双语 245 对同步。T30b 三条判断都接受：resume 传 model 抛错不忽略（CLI 会照办一次中途换模型而转录看不出来）；dsh 连设置卡一起补齐；协议只动描述。真机把 T22 第 5 步那个形状跑过了：判官 dsh v4-pro、选手 dsh v4-flash 的 P0 计划就绪两条各回读到自己的模型。T29b 三处：起 job 后发起端退出 run 照跑、`dsh-eval run --instance` 从终端到 completed、install.sh 缺 dsh 在动任何文件前退出。withInitiator 那处修改留着——job 没有轮次可继承 initiator 边界，它站得住，只是没修 stage2 那个问题。**没拿到的一块是宿主线**：3171 跑 dsh 0.1.1-rc.2，main 的插件自 16d5602 起按 0.1.2-rc.1 的 API 面写（childSession.snapshotEvents），resume 轮必挂；切 rc 工具链两次起不来的根因后来（2026-09-11，T29c）查清，**不是 profile 的 @deepseek-ai/* 范围**：官方包从工具链解析（~/.dsh-toolchains/<线>/node_modules/@deepseek-ai/…），换工具链就换了官方线；卡住的是已上架的 @khorsheed 成员——npm 上最新是 0.2.0（对齐 0.1.2-rc.1 那一波），它们 import 的 settingsNamespace 在 0.1.5 线上已经没有了，context-guard / ui-shortcuts 在 import 阶段就炸；仓库里 0.1.5 对齐的 0.2.1 / 0.3.0 因 npm 账号风控还没发。改法在 install.sh 一处：UNPUBLISHED_DIRS 的语义从「没上过 npm」扩成「npm 上没有可用于本宿主线的发布」，那十个成员一并从源码打包，源码模式本来就会把依赖改写成 tarball，profile 的范围不用动；另加宿主版本前置检查。在它落地前 3171 只能跑单轮（就绪、fresh 委派），I4 的 pilot B / C / D 跑不了两阶段。已合入的分支与 worktree（T29、T30b、T30c、T29b）本轮清掉。

**宿主切换（2026-09-10 定，2026-09-11 落地）**：主线实际切到的是 0.1.5-rc.1（npm latest 已是它，prod 3080 检出在 dsh-v0.1.5-rc.1）。基线提交 bb04c84 把评测家族的依赖一并钉到 0.1.5 线，local-agent 家族 minHost 前移到 0.1.5-rc.1，eval / lab / datasets / mission / capability-catalog / dsh-headless 的 minHost 仍写 0.1.2-rc.1（标签落后，代码在新线上全绿）。切换后评测侧包测试（2026-09-11，验收机）：eval 347、lab 127、datasets 115、mission 128、capability-catalog 77、local-agent 224、codex 165、claude-code 153、kimi 186、dsh 126、dsh-headless 47 全绿——回归清单第 1 项过。协调者已建 `~/.dsh-toolchains/rc-0.1.5-rc.1`（npm 安装 @deepseek-ai/dsh@0.1.5-rc.1，无状态）。第 2–6 项归 T29c；T31、T32 自 2026-09-11 起从新 main 开分支，可发。原文：主线今日切到新宿主线，官方接口变化较多。评测侧的安排：T31、T32 的文案保留但暂不发，等迁移合入 main 后从新 main 开分支；T29c（web-eval profile 上新宿主线 + 3171 重装）合并进迁移那条线做，不单独发；local-agent 家族的适配由迁移线负责，评测侧用下面的回归清单验收。

迁移合入后的评测侧回归清单（谁做迁移谁跑，回报贴原文）：
1. 包测试：local-agent、四家 provider、dsh-headless、eval、lab、datasets、mission 全绿；`pnpm gate --all` 通过（ankh-guard 抖动按既有规则单跑复核）。
2. 复算：pilot-a-round1 bundle 的 results.jsonl 与 usage.jsonl 与切换前逐字节相同；T22 第 5 步 run A 的报告复算不变量四行仍全 ✅。
3. 本机四家 status：cliVersion、credentialState、effectiveSettings.model 都有值；四家各一轮最小 exec 委派回读到模型（kimi 配额未复就记原文）。
4. 3171：切新工具链、按 T29c 改过范围的 profile 重装，install.sh 前置检查通过；`/eval run` P0 × codex × 1 rep 两阶段到 archived（这是切换前拿不到的那一格，resume 轮不再报 snapshotEvents）；再起一次 job 后关掉发起端，run 照跑。
5. 容器路径：lab acquire 一个单元、T20c 的方式 P0 × codex 一格到 released，四条不变量 ✅。
6. 三处已知接缝重看：T17 的 container exec 只用 ctx.subprocess；T29b 的 jobs 契约（JobStart / JobHooks / owner）是否变形；T30b 的 dsh headless `--model` 经 startup provider 与 cordis.patch.yml runner 行是否仍通。
7. 容器轮的结果必须核实：plan 带 `unit` 段、`docker ps -a` 里有本 run 的单元容器；没有单元的「就绪」是宿主轮，输出与容器轮一模一样（T33e 第一跑）。容器轮必须跑用镜像内 harness 的那家（dsh）。

**T29c / T31 / T32 验收（2026-09-11）**：T29c 的两条提交合入 main `477c65f`（与 T45 的 README sidecar 撞哈希，重录），T32 的 `feat/capability-hash` 合入 `9b8aaaa`（同一处 sidecar 再撞一次）；T31 由实施者自行合入 `3d139f0`。合并态 eval 421、capability-catalog 100、local-agent 224、local-agent-dsh 133、dsh-headless 51、脚本测试 107 全绿，双语 263 对同步；合并后主检出的 node_modules 因新增工作区包（room-tool、worktrees-tool）与锁文件变化要 `CI=true pnpm install --frozen-lockfile` 同步一次才能跑测试。题库 `i4-host-line` 与 `t31-judge-panel` 并入 i1-walk `f46855e`。

- **T29c**：install.sh 的宿主线前置检查在旧工具链上实测退出码 2、一个字节没写，19 行列出每个成员要求的 minHost；UNPUBLISHED_DIRS 扩语义后十个只有 0.2.0 的成员从源码打包，切换失败的原文钉住（`does not provide an export named 'settingsNamespace'`）。3171 重装后 --dump-config 里 pin 逐条对上；回归第 2 项复算两份 bundle 哈希与切换前三次一致，第 3 项四家就绪三家带模型、dsh 为 —，第 4 项 P0 × 四家两阶段全 archived 且 job 起、发起端退出、日志事后读回——切换前拿不到的那一格拿到了。第 5 项容器一格卡在环境：eval-net 是 internal，出网全靠边车，eval-proxy 与 eval-registry 在 docker 守护重启后 Exited (255)，单元里 codex 起来了但 230 秒后交回空回答；实施者无权起共享容器，协调者已 `docker start eval-proxy eval-registry`，待用 420 秒就绪窗口重跑（120 秒装不下 3.2 GB 镜像冷启动加首次 exec）。第 6 项：T17 的 docker exec 仍只经 ctx.subprocess ✅，jobs 契约未变形 ✅，**dsh 的模型回读在 0.1.5 上断了** ⚠️——请求侧完整（--model 一路到 applyModelRequest，记录 cliVersion 0.1.5-rc.1），断在 session-mirror.ts 按写死的 `session.jsonl.zstd` 找子会话，0.1.5 写的是 `session.v3.jsonl.zstd`，真目录实测新线 undefined、旧线 2435 条事件；observedModel / usage / toolCalls 三样一起丢，pilot B 两格都配不出对子，记 T30d。compat-report 六个包 current；local-agent-tool-subagent 仍 behind 而它是 profile 成员，随下次家族改动一并前移。3171 现挂在实施者的启动器下无看门狗，协调者定：交回 ankh-guard supervise。
- **T31**：provision 五步与拒写路径真机验过——改 permissions 再 provision 拒写、原 lock 一动没动；diff 只报 scope；PROVISION_MISMATCH 让条件 unready，把实测 home.sha 写回后 ready，是真实数据上第一次有条件真的就绪；codex-scope-a 的 HOME_MISMATCH 是正在跑的 3171 往那份作用域目录写，真实漂移不是误报。判官面板宿主真跑：双采样 10 条一致 9 条 κ 0.615，跨判官 5 条全一致 κ 1.0，自评 5 条标出不拒。三条接受：CLI 的 provision 只能拒绝（作用域、凭证等级、effectiveSettings 全在 local-agent，进程外问不到）；model.endpoint 改成可核对写法（"default" 或端点主机名），协议示例的 "proxy" 换成官方端点；一个 repo 级坑已修——.gitignore 的 `node_modules/` 带尾斜杠只匹配目录，worktree 里软链进来的 node_modules 被 `git add -A` 提交进了 adbc9c2、合并后覆盖了主检出的真目录，4632738 untrack 并补了无斜杠规则。流程提醒：合并归协调者，实施者不要自己合 main。
- **T32**：snapshotFor 与 hashOf 的规范形按文案（tool 取 name / channel / parameters，skill 取 name / source / 正文 sha，描述不进）；三个 scope 两个哈希，改名不动、改正文动。三处偏离：一、真机跑出实施者自己引入的缺陷——preset 挂不起来时 snapshotFor 悄悄退回全局层还贴着该 preset 的名字，两个本该不同的 scope 同哈希，已改成清单降级、指纹抛错（5915d4a），接受。二、**preset 在 sub-dsh 上拿不走能力**：dsh-base 把工具挂在 profile 根，preset 只能加不能减，两个 scope 的 26 个工具完全一样，差别在各自注册的技能——pilot D 的口径改成「同工具 + 不同技能」；要减工具得等 T45 的伴生工具包拆分。三、两项没做到：委派一轮问「你有哪些工具」改为直接读启动起来的 composition（本机生产 home 之外没有 DeepSeek 凭据）；子 profile 能力哈希的实测留成 ProvisionOptions.capabilities 钩子，没钩子时 lock 报 CAPABILITIES_UNMEASURED、就绪再拒一次——接受，但这意味着 preset 条件今天进不了 ready，接线记 T32b。与 T31 抢 provisioned 块的合并方式对：T31 拥有写入者与必填字段，T32 只加 preset / capabilities 两个可选字段。

**T30d / T29d / T32b 验收（2026-09-12）**：三条分支依次合入 main `590c7b0`、`e5649df`、`376838f`，两条 eval 分支只在 README sidecar 撞哈希、重录；合并态 eval 461、local-agent-dsh 146 全绿。T29d 的真机第一跑同时补齐 T29c 回归第 5 项，T29c 转 ✅。三件裁决：T32b 的 validate 对过期 lock 仍报 ready——接受，validate 离线量不了，新鲜度只在有 catalog 的就绪检查上比，`conditions list` 的实例内测量留作后话；T32b 两处超出文案（就绪再量、T32 遗留的探针拒测不进报告）都收；T29d 动了根目录的协议文档——契约加字段本该动，协调者补了 v1-rev11 的版本号。T29d 顺带发现的两件：capability-catalog 在 3171 上量不了 `eval` 预设（persona 行在 0.1.5 线的配置键是 `prefix`，本 profile 的预设还写着 0.1.2 线的 `text`，协调者已在预设文件改正，随 T33a 落地）；ankh-guard 的 credentialRepo 仍是 T29c 的 worktree，重新 adopt 前不删。**3171 事故**：T29d 回报「已交回 ankh-guard」时看门狗其实还没证到就绪——启动器为了不让 token 进日志把子进程 stdout 整个吞掉，而看门狗靠子进程 stdout 里的启动 URL 做 303 交换来证就绪，只见 401 就永远「readiness not proven within 60s」，四次失败后回滚 credentialRepo（到 47ac944，无变化，留了 `guard-backup-20260911-170315-q4ec` 分支）并挂出兜底页；修法是启动器把原始 stdout 透传（看门狗自己会在 attempt log 里脱敏）再给看门狗发 SIGUSR1，归 T33a——协调者的自动模式不放行改启动器与发信号，所以交实施者做。

**T33a 验收（2026-09-12）**：看门狗的就绪协议是「子进程 stdout 里的启动 URL → 303 交换 → cookie 200」，启动器透传后 18 秒证到，attempt log 由看门狗自己就地脱敏（0600、`[launch-url-redacted]`），token 只在 0600 文件里；实施者顺手把 `process.exit(code)` 改成 `process.exitCode = code`，否则排在管道里的透传会被截断。重装走 `install.sh --source --fresh`（第一版文案写成 update.sh，被实施者指出——update.sh 会把 file:tarballs 清单覆盖回 npm 范围），27 个成员从 `b7fb020` 打，`--dump-config` 只 compose profile 根所以仍报 24——伴生三包的授予点在 eval 预设层，是 M4'③ 的本意。四件核验齐（见表）。**credentialRepo 的裁决**：实施者提议指向主检出，不放行——看门狗连续两次起不来会对 credentialRepo 做 `git reset --hard`，主检出是多 agent 共享工作区，不能让一个看门狗有权清空别人的未提交改动；改为专用 worktree `../dsh-plugins-wt-eval-guard`（分支 `guard/eval-3171`，只作部署锚点，不在上面开发，每次重装后前移到装的那个 commit），其余参数照实施者的方案（`DSH_HOME=~/.dsh-lab`、`--state-dir`、`--profile web-eval`、`--preflight-surface built` + install anchor 指工具链的 dsh package.json）；切换要等看门狗重新 supervise（WD_REPO 是 supervise 启动时读进环境的），顺便把看门狗从稳定的 cwd 起（现在的 cwd 是已删的 T29d worktree，重启路径上已冒出 uv_cwd ENOENT），成功后删主检出的 `.dsh-guard-state/` 与 T29c 的 worktree。路上撞见的既有问题：四个 CLI 的入口守卫经 `.bin` 软链静默空跑（→ T33d）；finalize 事后单跑会把单元晾住（is-releasable 闸只在 archived → released 间开，正路是 `run --finalize`，写进 T33b / T33c 的约束）。

**T33a re-adopt（2026-09-12）**：活 spec 已指专用锚点 worktree、profile web-eval、带 preflight 块（surface built + runner sha + install anchor）；换 supervisor 走的是第三条路——`reconfigure` 被拒（隔离 home 快照对悬空软链 fail closed，~/.dsh-lab 的 dsh scope 里有一条 `@types/react` 还指容器侧路径，实施者没动它，对）、`supervise --takeover-from` 被拒（独立路径上没有 start token），于是 SIGTERM 旧看门狗、从 ~/.dsh-lab 起新的，停机 33 秒，cwd 问题随之根除。restart evidence 与 composition preflight 首次真跑并 PASS；deployment proof 仍 FAIL，报错换成「harness root 要是 git 仓库」——ankh-guard 的 `captureDeploymentFingerprint` 对 harnessRoot 也取 git HEAD，工具链目录是 npm 装的，这条线上证不出来，代价是每次重启前重录 10 分钟保鲜的绿色凭据（与改前相同，不是回归），归 ankh-guard 线。协调者清掉了 T29c 的 worktree 与分支、事故回滚留的 guard-backup 分支、主检出里写错地方的 `.dsh-guard-state/`。

**交 ankh-guard 线（2026-09-12，3171 上实测）**：① deployment proof 对 harnessRoot 也要求干净 git 检出，npm 装的工具链永远证不出来——建议非 git 的 harness root 按已装 dsh 的 package.json 版本 + 安装锚点 sha 取指纹；② reconfigure 的隔离 home 快照对每条软链 statSync 目标，悬空一条整体 fail closed——评测家族的 scoped home 里有宿主与容器两边各自成立的绝对软链，建议跳过并记一行；③ `supervise --takeover-from` 在脱离 cutover 的独立路径上没有 start token，只能拒，换 supervisor 只剩停机重起；④ CLI 没带 DSH_HOME / --state-dir 时退到 `<cwd>/.dsh-guard-state`，在 git 检出里跑就悄悄写进仓库根，建议非 app layout 下无显式 state dir 即拒或至少打印落点；⑤ 看门狗对 credentialRepo 的回滚是 `git reset --hard`，文档应明说它必须是专用检出、不能是开发工作区。⑥（2026-09-17，T63 重装实测）stop marker + TERM 看门狗会留孤儿：看门狗按 marker 干净退出，但 cleanup() 只在 child 活着时 kill_tree，TERM 先杀了那层 bash，启动器与实例进程孤儿化、端口 60 秒不放；建议 cleanup 无条件按进程组收，或文档改成先 TERM 启动器层 / 放 marker 后等看门狗自己收。

**T33b 中止（2026-09-12）**：pilot B / C 的判官在宿主轮就绪、按次模型证据到手，两家选手在容器轮就绪全败。实施者把 dsh 的根因坐实到 scoped home：profiles/node_modules 里 260 条链指宿主工具链（9/11 宿主侧 dsh 愈合的）、232 条指容器里的 harness 检出（9/12 容器侧愈合的），宿主的愈合是补缺不换错，同一个 scope 先被哪侧碰过另一侧就坏——而 provision / effectiveSettings / 就绪探针必在宿主侧碰、委派在容器侧跑。claude 未定根因。协调者核了两件事后定下花钱的方式：一、**不改走宿主路径**——report.ts 的 `comparisonAllowed` 要四条不变量全 ok，宿主轮的环境指纹是 `unverifiable`（本 run 无指纹），比较节开不了，I2 的 pilot A 就是这样被拒的，四格委派换不到判据；二、**上游根因是镜像**——`eval-env:pinned` 是 9/8 建的，dsh 闭包从当时的 harness 检出打（0.1.1-rc.2 线）、headless 包 ARG 是 0.1.0-rc.6，宿主 9/11 切到 0.1.5 后镜像没跟着动；T29c 回归第 5 项与 T29d 都只用 codex 验容器轮，codex 不用镜像里的 dsh，所以三天没暴露——**回归清单的缺口**：容器轮的验证必须覆盖用镜像内 harness 的那一家。于是：一次 codex 的 t29d 计划定性容器轮没因 T33a 整体回归（约 4 分钟），然后停，交缺陷报告与预算；镜像重建立 T33e，两侧路径混用立 T33f（先方案）；T33b / T33c 的容器轮待两者后重跑。

T32（2026-09-10 定）：pilot D 的口径是「sub-dsh × 两 preset」——preset 只管得到我们自己组的子实例，三家外部 CLI 的技能包留 I6 单独做。

T30b、T31（2026-09-10 文案发出）：T22 第 5 步的互斥（判官 dsh v4-pro 声明、实跑 v4-flash、改成 v4-flash 又撞 JUDGE_IS_PLAYER）根子是模型没法按次委派——T30b 让判官条件请求 v4-pro，互斥自然解；T31 再把决策 9 收成模型级并进 validate。

T30c（2026-09-09 加）：效率表今天只有 token 与时长，工具调用数没人采；采集面已有、只差汇总，合成一条，不依赖 I3 与 T29。计价不让实施者做（2026-09-09 定）：token 与工具调用按轮落库即可，单价表由 bundle 之外的非模型环节套用。

模型切换（2026-09-08 定）：「配置能切模型、切了新 run 照新的走、缺省与今天一致、前端能切能指定」拆成两半。配置切换与设置卡是 T30a，不依赖 I3 与 T29，可与 T22 并行发；按次委派指定是 T30b，与条件 provision（T31）一起才有意义。界面上「指定某次 run 用哪个模型」走 I5 的计划审阅（T36）读条件文件，不另做入口。

**T29 验收（2026-09-10）**：`feat/local-agent-scoped-home`（`84ce03d`）合入 main `0d7b91b`，与主检出里另一位 agent 的未提交文件零重叠；合并态 local-agent 221、codex 154、claude-code 141、kimi 175、dsh 108、eval 328 全绿。与文案不同的一处接受：`homeDir` 读即物化（mkdir 幂等、每进程一次）而不是纯函数加显式 ensureScope——忘了调的调用方会拿到一条像样的路径指向不存在的目录，正是 T20c 已经付过一次学费的静默空态。Agent Note 记了六条备选（宿主路径当参数、跨 scope 复制凭证、嵌在缺省目录内、纯函数 + ensureScope、条件里给 home 对象、给 live 起第二个常驻 runtime），拒绝理由都成立。真机：缺省与 eval-b 各委派一轮，记录一条无 scope 字段一条 scope "eval-b"，rollout 与 delegations.jsonl 各落各目录，命名 scope 的登录是它自己的一次 device-auth；跨 scope resume 三种形状都在 spawn 前被拒。两条件 run（宿主路径 P0 × codex-scope-a / codex-scope-b）：就绪各自在自己的目录里通过，条件哈希不同，b 格两轮 archived，a 格被本机代理掐长流（裸 codex exec 同样复现）重试预算用尽跳过——是网络不是机制，协调者定不重跑：scope 的证据是四轮子会话的目录归属与两次就绪探测，已经齐了。文案里写的 run.meta.unit.scopedHomes 在宿主路径不存在（unit 为 null），是协调者笔误，容器路径的两条目由新测试钉住。题库侧 `t29-scope`（`3a32fa1`，两个只差 scope 的 codex 条件与 P0 两条件计划）并入 i1-walk `ce31e92`；它是从共享检出的 i3-probes（050e22d）而不是 i1-walk 开的，只加了五个新文件所以无害，合并后 i1-walk 校验只剩 51 条 UNREGISTERED_FILES；下次开题库分支请从 i1-walk 开。

**T30c 验收（2026-09-10）**：`feat/tool-calls-and-pricing`（`ae5244d`）合入 main `fc5141d`，只动 local-agent 家族与 eval；合并态 eval 324、local-agent 205、codex 150、claude-code 137、kimi 171、dsh 104 全绿。计数都折在各家已经走过的解析分支里，没有新增解析路径；byName 记各家自己的名字——codex 同一次调用计数写 command_execution、镜像卡片写 Bash，这正是「不做跨家归一」的可见处。kimi 与 dsh 按本轮而非镜像窗口数，live 轮询清空过 delta 的 settle 照样报得出，resume 轮不继承。真机 codex 与 claude 各两轮，toolCalls 与镜像出的工具卡片逐条对上。pilot A 复算 results.jsonl 逐字节相同，usage.jsonl 新增 7 行，counted:true 加总正好复现效率表的 21.0 min / 4 轮与 11.9 min / 2 轮。三条判断都接受：一、usage.jsonl 比文案多 `attempt` 与 `counted` 两列——重试格沿用同一 mission id，只有 cell 分不开两次 attempt；counted:false 的行留着，外部计价才能自选口径。二、codex 的 function_call 没数：0.144.0 的 exec 流里 provider 解析的是 command_execution / web_search_call / function_call_output，没有 function_call 分支，按「不新增解析路径」只数前两个，README 写明；要补是另一个决定。三、只有 exec 路径报 toolCalls，因为长驻驱动根本不发 settled（usage 与 observedModel 在那里本来就缺），评测钉的是 exec，口径不受影响；补长驻的 settled 通道另开。验收机上 verify-translation-pairing 报 packages/context-guard 的 sidecar 过期，那是另一位 agent 在主检出里未提交的 0.1.2-rc.1 适配工作，与本分支无关，未动。

验收：README I4 行；report 的因子列由 condition diff 自动推出。

### I5 · agent 配实验 + 界面

**UI 先行（2026-09-13 定）**：I4 的机制齐了但环境活（T33e / T33f）还在修，而目标里差得最多的是界面。决定 I5 提前、与 I4 收尾并行：先把界面与流程按走查稿定稿（[ui-spec.md](ui-spec.md)），再按切片建，每片用真实数据（题库 i1-walk、已跑完的 run、pilot 的 bundle）在宿主路径联调；容器版的端到端等 T33e。走查稿里定下的形状：评测模式两个 tab（题集、实验室），都是列表 + 新建 + 详情；missions tab 隐藏，mission 保留为账本与释放闸，词留给以后的定时任务；eval 预设摘掉 mission-tool，eval-tool 自己补按格子读的工具；题集的槽位按通行词汇（题干 / 验收标准 / 参考答案 / 评估标准 / 检查脚本 / 其他文件）标「谁看得到」，界面不做题目正文编辑器，新建即骨架加导入；实验状态叫草稿 / 待批准 / 运行中 / 评估中 / 已完成；矩阵放在实验详情里，由人选哪个因子当列。前端结构照 mission 客户端：`conversation.view` slot、React、同一个 Typert Remote 读写、按伴生工具行自隐；eval 今天没有 client 半边，T35a 先搭骨架。切片顺序：T46 与 T48 先（小），T35a → T36 → T35b → T38 → T37 → T34 → T39；T47 与 T35 并行；T45 模式化排在 I5 末尾。

**T46 / T35a 验收（2026-09-13）**：两条都单提交、无 checkpoint、锁文件按需动；T35a 合并态 eval 510、eval-tool 3，整仓 gate 14 步绿。T35a 三处点名的裁决：一、`install.sh --source` 在 main 上已坏，与本任务无关——pack-dist 9/12 起要 family 边带版本，install.sh 还传光名字；立 T49，未修前临时实例按 T35a 的绕法（一次性副本把 `--family` 改成 `name=version`）。二、改 `scripts/gen-typert.mts`（eval 的聚合 tsconfig 拆成 references 后生成器要指向 host 配置）接受，与 mission / datasets 同形。三、worktree 里跑 gate 撞 pnpm 的依赖状态检查——不用改 pnpm-workspace.yaml，用 `pnpm --config.verify-deps-before-run=false gate` 即可，写进通用提醒。状态推导的五条边界都接受（job 层把就绪拒绝与中途抛错都记成 failed，「被拒」的口径就是 job failed；半路停下与空账本读作运行中；没有 job 记录时只按格子读；run 与 plan 按解析路径或 planSha 配对，改过的 plan 如实变回草稿）。本机 `~/.local/bin/dsh` 是死链（指向不存在的 ~/.dsh/source/current），是机器上的事，实施者用临时 shim 绕过。

**T49 / T36 验收，T35b 待解冲突（2026-09-14）**：T49 合入 `5e4ec1a3`，T36 合入 `66dbdede`（合并态 eval 534、302 对双语同步、独立性 0）。T36 真机抓到的网关精确位参 bug 已随分支修掉（runOutput 显式传 cursor），T35b / T37 / T38 同一处都要注意；「新建实验」占位改指 T34 接受。T35b 内容验收通过——「按 harness 出一次矩阵」在本机账本上做不到（三个评测 run 都是单 harness），实施者用 pilot-a-round1 的 bundle 走同一个 pivotMatrix 取证、没有编账本，对；打开子会话用一次性账本副本做接线探针、真记录没动，接受。但它与 T36 同时改了 packages/eval 的 client / remote / service / store，15 个文件 48 处冲突，两条都是往同一批文件里加东西，协调者不代解——退回实施者把 main 并进分支解冲突再 gate。教训：同一个包的两个切片并行发，合并成本落在后合的那条；以后同包切片串行，或文案里先分好文件。T35b 顺带发现的三件：gen-typert 全量模式在全新 DSH_HOME 上死锁、install.sh 去掉 GEN_TYPERT_ONLY 后全量构建 80 分钟降到 12 分钟、T49 已修的 family 边——前两件立 T50。T36 顺带发现：`/datasets bind` 在 composer 里补全后参数丢失（归 T47 顺手修）；gate 的 GLOBAL_PATHS 不含 profiles 的 scripts（T49 实测改脚本只跑 11 步，进 T50）。

**T35b / T50 验收（2026-09-14）**：T35b 并 main 后合入 `e3fe4904`，T50 合入 `05050252`；合并态 eval 584、脚本测试 169、303 对双语同步、独立性 0。T35b 解冲突的经验记进通用提醒：追加型切片并 main 时，从 base / ours / theirs 三个版本取原文、按稳定锚点把自己追加的整块 graft 进 main 版本，不要逐 hunk 拼 ours+theirs——冲突边界落在声明内部时后者会把方法和接口切成两半。T50 的三件裁决：GEN_TYPERT_ONLY **保留**，全量模式会把 profile 不装的包的类型发进成员 tarball，安装器不该默默决定这个；那笔加速改走「stamp 按选中集做 key」，是缓存契约的改动，立 T52 先方案；实施者发现的 gate porcelain 解析错位（首行未暂存文件丢一个字符 → 假绿）是既存缺陷、影响所有人，立 T51 小修。主检出的 typert 产物被 T50 的全量实验重写过一次，已用全量模式跑回日常口径。

**T38 / T47 验收（2026-09-14）**：T38 合入 `c83c7fb9`、T47 合入 `7ec52ed7`，两包互不相交，合并态 eval 608、datasets 167、datasets-tool 绿、双语同步、独立性 0。T38 超出文案的「换个目录找」接受——根因是 run.meta 不记导出去向，正解是导出时记进账本，立 T53（小）。T47 三件都接受：读路径在 HEAD、写只进工作区是 put_item 的既有语义，骨架落位后要 commit 才在树上出现，两侧 README 已写明；`/datasets bind` 在 composer 里丢参数是 slash 没声明 free-form input，补 input.hint 修掉；React effect 把自己写的加载态放进依赖导致自取消——eval 客户端同形状的 effect 在 T37 里顺手查一遍。作答记录一区真机上在场无行（全新 HOME 无 run），T39 端到端时会有行。

**T37 / T51 / T48 验收（2026-09-16）**：三条合入 `899410e9`、`db4376e6`、`cbadb266`（T48 与 T37 只撞 eval README 的 sidecar，重录），题库 i5-docs 并入 i1-walk `3c5ebf4`，validate 57 条 UNREGISTERED 警告、0 error；合并态 eval 641、脚本 174、305 对双语同步、独立性 0。T37 两处偏离：一、humanFinal 入参用 ticket 不用 missionId——接受，文案自相矛盾（格子名 `<题>-<条件>-rep<N>` 本身带 harness，按文案写就把它印进盲评页），实施者的改法对；二、**得分口径隐患**：报告按格取最权威 ns 整体算分，判官台第一次让「一条人评让整格其余判据出局」变得好踩，实施者没改算法、在按钮前点名代价，对——这是方法论决定（一条人评覆盖整格还是一条判据），立 T54 待用户拍板。T51 两处都改（runner 只去尾换行、逐行正则）接受。T48 两问：ui-spec §五「六个子页」是笔误（表与代码都是七个），协调者顺手改正；README「待补 T9 / T10 / T14」那句过时，一并改成已落地（双语 + sidecar）。实验室六个子页至此全部落地，I5 剩 T34（一句话起草）与 T39（端到端）。

**T33e / T34 验收（2026-09-16）**：T33e 的题库分支并入 i1-walk `0cd3f7b`（validate 0 error），T34 合入 main `76b4f1a6`（合并态 eval 681、eval-tool 4、脚本 193、双语同步、独立性 0）。T33e 两问的裁决已执行：包镜像解封 → 拉 → 密封一次做完、旧快照留对照；harness 源码树切 dsh-v0.1.5-rc.1 并去掉 build:lib。四家容器轮就绪两过两败，dsh 通了是本任务要的那一条；claude 的败因是容器内续期把宿主登出（立 T55），codex 宿主轮也败、auth 9/7 未续，先由人重登再复测。T33f 降为观察项。T34 三件：会话那半边没验到（本机无凭据）归 T39；改 ui-spec §六 是记录既定项落地，接受；profile 脚本的 `set -e` 既有 bug 顺手修掉，接受。**接下来两件人的事**：在 3171 上重登 claude（`/claude-code login`）与 codex（`/codex login`），T39 与 T33b 的容器版都压在它上面。

**T39 / T33b 补充二验收（2026-09-16）**：两条题库分支并入 i1-walk `768df21`（validate 0 error，67 条 UNREGISTERED 警告是新增的 lock / plan / 日志 / usage）。**I4 的交付物拿到了**：T39 的容器轮 run 四条不变量全 ✅、比较节打开，第三条「模型回读与声明一致」第一次在容器轮的配对报告上被证到；Δ 为 0 是 P0 两个阶段都是设计阶段的必然，证的是链路与配对机制。**I5 的功能闭环走通了**，但判据「人只做审批与终评」没达成：17 次人介入里 9 次是缺口，集中在两处最后一公里——条件字段（endpoint 没入口、home.sha 手抄回填再 provision）和产物落盘（报告要命令行、终评不进 bundle、单元要手动回收）。缺口按处立四条：T57（run 缺省 finalize 与单元回收）、T58（条件与绑定）、T59（单元里没有 shell——对真题是硬阻塞）、T60（导出与终评）。三件裁决：一、决策 9 的现行口径是 2026-09-10 放宽后的（判官可与选手同模型，标自评不排除），判官条件 notes 里的旧句子是陈旧文本，T33b 顺手改；二、pilot B 的计划在跑前被别的任务改过（加了 kimi-exec、重写格式）——根因就是 G1（未绑定的 agent 拿 repo 参数写进了别人的检出），规则写进通用提醒：并行任务各用各的 worktree，agent 起草只认会话绑定；三、pilot B 第 3 格撞单元上限不是 pilot 的错，是 run 不 finalize 就不回收的设计，T57 先修再重跑。真题预算（v4-pro 单格：F3 46–78 min、F2 62–93 min，output 22–45 万；两格翻倍；budget.activeMinutes 30 要先上调；flash 未测）停在放行点等用户。3171 由安装副本的看门狗守着（`~/.dsh-lab/profiles/web-eval/node_modules/@khorsheed/dsh-ankh-guard`），实施者担心的「守它的是别的 worktree 那份」不成立——那是另一台实例的看门狗。

**只留必要测试（2026-09-17 定）**：9/11 以来的真机 run 逐次剥的是不同的层（宿主线、镜像线、单元回收、shell），但 T33b 补充二与 T39 是同一件事，补充四撤回。用户定：机制 pilot 到此为止，只留 pilot D 一次（I4 唯一没在 run 上证过的判据），真题等上线后在使用中跑，专注把插件整体做出来。

**T57 / T59 验收（2026-09-17）**：两条无冲突合入 `4a11d4ad`、`8dc26e97`，合并态 eval 707、local-agent-dsh 188、local-agent 267、315 对双语同步、独立性 34 包 0、profiles 组合干净。T57 五个被否掉的替代方案与那条诚实代价都接受。T59 把 G14 从「环境问题」纠成「决策 3 的执行点缺失」——这是本轮最值钱的发现：条件的 `permissions: unrestricted` 在 dsh 这一家背后原先什么都没有，宿主轮也一样，只是 Seatbelt 掩住了。三件交接：一、两条 dsh 条件的 `home.sha` 随子 profile 多了一层而变，T33b 重跑前要重新 provision 并把哈希抄回条件文档（G7 那两步，T58 收）；二、这条 pin 同样作用于宿主轮与判官委派，有意为之，与 codex 的 danger-full-access 同一条纪律；三、容器轮里 member-bridge 那行起不来（单元里 `DSH_MEMBER_BRIDGE_ENTRY` 为 SyntaxError），走的是 failOnStartupError: false 的降级路径，每个容器轮 stderr 都有这段噪声，记为 T61（低）。T59 跑 `gate --all` 时 ankh-guard 的 supervise 泳道红，实施者在 main 上复现同一泳道也红且更多——既有抖动，归 ankh-guard 线，本轮按既有规则记录。另：T57 跑时旁边冒出六只 alpine 单元，是同机另一会话的 integration-triad 集成测试，与评测 run 并存照样跑完。

**T58 / T33d 验收（2026-09-17）**：T58 合入 `db3176a5`，T33d 合入 `a526d55b`（两个 README sidecar 与 T58 冲突，按合并后的 README.en.md 重录；T33d 基于 b3ae78b4，主体无冲突）；合并态 eval 741、datasets 182、eval-tool 4、datasets-tool 5，T33d 的 gate --all 全绿；主检出里的 gate 在 package map 一步红是未提交的 `packages/dsh-rss-reader` 让 docs/packages.md 显得过期，与两条无关。T58 六条缺口的修法都接受；两件超出文案的：改 eval-planning SKILL.md（不改则 agent 起草永远把 endpoint 留 null，G6 的收益拿不到）接受；ui-spec §五 的条件页「人的动作」与新建实验的七个字段由协调者补上。第 4 步人介入 6 → 2 是从代码路径推的，不是重跑走查；3171 上的三条判据里两条在真工具面与真题库上验过（未绑定被拒的原文、bind 缺省下 grading / verify 两层 `[LAYER_NOT_ALLOWED]`），「一次 provision 变 ready」由 conditions-page.spec 用真服务 + 假门面钉住，真机等 T62 后条件页打得开再看。协调者核过一处：判官读 grading 走的是 run 循环的显式 `layers: ['grading']`，`effectiveLayers` 里显式白名单优先，不受 bind 缺省收紧影响。实施者在临时实例（3199）截了明暗两套图并靠它查出三处自己没看出来的问题——截图确实值回票价，但规则不变：切片不各自截，统一由 T63 交；临时实例里 local-agent 不认 dsh（unknown harness dsh）与改动无关，pilot D 在 3171 上跑。T33d 接手了 9/12 的残留 worktree，改法与文案一致沿用。**接下来**：T62 负责把 3171 重装到 main ≥ `a526d55b`（T58 + T59 + T33d 一起上去）；T60 文案已写（§三）；T33c 可发。

**T62 / T55 验收（2026-09-17）**：T62 合入 `35b23bf7`，T55 第二步合入 `dbc76d7f`；主检出这次被别的会话 stage 的 rss-reader 包挡了两回（ort 遇脏索引即拒），协调者把那 18 个文件从索引拿出、文件原样留在工作区。T62：四种错误码的原文都是三段式，两份 ErrorState 只差类型名与注释举例；超文案两处（存在性先于 git、「不是题库」拆两句）接受，修法从此不说错话。T55：定案 (a) 新者胜（用户放行）；判定步没碰真凭据就把两件事定死——清空发生在单元侧、只读挂载是死路。**未闭环的一条**：完成判据第 4 条（容器轮 ready 后宿主轮仍 ready）要修复先装进 3171 再跑，顺序写在 §三 T55 补充；另一件：3171 默认 scope 的凭据文件 13:30 被写但装的是昨天的凭证，最自然的读法是用户的重登当场被旧同步拨回，要人跑一次 keychain 元数据核对才能坐实——修复装上之后再登一次就不会再被拨回。T63 自此可发，与 T60 并行。**3171 重装（2026-09-17 14:51，T62 收尾）**：`e0a37060` → `2c4476f8`，13 s 就绪，两个 tab 真机打开，35 个工具无 mission_*；T33c 与 T55 活体验收的前置至此满足，等用户核 keychain / 重登。**T55 二期（同日下午）**：keychain 核对暴露第二处缺陷——印记解析从未生效，「最新写入优先」是空操作，3171 上一直镜像 9/16 的旧代，status 却全程报已认证；修入 `a36cf6b6`（夹具先改、用例先红再改源码，回归证据干净），3171 要再装一次，T1 判别之后再做容器轮验收，接缝要 21:31 之后才碰得到。**T33c 受阻收口（2026-09-17）**：pilot D 在容器轮被机制顶住（单元不挂 preset 根，sub-dsh 解析不到 preset），宿主轮比较节不开；按「只留必要测试」不跑宿主轮凑三条，已有证据入题库日志，机制缺口立 T65（先方案），pilot D 的那一次 P0 由 T65 顺手跑。**T63 验收（2026-09-17 晚）**：合入 `00828fcd`，合并态 eval 777 / datasets 203。协调者看了 8 张图（题集列表、实验室列表、矩阵明暗、报告、条件暗、判官台暗、格子暗）与核对表：矩阵页列头归条件、因子作副标题、随动字段折到底部一行、run 级汇总一行、状态词表一致、空态说下一步、宿主 tokens 都成立——还纠出 §九 举例里四个根本不存在的 token 名（bg-l2 / label-warning / label-danger / font-family-mono），这是「设计感弱」里最实的一条。两条进用户走查清单：条件页列头仍是键名（model.declared / model.endpoint / scope / preset / lock）与英文动作词 provision；几处列头是英文术语（canary / validate / attempt / rep），算不算「中英不混」由用户定。两条只记不改记 T66。**T60 回报同日到**（`4b7a4633`，一个提交，测试 eval 796 / eval-tool 4 / mission 134 / datasets 200）：与 T63 在 LabView.tsx / ReportPage.tsx 冲突，退回实施者并 main 按 graft 解后再合；写口形状选新工具 eval_repo_write（不扩 eval_plan_draft，三条理由成立：契约不同、起草不可并发、账本会记假话），mission 里 effectivePresetOf 那份同改按判据接受；活体验收定在 3171、不起新的容器轮——报告页导出 / 重新导出 / 终评用 T39 那个已 finalize 的 run，G11 用一次 dsh 单条件宿主轮 P0（分钟级），G16 在会话里直接试，G13 打开旧格子的成员子会话看 tab 条。**3171 重装到 `00828fcd` 由 T63 的实施者做**（21:31 T55 探针之前），用户走查两个 tab；T60 合入后再装一次。**T60 验收 / 3171 重装（2026-09-17 21:00）**：3171 装到 `00828fcd`（19 s 就绪）；T60 graft 后合入 `0bc517d3`，合并态 eval 817 / mission 134 / datasets 205 / eval-tool 4；下一次重装（≥ `0bc517d3`）等 T55 21:31 的探针跑完再做，然后 T60 活体验收四项、用户走查一轮收完。重装踩到两个坑（PATH / DSH_HOME 要导出；stop marker + TERM 留孤儿）记进通用提醒，后者交 ankh-guard 线 ⑥。**用户走查 T63（2026-09-17 夜 → 09-18 定）**：用户的判断是问题还挺多，并给了一整套意见——四阶段导航、术语降维、每页主动作、高级设置折叠、就绪徽章、向导式新建、运行记录详情、报告图表与有效性校验、并排盲评、色彩语义。协调者看完全部 24 张图后认同：§九 只定了文案与视觉基线，没定「每一页该让人做什么」，七个子页成了标签正确的数据倾倒（概览与计划审阅几乎同一份定义列表、没有主动作），这是规格缺口不是执行缺口。三个分叉用户已定：网格跑前跑中都要（同一个组件两处显示）；条件改叫对比组；判官台按同题并排、各自打分，不做二选一（判定契约不变）。落地：ui-spec §五 改成 v2 四阶段 + §九 补术语表 / 色彩语义 / 数字与句子；T63 只收文案级的一轮（§三 补充（二））；结构级的开 T67（两个里程碑，一人）；「预期得分（历史数据）」与 Cmd+K 记为后续不做。下一轮验收协调者自己起临时实例驱浏览器看。**T55 两次探针（09-18 晨读）**：文件侧证成、宿主链在轮换时死在 keychain——前提错了（macOS CLI 读写 keychain），(a2) 因密文进 argv 否决，定案 (b) 容器专用 scope + eval 守卫（补充（四））；用户先重登默认 scope，再登一个 c-claude。**T60 活体验收通过（09-18）**：四项原文齐，未起容器轮，I5 第 6 / 7 / 8 步人介入 0 / 2 / 1 兑现；ankh-guard 泳道空载复核全绿。**T55 第三步合入（09-18）**：`a672db2a` + 题库 `90cf6a8`，反例离线证过；等 3171 再装一次跑两条探针即结案。**T55 结案（09-18）**：两条探针在轮换窗口里做成一组 A/B——c-claude 被轮换、默认 scope 一个字节没动、宿主轮仍 ready、0 warn；前一夜共用 scope 时同一时序宿主报续期被拒，变量只有 scope 隔离。**同日**：T65 方案定案（完整变体、rev12）、T63 补充（二）合入、T67 可发、新记 T68（计划 dataset.repo 指旧检出）；**T54 用户拍板逐判据合并**，文案已写（§三），可发。**T67 验收（2026-09-18 下午）**：两个里程碑合入 `b2f0c7a5`，合并态 eval 850。3171 当时被 T65 第二步占着（13:44 装了未合 main 的 `4599ae89`、跑了 pilot D），协调者没碰它：起临时实例 3199（独立 DSH_HOME，拷 3171 的账本与会话、不拷凭据与 local-agent，题库绑到 i1-walk 开的工作树），用 playwright 逐页截明暗两套、读 DOM 量尺寸。实施者那张 14 行的表在真机上全部成立：四阶段、每页一个主动作按状态换词、规模四行、就绪徽章与逐条红叉、计划网格与运行网格同一张、高级设置折叠、五档筛选、运行记录详情（时间轴逐段时长、键值表、人话附件名）、有效性校验悬停各一句、效率柱状图各自归一、判官台按题并排各自打分、四步向导回退不丢。真机比回报多抓到的都是只有渲染才暴露的：`.judgeColumns` 仍是三列 grid，判据并进每列后第三列空着、作答区只剩 509 px，第二份被裁一半；chip 的 ok/busy 映到了品牌蓝与正文色，宿主明明有 success 绿；五处空态与向导文案还指向已并掉的「计划审阅」；计划文件读不到时裸渲染英文原句加绝对路径；计划点名、仓库里没有的对比组在表里静默省略而徽章照样 ✓。13 条都是呈现层，写成「T67 补充」一轮收完；实施者记下的三条数据面缺口（得分数值、产物下载、出网自检）与两处做不到文案字面的（绑定表单跨 tab、向导直落第 ② 步）理由成立，接受。走查稿 `scratch-screenshots/t67/walkthrough.md`。**T65 第二步 / T67 补充验收（2026-09-18 傍晚）**：两份回报同到。T65 第二步 `4599ae89` 合入 `a4880014`（eval README sidecar 冲突按配对脚本重生成），T67 补充 `6ea07d75` 合入 `e70f62fe`；合并态 eval 884 / datasets 214 / local-agent 270 / local-agent-dsh 206（主检出要先离线装上 T65 新加的 js-yaml，否则 10 个测试文件整体报找不到包，不是回归）。pilot D 收口证据全：四条不变量 ✅（环境一致那条是 T33c 拿不到的），比较节打开；实施者主动点明本轮 Δ 不作数（dsh-full 判官两次采样瞬时 error 被丢弃），按「只留必要测试」不重跑，接受。T33c 与 T65 一起 ✅。题库 `i4-pilot-d-close` → i1-walk `d9af6bc`（临时 worktree 合，共享检出 HEAD 仍 i3-probes）。T67 补充十条对照走查逐条落地；W13 一半是协调者看错（框有缺省、阶段没勾），W12 两份载荷定 review 赢（表画不画得出行由注册表定、就不就绪由 review 定），都接受。实施者删了一把别的 worktree 留下的 test-admission 陈锁（owner 已死、核过无活测试进程），共享资源先报后做，按规矩。3171 现在跑的是 T65 分支源码，不是 main：下一次重装（≥ `e70f62fe`，一次把 T55 守卫、T63 补充二、T67 与补充、T65 都装上）交 T65 实施者，文案 §三「T65 补充（二）」。**3171 重装 / 结果页反馈（2026-09-18 晚）**：3171 18:46 装到 `e70f62fe`，回报六项齐、协调者核过。用户看了结果页后的判断：「看不出来每个维度的得分对比和评委的评判依据，也看不到每个 agent 的运行过程以及结果」。查到根上：判据级判定（criterion / pass / ratio / evidence / by / judge）在 bundle 的 results.jsonl 里一行一条，report-view 只下发 invariants / pairs / efficiency，页面只画到每题总分——呈现与投影的缺口，并进 T54 一起做（§三「T54 补充（一）」）；产物内容判官台已能读归档、运行记录页只列路径；容器轮选手的过程转录在挂载的 scope home `local-agent/dsh@<scope>/sessions/` 里、宿主可读、没人挂到格子上，宿主轮的 childSessionId 是宿主会话——立 T69（产物内联 + 过程回放，可发，与 T54 并行按 graft）。**T69 用户改口径（09-18）**：直接用宿主的子对话视图，不自渲染。**T69 验收（2026-09-23）**：合入 `2be4b3bf`，eval 916。最值钱的发现是「认领」这个问题本身不成立——容器轮 sub-dsh 的会话经 session-mirror 本来就是宿主的 subagent 会话，协调者 09-18 记的「转录只在 scope home、没人挂到格子上」是看漏了镜像那层；顺带修了自 T35b 起「打开子会话」就打不开的缺陷（宿主要父地址）。判官会话开出来第一眼就是 claude 的 session limit 提示，这就是 pilot D 第二轮判官的由来——过程可见的价值当场兑现。协调者这次没起临时实例复核：实施者在活的 3171 上按 Remote 逐项验了（含拒绝路径），像素层等 T54 合入、3171 重装后一起看。另：协调者 09-18 起的临时实例 3199 已不在，端口被别的会话的复现实例占用（`/tmp/dsh-tab-repro-*`，DSH_HOME 不同，没碰），临时 home 与题库工作树已清。**T54 验收（2026-09-23 深夜）**：graft 后 `f48c6c35` 合入 `41dd6483`，合并态 eval 937。两处冲突都按文案解：守卫回到 `primaryPass` 顶部且是整格的——实施者点名「不符的列缺席」那支从 analyzeBundle 走不到（不变量先把闸合上），没为测它开口子、写明冗余，接受；判据表格子走 T69 同两条路。协调者顺带核 3171 时发现 guard 锚点 worktree 与 `guard/eval-3171` 在 09-21 的分支清理里被删（清理前账本 `../dsh-plugins-retired/all-branch-shas-before-2026-09-21.txt` 第 116 行记着 e70f62fe），launch-spec 还指着那个路径；实例本身 09-18 18:46 起没重启过、健康，只是看门狗此刻没有回滚点。重装文案「T54 补充（三）」：先重建锚点再装 `41dd6483`，不起新 run——报告页每次读都从 bundle 重算，pilot D 装上就有判据表。**3171 重装（2026-09-23 02:08）**：装到 `41dd6483`，26 秒就绪，guard 锚点重建在同一提交；停实例那步被实施者的自动模式拦，用户手跑放行。pilot D 结果页投影核到判据表、展开原文、产物内联与父会话地址，用户走查可开始。**I5 收口批立项（2026-09-23）**：交互稿作者交了提案 `2026-09-23-eval-journey-redesign` 与 v5（外壳不动、按仓库登记、D7 最先、事件回流待证），协调者审：可立项，四处要补（D1 没答 agent 往哪写——题库是共享检出、写走 worktree，这才是会话绑定 worktree 的由来；D7 按字面会误伤终评，改「判定覆盖一致」且 CI 与不排名同一个 n；D8 的中断推导不写账本、无 originSession 的 run 不隐藏；实验 chip 要用 composer 插槽）。分工：交互稿作者做 T70（ui-spec + 提案定稿）并协助后续前端验收，协调者审整体方案与合并。用户对现在的交互不满意，答复是：内容每页都改、外壳不换；不满若在壳上要赶在 T72 前定。**T70 修订（二）（同日）**：交互稿作者回了修订意见，转述用户三项裁定——会话里不放实验 chip（多实验显示不了，退路 tab 计数 + 列表 + eval_run_status）、人工评估不做阻塞项（只有启动有阻塞项，数据问题由计算口径降级、人的判断以标记跟着结果走，加 D9 四个出口与终态「评估不成立」）、置信区间按题数算（有差值的题 ≥ 3 道才给，排名仍按各题配对次数最小值 ≥ 3）；另指出「进程里没有活 job」会误判 CLI 起的 run，改为「停滞」= 无活 job 且无进展。协调者核过 comparePair 的 n 确是各题最小值、CLI 路径的 job 确在 CLI 进程里，五条全部接受，文案已改。**用户同日定验收参照线**：不满意的是内容、旅程、设计感，外壳不改；T71–T76 以交互稿 v5 按场景对照、视觉同等层次、待证项走退路不算失败；实施者每任务截图自查，收口时交互稿作者与协调者真机走一遍、一轮补充、再请用户走查。这回答了协调者此前「不满落在哪一层」的问题：T72 边界不变。**T70 验收 / T71、T73 发（2026-09-23 深夜）**：`bfc84273` 合入 `4a5f65b8`，11 条逐条落点、S18 入登记处；作者未跟踪草稿移到 scratch，package map 重生成 `6180ff61` 后 main gate 绿。T71（D7）与 T73（D1+D2 实施计划）文案已写，可发；T68 并入 T73。**T73 第一步验收（2026-09-23）**：计划 `adfc5233` 合入 `c1b70a4d`，现场数据（15 个实验分支未合回 main、38 条 worktree、3171 三份绑定一份悬空）与代码引用协调者全部复核成立；定 (b) 不设过渡期、条件与 lock 同搬部署级、rev13 归 T73（T74 顺延 rev14）、会话收窄不保留；六处修订随分支 1 第一个提交进计划。分支 1（datasets 登记表）可发、与 T71 并行；分支 2 等 T72；分支 3 随分支 2。题库仓库自此对 agent 纯只读、分析只随 bundle，用户若要一条回仓库的路在 T72 合入前说。实施者误在主检出 `pull --rebase`，当场 abort、主检出干净；上游就是 origin/main，不是配置问题。**T71 验收 / T72 发（2026-09-23）**：`5df1443a` 合入 `b67b645f`，合并态 eval 942（detached worktree 离线装依赖跑的；主检出 node_modules 陈旧）；第五条校验、区间按题数、降级只到这一对都按文案落地，pilot-d 的 summary 不再有 [4, 4]。实施者三点：短实验不再排名是「区间按题数」的直接后果（没有区间就没有名次，单题实验永远只做描述），协调者按裁定字面接受、请用户确认；降级那一对保留逐题数据只去平均 Δ / 区间 / 名次，接受并改 ui-spec 措辞；判官缺席用 bundle 原文不加注解，接受。T53 核实已由 T60 做掉（export-note）；T66 只剩句子半条。T72 文案已写（列表四组、停滞推导、页顶主动作全表、就绪清单 code → 修法映射、结论卡置顶、四个出口的 run 级注解 ns `eval-closure`、归档），可发；T74–T76 入表待发。**T73 分支 1 验收（2026-09-23 晚）**：五个提交合入 `036910ed`，合并态四包全绿；真机截图（登记表、题集列表、拒绝语，明暗 + 400px）与「从旧绑定登记」合并 3171 两份绑定都成立，共享检出前后没变。发现两件：`install.sh` 同族包漏 devDependencies 装不出来（立 T77，下一次重装前置）；3171 会话库里两份 09-19 由别的运行时写的会话带 `room/created` 事件、rc.1 拒绝解析，选中即题集页报错（交用户定）。分支 2 文案已写，等 T72 合入后开。**T72 验收（2026-09-23 夜）**：四个提交合入 `ee0a01fc`，合并态 eval 998；四张图核到交互稿同等层次（分组列表、就绪清单主按钮即第一条修法、结论卡第一屏、人工标记在卡顶）。代价按 Agent Note 接受：旧 run 没人收尾即读作评估中、CLI run 无心跳可能读成停滞。补充（一）的清单（人工评估页首判官缺席提示、provision 按钮中文、评估中与进度口径、行内主动作、旧 run 批量归档）等用户走查后一起发。T77 范围扩成 pack-dist + install.sh 两处；3171 重装文案已写、等 T77；T73 分支 2 可发。**T77 + T73 分支 2 验收（2026-09-24）**：T77 合入 `53b93082`（pack-dist 删 devDependencies、workspace:* 同样改写、install.sh 同族算 devDependencies；docs/packages.md 顺手重生成），T73 分支 2 合入 `587c12ae`（实验成为部署级对象：experiments/<id>/ 与条件库、起草钉版本与「版本不唯一」拒绝、导入、eval_analysis_write、第 ⑤ 块、配对三键、绑定尾巴退场、协议 rev13）；合并态四包全绿。pilot-d 的旧 run 靠 planPath 兜底配上（从修改版计划起跑、planSha 对不上），接受。可发：3171 重装（装 ≥ `587c12ae`，多一步导入 pilot-d）、分支 3（SKILL / preset + 试点，试点要用户配 provider）、T74 / T75 / T76（同包串行合）；25 条旧托管 worktree 清理文案已写、重装之后放行。**3171 重装 + 分支 3 + T74（2026-09-24 下午）**：3171 于 16:30 重装（含 T71 / T72 / T73 分支 1+2 / T77，pilot-d 已导入），实施者回报未转来、协调者只读核对过；分支 3 文本合入 `ed9e62f9`，试点在 3185 备好、等用户配 provider；T74 合入 `e80a328c`（rev14、方案卡、结论卡回答问题、数字文本级就地改、⑤ 块 markdown）。T76 / T75 回报同日到，三条同包两两冲突：T76 先合 main（含 T74）解冲突，T75 随后。结论卡把「拒绝排名」写成「未分高下」是 T74 要修的一条，并入补充清单。**交接（2026-09-25）**：协调者交接文档 [handoff-2026-09-25.md](handoff-2026-09-25.md)。同日凌晨 main 合入 host-016 适配线（`59077d33` 及后续，官方线钉 0.1.7-rc.1、各包双线、compat 仍 0.1.5-rc.1），评测线 3171 仍在 0.1.5-rc.1 工具链；下一次 3171 重装前先在 0.1.5-rc.1 临时实例上冒烟 host-016 之后的 main（交接文档 §3 第 4 条，建议立 T78）。T76 / T75 合 main 时会多撞 host-016 改的 eval client/index.ts、job.ts。

目标：一句话 → 计划 → 批准 → 跑完 → 报告，人只做审批与终评。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T46 ✅ | 代码 + profile | eval 预设摘掉 `mission-tool` 行（任务 tab 随之自隐）；eval-tool 加 `eval_cells`（按 run 读格子投影，收编原四个 mission 读工具的用途） | 无 | 合入 main `42ab0ae3`（2026-09-13，`39273ed4`）；`cells(runId, query)` 一格一行（坐标、桶、阶段、在态时长、attempt、refs、检查点、各 ns 注解数、childSessionId），投影算在服务端；eval-tool 四个读工具；用预设文件喂 mission 的 preset-visibility 证得任务 tab 在 eval 会话不注册；活实例原文并入 T35a 的真机步骤；「不给 run_id 就列评测 run」留给 T35a 的 runs 读面 |
| T48 ✅ | 文档 | 按 [ui-spec.md](ui-spec.md) 改写 README「最终 UI」与「工具按域开放」；修十处口径不一致（清单见 §三 T48） | 无 | 合入 main `cbadb266`（2026-09-16，`3f08d971`）；题库 `i5-docs`（`19358bc`）并入 i1-walk `3c5ebf4`：协议 v1-rev11、P0 指针修正、canary 埋进八个可见层文件（反向验证 CANARY_MISSING 会报）；「最终 UI」按七个子页逐行重写、依赖插件数成 26 成员三组；第 2 条（工具表）T46 已同步故零改动 |
| T35a ✅ | 代码 | eval client 半骨架 + 实验室 tab 列表与详情壳：tsconfig / tsdown / package 的 client 出口，`conversation.view` 注册（order 40，自隐按 eval-tool 行），Remote 会话态读面 `runs / run`，状态推导，六个子页路由（先只有概览） | T46 | 合入 main `7fff2efb`（2026-09-13，`78f76b86`）；临时实例 3199 上 eval 会话 tab 环「对话 · 轨迹 · 数据集 · 实验室」、无任务 tab，standard 会话两个都无；工具卡 33 个含 eval_cells 无 mission_*（T46 欠的原文补齐）；列表 11 行（3 run + 8 草稿）、run 与 plan 按解析路径或 planSha 配对；概览页字段齐；eval_cells 不给 run_id 即列评测 run（T46 的缺口收了）；状态推导五条边界写在注释与测试里；顺带改了 scripts/gen-typert.mts（eval 指向 tsconfig.host.json）与 docs/packages.md |
| T49 ✅ | 代码（脚本） | `install.sh --source` 自 pack-dist 的 family-edge 规则（`3406a471`）起坏了：`--family` 传的是光名字，打到 local-agent-tool-subagent 报 `is a family edge but no version was given`；改成 `name=version`，用临时 DSH_HOME 全量装一遍验证 | 无 | 合入 main `5e4ec1a3`（2026-09-14，`cd3c9ad4`）；27 个 tarball、7 个带家族、零 warn，临时实例起到就绪协议走完；`--dump-config` 24 成员是 profile 根的口径（伴生三包在预设层），判据里的 27 是 tarball 数 |
| T50 ✅ | 代码（脚本，小） | 三处脚本卫生：`scripts/gen-typert.mts` 全量模式在全新 DSH_HOME 上死锁（取锁用非递归 mkdirSync，scratch/ 不存在就空转 900 秒）；`install.sh` 第 287 行附近「成员不变量 23」的注释落后两轮；评估去掉 `GEN_TYPERT_ONLY` 让全量模式吃缓存（T35b 实测 27 包构建 80 分钟 → 12 分钟）；`scripts/gate.mts` 的 GLOBAL_PATHS 不含 `profiles/*/scripts/`，改脚本不触发整仓 | T49 | 合入 main `05050252`（2026-09-14，三提交）；死锁复现（未修版挂 11 分钟 CPU 0.1 秒）→ 修后 42 秒；gate 把 profiles/<id>/scripts/ 当共享层（探针 worktree 实测 scope 变整仓）；**GEN_TYPERT_ONLY 保留**——全量模式的 typert.host.js 会把本 profile 不装的 room / worktrees / canvas 的类型发进 mission 等成员 tarball（+4 KB、14 条 Room* 声明），注释写明两个耗时的前提；全新 DSH_HOME 全量装一遍 6 分 20 秒 |
| T51 ✅ | 代码（脚本，小） | gate 的 porcelain 解析错位：gitRunner 对输出 `.trim()`，`git status --porcelain` 未暂存行以空格开头，首行被吃掉一格后 `slice(3)` 少一个字符——改了 `scripts/foo.ts` 未 add 时 scope 成 NONE 假绿；改成按 `/^(..) (.*)$/` 解析或对 status 不 trim，补用例 | T50 | 合入 main `899410e9`（2026-09-16，`53e89adf`）；两处都改：gitRunner 只去尾部换行（抽成 trimTrailingNewlines 可测）、porcelainPaths 逐行正则；修前后 scope 原文对照（NONE → 整仓）；畸形行丢弃是「往窄里错」，唯一来源已堵 |
| T54 ✅ | 代码 + 方法论 | 报告的得分口径：按格取最权威 ns 整体算分（primaryPass），一格第一条 human-final 会让只有 llm-draft 判定的判据全部出局（T37 实测 4 → 1）；改成逐判据合并（human-final 只覆盖它判的那条），历史报告会重算——**用户 2026-09-18 定：逐判据合并**，文案见 §三。**补充（一）同日**：用户看结果页「看不出每个维度的得分对比和评委的评判依据」——results.jsonl 每行本就是一条判据级判定（criterion / pass / ratio / evidence / by / judge），只是投影不下发；结果对比页加「判据 × 对比组」表、每格展开依据与判官名（报告页已揭盲），与主任务一起做，文案见 §三「T54 补充（一）」。**2026-09-22 回报到（`8c47f0a2`，eval 902，gate 绿）**：逐判据合并、格级 sources、判据 × 对比组表、展开依据与判官、两份真实 bundle 无回归——内容都对；但 main 在分支基点后进了别的会话的 `e5106df6`（推理强度冻结：`primaryPass` 顶部加 `configurationMismatch` 守卫、`comparePair` 过滤不一致格），与本分支在 `report.ts` 的 `primaryPass` 冲突，**退回实施者合 main**，文案见 §三「T54 补充（二）」（2026-09-23，main 此时还含 T69，判据表接 openCell 一并做）；ui-spec §五 得分口径已回写。**2026-09-23 验收**：合 main 的 graft `f48c6c35` 合入 main `41dd6483`（合并态 eval 937、tsc 干净、README 418 对同步）——守卫在前且是整格的（不归因的格一条判据都不出，用例钉住），判据表也过同一条过滤；判据表格子接 T69 同两条路（一条记录 openCell、多条 focusRecords）；README 旧口径「按格取主判定」顺手改掉。3171 还在 `e70f62fe`，重装（连 T69 一起装上）+ 看判据表见 §三「T54 补充（三）」；顺带发现 guard 锚点 worktree 在 09-21 的分支清理里被删，重装先重建；**02:08 已装 `41dd6483`、锚点重建在同一提交**（补充（三）验收），用户走查 3171 | T37 | 一格的分数按判据取最权威层，来源混合要标出；历史 pilot 报告重算 |
| T52 | 代码（脚本，低优先） | gen-typert 的 stamp 按选中集做 key，让 scoped 模式也命中缓存（T50 实测 8 次 scoped × 44 秒占了安装耗时的九成）；这是缓存契约的改动，先方案 | T50 | install.sh 源码模式耗时降到分钟级以内 |
| T36 ✅ | 代码 | 实验室 › 计划审阅 + 条件页 + 「批准并启动」：validate 投影逐条、条件 list / diff 投影、启动经 Remote 转到既有 runStart | T35a | 合入 main `66dbdede`（2026-09-14，`7cb31f66` + `14753348`）；Remote 加 plan / conditions / conditionDiff / approve 四个带会话的 verb，approve 先 validate 有 error 即拒；临时实例 3199 上计划审阅、批准后的概览（就绪拒绝原文原样）、dsh-exec 与 codex-exec 的 diff 只报 7 个不同项；真机抓到并修了 runOutput 少传 cursor 被网关精确位参拒的 bug；「新建实验」占位指向 T34 |
| T35b ✅ | 代码 | 实验室 › 矩阵 + 格子 + 格子详情：mission 投影经 eval Remote（`cells / cell`）、因子选列、rep 圆点与卡格告警、三个动作转发（重跑 / 释放检查 / 导出计划与导出）、打开子会话 | T35a | 合入 main `e3fe4904`（2026-09-14，`57776e71` + 并 main 的 `57fec492`）；15 文件 48 处冲突按「两边都留」解净，Remote 18 个 verb、locale 207 键、占位页只剩 report / judging；面绑定 14 处显式传满位参并加守卫用例；合并态 eval 584；矩阵两种列（真账本按 scope、pilot-a bundle 按 harness 与 model）、抽屉、三个动作、导出对话框（mission 的拒绝原文原样转出）都有原文 |
| T38 ✅ | 代码 | 实验室 › 报告页：读 bundle 出四条不变量、配对、效率、一致性；finalize 与导出按钮 | T35b | 合入 main `c83c7fb9`（2026-09-14，`803e474b` + `bd76772b`）；Remote report / finalize 不配模型工具；bundle 按「刚导的目录 → plan 的 exports → 题库 exports」找，找不到给清单与「换个目录找」；比较闸在服务端合上（comparisonAllowed 为假时 pairs 不过线）；真机两种状态原文齐，finalize 一次原文，账本 history 记 by: tab；eval 608 |
| T37 ✅ | 代码 | 实验室 › 判官台：盲评队列、去指纹产物、llm-draft 与 human-final 并排；human-final 唯一写入口 | T38 | 合入 main `db4376e6`（2026-09-16，`f9ca4627` + `d675ea55`）；humanFinal 用序号 + 不透明 ticket（sha256(runId\0missionId) 前 16 位）而不是 mission id，判官显示为「判官 A / B」——格子名本身带 harness，照文案写会把它印进最不该带的页面；真机盲态 DOM 搜不到 harness / 模型 / 条件 / mission id；账本 human-final 追加不改写、by 为会话；eval 客户端 11 个 effect 无自取消形状；eval 641 |
| T47 ✅ | 代码 | 题集 tab 改造：列表页（槽位与层的对应、canary、validate、用于的实验）、详情的槽位标签与筛选、「选手将看到」、可判性、作答记录投影、题目骨架 / 导入题集 / 导入题目 | 无（与 T35 并行） | 合入 main `7ec52ed7`（2026-09-14，`14dca787`）；角色由 layers + register 定、槽位由基名启发式给出并按角色兜底，两种布局同一答案（slots.spec 成对表）；真机列表一行字段齐、P0 每个文件槽位与「谁看得到」对、「选手将看到」4 文件无答案键、可判性 13 条 7/5/1 对得上；骨架落位 4 文件、validate 报 RUBRIC_NO_ITEMS 指向占位（预期）；顺手修了 /datasets 的 composer 参数丢失（补 input.hint）；datasets 167 |
| T53 | 代码 ✅（**2026-09-23 核实：T60 已做**——`export-note.ts` 把导出记成 run 级注解，报告页 `reexportable` 读它） | 导出目录记进账本：T38 发现带 `--out` 导出的 bundle 在 run.meta 里无迹可寻，页面只能让人「换个目录找」；导出成功后由 eval 把目录记成 run 级注解（orchestrator ns）或 run.meta 字段，报告页优先读它 | T38 | 报告页对任何已导出的 run 直接找到 bundle |
| T34 ✅ | 代码 | `eval-planning` skill + `eval_plan_draft` 工具：把「写 plan / condition + validate」并成一个动作，草稿落实验室列表 | T36 | 合入 main `76b4f1a6`（2026-09-16，`83ba74ed`）；一个服务面动词 draftExperiment 三个面共用（表单 → Remote newExperiment、agent → eval_plan_draft、技能 SKILL.md 随 pack 装到 $DSH_HOME/skills）；新条件只能从现有复制改点名字段，从不覆盖；validate 不过照样落盘成草稿；真机表单与工具两条路径原文齐，会话里 34 个工具、技能卡有 eval-planning；「一句话让 agent 起草」那半边本机无 DeepSeek 凭据没跑，归 T39；顺手修了两个 profile 脚本 `set -e` 下 `[ -d ] && rm -rf` 提前退出的既有 bug；eval 681 |
| T39 ✅ | 运维 | 端到端走查：一句话到报告，记录人介入的次数与位置；先宿主路径，T33e 后再跑容器版拿 I4 的配对报告 | T34–T38 T47 | 题库 `i5-walkthrough` 并入 i1-walk `768df21`（2026-09-16）：3171 重装到含 T34 的 main，容器轮 dsh × {v4-flash, v4-pro} × P0 一跑到底，**四条不变量全 ✅、比较节打开——I4 要的配对报告**（Δ 0 vs 0 是 P0 的设计使然）；八步原文、人介入 17 次 = 8 设计内 + 9 缺口、缺口 G1–G18（硬六条：G1 未绑题集时 agent 拿 repo 参数写了共享检出、G3 bind 缺省 all layers 把答案层开给规划 agent、G5 绑定存字面 ~、G12 探针跳过根因是相位缺失、G14 选手在单元里没有 shell、G17 终评进不了 bundle）；R1 全程未被绕过；agent 写了分析初稿并自查出三件走查没查到的事；分析初稿 `docs/i5-walkthrough-analysis.md` |
| T57 ✅ | 代码（小） | run 与单元回收：`/eval run` 与「批准并启动」缺省跑完过释放闸（G10，留一个「保留单元」开关）；finalize 后在报告页显示未回收单元数并给回收动作（G18）；撞 maxConcurrentUnits 时的原文点名是哪些 run 占着 | T38 | 合入 main `4a11d4ad`（2026-09-17，`e0a37060` + `b423ecf5`）；三格容器 run 单元逐格交替、始终只有一只、跑后归零，`run.meta.finalize: true`；`--keep-units` 行为同今天；报告页未回收计数与「回收」走同一条闸；代价写在 Consequences：没有判定来源的宿主 run 逐格多一条 finalize-refused 注解；题库 `t57-release-gate` 并入 i1-walk `350bd25`；3171 重装到 `e0a37060`、锚点快进、看门狗 14 秒就绪；eval 707 |
| T58 ✅ | 代码 | 条件与绑定的最后一公里：未绑定会话里 `eval_*` / `datasets_*` 的 `repo` 参数收窄成只认会话绑定（G1）；`/datasets bind` 层缺省 visible（G3）；绑定路径归一化存 realpath（G5）；`model.endpoint` 进起草可改字段（G6）；provision 写回 `home.sha`（G7，或 lock 权威）；容器条件的 `unit` 段来源（G4）；绑定回执在空会话可见（G2） | T34 T36 | 合入 main `db3176a5`（2026-09-17，六提交：两包各自成提交 + 三条真机收尾）；G7 provision 缺省写回实测 home.sha、重算条件哈希、lock 锚改完后的文档（`--no-write-back` 保留两步形状）；G6 endpoint 成起草第七个可改字段并在条件页就地可改；G4 unit.ts 四行表补 unit.scopedHome 与 env.keys、补齐不计入「改了哪些字段」；G1 模型工具面的 repo 只能复述会话绑定（归一化路径比较，人的面不动）；G3 modelFacing 下限无条件、bind 回执点名缺省；G2 composer 只读 chip；G5 未碰（归 T62）；第 4 步人介入 6 → 2 是从代码路径推的；eval-planning SKILL.md 超文案范围改了（不改则 agent 起草永远把 endpoint 留 null）；真机截图查出并修了三处（自造 token、编辑器被裁、回执位置）；eval 741 / datasets 182 / eval-tool 4 / datasets-tool 5，gate 绿 |
| T59 ✅ | 环境 + 代码（硬） | 选手在容器单元里没有 shell：sub-dsh 报「宿主无可用 sandbox 后端且无审批通道，bash 全部被拒」（G14）；查 headless 在单元里的 sandbox / approval 配置怎么落（permissions: unrestricted 应当到位），真题轮之前必须解决 | T33e | 合入 main `8dc26e97`（2026-09-17，`19e52e7f`）；两条报错都成立且互相独立（镜像无 bubblewrap、Landlock probe 返回 unusable；无头子 dsh 没有审批通道），但都不是缺陷——**真正的缺陷是 local-agent-dsh 没有权限旋钮**，子 profile 跑的是 dsh-base 的 workspace-write + ask，决策 3 在四家里少一个执行点，宿主上没人察觉是因为 macOS 有 Seatbelt；修法：`permissions` 配置键，provisioning 追加一层生成 patch 覆盖 sandbox-policy.mode 与 approval.policy，值落作用域目录（进 home.sha）不落 env；web-eval pack 钉 danger-full-access（与 codex 同一条纪律）；单元里 bash 修后成功原文；镜像未动；local-agent-dsh 188、local-agent 267 |
| T60 ✅ | 代码 | 导出与终评：终评之后的再导出并标 bundle 的导出时间（G17）；报告页导出一并写盘 report（G15，与 T53 合并做）；详情页在 run 启动后自动拉一次（G11）；成员子会话 tab 的自隐判据（G13）；agent 写题库工作树的窄口（G16） | T38 T37 | 合入 main `0bc517d3`（2026-09-17，`4b7a4633` + graft 合并 `c35da837`：T63 作基线，四处冲突拿 theirs 整块再按锚点插回）；一次导出写 bundle + report/summary.md + results / usage，导出目录与时刻记 run 级注解（第一格写、读时扫全格取最新）；终评后「重新导出」进 <原目录>/re-<UTC>/，报告页与判官台同一句同一盒子；批准后每 4 s 重读列表直到账本有该 run（上限 15 次）、四子页显示「正在启动」；eval_repo_write 新工具（白名单 docs/、datasets/<题集>/plans | conditions | analysis/，items/ 永不可写，越界回整张白名单 + nothing was written）；effectivePresetOf 沿 parentSessionId 走，三份拷贝含 mission；人介入 6 步 0 / 7 步 2 / 8 步 1；eval 817 / eval-tool 4 / mission 134 / datasets 205；**活体验收通过（2026-09-18，3171 上，未起容器轮）**：G17 用 T39 那个 run 的两个时间戳（07:22 导出 / 07:32 终评）出「bundle 早于终评」；一键导出 113 文件 + report/ 三件、noteRecorded；不带 outDir 再读自己找到目录（T53）、标注翻面；重新导出进 re-<UTC>/、三个目录都在；G11 窗口实测 3.2 s，四子页「正在启动」、4 s 跟进拉追上；G16 会话里 eval_repo_write 写成功、items/ 越界拒绝原文、无沙箱升级；G13 主会话与两个成员子会话 tab 条一字不差、无 Missions；ankh-guard 泳道空载单跑全绿，确认前一轮是负载抖动 |
| T62 ✅ | 代码（热修，小） | 两个 tab 打不开：绑定存字面 `~`，git 与 datasets 层不展开，题集列表与条件页整页报错（走查 G5，从 T58 提前拆出）；错误态改三段式（人话 + 修法 + 折叠的详情），页面不再直接渲染 error.message 与绝对路径 | 无 | 合入 main `35b23bf7`（2026-09-17，七提交，含实施者自己并入 main 的一次 graft）；绑定存规范路径（展开 ~、realpath、去尾斜杠），两包归一化函数合成 T58 的 repo-path.ts 一份，eval 读侧并进 validate.ts；两个 tab 22 处裸错误改三段式，四种码（路径不在盘上 / 不是题库缺 datasets/ / 未绑定 / 服务）各有人话 + 修法 + 折叠详情，中英两套；条件页 provision / endpoint 动作位也过错误态；datasets 先判存在性再跑 git，eval 把「不是题库」拆两句；datasets 198 / eval 756，gate 绿；**3171 已重装到 `2c4476f8`**（2026-09-17 14:51，e0a37060 → 2c4476f8，detached worktree 源码模式，看门狗通道停起、锚点快进、就绪 13 s；题集与条件页真机打开，旧绑定读一次自愈；默认会话 35 个工具，无 mission_*） |
| T63 ✅ | 代码（界面收口） | 题集 + 实验室两个 tab 的整体设计与文案收口，一人从头到尾负责，按 ui-spec §九：沿用宿主 tokens、人话标签、列永远是条件名、状态词表、空态与错误态同一组件、矩阵页重做、报告与判官台同套样式；交付每页明暗两套截图 + 对照 ui-spec 的核对表，然后人验收 | T62 ✅ | 合入 main `00828fcd`（2026-09-17，九提交，含并 main 一次）；两包各一份 vocab.ts 状态词表（账本阶段、五桶、重跑类别、条件叶子字段，中英各一套，查表全函数）；矩阵列头永远是条件 id、因子值作副标题，随动字段（home.sha / env.keys / unit.scopedHome.*）折到底部一行；mixed 状态从 cell.reps[].state 自己算；§九 举例里四个不存在的宿主 token 换成主题包真有的；文案闸 copy.spec 两包；24 张明暗截图 + 核对表在 scratch-screenshots/t63/；协调者看图验收通过，两条进用户走查清单（条件页列头仍是键名与英文 provision；英文术语列头）；两条只记不改记 T66；eval 777 / datasets 203；用户 2026-09-17 夜走查完毕：提了一整套信息架构级意见（四阶段导航、术语降维、CTA、向导、图表、并排盲评、色彩语义），这是规格缺口不是执行缺口 → ui-spec §五 v2 + T67；**补充（二）合入 `87b713ec`（09-18）**：术语表 v2、五档色彩语义、数字与句子；矩阵 → 网格按 §九 v2；运行状态一列「阶段常显、桶只在阻塞 / 排期时出现」；终态灰、已判绿；正文四十来条「条件」一并改「对比组」，英文词典与契约路径不动；eval 834 / datasets 214 |
| T61 | 代码（低） | 容器轮里 member-bridge 行起不来（单元里 `DSH_MEMBER_BRIDGE_ENTRY` 为 SyntaxError），走 failOnStartupError: false 降级，每个容器轮 stderr 一段噪声；查该行在单元里该不该挂、不挂就别起 | T59 | 容器轮 stderr 干净 |
| T64 | 观察 | claude 探针 credentialFileExpiry 取 access / refresh 较晚者，access 已过期、refresh 未过期的死凭据报已认证（T55 发现，lab 那份当时就是）；kimi credential-guard 的 .bak 还原可能重放已消费的 refresh token（同族，只在精确空壳上还原）；收紧会让现在 ready 的 scope 变 not ready，等 T55 活体验收过了再定；T55 二期量到具体后果：登录 watch 先同步再探针，比全新登录写进 keychain 早 51 秒就判成功收工，此后没有东西把真凭证镜像进去。另记：local-agent 发布组版本线不齐（claude-code rc.5、其余 rc.6，gate 只警告、--release 才致命），发布侧决定，npm 风控期先记着 | T55 | 方案 |
| T65 ✅ | 代码（中，先方案） | 容器轮里 sub-dsh 要能解析 preset：单元只挂 scope 目录，roster 的 roots 指宿主 preset 根（T33c 受阻根因）；「preset / 技能作为因子」在产品里没有一条能打开比较的路径。**2026-09-18 改写**：roster 本来就扫 `<scoped home>/.agent-presets`（local-agent-dsh 的设计：往那里放目录就是 scope 自己的 preset），真正的阻碍是 T32b 的 scopeDefersToInstancePresets 守卫——scope 有自己的副本就拒量，把 roots 逼向单元不挂的实例根；preset 已正本化（6b8a919a：git 正本 → sync-presets.sh / pack 装到实例根）。推荐：provision 把实例根那份逐字节快照进 scope、量快照、守卫改成「快照 = 实例根」；挂载改法作备选；customSkillDirs 的绝对路径两侧怎么都成立要在方案里定；**方案已交（`76946b2b`，合入 `df8fe0fa`）并定案（09-18）**：快照进 scope，守卫改「持有即须与实例根逐字节相同」（canonicalCapabilities 不含路径，同字节必同哈希，T32 真机撞到过）；customSkillDirs 用官方 `!!js` baseUrl 表达式，作因子的 preset 组合里不得出现绝对路径（快照端与测量端都拒）；重启地雷选完整变体：`<scope>/sub-profile.json` 记 preset、provisionScope(name, scope, {preset}) 进 local-agent 注册表（另三家逐字节不变）、conditions provision 调用；lock 记 capabilities.snapshot.sha + source（不记宿主路径），协议 v1-rev12，就绪与 validate 都能离线核；副作用接受（两个 home.sha 变、条件哈希由写回记录）。**第二步合入 main `a4880014`（2026-09-18，`4599ae89`，40 文件；唯一冲突是 eval README sidecar，协调者按配对脚本重生成）**：provision 三条预期逐条对上（caps 哈希不动 `ac0cab44d0a5…` 4/3、`827f9be08fed…` 5/3，与 T33c 逐字相同；home.sha 都动；条件哈希各动一次由写回记录），就绪再算的 snapshot.sha 与 lock 一致、跑完复算仍 MATCH；单元里仍只一个挂载，preset 连 skills 在 `/creds/dsh/.agent-presets/eval-full/`，unit 段 / 挂载契约 / 环境指纹未改；协议 v1-rev12（中英 + sidecar + 夹具 + 防漂移测试）；Agent Note 挪到 `implemented/architecture/`；题库 `i4-pilot-d-close` 并入 i1-walk `d9af6bc`；合并态 eval 884 / local-agent-dsh 206（要先在根目录离线装上新依赖 js-yaml）/ local-agent 270 / datasets 214。3171 于 2026-09-18 18:46 重装到 `e70f62fe`（13 s 就绪，锚点同，单元前后 0，装好的 lib 里核到 scope-snapshot / provisionScope / sub-profile.json） | T33c T32b | 判据成立：pilot D 一轮 P0 容器轮两条件 ready、四条不变量 ✅、比较节打开 |
| T66 | 代码（低；**chip 半条随 T70 / T73 退场**——题集 chip 已删，只剩句子半条，排 T72 之后） | T63 走查记下的两条：宿主端拼好的中文句子（pivotMatrix 汇总、report 不变量明细、rankReason）英文界面下中英混排，要下发结构化字段由浏览器半边组句；composer 的「题集」chip 只靠会话活动重读，题集 tab 表单里的绑定不通知它 | T63 | 英文界面无中文句子；tab 表单绑完 chip 立刻变 |
| T67 ✅ | 代码（界面重构，两个里程碑） | 按 ui-spec §五 v2 重构实验室 tab：四阶段导航（实验设计 / 运行记录 / 结果对比 / 人工评估）、每页一个主动作、术语表、高级设置折叠、就绪徽章、同一网格跑前跑中两用、四步向导、运行记录详情（得分头部、时间轴、键值表、附件区）、结果对比（有效性校验 ✓/⚠ + 悬停、柱状图、格式化）、人工评估（同题并排各自打分、队列筛选、一致性通俗化）；协调者自己驱浏览器验收 | T63 T60 | 两个里程碑合入 main `b2f0c7a5`（2026-09-18，`fc20bd82` + `6661530c`，eval 850）；协调者在临时实例上驱浏览器看了明暗两套，14 行核对表全部核到；走查 13 条（状态色 token 映射反、判官台并排列被三列 grid 裁掉、空态文案残留「计划审阅」、计划读不到裸渲染英文与绝对路径、缺失对比组被静默省略、rep / validate / finalize 英文词等）一轮收完，补充合入 `e70f62fe`（`6ea07d75`，eval 860 / datasets 214，十条逐条落地；W13 一半是协调者看错——三个框本有缺省 1 / 60 / 10，卡住的是「阶段」没勾而提示不点名）；用户走一遍随下一次 3171 重装 |
| T68 | 代码（小，**2026-09-23 并入 T73**：会话去绑定后「dataset.repo 必须等于绑定」的规则退场，计划钉 repo@commit） | 计划里的 dataset.repo 指向别的检出（T55 探针发现：t29c-four-harness-readiness 等四份指 wt-i4-env，那里没有 claude-exec-c），resolveDatasetRoot 优先用它，走 /eval run 会从旧检出解析条件、计划里换了条件名也白换。定：起草与 validate 时 dataset.repo 缺省即会话绑定、写了就必须等于绑定（与 G1 同一条纪律，不等即拒并给原文）；题库四份容器计划改掉或删字段 |
| T69 ✅ | 代码（中） | 运行记录详情看得见「跑了什么、交了什么」（用户 2026-09-18）：文本产物就地能读（eval 自己的只读动词，限定该格目录、大小上限，不等宿主文件服务）；过程回放——容器轮选手是单元里的 sub-dsh，转录写在挂载的 scope home（`local-agent/dsh@<scope>/sessions/…`），**用户 2026-09-18 定：直接用宿主的子对话视图，不自渲染**——判官与宿主轮本来就是宿主会话，`sessions.open` 一开就是；容器轮把 sub-dsh 的会话目录认领成宿主会话（宿主持久层扫目录），同一颗「打开子会话」；认领不成再退回自渲染；结果对比页每格可点跳到详情 | T67 T54 | 合入 main `2be4b3bf`（2026-09-23，`765bcc74` + `744c4378` + `13ff0dda`，eval 916）。**认领三问都不成立——容器轮选手的转录本来就是宿主会话**：local-agent-dsh 早把 sessionId 交回（cliSessionId = childSessionId），session-mirror 逐轮把 sub-dsh 事件并进宿主侧子会话，`session/list` 里 origin: subagent；所以不拷目录、不自渲染。真机翻出一条自 T35b 起就在的缺陷并修了：`sessions.open(childId)` 只按 id 选中，宿主对 subagent 会话要父地址，整页只剩一句 Failed to load history——格子详情带 run 的 originSession，客户端先刷父的 catalog 再 openSubagent，三条失败路回落按 id 选中。产物内联：stage1.md 就地读出 7905 字节，越界（同 run 另一格、绝对路径）都拒；判官那格开出来直接看到「You've hit your session limit」——pilot D 第二轮判官的原因；配对表的数点得开落到记录。`docs/packages.md` 那条是 main 上 canvas 0.4.4 与表里 0.4.3 本就不对，重生成接受 | T58 T55 | /eval run 永远从绑定的仓库解析条件 |
| T70 ✅ | 文档 | 提案 `proposals/active/2026-09-23-eval-journey-redesign.md` + 交互稿 v5 立项（协调者 2026-09-23 审：可立项，四处要补——D1 没答「agent 往哪写」、D7 不变量按字面会误伤终评、D8 的「中断」应推导不写账本、实验 chip 要有宿主插槽）。ui-spec 是口径正本，先按提案改 §四–§七 再派 T71–T76；由交互稿作者做，协调者审整体方案。文案见 §三「T70」；**修订（二）同日**按用户三项裁定改了 2、3、8、9 条并加第 11 条 D9（不放实验 chip；人工评估无阻塞项、四个出口；CI 按题数、排名门槛不变；「中断」并「卡住」为推导态「停滞」）。**验收 2026-09-23**：`bfc84273` 合入 main `4a5f65b8`，11 条逐条落点、S18 入登记处、提案定稿（planned） | T67 T54 T69 | ui-spec 成为 I5 收口批（T71–T76）的口径正本；提案定稿 |
| T71 | 代码 ✅（`5df1443a` → main `b67b645f`，2026-09-23） | D7 结论校准：第五条校验「判定覆盖一致」（只降级这一对，不闸整节）、置信区间按题数（有差值的题 < 3 道不给）、排名门槛不变（n = 各题配对次数最小值 ≥ 3）、判官缺席可点名；summary.md 同步。文案与验收见 §三「T71」 | T70 T54 | pilot-d 不再出现 CI [4, 4]；两组来源不齐降级为描述并说明原因 |
| T72 | 代码 ✅（`7edc08a1` → main `ee0a01fc`，2026-09-23；补充（一）待用户走查后发） | 实验室四阶段的旅程与结论先行（提案 D8 / D9 / 第 1、2、3、11 条）：列表四组 + 缺省「本会话发起」+ 「另有 n 个」、状态词加终态「评估不成立」与推导态「停滞」（无活 job 且无进展）、每阶段页顶状态 + 一个主动作全表、实验设计下半段「就绪清单」（阻塞项 / 提醒 + 就地修复）、结果对比「结论卡」置顶（用 T71 的字段）、人工评估四个出口（run 级注解）与「判官缺席」提示、归档。文案与验收见 §三「T72」 | T71 T70 | 交互稿 v5 四个场景（列表、就绪清单、结果对比、人工评估）真机对照同等层次；pilot-d 的结果页第一屏是结论不是表 |
| T73 | 方案 ✅（第一步计划 `c1b70a4d`）→ 代码 | D1 + D2 会话去绑定、按仓库登记。第一步计划已评审（2026-09-23）：定 (b) 不设过渡期、条件与 lock 同搬部署级、协议 rev13 归 T73、会话收窄不保留。第二步三条分支——**分支 1** datasets 登记表 ✅（`201fb6cc` → main `036910ed`，2026-09-23）、**分支 2** eval 实验目录 ✅（`cdea013e` → main `587c12ae`，2026-09-24；验收见 §三）、**分支 3** SKILL / 提示词 ✅（`637b47f7` → main `ed9e62f9`，2026-09-24）+ 试点（**用户 2026-09-25 定：并进 3171 重装之后，在 3171 上跑**；3185 撤掉）；三条已合完，试点过才算 T73 验收。T68 并入 | T70 T68 | 写入模型定案；agent 不再翻磁盘找检出；未登记仓库不可用 |
| T74 | 代码 ✅（`57533026` → main `e80a328c`，2026-09-24；补充一条见验收） | D5 方案卡：plan 加「要回答的问题 / 预期 / 怎么算回答了」三个字段（协议 rev14）、实验设计上半段方案卡、结论卡原样回答问题、就地改数字（启动前，写回同一个 plan，启动后冻结）；文案见 §三「T74」 | T72 T73 | 结论卡第一句是对问题的回答 |
| T75 | 代码（`2d883a2e` 已报，**等 T76 合入后合 main 解冲突再合**） | D6 作答视图：按「题 × 组 × 次」并排，两个视角（提交的报告 / 判定证据），盲评开关即人工评估视图；三处入口；文案见 §三「T75」 | T72 T69 | 人工评估与作答视图是同一个组件 |
| T76 | 代码（`139336e5` 已报，**合 main（含 T74）解冲突后合**） | D3 会话面：eval_plan_draft 工具行渲染成实验卡（宿主 tool.call.toolview，无批准按钮）、eval_experiment_get、实验 tab 标签计数待证、S18 退路；文案见 §三「T76」 | T73 T72 | 会话里起草 → 打开实验设计一跳到位 |
| T77 | 代码 ✅（`ced3702e` → main `53b93082`，2026-09-24） | 源码模式装不出来：`install.sh:327` 算同族包只看 dependencies / peerDependencies，`scripts/pack-dist.ts:343` 只改写 `workspace:^`；`e9110d52` 把 content-preview 以 `workspace:*` 加进 local-files / ui-file-preview / worktrees 的 devDependencies，pack 时 ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL（T73 分支 1 与 T72 验收各自撞上、各自临时绕过）。文案见 §三「T77」 | 无 | 从 detached worktree 跑 `install.sh --source … --fresh` 到临时 DSH_HOME 一次成功 |
| T78 | 验证（可发，2026-09-25） | host-016 之后的 main 在 0.1.5-rc.1 工具链上冒烟：main 已钉官方线 0.1.7-rc.1、eval 家族做了「双线」适配，评测线 3171 与临时实例仍是 0.1.5-rc.1；只回答「当前 main 能不能在评测线上装得起、跑得通」，不修代码。文案见 §三「T78」 | 无（与 T76 合 main 并行） | 成立 → 3171 照常重装；不成立 → 错误原文 + 定位提交，交用户定钉旧提交还是换线 |
| T79 | 验收（联合走查，可发的前置见文案） | I5 收口前的联合走查：交互稿作者 + 协调者在 0.1.5-rc.1 临时实例上装合完 T75 / T76 的 main，对照交互稿 v5 的 13 个场景逐个看，与 T72 补充（一）、T74–T76 补充清单合成一份收口补充清单。**用户 2026-09-25 定顺序**：先联合走查、补完，再重装 3171 请用户走查。文案见 §三「T79」 | T75 T76 T78 | 一份收口补充清单（场景 × 差距 × 修法 × 归谁），即 T80 的文案底稿 |
| T80 | 代码（待 T79） | 收口补充一轮：按 T79 的清单改；文案在 T79 之后写 | T79 | 交互稿 v5 各场景同等层次；之后 3171 重装（含 T73 试点）→ 用户走查 |
| T45 | 代码 + profile | eval 模式化（单实例多模式，见 proposals/active/2026-08-26-mode-switcher.md）：datasets / mission / eval 的工具行拆成不 provide 的伴生工具包进 eval preset；local-agent 家族 provider 名从 config 读，eval 用命名 provider 行承载 live / sandbox / 端点 pin；web-eval 从独立 profile 模板变成可装进主实例的场景包；I5 三个界面按自隐约定只在 eval 模式的会话显示 | T29 T31 T35–T38 mode-switcher M4' | |

eval 模式化（2026-09-11 规划）：目标是日常实例里能开一个 eval 模式的会话看结果、起小 run，别的会话看不见 datasets / mission / eval 的工具与界面。三层边界先说死：模型可见的工具与 UI 按会话（preset 授予 + 自隐约定）；服务面、Remote 与斜杠命令永远实例级（`ctx.provide` 的包进不了 preset，提案实测）；provider 的实例级 pin 靠命名 provider 行共存（官方支持同产品多命名实例，家族今天名字写死在包里）。三笔改造：拆工具行成伴生包（提案 M4' 形态，lab 无工具不用拆）、命名 provider（T29 的 scope 与 T31 的 lock 已把 provider 配置收进条件哈希，隔离从必须变偏好）、场景包形态（patch 层的 pin 要么进 preset 要么进命名行）。**重的 pilot 仍在 ~/.dsh-lab 的独立实例跑**：就绪探测与判官委派在宿主上跑，danger-full-access 的委派不与日常会话共处，测量纯净性与爆炸半径两条理由与提案一致；两边共用同一套包。文案在 T29、T31、M4' 落地后写。

验收：README I5 行；人介入点只剩批准与终评两处。

### I6 · 外部评测集与开放

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T40 | 代码 | datasets：item 级外部源指针 | 无 | |
| T41 | 代码 + 数据 | SWE-bench 适配脚本（visible = problem + base_commit，verify = FAIL_TO_PASS / PASS_TO_PASS，grading = gold patch） | T40 | |
| T42 | 代码 + 数据 | Terminal-Bench 适配脚本 | T40 | |
| T43 | 数据 | train / dev / test 标签进协议与题集 | 无 | |
| T44 | 分发 | 镜像仓、agent 照 README 安装验证、npm 第二波 | 全部 | |

验收：README I6 行。

## 三、指引文案

可直接转发给实施 agent。每段自包含，含分支与 worktree 要求。**下面这段「实施者通用提醒」随每条文案一起转，文案正文不再重复**（2026-09-11 起）：

```text
实施者通用提醒（随任务文案一起生效）
- 合并归协调者：做完只回报分支名与 commit，不要自己 merge 进 main，也不要删分支或 worktree——协调者验收、合并、清理。
- 分支里不要混进 ankh-guard 自动打的「dsh-ankh-guard checkpoint」提交；若已混入，回报里点名，协调者按 squash 合。
- npm 账号风控期间不从 npm 安装任何 @khorsheed 包：装 profile 用源码模式打 tarball 或本地已有 tarball（web-eval 的 install.sh 已按此处理）。
- 从 main 开 worktree，分支只改文案指明的目录；题库仓库是多 agent 共享检出，写操作一律 `git worktree add` 后再动，从 i1-walk 开，不在共享检出上 checkout。
- 不碰 ~/.dsh-official 与 3080；凭据不复制，不进日志、回报、提交；共享资源（docker 容器、边车、实例进程）要动之前先在回报里提出，由协调者放行。
- Agent Note 双语并写 Alternatives considered；README 双语 + sidecar；`pnpm gate` 绿，ankh-guard 的 lane 抖动按既有规则单跑复核并点名。worktree 里跑 gate 用 `pnpm --config.verify-deps-before-run=false gate`（绕过 pnpm 对软链 node_modules 的依赖状态检查），不改 pnpm-workspace.yaml。
- UI 切片的真机验证用独立 DSH_HOME + 空闲端口的临时实例（源码模式装 web-eval），不碰 3171 / 3080 / ~/.dsh-official / ~/.dsh；用完停掉、清掉。UI 切片按 ui-spec §九 自查，回报里逐条说明落在哪一页；不要求每个切片各自截图（每次截图都得登录 + 发一条消息才进得到聊天界面，成本高），截图由界面收口任务（T63）统一交每页明暗两套，协调者与用户看图验收。
- **工具链固定在 `~/.dsh-toolchains/rc-0.1.5-rc.1`（2026-09-23 明写）**：宿主检出 `~/code/deepseek-harness` 已到 dsh-v0.1.5-rc.3（prod 3080 从它起），评测线不跟——题库 7 条 dsh 条件与 lock 钉的是 0.1.5-rc.1，换工具链等于换受试对象（provision 核对会把全部条件判成未就绪，第四条不变量会把新旧 run 隔开）。3171 与所有临时实例只用 rc.1 工具链的 PATH，不从 harness 检出起实例；切 rc.3 是单独的任务（建工具链目录、依赖与 minHost 对齐、条件重声明与重 provision、镜像重打），I5 收口后再排。
- 重装 3171 的配方（T63 踩过的坑）：先 `export PATH=~/.dsh-toolchains/rc-0.1.5-rc.1/node_modules/.bin:$PATH` 与 `export DSH_HOME=~/.dsh-lab`（install.sh 的 preflight 与 guard 的 record deployment 都要）；停法先 TERM 启动器那层，或放 stop marker 后等看门狗自己收——直接 TERM 看门狗会把启动器与实例进程孤儿化、端口 60 秒不放。
- 分支开出去之后 main 若又合了同一个包的别的切片，回报前先把 main 并进分支、解掉冲突、重跑 gate；协调者不代解代码冲突。解追加型冲突用 graft：从 base / ours / theirs 取原文，按稳定锚点把自己追加的整块插进 main 版本，不逐 hunk 拼 ours+theirs。
- 并行任务写题库时各用各的 worktree，不碰别人分支上的 plan / condition；会话里的 agent 起草只认本会话绑定的题库（T58 之前尤其要盯：未绑定时它会拿 repo 参数自己挑一个）。
```

### I1 的文案（已全部完成）

T1 到 T6 与 T1b、T3b 的原文见 git 历史（本文件在 `a1581e4`、`3cd87b3`、`a5abb7d` 三次提交中的版本）；结果与合入记录见第二节 I1 小节。

I1 已收口（2026-09-05）。I2 的目标：一格全自动跑完；F2 + F3 × 四家 × 3 rep 出第一份带保留条款的结论。分两波：**第一波** T8、T10、T11、T12、T13 互不依赖可并行；**第二波** T9、T14、T15 在 T8 落地后发，它们的形状取决于 T8 实际产出的 run 记录与 ns 载荷。下面是第一波的五段文案。

### T8 · eval 编排器 v0：模板生成 + 阶段一二的 run 循环（宿主目录）

```text
# 任务 T8：@khorsheed/dsh-eval 编排器 v0——模板生成 + 阶段一二的 run 循环

## 背景
I1 已把一格评测在宿主上手工走通（题库仓库 ~/.dsh/scratch/dataseek-eval 的 docs/i1-walk-log.md 逐步记了耗时与人肉动作），三份契约与 validate 已落地（packages/eval）。你的任务是把手工走通的那条路变成程序：读 plan，生成 run 模板，展开矩阵，逐格委派、提交、推进、归档、导出。本轮只覆盖阶段一二（写文档的两个阶段）、宿主目录代替容器、不做判官（T9）、不做报告（T10）。

## 先读
AGENTS.md、docs/development.md、profiles/web-eval/README.md（理想流程、冻结决策）、profiles/web-eval/docs/architecture.md（第二节轨迹表第 8 到 18 步、第五节四条不变量）、profiles/web-eval/docs/iterations.md、docs/dataset-authoring-protocol.md §6（契约）、packages/eval 现有源码、packages/mission/README.md 与 src/service.ts（runCreate / submit --to / transition / annotate / retry / export）、packages/datasets/src/service.ts（snapshot / worktree_path / read）、packages/local-agent/src/index.ts 的门面 start / resume / cancel 与 LocalAgentRunProgress、proposals/closed/2026-08-18-local-agent-delegation-api.md；题库仓库 i1-walk 分支：templates/bench-v1.json、schemas/、manifest.yml、visible/prompts/、docs/i1-walk-log.md。scripts/integration-triad.mts 是同类驱动的先例。

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

### T15 · pilot A（已完成，2026-09-08 收口）

```text
# 任务 T15：pilot A——F2 + F3 × 四家 × 3 rep，阶段一二

## 背景
这是第一次真实对比，目的是出一份带保留条款的结论，并把判官、rubric、去指纹的问题全部暴露出来。不进容器，宿主上跑，隔离只到每格独立 cwd；结论只用于验证流程与判官，不用于发布。

## 先读
profiles/web-eval/README.md 全文、docs/architecture.md、docs/iterations.md I2 小节、packages/eval/README.md、题库 harness-comparison 的 README.md、docs/dimensions.md、docs/players.md、items/F2-*、items/F3-*；~/.dsh/scratch/dataseek-eval/docs/i1-walk-log.md 与 T8b 的回报。

## 分支
dsh-plugins：从 main 开 worktree ../dsh-plugins-wt-web-eval-pins，分支 feat/web-eval-pins，只改 profiles/web-eval/。题库仓库：i1-walk 分支继续。

## 步骤
0. 评测 pin 进 profile：把 mission tools read、datasets tools authoring、eval tools all、四家 live false、codex sandbox danger-full-access（宿主直跑阶段用 workspace-write 并在 methodology 里声明）、claude permissionMode skip、kimi thinkingEffort high 写进 profiles/web-eval/cordis.patch.yml；决定该文件归 pack（update.sh 也覆盖它），README 与 update.sh 同步，Agent Note 说明与 web-dev 的差异。
1. 条件：conditions/ 下建 codex-exec、claude-exec、kimi-exec（dsh-exec 与判官条件 judge-dsh-v4-pro 已由 T8b / T9 建好），model.declared 与 harness.version 取自各家 /<harness> status 的 effectiveSettings；判官沿用 judge-dsh-v4-pro，要换模型就另建条件并在 plan 里声明。
2. plan：plans/pilot-a.json，items [F2-multi-agent-room, F3-self-restart-report]，conditions 四个，reps 3，stages [stage1, stage2]，order.seed 记录，budget.activeMinutes 60，judge {conditions: [judge-dsh], samples: 2}，retry.infrastructure 1，expectedNs [script, llm-draft, human-final]。dsh-eval validate 通过。
3. 运行：/eval run --concurrency 2（阶段一二 manifest 允许并发），过程中用 eval_run_status 观察；卡住的格子记录不手工干预，超时由编排器处理。
4. 判官与终评：run 结束后 llm-draft 已由 T9 自动入库；human-final 对每题每条件至少一个 rep 由你按 rubric 写入（dsh-mission annotate --ns human-final），其余如实缺失。
5. --finalize 后 export，dsh-eval report；报告的四条不变量必须成立，否则先修再跑。
6. 写 methodology.md：四家配置与已知不对称（players.md 的清单）、宿主直跑的隔离限制、判官模型选择理由、保留条款；结论按题配对呈现，不做总排名。
7. 回填缺口清单：过程中每个人肉动作与卡点，按 I1 走通日志的格式写 docs/pilot-a-log.md。

## 约束
pilot 期间 ~/.dsh-lab 的 web-eval 实例由本任务独占：其他任务不得在该 profile 上重装或跑 run（I2 第二波两个 agent 互相覆盖过 tarball）；用 install.sh --source --fresh 装最新 main 后不再改动。不碰 3080。选手与判官都在宿主直跑，隔离只到每格独立 cwd，结论只用于验证流程与判官，不用于发布。

## 完成判据
24 格全部到 released；report 不变量全部成立；判官一致性有数字；methodology.md 定稿；pilot-a-log.md 存在。

## 回报
题库 commit、bundle 路径、summary.md 全文、pilot-a-log.md、profile pins 的 dsh-plugins commit。
```

### I3 的文案

I2 已收口（2026-09-08）。I3 的目标：容器内一格全流程，release 经闸；四家在容器内跑通同一题。第一波八段互不依赖可并行；T17 / T20 / T22 的文案等 T16 回报后写，它们的形状取决于镜像与 CLI 的实测结果。每段的通用约束不再重复：从 main 开 worktree，分支只改指明的目录；Agent Note 双语并写 Alternatives considered；`pnpm gate` 绿；不碰 3080，不共用 ~/.dsh-lab 的评测实例（要跑实例就另开 profile 与端口）；日志、回报、提交里不得出现凭据。题库仓库是多 agent 共享检出：写操作一律先 `git worktree add` 再动，不在共享检出上 checkout 分支（T16 已经被切走过一次 HEAD）。

### T16 · 运维：题集级镜像与四家 Linux CLI 实测（已完成，2026-09-08 验收）

```text
# 任务 T16：验证题集级镜像、四家 Linux CLI、本地包镜像与白名单代理

## 背景
I3 要把选手搬进容器。architecture.md「运行环境」一节把环境定义放在题库的题集级 env/（Dockerfile + versions.lock），并规定：四家 CLI 版本 pin 死、harness 源码 pin commit 并预装依赖、镜像里不得有参考实现、容器无外网只走白名单代理、依赖走本地包镜像、各家凭证以专用可写卷挂进容器。这些至今都是文字。本任务把它们逐条变成实测结论与可复现的构建。

## 先读
profiles/web-eval/README.md「冻结决策」与「安装」；profiles/web-eval/docs/architecture.md「运行环境」；题库 datasets/harness-comparison/env/ 现有内容与 README；题库 docs/players.md（四家 CLI 的安装与登录方式）；docs/ops.md 的环境拓扑；packages/lab/README.md（acquire 的 image 与 fingerprint 语义）。

## 分支
题库仓库：从 i1-walk 开分支 i3-env，只改 datasets/harness-comparison/env/ 与 docs/。dsh-plugins 本任务不改代码；若发现 lab 或 profile 文档与实测不符，只在回报里列出，不改。

## 交付
1. env/Dockerfile 能构建：node、pnpm、git 版本与宿主一致；四家 CLI 用 Linux 安装方式装到 pin 死的版本（写清各家用 npm 包、发行版包还是二进制，以及哪一家在 Linux 上没有 exec 驱动可用）；dsh 用 harness 源码 pin commit 预装。
2. versions.lock 填实：每个组件的版本、来源、校验和；本地包镜像的快照标识；构建出的镜像 digest。
3. 构建后断言：镜像内不存在参考实现与 verify 层（grep 题库路径与已知文件名），结果写进 env/README。
4. 本地包镜像：宿主起一个 registry 镜像（写明用什么），断外网时容器内 pnpm install 能成功；四家装到的是同一份。
5. 白名单代理：容器无外网，只放行四家模型端点（claude 的官方端点 + 本机代理出网这一条与 profile 的 pin 同值）；给出容器内的 env 键清单（只有键名进指纹，值不进）。
6. 凭证卷：每家一个可写卷的挂载布局（codex auth.json、claude 凭证文件须可写以便续期回写、kimi oauth/、dsh 走 env 注入）；实测续期回写落在卷上而不是容器层。
7. 四家在容器内各跑一次最小 exec（一句话任务）并记录版本自报、退出码、耗时。

## 约束
不进 dsh-plugins 改代码；不碰 3080；凭证只在本机卷里，不进镜像、不进 git、不进回报。镜像与代理的地址写成可替换的变量并在 README 说明，不写死本机路径。

## 完成判据
docker build 可复现（同 versions.lock 两次构建 digest 相同，或说明不相同的原因）；断外网下四家最小 exec 全部完成；env/README 有「谁在 Linux 上跑不了 exec」的明确答案。

## 回报
题库 commit；镜像 digest；versions.lock 全文；四家最小 exec 的版本自报与耗时表；镜像内无参考实现的断言输出；发现的 lab / profile 文档不符项。
```

### T18 · lab：复合指纹（已完成，2026-09-08 验收）

```text
# 任务 T18：lab 复合指纹——镜像 digest + 资源限制 + 挂载布局 + env 键

## 背景
报告的「环境一致」不变量读 refs.fingerprint。lab 现在的指纹是镜像的 repo digest（packages/lab/src/docker.ts 的 fingerprint()），而 architecture.md 定义的是复合指纹：镜像 digest、CPU 与内存上限、挂载布局、注入的 env 键名。同一镜像配不同资源限制或多挂一个卷，现在会被判为「环境一致」。pilot A 的报告因无指纹拒绝比较，I3 的第一份容器内报告要靠这条指纹放行比较，它必须诚实。

## 先读
packages/lab/README.md 与 src/docker.ts、types.ts（AcquireSpec）、cli-core.ts（--fingerprint 的传递）；profiles/web-eval/docs/architecture.md「运行环境」与「四条不变量」；packages/mission 的 AttemptRefs.fingerprint 语义（不透明字符串）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-lab-composite-fingerprint，分支 feat/lab-composite-fingerprint，只改 packages/lab/。

## 已定决定（照此实现）
- 指纹 = sha256(规范化 JSON)，分量：image（resolved digest）、resources（cpu、memory 的规范化字面）、mounts（每个挂载的容器内路径、只读/可写、类型；不含宿主路径）、envKeys（键名排序数组，不含值）。任一分量缺席记 null 而不是省略，保证同形状。
- 分量 JSON 与指纹一并落盘到 lab 自己的状态目录，并可由 lab status / 一条 fingerprint 子命令原样打印；mission refs.fingerprint 仍只存字符串。
- 旧格式（裸 digest）继续被接受为「无分量的指纹」，报告侧不做特殊处理。

## 交付
docker.ts 的 fingerprint(spec) 改为复合；acquire 把分量写进容器 label 与状态文件；status 表新增一列或子命令展示分量；测试覆盖「同镜像不同资源限制指纹不同」「挂载顺序不同指纹相同」「env 值不同键相同指纹相同」；README 双语更新；Agent Note（按仓库分类规则选 design 或 feature）。

## 约束
不改 mission；不 import 其他插件；分量里绝不出现宿主绝对路径与 env 值。

## 完成判据
包内测试绿，pnpm gate 绿；用两份只差 memory 的 AcquireSpec 跑 fingerprint 得到不同值并能打印出差在哪个分量。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；一份分量 JSON 示例（脱敏）。
```

### T19 · 数据：阶段一二的 objective 探针 + F2 阶段三的 verify 探针（已完成，2026-09-08 验收）

```text
# 任务 T19：F2 / F3 阶段一二的 objective 探针 + F2 阶段三的 verify 探针

## 背景
pilot A 的 methodology §5b：阶段一二唯一有判定源的是 llm-draft 一档，判据形态是「设计里存不存在 X」，完整设计整片通过，两家配对差值为 0 不是因为一样而是分不开。能拉开差距的是 objective 档——F2 的 A2-1（out_of_scope 非空且每条带理由）、A3-3（每条风险有 tradeoff）、B2-5（每条机制带 verdict）、A-N2（tradeoff 出现 worth-the-cost）、B5-1（core 全覆盖）、B5-3（每个迭代有工作量预估），F3 的同类项——它们全是对 stage1.json / stage2.json 的结构断言，但 verify/probes/ 下只有 .md 没有 .mjs，script 源整源缺席。

## 先读
docs/dataset-authoring-protocol.md §6.5（verdict）与 §6.7（探针契约：入口、参数、输出、超时）；题库 items/F2-*/grading/rubric.yml 与 items/F3-*/grading/rubric.yml 里 kind: objective 的每一条（evidence 字段指明查证位置）；题库 schemas/stage1.json、stage2.json；bundle exports/pilot-a-round1-bundle/ 里三格的 stage1.json / stage2.json（真实样本，用来自测探针）；packages/eval/src/judge.ts 里 script 源是怎么被编排器调用与入库的。

## 分支
题库仓库：从 i1-walk 开分支 i3-probes，只改 items/F2-*/verify/、items/F3-*/verify/ 与 docs/。dsh-plugins 不改；探针契约若有不够用的地方，回报里写，不自行改协议。

## 已定决定（照此实现）
- 每条 objective 判据一个 .mjs 探针，或一个探针输出多条 verdict——按 §6.7 的输出形状，一行一个 dataseek.verdict/1。
- pass 的语义是「判据成立」，与 rubric 的 criterion 文字一致；负分判据（negative: true，如 A-N2）成立即 pass: true，方向由 rubric 的 negative / 负 weight 决定，探针不自行取反（T24 让报告按此计分）。
- evidence 写可查证事实：字段路径与命中的值，不写评价。
- 探针只读 stage*.json，不读 .md（.md 归判官）；缺字段按判据语义判 fail 并在 evidence 里写明缺哪个。
- F2 阶段三的 verify 探针与 verify/helpers/ 按现有 verify/README 的设计写，能在宿主上对一份工作区目录运行；容器内执行归 T20/T22。

## 交付
F2、F3 每条 objective 判据都有探针覆盖；一个 run-all 入口逐条执行并汇总；用 bundle 里三格的真实 stage*.json 自测，把结果表写进 docs/probes-selftest.md（哪格哪条 pass/fail 及 evidence）；rubric.yml 的 evidence 字段若与探针实际查证位置不一致，改 rubric 使之一致并在提交说明里列出。

## 约束
不改判据文字与权重（那是 T24 与出题人的事）；不改 dsh-plugins；探针不依赖网络与外部包。

## 完成判据
run-all 在三格真实样本上跑完无异常；至少一条判据在三格之间产生了不同的 pass 值（否则说明探针没有区分度，回报里解释）；`dsh-datasets validate` 对题集仍通过。

## 回报
题库 commit；探针清单（判据 id → 文件）；自测结果表；探针契约的不足之处。
```

### T21 · profile：eval preset（已完成，2026-09-08 验收）

```text
# 任务 T21：eval preset——评测实例的 agent 不挂 Bash 与 docker

## 背景
冻结决策 12：销毁路径唯一——只有编排器持有 docker socket，评测实例的 agent preset 不挂 Bash 与 docker。I2 在宿主直跑，agent 用的还是 dev 域的默认预设。I3 编排器接 docker 之前，这个 preset 必须先存在并被 profile 装上，否则任何一次 agent 误操作都能绕过 lab 的 release 闸。

## 先读
profiles/web-eval/README.md「工具按域开放」「冻结决策」「安装」；profiles/web-dev/README.md 里 agent 预设一节（自建预设在 $DSH_HOME/.agent-presets/）；dsh 宿主关于 agent preset 的文档（哪些字段能挑工具、能否禁掉 Bash 与 code-runtime 的执行类工具）；profiles/web-eval/scripts/install.sh 与 update.sh 的 PROFILE_FILES / UPDATE_FILES 机制。

## 分支
从 main 开 worktree ../dsh-plugins-wt-web-eval-preset，分支 feat/web-eval-preset，只改 profiles/web-eval/。

## 已定决定（照此实现）
- preset 文件随 pack 分发（放 profiles/web-eval/presets/ 下，install.sh 与 update.sh 都覆盖它，与 cordis.patch.yml 同理由——它是装置不是偏好），安装后落到评测实例的预设目录并成为默认预设。
- preset 里去掉 Bash、docker 及任何能执行宿主命令的工具；保留读类工具与 datasets / mission / eval 的按域工具（已由 cordis.patch.yml 限定）。
- 若 dsh 的 preset 机制挑不掉某个执行类工具，不要用 patch 层 disable 整个插件来凑——在回报里写明是哪一个，列出可选办法（插件加 tools 分组配置，走 T12/T13 的同款）。

## 交付
preset 文件；install.sh / update.sh 的覆盖清单更新；README 双语加一小节说明这是冻结决策 12 的执行点、怎样确认实例正在用它；用 install.sh --source --fresh 在一个新 profile（不是 ~/.dsh-lab 正在用的 web-eval）上装一次并截取工具列表证明 Bash 与 docker 不在。Agent Note（process 或 feature）。

## 约束
不碰 ~/.dsh-lab 现有的 web-eval 实例与 3080；不改任何 packages/。

## 完成判据
新装实例的 agent 工具列表里没有 Bash 与 docker 类工具；datasets / mission / eval 的读工具仍在；gate 绿。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；新装实例的工具列表（脱敏）；挑不掉的工具清单（若有）。
```

### T23 · eval：finalize 再入口、就绪检查、效率表、run 子集（可发）

```text
# 任务 T23：eval——finalize 再入口、开跑前就绪检查、效率表只计完成格、run 子集

## 背景
pilot A 暴露的四条都在编排器上：G13 `--finalize` 只在 run 启动时可用，跑完的 run 想补做终评再释放没有动词，三格是人手逐格 dsh-mission transition 推的；G4 `/<harness> status` 的 authenticated 只查凭据记录的形状，claude 在它说 yes 的情况下每次委派都 401，24 格里 6 格注定全废而失败要到第一次委派才看得见；G15 报告的效率表按条件把所有当前格子的委派时长求和，未完成的格子也计入（F2 × dsh × rep3 只跑了阶段一，两家活跃时长同为 21.0 min 是巧合）；缩减 run 只能靠停掉会话轮次，run.meta 里没有任何记录说明为什么只跑了一部分。

## 先读
packages/eval/README.md 全文；src/run.ts（finalize 分支、run.meta 的写入、cell-skipped 注解）；src/slash.ts（/eval run 的开关）；src/cli-core.ts；src/report.ts（efficiencyOf、COMPLETED_STATES）；packages/local-agent 的门面 start 与 effectiveSettings；题库 docs/pilot-a-log.md 的 G4、G13；iterations.md 第三波验收里的 G15；pilot-a-round1 的 run.json（~/.dsh-lab/state/mission/runs/ 下，只读，拷副本再动）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-finalize-readiness，分支 feat/eval-finalize-readiness，只改 packages/eval/。

## 已定决定（照此实现）
- `/eval finalize <runId>`：对 run 内每个 archived 的格子走 archived → releasable → released 的同一条闸，非 archived 的格子跳过并逐格列出状态；闸拒绝按格记录，不 force。CLI 形态可选：进程外没有 mission 服务，若做就以子进程调用 dsh-mission 的 CLI，不得 import mission 包。
- 就绪检查：`/eval run` 在建 run 之前对 plan 里每个条件做一次最小委派（一句话任务，同一 cwd 规则），记 orchestrator ns 的 readiness 注解（条件、harness、耗时、回读模型、结果）；任一条件失败即整 run 不启动并打印原因；`--ignore-readiness` 才允许带着失败条件开跑，此时该条件的格子一律记 cell-skipped 并给出理由。就绪检查不信 status 的 authenticated。
- 效率表只统计 COMPLETED_STATES 的格子；未完成格子的数目与状态在效率表下方单列一行；results.jsonl 不变。
- `/eval run --only <missionId,...>` 与 `--max-cells N`：子集与上限进 run.meta（字段名自定，写进 README），报告开头「程序一致」一节打印它们；plan 契约不加字段。
- validate 交叉核 plan.expectedNs 与题的判定源：声明 `script` 但题的 verify/probes/ 无可执行探针、声明 `llm-draft` 但 rubric 无叶子——按 warning 报出（题库侧的检查归 T26，这里只看 plan 与题的对应）。

## 交付
上述五项 + 测试（finalize 对混合状态 run 的行为、就绪检查失败阻止启动、效率表排除未完成格、--only/--max-cells 落 run.meta、validate 的交叉 warning）；README 双语更新；Agent Note（feature）。

## 约束
不改 mission、local-agent、datasets；就绪检查的委派与正式格子走同一门面，不另开后门；不碰 3080 与 ~/.dsh-lab 的 web-eval 实例（要真跑就另开 profile 与端口）。

## 完成判据
eval 包测试全绿，gate 绿；对 pilot-a-round1 的 run.json 副本跑 finalize 能列出「3 released 跳过、2 中断跳过、7 pending 跳过」；对该 bundle 重跑 report，效率表的 dsh-exec 活跃时长不再含 F2 × dsh × rep3。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；重跑 report 的效率表片段；就绪检查一次失败与一次成功的注解示例（脱敏）。
```

**追加（2026-09-08，第一波验收后）**：G15 的定义见第二节第三波验收。本任务不碰 judge.ts——探针运行器归 T28，两任务同包不同文件。

### T24 · 负分判据进报告：极性取自 rubric，权重表进 bundle（可发）

```text
# 任务 T24：负分判据进报告——极性取自 rubric，权重表进 bundle

## 背景
G11：dataseek.verdict/1 只有 pass: boolean，语义「判据成立」；负分判据的 criterion 写的是缺陷（F2 A-N2「tradeoff 出现 worth-the-cost」、F3 A-N1「把协议知识推给用户」），成立 = 缺陷存在，报告主轴「通过判据数」却把它算成多通过一条。pilot A 只能把 human-final 的负分判据全部不写，丢掉了真实观测（F2 × codex × rep2 确有一条 worth-the-cost）。G12：rubric 在 grading 层，run 的自动导出只收 visible 层（泄题闸是对的），report 的 readWeights 拿不到权重，weightsAvailable 恒为 false，加权分这条唯一的救济在自包含 bundle 上默认不可用。

## 先读
docs/dataset-authoring-protocol.md §6.5、§6.6、§6.7；题库 items/F2-*/grading/rubric.yml 与 F3 的（叶子已带 weight 与 negative: true，axes 带 negative 小计）；packages/eval/src/report.ts（rubric weights 一节、weightsAvailable、配对表）；packages/eval/src/run.ts 里导出 bundle 的那一步（收哪些层）；packages/mission/src/export.ts（层与泄题闸）；bundle exports/pilot-a-round1-bundle/ 的 report/ 与 dataset/ 实物。

## 分支
dsh-plugins：从 main 开 worktree ../dsh-plugins-wt-eval-polarity，分支 feat/eval-polarity-weights，只改 packages/eval/ 与 docs/dataset-authoring-protocol.md（双语 + sidecar 重录）。题库：从 i1-walk 开分支 i3-rubric-weights，只在 rubric 缺 negative / weight 的叶子上补齐，不改判据文字。

## 已定决定（照此实现）
- verdict 契约不加字段：pass 永远是「判据成立」。极性是数据，来源唯一——rubric 叶子的 negative: true（weight 为负与之等价，两者不一致即 validate 报错，规则归 T26）。探针与判官都不取反（T19 同此）。
- 导出时从 grading 层派生一份权重表写进 bundle 的 report/（文件名自定，如 rubric-weights.json）：只含 task、criterion id、weight、negative、kind、axis，不含 criterion 文字与 evidence，因而不经泄题闸；可执行的探针与 rubric 全文仍不进 bundle。
- 报告主轴改为「得分判据数」：正向判据 pass 计 1；负向判据 pass 计 0、fail 计 1；加权分 = Σ weight × (pass ? 1 : 0)，负 weight 自然扣分。摘要里单列「负向判据命中」表（哪格哪条命中、evidence），那才是读者要看的缺陷清单。
- 权重表缺席时行为不变（只出计数），但报告明确打印「极性未知，计数按正向处理」并把负向判据数列为 unknown。
- 协议 §6.5 加一段：极性不在 verdict 里，在 rubric 里，理由如上；版本记 v1-rev4（文档级说明，schema 不变）。

## 交付
导出派生权重表；report 的极性计分、加权分、负向命中表；协议双语段落与 sidecar 重录；测试（正/负判据计分、权重表缺席的降级、派生文件不含 criterion 文字）；用 pilot-a-round1 的 bundle 副本重跑 report 作为示例。Agent Note（design）。

## 约束
不改 mission；不把 grading 层任何文字带进 bundle；不改 verdict schema。

## 完成判据
eval 测试全绿，gate 绿；对 pilot-a-round1 bundle 副本补入权重表后，报告出现加权分与负向命中表；F2 × codex × rep2 的 A-N2 若由人补一条 pass: true 的 human-final，即被计为扣分而不是加分。

## 回报
分支名与 commit（两个仓库）；Agent Note 路径；gate 输出；重跑报告的相关片段。
```

**追加（2026-09-08，T19 验收后）**：`dataseek.verdict/1` 增加一个**可选**的比例字段（形如 `ratio: { passed, total }`，字段名自定并写进 §6.5，schema 的 additionalProperties 相应放行），供「按比例给分」的判据（F2 / F3 的 C1、C2）使用；报告对带比例的判据按比例计分而不是布尔；探针不再把比例塞进 evidence 前缀（T19 现在的 `通过 N/M` 前缀是临时的，T19b 改成字段）。这是 T19 与 T24 之间原本的口头契约，改为进契约。

### T25 · local-agent：CLI 版本回读、codex 并发回读、status 活性档（已完成，2026-09-08 验收）

```text
# 任务 T25：local-agent——CLI 版本回读、codex 回读在并发 run 里失效、status 的活性档

## 背景
G1：LocalAgentEffectiveSettings 已有 cliVersion 字段（types.ts 注释写「no family probe ships yet」），至今为空，条件的 harness.version 只能取 CLI 自报，而它正是条件哈希里最大的混淆变量。G14：codex 在 smoke 委派里回读到 gpt-5.6-sol，在正式 run 里两轮 model.observed 与 usage 全为 null；codex 的 --json 流不含模型字段，provider 回落到 scoped home 的 rollout 文件按 threadId + 时间窗定位，run 里（--concurrency 2，两个 codex 进程同窗）没定位到。G4 的 local-agent 半边：status 的 authenticated 是形状检查，一份过期且刷不动的记录同样算 yes（已有的 authFailures 机制只在一次委派失败之后才生效）。

## 先读
packages/local-agent/src/types.ts（LocalAgentEffectiveSettings、cliVersion 注释、observedModel）、src/index.ts（statusOf、authFailures、credentialStamp）；packages/local-agent-codex/src/codex-cli-provider.ts（rollout 定位：spawn 时刻锚点、threadId、时间窗；onRoundSettled）；其余三家 provider 的回读路径；T11 与 T8b 的 Agent Note（回读与有界轮询）；题库 docs/pilot-a-log.md G1、G4、G14 与 §五 契约回填。

## 分支
从 main 开 worktree ../dsh-plugins-wt-local-agent-readback-v2，分支 feat/local-agent-readback-v2，只改 packages/local-agent 与四个 provider 包。

## 已定决定（照此实现）
- cliVersion：优先从 CLI 自己的流或记录里读（哪家的首事件带版本就用它），读不到的家在首次 status / 首次委派时 spawn 一次 `<cli> --version` 并按可执行文件的路径 + mtime 缓存；写进 effectiveSettings.cliVersion 与委派记录，四家都要有值或有「该家无法读到」的明确记录。
- codex 回读：先复现（两个 codex exec 同窗并发，cwd 不同），找到定位失败的确切原因（时间窗、threadId 匹配、cwd 未参与筛选、并发下文件名冲突之类），修复后在并发下回读稳定；写清 rollout 里哪个字段是权威来源。
- status 增加 credentialState：absent / present-unverified / verified / rejected；authenticated 布尔保留并等于 verified 或 present-unverified，以兼容现有设置卡与 T15 的驱动；verified 由一次成功委派或显式探测设置，rejected 由 authFailures 设置；status 文本行打印这一档。真正的开跑前活性探测归 T23（一次最小委派），本任务只把「记录在、活性未知」说实话。

## 交付
上述三项 + 测试（cliVersion 缓存与回退、codex 并发回读、credentialState 的四态迁移）；四家 README 的 effectiveSettings 字段表更新；Agent Note（bug-fix 一份给 codex 回读，feature 一份给 cliVersion 与 credentialState，或合一份写清两段）。

## 约束
不改 eval；不引入新的常驻进程；`--version` 探测有超时并在失败时降级为 undefined 而不是抛错；不碰 3080。

## 完成判据
四个 provider 包与 local-agent 测试全绿，gate 绿；本机四家 /<harness> status 的 effectiveSettings 都带 cliVersion 与 credentialState；两条并发 codex 委派的委派记录 observedModel 均非空。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；四家 status 输出（脱敏）；codex 并发回读失败的根因一句话。
```

### T26 · datasets：validate 增加可判性检查（已完成，2026-09-08 验收）

```text
# 任务 T26：datasets validate 增加可判性检查

## 背景
G6：F3 的 rubric.yml 原本只有 axes 没有叶子，rubric.md 逐条引用的 A1-1 / A2-1 / A-N1 从未落成结构化行；`dsh-datasets validate` 照样通过，结果判官在 F3 每一格记 judge-skipped，verdicts/ 为空，格子过不了归档闸。一道题能不能被判，应当是开跑前的机械检查，而它属于题库侧的事实，与 plan 无关。

## 先读
packages/datasets/README.md 与 src/dataset.ts（现有 validate 规则、rubric 在哪里被读）、src/invariant.ts、src/cli.ts；docs/dataset-authoring-protocol.md 里 rubric（dataseek.rubric/2）与 verify 层的约定，§6.7 探针契约；题库 items/F2-*、F3-*、P0-* 的 grading/rubric.yml 与 verify/probes/ 实物；T12 的 Agent Note（金丝雀字段是同类检查的先例）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-datasets-judgeable，分支 feat/datasets-judgeable-validate，只改 packages/datasets/。

## 已定决定（照此实现）
- 对每个 item：rubric 必须有至少一条叶子（items 非空），否则 error；每条叶子必须有 id、axis、weight、kind、criterion、evidence，kind 只能取 objective / llm-draft / human，否则 error；negative: true 与 weight 符号不一致 error。
- 判定源可达性：存在 kind: objective 的叶子但 verify/probes/ 下没有可执行探针（.mjs / .sh）→ warning「objective 判据无探针源」；存在 kind: llm-draft 的叶子即视为有源（判官由 plan 提供）；kind: human 不查。这是题库侧能知道的全部；plan.expectedNs 与题的对应归 eval validate（T23）。
- rubric.md 引用了叶子 id 而 rubric.yml 没有该叶子 → warning（正则抓 [A-Z]\d?-N?\d+ 形状的 id，允许误报，只报 warning）。
- 输出格式与现有 validate 一致；新增规则在 README 的规则表里逐条列出。

## 交付
validate 的三组规则 + 测试（缺叶子、字段缺失、极性不一致、无探针源、md 引用悬空）；README 双语规则表；Agent Note（feature）。

## 约束
不改协议文本（若发现 rubric/2 的约定写得不够，回报里提）；不改 eval / mission；对现有题库跑一遍并把每条 warning 的处理建议写进回报，不直接改题库。

## 完成判据
datasets 测试全绿，gate 绿；对题库当前 commit 跑 validate：P0、F2、F3 的结果与 pilot A 的事实一致（F3 补叶子前的 commit 6c3877b^ 应报 error，补后不报；F2 / F3 的 objective 判据在 T19 落地前应报「无探针源」warning）。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；对题库两个 commit 的 validate 输出。
```

第二波（2026-09-08 发出）：T17、T18b、T27、T28 互不依赖可即发；T18b 已于同日验收。T19b 在 T24 合入后可发（2026-09-08），文案见下。

### T17 · local-agent：容器内 exec 包装（已完成，2026-09-08 验收）

```text
# 任务 T17：local-agent——委派可以在容器内执行（exec 传输层）

## 背景
T16 已证明四家 CLI 在题集级镜像里能跑最小 exec（dsh 需 NODE_OPTIONS=--use-env-proxy）。四家 provider 现在都通过 ctx.subprocess.spawn 在宿主上起 CLI，cwd 与 scoped home 都是宿主路径。I3 要让同一次委派在 lab 取得的容器里执行，而流的解析、回读、记录一行都不该变。README 给 I3 列了两条路（容器内 exec 包装 / CLI 驱动抽成独立包），本任务定第一条；第二条推迟到有第二个消费者时再谈，理由写进 Agent Note。

## 先读
packages/local-agent/src/types.ts 与 index.ts（门面 start/resume 的选项、DelegationCallOptions.cwd、resolveChildCwd）；四家 provider 的 spawn 处（codex 的 startCodexCliRun(spec) 最清楚：argv、cwd、env、stdio）；packages/lab/src/types.ts 与 docker.ts（acquire 的容器名与 MountSpec）；题库 env/README、env/run-unit.sh、env/creds/stage.sh（T16 实测的容器内启动方式、env 键清单、凭证卷布局）；T11 / T8b 的 Agent Note（回读与记录）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-local-agent-container-exec，分支 feat/local-agent-container-exec，只改 packages/local-agent 与四个 provider 包。lab 的 network / volume / user 字段由 T18b 提供，本任务只依赖「容器已存在且有名字」。

## 已定决定（照此实现）
- 门面 start/resume 增加可选 exec 目标：{ container, workdir, env? }。给了它，provider 把 argv 换成 docker exec -w <workdir> [-e K=V…] <container> <原 argv>，stdio 仍是 pipe，流解析、settle、回读、记录代码不变；没给则宿主直跑，行为与今天逐字节相同。
- scoped home 是宿主目录，以 rw bind 挂进容器（挂载由调用方在 acquire 时声明，provider 只需知道容器内路径，经 env 目标传 HOME / CODEX_HOME 之类）。不用 named volume：回读要读 scoped home 里的 rollout / session 文件，宿主目录直接可读，named volume 要 docker cp。T16 的凭证卷改为 bind 目录，续期回写实测仍落在宿主目录。
- dsh provider 在容器目标下自动补 NODE_OPTIONS=--use-env-proxy（T16 的发现），并记进 effectiveSettings 让条件文件看得见。
- docker exec 只走 ctx.subprocess，argv 里不出现 shell；容器名来自调用方，provider 不碰 docker exec 以外的任何 docker 动词。
- 「CLI 驱动抽成独立包」推迟：Agent Note 写明现在只有一个消费者（eval 编排器），抽包的收益还不存在。

## 交付
门面与四家 provider 的 exec 目标；测试（argv 形状：容器目标与宿主目标各一；env 注入；dsh 的 NODE_OPTIONS；resume 在容器目标下的 argv）；四家 README 的委派选项表；Agent Note（design）。真机验证：用 T16 的镜像起一个容器（题库 env/run-unit.sh 的方式即可），四家各委派一次「回答 2+2」并回读模型。

## 约束
不改 eval、lab；不在 provider 里 import lab；不碰 3080；凭据只在本机目录里，不进日志与回报。

## 完成判据
四个 provider 包与 local-agent 测试全绿，gate 绿；四家在容器目标下各一次真实委派 settle 且记录里 observedModel 非空（kimi 若仍卡配额，记实际错误）。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；四家容器内委派的记录摘要（脱敏）。
```

### T18b · lab：network、volume 挂载、user（可发）

```text
# 任务 T18b：lab——network、volume 挂载、user

## 背景
T16 实测出 lab 表达不了容器化评测需要的三件事：AcquireSpec 没有 network 字段，docker.ts 从不传 --network，单元落在有 NAT 的默认 bridge，「容器无外网」只能靠题库自己的脚本挂 eval-net；mounts 只拼 type=bind；没有 user，而 claude 的 skip 档要求非 root。T18 已补 resources。

## 先读
packages/lab/src/types.ts、docker.ts、fingerprint.ts、service.ts（T18 后的形状）与 T18 的 Agent Note；题库 env/README「网络拓扑」「凭证卷」「为什么以非 root 跑题」与 env/run-unit.sh；题库 docs/i3-env-log.md。

## 分支
从 main 开 worktree ../dsh-plugins-wt-lab-network-user，分支 feat/lab-network-user，只改 packages/lab/。

## 已定决定（照此实现）
- AcquireSpec 加 network?: string（docker 网络名或 'none'），缺省仍是 docker 默认；进复合指纹分量（网络名不含宿主信息，可入）。
- MountSpec 加 type?: 'bind' | 'volume'，volume 时 source 是卷名；指纹分量已只记 target / type / readonly，不变。
- AcquireSpec 加 user?: string（uid[:gid] 或用户名）；进指纹分量。
- 三项都真传给 docker run；status 与 fingerprint 子命令能打印它们；旧 spec（三项缺席）的指纹值不变。

## 交付
三个字段 + argv 拼接 + 指纹分量 + 测试（每项各一，含指纹随 network / user 变化、缺席时指纹不变）；README 双语；Agent Note（feature）。

## 约束
不改 mission / eval；分量里仍不出现宿主路径与 env 值。

## 完成判据
lab 测试全绿，gate 绿；用 T16 的镜像 acquire 一个 network=eval-net、user 非 root、挂一个 volume 的单元，容器内 id 与 ip route 与声明一致。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；一份带三个新分量的指纹 JSON。
```

### T19b · 题库：F3 的 objective 负分判据、计数对齐、比例字段（已完成，2026-09-08 验收）

```text
# 任务 T19b：题库——F3 的 objective 负分判据、计数对齐、比例字段

## 背景
T19 自测：A-N2「tradeoff 出现 worth-the-cost」的底层取值在三格上是 1/8、1/5、0/6，是阶段一二里唯一已经能自动判且有区分度的信号，但 F3 的 rubric 没有同形判据接住。另两处漂移：F2 verify/README 说 core 8 / bonus 7、rubric C1 说 9 条，standards.yml 实际 core 10 / bonus 8；F3 的 C1 把 G1 算进 core，两题口径不一致。T24 已合入 main（979e624）：dataseek.verdict/1 带可选 ratio: {passed, total}，§6.5 / §6.7 明写比例不得进 evidence 前缀，报告从此不解析那个前缀——T19b 落地前 C1 / C2 按严格布尔计分。verify-rollup 现在还把比例塞在 evidence 前缀里。

## 先读
题库 docs/probes-selftest.md §四、§五；items/F2-* 与 F3-* 的 grading/rubric.yml、rubric.md、verify/README.md、standards.yml；main 上 docs/dataset-authoring-protocol.md §6.5（v1-rev4）的 ratio 三条规矩与极性段落；T19 的探针（verify/helpers/lib 与两题 verify/probes）。

## 分支
题库仓库：从 i1-walk 开 worktree（不在共享检出上 checkout），分支 i3-probes-b，只改 items/F2-*、items/F3-* 与 verify/helpers/。

## 已定决定（照此实现）
- F3 加一条 objective 负分判据，与 F2 A-N2 同形（id 按 F3 的 axis 命名，negative: true，负 weight 在 F3 负分上限内），evidence 指向 stage1.json:host_change_risks[].tradeoff，探针复用 worthTheCostChosen；rubric.md 同步加一行判读。
- 两题的 core / bonus 计数以 standards.yml 为准，verify/README 与 rubric 的 C1 措辞改到一致；G1 是否计入 core 两题取同一口径，写明理由。
- verify-rollup 输出比例字段，evidence 不再承担比例；docs/probes-selftest.md 重跑更新。
- ratio 的写法照 §6.5：pass 仍是「完整成立」（pass === (passed === total)）；total 是扣除 skipped_standards 后实际判定的条数；evidence 只写哪几条过、哪几条没过、从哪儿查。
- 新判据 negative: true 与负 weight 同时写（T26 的 validate 会查两者一致）；权重表由 eval 导出时从 rubric 派生，题库不用另写任何表。
- 不新增其他判据，不改权重分配以外的数值。

## 交付
rubric.yml / rubric.md / verify README 的改动；探针更新；自测表重跑；dsh-datasets validate 仍 0 error。

## 完成判据
run-all 在 pilot-a-round1 bundle 上：F3 新判据在三格上至少一格与其他格不同；C1 / C2 的比例出现在结构字段而不是 evidence。

## 回报
题库 commit；新判据 id 与三格取值；C1 / C2 带 ratio 的 verdict 样例各一条；validate 输出。
```

### T27 · local-agent-tool-subagent：tools 注册开关，pack 关掉四家委派工具（已完成，2026-09-08 验收）

```text
# 任务 T27：local-agent-tool-subagent——tools 注册开关，pack 关掉四家委派工具

## 背景
T21 的 eval 预设挑不掉 subagent_codex / subagent_claude_code / subagent_kimi / subagent_dsh：它们由 provider 的 bundle patch 装在 profile 根，每个都在宿主上起一家 CLI，沙箱按决策 3 放开——评测实例的 agent 因此仍有一条执行宿主命令的路。编排器驱动选手走 local-agent 门面（packages/eval/src/run.ts 只用 LocalAgentFace），/codex login 等动词在 provider 上，都不经这四个工具，关掉它们不影响评测流。

## 先读
packages/local-agent-tool-subagent/src/index.ts（config schema、mount / unmount、ctx.tools.register）；T12（datasets）与 T13（mission）的 tools 分组 Agent Note；profiles/web-eval/cordis.patch.yml 与 README「工具按域开放」；T21 的 Agent Note 里的三条路径。

## 分支
从 main 开 worktree ../dsh-plugins-wt-tool-subagent-switch，分支 feat/tool-subagent-tools-switch，只改 packages/local-agent-tool-subagent/ 与 profiles/web-eval/。

## 已定决定（照此实现）
- 配置项 tools: 'all' | 'none'，默认 all（dev 域行为不变）；none 时不注册模型可见工具，其余（provider 探测、状态）照旧。每行只注册一个工具，所以是两值不是分组清单。
- pack 的 cordis.patch.yml 给四家委派工具行各加 tools: none（行 id 以 --dump-config 为准；注释写明这是冻结决策 12 的第三个执行点）；README「工具按域开放」表加一行；T21 那节的「够不到的执行类工具」改为已关。
- 进程内的 subagent / subagent_fork 保留。

## 交付
开关 + 测试（all / none 各一，none 下 provider 出现时不注册）；patch 行；README 双语；Agent Note（feature）。用一次性 $DSH_HOME 装一次，工具列表应从 39 减到 36（subagent_dsh 默认关本就不在）。

## 约束
不改 provider 包；不改 eval；不碰 ~/.dsh-lab 与 3080。

## 完成判据
包测试全绿，gate 绿；新装实例工具列表里没有 subagent_<harness>；/eval run --dry-run 与 /codex status 仍正常。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；新装实例的工具列表（脱敏）。
```

### T28 · eval 探针运行器：题集级 verify 层、退出码三态、回填顺序（已完成，2026-09-08 验收）

```text
# 任务 T28：eval 探针运行器——题集级 verify 层、退出码三态、回填顺序

## 背景
T19 写探针时撞上运行器三条。一、runProbes 只读 item.layers['verify']，题集级 verify/helpers/ 拿到也不物化，题内探针 import 不到共享库，只能在每题 verify/lib/ 放逐字副本并用 --check-shared 钉住（三份 276 行的副本已经在题库里）；题集级 verify/helpers/probes/no-patch.sh 在真实 run 里一次也不会跑。二、退出码只有 0 / 非 0，「这一轮判不了」（阶段三未跑、工作树不在）没有位置，编排器会把它记成探针失败，只跑阶段一二的 pilot 每格多两条假失败。三、§6.7 说 task / by 由编排器回填、探针写了也会被覆盖，但 readVerdictFile 先校验后回填，而两者都是 required + additionalProperties: false，探针不写就整份作废。

## 先读
packages/eval/src/judge.ts（probePaths、runProbes、readVerdictFile、verify 层的物化）；docs/dataset-authoring-protocol.md §6.7；题库 docs/probes-selftest.md §五；题库 verify/helpers/README.md、run-all.mjs 与 items/*/verify/lib/ 的副本；T9 的 Agent Note。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-probe-runner，分支 feat/eval-probe-runner，只改 packages/eval/ 与 docs/dataset-authoring-protocol.md（双语 + sidecar）。与 T23 同包不同文件（T23 在 run.ts / report.ts / slash.ts / cli-core.ts，本任务在 judge.ts），冲突由协调者解。

## 已定决定（照此实现）
- 题集级 verify 层随题的 verify 层一起物化到格子的临时判定目录，相对布局与题库一致（<tmp>/verify/helpers/… 与 <tmp>/items/<id>/verify/…），题内探针以相对路径 import 共享库；题集级 verify/helpers/probes/ 下的可执行文件也进 probePaths，对每题各跑一次。执行后整个临时目录移除（架构「判定环境」行）。
- 退出码：0 有判定；1 探针失败（记 probe-failed）；3 本轮不适用（记 probe-skipped，带 stderr 首行，不计失败）。写进 §6.7。
- readVerdictFile 先回填 task / by（缺则补，有则以编排器为准并记 overwritten），再校验；§6.7 措辞与实现对齐。
- 三条写成 §6.7 的修订；版本号与 T24 的 v1-rev4 谁先合入谁记 rev4，后者记 rev5。

## 交付
运行器改动 + 测试（题集级层物化与 import、共享探针对每题各跑一次、三态退出码、回填顺序）；协议双语与 sidecar；README；Agent Note（bug-fix 或 feature，按仓库分类规则）。用 pilot-a-round1 bundle 的格子目录跑一次真实探针作示例。

## 约束
不改 lab、datasets、mission；不改 verdict schema（比例字段归 T24）。

## 完成判据
eval 测试全绿，gate 绿；对 bundle 三格跑运行器：no-patch.sh 每题各跑一次并记 probe-skipped 而非失败，题内探针 import 题集级 lib 成功（题库侧删副本归 T19b 之后）。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；三格的探针 outcome 摘要。

## 追加（2026-09-08，T24 合入后）
- T24 已合入 main（979e624），schema.ts 的 VERDICT_SCHEMA 已带可选 ratio，report.ts 已按它计分；先把 main 并进分支再继续。「不改 verdict schema」的约束照旧。
- readVerdictFile 校验带 ratio 的 verdict 时加两条数值检查：passed / total 为整数且 total > 0、0 ≤ passed ≤ total；pass === (passed === total)。不符按「产物不合契约」计，与 schema 不过同一档，原因进 orchestrator ns。report.ts 里 T24 的 ratioOf 只做前一条并退回布尔——运行器在源头拦，报告兜底，两边都要在。
```

### T19c · 题库：探针接上 T28 的运行器——退出码 3、删 lib 副本、悬空引用、P0 最小探针（已完成，2026-09-08 验收）

```text
# 任务 T19c：题库——探针接上 T28 的运行器：退出码 3、删 lib 副本、悬空引用、P0 最小探针

## 背景
T28 已合入 main（a6395e1）：运行器把题集级 verify/helpers/ 与题内 verify/ 一起物化到 <tmp>/verify/… 与 <tmp>/items/<题 id>/verify/…，题内探针可以用 ../../../../verify/helpers/lib/<x>.mjs import 共享库（题库里同一条路径同样成立）；题集级 verify/helpers/probes/ 下的探针对每题各跑一次，cwd 是该题 verify 层的根；退出码三态——0 有判定、3 本轮判不了（记 probe-skipped，带 stderr 首行，不计失败）、其余 probe-failed。题库（i1-walk 22bc6bb）还停在 T19 的约定：verify/helpers/lib/probe-kit.mjs 的 EXIT_NOT_JUDGEABLE = 2，verify/helpers/probes/no-patch.sh 两处 exit 2，两题各留一份 verify/lib/ 副本并靠 run-all.mjs --check-shared 钉住。T28 用真实运行器跑 pilot-a-round1 三格：共享探针每格各跑一次这一半成立了，但 outcome 全是 probe-failed 而不是 probe-skipped；T28 在游离 worktree 里预演过下面三步，判定条数与改前逐条相同（14 个文件，+15 −1355）。T26 的 validate（已合入）在 i3-probes-b 上报 3 条 RUBRIC_REF_DANGLING（F3 rubric.md 引用 B2-2 / B2-3 / B3-2，rubric.yml 没有这些 id——补叶子前的旧编号，落成结构化行时改了名）与 1 条 OBJECTIVE_NO_PROBE（P0 七条 objective 判据全指向「verify/ 判定结果」，checks/probes/ 只有 README）。

## 先读
main 上 docs/dataset-authoring-protocol.md §6.7（v1-rev5：退出码三态、回填顺序）；T28 的 Agent Note（.agents/notes/implemented/bug-fix/2026-09-08-eval-probe-runner-contract-gaps.zh.md）；T26 的 Agent Note（validate 的规则清单）；题库 verify/helpers/README.md、run-all.mjs、lib/probe-kit.mjs；items/F2-*、items/F3-* 的 verify/probes/*.mjs 与 verify/lib/；items/F3-*/grading/rubric.md 与 rubric.yml；items/P0-placeholder 的 grading/rubric.yml、checks/ 与 verify/；docs/probes-selftest.md。

## 分支
题库仓库：从 i1-walk（22bc6bb）开 worktree（不在共享检出上 checkout），分支 i3-probes-c，只改 verify/helpers/、items/*/verify/、items/F3-*/grading/rubric.md、items/P0-placeholder/ 与 docs/probes-selftest.md。

## 已定决定（照此实现）
- EXIT_NOT_JUDGEABLE 改 3，no-patch.sh 两处 exit 2 改 exit 3。用法错误（缺 --cell / --out）仍退 1，那是 probe-failed，不要混进 3。
- 删掉 items/*/verify/lib/；题内探针的 import 从 ../lib/<x>.mjs 改成 ../../../../verify/helpers/lib/<x>.mjs；run-all.mjs 的 --check-shared 与母本一致性检查随副本一起删，README 同步。
- probe-kit.mjs 的 taskIdFrom / probeDisplayPath 可以不再回声 task / by（编排器先回填再校验）；保留也无害，以编排器为准。
- F3 rubric.md 里 B2-2 / B2-3 / B3-2 的引用改成现行 id（以 rubric.yml 为准，对应 B1-1 一带与 B5-1）：只改散文的指认，不动判读文字、权重、叶子——不触碰「开跑前冻结」。
- P0 补一个最小 .mjs 探针：读 verify/ 的判定结果，对 A1–A3 / B1 / C1 / N1 / N2 各出一条 verdict，结果文件不在就退 3。P0 是链路占位题，探针的意义是让 script 源那一档在容器链路上验得到。
- 不改 rubric.yml、standards.yml、dimensions.md；schema_version 不动（协议侧未定）。

## 交付
上述改动；run-all 在 pilot-a-round1 bundle 上的重跑（判定条数与 T19b 逐格相同）；docs/probes-selftest.md 更新；dsh-datasets validate 输出。

## 约束
共享检出 HEAD 不动；不碰 3080；不改 dsh-plugins。

## 完成判据
用 main（T28 之后）的 eval 运行器对 pilot-a-round1 三格跑探针：no-patch.sh 与 verify-rollup 记 probe-skipped 而非 probe-failed，题内探针经题集级 lib 判定成功，判定条数与 T19b 逐格相同；validate 0 error，RUBRIC_REF_DANGLING 与 OBJECTIVE_NO_PROBE 归零（UNREGISTERED_FILES 41 条照旧）。

## 回报
题库 commit；三格探针 outcome 表；validate 输出；被改的 import 与退出码清单。
```

### T20 · eval：容器路径——一格一单元，acquire / populate / checkpoint / verify / archive 交 lab，销毁路径唯一（已完成，2026-09-08 验收）

```text
# 任务 T20：dsh-eval 容器路径——一格一单元，五个动词交 lab，销毁路径唯一

## 背景
run.ts 至今是「阶段一二、宿主目录」：格子目录在 $DSH_HOME/state/eval 下，题面逐文件 read/write 物化并自算 materialization.json，委派只给 {cwd}，探针在宿主 execFile，归档是 cpSync。I3 的三块前置都已在 main：T17（8efac1c）门面有了 exec: {container, workdir, env?}，四家 argv 换成 docker exec，env 必须点名容器内作用域目录变量（CODEX_HOME / CLAUDE_CONFIG_DIR / KIMI_CODE_HOME / DSH_HOME），值不上 argv；T18b（68e23d2）lab 的 AcquireSpec 有 network / user / resources / mounts(type bind|volume) / env，全部真加到容器上并进复合指纹 lab-env:<sha256>，未声明分量不入哈希；T28（a6395e1）探针运行器把两个 verify 层物化进临时目录、退出码三态。lab 的服务面 ctx.lab 八个动词齐全：acquire → UnitInfo（resource 是容器名，fingerprint 是复合指纹）；populate 先哈希后拷贝并可写 manifest；checkpoint 在容器内 git commit + tag；verify 把材料拷进 /run/dsh-lab/verify 跑完即删，结果原样注解进 ns lab；archive 导出 workspace + manifest；release 是闸的执行点，绑定 mission 时 isReleasable 不过就拒绝，任何选项绕不过，无闸单元才需要 force。架构轨迹表第 11–17 步早就写成这个顺序，四不变量之二「环境一致」在 pilot A 上一直是 unverifiable——refs.fingerprint 没人写。

## 先读
packages/eval/src/run.ts（runCellOnce 477–805：物化、委派选项、两阶段推进、judgeCell、archive、finalize）、judge.ts（runProbes 与临时目录）、faces.ts（现有三个面）、readiness.ts（T23 的就绪委派）；packages/lab/README.md 与 src/types.ts（Lab 接口、AcquireSpec、MountSpec、PopulateOptions、VerifyResult）、service.ts 的 release 闸；packages/local-agent/src/types.ts 的 DelegationExecTarget 与 container.ts 的 containerScopedHome；profiles/web-eval/docs/architecture.md 的轨迹表、运行环境表、判定环境行、四不变量；题库 env/README.md 与 env/run-unit.sh（每家的容器内作用域路径与变量、NODE_OPTIONS、eval-net、非 root 1000）；T17 / T18b / T23 / T28 的 Agent Note。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-container，分支 feat/eval-container-path，主要改 packages/eval/；lab 只准加不准改（新增可选项要带测试、README 双语与 sidecar，既有动词语义不动）；不改 local-agent、mission、datasets。

## 已定决定（照此实现）
- 开关在计划：dataseek.plan/1 加可选 unit 段 {image, network?, user?, resources?}。有它走容器路径；没有走宿主路径，与今天逐字节相同（pilot-a-round1 bundle 复算作回归）。image 取题库 env 层的 tag 或 digest，validate 不查镜像存在（docker 不一定在场），run 开跑前 acquire 第一个单元就是检查。
- 凭证与作用域目录：每条件一个宿主目录，rw bind 到该条件声明的容器内路径（T17 决定：bind 不用 named volume，回读要直接读 rollout / session）。dataseek.condition/1 加可选 unit 字段 {scopedHome: {container: '/creds/codex', var: 'CODEX_HOME'}}，var 同时出现在 env.keys；宿主侧根目录由 run 选项 --creds-root DIR 给，约定 <DIR>/<condition id>，条件文件里不出现宿主路径。目录由人（T22）备好，编排器只检查存在、非空、属主是单元的 uid，不检查内容。契约改动记 v1-rev6，双语 + sidecar + 夹具。
- 一格一单元，顺序固定：acquire（mounts 只有该条件的作用域目录一条；env 只有 var=容器内路径，dsh 再加 NODE_OPTIONS=--use-env-proxy；missionId / runId 都带上）→ populate（宿主物化目录 → /workspace，manifestPath 指向 materialization.json，sha 与今天算法相同）→ 每阶段一轮委派，exec = {container: unit.resource, workdir: '/workspace', env: {var: 容器内路径}}，cwd 选项不再传 → 每阶段结束 checkpoint(name: 阶段 id)，ref 进 mission → 探针经 lab.verify 在容器内跑（见下）→ archive(target: 归档目录/workspace) → transition archived。
- 探针在容器内：judge.ts 的运行器抽成一个执行器接口，宿主执行器即今天的 execFile，容器执行器把物化好的 probeDir 作 lab.verify 的 source、command 是探针相对路径 + 参数，退出码三态与回填顺序逐字不变；探针 --out 写到 /run/dsh-lab/verdicts/<探针 id>/，跑完 lab.collect 回宿主再判、再删；不进 /workspace（归档不含判定产物）。lab.verify 的清理范围若碰到那个目录，给 verify 加一个可选 keep 列表而不是改探针契约。
- refs.fingerprint = unit.fingerprint，每格 acquire 后立刻 setRefs；报告的「环境一致」从此可验，同 run 内不同指纹按既有规则 violated。
- 销毁路径唯一：run.ts 只有一个 destroyUnit 函数，两个调用点——finalize 的 releasable 过闸后调 lab.release（不带 force），以及异常路径「先 archive 再 release」（架构 L139–149，同样过闸）。就绪检查（T23）在容器路径下也在单元里做：每条件 acquire 一个不绑 mission 的探活单元跑就绪委派，用完经同一个 destroyUnit 释放——这是 force 在 run.ts 里出现的唯一位置，因为 lab 对无闸单元要求显式 force，Agent Note 写明。run.ts 与 judge.ts 里不出现 docker 字样。
- 并行度：容器路径默认串行（一格 acquire → archive 完再 acquire 下一格），acquire 超 maxConcurrentUnits 的拒绝当作缺陷而不是排队；并行留 I4。
- 条件文件的 permissions 不动：codex 容器内 danger-full-access 是 pin（profile）与条件的事，归 T22。
- --dry-run 打印每格的 AcquireSpec（不含 env 值）；validate 对带 unit 的计划核每条件都有 scopedHome、var 在 env.keys 里。

## 交付
LabFace（faces.ts）与容器路径；执行器接口；契约 rev6 双语 + sidecar + 夹具；README 双语（容器路径一节：顺序、目录约定、销毁路径、force 的唯一位置）；测试（假 LabFace 断言八个动词的调用顺序与参数、宿主路径逐字节回归、探针容器执行器的三态、readiness 单元释放、fingerprint 进 refs）；Agent Note（feature）。真机：~/.dsh-lab 的 web-eval 实例（3171）上 P0 × codex 一格在容器内跑完全流程到 released——acquire 取 T16 的镜像（sha256:ed988b33…）、eval-net、user 1000、探针在容器内判、archive、finalize 过闸、release；镜像里没有 dsh 家族 bundle（T17 发现，归 T22），所以选 codex 不选 dsh。

## 约束
不碰 ~/.dsh-official 与 3080；凭证目录按题库 env/creds/stage.sh 的方式备一家（codex），属主 1000，不进日志、回报、提交，验证完删除；docker socket 只在编排器进程；不改 verdict / probe 契约；不改 lab 既有动词语义；pilot-a-round1 bundle 的宿主路径复算逐字节相同。

## 完成判据
eval 测试全绿，gate 绿（ankh-guard 的 inventory mismatch 若在干净 main 上复现，其余步骤单独跑绿即可）；真机一格：lab status 里该单元 TASK 哈希与 mission 一致、refs.fingerprint 非空、探针 outcome 表（no-patch.sh 记 probe-skipped——需 T19c 已并入 i1-walk，否则记 probe-failed 并注明）、archive 目录含 workspace + manifest + verdicts、release 被闸拒绝过至少一次（verdicts 空时）且容器仍在、最终 released 且容器已删；report 对该 run 的「环境一致」为 ok。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；真机一格的时间线（acquire → … → released，含单元名与指纹前 12 位）；探针 outcome 表；report 的不变量四行。
```

### T22 · 运维：环境侧收尾 + 容器内 F2 阶段三一格 + 四家同一题（已完成，2026-09-09 验收；阶段三归 T19d）

```text
# 任务 T22：运维——环境侧收尾、容器内 F2 阶段三一格、四家同一题

## 背景
T20 已让一格在容器内走完全流程（P0 × codex）。I3 的完成判据还差一半：「四家在容器内跑通同一题」，且 F2 阶段三（verify 探针的主场）还没在容器里跑过。T17 交回环境侧四条、T18b 一条，都还没人做：一、镜像自带的 in-box headless 不认 --session-id，dsh 容器轮要镜像备好 dsh 家族 headless bundle 及其运行期依赖闭包（T17 手工备进单元后同一轮跑通）；二、整份作用域目录 bind 进单元会把宿主专用设置带进去（claude settings.json 里给宿主守护进程的 https_proxy 在容器里 Connection refused），容器用的作用域目录要单独备；三、白名单缺 console.anthropic.com（claude 续期链末端 403，授权恢复后会咬人）；四、kimi 账号配额未变（403 monthly usage limit）；五、新建 docker 卷与目录要 1000:1000，否则单元写不进。另有 profile 一条：宿主直跑阶段 codex 取 workspace-write，README 决策 3 与 L333 写明容器化后改回 danger-full-access，四家才落在同一档。

## 先读
本文 I3 表与三波验收记录；T16 / T17 / T18b / T20 的 Agent Note；题库 env/README.md、env/run-unit.sh、env/creds/stage.sh、docs/i3-env-log.md、docs/pilot-a-log.md；profiles/web-eval/README.md 冻结决策 3 / 5 / 12 与「当前 pin」段；packages/eval/README.md 的容器路径一节（T20）。

## 分支
dsh-plugins：从 main 开 worktree ../dsh-plugins-wt-web-eval-container-pins，分支 feat/web-eval-container-pins，只改 profiles/web-eval/（cordis.patch.yml 的 codex sandbox 改 danger-full-access，README 双语「当前 pin」段与 L333 那句、sidecar）。题库：从 i1-walk 开 worktree，分支 i3-env-b，只改 env/（镜像构建、versions.lock、refs.fingerprint、白名单、creds 目录约定）与 docs/（新建 docs/pilot-b-log.md）。运行记录进题库 docs，不进 dsh-plugins。

## 步骤
1. 镜像：把 dsh 家族 headless bundle 与依赖闭包备进 eval-env（T16 的方式：本地包镜像 + versions.lock），重建 eval-env:pinned，refs.fingerprint 与 i3-env-log 更新；白名单加 console.anthropic.com。四家最小 exec 复测（T16 §那张表再跑一遍）。
2. 凭证：宿主上先 claude login 一次（3171 实例的作用域，不碰 ~/.dsh-official）；按 T20 的 --creds-root 约定备四家容器用作用域目录（settings 不带宿主代理；属主 1000）；kimi 仍 403 就记实际错误，不等配额。
3. profile：codex sandbox 改 danger-full-access，条件文件 permissions 同步，methodology 里的不对称句改成「容器内四家同档」。
4. 容器内 F2 阶段三一格（codex，1 rep，--only）：T23 就绪检查过、三阶段跑完、verify 探针（verify-rollup 的 ratio）在容器内出判定、archive、finalize 过闸、released。报告的四条不变量首次全 ok。
5. 四家同一题：F3 阶段一二 × 四家 × 1 rep（最便宜且 D-N1 有区分度）；kimi 若配额未复，跑三家并记原因。报告比较节首次打开：得分判据数、加权分、缺陷清单、效率表。
6. pilot-b-log.md：与 pilot A 同一格式——每格时间线、就绪检查、指纹、探针 outcome、报告摘录、缺口清单。

## 约束
不碰 ~/.dsh-official 与 3080；凭据不进日志、回报、提交；题库写操作一律 worktree；不跑满题目——每格 1 rep，总 token 预算先报再跑，超预算停下回报。

## 完成判据
I3 行的完成判据整句成立：容器内一格走完全流程、release 经闸；四家（或三家 + kimi 的实际错误）在容器内跑通同一题；两个 run 的报告不变量四行全 ok；镜像可复现（内容指纹逐行相同）。

## 回报
两条分支与题库 commit；镜像 digest 与 refs.fingerprint；四家容器内 exec 复测表；两个 run 的报告摘录（不变量、得分判据数、缺陷清单、效率表）；pilot-b-log.md 路径；剩余缺口清单。

## 追加（2026-09-08，T19c、T20 合入后）
- T19c（i1-walk fef040a）与 T20（main 0639947）都已合入，第 1–4 步可以开始。T20 的真机一格没上 3171、没拉真 CLI，所以第 4 步是 I3「容器内一格走完全流程」第一次真的成立：就绪检查、两阶段真 CLI 委派、回读模型、探针、闸、release 缺一不可，报告四条不变量要全 ok（含「受试对象一致」）。
- 第 5 步（四家同一题）等 T20b 合入：现在的复合指纹含各家不同的 env 键与挂载 target，四家横比「环境一致」必 violated，报告会拒绝比较。T20b 合入前不要跑第 5 步。
- 题库顺手两行（只改散文，不动判读）：P0 探针改回 import 题集级 lib（T20b 物化路径修好后才成立，放第 5 步之后）；F3 rubric.md「题眼 A2-1（6 分）：不给用户增加负担」按内容应指 A4-1，核对 rubric.yml 后改指认。
- 凭证目录按 T20 的 `--creds-root DIR/<条件 id>` 约定备，属主 1000；T20 用的是占位文件，第 4 步是第一次装真凭据进单元。

## 追加（2026-09-08，T20b 合入后）
- T20b 已合入 main（d623952），第 5 步可以跑；先把 main 并进 feat/web-eval-container-pins。第 5 步必须走 3171 实例（install.sh 装 profile、/eval run 发起），不再用 tsx 驱动——容器化后的实例路径要在 I3 里验一次；撞上 G3 就绕到既有会话，记进 pilot-b-log。报告要看到「环境一致」ok 且四个单元指纹各异、差异项逐格列出。
- 阶段三不在本任务里：题库缺 stage3 的 prompt、schema 引用形态与 L2 探针，记 T19d。第 4 步以阶段一二 + 盲评收口，verify-rollup 记 probe-skipped 是预期结果，写明。
- P0 探针改回 import 题集级 lib 那一行：T20b 已按题库真实路径物化，第 5 步跑完顺手改，进 i3-env-b。

## 追加（2026-09-08，第 1–4 步验收后）
- 第 1–4 步已验收：profile 合入 main 126990b，题库 i3-env-b 并入 i1-walk 913be11；第 5 步继续在 i3-env-b 上提交，跑前把 main 并进 feat/web-eval-container-pins。
- 第 5 步等 T20c 合入：产品路径上容器轮的作用域挂载源改为 local-agent 该家的宿主作用域目录，`--creds-root` 删除。凭证不再 stage 副本——在 3171 实例上直接 `/codex login`、`/claude-code login`、`/kimi login`，写进的就是要挂的目录；续期失败清空的是评测实例自己的作用域目录，重登即可，不碰 ~/.dsh-official。
- 第 5 步的就绪检查会带判官条件（T20c），判官那条链要先在 3171 上建好。
- 第 5 步报告要看到：四条不变量全 ✅、四个单元指纹各异且差异项逐格列出、比较节首次打开、效率表 token 四列是否仍缺席（缺席就记 G14 下半截的复现证据）。

## 追加（2026-09-09，T20c 合入后）
- T20c 已在 main（28c0c17），第 5 步可以开跑：先把 main 并进 feat/web-eval-container-pins，在 3171 上重装 profile（install.sh / update.sh），`/eval run` 不再有 `--creds-root`。
- 3171 上四家各 login 一次（kimi 要重新授权）；判官条件也进就绪检查，判官那家的登录与链先备好，否则 run 在开跑前被拒。
- 第 5 步用 P0 × 四家 × 1 rep 收 I3（2026-09-09 定）：它验的是实例路径、四家同一题、环境类、判官就绪、比较节打开、token 列是否落地，P0 就是为这个准备的占位题，几十 k token 够了；不另造新题。F3 阶段一二 × 四家 × 1 rep 是内容轮（记作 5b），四家两阶段加盲评约 1–2.5M token，预算另批，跑不跑不影响 I3 收口。kimi 若仍不通，就绪检查会把整个 run 拒掉——这时把 kimi 从计划里拿掉跑三家，把拒绝原文记进 pilot-b-log，不要用 --ignore-readiness。
```

### T20b · eval：「环境一致」的口径、register 布局的物化路径、物化哈希统一（已完成，2026-09-08 验收）

```text
# 任务 T20b：dsh-eval——「环境一致」去掉条件自有项再比；register 布局按题库真实路径物化；两条路径的物化哈希统一

## 背景
T20（main 0639947）让 refs.fingerprint 取 lab 的复合指纹，「环境一致」在 P0 × 一家上首次 ok。但复合指纹的分量含 envKeys 与 mounts（target / type / readonly），而容器路径下每个条件各挂自己的作用域目录、各设自己的变量（CODEX_HOME、CLAUDE_CONFIG_DIR、KIMI_CODE_HOME、DSH_HOME 各指向自己在容器内的作用域目录），四家同一 run 必然四个指纹，报告按既有规则记 violated 并拒绝比较——T22 第 5 步就卡在这里。T19c 发现第二件：register 布局的题（P0）物化后判定目录在 item 与 display 之间多一段 verify/（<tmp>/items/P0/verify/checks/probes/x.mjs），题库里是 items/P0/checks/probes/x.mjs，题内探针到题集级 lib 的相对路径差一层，P0 只能自带几十行副本；任何 register 布局的真题都会踩。第三件：容器路径的 materialization sha 是 lab populate 的 manifest 算法，宿主路径是 eval 自己「排序后整体 sha256」，报告两种字段都读，跨路径不可比。

## 先读
packages/eval/src/run.ts（acquire 后 setRefs 的位置、容器路径的物化与 manifest）、report.ts（envInvariant / refs.fingerprint 的读法）、judge.ts（两个 verify 层的物化、register 布局的角色映射）；packages/lab/src/fingerprint.ts（FingerprintComponents、canonical JSON、ADDITIVE_COMPONENTS）与 types.ts；packages/datasets 的 register 布局说明（README「布局」节）；T18 / T18b / T20 / T28 的 Agent Note；题库 items/P0-placeholder 的 register 与 checks/probes/link-check.mjs。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-env-class，分支 feat/eval-env-class；主要改 packages/eval/；lab 只加一个纯函数动词，不改既有动词；不改 datasets、local-agent、mission。

## 已定决定（照此实现）
- 「环境一致」比的是计划声明的环境，不是单元的全部事实：从单元的 FingerprintComponents 里去掉条件自有项——条件 unit.scopedHome 的挂载 target 与变量名、条件 env.keys 里的键——剩下的（image、resources、network、user、计划级挂载与 env 键）算一个环境类哈希，写进 refs.fingerprint；每格完整的 lab 指纹另记 refs.unitFingerprint 并进 archive manifest。同 run 内环境类不同仍 violated。
- 哈希规则不复刻：lab 服务面加纯函数 fingerprintOf(components)（与 CLI 的 fingerprint 同一实现，只加不改，带测试与 README 双语 + sidecar），eval 用它算环境类；标签沿用 lab-env:<sha256>，分量 version 不变——它只是少了几项的同一算法。
- 报告：不变量一节「环境一致」打印环境类；下面列每格的 unitFingerprint 与被去掉的条件项（键名与 target，不含值），让读者看得见差在哪儿；宿主路径无指纹的 run 照旧 unverifiable。
- register 布局按题库真实路径物化：判定目录里每层落在它在题库里的真实相对目录（items/<id>/checks/…），不再统一套 verify/；约定式布局不变；探针的 by 仍是 display 路径。P0 的探针改回 import 题集级 lib 归题库（T22 顺手），本任务用夹具题验证两种布局下 ../../../../verify/helpers/lib 都解析得到。
- 物化哈希统一：两条路径的 materialization.json 都用 eval 今天的算法对源目录算（排序后整体 sha256），lab populate 的 manifest 作为「拷进单元的是这份」的证明另存，报告只读一种字段；pilot-a-round1 与 T20 的 P0 bundle 复算作回归（宿主 sha 不变；容器格换算法后与宿主同题同 commit 的 sha 相等）。

## 交付
上述三项 + 测试（环境类去项、四个假条件同 run 环境类相等而 unitFingerprint 不等、register 布局物化路径、哈希统一的跨路径相等）；lab 的 fingerprintOf；README 双语；Agent Note（bug-fix）。

## 约束
不碰 3080；不改 verdict / probe 契约；不改 lab 既有动词语义；不动题库。

## 完成判据
eval / lab 测试全绿，gate 绿；用 T20 的 P0 bundle 加三个只差作用域项的假条件做出的 run：报告「环境一致」ok、四个 unitFingerprint 各异并列出差异项；register 夹具题的探针经题集级 lib 判定成功；pilot-a-round1 报告逐字节不变。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；那份四条件 run 的不变量一节原文；物化 sha 跨路径相等的两行。
```

### T20c · eval：容器路径挂 local-agent 的作用域目录而不是 `--creds-root`；就绪检查覆盖判官条件（已完成，2026-09-09 验收）

```text
# 任务 T20c：dsh-eval——容器轮挂 local-agent 的作用域目录，删 --creds-root；就绪检查加判官条件

## 背景
T22 第 4 步（tsx 驱动）踩到：容器轮的 rollout 由 CLI 写进 bind 进单元的那个宿主目录，而 local-agent 的回读读 homeDir(家名) = homesRoot/<家名>；T20 让前者是 --creds-root/<条件 id>，两个目录不是一处。指错不报错，只让回读永远为空——就绪检查报 ready, model —，报告「受试对象一致」只剩 ⚠️。T22 在驱动里把 homeDir 指到凭证目录才拿到 ✅；3171 的产品路径没有这个手段。根因是 T20 文案与 T17 的决定分叉：T17 定的是「scoped home 是宿主目录，以 rw bind 挂进容器，回读直接读它」。另一条缺口：就绪检查（T23）只覆盖选手条件，判官条件不在——T22 那轮判官两个样本全掉（判官那条链没构建）而 run 照走到 released；判官同样是一次会失败的真委派，失败代价是整轮判定作废。

## 先读
packages/eval/src/run.ts（容器路径的 acquire 挂载、credsRoot 的读取与校验、readiness 的调用）、readiness.ts、slash.ts / cli-core.ts 的 --creds-root、faces.ts 的 LocalAgentFace；packages/local-agent/src/index.ts 的 homeDir(name)（服务类已有，index.ts:662）与 homesRoot 配置；T17 / T20 / T23 的 Agent Note；题库 docs/pilot-b-log.md「途中两个坑」。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-scoped-home，分支 fix/eval-scoped-home-readiness-judge，只改 packages/eval/（含 README 双语与 sidecar）；local-agent 若服务面上没有 homeDir，只加一行只读导出，不改行为。

## 已定决定（照此实现）
- 容器路径的作用域挂载源 = local-agent 该家的宿主作用域目录：LocalAgentFace 加 homeDir(harness)，acquire 的 mounts 用它作 source，target 仍是条件 unit.scopedHome.container，变量名照旧。--creds-root 整个删掉（slash、cli-core、README、契约文档里的运行说明），条件文件不改。
- 凭证由评测实例自己的 /<家> login 写进作用域目录，不 stage 副本；README 写明两条：挂的是评测实例自己的作用域目录，续期失败清空就在实例上重登；「每条件一份作用域目录」要等 I4 的 T29（按次委派覆盖 scoped home）。
- 就绪检查加判官条件：judge 的 provider 也做一次真委派（READINESS_PROMPT 同款），失败按同一规则拒整个 run，结果记进 run.meta.readiness 的 judge 一栏；宿主与容器两条路径都做；--ignore-readiness 同样跳过它。
- 回读不改：容器轮 settle 后走既有 homeDir 路径读 rollout / session，从此读得到。

## 交付
上述改动 + 测试（容器路径 mounts 的 source 来自 homeDir；--creds-root 不再被识别；judge 就绪失败拒 run、成功记录）；README 双语；Agent Note（bug-fix）。真机：P0 × codex 一格（tsx 驱动即可，同 T20 的方式）——就绪检查 model 非空，报告「受试对象一致」✅；再造一个坏 judge 条件跑一次，run 在就绪检查被拒。

## 约束
不改 lab、mission、datasets；不改 local-agent 行为；不碰 3080 与 ~/.dsh-official；凭据不进日志与回报。

## 完成判据
eval 测试全绿，gate 绿；真机两次结果如上；run.meta.readiness 里有 judge 一栏。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；两次真机的 readiness 与不变量摘录。
```

### I4 的文案

### T30a · local-agent：四家 provider 的 `model` 配置键，缺省即今天，设置卡「默认模型」（已完成，2026-09-08 验收）

```text
# 任务 T30a：local-agent——四家 provider 插件配置加可选 model，不写 = 今天的表现，写了每轮以它起 CLI；设置卡「默认模型」

## 背景
四家的模型今天各有各的来源，没有一个统一的「切模型」入口：codex 读作用域 config.toml 顶层 model（packages/local-agent-codex/src/provision.ts:115）；claude-code 读作用域 settings.json 的 model（local-agent-claude-code/src/provision.ts:73），没配就是 CLI 自己的默认，插件不猜；kimi 的插件配置有必填 model 键，但只在第一次备置作用域目录时写成 config.toml 的 default_model，已有配置不动；dsh 的子实例继承宿主实例的默认模型服务，provider 从不覆盖，报成 provider/model。要换模型得去改各家的作用域文件，dsh 还得改整个宿主实例。评测侧的约束已经在：冻结决策 5 要求声明模型 == 实测模型，条件哈希含模型，run 中途换会让下一轮 MisattributedRun——这是对的，保留。

## 先读
四家 provider 的 index.ts（配置 schema、effectiveSettings 的读取顺序）与 provision.ts；packages/local-agent/src/types.ts 的 LocalAgentEffectiveSettings.model 注释；T11 / T8b / T25 的 Agent Note（回读与 effectiveSettings）；profiles/web-eval/cordis.patch.yml 的 kimi 行（现有 model pin）；dsh 的 @deepseek-ai/dsh-agent-default-model 服务面（dsh 子实例能否按次启动指定模型）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-local-agent-model-key，分支 feat/local-agent-model-key，只改 packages/local-agent 与四个 provider 包（含 README 双语与 sidecar）；不改 eval、profile pin。

## 已定决定（照此实现）
- 四家插件配置加可选 model: string。不写：与今天逐字节相同（各家从作用域文件 / CLI 默认 / 宿主实例读）。写了：每轮委派（fresh 与 resume 都算）以它起 CLI——各家用自己 CLI 的模型参数（codex exec 的 -m / -c model=、claude 的 --model；kimi 与 dsh 以实施者核实的旗标或作用域配置为准），argv 层测试钉住；哪家 CLI 没有按次启动的模型参数，就在每轮起 CLI 前把作用域配置写成该值并在 README 写明。
- kimi 的 model 键语义从「备置时镜像一次」改为「每轮生效」，是有意的行为变化：旧的 provision 镜像保留（首次备置仍写 default_model），README 与 Agent Note 写明。
- dsh：宿主实例的默认模型服务仍是缺省来源；若子实例的 headless 启动能指定模型则 model 键生效，否则本任务不给 dsh 提供 model 键，README 写清「dsh 换模型 = 换宿主实例默认模型」并记进交出项。
- effectiveSettings.model 的读取顺序改为：插件配置 model → 作用域文件 → 缺位；status 与条件快照都看得到；回读照旧核对实测模型，不一致仍 MisattributedRun。
- 「切了新 run 照新走、进行中不受影响」不需要额外机制：条件哈希在 run 建立时冻结，中途改配置下一轮就会被回读拦下——README 写一段解释这是设计而不是缺口。
- 设置卡「默认模型」：dev 域 UI，四家各一个自由输入框加最近用过的值，不硬编码模型目录；保存即写插件配置的 model 键。

## 交付
四家配置键与 argv / 配置写入；effectiveSettings 顺序；设置卡；测试（每家：不写 = 旧 argv 逐字节相同；写了 = 新 argv 或新作用域配置；resume 沿用；effectiveSettings 顺序）；README 双语；Agent Note（feature）。真机：本机三家（codex / claude / kimi）各改一次 model 后委派一轮，回读模型等于配置值；改回去再跑一轮，回到原值。

## 约束
不碰 3080 与 ~/.dsh-official；凭据不进日志与回报；不改 eval；不改 profile pin（评测实例要不要 pin 模型是 T31 的事）。

## 完成判据
四家测试全绿，gate 绿；真机三家的两轮回读表；dsh 一栏写明生效或不生效及原因。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；三家两轮回读表（脱敏）；每家用的是旗标还是配置写入。
```

### T30c · local-agent + eval：工具调用计数进 settle 观测与效率表；每轮 token 与工具调用落库（已完成，2026-09-10 验收）

```text
# 任务 T30c：工具调用计数进 settle 观测与效率表；每轮 token 与工具调用落进 bundle

## 背景
效率表（T10 / T23）今天有活跃时长、委派轮次、输出 token、输入 token、cacheRead、标价成本六列。token 四列四家都在 settle 时算出（codex 读 rollout 的 token_count，claude 读流末 usage，kimi 读 session view，dsh 读 session mirror 累计），编排器经 onProgress 的 settled 事件并进委派记录。工具调用没有位置：四家 provider 都解析了工具事件——codex 的 item.completed 里 command_execution / function_call、claude 的 tool_use、kimi 的 acp 工具调用、dsh 的 session mirror——但只用来镜像进子会话与展示，没有汇成计数。「标价成本」列读 run.meta.pricing（report.ts:1309），今天没人写它，列永远空——计价不在本任务：单价表由 bundle 之外的非模型环节套用，本任务只保证每轮的 token 与工具调用按轮落库、外部读得到。

## 先读
packages/local-agent/src/types.ts 的 settled 观测（kind / observedModel / cliVersion / usage，types.ts:436–452）与 TokenUsage；四家 provider 的流解析处（codex-cli-provider.ts 的 item.completed 分支、claude-cli-provider.ts 的 tool_use、kimi 的 session-view / session-mirror、dsh 的 session-mirror）；packages/eval/src/faces.ts 的 DelegationProgress / DelegationUsage、run.ts 的 settled 合并（852–853 行一带）、report.ts 的 ConditionEfficiency 与 pricing 读取、report-render.ts 的效率表；packages/eval/src/schema.ts 的 PLAN_SCHEMA 与 run.meta 的写入；T10 / T23 / T25 的 Agent Note。

## 分支
从 main 开 worktree ../dsh-plugins-wt-tool-calls-pricing，分支 feat/tool-calls-and-pricing，改 packages/local-agent、四个 provider 包、packages/eval（各自 README 双语 + sidecar）；不改 lab、mission、datasets。

## 已定决定（照此实现）
- settled 观测加可选 toolCalls: { count: number, byName: Record<string, number> }，每轮一份，名字按各家 CLI 自己报的写（codex 的 command_execution 就叫 command_execution，function_call 取函数名；claude 取 tool_use 的 name；kimi 与 dsh 取各自事件里的工具名），不做跨家归一——横比只比 count，byName 供阅读。TokenUsage 不动。
- 计数只来自 provider 已经解析的事件，不新增解析路径；哪家的事件里拿不到名字就只报 count，README 写明。
- eval：DelegationProgress 加同名字段，run.ts 与 usage 一样并进委派注解；效率表加「工具调用」一列，按条件汇总只计已完成格（T23 规则），缺席打「—」不是 0；results.jsonl 每格带 toolCalls。
- 落库：导出时写 report/usage.jsonl，每轮委派一行 { run, cell, condition, task, stage, round, observedModel, cliVersion, durationMs, usage, toolCalls }，缺的字段缺位不补 0；summary 的效率表从它汇总，外部计价也只读它。「标价成本」列与 run.meta.pricing 的读法不动，今天照旧留空；不改 plan 契约。

## 交付
四家 toolCalls；eval 字段、效率表列、report/usage.jsonl；测试（每家：从夹具流数出 count 与 byName；eval：settled 并入、缺席打「—」、usage.jsonl 每轮一行且与效率表汇总一致）；README 双语；Agent Note（feature）。真机：本机 codex 与 claude 各委派一轮带工具调用的任务（例如「列出当前目录并统计文件数」），回读 toolCalls 非空且 byName 与 CLI 自己的输出对得上；用 pilot-a-round1 bundle 复算：新增 report/usage.jsonl，results.jsonl 逐字节不变。

## 约束
不碰 3080 与 ~/.dsh-official；凭据不进日志与回报；不改 verdict / probe 契约；不改条件哈希的输入。

## 完成判据
local-agent 家族与 eval 测试全绿，gate 绿；真机两家的 toolCalls 表；pilot A 复算后 usage.jsonl 的前几行与效率表原文。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；两家 toolCalls 表；效率表原文。
```

### T29 · local-agent：作用域目录按 scope 命名，每次委派可指定 scope（已完成，2026-09-10 验收）

```text
# 任务 T29：local-agent——作用域目录按 scope 命名，每次委派可指定 scope；eval 条件加 scope 字段

## 背景
今天 homeDir(name) = join(homesRoot, name)（index.ts:663），只认家名：register 时建目录并 provision 一次，登录、状态、delegations.jsonl、listSessions、回读、CLI 版本探测、live 驱动、kimi 的 mcp.json、dsh 的子 profile 全都落在这一份目录里；四家 provider 在 apply 时与每轮 start 时各自调 ctx.localAgent.homeDir('<家名>')；DelegationCallOptions 只有 cwd 与 exec，intent 与委派记录都不带作用域目录，resume 只核 cwd。eval 侧 T20c 把容器轮的挂载源定为 faces.localAgent.homeDir(条件的家名)（run.ts:1532），所以同一家的两个条件共用一份作用域目录——只能在模型、推理强度这类不落在目录里的因子上不同，一个 run 要两次不同登录今天表达不了。I4 的 T30b（按次委派模型）、T31（条件 provision）、T33 的 pilot D（同 harness 两 preset）都要先有「每条件一份作用域目录」。

## 先读
packages/local-agent/src/index.ts（LocalAgentRegistry：homeDir、register 的 provision、statusOf、sessionsOf、persistDelegation / loadDelegations、handle 的 login / status / sessions / logout、ptyLogin / runLogin、authFailures / authSuccesses / logins 三个按家名键的 map）；types.ts（DelegationCallOptions、LocalAgentDelegationIntent 的 fresh / resume、LocalAgentDelegationRecord、LocalAgentStatus.homeDir、DelegationExecTarget 的注释块）；gateway.ts 的 status(name)；四家 provider 的 index.ts（apply 时闭包住的 homeDir 与 effectiveSettings 的读法）、*-cli-provider.ts 的 start（每轮 homeDir、containerScopedHome）、provision.ts、records.ts（回读读哪个目录；claude 的 keychain 项按目录路径哈希）；packages/eval/src/schema.ts 的条件 schema 与 unit.scopedHome、unit.ts 的 resolveCellUnit、run.ts 的挂载源与委派选项、readiness.ts 的 probeIn、faces.ts 的 LocalAgentFace；T11 / T17 / T20c / T25 / T30a 的 Agent Note。

## 分支
从 main 开 worktree ../dsh-plugins-wt-local-agent-scope，分支 feat/local-agent-scoped-home；改 packages/local-agent、四个 provider 包、packages/eval（各自 README 双语 + sidecar）；不改 lab、mission、datasets；不改 provider 的流解析、settle、回读算法。

## 已定决定（照此实现）
- scope 是一个名字，不是路径。homeDir(name, scope?)：缺省 scope 仍是 join(homesRoot, name)，逐字节与今天相同；命名 scope 落在同级的 join(homesRoot, `${name}@${scope}`)。scope 只允许 [a-z0-9-]，不接受任何路径——作用域目录永远在 homesRoot 之下。不把命名 scope 嵌在缺省目录里面：那会污染各家 CLI 自己的状态树。
- 命名 scope 惰性建立：第一次被 login / status / 委派点名时 mkdir 0700 + 该家的 provision（与 register 对缺省目录做的相同）；建了没登录的 scope，status 报 credentialState absent，委派照今天的规则失败。
- 委派：DelegationCallOptions 加 scope?: string；intent 的 fresh 与 resume 都带 scope，记录（LocalAgentDelegationRecord）记 scope；resume 不带或带不同的 scope 一律拒绝，与 cwd 的 assertResumeCwdUnchanged 同款。provider 每轮用 homeDir(家名, intent.scope) 起 CLI、写 env 的家变量、回读；apply 时闭包住的那份缺省目录只服务缺省 scope。
- 登录与状态：/<家> login | status | sessions | logout 加可选 --scope <名>，缺省不变；LocalAgentStatus 加 scope 字段，homeDir 报该 scope 的目录；Remote status(name, scope?) 同步。authFailures / authSuccesses / logins 三个 map 改按 (家名, scope) 键。effectiveSettings 改为接 homeDir（harness 契约的方法签名变，四家的读函数本来就吃 homeDir 参数），status 与 eval 快照按 scope 取值。
- delegations.jsonl 属于目录：每个 scope 目录一份，惰性加载；缺省目录的加载时机不变。
- 凭证不复制：每个 scope 各自 login。claude 的 keychain 项按目录路径哈希，命名 scope 自动得到自己的项——这是今天唯一天然按路径安全的部分，README 写明。
- 边界（本任务不做，README 与 Agent Note 写明）：live 驱动、LiveDriverSwitch、kimi 的成员桥 mcp.json 仍只绑缺省 scope，带 scope 的委派若撞上 live: true 直接拒绝（评测钉的是 exec，决策 2）；member-bridge.sock 仍是 homesRoot 级单例；dsh 的子 profile 随目录走，无需特殊处理。
- eval：条件文档加可选顶层字段 scope（同样只允许 [a-z0-9-]），缺省即缺省 scope；委派选项与就绪检查都带 scope；容器轮挂载源改为 faces.localAgent.homeDir(家名, 条件.scope)，LocalAgentFace 的 homeDir 签名同步；run.meta.unit.scopedHomes 已按条件记宿主目录，照旧。契约记 v1-rev8，双语 + sidecar + 夹具。scope 在条件文档里，因此进条件哈希——两个只差 scope 的条件是两个受试对象，对。

## 交付
local-agent 与四家的 scope 支持；eval 的条件字段与挂载源；测试（homeDir 的两种取值与非法 scope 拒绝；惰性建立与 provision；resume 跨 scope 拒绝；记录带 scope；status / login 的 --scope；effectiveSettings 按目录；eval 两个只差 scope 的条件各挂各的目录、就绪检查各探各的）；README 双语；Agent Note（feature，Alternatives 至少记三条：DelegationCallOptions 直接收宿主路径、scope 之间复制凭证、命名 scope 嵌在缺省目录内，以及各自被拒的理由）。真机：本机 codex 建一个命名 scope 并 login，缺省与命名各委派一轮，两条记录的 scope 与回读模型各自成立、rollout 各落各的目录；eval 宿主路径 P0 × 两个只差 scope 的 codex 条件 × 1 rep（tsx 驱动即可）：就绪检查两条各通过，两格 archived，run.meta.unit.scopedHomes 两个不同目录。

## 约束
不碰 3080 与 ~/.dsh-official；凭据不复制、不进日志与回报；不改 lab / mission / datasets；缺省 scope 的一切行为逐字节不变（现有测试全部原样通过）。

## 完成判据
local-agent 家族与 eval 测试全绿，gate 绿；真机两条委派记录与那份两条件 run 的就绪原文；缺省 scope 下 pilot-a-round1 bundle 复算逐字节不变。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；两条委派记录（脱敏）；两条件 run 的就绪原文与 run.meta.unit.scopedHomes。
```

### T30b · local-agent：委派级 model——首轮指定、记录、resume 不换；dsh headless 加 --model；eval 传条件的 model.declared（已完成，2026-09-10 验收）

```text
# 任务 T30b：local-agent——委派级 model；dsh headless 加 --model；eval 把条件的 model.declared 当每轮的请求模型

## 背景
T30a 给了三家插件配置级的 model 键，按 provider 全局生效；条件文档里的 model.declared 至今没有传到 local-agent——DelegationCallOptions 只有 label / signal / onProgress / reattach / cwd / exec / scope（types.ts:557–618），eval 在 run.ts:842–875 与 judge.ts:958–961 构造委派选项时都不带模型，声明只用来与回读比对（MisattributedRun，run.ts:957）。后果在 T22 第 5 步全见到了：判官条件声明 dsh v4-pro，实跑的是宿主默认 v4-flash，就绪检查拒；改声明成 v4-flash 又与 dsh 选手同 (harness, model) 撞 JUDGE_IS_PLAYER（run.ts:1441）。同一家两个模型的条件（I4 的 pilot B / C）同样表达不了。dsh 更缺一截：无头子 dsh 的启动面只有 --session-id / --resume / --serve（local-agent-dsh-headless/src/startup.ts:44–55），模型来自 agentDefaultModel.currentSelection()（agent-loader.ts:71–76），没有按次传模型的位置。

## 先读
packages/local-agent/src/types.ts（DelegationCallOptions、Intent 的 fresh / resume、Record、effectiveSettings.model 的读取顺序注释 163–180）与 index.ts（start / resume 的 intent staging、assertResumeCwdUnchanged、assertResumeScopeUnchanged、assertScopeExecOnly、recordRoundObservation）；四家 *-cli-provider.ts 的 modelArg 与 spec 构造（codex -m 与 resume 子命令的位置、claude --model、kimi -m 与 acp 的 default_model 改写）与各自 live-driver.ts 里「runtime spawn 时绑定模型」的注释；packages/local-agent-dsh-headless/src/startup.ts、agent-loader.ts、serve.ts、cordis.patch.yml 的 runner 行；packages/local-agent-dsh/src/dsh-cli-provider.ts 的 argv 构造（586–588）与 env 层（593–617）；packages/eval/src/run.ts 的委派选项、readiness.ts 的 probeIn、judge.ts 的判官委派；T29 / T30a 的 Agent Note。

## 分支
从 main 开 worktree ../dsh-plugins-wt-local-agent-model-round，分支 feat/local-agent-delegation-model；改 packages/local-agent、四个 provider 包、packages/local-agent-dsh-headless、packages/eval（各 README 双语 + sidecar）；不改 lab / mission / datasets。

## 已定决定（照此实现）
- DelegationCallOptions 加 model?: string，只在 fresh 上接受；intent 的 fresh 带 model，record 记 model（请求值，与 observedModel 并列）；resume 不接受 model 参数，沿用记录里的请求值起 CLI，记录里没有就与首轮一样不传——「成员内固定、resume 不换」。
- 取值顺序：委派级 model → 插件配置 model（T30a）→ 作用域配置 → CLI 默认。effectiveSettings.model 的读法不变（它报的是没有委派级参数时会用的那个）。
- 四家一次性轮次：codex exec -m、claude --model、kimi -m，与 T30a 同一个 modelArg 接口，只是来源多一层；kimi 的常驻 acp 与三家的 live 驱动都不接受委派级 model——runtime 一起就绑定模型，带 model 撞 live: true 与 T29 的 assertScopeExecOnly 同款拒绝。
- dsh：headless 的 startup.ts 加 --model <provider/model>（与 effectiveSettings 报的 provider/model 同形），经 startup provider 与 cordis.patch.yml 的 runner 行进 agent-loader.ts:76 覆盖 agentOptions，installModelSelection 同步；--serve 下对整个进程生效。dsh provider 的 argv 在 --session-id 之后带 --model；本任务同时给 dsh 补 T30a 那把插件配置 model 键（当时因没有启动路没给），取值顺序与三家相同。
- eval：run.ts 的选手轮、judge.ts 的判官委派、readiness.ts 的就绪探测三处都把条件的 model.declared（非 null 时）作为 model 传下去；null 照旧不传。MisattributedRun 的比对不变——请求了还回读到别的，仍是 fail loud。run.meta.readiness 与每格注解记 requestedModel。
- 契约不改：条件文档形状不动，声明从「只核对」变成「先请求再核对」，README 与协议 §（条件）措辞同步，版本记 v1-rev9 只改描述。

## 交付
五个包的改动；测试（每家：fresh 带 model 的 argv、resume 不带且沿用记录、resume 带 model 拒绝、live 拒绝、取值顺序四层；dsh headless：--model 解析与覆盖、与 --serve 共存；eval：三处委派带 model、null 不带、readiness 记录）；README 双语；Agent Note（feature）。真机：codex 与 claude 各一轮，委派级 model 与插件配置 model 故意不同，回读等于委派级；dsh 一轮 --model 指到非默认模型，回读等于请求；resume 一轮不带 model，回读不变。

## 约束
不碰 3080 与 ~/.dsh-official；凭据不进日志与回报；不改 lab / mission / datasets；缺省行为（不传 model）逐字节不变，pilot-a-round1 复算相同。

## 完成判据
五包测试全绿，gate 绿；真机四轮回读表；一份带判官 dsh v4-pro、选手 dsh v4-flash 的 P0 计划在宿主路径上就绪检查两条都过，判官回读 v4-pro（tsx 驱动即可，不必跑完；JUDGE_IS_PLAYER 的去留归 T31）。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；四轮回读表；那份计划的就绪原文。
```

### T29c · 运维 + 代码：评测实例上 0.1.5-rc.1，minHost 标签对齐，迁移后回归清单第 2–6 项（已完成，2026-09-11 验收；第 5 项 2026-09-12 由 T29d 补齐）

```text
# 任务 T29c：评测实例上 0.1.5-rc.1——3171 重装、评测家族 minHost / verifiedHost 对齐、跑回归清单

## 背景
主线已切到 0.1.5-rc.1：基线提交 bb04c84 把全部包的官方依赖钉到 0.1.5 线，local-agent 家族适配并把 minHost 前移；eval / lab / datasets / mission / capability-catalog / local-agent-dsh-headless 的依赖跟着钉了，代码在新线上包测试全绿，但 minHost 仍写 0.1.2-rc.1、没有 verifiedHost。评测实例 3171 还在 ~/.dsh-toolchains/stable（dsh 0.1.1-rc.2）上跑 main 的插件，resume 轮报 childSession.snapshotEvents is not a function（T29b 记的宿主线不匹配）。切工具链时真正卡住的是已上架的 @khorsheed 成员：npm 最新 0.2.0 对齐 0.1.2-rc.1，import 的 settingsNamespace 在 0.1.5 上不存在，context-guard / ui-shortcuts import 即炸；0.1.5 对齐的 0.2.1 / 0.3.0 因 npm 账号风控未发。**npm 风控期间不从 npm 装任何 @khorsheed 包**：install.sh 把 UNPUBLISHED_DIRS 扩成「npm 上没有可用于本宿主线的发布」，那十个成员一并从源码打 tarball（已在实施中）。协调者已建好无状态工具链 ~/.dsh-toolchains/rc-0.1.5-rc.1（package.json 只依赖 @deepseek-ai/dsh@0.1.5-rc.1，node_modules/.bin/dsh --version 报 0.1.5-rc.1）。docs/host-migration-playbook.md 阶段 2 是集成验证实例的做法，3171 就是评测侧的这个实例。

## 先读
docs/host-migration-playbook.md（阶段 1 的基线提交与陷阱表、阶段 2）、docs/ops.md 的环境拓扑（3171 在 ~/.dsh-lab，凭据软链回 official 只读，settings 隔离）、profiles/web-eval/scripts/install.sh 与 update.sh（前置检查、预设备份、tarball 打包）、profiles/web-eval/README.md 的安装节与「当前 pin」段、scripts/compat-report.ts（minHost / verifiedHost 的语义：minHost 是地板，verifiedHost 是验过的线）、本文 I4 一节的「迁移合入后的评测侧回归清单」、T29b 的 Agent Note（三扇门与前置检查）。

## 分支
dsh-plugins：从 main 开 worktree ../dsh-plugins-wt-eval-host-line，分支 chore/eval-family-host-0.1.5，只改六个评测家族包的 package.json（dsh.compat 的 minHost / verifiedHost）、profiles/web-eval/README 双语 + sidecar 的宿主线要求一句、必要时 install.sh 的前置检查（加宿主版本核对：dsh --version 低于任一成员 minHost 就在动文件前退出并说明）。不改任何 src。运行记录进题库 docs/pilot-b-log.md（题库从 i1-walk 开 worktree，分支 i4-host-line）。

## 步骤
1. 3171：按 ankh-guard 的方式停实例（看门狗在守，用它的停法而不是 kill），PATH 前置 ~/.dsh-toolchains/rc-0.1.5-rc.1/node_modules/.bin 跑 install.sh（源码模式，从当前 main 打 tarball），前置检查通过后起实例，--dump-config 核对成员数与 pin（codex danger-full-access、三行 tools: none、dsh 的 headlessBundleDir 与 cliLaunch）。ankh-guard 的 install anchor 若因跨宿主版本拒绝重启，按 playbook 阶段 3 第 3 条先 configure-launch 重绑。
2. 回归清单第 3 项：本机四家 status 三个字段有值；各一轮最小委派回读到模型（kimi 配额未复就记原文）。
3. 第 4 项：3171 上 /eval run P0 × codex × 1 rep 两阶段到 archived——这是切换前拿不到的那一格；再起一次 job 后关掉发起端，run 照跑，job_output 读回全程日志。
4. 第 5 项：容器路径 P0 × codex 一格到 released（T20c 的方式，挂实例自己的作用域目录），四条不变量 ✅。
5. 第 2 项：pilot-a-round1 与 T22 第 5 步 run A 的 bundle 复算，results.jsonl / usage.jsonl 逐字节相同、不变量四行不变。
6. 第 6 项：三处接缝重看并各写一句结论——T17 的 docker exec 只经 ctx.subprocess；T29b 的 jobs 契约（JobStart / JobHooks / owner）在 0.1.5 上是否变形；T30b 的 dsh headless --model 经 startup provider 与 runner 行是否仍通。
7. 全部过后把六个包的 dsh.compat 写成 minHost 0.1.5-rc.1、verifiedHost 0.1.5-rc.1（一个独立 commit，参照 bb04c84 的写法）；scripts/compat-report.ts 跑一遍贴表。

## 约束
不碰 ~/.dsh-official 与 3080；凭据不复制、不进日志与回报；题库写操作一律 worktree；不跑 P0 以外的题；不改 src；**不从 npm 下载 @khorsheed 包**（风控期间源码模式打 tarball，或用本地已有 tarball）。

## 完成判据
回归清单六项各有原文；3171 在 0.1.5-rc.1 上 P0 两阶段 archived 与容器路径一格 released；compat-report 六个包 current；gate 绿。

## 回报
两条分支与 commit；install.sh 与 --dump-config 输出；六项回归的原文；compat-report 表；pilot-b-log 路径；剩余缺口。
```

**验收（2026-09-11 / 2026-09-12）**：第 1–4、6 项见 §二 的 T29c 验收段；第 5 项在边车拉起后由 T29d 的真机第一跑（Remote 门起 job、容器格 P0 × codex 到 released、四条不变量 ✅、420 秒就绪窗口）补齐。「3171 交回 ankh-guard」那一步没有成功，见 §二 的 3171 事故与 T33a。

### T31 · eval：conditions provision 写 lock；conditions list / diff 数据面；决策 9 放宽为多判官面板（已完成，2026-09-11 验收）

```text
# 任务 T31：dsh-eval——conditions provision 写 lock（作用域就绪 + effectiveSettings 逐项核对 + home.sha）；list / diff 只展示不给选；决策 9 放宽为多判官面板

## 背景
条件锚点是 T8b 立的：conditions/<id>.lock.json（dataseek.condition-lock/1，schema.ts:456）记条件哈希与 home.sha，validate 读它出 LOCK_STALE / HOME_NOT_PROVISIONED / HOME_MISMATCH（validate.ts:330–387），run 读它出 LOCK_STALE 拒绝或 LOCK_MISSING 警告（run.ts:1397–1406）。但仓库里没有任何东西写 lock——read.ts:108 与 service.ts:95 都指着「dsh-eval conditions provision（I4）」。CLI 只有 conditions hash（cli-core.ts:232–252），slash 只有 run 与 finalize，eval_conditions 工具只读。另一处空白：condition 的 model.declared、reasoning.effort、permissions、model.endpoint 从来没有和该作用域的 effectiveSettings 对过——home.sha 哈希的是配置内容，不是语义；就绪检查只核模型回读。决策 9「判官不得是选手之一」在 run.ts:1441 是 (harness.name, model.declared) 元组、在 validate.ts:268 只是条件 id 重合。公开榜单（MT-Bench、AlpacaEval、Arena-Hard）都让选手模型当评委并记录自评偏好，补救是多评委面板与标出「谁判了谁」而不是全局排除；SWE-bench 一类根本不用模型评委。2026-09-10 定：决策 9 放宽——支持多判官，每格由谁判进报告，判官与该格选手同模型的格标为「自评」但不拒绝，先不加更多约束。

## 先读
packages/eval/src/schema.ts（CONDITION_SCHEMA、LOCK_SCHEMA）、hash.ts（hashConditionDocument、hashHome）、read.ts（ConditionSummary、lock 读取）、service.ts、cli-core.ts、slash.ts、tools.ts（eval_conditions）、validate.ts（resolveConditionReadiness、JUDGE_IS_PLAYER）、run.ts（lock 核对、JUDGE_IS_PLAYER、readiness 主体构造）；packages/local-agent 的 LocalAgentStatus / LocalAgentEffectiveSettings 与 T29 后按目录取的 effectiveSettings；faces.ts 的 LocalAgentFace；T8b / T14 / T23 / T29 / T30a / T30b 的 Agent Note；profiles/web-eval/README.md 冻结决策 5 与 9。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-conditions，分支 feat/eval-conditions-provision，只改 packages/eval（README 双语 + sidecar、协议文档双语 + sidecar）与 profiles/web-eval/README 双语（决策 9 的措辞）；local-agent 若面上缺 effectiveSettings(harness, scope) 只加只读导出。

## 已定决定（照此实现）
- 动词 conditions provision <condition.json> --repo <题库工作副本>：一、按条件的 harness + scope 取作用域目录（homeDir 读即物化）；二、credentialState 不是 present 就停下并打印该跑的登录命令（/<家> login --scope <名>），不自动登录、不复制凭据；三、读该作用域的 effectiveSettings，与条件逐项核：cliVersion 对 harness.version（声明为 null 则回填进 lock 不改条件文档）、model 对 model.declared（声明非 null 时以声明为准——T30b 会按次请求它；effectiveSettings 报的是缺省，不一致只 warn）、reasoningEffort 对 reasoning.effort、sandbox / permissionMode / autoApprove 对 permissions、baseUrl 对 model.endpoint——permissions 与 endpoint 不一致是 error，拒写 lock；四、hashHome 算 home.sha；五、写 lock：{schema, condition, sha, home{sha}, provisioned{at, cliVersion, effective{model, reasoningEffort, permissions, endpoint}}}，additive 字段留在 /1（LOCK_SCHEMA 若关着 additionalProperties 就开成可选字段，不升版本）。只写给定 --repo 的工作副本，不 commit，不碰共享检出。
- conditions list [--repo]：现有 service.conditions() 的表（id、sha、lock 状态、home.sha 是否匹配）加 provisioned 快照列；conditions diff <a> <b>：两份条件文档的逐字段差异（canonical JSON 深比较，notes 除外），输出只标「哪些字段不同、各自取值」，不做任何推荐——「只展示与 diff，不给选」。三个动词 CLI 与 slash 都有；eval_conditions 工具加 diff 参数，仍只读。
- 决策 9 放宽为多判官面板：plan.judge.conditions 可列多个判官，每个判官对每格各判 samples 次；判官条件的 model.declared 必须非 null（validate 报 error，否则没法判重合）。去掉 run.ts:1441 与 validate.ts:268 的 JUDGE_IS_PLAYER 拒绝，改为：判官模型等于该格选手模型的格记 selfJudged: true。verdicts 与 results.jsonl 每条判定带 judge（条件 id 与模型）；summary.md 的比较节每格列出由谁判、自评格加标记；一致性一节除同判官双采样的 κ 外，列了多个判官时加跨判官一致性一行。README 决策 9 的措辞同步改成「判官显式 pin 模型；每格由谁判进报告；自评格标出」；Agent Note 写明为什么不做全局排除（要评全部模型时评委必然与某个选手重合，榜单实践是标出而不是禁止）。
- run 对 lock 的态度不变：缺失 warn、过期拒；validate 的 ready / unready 判定加一条：lock 里 provisioned.effective 与条件不一致 → unready 并点名字段。

## 交付
三个动词 + 工具参数；lock 写入与校验；决策 9 两处；测试（provision 的五步各自失败路径与成功写入；list / diff 输出形状；多判官分配与 selfJudged 标记、null 判官报 error、跨判官一致性；validate 的 provisioned 不一致 unready）；README 双语；协议文档条件锚点一节；Agent Note（feature）。真机：本机 codex 一个条件 provision 成功写 lock，改条件的 permissions 后再 provision 被拒；用题库 t29-two-scopes 的两个条件 diff，只差 scope 一项；一份两个判官、其中一个与某选手同模型的 P0 计划在宿主路径上跑通（tsx 驱动即可），报告每格列出两位判官、同模型那格标自评、一致性一节有跨判官一行。

## 约束
不碰 3080 与 ~/.dsh-official；不改 datasets / mission / lab；题库只以 --repo 指向的工作副本读写，共享检出 HEAD 不动；凭据不进 lock、日志、回报。

## 完成判据
eval 测试全绿，gate 绿；真机三样输出；pilot-a-round1 复算逐字节相同。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；lock 样例（脱敏）；diff 与 validate 的原文。
```

### T29b · eval + profile：/eval run 作为后台 job；路径展开 ~；install.sh 前置检查前移（已完成，2026-09-10 验收；archived 一格因宿主线不匹配未拿到）

```text
# 任务 T29b：dsh-eval——/eval run 起后台 job 立即返回；Remote 入口给 CI；plan 与 --out 展开 ~；install.sh / update.sh 前置检查前移

## 背景
/eval run 今天在会话轮次里同步 await service.run（slash.ts:267），回复从跑完的 report 构造；CommandInvocation 的 signal 没接，run 循环里唯一的 AbortController 是预算计时器（run.ts:819）。发起端一断，轮次没人接收，run 的委派又都以 parentSessionId 发出（run.ts:878）——T22 第 5 步记的「发起端一断整个 run 中止」就是这个。CLI 路径 dsh-eval run 没有宿主上下文，非 --dry-run 直接拒（cli-core.ts:166、service.ts:171），所以 CI 里没有浏览器就没有任何办法起一次真 run。宿主有通用的 jobs 服务：@deepseek-ai/dsh-jobs 挂在 ctx.jobs，JobStart 的 run() 是任意函数型启动器返回 JobHooks（cancel / done / readOutput），注册跨越轮次；不带 owner 的 job 只在 job_kill 或服务销毁时结束；模型面的 job_list / job_kill / job_output 已在评测预设里（agent.cordis.yml:79）。两条小的：plan 路径与 --out 都不展开 ~（slash.ts:231、run.ts:1885；validate.ts:63 已有 expandHome，run.ts:234 还有一份私有重复）；profiles/web-eval/scripts/install.sh 在第 176 行才第一次调 dsh，此前已整目录覆盖 $DSH_HOME/.agent-presets/eval（103–110）并跑完 build + pack，失败时 trap 的提示只说删 $DEST，预设残留没人管；update.sh 同形且没有 trap。

## 先读
packages/eval/src/slash.ts、service.ts、index.ts（inject 与 ctx.dshEval）、run.ts（runPlan 的入口、预算 AbortController、parentSessionId 的用途、expandHome 的两份）、cli-core.ts、validate.ts:63；@deepseek-ai/dsh-jobs 的 types（JobStart / JobHooks / owner 语义 / attachController）与 packages/taskpilot/src/index.ts 的用法；packages/local-agent/src/index.ts 的 start 对 parentSessionId 的要求（只要求会话存在，还是要求活跃 agent——实测后写明）；profiles/web-eval/scripts/install.sh、update.sh、README 的安装节；T23 finalize 的 interrupted 分类；T27 的 Agent Note（Remote 从脚本驱动的做法）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-run-job，分支 feat/eval-run-as-job；改 packages/eval（package.json 加 jobs 的 peer 类型依赖、README 双语 + sidecar）与 profiles/web-eval/scripts/ + README 双语；不改 local-agent / mission / lab / datasets。

## 已定决定（照此实现）
- /eval run 起一个 kind 为 eval-run 的函数型 job 后立即返回 job id 与 runId；run 的日志行写进 job 输出（readOutput），报告落盘路径在结束行；--wait 保留旧行为（轮次内等到跑完再回复），供交互用。job 不带 owner——它要活过发起会话；parentSessionId 仍记发起会话作子会话的亲代；若 local-agent.start 实测要求活跃 agent 而不只是会话存在，run job 自己开一条评测会话作父并把这一点写进 README。
- 取消只有一条路：job_kill → JobHooks.cancel → 触发 run 的预算 AbortController 同款路径（localAgent.cancel 每条在跑的委派）→ run 记 interrupted（T23 finalize 的分类照旧）。没有第二个取消入口。
- ctx.jobs 缺席（别的 profile 没挂 jobs）时 /eval run 退回同步等待并在回复首行写明；不因缺 jobs 拒绝。
- Remote 入口：EvalService 暴露 runStart(planPath, options) → {jobId, runId}、runStatus(jobId)、runOutput(jobId, cursor)、runCancel(jobId)，与 slash 同一实现；CLI 加 dsh-eval run --instance <url> [--token …]，经 Remote 起 run 并轮询输出到退出，CI 无浏览器就走这条；本机 dsh-eval run 没 --instance 时仍只允许 --dry-run。
- plan 路径与 --out（slash 与 CLI 的 report --out 一并）经 expandHome；删掉 run.ts 里那份私有重复，只留 validate.ts 的导出。
- install.sh / update.sh：第一步就检查 command -v dsh、dsh --version、以及 cordis.patch.yml 里 pin 的 headless 路径与 PATH 上的 dsh（题库 env/README 写的机器级前置），任一缺失在动任何文件之前退出并打印缺什么；预设目录改为先备份再覆盖，trap 的提示同时覆盖 $DEST 与预设的恢复；update.sh 补 trap。

## 交付
job 化的 run 与 --wait；Remote 四个入口与 CLI 客户端；路径展开；两个脚本的前置检查与 trap；测试（假 jobs：起 job 立即返回、输出行、cancel 走预算路径、缺 jobs 退回同步；expandHome 三处；脚本用 bats 或 shell 夹具验前置检查先于任何写入）；README 双语（运行一节：三种发起方式、取消唯一路径）；Agent Note（feature）。真机：3171 上 /eval run 一份 P0 × codex × 1 rep 计划，回复立即返回，关掉浏览器标签页，run 照常到 archived，job_output 能读到全程日志；再用 dsh-eval run --instance 从终端起一次 --dry-run；install.sh 在没有 dsh 的 PATH 下第一步就退出且 $DSH_HOME/.agent-presets/eval 未被碰。

## 约束
不碰 3080 与 ~/.dsh-official；不改 local-agent / mission / lab / datasets；凭据不进日志与回报；--wait 下的行为与今天逐字节相同。

## 完成判据
eval 测试全绿，gate 绿；真机三样；pilot-a-round1 复算逐字节相同。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；断开浏览器那次 run 的 job 输出末尾十行与 mission 状态；install.sh 前置检查失败的原文。
```

### T32 · capability-catalog：snapshotFor(presetId) 与能力清单哈希；sub-dsh 的能力面按 scope 组 preset（已完成，2026-09-11 验收；pilot D 口径改为 sub-dsh × 两 preset，同工具不同技能）

```text
# 任务 T32：capability-catalog——按 preset 取快照并出规范化哈希；eval 记编排实例的能力哈希；sub-dsh 的子 profile 按 scope 组 preset roster

## 背景
capability-catalog 的 snapshot Remote 只按部署默认 preset 的 standing scope 取（index.ts:207–217，standingKeyFor 本就接 id 却没暴露），行没有版本字段，顺序是注册序，没有任何哈希。条件文档里 preset 与 skills.pack 两个字段早就存在且进条件哈希（schema.ts:267–277），但从没被核对——它们是「宣称」，不是「事实」。更要紧的一条事实：preset 管的是 web-eval 实例自己的规划 / 分析 agent 及其进程内子 agent，管不到被委派的四家 CLI；sub-dsh 的 headless bundle 不组 preset roster，模型面的行从宿主全局层读（local-agent-dsh-headless/src/agent-loader.ts:72–76）。所以「同 harness 两 preset」（pilot D）今天对任何受试对象都不成立。T29 之后 dsh 的子 profile 随 scope 目录物化（local-agent-dsh/src/provision.ts），这是唯一一条能让 sub-dsh 的能力面按条件变的路。

## 先读
packages/capability-catalog/src/index.ts（catalogScope、snapshot、list_capabilities）、remote.ts、types.ts、official-tools.ts；packages/eval/src/schema.ts 的 preset / skills 字段与 hash.ts 的 canonicalJson；packages/local-agent-dsh/src/provision.ts（子 profile 的 cordis.patch.yml 与 manifest）、packages/local-agent-dsh-headless 的 agent-loader.ts 与 cordis.patch.yml；profiles/web-eval/presets/eval/agent.cordis.yml 与 preset.yml（一个 preset 长什么样）；T21 / T27 / T29 / T31 的 Agent Note；README「capability-catalog」行（L140）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-capability-hash，分支 feat/capability-hash；改 packages/capability-catalog、packages/local-agent-dsh（子 profile 组 preset）、packages/eval（run.meta 与 lock 的哈希字段）；README 双语 + sidecar；不改 mission / lab / datasets。

## 已定决定（照此实现）
- capability-catalog：snapshotFor(presetId?) 与 hashOf(snapshot)。规范形：skills 与 tools 各按 name 排序；tool 行取 {name, channel, parameters}（description 不进——措辞改动不该改因子），skill 行取 {name, source, 正文 sha256}（detail 读正文；updatedAt 不进）；mcpServers 取 {name, 工具名列表}；channels 取名单。哈希 = sha256(canonicalJson)，标签 caps:<sha256>；Remote 与 list_capabilities 都能带回 sha。
- eval：run 建立时记编排实例（当前默认 preset）的 caps 哈希进 run.meta.orchestrator.capabilities——这是 provenance，不是因子；报告的「程序一致」把它列出但不比较。
- sub-dsh 的能力面成为因子：T29 的 scope 目录里子 profile 的 cordis.patch.yml 可带一段 preset roster（由 T31 的 provision 按条件的 preset 字段写入），headless 的 agent-loader 组它而不是读全局层；条件的 preset 非 null 时，provision 用 snapshotFor 对该子 profile 算 caps 哈希写进 lock 的 provisioned.capabilities，就绪检查核对；三家外部 CLI 的 preset 必须为 null（validate 报 error），它们的技能包（skills.pack）本任务不做，留 I6。
- pilot D 的口径定为「sub-dsh × 两 preset」：两条 dsh 条件、两个 scope、两份子 profile roster，其余全同；caps 哈希不同即两个受试对象。

## 交付
catalog 的两个接口与哈希；eval 的 run.meta 与 lock 字段；sub-dsh 子 profile 组 preset 的路；测试（规范形稳定：同内容不同注册序同哈希、改 description 不改哈希、改 parameters 改哈希；snapshotFor 按 id；provision 写 capabilities；外部 CLI 的 preset 非 null 报 error）；README 双语；Agent Note（feature）。真机：本机起两个只差子 profile roster 的 dsh scope，各 snapshotFor 出不同哈希，各委派一轮回答「你有哪些工具」并与清单对得上。

## 约束
不碰 3080 与 ~/.dsh-official；不改 mission / lab / datasets；不改三家外部 CLI 的 provider。

## 完成判据
三包测试全绿，gate 绿；真机两哈希两清单；pilot-a-round1 复算相同（run.meta 多一个字段，results.jsonl 不变）。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；两个 scope 的 caps 哈希与清单差异；lock 样例。
```

### T30d · local-agent-dsh：认 0.1.5 的 session.v3.jsonl.zstd（已完成，2026-09-12 验收）

```text
# 任务 T30d：local-agent-dsh——子 dsh 会话文件按前缀匹配，不写死文件名

## 背景
T29c 回归第 6 项：dsh 的请求侧完整（--model → startup provider → runner 行 → applyModelRequest，记录 cliVersion 0.1.5-rc.1），但 session-mirror.ts 按写死的 session.jsonl.zstd 找子 dsh 会话，0.1.5 写的是 session.v3.jsonl.zstd；真目录实测新线 undefined、旧线 2435 条事件。observedModel / usage / toolCalls 三样一起丢，报告第三条不变量对 dsh 格只剩声明侧，效率表 dsh 的 token 列空，pilot B（dsh × 两模型）两格都配不出对子。records.ts 的 /dsh sessions 走同一个写死文件名，同样受影响。

## 先读
packages/local-agent-dsh/src/session-mirror.ts、records.ts（文件名常量与目录扫描）；T11 / T25 的 Agent Note（回读的定位规则）；宿主 0.1.5 的会话存储布局（用 ~/.dsh-toolchains/rc-0.1.5-rc.1 起一次性 HOME 看真目录）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-dsh-session-v3，分支 fix/local-agent-dsh-session-v3，只改 packages/local-agent-dsh（README 双语 + sidecar）。

## 已定决定
- 会话文件按前缀匹配 session*.jsonl.zstd，多份时取版本号最高的（v3 > 无版本），并把选中的文件名记进回读结果；找不到仍报缺位不猜。
- session-mirror 与 records 用同一个解析函数；旧线文件名继续认（历史兼容：floor + current）。
- 不改协议、不改 eval。

## 交付 / 完成判据
两条路径的测试各钉旧线与新线的真实目录夹具；真机：0.1.5-rc.1 上 dsh 一轮委派回读到 observedModel、usage、toolCalls 三样；/dsh sessions 列得出会话；pilot-a-round1 复算逐字节相同。

## 回报
分支名与 commit；Agent Note 路径（bug-fix）；gate 输出；那一轮的记录（脱敏）。
```

**验收（2026-09-12）**：`fix/local-agent-dsh-session-v3`（`b35dee4`）合入 main `590c7b0`，只动 local-agent-dsh；合并态 146 测试全绿。两处判断都接受：不 import 宿主的 `parseSessionFormatLogFilename`、把正则重述一遍并写明出处——为读一个文件名新增宿主依赖会让插件在早于该模块的宿主上拒绝加载；`readSubDshEvents` 换成 `{events, log}`，树内一处调用一处测试，树外无人。选「版本号最高」而不是 mtime 或字典序，两条夹具（迁移过的 store 留旧代次、v10 对 v2）钉住。Agent Note：`.agents/notes/implemented/bug-fix/2026-09-11-dsh-session-log-generation.md`。

### T29d · eval：job 起的 run 走容器路径；起格前出网自检（已完成，2026-09-12 验收）

```text
# 任务 T29d：dsh-eval——job 起的 run 能走容器路径；容器路径起格前做一次出网自检

## 背景
T29c 回归：job 造的父会话没有 cwd，容器条件的就绪检查报 the parent session has no working directory to run the CLI in，本轮容器格只能用 T20c 那种进程内驱动跑；同一轮还发现单元断网时（eval-net 是 internal，边车 eval-proxy / eval-registry 停了）codex 在单元里正常起来、230 秒后 task_complete 交回空回答，没有任何一句网络错误——四分钟空转会在每一格重演。

## 先读
packages/eval/src/run.ts（job 路径造父会话的位置、readiness 的 unitFor 与 probeIn、容器路径的 acquire → populate 顺序）、readiness.ts、slash.ts 的 job 启动；packages/lab 的 verify 动词；题库 env/README.md（eval-net、边车、白名单代理地址）；T29b / T20c / T22 的 Agent Note。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-job-container，分支 fix/eval-job-container-path，只改 packages/eval（README 双语 + sidecar）。

## 已定决定
- job 路径的父会话带上工作目录（与 --wait 路径同一个取值，run 的 cell 根目录），容器条件与宿主条件的就绪检查都能起 CLI；测试钉住 job 起的 run 在两条路径上就绪原文相同。
- 出网自检：容器路径 acquire 之后、populate 之前，经 lab.verify 在单元里对白名单代理跑一次最小连通检查（命令与目标从计划 unit 段或题库 env 层读，不写死地址）；失败按基础设施故障记 EGRESS_UNAVAILABLE 并拒绝整个 run，不进入委派；就绪窗口默认值提到能装下镜像冷启动加首次 exec（T29c 实测 420 秒够），可配置。
- 不改 lab、local-agent。

## 交付 / 完成判据
eval 测试全绿，gate 绿；真机（3171，边车在）：/eval run 起 job 的 P0 × codex 容器一格到 released；把 eval-proxy 停掉再起一次，run 在自检处被拒且原文点名代理。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；两次真机的原文。
```

**验收（2026-09-12）**：`fix/eval-job-container-path`（`6821eb8`、`550ac70`）合入 main `e5649df`，sidecar 重录；合并态 eval 461 全绿。与文案不同的两处都接受：畸形声明分两层挡（类型错由 PLAN_SCHEMA，`command: []` 或含空词由 run 层的 EGRESS_CHECK_MALFORMED——契约子集没有 minItems）；消息里条件名只留一次。文案说「只改 packages/eval」，分支还动了 `docs/dataset-authoring-protocol` 双语——计划契约加了 `unit.egressCheck`，协议 §6 与说明本该跟着动，协调者补了版本号 v1-rev11。出网自检的命令与目标由计划声明（题库 `plans/t29d-container-egress.json` 打 codex 自己要打的主机、经镜像里烧的代理），编排器不持有地址；就绪窗口缺省 420 秒是实测值不是垫的。真机两跑的原文在回报里：一次到 released，一次秒级 EGRESS_UNAVAILABLE 点名 eval-proxy——对照 T29c 那次 230 秒空回答。顺带发现两件归 T33a：capability-catalog 量不了 `eval` 预设（persona `text` → `prefix`）；启动器吞 stdout 让看门狗证不到就绪。Agent Note：`.agents/notes/implemented/bug-fix/2026-09-12-eval-job-container-path.md`。

### T32b · eval：provision 在实例内接 capability-catalog 填能力哈希（已完成，2026-09-12 验收）

```text
# 任务 T32b：dsh-eval——/eval conditions provision 在实例内取 preset 的能力哈希写进 lock

## 背景
T32 把能力哈希的实测留成 ProvisionOptions.capabilities 钩子：没钩子时 lock 不带能力记录并报 CAPABILITIES_UNMEASURED，就绪检查再拒一次。今天没有任何路径接这个钩子，带 preset 的条件进不了 ready，pilot D 起不了。capability-catalog 已有 snapshotFor(presetId) 与 hashOf，服务面在 ctx 上；eval 不 import 兄弟包，按既有做法用结构面经 ctx 服务查找。

## 先读
packages/eval/src/service.ts（provision 的入口与 ProvisionOptions）、faces.ts（现有四个面的写法）、slash.ts；packages/capability-catalog/src/index.ts（snapshotFor / hashOf 的签名与 scope 解析）；packages/local-agent-dsh/src/provision.ts（子 profile 的 preset roster 在哪、preset id 怎么命名）；T31 / T32 的 Agent Note。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-caps-wire，分支 feat/eval-provision-capabilities，只改 packages/eval（README 双语 + sidecar）。

## 已定决定
- faces.ts 加 CapabilityCatalogFace { snapshotFor(presetId), hashOf(snapshot) }，经 hosts.get('capabilityCatalog') 取，缺席时 provision 照旧报 CAPABILITIES_UNMEASURED。
- /eval conditions provision 对 preset 非 null 的条件：按该条件 scope 的子 profile 解析 preset id，取快照算哈希填 ProvisionOptions.capabilities；lock 的 provisioned.capabilities 与就绪检查的核对沿用 T32。
- CLI 路径照旧拒绝（进程外没有服务面）。

## 交付 / 完成判据
eval 测试全绿，gate 绿；真机：本机 dsh 两个只差 preset 的 scope 各 provision 一次，lock 里两个不同的 caps 哈希，validate 报 ready；改一个技能正文再 provision，哈希变、旧 lock 报 unready。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；两份 lock（脱敏）与 validate 原文。
```

**验收（2026-09-12）**：`feat/eval-provision-capabilities`（`4aabf3d`…`cbd0a9e`）合入 main `376838f`，只动 packages/eval；合并态 eval 461 全绿。三件裁决：一、validate 对过期 lock 仍报 ready——接受。validate 是离线的，量不了；新鲜度只能在有 catalog 的地方比，就绪检查正是 run 起来时真正要拦住东西的那处。要让 validate / `conditions list` 也看得见，得给读动词各配一次实例内测量，另立任务、暂不排。二、两处超出文案都收：就绪再量一次——只填钩子的话写下的哈希永远没人再比，改技能正文又不动 home.sha，等于白记；T32 遗留的探针拒测只 log 不进报告，与同文件契约矛盾，现在与抛错同样进 CAPABILITIES_UNMEASURED。三、量的是实例这份 composition 里的那张面而不是子 dsh 自己那份——沿用文案；守卫（scope 自带 preset 副本即拒并给修法）是这个折中站得住的前提。`provisioned.preset` 是从子 profile 读回的，不是声明的复制。真机（私有工具链，catalog 用本分支 tarball）：两 scope 两哈希、改技能正文旧 lock 报「preset changed after provision」且零委派、重 provision 后哈希变、就绪过。Agent Note：`.agents/notes/implemented/feature/2026-09-12-eval-provision-capability-probe.md`。

### T33a · 运维：3171 回到 ankh-guard 守着的健康态，重装到合并态 main（已完成，2026-09-12 验收）

```text
# 任务 T33a：3171——看门狗证得到就绪、插件更新到 main 376838f、eval 预设能被量

## 背景
2026-09-12 T29d 交回 3171 时看门狗没证到就绪：启动器 ~/.dsh-lab/bin/eval-launch.mjs 为了不让 token 进日志把子进程 stdout 整个吞掉（只写脱敏副本到 state/eval-instance.log），而 ankh-guard 的看门狗靠子进程 stdout 里的启动 URL 做 303 交换来证「application readiness」（watchdog.log：transport up (HTTP 401); application readiness still pending → readiness not proven within 60s），四次失败后回滚 credentialRepo（到 47ac944，无变化，留了 guard-backup-20260911-170315-q4ec 分支）并在 3171 上挂兜底页（boot-attempt.log 0 字节）。另外两件：T30d / T29d / T32b 已合入 main（376838f），3171 上装的还是 T29c 时的 tarball；capability-catalog 在 3171 上量不了 eval 预设——persona 行在 0.1.5 线的配置键是 prefix，本 profile 的 presets/eval/agent.cordis.yml 原来写的是 0.1.2 线的 text，main 已改正，要随重装落到实例。

## 先读
~/.dsh-lab/state/watchdog.log 与 eval-instance.log（脱敏后再看）；ankh-guard 的 dsh-watchdog.sh 里「Readiness has two layers」那一段与 redact_launch_urls_in_output（看门狗自己在 attempt log 里脱敏）；docs/host-migration-playbook.md 阶段 3（guard 的 configure-launch / re-adopt）；profiles/web-eval/scripts/update.sh 与 install.sh 的头注释；T29c、T29d 的 Agent Note。

## 步骤
1. 启动器：把子进程的原始 stdout / stderr 原样透传到自己的 stdout，token 仍只写 0600 文件、本地日志副本仍脱敏——看门狗的 attempt log 由它自己脱敏。改前留备份。
2. 给看门狗发 SIGUSR1（pid 见 watchdog.log 最后一行「send SIGUSR1 to <pid>」），看 watchdog.log 出现「instance ready on :3171 (authenticated launch URL …)」与 canary PASS；贴这两行。
3. 重装到合并态：源码模式装的实例**不跑 update.sh**——它会把安装副本的 file:tarballs 清单、pnpm-workspace 的 overrides 与 lockfile 覆盖回模板的 npm 范围，随后 plugin install 就去 npm 拉 @khorsheed（README「更新」节明写源码模式实例用重跑 install.sh --source 代替）。先按 ankh-guard 的方式停实例（看门狗在守，用它的停法而不是 kill），再 `DSH_HOME=~/.dsh-lab sh profiles/web-eval/scripts/install.sh --source <主检出> --fresh`：--fresh 先清 node_modules / lockfile / tarballs，从 main 376838f 逐个构建并打全部成员的 tarball，预设与 cordis.patch.yml 整目录覆盖（persona 修正随之落地），分钟级；装完经看门狗起实例。--dump-config 核对：成员 27（M4'③ 把 mission / datasets / eval 拆成 core + companion，pack 多了 mission-tool / datasets-tool / eval-tool 三个伴生包，24 → 27，三个都在 install.sh 的源码打包名单里）；pin 不变（codex danger-full-access、三行委派工具 tools: none、dsh 的 headlessBundleDir / cliLaunch）；三个 core 行不再带 tools，按域 tier 挂在 eval 预设的三行上（mission-tool: read、datasets-tool: authoring、eval-tool: all）。
4. 验四件：/eval run 任一计划的 run.meta.orchestrator 带 capabilities（persona 修正生效，不再报 $.prefix missing）；dsh 一轮最小委派回读到 observedModel / usage / toolCalls（T30d）；plans/t29d-container-egress.json 再跑一次到 released（T29d 在新 tarball 上仍通）；M4'③ 第一次落到 web-eval 实例——eval 预设的会话看得到三套模型工具，走别的预设的会话一套都看不到，任务 / 数据集两个标签页按同一判据自隐（服务 / CLI / slash 仍全局，pilot 的 /eval run 不受影响）。
5. guard 的 credentialRepo 仍指向 T29c 的 worktree ../dsh-plugins-wt-eval-host-line：要不要 re-adopt 到主检出，在回报里提出方案，由协调者放行；没放行前那个 worktree 不删。上次 configure-launch 没带 DSH_HOME，spec 写进了主检出的 .dsh-guard-state/（CLI 的兜底目录 <cwd>/.dsh-guard-state），看门狗读的是 ~/.dsh-lab/state 那份，所以「改不动」其实是改错了地方；重做时带 DSH_HOME=~/.dsh-lab（或显式 --state-dir），成功后把主检出那个目录删掉。

## 约束
不碰 ~/.dsh-official 与 3080；token 不进日志、回报、提交；只改启动器与实例，不改仓库代码；共享资源（看门狗、实例进程、边车）动之前先在回报里写明动了什么。

## 完成判据
watchdog.log 里 instance ready + canary PASS；3171 上 27 个 @khorsheed 成员与 main 一致（376838f 之后只有文档提交，代码相同）；第 4 步四件各有原文。

## 回报
watchdog.log 的就绪与 canary 两行；install.sh 与 --dump-config 输出；第 4 步四件的原文；credentialRepo 的建议。
```

**验收（2026-09-12）**：判据两行齐（02:57 instance ready、03:00 canary PASS），boot-attempt.log 227 字节、0600、无明文 token、有脱敏标记，give-up 标记已清，3171 回登录墙而不是兜底页；27 个 @khorsheed 成员在 node_modules，零 npm；四项 pin 与三个 core 行的形状按 M4'③；四件核验原文在回报里。第 3 步与判据经两次补充文案修正（update.sh → install.sh --source --fresh；成员 24 → 27）。credentialRepo 的放行见下：

```text
# T33a 放行（2026-09-12）：credentialRepo 切到专用 worktree，不切主检出

不放行「--repo 指主检出」：看门狗连续两次起不来会对 credentialRepo 做 git reset --hard（先留 guard-backup-* 锚点），主检出是多 agent 共享工作区，不能让看门狗有权清空别人的未提交改动。改为：

1. 从 main 开 worktree ../dsh-plugins-wt-eval-guard，分支 guard/eval-3171，HEAD 就是这次装的 b7fb020。它只作 guard 的部署锚点：不在上面开发、不开分支；以后每次重装 3171，把它 fast-forward 到装的那个 commit（写进以后重装的步骤）。
2. configure-launch 按你的参数，只把 --repo 换成那个 worktree 的绝对路径：DSH_HOME=~/.dsh-lab、--port 3171、--start 指 ~/.dsh-lab/bin/eval-launch.mjs、--home ~/.dsh-lab、--state-dir ~/.dsh-lab/state、--harness-root 与 --preflight-install-anchor 指 rc-0.1.5-rc.1 工具链、--profile web-eval、--preflight-surface built。不带 --if-absent。
3. 让新 spec 生效：WD_REPO 是 supervise 启动时读进环境的，要么走 reconfigure 在线切换，要么经 guard 通道重启实例让插件重新 supervise——两条路你选，回报里写清用了哪条。重新 supervise 时从稳定的目录起（例如 ~/.dsh-lab），现在的看门狗 cwd 是已删的 T29d worktree，重启路径上已冒出 uv_cwd ENOENT。
4. 验：watchdog.log 再出一次 instance ready + canary PASS，且 deployment proof 从 FAIL 变 PASS（有了 preflight 绑定）；贴三行。
5. 成功后删两样：主检出根目录的 .dsh-guard-state/（上次没带 DSH_HOME 写错地方的那份）；T29c 的 worktree ../dsh-plugins-wt-eval-host-line 与分支 chore/eval-family-host-0.1.5（已合并）——这两样删之前在回报里点名。

约束照旧：不碰 ~/.dsh-official 与 3080；token 不进日志、回报、提交；动看门狗与实例进程在回报里写明。
```

**re-adopt 结果（2026-09-12）**：第 1、2、5 步按放行做成；第 3 步两条给定的路都被 ankh-guard 拒（reconfigure 撞悬空软链、takeover-from 缺 start token），实施者改走 SIGTERM 旧看门狗 + 从 ~/.dsh-lab 起新 supervise，停机 33 秒，接受；第 4 步两行 PASS、deployment proof 因 harnessRoot 不是 git 检出证不出（ankh-guard 的限制，见 §二「交 ankh-guard 线」）。实施者停在删除前点名，协调者自己删了 T29c worktree、chore/eval-family-host-0.1.5、guard-backup-20260911-170315-q4ec 与主检出的 .dsh-guard-state/。悬空软链 `@types/react` 留着不动：它是 sub-dsh scoped home 的一部分，pilot D 用的是新开的命名 scope，不受影响。

### T33d · 代码：四个 CLI 的入口守卫 realpath 后再比（已完成，2026-09-17 验收）

```text
# 任务 T33d：eval / mission / datasets / lab——CLI 入口守卫经 .bin 软链调用时静默空跑

## 背景
四个包的 src/cli.ts 都用同一句判「是不是被当作入口执行」：process.argv[1] 转 file URL 后与 import.meta.url 比。Node 会把 ESM 主模块 realpath，argv[1] 不会——经 pnpm 的 .bin 软链（或任何软链路径）调用时两者永不相等，主体不执行、退出码 0、零输出。T33a 在 3171 上实测到：dsh-eval / dsh-mission 从 PATH 上调都是空跑，要用真路径 node …/lib/cli.js 才动。后果不止不便：packages/lab 的 CLI 路径（cli-core.ts）把 dsh-mission is-releasable 的退出码当释放闸（0 / 1，其它 fail closed），空跑的 0 会被读成「可释放」。

## 先读
packages/eval/src/cli.ts、packages/mission/src/cli.ts、packages/datasets/src/cli.ts、packages/lab/src/cli.ts 顶部的守卫（各约 16–18 行、datasets 在 254 行）；packages/lab/src/cli-core.ts 的 Mission integration 注释与 is-releasable 那段；四个包各自的 cli 测试。

## 分支
从 main 开 worktree ../dsh-plugins-wt-cli-entry-guard，分支 fix/cli-entry-guard-realpath，只改这四个包（各自 README 若提到 CLI 入口就补一句 + sidecar）。

## 已定决定
- 守卫改为对 argv[1] 做 realpathSync（失败即按原字符串）再转 URL 比对；import.meta.url 一侧不动。四处同一改法，各自留一句注释说明为什么要 realpath。
- 不改 lab 的闸语义（0 / 1 / 其它 fail closed 是对的），只让 dsh-mission 真的执行。
- 每包一条测试：经软链路径 spawn 出的 CLI 有输出、退出码来自主体；直连路径行为不变。

## 约束
不碰 3080 与 ~/.dsh-official；不改四个包的其它逻辑；不改 profile。

## 完成判据
四包测试全绿，gate 绿；本机用 pnpm .bin 软链调 dsh-eval --help 与 dsh-mission --help 各有输出。

## 回报
分支名与 commit；Agent Note 路径（bug-fix）；gate 输出；软链调用前后的原文各一行。
```

### T33b · 运维：pilot B（dsh × 两模型）与 pilot C（claude × 两模型）（可发，依赖 T33a）

```text
# 任务 T33b：pilot B / C——同 harness 两模型的配对结果，P0 先证机制，真题预算先报

## 背景
I4 的目标是「同 harness 两条件的配对结果」。机制已齐：条件的 model.declared 按次委派（T30b）、回读核对（T30d 修好 dsh 的一侧）、每格由谁判进报告（T31）、job 门起 run 走容器路径且起格前出网自检（T29d）。3171 已在合并态 main 上（T33a）。本任务只跑 P0-placeholder 证机制与配对形状，真题（F2-multi-agent-room / F3-self-restart-report）先报预算、等放行再跑。

## 先读
题库 docs/pilot-b-log.md（I3 的 pilot B——四家同一题；与本任务的「pilot B」重名，别混）、plans/t29d-container-egress.json（unit 段与 egressCheck 的写法）、conditions/dsh-exec.json、claude-exec.json、t31-judge-other.json、t31-judge-twin.json、env/README.md 的代理与白名单表；packages/eval README 的报告节（配对、判官归属、效率表）；T30b / T30d / T31 / T29d 的 Agent Note。

## 分支
题库从 i1-walk 开 worktree，分支 i4-pilots；记录写 docs/i4-pilots-log.md（新建）。dsh-plugins 不改代码；发现缺陷只记不修。

## 已定决定
- pilot B：从 dsh-exec 复制两条条件 dsh-v4-flash、dsh-v4-pro，只差 model.declared（deepseek-official/deepseek-v4-flash / deepseek-official/deepseek-v4-pro），harness.version 写 3171 实际的 cliVersion（0.1.5-rc.1），scope 都留 null；判官用 t31-judge-other（claude haiku，非 dsh，不出自评格）。
- pilot C：从 claude-exec 复制两条，只差 model.declared——一个是本机 /claude status 报的 effectiveSettings.model，另一个是账号能跑的第二个型号（判官条件里那个 claude-haiku-4-5-20251001 可以直接用）；判官用 t31-judge-twin（codex）。judge-dsh-v4-pro 目前 model.declared 写的是 v4-flash、与名字不符，顺手改正并在日志里点名，本任务不用它。
- 两份计划都走容器路径：unit 段抄 t29d-container-egress.json，egressCheck 的目标改成该家 CLI 自己要打的主机（题库 env 层的白名单表），reps 1、stages stage1 + stage2、items 只有 P0-placeholder；从 /eval run（job 门）起，就绪窗口缺省 420 秒。
- 每份计划跑完各交：报告的比较节（两格同 harness 只差模型、条件 diff 只报 model）、四条不变量、第三条不变量两格都以回读核对（observedModel 等于各自声明）、效率表两格 token 与工具调用有数、判官归属列、usage.jsonl。
- 预算：从这两跑的 usage.jsonl 与 pilot-b-log 里 F2 / F3 的历史用量，各估一份「真题 × 两条件 × 2 rep + 判官双采样」的 token 与时长，写进日志的「预算」节，停在这里等放行。

## 约束
不碰 ~/.dsh-official 与 3080；凭据不复制、不进日志与回报；边车与实例进程要动先报；只跑 P0；题库写操作一律 worktree。收尾用 run --finalize，不要事后单跑 finalize（is-releasable 闸只在 archived → released 间开，事后单跑会把单元晾住只能 --force）；T33d 修好前 CLI 一律用真路径 node …/lib/cli.js 调，经 .bin 软链会静默空跑。

## 完成判据
两份 P0 配对报告各四条不变量 ✅、第三条两格都有回读；dsh 两格 token 列有数（T30d 之前是空的）；i4-pilots-log 有两节结果 + 一节预算；validate 0 error。

## 回报
题库分支与 commit；两份计划与新条件的路径；两份报告的比较节与不变量原文；预算表；发现的缺陷清单。
```

**补充（2026-09-12，选手容器轮就绪全败之后）**：

```text
# T33b 补充：这轮的钱怎么花——一次 codex 定性，然后停，出缺陷报告

1. 先跑一次 plans/t29d-container-egress.json（codex × P0 × 1 rep，约 4 分钟）：只为证明 T33a 换 supervisor 之后容器轮没有整体回归。通过记一行；失败就停下把原文发来，那是比 pilot 更优先的事故。
2. 不走宿主路径拿配对报告：报告只在四条不变量全 ok 时才开比较节（report.ts 的 comparisonAllowed），宿主轮没有环境指纹、那条是 unverifiable，比较节开不了，「两份配对报告 + 四条不变量」交不出来，多花四格委派换不到判据。
3. 不再在容器轮试 dsh / claude：根因在你查到的上一层——eval-env:pinned 是 9/8 建的，dsh 闭包是旧线、headless 包 ARG 是 0.1.0-rc.6，宿主 9/11 切到 0.1.5 后镜像没跟着动（T29c 第 5 项与 T29d 只用 codex 验容器轮，codex 不用镜像里的 dsh）。镜像重建立了 T33e；你查到的 scoped home 两侧路径混用是第二层，立了 T33f（先方案）。
4. 然后停，交缺陷报告（你选项 4 的清单）：题库 worktree / 分支、四条新条件、两份计划（validate 0 error）、判官侧按次模型证据、dsh 根因（两套链的计数与日期写进去）、claude 的就绪原文与已排除项、基于历史用量的预算表。日志写 docs/i4-pilots-log.md，标「容器轮待 T33e / T33f 后重跑」。judge-dsh-v4-pro 的 model.declared 改正照旧。
```

**验收（2026-09-17）**：`fix/cli-entry-guard-realpath`（`9ba18711`、`4e25c6ed`）合入 main `a526d55b`。软链调用修前修后原文齐（修前 exit 0 零输出，修后 usage）；四包测试与 gate --all 全绿。Agent Note：`.agents/notes/implemented/bug-fix/2026-09-17-cli-entry-guard-realpath.md`。

### T33c · 运维：pilot D（sub-dsh × 两 preset，同工具不同技能）（受阻收口，2026-09-17；机制缺口立 T65，pilot D 随 T65 收）

**补充（2026-09-17）**：

```text
# T33c 补充：pilot D 一次 P0，只跑一次（与原文案冲突处以本段为准）

1. 前置已满足：3171 在 b97a6338（2026-09-17 由 T62 线重装，含 T58 / T59 / T33d / T55）；不自己动 3171 的停起。不与 T55 的探针同时跑（同一实例、同一 docker），等它那一轮释放后再起。
2. 两条 sub-dsh 条件（同工具、不同 preset / 技能，dsh-lean / dsh-full 从 dsh-exec 复制）各填容器专用命名 scope；dsh 走 API key，命名 scope 不需要登录——原文案「各自 device-auth 登录」作废。T58 起 provision 会把实测 home.sha 写回条件文档并写 lock，每条 provision 一次即 ready，不再手抄哈希；endpoint 必填（从 dsh-exec 复制即带 default）。
3. 计划带 unit 段（抄 T39 那次的容器计划），P0 × 1 rep，走容器路径；跑中 docker ps -a 核单元容器在、跑后归零。finalize 是缺省（T57），不带 --keep-units 即可——原文案「run --finalize」作废（该开关现在接受但无作用）。
4. 交：两 scope 各自 provision 的 lock、两条件 caps 哈希不同而环境一致、四条不变量、比较节；「改技能正文不重 provision 就起 run」那一步照原文案做（就绪处被拒不花 token，重 provision 后通过）。这是 I4 三条判据里唯一没在真机 run 上证过的，过了即收，不重跑。原文案的「预算」一节不用再做（T33b 已估过，真题预算等上线后定）。
5. 原文案里 T33d 那条「CLI 用真路径调」已随 T33d 合入作废，经 .bin 调用即可。
6. 题库改动走自己的 worktree、从 i1-walk 开分支，不碰别人的计划与条件；日志接 docs/i4-pilots-log.md；缺陷只记不修。通用提醒照旧。
```


```text
# 任务 T33c：pilot D——sub-dsh 两个只差 preset 的条件，两 caps 哈希，P0 一轮

## 背景
T32 把 preset 变成可核对的因子（lock 的 provisioned.capabilities），T32b 接上了实测：/eval conditions provision 在实例内读回 scope 子 profile 实际 roster 的 preset、核对与实例的 preset 根指向同一目录、snapshotFor 出哈希；就绪检查再量一次，过期 lock 拒。sub-dsh 上 preset 只能加不能减（dsh-base 的工具挂在 profile 根），所以 pilot D 的口径是「同工具 + 不同技能」。T32b 真机用的 eval-lean / eval-full 两个 preset 在 ~/.dsh/scratch/t32b 留着（工具链已删），可以直接搬。3171 已在合并态 main 上、eval 预设能被量（T33a）。

## 先读
T32 与 T32b 的 Agent Note（哈希的规范形、量的是哪张面、守卫）；packages/eval/src/capability-probe.ts 的模块注释；packages/local-agent-dsh/src/provision.ts（子 profile 的 roster 怎么写、roots 指哪）；T29 的 Agent Note（命名 scope 的登录）；update.sh 头注释里 PRESET_IDS 与 $DSH_HOME/.agent-presets 的说明；T33b 的日志与计划写法。

## 分支
题库从 i1-walk 开 worktree（T33b 若已开 i4-pilots 就从它接着开），记录写 docs/i4-pilots-log.md 的 pilot D 一节；两个 preset 的目录内容（agent.cordis.yml、SKILL.md）抄进题库 env/presets/ 作为可复现的装置。dsh-plugins 不改代码。

## 已定决定
- 实例的 preset 根（3171 的 $DSH_HOME/.agent-presets）放 eval-lean 与 eval-full：行完全相同，只差 eval-full 多挂一个技能（SKILL.md 正文有实质内容）；两个 preset 是 pilot 装置，不进 profile 包。
- 两条条件 dsh-lean、dsh-full 从 dsh-exec 复制：scope 各自命名（d-lean / d-full），preset 各填其一，其余全同，model.declared 同一个（v4-flash）。命名 scope 各自 device-auth 登录，不复制凭据。子 profile 的 roots 指向实例的 preset 根（T32b 的守卫要求两边同一目录）。
- 各 /eval conditions provision 一次：两份 lock 的 provisioned.capabilities.sha 不同、preset 是读回值；conditions diff 只报 scope 与 preset；validate ready。
- 计划：容器路径、unit 段与 egressCheck 同 T33b 的 dsh 计划，items 只有 P0-placeholder，判官 t31-judge-other；从 job 门起。就绪检查那一步会再量一次哈希——贴原文。
- 交报告的比较节（条件 diff：scope、preset、caps 哈希）、四条不变量、第三条以回读核对、两格 token 有数、判官归属；再做一次「改技能正文不重 provision 就起 run」，就绪拒绝的原文贴上，然后重 provision 让它过。
- 预算：与 T33b 同法估真题一份，停在预算等放行。

## 约束
不碰 ~/.dsh-official 与 3080；凭据不复制、不进日志与回报；边车与实例进程要动先报；只跑 P0；不与 T33b 同时跑（同一实例、同一 docker）。收尾用 run --finalize，不要事后单跑 finalize；T33d 修好前 CLI 一律用真路径 node …/lib/cli.js 调，经 .bin 软链会静默空跑。

## 完成判据
两 lock 两哈希、P0 配对报告四条不变量 ✅、就绪拒绝与重 provision 的两段原文、i4-pilots-log 的 pilot D 节 + 预算、validate 0 error。

## 回报
题库分支与 commit；两份 lock（脱敏）与 conditions diff 原文；报告比较节与不变量；就绪拒绝原文；预算；缺陷清单。
```

### T33e · 环境：题集镜像上 0.1.5 线——dsh 闭包与 headless 包随宿主切换重建，四家容器就绪各过一次（已完成，2026-09-16 验收）

```text
# 任务 T33e：eval-env:pinned 上 0.1.5 线

## 背景
eval-env:pinned 是 2026-09-08（I3·T16）建的：dsh 闭包由 env/mk-dsh-closure.mjs 从当时的 harness 检出打出（0.1.1-rc.2 线），headless 包 ARG DSH_HEADLESS_VERSION=0.1.0-rc.6 从本地包镜像装。9/11 宿主切到 0.1.5-rc.1 后镜像没跟着动——T29c 回归第 5 项与 T29d 只用 codex 验容器轮，codex 不用镜像里的 dsh，所以没暴露。T33b 起 pilot B/C 时 dsh 与 claude 在容器轮就绪全败：dsh 的 scoped home 由 0.1.5 线的 local-agent-dsh 写，容器里跑的却是旧线 dsh + 旧 headless；claude 未定根因。镜像不上新线，pilot B/C/D 的容器轮都起不来。

## 先读
题库 env/README.md、env/Dockerfile、env/build.sh、env/mk-dsh-closure.mjs、env/net/*（本地包镜像 eval-registry 与代理）、docs/i3-env-log.md（G1 基础镜像 digest、G6 非 root 下包镜像被绕过、G7 dsh 在 Linux 上的路、G10 两个 codex、G12 可复现性）；profiles/web-eval/cordis.patch.yml 里 headlessBundleDir 与 cliLaunch 两段注释；T33b 的缺陷报告；T29c 的 Agent Note（宿主线与 npm 风控）。

## 分支
题库从 i1-walk 开 worktree，分支 i4-env-0.1.5；改 env/ 与 docs/i4-pilots-log.md（新一节）。dsh-plugins 不改代码。

## 已定决定
- dsh 闭包从 ~/.dsh-toolchains/rc-0.1.5-rc.1 打（npm 装的 @deepseek-ai/dsh@0.1.5-rc.1），不再从 harness 源码检出打；闭包脚本若只认源码布局就改脚本，改动进题库。
- headless 包不从 npm 拉（风控，且 0.1.5 对齐版本未发）：从主检出 main 源码模式打 tarball（install.sh 已会打，取它产出的 dsh-local-agent-dsh-headless tgz）喂给镜像的 COPY dsh-headless.tgz；ARG DSH_HEADLESS_VERSION 改为记 tarball 的 sha。
- 三家 CLI 版本 ARG 与宿主上的一致（宿主 /codex /claude /kimi status 报的 cliVersion），差了就一起提到宿主的版本——两边同版本是容器轮公平的前提。
- 镜像仍推 eval-registry / 本地 docker，tag eval-env:pinned 不变，digest 写进 env/versions.lock 与日志；基础镜像三个 digest 不动。
- 验：t29c-four-harness-readiness.json 在容器轮跑一次就绪（只到就绪，不委派整格；四家各一次探针委派）。dsh 与 claude 必须 ready，kimi 配额不可用就记原文。dsh 的就绪用一个只在容器里用的新命名 scope（c-probe，device-auth 登录），不用宿主用过的默认 scope（T33f 落地前两侧共用一个 scope 必混）。claude 若仍不就绪，把就绪原文与容器内 credentialState 贴出来，不猜。

## 约束
不碰 ~/.dsh-official 与 3080；凭据不复制、不进镜像、不进日志；构建期的包镜像与代理是共享边车，要动先报；不从 npm 拉任何 @khorsheed 包；只跑就绪，不跑整格。

## 完成判据
新 digest 落 lock 与日志；四家（或三家 + kimi 原文）容器就绪 ready；镜像里 dsh --version 报 0.1.5-rc.1；validate 0 error。

## 回报
题库分支与 commit；docker build 关键行（脱敏）；四家就绪原文；镜像内 dsh / codex / claude / kimi 版本表；claude 结论。
```

**验收（2026-09-16）**：题库 `i4-env-0.1.5`（`a08b7f0`、`8688f61`、`2414fa7`）并入 i1-walk `0cd3f7b`。镜像内版本表四家与宿主逐项相等；四家就绪原文：codex NOT READY（stopReason error）、claude NOT READY（凭据被清空）、kimi ready、dsh ready（63.3 s）。两条没做到的接受：dsh 没用 c-probe——条件的 `scope` 字段（T29）可以指定命名 scope，下次直接填；四条件无 lock——provision 要会话里的 slash，归 T33b 复跑时做。日志在题库 docs/i4-pilots-log.md。

**T33b 补充二（2026-09-16）**：

```text
# T33b 补充二：容器版先跑 pilot B（dsh × 两模型），C 等 T55

镜像已上 0.1.5 线（i1-walk 0cd3f7b），dsh 容器轮就绪通过。前置：人先在 3171 上重登 claude（/claude-code login）与 codex（/codex login）；3171 由看门狗守着，插件仍是 b7fb020 那份——本轮不重装。

1. pilot B：两条 dsh 条件（v4-flash / v4-pro，harness.version 0.1.5-rc.1）各填 scope: c-flash / c-pro（T29 的字段，dsh 不需要人工授权），会话里 /eval conditions provision 两条写 lock；计划带 unit 段（抄 t29d-container-egress.json，出网目标改 dsh 的端点主机），P0 × 1 rep；跑前 docker ps -a 核单元容器在，跑完贴四条不变量与配对报告。
2. pilot C（claude × 两模型）不跑，等 T55；宿主轮也不跑（比较节不开）。
3. 预算一节照旧：从这一跑的 usage.jsonl 估真题，停在预算等放行。
4. 日志接着写 docs/i4-pilots-log.md；缺陷只记不修。通用提醒照旧。
```

**受阻收口（2026-09-17）**：实施者给了四条路（宿主轮跑一次拿三条 / 就此收住 / 装置绕法 / 先修机制），协调者选「就此收住」：宿主路径比较节永远不开、P0 占位题碰不到技能，多跑只多两格 token；装置绕法会让 caps 哈希量的（实例根那份）与容器里跑的（scope 那份）不是同一份，结论失真；修机制违反「缺陷只记不修」，另立 T65。已有证据（两份 lock、两哈希、diff、就绪拒绝、容器内根因、单元起落）写进题库 docs/i4-pilots-log.md pilot D 节，题库分支由协调者并入 i1-walk。

### T65 · 容器轮里 sub-dsh 要能解析 preset——pilot D 受阻的机制修复（已完成，2026-09-18 两步验收；3171 重装见补充（二））

```text
# 任务 T65：容器轮里 sub-dsh 要能解析 preset——先方案（2026-09-18 改写）

## 背景
T33c（pilot D）在容器轮上被顶住：两条只差 preset 的 sub-dsh 条件在容器里解析不到 preset。表面原因是子 profile roster 的 roots 指向宿主的 preset 根（$DSH_HOME/.agent-presets），单元只挂 scope 目录；但根子不在 roster——local-agent-dsh 的 roster 缺省就扫 `<scoped home>/.agent-presets`（provision.ts 的注释原话：往那里放一个 preset 目录就是 scope 自己的 preset），宿主与单元都读得到，因为 scope 目录两侧就是同一个目录。真正把 roots 逼向实例根的是 T32b 的守卫 `scopeDefersToInstancePresets`（packages/eval/src/capability-probe.ts）：scope 里若有自己的 `<scope>/.agent-presets/<id>` 就拒绝量哈希，理由是「scope 的副本与实例根的副本不同就会量错」。守卫防的是漂移，代价是 preset 因子在容器轮走不通。结果是「preset / 技能作为因子」在产品里没有一条能打开比较的路径（宿主轮环境指纹 unverifiable、比较节不开）。

两件新情况：① preset 已正本化（2026-09-18，`6b8a919a`）：3080 的名册从 git 正本经 sync-presets.sh 同步，dsh-eval 组合跟 web-eval pack 的 eval preset，3171 的实例根由 pack 安装写入——实例根是部署副本，正本在仓库里；② pilot D 的两个 preset（题库 env/presets/eval-lean、eval-full）的 `customSkillDirs` 写的是实例根下的绝对路径（`<dshHome>/.agent-presets/<id>/skills`），任何把 preset 搬进 scope 的做法都得让这个路径在宿主与单元两侧都成立。

T33c 已拿到：两份 lock、两 caps 哈希（4/3 与 5/3 技能/工具）、conditions diff 三字段、就绪拒绝原文、容器内根因原文。

## 先读
T33c 的日志（题库 i1-walk 分支 docs/i4-pilots-log.md pilot D 节；只读用 git show，不 checkout）与题库 env/presets/ 下两个 preset 的原样；packages/local-agent-dsh/src/provision.ts（DshSubProfilePreset 的 roots / includeUserRoot 与注释、roster 行怎么写）；packages/eval/src/capability-probe.ts 全文（守卫、量哈希的路径、「silent-wrong-hash」那段）与 sub-profile.ts 的 readScopePreset；packages/eval/src/unit.ts（mounts 恰好一个）与 run.ts 挂载源；T32 / T32b 的 Agent Note；`6b8a919a` 与 profiles/web/scripts/sync-presets.sh（正本 → 实例根的规则）；T20c / T29 / T59 的 Agent Note。

## 分支
从 main 开 worktree ../dsh-plugins-wt-unit-preset-root，分支 fix/unit-preset-root。第一步只交方案（Agent Note 树 proposed/ 下一份，一屏摘要）；协调者定案后改 packages/eval 与 packages/local-agent-dsh（README 双语 + sidecar）。

## 方案要回答的
- 推荐路线（快照进 scope，先证伪它再谈别的）：provision 时把实例根那份 preset 逐字节快照到 `<scope>/.agent-presets/<id>`，roster 不再写 roots（回到缺省：扫 scope 自己的目录）；capability probe 改量 scope 那份——它才是宿主与单元实际跑的那份；T32b 守卫改语义：provision 时「快照 ≠ 实例根」即拒（漂移仍被抓住），就绪检查再量 scope 那份、与 lock 不符即拒（过期即重 provision，照旧）；lock 里除哈希再记来源（实例根路径 + 内容哈希，正本化后可加 pack 版本）。eval 的挂载一行不改。
- 必须回答 customSkillDirs：两个 preset 里是实例根下的绝对路径，快照后在宿主要指 `<scope>/.agent-presets/<id>/skills`、在单元里要指 `<unit.scopedHome.container>/.agent-presets/<id>/skills`，一个字面串两侧不可能都对。查 skill-filesystem / roster 认不认相对 preset 目录的路径或 `~` / DSH_HOME 展开；认就把快照改写成相对形式并把「preset 作因子必须用相对技能路径」写成规则（validate 拒绝绝对路径）；不认就写清是宿主线的活（交接项），并退到备选。
- 备选：单元再挂一个只读 bind——把实例的 preset 根挂到容器内同一绝对路径，roster 与 customSkillDirs 原样解析，T32b 守卫照旧；unit 段加可选字段或由 eval 从 dsh 门面读到实例根自动挂；preset 根只有 agent.cordis.yml 与 SKILL.md，不含凭据。代价：eval 的 mount 契约从「恰好一个」变成两个、环境指纹要记这条挂载；正本一搬家就失效。
- 其它你看到的。推荐哪个，为什么；宿主轮行为必须一字不变（非 preset 条件的 provision 逐字节不变）。

## 完成判据
方案定案后：eval / local-agent-dsh 测试全绿，gate 绿；3171 上 pilot D 的两条 sub-dsh 条件在容器轮 ready，就绪检查再量的 caps 哈希与 lock 一致，P0 一轮四条不变量 ✅、比较节打开——这一次就是 pilot D 的收口，由本任务顺手跑（不与 T55 的探针同时）。

## 回报
第一步：方案路径与一屏摘要。第二步：分支与 commit、Agent Note、gate、pilot D 报告的比较节与不变量、题库分支。通用提醒照旧。
```

**第一步验收（2026-09-18）**：方案 `.agents/notes/proposed/architecture/2026-09-18-sub-dsh-preset-in-scope.md`（`76946b2b`）合入 main `df8fe0fa`。推荐路线证实可行；customSkillDirs 有官方写法（`!!js` 用 baseUrl 解析，loader 以 with (ctx) 求值、Include 把 baseUrl 设成组合文件所在目录），备选挂载不再需要。两件要定的都定了：

**T65 补充（2026-09-18，第二步定案）**：

```text
# T65 补充：第二步按完整变体做

1. 重启地雷取完整变体：<scope>/sub-profile.json = {"preset": "<id>"}，解析序 显式参数 → scope 文件 → 插件 config，显式参数持久化；local-agent 注册表加 provisionScope(name, scope, {preset})，钩子签名放宽，另三家 provider 逐字节不变；eval 的 conditions provision 调用它。动三个包（eval、local-agent-dsh、local-agent），顺带把 pilot D 缺陷 1 修掉。
2. lock 记 capabilities.snapshot.sha（整棵快照的内容哈希，含 SKILL.md）+ source: scope-snapshot | instance-root，不记宿主路径；schema 走 v1-rev12，docs/dataset-authoring-protocol.md（中英 + sidecar）随本步一起改版本号与字段说明；就绪检查与 validate 都离线核这条哈希（顺手关掉 T32b 记下的「validate 把过期 lock 报成 ready」）。
3. 规则：作因子的 preset 组合里不得出现绝对路径，快照端与测量端都拒，原文说明用 !!js baseUrl 写法。
4. 题库（自己的 worktree、从 i1-walk 开）：env/presets/eval-lean、eval-full 的 customSkillDirs 改成 baseUrl 表达式；pilot D 计划的 dataset.repo 指到本次绑定的 worktree（T68 的坑，别再踩）；两条件重新 provision，home.sha 与条件哈希由写回记录，lock 走 rev12。
5. 收口：3171 装到合入后的 main（T63 线配方，先问 docker ps 没单元），pilot D 一次 P0 容器轮：两条件 ready、就绪再量的 snapshot.sha 与 lock 一致、四条不变量 ✓、比较节打开。过了 T33c 与 T65 一起收。
6. 回报：分支与 commit（插件 + 题库）、Agent Note（提案挪到 implemented/）、gate、pilot D 报告的比较节与不变量。通用提醒照旧。
```

**第二步验收（2026-09-18）**：`fix/unit-preset-root`（`4599ae89`）合入 main `a4880014`；题库 `i4-pilot-d-close`（`fd25670` / `07fde76` / `e487530` / `b2de42f`）并入 i1-walk `d9af6bc`。Agent Note：`.agents/notes/implemented/architecture/2026-09-18-sub-dsh-preset-in-scope.md`（按 implemented 骨架重写，加 Testing）。pilot D 收口原文、provision 三条预期、单元内只一个挂载的实证都齐；Δ 不作数的说明诚实，接受。gate 三次红都不是本改动（两次 ankh-guard supervise 泳道负载竞争、一次别的 worktree 留下的 test-admission 陈锁）。

**T65 补充（二）（2026-09-18，可发）**：

```text
# T65 补充（二）：3171 重装到合并后的 main

1. main 现在是 e70f62fe：含 T65 第二步 a4880014、T67 b2f0c7a5 与补充 e70f62fe、T55 第三步守卫 a672db2a、T63 补充（二）87b713ec——3171 现在跑的是你分支的 4599ae89，这些一个都没装上。按你上一次的配方装：git worktree add --detach ../dsh-plugins-wt-install-3171 e70f62fe → CI=true pnpm install --frozen-lockfile --prefer-offline → PATH 带工具链、DSH_HOME=~/.dsh-lab 下 install.sh --source <该 worktree> --fresh。装前看 docker ps 没单元、没探针在跑；装完删 worktree。
2. 停法照通用提醒：先 TERM 启动器那层，或放 stop marker 后等看门狗自己收；不要直接 TERM 看门狗（会留孤儿、端口占 60 秒）。
3. guard 锚点 guard/eval-3171 --ff-only 到 e70f62fe；checkpoint → clear → record deployment（--run -- dsh --profile web-eval --dump-config，DSH_HOME 已导出）；supervise 起，看 watchdog.log 的 instance ready。
4. 不碰 claude / codex / kimi 的登录；.agent-presets 你已按正本重同步，装完再核一眼 install.sh 只替换 eval 那个 id、eval-lean / eval-full 还在。
5. 装完顺手看一眼实验室 tab 打得开（列表 + 任一 run 的四个阶段），不要求截图。
6. 回报：装的 commit、就绪秒数、docker ps 前后、锚点 commit。通用提醒照旧。
```

**补充（二）验收（2026-09-18 18:46）**：3171 装到 `e70f62fe`（源码模式，24 个成员、177 行 patch、零 npm），13 秒就绪；docker 前后单元 0；锚点 `guard/eval-3171` ff 到 `e70f62fe`、checkpoint → clear → deployment 绿 → supervise；停法照通用提醒（marker + TERM 启动器层，孤儿 listener 单独 TERM，端口没占 60 秒）；PRESET_IDS 只含 eval，eval-lean / eval-full 原样；登录未碰。协调者核过 watchdog.log、锚点、docker、端口与装好的 lib。实施者没有浏览器，实验室 tab 走 Remote 动词验了数据路径；像素层由协调者临时实例（同一提交）复核过。

### T33f · 代码：local-agent-dsh——sub-dsh 的 scoped home 在宿主与单元两侧都成立（降为观察项，2026-09-16；文案保留）

```text
# 任务 T33f：sub-dsh 的 scoped home 两侧都成立——先方案，后改

## 背景
T33b 实测：dsh 的 scoped home 里 profiles/node_modules 有 260 条链指宿主工具链（9/11 宿主侧 dsh 愈合出来的）、232 条指容器里的 harness 检出（9/12 容器侧 dsh 愈合出来的），两套绝对路径混在一个目录里，哪一侧起 dsh 都有一半悬空。宿主自身对 profiles/node_modules 的愈合是「补缺不换错」：先被哪一侧碰过，另一侧就坏。而 provision / effectiveSettings / 就绪探针在宿主侧碰，委派在容器侧跑，同一个 scope 必然两侧都碰。profile 的 headlessBundleDir / cliLaunch 注释早写了这是同一个结构性问题（「scoped home 该不该自足，交回 local-agent 定」）。

## 先读
packages/local-agent-dsh/src/provision.ts（子 profile 与 bundle 链）、container.ts / index.ts 的 exec 挂载；profiles/web-eval/cordis.patch.yml 的 headlessBundleDir 与 cliLaunch 两段；T17 / T20c / T29 / T32 的 Agent Note；宿主对 profiles/node_modules 愈合的规则（工具链里 @deepseek-ai/dsh 的 profile loader）。

## 第一步：只出方案，不动代码
两页以内，给出 2–3 个候选并推荐一个，例如：(a) 子 profile 的行只经 bundle 链解析、不依赖愈合出来的 node_modules；(b) 宿主侧与容器侧各自一份 profiles 目录（同一个 scope，profile 路径按侧切换）；(c) 两侧把工具链挂到同一个中性绝对路径（镜像与宿主约定）。每个候选写清：改哪个包、对 T20c 的挂载面与 T32 的能力哈希有没有影响、两侧同版本怎么保证。协调者定了再做第二步。

## 分支（第二步）
从 main 开 worktree ../dsh-plugins-wt-dsh-scoped-home-sides，分支 fix/local-agent-dsh-scoped-home-sides，只改 local-agent-dsh（必要时 local-agent），README 双语 + sidecar，Agent Note。

## 完成判据（第二步）
同一个 scope 先在宿主侧 provision + 就绪探针、再在容器里委派一轮，两侧都 ready、容器轮回读到模型；反过来先容器后宿主也成立；pilot-a-round1 复算相同。

## 回报
第一步：方案文档路径与推荐。第二步：分支与 commit、Agent Note、gate、两个顺序的真机原文。
```

### I5 的文案

### T46 · eval 预设摘掉 mission-tool；eval-tool 加 eval_cells（已完成，2026-09-13 验收）

```text
# 任务 T46：eval 预设不再挂 mission-tool；eval-tool 补一个按格子读的工具

## 背景
界面规格（profiles/web-eval/docs/ui-spec.md）定了 R6：评测模式下 mission 这个词不出现，agent 看进度只用 eval-tool。今天 eval 预设挂着 mission-tool: read（四个只读工具），任务 tab 也因这一行显示。摘掉这一行，任务 tab 按 M4'③ 的规则自隐（packages/mission/src/client/preset-visibility.ts 判的是预设里有没有 @khorsheed/dsh-mission-tool 行）；agent 少四个工具，用 eval-tool 新加的 eval_cells 顶上。

## 先读
profiles/web-eval/presets/eval/agent.cordis.yml 末段三条伴生行；packages/eval-tool/src（三个读工具的注册与 tools: all | none 开关）；packages/eval/src/tool.ts 与 service.ts（eval_run_status 读的是什么、runStatus 的形状）；packages/mission/src/client/preset-visibility.ts；M4'③ 的 Agent Note；ui-spec §六。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-cells，分支 feat/eval-cells-tool；改 profiles/web-eval（预设 + README 双语 + sidecar + CHANGELOG）、packages/eval-tool、packages/eval（服务面加一个读投影）。不改 mission。

## 已定决定
- 预设删掉 mission-tool 那一行；datasets-tool: authoring 与 eval-tool: all 不动。
- eval 服务面加 cells(runId)：按 run 列格子投影——missionId、labels（task / condition / rep）、桶、当前阶段、attempt 数、时长、refs（resource / fingerprint）、检查点名、注解各命名空间计数、childSessionId（有就给）。数据经 hosts.get('mission') 的结构面算，前端与工具都不碰 mission。
- eval-tool 加 eval_cells 工具（只读，参数 runId，可选 bucket / task / condition 过滤），描述里说明它替代了 mission 的四个读工具；tools: all 现在是四个读工具。
- README「工具按域开放」表的 mission 行改成「eval 预设不挂；账本与释放闸仍由 mission 提供」；CHANGELOG 记一条。

## 完成判据
eval / eval-tool 测试全绿，gate 绿；本机 eval 预设会话：工具卡里没有 mission_*、有 eval_cells，任务 tab 不出现；standard 预设会话不受影响（任务 tab 仍在）。真机 3171 按 T33a 的方式重装后同样两条原文。

## 回报
分支名与 commit；Agent Note 路径；gate 输出；两个预设会话的工具清单与 tab 环原文。
```

**验收（2026-09-13）**：`feat/eval-cells-tool`（`39273ed4`，单提交，无 checkpoint 混入，锁文件未动）合入 main `42ab0ae3`，无冲突；合并态 eval 468、eval-tool 3 全绿，300 对双语同步，独立性 33 包 0 违规。实施者的一处更正接受：web-eval 里 standard 预设的会话自 M4'③ 起就没有 mission 工具与任务 tab（判据就是那一行），T46 对 standard 会话是零变化，文案里写的「任务 tab 仍在」不成立。两件没做的裁决：一、活实例的两条原文不单独补，并入 T35a 的真机步骤——T35a 本来就要在实例上看 tab 环；UI 切片的真机验证一律用**独立 DSH_HOME + 空闲端口的临时实例**（源码模式装 web-eval，不碰 3171 / 3080 / ~/.dsh-official / ~/.dsh），3171 只在切片合入后按 T33a 第 3 步重装。二、「不给 run_id 就列 run」不就地扩参数，等 T35a 的 runs 读面落地后给 eval_cells 加这一模式，列出来的只是评测的 run。顺带：3171 的看门狗在 9/12 03:40 之后收到 SIGTERM 退出（watchdog.log 末行 `Terminated: 15`），现在没人守也没实例，重起归下一个要用它的任务。Agent Note：`.agents/notes/implemented/feature/2026-09-13-eval-cells-tool.md`。

**验收（2026-09-13）**：`feat/eval-client-lab`（`78f76b86`）合入 main `7fff2efb`；判据全部有原文（临时实例 3199 的 tab 环、工具卡、列表 11 行、run 与草稿的概览页）。裁决见 §二「T46 / T35a 验收」。Agent Note：`.agents/notes/implemented/feature/2026-09-13-eval-client-lab.md`。

### T49 · 脚本：install.sh 的 family 边带版本（已完成，2026-09-14 验收）

```text
# 任务 T49：install.sh --source 适配 pack-dist 的 family-edge 规则

## 背景
scripts/pack-dist.ts 自 3406a471（9/12）起，--family 里作为 peer / dev 依赖边的成员必须写成 name=version（边按目标包的版本定范围），光名字只做改写。profiles/web-eval/scripts/install.sh 第 251 行仍把 @khorsheed 依赖名拼成光名字传过去，打到 local-agent-tool-subagent 时报 peerDependencies entry @khorsheed/dsh-local-agent is a family edge but no version was given for it，源码模式安装在 main 上就此不通。T35a 用一次性副本绕过验证了改法可行。

## 先读
scripts/pack-dist.ts 头注释与 parseFamilySpecs（--family 的两种写法）；profiles/web-eval/scripts/install.sh 第 236–258 行（NAMES / GEN_TYPERT_ONLY / 逐包 pack 的循环）与头注释；T29c 的 Agent Note（源码模式与 npm 风控）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-install-family，分支 fix/web-eval-install-family-version；只改 profiles/web-eval/scripts/install.sh（必要时 update.sh 同款）、CHANGELOG、README 安装节若提到 --family 的写法。

## 已定决定
- family 的每个 @khorsheed 成员都写成 name=version，版本从 $SOURCE/packages/*/package.json 扫出来（name → version 一张表，一次算好，循环里查）；没找到版本的名字保持光名字并打一行 warn。
- 不改 pack-dist；不改 UNPUBLISHED_DIRS 语义。

## 完成判据
用临时 DSH_HOME（不是 ~/.dsh / ~/.dsh-lab / ~/.dsh-official）跑 install.sh --source <主检出> --fresh 全程通过：27 个 tarball 打出、实例能起、--dump-config 成员 27；gate 绿（脚本改动会触发整仓）。

## 回报
分支与 commit；install.sh 的关键输出（打包那几行）；--dump-config 成员数；临时 DSH_HOME 已清。
```

### T36 · 实验室 › 计划审阅 + 条件页 + 「批准并启动」（已完成，2026-09-14 验收）

```text
# 任务 T36：实验室详情的计划审阅页、条件页，和人的「批准并启动」

## 背景
T35a 搭好了实验室 tab 的列表、详情壳与概览页，六个子页里计划审阅与条件页归本任务。界面规格（profiles/web-eval/docs/ui-spec.md §五）：计划审阅 = 快照 · 条件 · 题 · rep · 顺序 + validate 结果逐条 + 「批准并启动」与「退回修改」；条件页 = 条件列表与两条件 diff（只高亮不同项）、lock 与就绪状态；「选模型即新建条件」回到新建实验（T34，本任务占位）。R1：批准是人的动作，启动动词只给界面，不给模型工具。

## 先读
packages/eval/src/client/{LabView.tsx, store.ts, contract.ts}（T35a 的路由与 store）；packages/eval/src/remote.ts（runs / run 两个带 agent 的读 verb，runStart 不带 agent）；packages/eval/src/service.ts 的 validatePlan、conditions、provision；packages/eval/src/read.ts 与 cli-core.ts 里 conditions list / diff 的实现；packages/eval/src/slash.ts 的 /eval run 怎么把会话变成 initiator（cwd、parentSessionId）；T29b / T31 的 Agent Note；ui-spec §五、§七第 3–5 步。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-client-review，分支 feat/eval-client-review；只改 packages/eval（README 双语 + sidecar）。

## 已定决定
- Remote 新增带 agent 的 verb：plan(agent, { planPath })——plan 摘要 + validate 结果逐条（ok / warn / error，与 CLI 同一函数）；conditions(agent, { repo?, dataset? })——列表 + 每条的 lock 摘要与就绪态；conditionDiff(agent, { a, b })——只返回不同的键；approve(agent, { planPath })——先 validate，有 error 即拒绝不启动，否则以本会话为 initiator 调既有 runStart（cwd 取会话工作区，与 /eval run 同一取法），返回 job 与 run id。approve 不做模型工具。
- 计划审阅页：kv（快照、矩阵形状、因子、判官与采样数、环境）+ validate 列表 + 两个按钮；「退回修改」只在页面上记一段备注并把状态显示为草稿（不改文件）；批准成功后跳到该 run 的概览页，列表行从待批准变运行中。
- 条件页：表（条件、harness、model.declared、scope、preset、lock、就绪），选两条出 diff，不同项高亮；「新建条件」按钮占位归 T34。
- 就绪检查失败的原文（job 输出里 refused 段）在概览页已有，本任务在计划审阅页批准失败时也原样显示。

## 测试
Remote spec：approve 在 validate 有 error 时拒绝且不调 runStart；conditionDiff 只报不同键；client spec：计划审阅渲染、按钮调 approve、条件页 diff 高亮。

## 完成判据
eval 测试全绿，gate 绿；临时实例上从列表点一个草稿 → 计划审阅 → 批准并启动 → 概览页出现 job 与 run id、就绪检查原文；条件页对 dsh-exec 与 codex-exec 出 diff 只报不同项。第 3、4（看）、5 步在界面上走通。

## 回报
分支与 commit；Agent Note；gate；临时实例上的三段原文（计划审阅、批准后的概览、条件 diff）。
```

**验收（2026-09-14）**：`feat/eval-client-review`（`7cb31f66`、`14753348`）合入 main `66dbdede`。三段原文齐：计划审阅（i1-walk 的摘要与六条 warn、条件就绪态）、批准后的概览（就绪拒绝原文原样：本机没有注册 dsh 委派 provider）、条件 diff 七项。approve 的形状按文案（先 validate，有 error 即拒，不给模型工具）。Agent Note：`.agents/notes/implemented/feature/2026-09-14-eval-plan-review-and-approve.md`。

### T35b · 实验室 › 矩阵 + 格子 + 格子详情（已完成，2026-09-14 验收）

```text
# 任务 T35b：矩阵页、格子页与格子详情抽屉，mission 账本的投影与三个动作转发

## 背景
ui-spec §五：矩阵页行永远是题、列是人选的因子、格内四样（rep 圆点、阶段或桶、卡格告警、哈希是否一致）、底部 run 级汇总；格子页是原 missions 队列按本 run 过滤，右侧抽屉是格子详情（refs、检查点、子会话、verify 原样输出、产物、注解计数），动作是带原因重跑、释放检查、导出 bundle。R2：全部经 eval 自己的 Remote，前端零 mission 依赖；动作在服务端转发给 mission 的服务面。T46 已有服务面 cells(runId, query)。

## 先读
packages/eval/src/service.ts 的 cells 与 read.ts 的 runCells；packages/eval/src/faces.ts 的 MissionFace / MissionReadFace（看缺哪些动词）；packages/mission/src/remote.ts 的 queue / get / retry / isReleasable / exportPlan / exportRun（签名与泄题闸的语义，照抄语义不 import）；packages/mission/src/client/MissionsView.tsx 的详情面板与导出对话框（看它展示什么，本任务自己实现同等的最小对话框）；packages/taskpilot/src/client/index.ts 里 sessions.open 的用法；packages/eval/src/report.ts 的 materialization / fingerprint 检查（矩阵格的「哈希是否一致」用同一口径）；ui-spec §五。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-client-cells，分支 feat/eval-client-cells；只改 packages/eval（README 双语 + sidecar）。faces.ts 需要加宽的结构面（retry / isReleasable / exportPlan / exportRun / get 的详情形状）在 eval 侧声明，mission 不改。

## 已定决定
- Remote 新增带 agent 的 verb：cells(agent, { runId, query })；cell(agent, { runId, missionId })——attempts、检查点、各 ns 注解（orchestrator / lab / script / llm-draft / human-final 的条数与最近一条摘要，lab 的 verify 原样输出全文）、产物、refs、childSessionId；retry(agent, { runId, missionId, reason, category })；releaseCheck(agent, { runId, missionId })；exportPlan / exportRun(agent, …) 转发 mission 同名语义（guarded 层 fail-closed 由 mission 侧保证，eval 只转发不放宽）；runsForItem(agent, { datasetId, itemId })——按 label task 列各 run 的格子与判定摘要，给题集 tab 的「作答记录」用（T47 消费，缺席时那边隐藏）。
- 矩阵页：因子集合 = run.meta.conditions 两两 diff 的键并集；「列」选一个因子，其余因子「分组」或「筛选」，单因子时默认就是那一列；格 = 同 task × condition 的 rep 集合，圆点实心 ≥ judged、半心进行中、空心未起；阶段或桶文字；卡格告警 = 在态时长超过阈值（缺省 30 分钟，可配）；哈希不一致 = 同题各格 materialization ref 不同则该格红边；底部一行：物化哈希、环境指纹、未释放单元数、判官一致性（报告未出前显示「待报告」）、卡格数。点格子打开抽屉。
- 格子页：表（题 × 条件 × rep、桶、阶段、attempt、时长）+ 抽屉；抽屉动作三枚；「打开子会话」用宿主 sessions.open(childSessionId)，缺 childSessionId 时按钮禁用并说明。
- 导出对话框：先 exportPlan 展示要收录与被拦的层，再 exportRun；不复制 mission 客户端的组件，自己写最小版。

## 测试
矩阵透视函数（因子并集、列 / 分组 / 筛选、圆点态、哈希一致性）单测；Remote spec：retry 需要 reason 与类别、exportRun 前必 exportPlan；client spec：矩阵渲染、点格子开抽屉、三个动作调 Remote、sessions.open 被调。

## 完成判据
eval 测试全绿，gate 绿；临时实例上对本机一个多格 run（pilot-a-round1 的 bundle 或 t29-two-scopes）矩阵按 harness 与按 scope 两种列各出一次；格子页抽屉三个动作各调通一次（重跑用 infrastructure 类别、释放检查回答 releasable 与否、导出对话框走到 plan）；打开子会话切到成员 composer。第 6 步在界面上走通。

## 回报
分支与 commit；Agent Note；gate；矩阵两种列的原文；抽屉与导出对话框的原文。
```

**补充（2026-09-14）**：

```text
# T35b 补充：把 main 并进分支、解冲突、重跑 gate，再回报

内容验收已过（矩阵两种列、抽屉、三个动作、导出对话框、eval 559 绿），只差一步：T36 先合进了 main（66dbdede），与你的分支在 packages/eval 的 15 个文件 48 处冲突——LabView.tsx / store.ts / contract.ts / index.ts / locales.ts / remote.ts / service.ts / types.ts / tsconfig.client.json / LabView.module.css / LabView.client.spec.tsx / README 双语与 sidecar。两边都是往同一批文件里加东西（各自的子页、verb、store 分片、locale 键、测试），没有语义冲突，但协调者不代解代码冲突。

1. 在你的 worktree 里 git merge main，逐文件保留双方：子页路由并在一起，Remote verb 与 service 方法两组都留，store 分片与 locale 键合并，README 两节都留后重录 sidecar（node_modules/.bin/tsx scripts/verify-translation-pairing.mts --write packages/eval/README.en.md）。
2. T36 修了 runOutput 少传 cursor 被网关精确位参拒的 bug，你新加的 verb 调用侧同样按精确位参传，别靠默认值。
3. 重跑 pnpm --config.verify-deps-before-run=false gate（整仓），eval 测试数应当是 534 + 你的 49 上下。
4. 回报分支与 merge 后的 commit；不 squash 我也能合。

通用提醒照旧；临时实例照 T49 之后的 install.sh 装。
```

### T47 · 题集 tab 改造：列表、槽位、选手将看到、骨架与导入（已完成，2026-09-14 验收）

```text
# 任务 T47：datasets 的 tab 按 ui-spec §四 改成「题集」：列表 · 骨架 / 导入 · 详情

## 背景
今天的 datasets tab 是绑定条 + 树 + 预览，标签用层名，用户看不懂。ui-spec §三 §四 定了：按「谁看得到」标注，槽位显示为题干 / 验收标准 / 参考答案 / 评估标准 / 检查脚本 / 其他文件；列表页一行一个题集；详情是树 + 预览 + 槽位筛选 + 「选手将看到」+ 可判性 + 作答记录；新建是骨架加导入，界面不做正文编辑器。

## 先读
packages/datasets/src/client/{index.ts, DatasetsView.tsx, BindForm.tsx, preview.tsx, store.ts, locales.ts, preset-visibility.ts}；packages/datasets/src/{remote.ts, service.ts, dataset.ts, rubric.ts, worktree.ts}（binding / bind / list / show / read / readPassthrough / putItem / validate）；docs/dataset-authoring-protocol.md §2 §3（层、register、透传区、canary）；packages/eval/src/manifest.ts 与 unit.ts 里「选手拿到哪些字节」的规则（visible 层 + prompts）；packages/eval/src/judge.ts 的 rubric kind；ui-spec §三 §四；T35b 文案里 runsForItem 的形状。

## 分支
从 main 开 worktree ../dsh-plugins-wt-datasets-tab，分支 feat/datasets-tab-slots；只改 packages/datasets（README 双语 + sidecar）与 packages/datasets-tool 的 README（put_item 的措辞若变）。不改 eval / mission；作答记录经 ctx.get 探测 remote.dshEval，缺席即隐藏那一区。

## 已定决定
- 角色是权威，槽位名是显示层：每个文件按 dataset.json 的 layers + register 恰好落一个角色——选手看得到（modelFacing 层）、只有判官（grading）、只有探针（verify）、所有人可读（透传区）；五个槽位名由基名启发式给出（task.md 与 prompts/ → 题干；standards* → 验收标准；rubric* 与 standards-notes* → 评估标准；oracle/ → 参考答案；checks/ 与 probes/ → 检查脚本），启发式写在一处并单测；不改协议、不加契约字段，题集要自定义槽位名留作后话。
- 列表页：题集、快照（绑定的 repo @ commit）、题目数、槽位 ← 层对应、canary 是否设置、validate 结果、用于的实验（从 remote.dshEval 的 runs 按题集过滤，缺席隐藏）；动作：新建题集（服务面 scaffoldDataset：写 dataset.json 骨架、prompts/、schemas/、items/），导入题集（就是现在的绑定表单，换个标题）。
- 详情页：树（每文件标槽位 + 谁看得到，三种颜色）、槽位筛选 chip、预览沿用；「选手将看到」= 该题 visible 层文件 + 题集级 prompts 的清单与字节数；可判性 = rubric 各 kind 的条数、探针数、阶段 schema 数（读 grading / verify 层用显式单层 scope）；作答记录 = runsForItem 的投影，缺席隐藏；动作：题目骨架（putItem 写占位的 task.md / standards.yml / answers/rubric.yml / checks/ 目录，位置按该题集的层与 register 规则落）、导入题目（putItem 从一个已有目录拷入）、validate。
- 标签改「题集 / Datasets」；自隐规则不变。commit 仍是人的，界面不 commit。
- 顺手修 T36 撞见的 `/datasets bind` 在 composer 里补全条选中后参数丢失（slash 侧），补一条用例。

## 测试
槽位启发式与角色计算的单测（含 register 形态、无 register 的层目录形态、透传）；Remote spec：scaffoldDataset 与骨架 putItem 的落位；client spec：列表渲染、槽位筛选、「选手将看到」、作答记录缺席隐藏。

## 完成判据
datasets 测试全绿，gate 绿；临时实例上绑定 harness-comparison：列表一行字段齐、P0 详情树上每个文件的槽位与「谁看得到」正确、「选手将看到」只列 task.md / standards.yml / prompts、可判性数对；新建一个题目骨架后 validate 有 error 指向占位文件（预期）；作答记录在有 eval 时按题列出。

## 回报
分支与 commit；Agent Note；gate；临时实例上的列表与 P0 详情原文；骨架落位后的 validate 原文。
```

### T50 · 脚本卫生三处：gen-typert 取锁、install.sh 注释与缓存、gate 的路径范围（已完成，2026-09-14 验收）

```text
# 任务 T50：三处脚本卫生

## 背景
T35b / T49 在临时实例上装 web-eval 时撞见：(1) scripts/gen-typert.mts 全量模式在全新 DSH_HOME 上死锁——acquireTypertLock 用非递归 mkdirSync(<DSH_HOME>/scratch/typert-gen.lock)，scratch/ 不存在时每次 ENOENT，空转 900 秒再「破」一个不存在的锁；今天没人撞见只因部署路径都走 GEN_TYPERT_ONLY 在取锁前返回。(2) install.sh 第 287 行附近的注释还写「成员不变量 23」，已经落后两轮（现在 27 个 tarball、profile 根 24 成员）。(3) T35b 实测把 install.sh 的 GEN_TYPERT_ONLY 去掉让全量模式吃缓存，27 包构建从约 80 分钟降到约 12 分钟。(4) scripts/gate.mts 的 GLOBAL_PATHS 只含仓库根的 scripts/，改 profiles/*/scripts/ 不触发整仓，T49 只跑了 11 步。

## 分支
从 main 开 worktree ../dsh-plugins-wt-script-hygiene，分支 fix/script-hygiene-typert-install-gate；改 scripts/gen-typert.mts、profiles/web-eval/scripts/install.sh（注释 + GEN_TYPERT_ONLY）、scripts/gate.mts；每处一条提交。

## 已定决定
- gen-typert：取锁前 mkdirSync(dirname(lockDir), { recursive: true })；补一条用例（全新目录取锁不空转）。
- install.sh：注释改成当前口径（tarball 数与 profile 根成员数分开写）；GEN_TYPERT_ONLY 去掉前先确认全量模式在 (1) 修好后不死锁、缓存命中时产物与 scoped 模式逐字节相同（对比一次 tarball 内容），确认了才去，否则保留并写明原因。
- gate.mts：GLOBAL_PATHS 加 profiles/*/scripts/（或等价的 glob）；这是根 scripts 的改动，本身会触发整仓 gate。

## 完成判据
全新 DSH_HOME 上 install.sh --source <主检出> --fresh 全量一遍不死锁；gate --all 绿；改 profiles/web-eval/scripts 下任一文件后 gate 的 scope 变成整仓。

## 回报
三条提交；全新 DSH_HOME 那一遍的耗时与 tarball 对比结论；gate scope 原文。
```

### T38 · 实验室 › 报告页（已完成，2026-09-14 验收）

```text
# 任务 T38：实验详情的报告页——不变量、配对、效率、一致性，finalize 与导出

## 背景
ui-spec §五：报告页 = 四条不变量、配对差值表、效率表、判官一致性；四条全 ok 前「报告」显示为「比较节未开」；动作 finalize（过释放闸）与导出（走 T35b 的导出对话框）。报告的计算已在 packages/eval/src/report.ts（dsh-eval report 读 bundle 出 RunReport：invariants、comparisonAllowed、factors、comparisons、judge、efficiency、usageRows），本任务只做投影与界面，不改口径。

## 先读
packages/eval/src/report.ts 与 report-render.ts（RunReport 的字段、四条不变量的 id 与 title、比较节开关、自评标记）；service.ts 的 report 与 finalize；T35b 合入后的 remote.ts（exportPlan / exportRun）与 LabView 的子页路由；T24 / T30c / T31 的 Agent Note（权重、usage.jsonl、判官归属）；ui-spec §五 §七第 7 步。

## 分支
从 main（≥ e3fe4904，T35b 已合入）开 worktree ../dsh-plugins-wt-eval-client-report，分支 feat/eval-client-report；只改 packages/eval（README 双语 + sidecar）。

## 已定决定
- Remote 加 report(agent, { runId })：找该 run 最近一次导出的 bundle（导出目录按 plan 的 exports 约定），没有就返回「先导出」；有就调 service.report 出 RunReport 的投影，不落盘（落盘仍是 CLI 的 --out）。加 finalize(agent, { runId })：调 service.finalize，返回 released / refused / skipped 计数与原文。两个都不做模型工具。
- 报告页：不变量四行（ok / violated / unverifiable 三态与 details 原样）；比较节只在 comparisonAllowed 时展开，否则一行「比较节未开：<哪条不变量没过>」；配对表（题 × 因子 × 差值 × n × 判官，自评格标出）；效率表（活跃秒、in / out / cacheRead、工具调用）；判官一致性（同判官 κ、跨判官）；顶部动作：finalize、导出（复用 T35b 的对话框）、「用 CLI 落盘」的命令提示。
- 未导出时页面显示「还没有 bundle」+ 导出按钮，不空白。

## 测试
Remote spec：report 无 bundle 时的返回、finalize 转发；client spec：不变量三态渲染、比较节开关、自评标记、未导出态。

## 完成判据
eval 测试全绿，gate 绿；临时实例上对 t31-judge-panel（有 bundle）出完整报告页；对一个未导出的 run 显示未导出态并能从页面导出后刷新出报告；finalize 一次原文。第 7 步在界面上走通。

## 回报
分支与 commit；Agent Note；gate；两种状态的报告页原文。
```

**验收（2026-09-14）**：`feat/eval-client-report`（`803e474b`、`bd76772b`）合入 main `c83c7fb9`。两种状态的报告页、比较节打开（pilot-b-p0-runA 六个配对块、bootstrap CI、n=1 不可排名）与关闭（t31 环境一致 unverifiable）、finalize 一次与重复 finalize 的 skipped 计数都有原文。Agent Note：`.agents/notes/implemented/feature/2026-09-14-eval-report-page.md`。给 T37 的接口：判官一致性与自评标记是判官台按格展示的同一批事实；路由里只剩 placeholder.judging。

### T37 · 实验室 › 判官台（已完成，2026-09-16 验收）

```text
# 任务 T37：判官台——盲评队列、去指纹产物、llm-draft 与 human-final 并排，human-final 的唯一写入口

## 背景
ui-spec §五：判官台 = 盲评队列、去指纹产物、llm-draft 与 human-final 并排、一致性统计；human-final 只从这里写（R1 的「终评是人的」）。今天 human-final 走 dsh-mission annotate --ns human-final，判官的去指纹副本由 judge.ts 生成，rubric 的 human 类判据由协议定义（objective 归探针、llm-draft 归判官、human 归判官台）。

## 先读
packages/eval/src/judge.ts（去指纹、llm-draft 样本记录、by 字段）；packages/eval/src/report.ts 的 human-final 处理（by 为 tool: 前缀标红、覆盖位置）；packages/mission 的 annotate 语义（append-only，ns human-final）；docs/dataset-authoring-protocol.md 的 rubric kind 三分；T31 的 Agent Note（面板与自评）；T38 合入后的 LabView 路由；ui-spec §五 §七第 8 步。

## 分支
从 main（≥ c83c7fb9，T38 已合入）开 worktree ../dsh-plugins-wt-eval-client-judge，分支 feat/eval-client-judge；只改 packages/eval（README 双语 + sidecar）。

## 已定决定
- Remote 加 judgeQueue(agent, { runId })：每格的去指纹产物清单与正文（复用 judge.ts 的去指纹函数，不另写一份）、rubric 里 kind: human 的判据、已有 llm-draft 样本（每判官每样本的分值）、已有 human-final；humanFinal(agent, { runId, missionId, verdicts })：转发 mission annotate(ns human-final)，by 记为本会话（不是 tool: 前缀），只追加不改写。不做模型工具；模型永远拿不到 human-final 的写入口。
- 页面：左队列（格子按未评 / 已评分组，盲：不显示 harness 与模型名，只显示格子编号）、中去指纹产物（stage 文件原文）、右判据表（llm-draft 各判官各样本 · human-final 输入），提交后队列状态更新；顶部一致性统计（同判官 κ、跨判官、human-final 与 llm-draft 的一致）。
- 盲评的边界：页面上不出现条件 id、harness、模型；报告页才揭盲。
- 顺手查一遍 eval 客户端里「effect 把自己写的加载态放进依赖」的自取消形状（T47 在 datasets 撞到并改用 ref 记已请求的 key），有同款就照改并补用例。

## 测试
去指纹在页面路径上的复用（同一函数）；humanFinal 的 by 不带 tool: 前缀且 append-only；client spec：队列分组、盲态不含 harness / 模型字样、提交后刷新。

## 完成判据
eval 测试全绿，gate 绿；临时实例上对 t31-judge-panel 打一条 human-final，账本里出现 ns human-final 的注解且 by 是会话，报告页重算后 human-final 覆盖位置正确；页面上搜不到 harness 与模型名。第 8 步在界面上走通。

## 回报
分支与 commit；Agent Note；gate；判官台盲态原文、提交后的账本注解原文、报告页的覆盖原文。
```

**验收（2026-09-16）**：`feat/eval-client-judge`（`f9ca4627`、`d675ea55`）合入 main `db4376e6`。盲态、去指纹、账本注解追加、报告页覆盖、得分警告五段原文齐。Agent Note：`.agents/notes/implemented/feature/2026-09-15-eval-judge-bench.md`。得分口径的方法论问题另立 T54。

### T51 · 脚本：gate 的 porcelain 解析错位（已完成，2026-09-16 验收）

```text
# 任务 T51：gate 读 git status --porcelain 时首行未暂存文件丢一个字符

## 背景
T50 发现：scripts/gate.mts 的 gitRunner 对每条命令输出做 .trim()，而 git status --porcelain 的未暂存修改行以空格开头（" M path"）。首行被 trim 掉前导空格后，porcelainPaths 的定长 slice(3) 就错位一格——"profiles/…/update.sh" 变成 "rofiles/…/update.sh"，共享层判定 [true, true] 变成 [false, true]。只影响首行且未暂存的那一条，但改了 scripts/foo.ts 还没 add 就跑 gate 时 scope 会成 NONE，正是 gate 注释里说「scoping must not have」的假绿。它先于 T50 存在，改它会改变所有人的 gate 行为，所以单独一条。

## 分支
从 main 开 worktree ../dsh-plugins-wt-gate-porcelain，分支 fix/gate-porcelain-parse；只改 scripts/gate.mts 与 scripts/gate.spec.ts。

## 已定决定
- porcelainPaths 按 /^(..) (.*)$/ 逐行解析（状态两列 + 空格 + 路径），不再定长切片；gitRunner 对 status 命令不 trim 或改为只去尾部换行——二选一，选改动面小的那个并写明。
- 用例：首行为未暂存的共享层文件时 scope 判为整仓；重命名行（"R  old -> new"）取新路径。

## 完成判据
scripts 测试全绿；探针 worktree 里改一个根 scripts 文件不 add 直接跑 gate，scope 原文是整仓；gate --all 绿（根 scripts 改动触发整仓）。

## 回报
分支与 commit；两次 gate scope 原文（修前 NONE、修后整仓）。
```

**验收（2026-09-14）**：`feat/datasets-tab-slots`（`14dca787`）合入 main `7ec52ed7`，只动 datasets 与 datasets-tool 的 README。真机原文齐（列表一行、P0 详情树、选手将看到、可判性、槽位筛选、骨架落位与 validate）。Agent Note：`.agents/notes/implemented/feature/2026-09-14-datasets-tab-slots.md`。

**验收（2026-09-16）**：`fix/gate-porcelain-parse`（`53e89adf`）合入 main `899410e9`；修前 NONE、修后整仓的 scope 原文与「真实字节 → trim → 解析 → scope」整链用例齐。

### T48 · 文档：README 按 ui-spec 改写，修十处口径不一致（已完成，2026-09-16 验收）

```text
# 任务 T48：README「最终 UI」按 ui-spec 改写；修走查时对出来的十处不一致

## 背景
走查稿（profiles/web-eval/docs/ui-spec.md）定了新的界面形状，README「最终 UI」一节还是七个面的老口径；两次扫描还对出十处文档与代码不一致，走查前要修完，不然走查稿和代码各说各的。

## 分支
dsh-plugins：从 main 开 worktree ../dsh-plugins-wt-docs-ui-spec，分支 docs/web-eval-ui-spec；改 profiles/web-eval/README 双语 + sidecar、docs/architecture.md、packages/eval/README 双语 + sidecar、packages/mission/README 双语 + sidecar。题库：从 i1-walk 开 worktree，分支 i5-docs，改两处。

## 要改的
1. README「最终 UI」：换成两个 tab（题集、实验室）各列表 + 新建 + 详情，实验详情六个子页，missions 隐藏；ASCII 示意图换成实验室详情的矩阵页；「七个面，四个已有」那张表按 ui-spec §四 §五 重写，状态列照旧用 ✅ 🔶 ⬜。
2. README「工具按域开放」表：mission 行改「eval 预设不挂 mission-tool；账本与释放闸仍由 mission 提供」（与 T46 同步，先改文档）；eval 行加 eval_cells。
3. README 理想架构图：「判定探针 · 宿主侧」改成在单元内（I3 起）。
4. docs/architecture.md：local-agent 的 agent 工具列不再写 subagent_<harness>，与 README 的三行 tools: none 一致。
5. packages/eval/README 开头：「四个上游服务」改为列全四个并注明 lab 只在 plan 带 unit 段时才要；容器路径编号重复的两个「7」修正。
6. packages/mission/README 第 7 行 M1 清单：十二个模型工具已搬到伴生行，改口径。
7. README「依赖插件」：「23 个成员，四组」改为实际成员数与三组（数一遍 package.json）。
8. 题库 items/P0-placeholder/item.json：scoring.definedBy 与 verify.checklist 的路径改成实际文件位置（answers/rubric.yml、checks/checklist.yml）。
9. 题库 CONFORMANCE.md：协议版本改 v1-rev11，三条「前端预期表现」改成已落地的陈述。
10. 题库 dataset.json：加 canary（作者自造的全局唯一串，按协议 §2），并把它逐字放进每个可见层文本文件；validate 0 error。

## 约束
只改文档与题库那三个文件；不改代码；README 双语同步、sidecar 重录；题库共享检出不 checkout，走 worktree。

## 完成判据
gate 绿（docs-only 8 步）；题库 validate 0 error 且不再报 CANARY_MISSING；README「最终 UI」与 ui-spec 逐条对得上。

## 回报
两条分支与 commit；十条各一句「改在哪」；validate 原文。
```

### T35a · eval client 半骨架 + 实验室 tab 的列表与详情壳（已完成，2026-09-13 验收）

```text
# 任务 T35a：eval 的 client 半边从零搭，实验室 tab 先有列表与详情壳

## 背景
eval 今天是纯宿主侧包（tsdown 的 Client pass 不产出，package.json 没有 ./client 出口）。界面规格（profiles/web-eval/docs/ui-spec.md §五 §八）要一个「实验室」tab：列表 + 新建 + 详情六个子页。本任务只做骨架、列表、详情壳与概览页，后面的子页（计划审阅、矩阵、格子、报告、判官台）各自成任务。

## 先读
packages/mission/src/client/{index.ts, contract.ts, store.ts, locales.ts, MissionsView.tsx, preset-visibility.ts}（tab 注册、四份合成 props、transient store、自隐门）；packages/mission/{tsconfig.json, tsconfig.client.json, tsdown.config.ts, package.json}（client 出口与构建）；build/tsdown.client.ts 的 clientBundle；packages/mission/src/remote.ts（带 agent 参数的 Remote verb 写法）；packages/eval/src/remote.ts（现有四个不带 agent 的 verb，不动）；packages/eval/src/service.ts（runStatus / conditions / report）；packages/mission/tests/apply.client.spec.ts 与 MissionsView.client.spec.tsx（测试写法）；ui-spec §五（列表列、状态定义）与 §八。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-client，分支 feat/eval-client-lab；只改 packages/eval（README 双语 + sidecar）。不改 mission / datasets / lab。

## 已定决定
- 脚手架照 mission：src/client/{index.ts, contract.ts, store.ts, locales.ts, LabView.tsx, LabView.module.css, preset-visibility.ts}；tsconfig 拆 host / client 两份；tsdown 换 clientBundle；package.json 加 ./client 出口与 dsh.client 块；cordis 行不用改（同一行的 dsh.client 声明驱动）。remote.ts 用了装饰器，client 配置里复核 experimentalDecorators 与 verbatimModuleSyntax。
- tab：conversation.view slot，id lab，order 40，locale 词典 zh「实验室」/ en「Experiments」；注册包在 ctx.slots.inject('conversation.view', …) 的 arm 里；自隐照 mission 的 preset-visibility，判据换成预设里有没有 @khorsheed/dsh-eval-tool 行，四个 fail-open 分支照抄。
- Remote：在 EvalRemoteService（namespace dshEval）上新增带 agent 参数的读 verb：runs(agent, request) 与 run(agent, { runId })；客户端 $mount 后经 ctx.get 回读，不进 inject。现有 runStart / runStatus / runOutput / runCancel 一个字不动（CI 门）。
- runs 的投影：一行一个实验。run 来自 mission 的 run 列表里 run.meta 带 evalVersion 的那些（经 hosts.get('mission') 结构面）；草稿来自会话绑定的题库工作树里 plans/*.json 中还没有对应 run 的（经 hosts.get('datasets') 取绑定与工作树路径，与 service.conditions 同一取法）。列：名称、题库快照、条件数（+ 判官）、题数、rep、因子（用 conditions diff 的结果）、状态、进度、开始时间。
- 状态推导写成一个纯函数并单测：草稿 = 有 plan 文件、validate 未过或未跑；待批准 = validate ok 且无 run；运行中 = run 的 job 未结束或桶里 active > 0；评估中 = 选手格全部 ≥ judged 且 run 未 finalize；已完成 = run 已 finalize；被拒 = 就绪检查拒绝（job 输出里的 refused）；已取消 = job 取消。边界情况回报里点名，别猜。
- 详情壳：六个子页的路由与标题（概览 · 计划审阅 · 条件 · 矩阵 · 格子 · 报告 · 判官台，按 ui-spec §五），本任务只填概览页（快照、矩阵形状、因子、判官、环境、就绪检查原文、run.meta 摘要）；其余子页放占位说明「归 T36 / T35b / T38 / T37」。
- 「新建实验」按钮本任务只占位（归 T36）。
- runs 读面落地后，给 eval-tool 的 eval_cells 加「不给 run_id 就列评测 run」的模式（列表列与 runs 投影同源），补一条用例；T46 留下的缺口在这里收。
- 真机验证用独立 DSH_HOME + 空闲端口的临时实例：源码模式装 web-eval（install.sh --source <主检出> --fresh），不碰 3171 / 3080 / ~/.dsh-official / ~/.dsh；临时实例用完停掉。3171 现在没人守也没实例（看门狗 9/12 收到 SIGTERM 退出），本任务不碰它。

## 测试
tests/apply.client.spec.ts（首行 @vitest-environment jsdom；真 cordis Context；三个门态：预设有 eval-tool 行则注册、没有则归零、无 pluginInventory 则 fail-open；teardown 归零）；tests/LabView.client.spec.tsx（列表渲染、状态 chip、点行进详情、概览页字段）；状态推导函数的单测覆盖七个状态。

## 完成判据
eval 测试全绿，gate 绿；临时实例上 eval 预设会话的 tab 环出现「实验室」且没有任务 tab，standard 预设两个都不出现；列表能列出草稿与至少一个已跑完的 run（用 pilot-a-round1 或本机任一 run），概览页字段有值；eval 会话的工具卡里有 eval_cells、没有 mission_*（T46 的活实例原文在这里补）。

## 回报
分支名与 commit；Agent Note 路径（feature）；gate 输出；tab 环截图或原文；列表与概览的原文；状态推导的边界情况清单。
```

**验收（2026-09-16）**：`docs/web-eval-ui-spec`（`3f08d971`）合入 main `cbadb266`，题库 `i5-docs`（`19358bc`）并入 i1-walk `3c5ebf4`。十条各有落点；第 2 条零改动成立（T46 已同步）。两问的裁决见 §二。

### T34 · eval-planning skill + eval_plan_draft + 新建实验表单（已完成，2026-09-16 验收）

```text
# 任务 T34：一句话起草——技能、工具、表单走同一个服务面动词

## 背景
ui-spec §七第 2 步：agent 起草实验（草稿落实验室列表）。今天 agent 得先 write 两个文件再调 eval_plan_validate，人建草稿没有表单（T36 把「新建实验」留成占位指向本任务）。ui-spec §五定了表单字段，§六定了 eval_plan_draft 把「写文件 + validate」并成一个动作；预设注释写明 eval-planning 技能经 skill-filesystem 的预设层进来。R1 不变：起草不是启动。

## 先读
packages/eval/src/service.ts（validatePlan、conditions）、remote.ts（T36 的 plan / approve）、client/LabView.tsx 的 placeholder.new 与 store；packages/eval-tool/src（四个读工具的注册形状）；@deepseek-ai/dsh-skill-filesystem 的 README（技能根目录约定、SKILL.md 的 frontmatter）；profiles/web-eval/scripts/install.sh 与 update.sh 里 PRESET_IDS 整目录覆盖的做法（技能目录同款）；题库 conditions/*.json 与 plans/*.json 的现成样本（T33b 起草的两条条件就是「从 dsh-exec 复制改 model.declared」）；ui-spec §五 §六 §七；T31 的 lock 语义。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-planning，分支 feat/eval-planning；改 packages/eval（服务面 + Remote + 表单）、packages/eval-tool（eval_plan_draft）、profiles/web-eval（skills/eval-planning/SKILL.md、install.sh / update.sh 装技能目录、README 双语 + sidecar、CHANGELOG）。

## 已定决定
- 服务面 draftExperiment(input)：按表单字段（名称、题库快照、题目多选、条件——选已有或「从某条复制并改字段」新建：harness / model.declared / scope / preset / permissions / reasoning、判官与采样数、rep、阶段、顺序 seed、环境 image / network / egressCheck、预算）写 plans/<name>.json 与新条件文件到会话绑定的题库工作树透传区（不 commit），随即 validatePlan，返回文件路径与 validate 结果。新条件只能从现有条件复制再改，不从零造。
- Remote newExperiment(agent, input)（表单用）与 eval-tool 的 eval_plan_draft（agent 用）调同一个 draftExperiment；eval_plan_draft 的描述写明「只起草，不启动，启动是人的」；tools: all 变五个。
- 表单在实验室列表页「新建实验」；保存成功后跳到该草稿的计划审阅页（T36）。
- 技能 profiles/web-eval/skills/eval-planning/SKILL.md：教 agent 流程——用 datasets_list / show / read 看题与 prompts，用 eval_conditions 看条件注册表，用 eval_plan_draft 起草，把 validate 结果与路径报给人，明说不批准不启动、登录与 provision 是人的；随 pack 装到 skill-filesystem 的根目录（install.sh / update.sh 与 presets/eval 同款整目录覆盖），在 eval 预设的技能层出现。
- 不改 mission / datasets / lab。

## 测试
service：落位路径、复制条件只改指定字段、validate 结果原样返回；Remote 与工具都命中同一函数（守卫用例）；client：表单提交 → 跳转计划审阅；技能文件存在且 frontmatter 合规。

## 完成判据
eval / eval-tool 测试全绿，gate 绿；临时实例：表单建一个草稿 → 列表出现「草稿」→ 计划审阅页有 validate 结果；在 eval 会话里一句话让 agent 起草同样的实验，回复里有路径与 validate 结果、没有起 run；技能卡里有 eval-planning。第 2 步在界面与会话里都走通。

## 回报
分支与 commit；Agent Note；gate；表单与会话两条路径的原文；SKILL.md 全文。
```

**验收（2026-09-16）**：`feat/eval-planning`（`83ba74ed`）合入 main `76b4f1a6`。表单与工具两条路径原文、重名拒绝原文、会话里的工具与技能清单都齐；SKILL.md 全文在回报里，与 R1 一致（起草不是启动，登录 / provision / 批准 / 终评是人的）。Agent Note：`.agents/notes/implemented/feature/2026-09-16-eval-plan-draft.md`。

### T39 · 端到端走查：一句话到报告（已完成，2026-09-16 验收）

```text
# 任务 T39：端到端走查——一句话到报告，记录人介入的次数与位置

## 背景
I5 的完成判据：「一句话 → 计划 → 批准 → 跑完 → 报告，人只做审批与终评」。实验室六个子页与题集 tab 都落地了（T35a / T36 / T35b / T38 / T37 / T47），T34 补上一句话起草。本任务不改代码，把八步在一台临时实例上按 ui-spec §七 走一遍，记每一步人介入了几次、在哪、为什么，缺口逐条指向任务或立新任务。先走宿主路径：比较节因环境指纹 unverifiable 不开是预期，记原文；容器版等 T33e 落地后再走一遍拿 I4 的配对报告。

## 先读
ui-spec §七；iterations.md I5 各任务的验收记录（哪些原文已有）；T33b 的中止记录（宿主路径的限制）；题库 docs/pilot-a-log.md / pilot-b-log.md 的记录写法；T30b / T31 的 Agent Note（登录、provision、lock）。

## 分支
题库从 i1-walk 开 worktree，分支 i5-walkthrough，记录写 docs/i5-walkthrough-log.md（新建）。dsh-plugins 不改代码；缺陷只记不修。

## 已定决定
- **用 3171，不用临时实例**：走查要真委派，凭据只在 ~/.dsh-lab；先按 T33a 第 3 步把 3171 重装到 main（≥ 76b4f1a6，含 T34 的技能与表单；经看门狗通道停起），再由人重登 claude 与 codex。绑 harness-comparison；题目 P0-placeholder；条件优先 dsh × 两模型（v4-flash / v4-pro，容器专用命名 scope），走容器路径（镜像已上 0.1.5 线）——这样第 7 步的比较节能打开，顺便拿到 I4 的配对报告；dsh 登不上再退到 codex 单条件 + 判官 t31-judge-other。
- 八步逐步做并逐步记：1 一句话（会话）→ 2 agent 用 eval_plan_draft 起草（草稿出现在实验室列表）→ 3 计划审阅看 validate → 4 登录与 provision（人）→ 5 批准并启动 → 6 矩阵 / 格子看进度，点一次格子详情与子会话 → 7 finalize、导出、报告页 → 8 判官台打一条 human-final，agent 读 bundle 写分析初稿。每步记：用到的面与动词、人介入（次数、位置、原因：审批 / 登录 / 修错 / 绕过）、卡点与原文。
- 日志末尾两张表：人介入汇总（哪几步是设计上的人、哪几步是缺口）、缺口清单（每条指向既有任务或建议新任务）。
- 只跑 P0；不碰 3080 / ~/.dsh-official / ~/.dsh；3171 的看门狗与实例进程按 T33a 的方式动，动之前在日志里写明。

## 完成判据
一份 i5-walkthrough-log.md：八步各有原文、人介入表、缺口清单；validate 0 error；实例与临时 HOME 已清。

## 回报
题库分支与 commit；人介入表；缺口清单；分析初稿的路径。
```

**验收（2026-09-16）**：题库 `i5-walkthrough`（`2b404ac`、`db7d25a`）并入 i1-walk `768df21`。八步原文、人介入表、缺口 G1–G18、分析初稿都齐；共享检出被 agent 写入的三份文件已拷证后还原；单元已释放、3171 交回看门狗。裁决见 §二。

**T33b 补充三（2026-09-16）**：

```text
# T33b 补充三：先收拾这一跑，重跑等 T57

1. 释放两个还 Up 着的单元：在 3171 的会话里对 pilot B 那次 run 跑 /eval finalize（或实验室 › 报告页的 finalize），贴 released / refused 计数；不 --force。
2. 判官条件（judge-dsh-v4-pro 等）notes 里「判官不得是选手之一」是陈旧文本，现行口径是 2026-09-10 放宽后的：判官可与选手同模型，报告标「自评」不排除。改 notes，一并把 model.declared 与名字对齐。
3. 计划被改那件不是你的错，规则已写进通用提醒；重跑时用只含两条 dsh 条件的计划，跑前 git diff 确认没人动过。
4. 重跑等 T57 合入（run 缺省 finalize，第 3 格不再撞单元上限）；C 等 T55。预算那节留着，等用户放行。
```

### T57 · run 缺省 finalize 与单元回收（已完成，2026-09-17 验收）

```text
# 任务 T57：run 跑完缺省过释放闸；finalize 之后界面看得见未回收单元

## 背景
T33b 补充二：不带 --finalize 的 run 每格跑完停在 archived、单元不释放，攒到第 3 格撞 maxConcurrentUnits（4），格子数超过上限的 run 必然跑不完；T39 的 G10 / G18：「批准并启动」没有第二个选项，finalize 之后两个容器还 Up 着界面不提示。

## 先读
packages/eval/src/run.ts 的 --finalize 路径与 destroyUnit；service.ts 的 finalize；remote.ts 的 approve（T36）与 finalize（T38）；client 里报告页的 finalize 按钮；packages/lab 的 status（单元清单）；T20 / T23 / T38 的 Agent Note；T39 日志 G10 / G18 与 T33b 补充二的原文。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-run-finalize，分支 fix/eval-run-finalize-default；只改 packages/eval（README 双语 + sidecar）。

## 已定决定
- `/eval run` 与 approve 缺省 `--finalize`（跑完逐格过释放闸，拒绝照记不强制）；加一个「保留单元」开关（CLI 旗标 + 批准对话框的勾选）给调试用，缺省关。
- 撞 maxConcurrentUnits 时的拒绝原文点名占着名额的 run id 与单元 id。
- 报告页顶部显示本 run 未回收单元数（经 lab 的 status 投影），给「回收」动作（走 finalize 同一条闸，不 --force）。
- 不改 lab、mission。

## 完成判据
eval 测试全绿，gate 绿；临时实例或 3171 上：三格以上的容器 run 不带旗标一跑到底、单元逐格释放；开「保留单元」时行为同今天；报告页未回收计数与回收动作各一次原文。

## 回报
分支与 commit；Agent Note；gate；三格 run 的 docker ps 前后原文。
```

**验收（2026-09-17）**：`fix/eval-run-finalize-default`（`e0a37060`、`b423ecf5`）合入 main `4a11d4ad`；三格 run 的 docker ps 前中后原文、`--keep-units` 原文、报告页回收原文都齐。Agent Note：`.agents/notes/implemented/bug-fix/2026-09-16-eval-run-release-gate-default.md`。

### T59 · 选手在容器单元里没有 shell（已完成，2026-09-17 验收）

```text
# 任务 T59：单元里的 sub-dsh 为什么拒绝 bash

## 背景
T39 的 G14：选手（sub-dsh）在容器单元里跑不了 bash，原文「宿主无可用 sandbox 后端且无审批通道，bash 全部被拒」；两个条件一样，所以不是条件的事。P0 不需要 shell 所以走查过了，真题（F2 / F3 要交脚本、跑测试）在这条上必然全败。条件的 permissions 是 unrestricted（决策 3：沙箱交给容器边界），这个值怎么落到 headless 的 sandbox / approval 配置里、在单元里为什么落不到，是本任务要查清并修好的。

## 先读
packages/local-agent-dsh-headless 的 cordis.patch.yml 与 agent-loader（sandbox / approval 行）；packages/local-agent-dsh 的 provision.ts 与 container.ts（permissions 怎么传）；宿主 tool-bash 与 sandbox 后端在 Linux 容器里的可用性（镜像里有没有 bubblewrap / seatbelt 之类的后端，非 root 用户）；题库 env/Dockerfile；T17 / T20c / T33e 的 Agent Note；T39 日志第 6 步 G14 段。

## 分支
从 main 开 worktree ../dsh-plugins-wt-dsh-unit-shell，分支 fix/local-agent-dsh-unit-shell；改 local-agent-dsh / headless（必要时题库 env 层的镜像，走题库 worktree i4-env-shell）。

## 已定决定
- 先定位：在一个单元里手动起 sub-dsh 跑一次 bash，拿到拒绝的完整原文与当时生效的 sandbox / approval 配置；分清是「没有沙箱后端」还是「审批通道缺失」还是两者。
- 修法按决策 3：容器边界就是沙箱，单元里的 sub-dsh 应当以「无沙箱、自动批准」跑（等价于 codex 的 danger-full-access）；这个值由条件的 permissions 决定、由 provision 写进子 profile，不写死在镜像。
- 修完 P0 走查那条 dsh 条件在单元里 bash 一次成功，宿主路径行为不变。

## 完成判据
包测试全绿，gate 绿；单元里 `bash -c 'echo ok'` 经 sub-dsh 成功的原文；宿主路径同一条件行为不变；若动了镜像，digest 进 lock。

## 回报
分支与 commit；Agent Note；gate；单元里修前修后的两段原文。
```

**验收（2026-09-17）**：`fix/local-agent-dsh-unit-shell`（`19e52e7f`）合入 main `8dc26e97`。修前两段拒绝原文、当时生效的 sandbox-policy / approval 配置、修后单元里 bash 成功原文、宿主路径 patch 逐字节不变，都齐。Agent Note：`.agents/notes/implemented/bug-fix/2026-09-16-dsh-sub-profile-permission-boundary.md`。

**T33b 补充四（2026-09-17，已撤回——pilot B 以 T39 的 run 收口，见 §二「只留必要测试」）**：

```text
# T33b 补充四（撤回）：T57 与 T59 都在 3171 上了，pilot B 容器版三格重跑

1. 3171 现在跑的是 e0a37060（T57）；T59 的 permissions pin 还没装上去——先按 T33a 第 3 步重装到 main ≥ 8dc26e97（经看门狗通道停起，锚点快进）。
2. 两条 dsh 条件（v4-flash / v4-pro）与判官条件的 home.sha 随 T59 的子 profile 多了一层而变：会话里逐条 /eval conditions provision，把新哈希抄回条件文档再 provision 一次写 lock（G7 的两步，T58 之前只能这样）。
3. 计划只含两条 dsh 条件，跑前 git diff 确认没人动过；不带 --keep-units，缺省过闸，三格应逐格释放、docker ps 跑后归零。
4. 交：四条不变量（环境一致这次应当 ✅）、比较节、两格各自的 usage；预算那节按 flash 实测补上，仍停在放行点。
5. 判官 notes 的旧口径照补充三改。通用提醒照旧。
```

### T54 · 报告算分改逐判据合并：人只纠正它判的那条（可发，2026-09-18 定）

```text
# 任务 T54：报告算分口径——按判据取最权威层，不按格整体取

## 背景
现在 report.ts 的 primaryPass 按格取最权威命名空间整体算分（NS_PRIORITY = human-final → llm-draft → script）：一格只要有一条 human-final，这格就只按 human-final 的判据算，判官打的其余判据全部出局。T37 实测：判官打了 4 条判据，人改了 1 条，得分只剩 1 条，另外 3 条静默消失。用户 2026-09-18 定：改成逐判据合并——人改了哪条用人的，没改的仍用判官的，没判官的用脚本的；同一格的分数来源可以混合，但必须标出来。

## 先读
packages/eval/src/report.ts：NS_PRIORITY 与 primaryPass（约 401、1261 行）、两处调用点（格分约 1303 行、逐判据行约 1330 行，那里已经按判据记 ns）、judgeConsistencyOf 与 llm-draft vs human-final 的一致性段；schema.ts 的 verdict（task / criterion / pass / ratio / evidence / by）；report-view.ts 与 stats.ts；client 的 ReportPage / JudgingPage / CellsPage（得分与来源怎么显示）；T37 的 Agent Note（`2026-09-15-eval-judge-bench.md`，判官台在按钮前的代价提示）；ui-spec §五 v2（运行记录详情的「得分（注明来源）」）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-report-merge，分支 fix/eval-report-per-criterion；只改 packages/eval（README 双语 + sidecar）。与 T67 并行且都动 client：本任务在 client 只加「来源」字段的显示，谁后合谁合 main，按 graft 法解。

## 已定决定
- 算分：对每条判据独立取最权威层（human-final > llm-draft > script），格分 = 各判据取到的那层的 credit 之和；一格内允许混合。primaryPass 改成逐判据的选择函数，两处调用点都改；ns 记在判据级（已有），格级新增 sources 计数（如 {human-final: 1, llm-draft: 3}）。
- 报告投影与 bundle 的 report/results.jsonl：每行带该判据的 ns（已有）与格级 sources；报告页与运行记录详情的得分旁标「人 1 / 判官 3」这类来源，全是人评时只写「人」。
- 一致性：llm-draft 的多采样 κ 不变（只看判官层）；llm-draft vs human-final 的一致性只在两者都判过的判据上算（原先按格），报告里写清分母。
- 判官台按钮前的提示改写：不再说「会让其它判据出局」，改成「只覆盖你打的这条，其余仍用判官的」；打完后该格来源立刻变混合。
- 历史：pilot 报告（T37、T39 的 run）重算后数字会变，Agent Note 与 README 写一句；不迁移旧 bundle，重新导出即按新口径。
- 不做：人评的「整格重打」模式；judge 委派与 verdict schema 不动（schema 不变，不升 rev）。

## 测试
逐判据合并（人 1 + 判官 3 → 4 条都计）；全人评 / 全判官 / 只脚本三种纯态与旧结果相同；ratio 的按比例给分在合并后仍按判据取；一致性分母只含双方都判过的判据；results.jsonl 每行 ns 与格级 sources；client：来源标签三种形态。

## 完成判据
eval 测试全绿，gate 绿；拿 T39 那份 bundle 重跑 dsh-eval report，判官 4 条 + 人 1 条的那格得分按 4 条算、来源标「人 1 / 判官 3」，贴 summary.md 那几行前后对照。

## 回报
分支与 commit；Agent Note（Alternatives considered 双语，含按格整体取的旧口径为什么放弃）；gate；前后对照原文。通用提醒照旧。
```

**T54 补充（一）（2026-09-18，与主任务一起发）**：

```text
# T54 补充（一）：结果对比页要看得见每条判据的得分、判官依据与判官

用户 2026-09-18 看完结果页：「看不出来每个维度的得分对比和评委的评判依据」。数据都在——bundle 分析的 rows（results.jsonl 每行一条判定：task / condition / rep / ns / criterion / pass / ratio / weight / negative / judge / evidence / by），只是 report-view 的投影只下发 invariants / pairs / efficiency / counts，页面只画到每题总分。与主任务同一份改动一起做：逐判据合并之后每条判据取到哪一层，正是这张表要显示的东西。

1. 投影加一节 criteria：每题一张「判据 × 对比组」——行是判据（rubric 的 id、标题、权重、极性），列是对比组（列永远是对比组名）；格是该判据在该组的结论：✓ / ✗（负向判据成立即缺陷，用 ✗ 色）或比例，多次（rep）时写 n/N，格里小字写来源层（人 / 判官 / 脚本，逐判据合并后取到的那层）。底行是本题总分，必须与配对表同一个数（同一份计算，不另算一遍）。
2. 每格可展开：evidence 原文（判官或脚本写的「可核对的事实」）、by（判官条件名 + 模型——报告页已揭盲）；多样本时逐样本列出；人工终评改过的标「人已改判」并保留原判官判定。评估者一致性那节不动。
3. 比较闸不动：comparisonAllowed 不成立时这节与 pairs 一样不下发，只留「比较节未开」那一句。
4. 单对比组的 run 也给这张表（一列）：「判官依据」不依赖比较。
5. 格式照 §九：数字 31.5k / 4 分 48 秒式；证据原文折叠，默认只露一行。
6. 判据：拿 xcsp 那份带 report 的 bundle（或 T39 的 24yh）在页面上看到 13 条判据 × 2 组的表，每格能展开到 evidence 与判官名；results.jsonl 不变，summary.md 加同一张表（markdown）。测试：投影快照 + 页面渲染（含一格展开）。
```

**T54 补充（二）（2026-09-23，可发）**：

```text
# T54 补充（二）：合 main——两处冲突按 graft 解，判据表接上 T69 的跳转

回报的内容验过没问题（逐判据合并、格级 sources、判据 × 对比组表、两份真实 bundle 无回归都接受；对照用重建的人工判定、判据表用 axis 当维度，两处出入都接受）。合不进去是因为 main 在分支基点 35edb693 之后进了两条 eval 改动，回报里「main 只动了 ankh-guard」是 git log <base>..main -- packages/eval 漏看了：
- e5106df6（别的会话，推理强度冻结）：report.ts 的 primaryPass 顶部加了 if (configurationMismatch(cell)) return null；comparePair 的 current 过滤成 cells.filter(c => c.isCurrent && !configurationMismatch(c))；checkSubject 多了 reasoning mismatch / unverified 两条。
- 2be4b3bf（T69）：ReportPage 配对表每格可点，走 store 的 openCell(missionId)（有 missionId 时）/ focusRecords({task, condition})（没有时）；RunsPage 详情带产物内联与判官会话；locales / LabView.module.css / types.ts / 三个 client spec 都动过。

在 ../dsh-plugins-wt-report-merge 里 git merge main，按 graft 法解，不 hunk 拼接：

1. report.ts primaryPass：整个函数体取你的逐判据版本；把 main 那一行 if (configurationMismatch(cell)) return null 加回函数顶部（configurationMismatch 是 main 的函数，保留）。comparePair 的 !configurationMismatch 过滤保留。语义要对上：推理强度回读 mismatch 的格，逐判据合并之后一条判据都不出、sources 为空——加一个用例钉住（tests/report.spec.ts 里 main 已有 mismatch 夹具，接着写）。
2. README.i18n.yaml：不手解，合并后跑 node_modules/.bin/tsx scripts/verify-translation-pairing.mts --write packages/eval/README.en.md 重生成。
3. ReportPage.tsx / locales.ts / LabView.module.css / types.ts：自动合并若无冲突也要通读一遍——T69 把配对表格子改成可点，你的判据表格子也接同一条路：每条样本带 missionId，格子点开时有 missionId 走 openCell(missionId)，多样本（n/N）时走 focusRecords({task, condition}) 落到运行记录列表并选中那些行；不另写第三种跳转。
4. 三个 client spec 与 report.spec.ts：两边的用例都留，冲突的取并集。
5. 跑 eval 测试、tsc -b --noEmit、gate；回报分支 + 合并 commit，说明 mismatch 用例的原文。ui-spec §五 得分口径协调者已回写（运行记录详情只给来源不给数值），不用动。

通用提醒照旧：合并归协调者，不混 checkpoint。
```

**补充（二）验收（2026-09-23）**：`fix/eval-report-per-criterion` 合 main 后 `f48c6c35` 合入 main `41dd6483`，合并态 eval 937、tsc 干净、README 418 对同步（协调者在交回的 worktree 上复跑）。两处冲突都按 graft：`primaryPass` 整体取逐判据版本、守卫回到顶部，且是整格的——推理强度回读不符的那一轮不在它挂名的条件下跑，一条判据都不该出（用例 `scores NOTHING on a mismatched cell, however many layers judged it`：claude-exec 那侧四行 sources 为空、codex-exec 照常 `human-final 1 / llm-draft 2`、subject 不变量 violated、criteriaTables 为空、效率表排除计数 1）；sidecar 重生成。实施者点名一条：不变量没过时闸先合上、判据表整份不下发，所以「不符的列缺席」那支从 analyzeBundle 走不到，在 report.ts 写明它与 comparePair 同为冗余过滤——接受，不为测它开口子。判据表格子走 T69 同两条路：一条记录 focusRecords + openCell，多条只 focusRecords 留给人选；按钮放展开区头部不抢「点开看依据」；客户端两条用例接在 T69 的 describe 里。上次「main 只动了 ankh-guard」实施者认了是漏看。Agent Note：`.agents/notes/implemented/bug-fix/2026-09-18-eval-report-per-criterion-merge.md`（备选六条：保留按格取、整格重打、一格仍声明一个来源、底行按列和、不管闸都出表、证据平铺——每条写了为什么否）。worktree 与分支已清。像素层：3171 重装后看 pilot D，文案见下。

**T54 补充（三）（2026-09-23，可发）**：

```text
# T54 补充（三）：3171 重装到 41dd6483——先重建 guard 锚点，再看 pilot D 的判据表

1. main 现在是 41dd6483：含 T54（逐判据合并、判据 × 对比组表）与 T69（产物内联、打开子会话、配对表跳转）2be4b3bf——3171 还是 09-18 18:46 装的 e70f62fe，这两样都没装上。装法照 T65 补充（二）的配方：git worktree add --detach ../dsh-plugins-wt-install-3171 41dd6483 → 在里面 CI=true pnpm install --frozen-lockfile --prefer-offline → export PATH=~/.dsh-toolchains/rc-0.1.5-rc.1/node_modules/.bin:$PATH、export DSH_HOME=~/.dsh-lab → sh profiles/web-eval/scripts/install.sh --source <该 worktree> --fresh。装前看 docker ps 没单元（现在只有 eval-proxy / eval-registry 两个常驻）、没探针在跑；装完删 worktree。
2. guard 锚点先重建：../dsh-plugins-wt-eval-guard 与分支 guard/eval-3171 在 09-21 那次分支清理里被删了（清理前的账 ../dsh-plugins-retired/all-branch-shas-before-2026-09-21.txt 第 116 行记着它在 e70f62fe），~/.dsh-lab/state/launch-spec.json 的 credentialRepo 还指着那个路径，看门狗此刻没有回滚点。装完 git worktree add ../dsh-plugins-wt-eval-guard -b guard/eval-3171 41dd6483（锚点永远不指主检出）；然后照旧 checkpoint → clear → record deployment（--run -- dsh --profile web-eval --dump-config，DSH_HOME 已导出，guard 命令都要它）；supervise 起（--repo 指新锚点），看 watchdog.log 的 instance ready。以后这把 worktree 别再当普通分支清：它是看门狗的回滚点。
3. 停法照通用提醒：先 TERM 启动器那层（eval-launch.mjs 那个 node），或放 stop marker 后等看门狗自己收；不要直接 TERM 看门狗（会留孤儿、端口占 60 秒）。
4. 不碰 claude / codex / kimi 的登录；装完核一眼 install.sh 只替换 eval 那个 id、eval-lean / eval-full 还在。
5. 不起新 run：报告页每次打开都从导出的 bundle 重算（report-view 直接 analyzeBundle），旧 bundle 不迁移，pilot D 装上就按新口径出表；想让盘上的 summary.md 也更新再点「重新导出」，不强求。装完在实验室 tab 打开 pilot D 那个 run（run-20260918054718-8o0o）的结果对比页，核：判据 × 对比组表出现（每题一张，行是判据带维度 / 权重 / 极性，列是对比组，格下小字有得分来源）；点开一格看到逐条判定原文与判官名；格子的「去运行记录」落到对应那条记录（一条直接开，多条挂 chip）；运行记录详情里 stage1.md 就地能读、「打开子会话」开出宿主子对话视图（T69 你在分支上验过的，这次是装上后的 main）。哪一样没出，贴渲染文本或错误原文，别修——先报。
6. 回报：装的 commit、就绪秒数、docker ps 前后、锚点 commit、结果页判据表的渲染文本（一题即可）。通用提醒照旧。
```

**补充（三）验收（2026-09-23 02:08）**：3171 装到 `41dd6483`（源码模式，24 个成员、177 行 patch、27 个 tarball，零 npm），26 秒就绪（02:07:51 port free → 02:08:17 instance ready，child 77212 / listener 77227）。停实例那一步被实施者的自动模式拦下（判为 Interfere With Workloads），协调者核过现场后由用户手跑 marker + TERM listener 放行——协调者不替另一个会话做它被拦的动作；停法按配方，看门狗 01:39:26 读到 marker 自己退出，无孤儿。docker 前后只有两个常驻、无单元无探针。guard 锚点重建为 `../dsh-plugins-wt-eval-guard`，`guard/eval-3171` @ `41dd6483`、工作树干净，checkpoint → clear → record deployment 绿 → supervise（--repo 指新锚点），launch-spec 的 credentialRepo 与之相符。PRESET_IDS 只含 eval（eval 09-23 01:39 新写，eval-lean / eval-full 仍是 09-18 13:31）；登录未碰；安装 worktree 已删。协调者核过 watchdog.log、进程树（旧 pid 全退，`~/.dsh-lab` 只有一棵 supervise 树）、锚点、docker、端口 401、装好的 lib 里 criteriaTables / cellArtifact 都在。pilot D 结果页投影（活实例 RPC，实施者无浏览器）：判据表 1 张（B2 / D1–D4 / X-no-patch ⚠未声明；dsh-full 0 / dsh-lean 4；来源判官 / 脚本，没有人工终评所以没有混合格），展开 B2 × dsh-lean 有判官条件名 + 模型 + 证据原文，格子只有一个 missionId 走直接打开；stage1.md 6175 字节就地读出；详情带 childSessionId 与 parentSessionId。像素层与点击行为等用户在 3171 上走查。

### T70 · ui-spec 按提案 eval-journey-redesign 修订 + 提案定稿（可发，2026-09-23，交互稿作者做）

```text
# 任务 T70：ui-spec 按提案修订 + 提案定稿——先改口径正本，再派 T71–T76

## 背景
你写的提案 proposals/active/2026-09-23-eval-journey-redesign.md 与交互稿 v5 协调者审过：可立项，外壳不动（两个 tab、四阶段、向导、页面上批准与终评），内容按交互稿在四阶段里做增量。web-eval 的规矩是口径正本在 profiles/web-eval/docs/ui-spec.md，先改它再派代码任务；提案本身也有四处要补，一并定稿。这批是 I5 的收口批，任务顺序 T71 D7 → T72 列表 + 结论先行 + 就绪清单 → T73 D1+D2（先实施计划）→ T74 D5 → T75 D6 → T76 D3。

## 先读
ui-spec 全文（§二 口径、§四 题集、§五 四阶段表、§六 工具、§七 八步流程、§九 视觉与文案基线）；iterations.md §三 里 T67、T67 补充、T54 补充（一）、T69 的验收记录（页面现在已经有什么，别写成还没有）；packages/eval/src/report.ts 的 primaryPass / comparePair / checkSubject（不变量与 rankReason 现在怎么写）、report-view.ts 的 pairs 投影；packages/datasets/src/binding.ts 与 docs/dataset-authoring-protocol.md（plans / conditions / analysis 今天都在题库仓库里）；docs/upstream-seam-registry.md 的条目格式。一个事实：题库仓库 ~/.dsh/scratch/dataseek-eval 是多个 agent 共享的检出，HEAD 不能动，所有写操作走 worktree——这就是「会话绑定的其实是一个 worktree」的由来，也是 D1 要答的题。

## 分支
从 main 开 worktree ../dsh-plugins-wt-eval-journey-spec，分支 docs/eval-journey-spec。只改：profiles/web-eval/docs/ui-spec.md、proposals/active/2026-09-23-eval-journey-redesign.md、proposals/prototypes/eval-journey-redesign.html、docs/upstream-seam-registry.md（新增 S18）。proposals/README.md 若要加索引行，在 worktree 里从 main 的版本改——主检出里这个文件有别的会话未提交的改动，别碰主检出。不动 iterations.md（协调者写），不动代码。文档提交在 worktree 里要先软链主检出的 node_modules（钩子要 tsx），显式路径 add，提交完删软链。

## 已定决定（写进 ui-spec，每条能指回提案的 D 项）
1. 外壳不动。§五 四阶段表逐行改到位：实验设计上半段加「要回答的问题 / 预期 / 怎么算回答了」（plan rev13，旧 plan 不显示这块）+ 数字就地改、启动后冻结；下半段是就绪清单（阻塞项 / 提醒两组；主按钮 = 解决第一条阻塞项，全绿后 = 批准并启动，只有人能点；已完成实验只读实验钉住的快照，不读会话）。结果对比：顺序结论卡（原样回答方案里的问题）→ 判据 × 对比组表 → 效率 → 审计折叠；收尾 / 导出挪到结论卡下；校验文案人话，内部字段名只在审计折叠里。可以另加一节「跨面旅程」讲提问到结论这条线，但四阶段表仍是页面正本。
2. §五 列表：分组「需要你处理 / 运行中 / 已完成 / 已归档」；缺省「本会话发起」读 run 的 originSession，没有 originSession 的 run（CLI 起的）不隐藏——给一句「另有 n 个不属于本会话」可切「全部」。「停滞」是推导态，把原先的「中断」与「卡住」合成一个：进程里没有活 job，**并且**格子一段时间没有任何进展；只看「没有活 job」会误判命令行发起的 run（它的 job 在 CLI 进程里，web 实例本来就没有，run.ts 的 runCreate 路径）。停滞给「重跑」，不写账本；归档只隐藏不动账本。（修订（二）：按用户裁定）
3. §五 结果对比第五条校验，名字叫「判定覆盖一致」，定义写准：每条判据在比较的各格里要么都被判过（人终评与判官初判同属「已判」一类），要么都没有；一侧只剩脚本、或判官采样全部报错（判官缺席），即不通过——降级为描述，不给 Δ 与 CI，rankReason 写原因。CI 的门槛**按题数**，不与排名共用：有差值的题不足 3 道就不给区间，页面写「只有 k 道题有差值，给不出区间」；排名门槛不变，仍是 report.ts 里 comparePair 的 n（各题配对次数的最小值）≥ 3；给了区间但没达到排名条件时标「仅供参考，未达排名条件」。理由：每题只跑一次很常见，14 道题各跑 1 次已有 14 个配对差值，按同一个 n 永远拿不到区间。**判官缺席不是阻塞项**：硬口径是只有「启动」有阻塞项，之后的数据问题由计算口径自动降级，人的判断以标记形式跟着结果走；人工评估页首给一句提示 + 可选的「补判」，不补也能收尾。（修订（二）：按用户裁定）
4. §五 作答视图：跨阶段视图，从运行记录 / 人工评估 / 结果对比进入，按「题 × 组 × 次」定位、不露路径；一期两个视角（提交的报告按 markdown 渲染、判官引用段落就地挂判定；判定证据逐条），「过程」链 T69 的打开子会话；盲评开关一开即人工评估的视图，每格各自打分的契约不变；读取沿 cellArtifact 三条规则；「代码改动」diff 二期。
5. §四 题集：登记单位是仓库，worktree 不登记；版本由实验钉 commit，取题只读（git show / git archive，eval 不开 worktree）；可见层是题集属性、只管规划 / 分析 agent 能读到哪几层、默认只勾 modelFacing、只有人能改；选手隔离归 R3 与实验单元，不在此。**agent 往哪写 plan / analysis** 现在不定：ui-spec 写「待 T73 实施计划定」，并列两条候选——(a) eval 按实验开分支与 worktree（exp/<id>），人合并；(b) 实验成为部署级对象，plan 与 analysis 出仓库、存 eval 自己的状态目录，只引用 repo@commit，题库只读。提案 M4 的实施计划要求里把这一问列为第一题，连带 eval_repo_write 的白名单（G16）与 datasets_put_item 的写目标。
6. §六 工具：新增 eval_experiment_get（= eval_cells + eval_run_status 合成页面同源投影 + 作答索引，只读）；候选不唯一时返回错误、错误里带候选并要求 ask_user_question；未登记仓库直接拒绝；eval_repo_write 的写目标随第 5 条待定。
7. §七 八步流程：第 1 步改「定仓库 → 定版本（缺省最新）→ 定不下来就问人」；第 3、5、6 步「面」列还写着计划审阅、矩阵——改成四阶段的名字。
8. **会话里不放实验 chip**（用户裁定：一个会话可以有两个以上实验，放会话头还是 composer 插槽都显示不了）。退路三样：「实验」tab 标签上显示需要处理的实验个数 + 列表 + eval_run_status；标签能否重绘待证，放进 T72 或 T76 去证。datasets chip 去掉这条不变。（修订（二））
9. 事件回流到会话登记为 docs/upstream-seam-registry.md 的 S18（需求 / 现状绕行 = tab 计数 + 列表 + eval_run_status / 退役条件 / 状态：待实施），提案里指向它。（修订（二））
10. 提案同步改：D7 定义（第 3 条）、D8 推导（第 2 条）、D1 写位置（第 5 条）、无 chip（第 8 条）、S18（第 9 条）、D9（第 11 条）；状态仍 planned。提案与交互稿在主检出里是未跟踪文件，从 main 开的 worktree 里没有——拷进 worktree 作为新文件提交。交互稿里示例路径用 ~ 或描述性写法，不要 /home/… 这类字面绝对路径（hygiene 会拦）。
11. **D9 人工评估四个出口**（新增，写进 §五 人工评估行与 §九 状态词表）：提交终评 / 带标记提交 / 不做终评直接收尾 / 放弃终评。放弃终评后实验收成终态「评估不成立」，写进导出；「已完成」只在前三个出口之后出现；「带标记」的原话结论卡要原样显示。实现形状先定死一条：这些是 eval 的 run 级注解（同 T60 导出注解的做法），不加 mission 状态、不改账本状态机；ns 与字段在 T72 文案定。这条并进 T72，与结论先行一起做。

## 不做
不改代码；不改 iterations.md；不重开外壳讨论——用户走查 41dd6483 后若要改壳，协调者另起任务。

## 完成判据
ui-spec 每处改动能指到提案的 D 项或本文案的第几条；§五 表格四阶段每行读完能知道这页有什么、主动作是什么、谁来做；提案与 ui-spec 无矛盾；gate 绿（docs）。

## 回报
分支 + commit；ui-spec 改动清单（每条对应 D 项 / 本文案条号）；提案 diff 摘要；S18 原文。通用提醒照旧：合并归协调者，不混 checkpoint。
```

**后面协助前端验收的约定（T71 起，2026-09-23 与交互稿作者对齐）**：每个任务合入前，交互稿作者对照三样看——ui-spec 对应那行、交互稿对应场景、提案验收标准点名的单测（D7 四种情况；D8 要验 CLI 起的 run 不被误判为停滞），结论逐条回给协调者，合并仍归协调者。像素层只在收口时统一截一次：明暗两套 + 400px 宽度，在交互稿作者自己起的临时实例上截（独立 DSH_HOME + 空闲端口、源码模式、拷 3171 账本不拷凭据；配方随文案给），不用 3171、不经手任何 token。不自己改代码、不碰 3171 的看门狗。

**验收参照线（用户 2026-09-23 定）**：用户不满意的是内容、旅程和设计感，外壳不改。T71–T76 的前端验收以交互稿 v5 为参照，不只核 ui-spec 的字面：
- 按场景对照：实验设计、就绪清单、运行、人工评估、结果对比、列表，每页都要做到交互稿里那几点——结论先行、只有一个主动作、说人话、状态词一致、层次清楚。
- 视觉按「同等层次」判：交互稿按宿主风格画，页面只能用宿主 tokens，不要求像素一致；字号层级、留白、色彩语义要达到同一水平。
- 待证项单独看：tab 标签重绘、S18 这类依赖宿主能力的，做不到按提案的退路走，不算验收失败。
- 怎么验收：每个任务由实施者自己按 ui-spec §九 截图自查（临时实例配方随文案给，独立 DSH_HOME、不拷凭据）；收口时交互稿作者和协调者一起在真机上逐场景走一遍，差距写成一轮补充修完，再请用户走查。

**T70 验收（2026-09-23）**：`docs/eval-journey-spec`（`bfc84273`，单提交）合入 main `4a5f65b8`。ui-spec 11 条逐条有落点：§四 登记不绑定（仓库为单位、版本由实验钉、可见层是题集属性、写入模型待 T73 并列 (a)/(b)、chip 去掉、「导入题集」改「登记仓库」）；§五 硬口径「只有启动有阻塞项」、列表四组 + 本会话发起 + 「另有 n 个」、状态加终态「评估不成立」与推导态「停滞」（定义含「并且无进展」）、四阶段表逐行重写（实验设计两段、运行记录停滞提示与看作答、结果对比结论卡→判据表→效率→审计、第五条「判定覆盖一致」定义与「人只改一条不触发」、CI 按题数与「仅供参考」标、人工评估可做可不做 + 四个出口 + run 级注解）、新增作答视图与跨面旅程两节；§六 datasets-tool 读登记时勾的可见层、候选不唯一报错、eval_experiment_get、回读确认；§七 面名全换、第 1 步定仓库→定版本→问人；§九 状态词加两个带颜色、错误态示例改「重新登记」、术语表注明第五条。提案以新文件入库（planned），里程碑表加 T 列、实现记录记 T70、验收加体验参照线；S18 按登记处格式入库（需求 / 现状 / 绕行 / 建议官方改动 / 退役条件 / 状态）。两件协调者处理的：主检出里作者的两份未跟踪草稿与提交版有出入，移到 `scratch-storyboard/*.pre-t70.*`（git 忽略）后合并；main 上 gate 红的 package map 是 canvas 0.4.5 合入时漏了重生成，协调者重生成 `6180ff61`，main gate 11 步绿。作者的 worktree（真 node_modules）已随 worktree 删除。

### T71 · D7 结论校准：第五条校验「判定覆盖一致」、置信区间按题数、排名门槛不变（可发，2026-09-23）

```text
# 任务 T71：结论校准——第五条校验「判定覆盖一致」、置信区间按题数、排名门槛不变

## 背景
pilot-d-preset 的结果页现在显示「mean Δ = 4, 95% CI [4, 4]」：1 题 × 1 次，dsh-full 那格判官两次采样都报错、只剩脚本判定，dsh-lean 有判官初判——两组按不同来源的分数相减，报告没有任何提示。report.ts 的 comparePair 只在 n < 3 时拒绝排名（n = 各题配对次数的最小值），bootstrap CI 照算；ReportPage 只看 pair.ci 非空就渲染。T54 之后每格有逐判据的来源层（primaryPass 的 ns 映射、格级 sources），这条现在可检。口径正本是 ui-spec §五 结果对比行（T70 版）与 §九 状态词表，提案 D7。

## 先读
ui-spec §五 结果对比行、§九（T70 版）；提案 §「1. D7」与验收标准 1；report.ts：InvariantCheck（id 联合类型要加一个）、checkMaterialization / checkFingerprint / checkSubject / checkProcedure、comparePair（perTask、bootstrapBlocks、n、rankReason）、criteriaTablesOf、analyzeBundle 里 comparisonAllowed = invariants.every(ok) 那行；report-view.ts 的 pairs / invariants 投影；report-render.ts 第 69–71 行与 438 行（summary.md 的区间句与名次句）；client/ReportPage.tsx 的 invariantWhy 与 CI 渲染（233–243 行）、locales.ts 的 invariant.why.* 与 report.ci；judge.ts 的 failures（判官采样失败怎么记、进不进 bundle）；tests/report.spec.ts 的 S2 / S5 / 两个 T54 describe 与 frozen effort 夹具。

## 分支
从 main 开 worktree ../dsh-plugins-wt-report-calibration，分支 fix/eval-report-calibration；只改 packages/eval（report.ts、report-view.ts、report-render.ts、client/ReportPage.tsx、locales.ts、types.ts 若投影加字段、tests、README 双语 + sidecar）。T72 之后也会动 ReportPage（结论卡），本任务先合；若 main 先进了别的 eval 改动，合 main 按 graft 法解。

## 已定决定
1. 第五条校验 id verdict-coverage，标题「判定覆盖一致」。定义：对每一对比较的格（同题同次），每条判据要么在两格都有「已判」层的判定（human-final 与 llm-draft 同属已判），要么两格都没有；一侧只剩 script 或没有判定，即不通过。人只改了一条判据的终评不触发（两侧都是「已判」）。
2. 作用范围是这一对，不是整个比较节：前四条任一不过仍是整节不下发（现状不动）；第五条不过时这一对降级为描述——pairs 里保留 perTask 的分数，ci = null、rank = null，rankReason 写「判定覆盖不一致：<题> 的 <判据…> 在 <组> 没有判官 / 人的判定（判官缺席 / 仅脚本）」。invariants 里第五条的 status 是所有对的合取（任一对不过即 violated，details 逐对列原因）；comparisonAllowed 改成只看前四条（不再是 invariants.every(ok)）；criteriaTables 照旧只受前四条闸控。
3. 判官缺席 = 判官采样全部失败的格。先看 judge.ts 的 failures 进不进 bundle：进的话第五条的 details 用它写「判官缺席（2 次采样均失败：…）」；不进，就在本任务把失败摘要记成 orchestrator ns 的格级注解（只加不改，形状写进 Agent Note），report 读它。不做「补判」按钮（那是 T72 人工评估页的事）。
4. 置信区间按题数：k = 至少有一个配对差值的题数；k < 3 → ci = null，投影带 ciWithheld: { tasksWithDelta: k }，页面与 summary.md 写「只有 k 道题有差值，给不出区间」；k ≥ 3 → 照算。排名门槛不变：n = 各题配对次数最小值 ≥ 3 且 CI 不含 0；给了区间但 n < 3 时投影带 ciAdvisory: true，页面标「仅供参考，未达排名条件（每题需跑满 3 次）」，rankReason 照旧写「不可排名（n=1 < 3）」。
5. 悬停文案：locales 加 invariant.why.verdict-coverage（中英），invariantWhy 映射加一行；§九 五色照旧，不引新色。
6. summary.md（report-render）同步：区间句按第 4 条，438 行的名次句改成新口径。

## 测试（tests/report.spec.ts 新 describe「report — D7 verdict coverage and CI thresholds」，四种情况）
(1) 一侧判官、另一侧仅脚本（复用 T54 mismatch 夹具的形状，去掉推理强度不符）：第五条 violated、这一对 ci / rank 为空、rankReason 原文、criteriaTables 仍下发；(2) 两侧判官、一侧人改了一条判据：第五条 ok，不降级；(3) 1 题 × 1 次两侧都判官：第五条 ok，k = 1 → ci null 且 ciWithheld.tasksWithDelta = 1，rankReason n=1；(4) 3 题 × 1 次：ci 有、ciAdvisory true、不排名。另加 5 题 × 3 次照旧可排名的回归。真实 bundle 前后对照：~/.dsh/scratch/dataseek-eval-wt-t65/exports/run-20260918054718-8o0o-bundle，之前 Δ = 4、CI [4, 4]，之后第五条不过 + 无区间 + rankReason 原文。

## 完成判据
eval 测试全绿、tsc -b --noEmit、gate；真实 bundle 对照原文；README 双语改成「五条校验」与区间口径 + sidecar；Agent Note（Alternatives considered 双语：为什么按题数不按 n、为什么第五条只降级这一对不闸整节）。回报分支 + commit + 四种情况的测试名 + pilot-d 前后原文。交互稿作者合入前对照 ui-spec 那行与交互稿「结果对比」场景。通用提醒照旧：合并归协调者，不混 checkpoint。
```

**验收（2026-09-23）**：`fix/eval-report-calibration`（`5df1443a`，单提交）合入 main `b67b645f`。合并态在 detached worktree 离线装依赖后跑：eval 942 全绿（主检出的 node_modules 缺 js-yaml 与 react 的链接，跑不起来，不是回归），`tsc -b --noEmit` 干净。核过源码：`coverageGapsOf` 按同题同次的配对格逐判据比「已判」类别（human-final 与 llm-draft 同类），人改一条不触发；`comparisonAllowed` 在推入第五条之前算，判据表的闸只看前四条；`comparePair` 的区间只在无覆盖缺口且有差值的题 ≥ 3 道时算，`ciWithheld` / `ciAdvisory` 下发到页面与 summary.md，`rankReason` 顺序是覆盖缺口 → n < 3 → 多因子 → 因子未知 → 区间未给 → 区间含不含 0。pilot-d 的 summary 前后对照与文案一致（区间行消失、第五条 ❌ 带判官报错原文）。实施者提的三点：**① 短实验不再排名**（2 题 × 3 次、1 题 × 3 次不给区间因而不排名，此前能排）——这是「区间按题数」的直接后果：名次以区间是否含 0 为准，没有区间就没有名次；pilot D 这种单题实验从此永远只做描述。协调者按用户裁定的字面接受，但这条后果要用户知道（已在回复里问）；**② 降级那一对保留逐题均值与逐次差值、只去平均 Δ / 区间 / 名次**——接受，ui-spec §五 的「不给 Δ」改成这个说法，收口走查时交互稿作者一起看；**③ 判官缺席不加新注解、明细用 bundle 里 `judge-parse-failed` 的原文、写「判官调用 N 次均失败」**——接受，比「N 次采样」准确（pilot-d 的两次是同一采样的首试与重试）。Agent Note `.agents/notes/implemented/bug-fix/2026-09-23-eval-report-calibration.{md,zh.md}`，替代方案（按 n 给区间 / 第五道闸关整节 / 补判按钮）都有理由。实施者 worktree 已删。3171 不为 T71 单独重装，随 T72 一起。

### T72 · 实验室四阶段的旅程与结论先行：列表分组、停滞、就绪清单、结论卡、人工评估四个出口（可发，2026-09-23）

```text
# 任务 T72：实验室四阶段的旅程与结论先行——列表分组、停滞、就绪清单、结论卡、人工评估四个出口

## 背景
用户 2026-09-23 定的验收参照线：不满意的是内容、旅程、设计感，外壳（两个 tab、四阶段、向导）不改。ui-spec §五（T70 版）已把每一页「该让人做什么」写成正本；T71 把结论所需的字段（第五条校验、ciWithheld / ciAdvisory、rankReason）下发到了页面。本任务把 §五 里还没落地的内容一次做完：列表怎么分组、什么叫停滞、每页一个主动作、就绪清单、结论卡置顶、人工评估的四个出口。交互稿 v5（proposals/prototypes/eval-journey-redesign.html）的四个场景——列表、就绪清单、结果对比、人工评估——是对照参照，按场景对照、视觉同等层次，不求像素一致。

## 先读
ui-spec §五 全文（硬口径、列表、状态、详情四阶段表、跨面旅程）、§九（状态词表与颜色、错误态三段式、空态、数字与句子）；交互稿 v5 的四个场景；提案 §「D8」「D9」与第 1、2、3、11 条；T67 走查稿 scratch-screenshots/t67/walkthrough.md（14 行核对表与 W3–W15，别把已收的再做一遍）；packages/eval/src/client 的 LabView.tsx（列表与页顶状态 / 主动作）、DesignPage.tsx（validate 与环境检查现在怎么摆）、RunsPage.tsx、ReportPage.tsx（T71 后的 pair 渲染）、JudgingPage.tsx、store.ts、vocab.ts、locales.ts；服务端 matrix-view.ts（列表投影）、review.ts 与 readiness.ts（check code 全集：validate.ts / provision.ts / readiness.ts 里 `code: '…'`）、job.ts（EvalRunJobs：活 job 只在本进程）、export-note.ts（run 级注解的既有写法，T60）、finalize.ts、report-view.ts、types.ts 的 EvalRunReportView / EvalRunSummary；eval-tool 的 eval_run_status（状态词要同步）。

## 已定决定
1. **列表**（LabView）：一行一个实验——名称、题库版本、对比组数（+ 判官）、题数、次数、对比变量（由对比组 diff 推出，人话）、状态、进度、开始时间；草稿与 run 同列。四组：**需要你处理**（待批准、停滞、评估中且判官已判完等人工评估）/ **运行中** / **已完成**（含评估不成立）/ **已归档**。缺省「本会话发起」：按 run 的 originSession 过滤；没有 originSession 的 run（命令行发起）不隐藏——页首一句「另有 n 个不属于本会话」，点了切「全部」；切换记在 localStorage（try/catch）。动作：新建实验（向导，不动）；停滞行上「重跑」；归档 / 取消归档。
2. **状态词**（服务端推导，客户端只映射词与颜色）：草稿 → 待批准 → 运行中 → 评估中 → 已完成；另有被拒、已取消、**评估不成立**（终态，灰）、**停滞**（推导态，橙）。规则：
   - 评估中 = 格子都跑完、判官在判或已判完但还没走人工评估的出口；实验不会自己变成已完成。
   - 已完成 = 存在收尾注解且出口是 ①②③ 之一（见第 5 条）。评估不成立 = 出口 ④。
   - 停滞 = 非终态、本进程没有该 run 的活 job（EvalRunJobs）、**并且**账本上最近一次进展（任一格子的状态或注解时间）距今超过 10 分钟。两个条件缺一不算：命令行发起的 run 的 job 在 CLI 进程里，只看「没有活 job」会误判。停滞不写账本，列表与详情每次读都重新推导。
   - eval_run_status 回同一套词（eval-tool 只改词表映射，一个提交）。
3. **每阶段页顶：一条状态 + 一个主动作**（LabView 头部，四页共用）：草稿 → 「去 validate」；待批准 → 解决第一条阻塞项（按钮文字就是那条的修法，如「provision dsh-full」）；全绿 → 「批准并启动」（只有人能点，R1）；运行中 → 「看运行记录」；停滞 → 「重跑」；评估中 → 「去人工评估」；已完成 → 「看结果」；评估不成立 → 「看运行记录」；被拒 → 「重新检查」。
4. **实验设计下半段 · 就绪清单**（DesignPage）：validate 与环境检查的结果重排成两组。**阻塞项** = review 报 error 级的 code；**提醒** = warning 级。每条一句人话（词表按 code 建键，`readiness.<CODE>`，中英各一，键名只在悬停），后面跟**就地修复按钮**，按 code 家族映射：HOME_* / LOCK_* / SCOPE_NOT_PROVISIONED / PROVISION_* / CAPABILITIES_* → 「provision <对比组>」（走已有的 provision 动词，一步变 ready）；UNRESOLVED_FIELD（端点）→ 「改端点」（ConditionsPage 已有的就地改端点）；DATASET_ROOT_UNRESOLVABLE / COMMIT_UNRESOLVED → 「登记仓库」（打开题集 tab 的表单；表单本身是 T73 分支 1 的，T72 只负责跳过去）；CONDITION_FILE_MISSING / PLAN_* / CONDITION_* / JUDGE_* / EXPECTED_NS_* / STAGE_SCHEMA_* / ITEMS_EMPTY / CONDITIONS_EMPTY → 「让 agent 处理」。「让 agent 处理」只在输入框预填一句引用（「实验 <名> 的就绪清单第 k 条：<原文>」），不自动发送：先查宿主有没有 composer 插入 API（dsh-client-ui-tool / conversation 面）；没有就退路——复制到剪贴板并提示「已复制，粘到输入框」，并在回报里写明原文，协调者登记上游缝。上半段（规模、对比组表、计划网格、高级设置）T67 已做，不动；T74 的方案卡另做。
5. **人工评估四个出口**（JudgingPage 页底）：① 提交终评；② 带标记提交（必填一句理由）；③ 不做终评，直接收尾；④ 放弃终评（必填理由）。实现是 **run 级注解**，与 export-note.ts 同一写法：ns `eval-closure`，payload `{ kind: 'closure', exit: 'final' | 'flagged' | 'unreviewed' | 'void', reason: string | null, at: ISO, by: <人的会话或 cli> }`；一个 run 只认最新一条，exit=void 之后拒绝再写（终态）；不加 mission 状态、不改账本状态机。页首一句提示：有判官缺席的格（T71 的 coverageGaps 里 why=判官缺席）时写明哪几格，附可选的「补判」（走已有的重判动词）——不补也能收尾，不是阻塞项。队列筛选未评 / 已评 / 按题、并排打分是 T67 / T75 的，不动。
6. **结果对比 · 结论卡置顶**（ReportPage）：自上而下 ① 结论卡 ② 判据 × 对比组表（T54，不动）③ 效率（不动）④ 审计（默认折叠：配对差值原表、五条校验各带悬停解释、判官一致性、导出时刻与最新终评对照）。结论卡每对一条：排名句或 rankReason 原文（T71）；区间行 / 「只有 k 道题有差值，给不出区间」/ 「仅供参考，未达排名条件」（T71 字段）；一行判定来源——按收尾注解：final → 「来源：判官初判 + 人终评」、flagged → 同上并把理由原样显示在卡顶、unreviewed 或没有收尾注解 → 「判官初判，未经人工确认」、void → 整页只给「评估不成立：<理由>」与运行记录入口；一行「有效性校验 5/5 ✓」或「4/5 ⚠」，点开进审计；卡下是收尾 / 导出 / 「重新导出」（bundle 早于最新终评时）。单对比组：「当前为单对比组实验，无对比数据，下方是基线表现」。旧 plan 没有问题块（T74 的 rev14 字段）时只给配对结论，不显示空的问题栏。
7. **运行记录**（RunsPage）：网格上方在停滞时一句「停滞：已有 x 分钟没有进展，也没有在跑的任务」+「重跑」；其余 T67 已做，不动。
8. **归档**：run 级注解 ns `eval-archive`，payload `{ kind: 'archive', archived: boolean, at, by }`；只影响列表分组，不动账本。
9. 词表：所有新词进 vocab.ts / locales.ts（中英各一）；颜色只用 §九 的五色与宿主 tokens；错误态三段式；空态说下一步。宿主端拼中文句子的老问题（T66 句子半条）这次不修，但新加的字段一律结构化下发、由浏览器组句。

## 不做
向导（T63 / T67 已做）；方案卡与就地改数字（T74）；作答视图与并排盲评的重构（T75）；会话面实验卡、实验 tab 标签计数（T76）；协议文件；3171 重装另发。

## 分支
从本地 main（≥ b67b645f，含 T71）开 worktree ../dsh-plugins-wt-lab-journey，分支 feat/eval-lab-journey（不在主检出 pull）；改 packages/eval（README 双语 + sidecar），eval_run_status 词表在 packages/eval-tool 单独一个提交。同期 T73 分支 1 只动 datasets，无交叠；T73 分支 2 与 T74 都排在本任务之后。

## 测试
状态推导（评估中 / 已完成 / 评估不成立 / 停滞的四个条件，含「有活 job 不算停滞」「进展在 10 分钟内不算停滞」「命令行 run 无 originSession 仍列出」）；收尾注解四个出口、void 后拒写、最新一条生效；归档注解只影响分组；就绪清单的 error / warning 分组与 code → 修复按钮映射；结论卡按收尾注解切换来源句；列表「本会话发起」过滤与「另有 n 个」计数。客户端测试沿用现有 *.client.spec.tsx 的做法。

## 完成判据
eval / eval-tool 测试全绿，gate 绿。临时实例（配方随通用提醒；端口与模型配额是共享资源，开跑前报协调者；把 3171 的账本与会话拷过来、不拷凭据）上按 ui-spec §九 自查并截图（明暗两套 + 400px）：列表四组与「另有 n 个」；一个待批准实验的就绪清单（至少一条阻塞项带修复按钮、一条提醒带「让 agent 处理」）；pilot-d 的结果页第一屏是结论卡（第五条 ⚠、「判官缺席」原因、来源句「判官初判，未经人工确认」），审计折叠；人工评估页底四个出口，走一次「带标记提交」后结论卡顶显示理由、列表进「已完成」；走一次「放弃终评」后状态「评估不成立」、结果页只给理由；一个停滞实验（把某个跑了一半的旧 run 当样本，或用测试夹具）在列表「需要你处理」组并带「重跑」。逐场景对照交互稿 v5，回报里按场景写「做到 / 走退路 / 没做到及原因」。

## 回报
分支与 commit（eval-tool 单列）；Agent Note（Alternatives considered 双语）；gate；截图路径与场景对照表；「让 agent 处理」用了宿主哪个 API 或走了退路（原文）；停滞阈值 10 分钟落在哪个常量。通用提醒照旧。
```

**验收（2026-09-23）**：`feat/eval-lab-journey`（`e89d6615` 主体、`bb8d9693` eval-tool、`25ab0e27` 合 main、`7edc08a1` 截图自查七处）合入 main `ee0a01fc`。合并态在 detached worktree 离线装依赖、建包后跑：eval 998 / eval-tool 6 / datasets 246 / datasets-tool 7 全绿，tsc 干净。协调者看了四张图（列表全部范围、pilot-a 待批准的就绪清单、pilot-d 收尾前的结论卡、带标记提交后的结论卡）：四组分组与「另有 n 个」、停滞行带时长与「重跑」、页顶「还有 15 条阻塞项，先处理第一条」+ 主按钮就是第一条的修法、阻塞项逐条人话 + 修复按钮（改端点 / provision X / 让 agent 处理）、提醒里「题库版本还没钉住」+ 登记仓库、结论卡第一屏（对比组一对、判定覆盖不一致原文、来源句、有效性校验 4/5 ⚠）、人工标记原话在卡顶、来源句随出口变——到交互稿 v5 的同等层次。实施者的场景对照表诚实，「走退路」两条（停滞归「需要你处理」是 ui-spec 的原话，不算退路；「登记仓库」没有切 tab 的接口改弹对话框）接受；「让 agent 处理」用了宿主 conversation 的 input.setDraft，拿不到退回剪贴板。四个出口的 run 级注解 ns `eval-closure` / `eval-archive`，停滞阈值 `STALL_THRESHOLD_MS` 在 experiments.ts。Agent Note 写明的代价（没人收尾的旧 run 从此读作评估中——列表里「需要你处理」26 条大半是这个；别的进程里健康的 CLI run 单阶段满十分钟会读成停滞，账本没心跳）与 ui-spec 一致，接受。**记进 T72 补充（一）、等用户走查后一起发**：人工评估页首少了「判官缺席在哪几格 + 补判」的提示（ui-spec 有，只在结论卡与校验里出现）；「provision X」按钮英文；「评估中」与进度 0/1 口径不一（状态把 halted 格算已判，进度只数 done，实施者记的原有问题）；列表行没有每行专属主动作（去批准 / 去处理）；26 条旧 run 全进「需要你处理」，要不要「批量归档」或按日期折叠由用户定；列表行卡片化（问题原文、规模）等 T74 的 rev14 字段一起。部署阻塞（pack-dist 只改写 `workspace:^`）并进 T77，范围已改。实施者 worktree 已删。3171 重装等 T77 合入，文案见下。

### 3171 重装到 main（带上 T71 / T72 / T73 分支 1 + 2 / T77）（已完成，2026-09-24 16:30；核对见块后）

```text
# 任务：3171 重装到 main（T77 之后）

## 背景
3171 现在装的是 41dd6483（09-23 02:08）。main 之后合入了 T71（结论校准）、T72（实验室旅程与结论先行）、T73 分支 1（题库登记）、T73 分支 2（实验成为部署级对象：experiments/<id>/、条件库、导入、eval_analysis_write）、T77（源码模式安装修复，已合入 53b93082）。装 main ≥ 587c12ae。工具链固定 rc-0.1.5-rc.1（通用提醒）；宿主检出已是 rc.3，不从那里起。

## 先读
§三「T54 补充（三）」的重装配方与验收记录（guard 锚点、停实例、install.sh、supervise）；通用提醒里的坑（PATH / DSH_HOME 要导出；stop marker + TERM 那步自动模式会拦）。

## 步骤
1. 停 3171：`touch ~/.dsh-lab/state/watchdog-stop && kill -TERM <listener pid>`——这一步自动模式会拦，由用户手跑；你把 pid 与整行命令报出来等用户，不要绕。
2. guard 锚点（`DSH_HOME=~/.dsh-lab`）：先 checkpoint 当前部署（41dd6483），再 clear；装完 record deployment、supervise。锚点 worktree ../dsh-plugins-wt-eval-guard 与分支 guard/eval-3171 不得删、不得当普通分支清理。
3. 装：从本地 main（≥ 587c12ae）开 detached worktree → `CI=true pnpm install --frozen-lockfile --prefer-offline` → `export PATH=~/.dsh-toolchains/rc-0.1.5-rc.1/node_modules/.bin:$PATH; export DSH_HOME=~/.dsh-lab` → `install.sh --source <dir> --fresh`。不从 npm 装任何包。
4. 起实例、等看门狗就绪（stdout 里的启动 URL 证就绪），记就绪秒数；启动 URL 只打码回报，token 不进任何回报、不交给任何 agent。
5. 装后核对（活的 3171，页面或 Remote，不起新 run）：实验室列表四组与「另有 n 个」；pilot-d 结果页第一屏是结论卡（判定覆盖不一致、来源「判官初判，未经人工确认」、有效性校验 4/5 ⚠）；题集 tab 登记 dataseek-eval、跟踪 i1-walk，用「从旧绑定登记」合并三份旧绑定（对共享检出只读，HEAD 与 worktree 行数前后一致）；再导入 pilot-d：`dsh-eval import --from dataseek-eval@i4-pilot-d --instance <3171>`（只 git show，不 checkout；分支 2 验收时在临时实例上做过一遍，建 1 个实验、3 条条件）——`--instance` 要的 token 从 ~/.dsh-lab/state/eval-launch-token 读进命令、不回显、不进回报；确认列表里 pilot-d 的 run 配上实验、其余仍标「旧运行（未关联实验）」，实验设计页题库版本行是 `dataseek-eval/harness-comparison @ 短哈希`、无路径、无「未绑定」；eval_run_status 回新状态词。
6. 不做：清理 25 条旧托管 worktree（另有文案，重装之后由协调者放行）；不碰 ~/.dsh、~/.dsh-official、3080；不重跑任何实验；不动那两份带 room/created 事件的旧会话。

## 回报
装的提交、就绪秒数、锚点前后、第 5 步逐项原文（打码）、异常。通用提醒照旧。
```

**装后核对（2026-09-24）**：用户报「装完」，实施者回报没有转来；协调者只读核对：3171 监听在（node），`~/.dsh-lab` 的 profiles / skills / state 都在 16:30 更新，装的 eval 包里有 verdict-coverage（T71）与 importExperiments（T73 分支 2）、没有 setPlanNumbers（T74 是之后合的），`state/eval/experiments/` 下有导入的 pilot-d-preset-20260924-6cdf，登记表在。就绪秒数、锚点前后、第 5 步逐项没有回报，补不补由用户定。之后 main 又合入了 T73 分支 3 与 T74；下一次重装等 T76 / T75 合入。

### T73 · D1 + D2 会话去绑定、按仓库登记——第一步只出实施计划（可发，2026-09-23）

```text
# 任务 T73：会话去绑定、按仓库登记——第一步只出实施计划

## 背景
提案 D1 / D2；ui-spec §四（T70 版）已写「登记单位是仓库、版本由实验钉 commit、可见层是题集属性；agent 往哪写待 T73 定」。3171 上两个真实会话（615b1184、752e5ec8，cells-i1-p0-dsh-1 工作区）里 agent 因 datasets_list 只回「no dataset repository」而自己翻磁盘（read × 28、grep × 20）、显式传 repo 绕过登记、写分析要人手报 bundle 路径。跨 datasets / datasets-tool / eval-tool / eval / preset 提示词，先出计划评审再动手。

## 先读
ui-spec §四、§六、§七（T70 版）；提案 §「4. D1 + D2」全文与验收标准 4；packages/datasets/src/binding.ts、service.ts（134 / 154 行两句「no dataset repository」）、cli.ts 的 bind；datasets client 里 composer 的题集 chip 与题集 tab 的绑定表单；docs/dataset-authoring-protocol.md（plans / conditions / analysis 在仓库里的位置，v1-rev12）；packages/eval/src/draft.ts（eval_plan_draft 的写路径与 whitelist 参数）、repo-write.ts（G16 白名单原文与理由）、faces.ts 的 dataset 面、T68（resolveDatasetRoot 优先 plan 的 dataset.repo）、T35a 的 run ↔ plan 配对（解析路径或 planSha）；profiles/web-eval/skills/eval-planning/SKILL.md（agent 现在被教的流程）；Agent Notes 2026-08-19-datasets-store-m1、2026-09-16-eval-plan-draft；proposals/active/2026-08-19-datasets-store.md、2026-08-23-dataset-authoring-protocol-skill.md（绑定确认流）。一条纪律：题库仓库 ~/.dsh/scratch/dataseek-eval 是多个 agent 共享的检出，HEAD 不能动，写操作走 worktree——今天每个会话绑的其实是各自的 worktree。

## 交付（第一步）
一份两到三页的实施计划 profiles/web-eval/docs/t73-registry-and-write-model.md，协调者与用户评审后才开第二步。计划必须回答：
1. 写入模型（第一题）：在 (a) eval 按实验开分支与 worktree（exp/<id>，人合并）与 (b) 实验成为部署级对象（plan / conditions / analysis 出仓库、存 eval 自己的状态目录，只引用 repo@commit，题库只读）之间推荐一个，逐项写代价：run ↔ plan 配对（T35a）怎么改；已有 plan 迁移还是兼容读；分析初稿怎么回到仓库（要不要一步显式「发布」）；协议改到哪个 rev；G16 白名单与 datasets_put_item 的写目标怎么重写；bundle 里 planSha 的意义有没有变。提案倾向 (b)，你可以不同意，但要给理由。
2. 登记处：存在哪（部署级状态）；登记表单复用绑定确认流的哪几段；一个仓库多个题集怎么列；「最新版本」怎么算（只读读 HEAD，还是记登记时的 commit）；取题只读的实现（git show / git archive 到物化目录，不开 worktree）。
3. 可见层：从会话绑定迁到题集属性后，datasets 读工具的白名单从哪读；非 eval 场景要不要保留可选的「会话收窄」，给结论与理由。
4. agent 的选择规则：datasets_list 的返回形状（登记的仓库 + 各含哪些题集 + 最新版本）；候选不唯一时的错误原文（带候选清单 + 一句「请用 ask_user_question 让人选择」）；未登记仓库的拒绝原文；eval_plan_draft 的 repo 参数改成登记 id 还是路径；SKILL.md 与 preset 提示词要加的规则原文；「跳过本题 = 不起草、停下等人」怎么落。
5. 迁移与兼容：现有会话绑定文件、现有 plan 的 dataset.repo、T68 的规则怎么退场；3171 上已有的 run 与 pilot-d 的 bundle 在新口径下读得出来。
6. 验证方案：pilot 一轮的脚本——新会话说「用 harness-comparison 比一下 lean 和 full」，预期 datasets_list 一次命中、版本有歧义时 ask_user_question 后停下、全程无对共享检出的 read / grep、未登记仓库被拒；判据写成可核的原文，跑在 3171 或临时实例上（写清用哪个、要不要协调者放行）。
7. 切片：第二步拆成几条分支（datasets + datasets-tool 一条、eval + eval-tool 一条、SKILL 与提示词一条），谁先谁后，与 T72 / T74 在 eval client 上的文件重叠怎么排。

## 不做（第一步）
不改代码、不改协议文件、不动题库仓库、不碰 3171。

## 回报
计划路径 + 一屏内摘要（推荐哪条路、最大代价是什么、第二步几条分支）。通用提醒照旧。
```

**第一步验收（2026-09-23）**：`docs/t73-registry-plan`（`adfc5233`）合入 main `c1b70a4d`，计划正文 `profiles/web-eval/docs/t73-registry-and-write-model.md`。现场数据协调者只读复核全部成立：题库 16 个本地分支、15 个未合回 main；main（09-03）0 份 plan；i1-walk 18 份 plan / 25 份条件 / 10 份 lock、领先 65；共享 `.git` 登记 38 条 worktree；items 树 main `2870f04` ≠ i1-walk / i4-pilot-d / i5-walkthrough 的 `4e7df0c`；3171 三份绑定——两条路径指同一仓库（`dataseek-eval-i5` 是同一 `.git` 的工作树）、一份指向已删的 wt-t60；pilot-d 的 plan `dataset.repo` 是工作树路径且 `commit: null`；条件文件带 preset / scope / home.sha / unit。代码引用（run.ts:2294 导出缺省 `<仓库>/exports`、validate.ts:168 resolveDatasetRoot、datasets service.ts:768 ensureWorktree、effectiveLayers、G16 白名单含 `docs/`、SKILL 两节原文、preset 前缀与 tool-fs-search）都对得上。**定案**：(b) 不设过渡期；条件与 lock 同搬部署级条件库；会话收窄不保留；配对 experimentId 优先、planSha 含义不变、旧 plan 逐字节导入；协议 **rev13 归 T73**（dataset 块 `{registry, set, commit}`，conditions / plans 出 §6.1），原记在 rev13 名下的 D5 三个字段顺延 **rev14**（ui-spec §四 / §五 已改）。**一条要用户知道的后果**：题库仓库对 agent 变纯只读，分析只随实验目录与 bundle 走，v1 不做「发布回仓库」；G16 白名单里的 `docs/`、plans、conditions 一并退场——题库 `docs/` 的日志今后由人经 worktree 写。协调者按计划走；用户若要保留一条回仓库的路，在 T72 合入（分支 2 开工）前说。**五处修订**随分支 1 第一个提交改进计划正文：datasets_list 不回 `experiments`（datasets-tool 只依赖 datasets，不能反向依赖 eval；版本候选本来就归 eval_plan_draft）；分支 1 保留 eval 还在读的 `DatasetsBindingFace.binding()` 与 `worktreePath` 的返回形状（路径即接口，run.ts:849 拿路径算 materialization.json，不感知 worktree 还是 archive 目录），绑定退场归分支 2；3171 正式登记跟踪 i1-walk 不是 main；工具拒绝文本与 SKILL / preset 规则沿用现有英文，计划里的中文原文作语义规格，试点判据的检查串同改；CLI / slash 的 run 在 (b) 下如何指实验补进分支 2 清单。38 条托管 worktree 的清理要写共享 `.git`，协调者在 3171 装上分支 2 后安排。实施者报告的一件事：开工时在主检出跑了 `git pull --rebase`，565 步在第 15 步冲突，当场 abort；协调者核过主检出 HEAD `a21f7400`、无 rebase 残留、未跟踪文件与之前一致。上游其实就是 origin/main（本地 main 领先 733、落后 0），rebase 目标 `302f6756` 正是 origin/main 的头——不是上游配错，是这台机器的 main 本来就由人协调推送、不能 pull；memory 已改正。

### T73 第二步 · 分支 1 · 数据集登记表（datasets + datasets-tool）（可发，2026-09-23）

```text
# 任务 T73 第二步 · 分支 1：数据集登记表（datasets + datasets-tool）

## 背景
T73 第一步计划已评审通过（profiles/web-eval/docs/t73-registry-and-write-model.md，main c1b70a4d）：写入模型定 (b)，不设过渡期；条件与 lock 同搬部署级；协议 rev13 归 T73（dataset 块 {registry, set, commit}），T74 的 D5 字段顺延 rev14。计划有七处修订，随本分支第一个提交改进计划正文（只改文档），然后按计划 §二、§三、§四、§五 做 datasets + datasets-tool 这条分支。分支 2（eval + eval-tool）等 T72 合入后开，分支 3（SKILL / preset）随分支 2。

## 先读
计划全文；packages/datasets/src/binding.ts、service.ts（resolveScope / effectiveLayers / snapshot 与 service.ts:768 的 ensureWorktree）、worktree.ts（ManagedWorktree：路径即接口）、cli.ts 的 bind 与 worktree 子命令；datasets client 的 BindForm / BindingChip；packages/datasets-tool/src/index.ts（读工具的 repo 参数与拒绝文本）；packages/eval/src/faces.ts 的 DatasetsBindingFace（458 行）与 datasets 面的 worktreePath（40 行）、eval/src/service.ts:361（eval 今天怎么读绑定）、eval/src/run.ts:849（eval 只拿 worktreePath 返回的路径算 materialization.json）；ui-spec §四（T73 定案后的措辞）、§六 datasets-tool 行、§九。

## 计划修订（第一个提交，只改计划文档，路径不变）
1. datasets_list 不返回 experiments 字段。datasets-tool 只依赖 datasets，实验目录归 eval，不能反向依赖；版本候选本来就由 eval_plan_draft 判定（计划 §四 SKILL 规则 2），「版本不唯一」的报错里列实验即可。datasets_list 只回登记表的事实：ref、title、trackedRef、latest{commit, date}、layers。
2. 分支 1 不能拆掉 eval 还在用的两个面：DatasetsBindingFace.binding()（eval service.ts:361 读）与 worktreePath 的返回形状 {path, commit, layers, reused}（run.ts:849 拿路径）。分支 1 新增登记面与绑定面并存，物化换实现不换形状；会话绑定的写入口（/datasets bind、BindForm 的会话段、BindingChip）可拆，读路径与三句 "no dataset repository" 在分支 2 一起退场。计划 §七 分支 1 那行写清哪些删、哪些留给分支 2。
3. 3171 的正式登记跟踪 i1-walk（协调者合并的集成分支；main 停在 09-03、0 份 plan、items 树与 i1-walk 不同），不是 main。试点为制造版本歧义而登记 main 的写法保留，注明「仅试点」。
4. 语言：工具拒绝文本与 SKILL / preset 规则沿用现有的英文（eval-tool、datasets-tool 的报错今天都是英文，SKILL.md 与 preset 前缀是英文）；计划里的中文原文作为语义规格保留，逐字英文在各分支落地时给出；试点判据 3、4、6 的检查串改成英文串（或中英各一，任一命中即过）。agent 停下时的固定回复句按人的语言说，判据 4 改为「该轮无工具调用、回复只有一句、语义是等人选定版本再起草」。
5. CLI / slash 的 run 入口在 (b) 下怎么指实验（eval run --experiment <id>；plan 路径只作导入与旧计划兼容）——补进计划 §一 或 §七 分支 2 的内容清单。分支 1 不做，计划要写。
6. 试点判据 7 写明 bundle 在哪：题库 wt-t65 工作树 exports 下的 run-20260918054718-8o0o-bundle（T71 也用它）；用相对说法，不写字面绝对路径。
7. 分支 2 的内容清单加「分析初稿的 GUI 查看」（用户 2026-09-23 问的，ui-spec §五 结果对比第 ⑤ 块已写）：Remote 加只读动词 experimentArtifact({experimentId, path})，规则同 cellArtifact（只读本实验目录、只读文本、超 256 KB 截断）；结果对比页折叠块渲染 analysis/ 下的 markdown；eval_analysis_write 写完的回读确认里给一句「在结果对比页可看」。分支 1 不做，计划要写。

## 分支 1 做什么（按计划 §二 / §三 / §四 / §五）
- 登记表 $DSH_HOME/state/datasets/registry.json：以 git common dir 的 realpath 为身份；字段按计划 §二；「最新」= git rev-parse <trackedRef>，不读 HEAD；Remote 动词 registry.list / register / update（可见层、跟踪分支、著作检出）/ remove；只有人（表单 / CLI）能写。registeredCommit 只作审计。
- 登记表单：BindForm 改造——路径 + 原生选择器 + previewRepo 实时判定；每集合一份层级 chips、默认只勾 modelFacing；跟踪分支下拉（列本地分支，缺省 main）；确认。「从旧绑定登记」一键：按 common dir 去重，悬空的标红跳过。删 BindingChip。题集列表按仓库分组，每集合一行「set · trackedRef@短哈希 · 日期 · 可见层」。§九 错误态三段式（路径不存在 / 不是 git 仓库 / 已登记过 → 各一句人话 + 修法）。
- 只读取数：单文件 git show 不变；整层读取改 git archive <sha> -- <paths> 解到 $DSH_HOME/state/datasets/materialized/<repoId>/<sha>/<set>/<layers-key>/，按内容寻址、只读、重复调用不重复解包，替代 ensureWorktree；从此不向共享 .git 登记 worktree。worktreePath 面的名字与返回形状不变（修订 2）；worktree.ts 与 cli 的 worktree 子命令若无人再调就删，写进 Agent Note。
- datasets_list 新形状（修订 1，不含任何以 / 或 ~/ 开头的字符串）；读工具的 dataset 参数只收「<登记 id>/<set>」，传路径即使已登记也拒绝并在拒绝文本里给出对应 id；候选不唯一（带候选清单 + 一句请用 ask_user_question 让人选）/ 未登记（不在本部署的登记里、请人去登记、不要自己读目录）两类拒绝文本，英文，语义按计划 §四。
- 读工具白名单改读登记表每集合的 layers（effectiveLayers 三分支逻辑保留，输入从会话绑定换成登记表）；operator 调用照旧不过滤。
- datasets_put_item 只写登记里人明确指定的著作检出（必须与登记同一 common dir），没指定就拒绝并说去登记表填。
- 会话绑定读路径保留（修订 2）；/datasets bind 改为提示去登记；旧绑定文件不自动删，发版说明列路径。
- 38 条托管 worktree 的清理（unlock + remove + prune）写共享 .git，本分支不做；清理命令写进 Agent Note，协调者在 3171 装上分支 2 后安排。

## 不做
不动 eval / eval-tool（分支 2）；不动 SKILL / preset（分支 3）；不改协议文件（rev13 随分支 2）；不动题库仓库（对共享检出只 git show / archive / rev-parse，不建 worktree、不动 HEAD）；不碰 3171。

## 分支
从本地 main 开 worktree ../dsh-plugins-wt-t73-registry，分支 feat/t73-datasets-registry（不在主检出 pull）；改 packages/datasets、packages/datasets-tool（README 双语 + sidecar）；第一个提交只改 profiles/web-eval/docs/t73-registry-and-write-model.md。与 T71（packages/eval）无文件交叠，可并行。

## 测试
登记表读写与 common dir 去重；trackedRef 解析与「最新」（分支不存在时的拒绝）；git archive 物化按内容寻址、重复调用命中缓存、不存在的 sha 与越界路径拒绝；datasets_list 返回不含以 / 或 ~/ 开头的字符串；dataset 参数三类拒绝文本；层白名单从登记表读、operator 不过滤；put_item 未指定著作检出即拒；旧绑定一键登记的去重与悬空跳过；eval 侧 worktreePath 契约测试仍绿（形状不变）。

## 完成判据
datasets / datasets-tool 测试全绿，gate 绿；eval 测试不动也绿。临时实例（配方随通用提醒；端口与模型配额是共享资源，开跑前报协调者）上：登记表单登记 dataseek-eval、跟踪 i1-walk，题集 tab 列出 harness-comparison · i1-walk@短哈希 · 可见层；datasets_list 一次命中、返回无路径；「从旧绑定登记」把 3171 那三份合成一条、悬空的标红；共享检出的 git rev-parse HEAD 与 git worktree list | wc -l 前后一致。截图（明暗 + 400px）登记表单、题集列表、一条拒绝文本。

## 回报
分支与 commit（计划修订单列）；Agent Note（Alternatives considered 双语）；gate；哪些绑定代码留给分支 2 的清单；共享检出前后核对数；截图路径。通用提醒照旧。
```

**分支 1 验收（2026-09-23）**：`feat/t73-datasets-registry` 五个提交（计划修订 `2392f95f`、`791e163a`；主体 `8b468639`；Agent Note 补清理排除 `7f89ade3`；真机修三处 `201fb6cc`）合入 main `036910ed`。合并态在 detached worktree 离线装依赖、建包后跑：datasets 246 / datasets-tool 7 / eval 942 / eval-tool 5 全绿，三包 tsc 干净。协调者看了列表明暗 1440 与 400、拒绝语暗色：登记表按仓库分组、题集行「i1-walk@d9af6bc · 2026-09-18 · agent 可见：visible」、窄屏换行、拒绝语三段式（标题 / 修法「点编辑登记」/ 详情折叠）、宿主 tokens；「从旧绑定登记」把 3171 两份有效绑定并进一条、wt-t60 标红「路径已不存在」。Remote 的 list 返回摘录无路径；共享检出前后 HEAD `050e22d1`、38 行 worktree 都没变；实例 pid 核对后停、临时 home 已删、无凭据。实施者报的五件：① `install.sh:327` 同族包漏 devDependencies——协调者核过 local-files 第 102 行确有 `workspace:*`，立 T77，下一次重装前置；② 3171 会话库里两份 cwd 在 `.worktrees/room-coordinator-runtime/…` 下的会话（09-19 写的，`room/created` 事件）rc.1 宿主拒绝解析，选中它们时题集页报加载失败——不是 eval 的缺陷，是别的运行时写进 `~/.dsh-lab/sessions` 的，交用户定去留，协调者不动；③ ankh-guard 泳道红是负载（main 基线 10 个失败是分支 3 个的超集），接受；④ 计划修订第 7 条在分支 2；⑤ 3199 / 3171 / 题库都没碰。协调者记两条小事给分支 2：题集行「用于：…」列的计划名有重复（t29d-container-egress × 3 等，按文件出现次数列的），分支 2 把「用于」换成实验目录里的实验后自然消失；25 条旧托管 worktree 的清理排除 `~/.dsh/state/…`（3182），等 3171 装上分支 2 后协调者跑。实施者 worktree 已删。

### T73 第二步 · 分支 2 · 实验成为部署级对象（eval + eval-tool，收绑定尾巴）（已完成，2026-09-24 验收见块后）

```text
# 任务 T73 第二步 · 分支 2：实验成为部署级对象（eval + eval-tool），收绑定的尾巴

## 背景
T73 计划（profiles/web-eval/docs/t73-registry-and-write-model.md，含七处修订）定 (b)：实验是部署级对象，题库只读。分支 1 已合入 main（登记表、git archive 物化、datasets_list 新形状、dataset 参数只收登记 id、put_item 写著作检出、旧绑定一键登记；写绑定的入口都退役，读路径留给本分支）。本分支做 eval 侧，并把 datasets 里留给分支 2 的绑定读路径一起拆掉。等 T72 合入后从 main 开（T72 改 DesignPage / LabView / ReportPage，本分支也碰）；T74 排在本分支之后。

## 先读
计划 §一（(b) 各维度）、§四（版本判定与三类报错语义）、§五（迁移）、§七 分支 2 行与修订 5、7；分支 1 的 Agent Note .agents/notes/implemented/architecture/2026-09-23-dataset-registry.md（留给分支 2 的清单：DatasetsBindingFace.binding()、binding.ts 读路径、resolveScope 的绑定分支与三句 "no dataset repository"、repo 配置兜底、CLI 的 binding / unbind）；packages/datasets 的 registry.ts / materialize.ts 与 service 的 registry 面；packages/eval/src 的 draft.ts（eval_plan_draft 写路径）、repo-write.ts（G16）、validate.ts（resolveDatasetRoot、T68）、run.ts（runCreate、exports 缺省 2294 行、run.meta 的 dataset 快照）、report-view.ts（run ↔ plan 配对、planSha）、export-note.ts、cell-artifact.ts（三条读取规则）、experiments.ts、faces.ts 的 datasets 面与 DatasetsBindingFace、service.ts:361、slash.ts 与 cli.ts 的 run 入口；packages/eval-tool 的工具清单；docs/dataset-authoring-protocol.md（v1-rev12 §6.1、§6.2）；ui-spec §四（写入模型定案）、§五 实验设计与结果对比第 ⑤ 块、§六、§七。

## 做什么
1. 实验目录 $DSH_HOME/state/eval/experiments/<expId>/：plan.json（协议文档原样）、meta.json（name、originSession、createdAt、dataset {registry, set, commit}、experimentId）、analysis/、exports/（导出缺省位置，plan.exports 与 options.exportsDir 覆盖照旧）。expId 生成规则写进 Agent Note，人话名从 plan.name 来。
2. 部署级条件库 $DSH_HOME/state/eval/conditions/<id>.json + <id>.lock.json：eval_conditions、provision、改端点、起草都读写这里；条件哈希与 lock 语义不变。
3. eval_plan_draft：参数 dataset: "<登记 id>/<set>"（只收登记 id）、commit 可选；不传 commit 时按计划 §四 判定版本——候选 = 跟踪分支最新 + 同集合里已有实验钉住的、且用到本次请求条件的提交；items/ 与 schemas/ 树哈希相同不算歧义；不唯一即拒绝并列候选、一句请用 ask_user_question 让人选、人跳过就停下（英文，语义按计划）；commit 传了但不在候选里同样拒绝并附候选。起草只写实验目录，回读确认。
4. run ↔ plan 配对：新 run 的 run.meta 写 experimentId，配对先看它；旧 run 回落 planSha → planPath；planSha 含义不变。列表里未导入的旧 run 显示「旧运行（未关联实验）」，报告照常打开（只读 run.meta）。
5. eval_repo_write 改名 eval_analysis_write：白名单只剩 analysis/<path>，根是实验目录；写完的回读确认里加一句「在结果对比页可看」。Remote 加只读动词 experimentArtifact({experimentId, path})，规则同 cellArtifact（只读本实验目录、只读文本、超 256 KB 截断并说明）；结果对比页第 ⑤ 块「分析初稿」（默认折叠，多份按文件名列、最新的展开，页面不露路径，没有就不显示）。
6. validate 改读物化目录：数据集根一律来自「登记 id + commit」经 datasets 面物化；resolveDatasetRoot 的 plan 同级回落只在导入路径保留。
7. 导入命令 eval import --from <登记 id>@<ref>（CLI 与 Remote 各一）：git show 从指定分支读 plans / conditions / locks，不建 worktree、不动 HEAD；plan 逐字节保留为 plan.json，meta 记 {registry, set, commit}（commit 来源：plan 自身的 commit → ref 的提交）；条件进条件库，哈希相同视为同一个，同 id 不同内容则拒绝并列差异。
8. run 入口（修订 5）：eval run --experiment <id> 与 /eval run <experimentId>；plan 路径只作导入与旧计划兼容，slash 与 CLI 的用法文本同改。
9. 协议 rev13：docs/dataset-authoring-protocol.md（中英 + sidecar）——plan 的 dataset 块改为 {registry, set, commit}，commit 必填；dataset.repo 降为 legacy 只读字段；§6.1 的 conditions / plans 从「题集级透传区」挪到「部署侧」并说明去向；analysis 同。协议里的 rev13 字样不能再留给 T74（T74 用 rev14）。
10. DesignPage：「未绑定」字样与会话绑定读取全部去掉；实验读自己钉住的 {registry, set, commit}；草稿的题库版本行显示「<登记 id>/<set> @ 短哈希」；页面上不出现任何路径。LabView 列表的题库版本列同改。
11. 收绑定的尾巴（datasets + eval）：删 DatasetsBindingFace 与 service.ts:361 的调用、binding.ts 读路径、resolveScope 的绑定分支与三句 "no dataset repository"（拒绝语改成分支 1 的两类：未登记 / 候选不唯一）、repo 配置兜底、CLI 的 binding / unbind；旧绑定文件不自动删，发版说明列路径。
12. 3171 旧 run 与 pilot-d bundle：runs 目录不动；bundle 自足，报告页不需要登记表。

## 不做
SKILL 与 preset 提示词（分支 3，随本分支同批或紧随）；agent 行为试点（分支 3 合入后按计划 §六 跑，本分支只把「版本不唯一」等报错做出来）；3171 重装（分支 2 + 3 合入后与 T72 一起，另发文案）；25 条旧托管 worktree 的清理（协调者）；T74 的方案卡与就地改数字。

## 分支
等 T72 合入 main 后，从本地 main 开 worktree ../dsh-plugins-wt-t73-experiments，分支 feat/t73-eval-experiments（不在主检出 pull）；改 packages/eval、packages/eval-tool、packages/datasets（只收尾巴）、docs/dataset-authoring-protocol（rev13）；README 双语 + sidecar；协议文档单独一个提交。与 T72 无并行；T74 在本分支之后开。

## 测试
实验目录与条件库的读写；版本判定四种情况（唯一 / 树哈希相同 / 不唯一 / commit 不在候选）与报错文本；配对 experimentId 优先与旧 run 回落；eval_analysis_write 白名单与 experimentArtifact 越界、大小；导入逐字节保留、条件同 id 冲突拒绝；validate 从物化目录读；run --experiment 入口；绑定读路径删除后 eval / datasets 测试全绿。

## 完成判据
eval / eval-tool / datasets 测试全绿，gate 绿。临时实例（配方随通用提醒；工具链 rc-0.1.5-rc.1；不配 provider；端口与配额开跑前报协调者）上：登记 dataseek-eval 跟踪 main（仅试点，制造版本歧义）并 eval import --from dataseek-eval@i4-pilot-d 只导 pilot-d-preset 及其条件；经 Remote 调起草不带 commit，返回含「版本不唯一」与两个候选（main 最新与 fd04079）；列表里旧 run 显示「旧运行（未关联实验）」，导入后按 planSha 归位；pilot-d bundle 的报告页打开、数字与 3171 一致，第 ⑤ 块渲染一份手放进 analysis/ 的 markdown；实验设计页无「未绑定」、无路径；共享检出 HEAD 与 worktree 行数前后一致。截图（明暗 + 400px）：实验设计的题库版本行、结果对比的分析初稿块、列表的「旧运行」行。

## 回报
分支与 commit（协议文档单列）；Agent Note（Alternatives considered 双语）；gate；版本不唯一的返回原文；导入结果（几份 plan、几条条件、有无冲突）；截图路径；共享检出前后核对数。通用提醒照旧。
```

**验收（2026-09-24）**：`feat/t73-eval-experiments`（`1cdea3f4` datasets 绑定尾巴、`150a52eb` eval 主体、`20e6e69f` 协议 rev13 单列、`68791bb1` datasets-tool 测试跟进、`e60b6219` / `a8c4bbb1` 临时实例验收修的两处、`cdea013e` Note 补记）合入 main `587c12ae`。合并态在 detached worktree 离线装依赖、建包后跑：eval 1030 / eval-tool 6 / datasets 238 / datasets-tool 7 全绿，tsc 干净。协调者看了三张图（列表 22 条：pilot-d 配上实验、其余 21 条「旧运行（未关联实验）」徽标不再被名字吞；设计页题库版本行 `dataseek-eval/harness-comparison @ 07fde76`、无「未绑定」无路径；第 ⑤ 块两份分析、最新展开旧的折叠）。完成判据里一条没按字面过：pilot-d 的 run 配对走的是 planPath 不是 planSha——那个 run 从计划后来的修改版（07fde763）起跑，记的 planSha 与 fd04079 导入字节算出的不同；配对三键由强到弱 experimentId → planSha → planPath 以 source.path 结尾，planPath 是兜底不是主路径，接受，ui-spec 不改。「版本不唯一」拒绝原文（`version is ambiguous for …`，列候选、要求 ask_user_question、跳过就停）与「不在候选里的 commit 同样拒绝」都做到、什么都不写。分析初稿块现在是 `<pre>` 等宽原文而非 markdown 渲染，记进 T74 顺手一条。发布说明：旧绑定文件 `$DSH_HOME/state/datasets/bindings/<session>.json` 不自动删。共享检出前后 HEAD 050e22d1、worktree 38 行不变；3196 / 3199 / 3171 没碰，3207 用完即停。Agent Note：`.agents/notes/implemented/architecture/2026-09-23-eval-experiments-deployment-level.md`。分支 3 文案见下；三条合完、试点过，T73 才算验收。

### T73 第二步 · 分支 3 · SKILL 与 preset 提示词按登记模型改写，并跑 agent 行为试点（文本已合入 `ed9e62f9`；试点等 provider，2026-09-24）

```text
# 任务 T73 第二步 · 分支 3：SKILL / preset 提示词改写 + agent 行为试点

## 背景
分支 1（题库登记，main 036910ed）与分支 2（实验成为部署级对象，main 587c12ae）已合入：agent 只经 datasets_list 选登记项；eval_plan_draft 的 dataset 只收「登记 id/题集」，版本不唯一时拒绝并列候选（原文 version is ambiguous for …，要求 ask_user_question，跳过就停）；eval_repo_write 改成 eval_analysis_write 只写实验目录 analysis/；eval_experiment_get 归 T76、还没有。profile 文本还是旧模型：SKILL.md 第 98 行起「The repository is not yours to pick」一节让人跑 /datasets bind，第 119 行「Drafts live in the repository working copy」；preset 人设前缀说 you read the dataset repository。本分支只动 profile 文本，然后按计划 §六 跑试点；三条分支合完、试点过，T73 才算验收。

## 先读
profiles/web-eval/docs/t73-registry-and-write-model.md §四（SKILL 五条规则与 preset 三行；修订 4：落地沿用英文，中文是语义规格）与 §六（试点脚本、8 条判据）；分支 2 的 Agent Note（.agents/notes/implemented/architecture/2026-09-23-eval-experiments-deployment-level.md：版本不唯一、条件冲突、analysis 写门三处原文）；分支 1 的 Agent Note 与 packages/datasets-tool/README（三类拒绝文本）；profiles/web-eval/skills/eval-planning/SKILL.md 全文；profiles/web-eval/presets/eval/agent.cordis.yml 的人设前缀；profiles/web-eval/README.md 第 148 行档位表、docs/architecture.md 里 worktree_path / bind 的提法；通用提醒里的临时实例配方。

## 分支
从本地 main（≥ 587c12ae）开 worktree ../dsh-plugins-wt-t73-skill，分支 feat/t73-skill-prompt；只改 profiles/web-eval 下的文本（SKILL.md、presets/eval/agent.cordis.yml、README 双语 + sidecar、docs/architecture.md 两处提法）；不改任何包代码——试点若暴露代码缺陷，记原文报协调者，不顺手修。

## 已定决定
1. SKILL.md：整节替换「The repository is not yours to pick」为计划 §四 的五条规则（英文落地，语义逐条对应：只从 datasets_list 选；版本由 eval_plan_draft 判定、报不唯一就 ask_user_question 且选项就是报错里的版本；人跳过就本轮不起草、不调写工具、回一句等人选定版本再起草；不用 read / glob / grep / bash 看题库仓库，看题目用 datasets_* 读工具；仓库没登记就告诉人去登记，不替人登记、不去读那个目录）。删「Do not commit anything. Drafts live in the repository working copy…」，改成草稿存在部署里的实验目录、仓库只读。写分析的段落改说 eval_analysis_write（experiment + analysis/ 下的路径，回执会说在结果对比页可看），引用格子按 eval_cells 的「题 × 组 × 次」；eval_experiment_get 等 T76，先不提。
2. preset 人设前缀追加三行（英文落地，语义：数据集只认 datasets_list 的登记项、不读仓库目录；名字或版本不唯一时 ask_user_question 让人选，人跳过就停下不起草；实验草稿写在部署里，不写数据集仓库）。「you read the dataset repository」改成读登记的题集。不去掉 tool-fs-search（计划的可选收紧，看试点第 5 条再定）。
3. README / architecture 里 bind、worktree_path 的提法改成登记与物化；档位表 datasets 一行按分支 1 的 datasets-tool README 对齐；不改 iterations / ui-spec（协调者管）。
4. 试点按计划 §六，在临时实例上（配方随通用提醒；工具链 rc-0.1.5-rc.1；端口开跑前报协调者）。试点要真的让 agent 起草，实例要有一个 provider：你不配、不复制任何凭据文件——起实例后把启动链接写进临时 home 下一个 0600 文件，回报里只给路径，由用户自己打开配置 provider 后告诉你；用哪家、配额多少由用户定。准备：登记 dataseek-eval 跟踪 main（制造版本歧义）、dsh-eval import --from dataseek-eval@i4-pilot-d 只导 pilot-d-preset、记共享检出 HEAD（050e22d1）与 worktree 行数（38）。两个会话、8 条判据逐条核对：第 3 条的英文串是 version is ambiguous；第 6 条是 is not registered in this deployment 或分支 1 的等价原文；判据 7 的 bundle 在题库 wt-t65 工作树 exports 下的 run-20260918054718-8o0o-bundle。
5. 判据不过的：属 profile 文本的当场改、再跑一轮；属代码的（工具返回、拒绝文本、页面）记原文报协调者，不修。

## 不做
不动 packages/*；不登记到 3171、不在 3171 上跑；不跑完整实验（起草到 ask_user_question 为止，跳过后就停）；不删 tool-fs-search；不复制凭据。

## 完成判据
profile 文本三处改完、hygiene 钩子过；试点 8 条判据逐条有结论（过 / 不过 + 原文）；共享检出前后 HEAD 与 worktree 行数一致；临时实例停掉、临时 home 删除；token 与凭据不进回报。

## 回报
分支与 commit；SKILL / preset 改动前后摘录；试点 8 条判据的逐条结论与工具日志摘录（打码、去绝对路径）；试点暴露的代码缺陷清单；用的端口与 provider 名（不含凭据）。通用提醒照旧。
```

**文本验收（2026-09-24）**：`feat/t73-skill-prompt`（`637b47f7`）合入 main `ed9e62f9`——试点前先合，因为旧文本让人跑已退役的 /datasets bind，本来就错。SKILL「Datasets are registered, not found」五条与计划 §四 逐条对应（只从 datasets_list 选、版本由 eval_plan_draft 定、跳过即停不起草、不读仓库目录、没登记就告诉人去登记）；preset 前缀三行；README / architecture 的 bind → 登记、worktree_path → 按钉住 commit 物化。超范围一处 `scripts/web-eval-install.spec.ts`：旧断言写死「Do not write plans/*.json」，改成新措辞并加两条（只从 datasets_list 取、跳过即停），合理。留一条小项：SKILL 第 2 步仍写「实验室 › 计划审阅」（T67 已并进实验设计），随试点后的文本修订一起改。**试点准备已好**：临时实例 3185（rc.1 工具链，临时 home 由实施者持有），登记 dataseek-eval 跟踪 main（d69f043），只导 pilot-d-preset（pilot-d-preset-20260924-df1f，钉 fd04079，条件 dsh-lean / dsh-full / t31-judge-other），共享检出前后 HEAD 050e22d1、38 行不变；判据 7 已过（从 3171 账本只读拷了那一个 run，报告页文本与 3171 逐行一致，只差页脚的会话 token 统计）。**等用户**：打开实施者临时 home 下 launch-link.txt（0600）里的链接，在模型设置里配 provider（哪家、配额由用户定），告诉实施者是哪家；之后两个会话按脚本跑、8 条判据回报。

### T77 · install.sh 同族包漏 devDependencies（已完成，2026-09-24 验收见块后）

```text
# 任务 T77：install.sh 算同族包时把 devDependencies 里的 workspace:* 也算进去

## 背景
main 现在按源码模式装不出来，T73 分支 1 与 T72 两位实施者装临时实例时各自撞上、各自临时绕过、都没提交。两半原因：(1) profiles/web-eval/scripts/install.sh 第 327 行算同族包只看 dependencies 与 peerDependencies；(2) scripts/pack-dist.ts 第 343 行只把 workspace:^ 改写成同族版本，不管 workspace:*。e9110d52（preview-kernel 解部署阻塞）把 "@khorsheed/dsh-client-ui-content-preview": "workspace:*" 加进了 local-files / ui-file-preview / worktrees 三个包的 devDependencies，于是 pack 时报 ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL。下一次 3171 重装以此为前置。

## 先读
install.sh 的 UNPUBLISHED_DIRS 循环（第 320–345 行）与 pack-dist 对 family 的用法；scripts/pack-dist.ts 的 rescope（第 275–350 行）与它已有的测试；packages/local-files、ui-file-preview、worktrees 的 package.json；e9110d52；上一次重装的记录（§三「T54 补充（三）」）。

## 做什么
两处一起修，缺一都还会撞：(a) pack-dist 打包前把 devDependencies 整段删掉——发布的 tarball 从不需要它，这是根治；并把 workspace:* 与 workspace:^ 一视同仁改写成同族版本，免得下一个进 dependencies 的 workspace:* 再撞。(b) install.sh 的 members 也算上 devDependencies 里的 @khorsheed/ 成员，只为 pack-dist 拿得到版本。pack-dist 的测试加用例：devDependencies 含 workspace:* 的包能 pack、产物 manifest 里没有 devDependencies、dependencies 里的 workspace:* 被改写；install.sh 没有测试就在 Agent Note 里写实测记录。

## 分支
从本地 main 开 worktree ../dsh-plugins-wt-install-family，分支 fix/install-family-devdeps；改 scripts/pack-dist.ts（含测试）与 profiles/web-eval/scripts/install.sh；不动任何 package.json。

## 完成判据
从一个 detached worktree（CI=true pnpm install --frozen-lockfile --prefer-offline 之后）跑 install.sh --source <该 worktree> --fresh 到一个临时 DSH_HOME（realpath，不起实例）一次成功，产物目录里有 local-files 的 tarball；用完删临时目录。不碰 3171、~/.dsh、~/.dsh-official。

## 回报
分支与 commit；实测命令与结果（去掉绝对路径）；gate。通用提醒照旧。
```

**验收（2026-09-24）**：`fix/install-family-devdeps`（`7a0c92a2` 修复 + 测试、`ced3702e` Note）合入 main `53b93082`。两半都修了：pack-dist 的 dist manifest 整段删 devDependencies、`workspace:*` 与 `workspace:^` 同样改写成源码版本 caret（peerDependencies 与经 runtimeDependencies 保留的 dependencies）；install.sh 的同族成员算上 devDependencies。文案之外多改一处——`verifyTarball` 多收 `devDeclared`（源 manifest 的 devDependencies 映射到 dist 名），否则构建时内联兄弟包、只以 devDependency 声明的包会过不了自己的校验；理由成立，接受。实测：detached worktree 上 install.sh --source --fresh 到临时 DSH_HOME 退出 0，24 个成员、177 条 patch 行，local-files 的 tarball manifest 无 devDependencies、无 workspace:。合并态 pack-dist 测试 36 全绿。docs/packages.md 在 main 上因 canvas 0.4.7 过期（`c72062ca` 没重生成）——协调者随本次验收提交重生成。3171 重装的前置至此满足。

### T69 · 运行记录详情看得见「跑了什么、交了什么」：产物内联与过程回放（可发，2026-09-18）

```text
# 任务 T69：运行记录详情看得见「跑了什么、交了什么」——产物内联与过程回放

## 背景
用户 2026-09-18：「看不到每个 agent 的运行过程以及结果」。运行记录详情（T67）只列产物路径，写着「预览和下载要宿主的文件服务」；产物内容其实判官台已经能读（judge-bench 从 archive/workspace 读文件再去指纹）。过程：宿主轮的 childSessionId 是宿主会话，能 sessions.open；容器轮的选手是单元里的 sub-dsh，它的会话转录写在挂载进单元的 scope home 里——<DSH_HOME>/local-agent/dsh@<scope>/sessions/--workspace--/<sessionId>/session.v3.jsonl.zstd（delegations.jsonl 记委派 → 会话），宿主可读，只是没有任何注解或 UI 把它挂到格子上。判官的过程是宿主会话（sessions/--…-eval-judge-…--）。用户定：直接用宿主的子对话视图，不自己再渲染一次——宿主的会话持久层是扫目录认领的（sessions/<项目槽>/<id>/，协调者把 3171 的会话目录拷进临时实例后侧栏直接出现、能打开），所以容器轮的转录只要认领成宿主会话，就能走同一颗「打开子会话」。

## 先读
packages/eval/src/cell-detail.ts（artifacts、childSessionId 的来源）、judge-bench.ts（archive 读法）、client/RunsPage.tsx 的 RecordDetail；packages/local-agent-dsh 的委派记录（delegations.jsonl 写在哪、记了什么、结果里有没有 sessionId）；packages/local-agent 注册表暴露给 eval 的 face；T67 补充的 Agent Note；ui-spec §五 v2「运行记录详情」。

## 已定决定
- 文本产物内联：eval 的 Remote 加只读动词 cellArtifact({runId, missionId, attempt, path})：路径只能落在该格账本 attempt 目录或归档目录内（realpath 校验，越界拒），文本类（md / json / txt / yml / log）≤ 256 KB 直接返回，超限返回前 256 KB 并说明；二进制拒绝并说明。详情页的附件点开即看；这页不盲、不去指纹（盲评只在人工评估页）。
- 过程用宿主自己的子对话视图，不自渲染：
  - 判官与宿主轮：会话本来就在宿主，`sessions.open(id)`——运行记录详情已有「打开子会话」，判官那格加一颗「打开判官会话」（判官会话 id 已在判定记录 / 注解里）。
  - 容器轮：第一步先验证宿主能否认领磁盘上的会话——把一份 sub-dsh 会话目录复制到 <DSH_HOME>/sessions/_no-cwd/<id>/（容器 cwd 是 /workspace，宿主没有这个目录，走无 cwd 的槽位避开 workspace-attach），看 session/list 不重启会不会出现、sessions.open 对没经过 session/create 的会话开不开、有没有 workspace-attach-failed。三问都过就这么做：委派结束（或回读）时 eval 把该会话目录复制进宿主 sessions 树（不软链——scope 目录随 provision 重写），格子上记 childSessionId（与宿主轮同一个字段），标题写「<题> · <对比组> · 第 n 次 · 选手」；同一颗「打开子会话」。哪一问不过，写清原文，退回自渲染时间线（只在容器轮；Remote 加 cellTrajectory，读转录按 type 挑消息 / 工具调用 / 结果，原文折叠）。
  - 若 local-agent-dsh 现在不把 sessionId 交回编排器，就在它的委派结果里补这一个字段（只加不改），Agent Note 写清；不要按文件名或时间去猜。
- 结果对比页的配对表与判据表每格可点，跳到该条运行记录详情（同一个 store，选中那条记录）。
- 不做：产物下载、二进制与图片预览；不引第三方查看器。

## 分支
从 main 开 worktree ../dsh-plugins-wt-record-trajectory，分支 feat/eval-record-trajectory；改 packages/eval（README 双语 + sidecar），local-agent-dsh 若补字段单独成提交。与 T54（report.ts / ReportPage / JudgingPage）并行；本任务碰 RunsPage / cell-detail / remote / service，谁后合谁合 main，按 graft 法解。

## 测试
cellArtifact 越界与大小上限；容器轮会话认领（复制进 sessions 树、childSessionId 落格子、重启后仍在）；宿主轮与判官两条路的按钮；退回路线才测时间线。

## 完成判据
eval（与 local-agent-dsh 若改）测试全绿，gate 绿；3171 上打开 pilot D 的一格：stage1.md 就地能读，「打开子会话」开出宿主视图里 sub-dsh 那次对话（消息与工具调用都在）；判官那格同样。协调者临时实例复核。

## 回报
分支与 commit；Agent Note（Alternatives considered 双语）；gate；认领三问的原文与一格打开后的会话标题。通用提醒照旧。
```

**验收（2026-09-23）**：`feat/eval-record-trajectory`（`765bcc74`、`744c4378`、`13ff0dda`）合入 main `2be4b3bf`，合并态 eval 916、README 418 对同步。Agent Note：`.agents/notes/implemented/feature/2026-09-22-eval-record-trajectory.md`。三问原文、一格打开后的会话标题（选手 `dsh: run-…/p…`，判官 `Claude Code: run-…`）、越界拒绝原文都齐；local-agent-dsh 未改（sessionId 本就交回）。真机验收在活的 3171 上按 Remote 做的，像素层随 T54 合入后的重装一起看。

### T55 · claude 容器轮把实例登出——先方案后改（已完成，2026-09-18 结案）

```text
# 任务 T55：claude 容器轮不能再把实例登出——先出方案

## 背景
T33e 四家容器就绪：claude 宿主轮 ready（12.0 s），容器轮 NOT READY，探针那一刻 .credentials.json 被清空（accessToken / refreshToken 空串、expiresAt=0），实例本体随之登出，人要重登。与题库 pilot-b-log G9 逐字吻合，机制是三件事凑齐：
1. macOS 上 claude 的 OAuth 凭证有两个存储：keychain（按 CLAUDE_CONFIG_DIR 路径哈希的项）与 <homeDir>/.credentials.json。claude 2.1.236 起写 keychain、读文件，所以 provider 的 syncClaudeCredentialFile 在每次 spawn 前做 keychain → 文件这一个方向——容器轮也不例外，同步用的是宿主路径（claude-cli-provider.ts startClaudeCliRun 开头、live-driver.ts、records.ts claudeAuthenticated、index.ts 登录 watch）。
2. T20c 起容器轮 bind 挂的就是实例自己那个作用域目录（rw）；容器里是 Linux、没有 keychain，claude 只认文件：access token 过期 → 拿 refresh token 续期 → 新凭证写进挂载的文件。
3. 下一次 spawn 前的同步把 keychain 里的旧凭证盖回文件；再续期用的是已被消费的 refresh token → 被拒 → claude 清空文件 → 宿主也登出。
dsh 用 API key 不续期，不受影响；kimi / codex 是否有同款分叉，方案里顺带核一句。

## 先读
题库 docs/pilot-b-log.md G9、docs/i4-pilots-log.md「claude：不是镜像的问题，是 G9 那条旧账」（都在 i1-walk 分支；题库是多 agent 共享检出，只读用 git show，不 checkout）；packages/local-agent-claude-code/src/records.ts（readKeychainCredential、syncClaudeCredentialFile、claudeAuthenticated、credentialFileExpiry）、claude-cli-provider.ts 的 startClaudeCliRun 开头与 containerScopedHome、live-driver.ts 的同一处同步、provision.ts 注释里的 #47661；packages/local-agent/src 的 homeDir(name, scope)（T29）；packages/eval/src/run.ts 的挂载源（faces.localAgent.homeDir(harness, scope) 那段）与 unit.ts 里 mounts 的 readonly 字段；T20c / T29 / T33e 的 Agent Note。

## 分支
从 main 开 worktree ../dsh-plugins-wt-claude-container-creds，分支 fix/claude-container-credential-fork。第一步只交方案（写成 packages/local-agent-claude-code 下的一份提案文档或 Agent Note 草稿，不改代码）；协调者定案后进第二步，只改 packages/local-agent-claude-code（必要时 packages/eval 的挂载 readonly 一行），README 双语 + sidecar。

## 方案要回答的
- 候选至少三个，各写机制、改哪里、代价、对宿主轮有无影响：
  a. 同步改「新者胜」：spawn 前比较 keychain 与文件的 refresh token / expiresAt，文件更新就写回 keychain 而不是盖掉文件（keychain 只在 macOS 宿主有；Linux 宿主本来单存储）。
  b. claude 容器条件用容器专用命名 scope（T29 的 scope 字段），该 scope 的同步在登录完成后一次性做完、spawn 前不再 keychain → 文件——容器成为这个 scope 唯一的写者。
  c. 挂只读 + 容器内续期不写回：先证 claude 在只读目录下续期后的行为（在内存里用还是直接报错）；若报错则此路不通，写清楚。
  d. 其它你看到的。
- 推荐哪个，为什么；与通用提醒里的凭据规则（不复制凭据、只在 0600 文件与 keychain、每个 scope 各自 login）怎么对齐。
- 验证方法：不能真等 token 过期——写清怎么在本机造「容器轮续期后宿主同步」这个时序（例如把文件里的 expiresAt 改到过去让容器轮主动续期），以及怎么证同一 scope 事后宿主轮仍 ready。凭据一个字节都不进日志与回报。
- 与 T33f 的关系：T33f 是 dsh 两侧共用同一 scope 的愈合问题，降为观察项；本任务不碰它，但说一句 b 若采用是否顺带把 claude 的两侧共用也断掉。

## 完成判据
第一步：方案文档一份（候选 + 推荐 + 验证方法 + 代价），协调者定案。第二步：容器轮 claude 就绪 ready 之后，同一实例宿主轮 claude 仍 ready、/claude-code status 不掉；local-agent-claude-code 测试全绿，gate 绿。

## 回报
第一步：方案文档路径与一屏内的摘要。第二步：分支与 commit、Agent Note、gate、时序造法的原文（脱敏）。
```

**验收（2026-09-17）**：方案 `2ae0784d` 定案 (a)（用户放行），实现 `cba704ab` 合入 main `dbc76d7f`。判定步原文（伪造 token、`Failed to authenticate: OAuth session expired and could not be refreshed`、清空后 access / refresh 空串、expiresAt 0）、判定表 7 测、warn 不带 token 的断言都齐。Agent Note：`.agents/notes/implemented/bug-fix/2026-09-17-claude-credential-sync-newer-wins.md`。

**T55 补充（2026-09-17，活体验收的顺序）**：

```text
# T55 补充（二）：keychain 排序缺陷已修入 a36cf6b6，活体验收这样排

1. 前置：3171 再装一次到 main ≥ a36cf6b6（T62 线按 T33a 第 3 步做；本任务不动 3171 的停起）。
2. T1 判别：装完 /claude-code status → 凭据文件指纹应从 f4b960b1 变化、expiresAt 到 2026-09-17T13:31:20Z 附近。变了往下走；没变说明 9/17 那条本身是空壳（credentialUsable 判不可用），这时才重登——不要在 T1 之前重登。
3. T2 / T3 容器轮验收在默认 scope 上做，不开临时 scope：容器轮 claude ready → 立刻 /claude-code status（触发宿主同步）→ 同一实例宿主轮 ready、status 不掉。要真覆盖「容器续期 → 宿主协调」那道接缝，得等 access token 过期（本地 21:31 之后）再跑；之前跑只拿到完成判据第 4 条，refresh 指纹三次都一样。
4. 记录只有 sha256(refreshToken) 前 8 位、expiresAt、mtime、布尔。过了即收；败了贴指纹变化，只重登一次。通用提醒照旧。
```

**T2 / T3 结果（2026-09-17 16:27、2026-09-18 01:19）**：第一次 access 未过期，容器轮 8 s ready、宿主轮 5 s ready、指纹不变（判据第 4 条在不轮换时成立）。第二次自然过期窗口：容器轮续期写回文件（70f77b18 → 3125df88），宿主同步一条 AHEAD warn、文件保住、实例未登出——修复前这一步会把文件拨回、下一轮清空；但宿主轮失败 `OAuth session expired and could not be refreshed`，因为 macOS 上 claude 2.1.274 读写 keychain 不读文件，单元轮换使服务端连坐作废整条 token family，keychain 那条随之死掉、没人写回。前提修正：真实拓扑是 宿主 CLI ↔ keychain；harness 探针 → 文件；容器 CLI ↔ 文件（经挂载）。(a2) 否决（密文进 argv）。定案 (b)。

**T55 补充（四）（2026-09-18，第三步：容器专用 scope）**：

```text
# T55 补充（四）：第三步——claude 容器条件用容器专用命名 scope，宿主永不在该 scope 跑

## 已定
- 文件侧的新者胜与印记解析两处照原样保留（已合入、已证成）。
- (a2) 写回 keychain 否决。定案 (b)：claude 的容器条件必须声明 scope（T29 的字段），该 scope 只给容器轮用；判官与宿主路径的 claude 条件用默认 scope 或另一个从不进容器的 scope。两边是两次独立授权，单元轮换的 family 连坐碰不到宿主那条。
- Note 的前提改正：macOS 上 claude 2.1.274 读写的是 keychain；「写 keychain、读文件」只对 2.1.236 成立（版本点名）。README 的「已知限制」同改。

## 改哪里
1. packages/eval：validate / 就绪闸加一条守卫——harness 为 claude-code 且计划走容器路径的条件必须有 scope，且同一计划里该 scope 不得被任何宿主路径条件（含判官）使用；拒绝原文说清为什么（token family 连坐）。只针对 claude-code（codex 钉了 file 单存储、kimi 文件单存储、dsh 走 API key，都不受影响，Note 里写明）。
2. packages/local-agent-claude-code：README 双语写清纪律与登录法（/claude-code login --scope <名>，人工交接一次）；provider 不改。
3. 题库：pilot C / 真题的 claude 容器条件填 scope（如 c-claude），走自己的 worktree、从 i1-walk 开分支。

## 验收（3171，一次探针，不起完整 run）
0. 前置由用户做：默认 scope /claude-code login 一次（现在那条 keychain 已死）；再 /claude-code login --scope c-claude 一次。
1. 容器轮探针（claude 条件、scope c-claude）ready；若在过期窗口就顺带轮换。
2. 紧接着宿主轮探针（claude 默认 scope）ready，/claude-code status 不掉——判据第 4 条改成这一句：容器轮轮换后，宿主在默认 scope 仍 ready。
3. 反例：把一条宿主路径条件也填 c-claude 放进同一计划，validate 被拒并给原文。
记录只有指纹 / 过期 / mtime / 布尔。3171 停起不动，不与 T65 pilot D 抢单元。

## 回报
分支与 commit；两份 Agent Note（原 Note 的前提修正 + 本步）；gate；三步原文。合并归协调者。通用提醒照旧。
```

**第三步验收（2026-09-18）**：`fix/claude-container-scope`（`0c1d9780`）合入 main `a672db2a`，题库分支并入 i1-walk `90cf6a8`（经临时 worktree，共享检出 HEAD 仍 i3-probes）。守卫的两条原文、三份计划的 validate 结果、两份互链的 Agent Note 都齐；「两个容器条件可共用一个 scope」的例外成立（两侧同一文件、同一条链）。实施者提醒：题库里几份计划的 dataset.repo 指向别的检出，resolveDatasetRoot 优先用它——跑探针前确认绑定的 repo 里有 claude-exec-c.json。**探针 1–2（2026-09-18 03:23）**：c-claude 与默认 scope 都已过期，容器轮 ready 并轮换 c-claude，默认 scope 文件未动；宿主轮默认 scope authenticated、0 warn、ok。完成判据第 4 条（改写后）达成，**T55 结案**。实施者用 docker run + 直连作用域目录做探针，绕开了 /eval run 的 dataset.repo 解析——那条坑记为 T68。

**T1（2026-09-17 16:13）绿**：指纹换代 c115fc1c、expiresAt 13:31:20Z 与 keychain mdat 对表一致、refresh 窗口 10/08 → 10/15；实例愈合，未重登。

**T55 补充（三）**：

```text
# T55 补充（三）：T2 / T3 开跑，跑两次

1. 现在跑一次拿完成判据第 4 条，本地 21:31（access 过期）之后再跑一次碰「容器续期 → 宿主协调」的接缝。两次都只做就绪探针、不起完整 plan（照 T33e 四家容器就绪的办法：claude 容器条件、默认 scope，只到 ready）；探针留下的单元容器要释放。
2. T2 = 容器轮探针 ready 后读指纹；T3 = 紧接着跑一次宿主轮 claude 就绪探针（起 CLI 前的同步就是 claudeAuthenticated 那条路）再读指纹——与人敲 /claude-code status 等价，不必等人。
3. 判读：第一次 T2 / T3 的 refresh_fp 都应等于 c115fc1c（单元不续期）；晚上那次 T2 的 refresh_fp 应当变化、T3 不回退、宿主轮 ready、status 不掉，日志里应出现一次「文件领先 → 不写」的 warn 行。
4. 3171 的停起不动；记录只有指纹 / 过期 / mtime / 布尔。两次都过即收 T55，然后 T33c 一次 P0。通用提醒照旧。
```

### T58 · 条件与绑定的最后一公里（已完成，2026-09-17 验收）

```text
# 任务 T58：条件与绑定——第 4 步的人介入从 6 次降到 2 次

## 背景
T39 走查第 4 步人介入 6 次，其中 4 次是缺口：G6 model.endpoint 是就绪闸必看字段却没有入口；G7 provision 算出 home.sha 但不写回条件文档，人手抄一次再 provision 一次；G4 源条件没有 unit.scopedHome 时起草造不出容器条件；G5 绑定存字面 ~ 让条件子页整页报错。另外两条关乎边界：G1 未绑定会话里 agent 拿 repo 参数自己挑了共享检出写了三份文件（pilot B 的计划就是这么被改的）；G3 /datasets bind 不带层参数默认 all layers，把参考答案与评估标准开给规划 agent。G2 绑定成功后空会话看不到回执。T59 之后 home.sha 会随 permissions 层变，G7 更要紧。

## 先读
T39 走查日志第 4 步与 G1–G7；packages/eval/src/provision.ts（lock 与 home.sha）、service.ts 的 conditions / draftExperiment、tool.ts 的 repo 参数；packages/datasets/src/{binding.ts, service.ts, remote.ts, slash}（bind 的层缺省、路径存法）与 client 的 BindForm；packages/eval/src/client 的条件页；ui-spec §五（条件页）§六；T31 / T34 / T47 / T59 的 Agent Note。

## 分支
从 main 开 worktree ../dsh-plugins-wt-last-mile-conditions，分支 fix/eval-conditions-last-mile；改 packages/eval、packages/eval-tool、packages/datasets（README 双语 + sidecar）。datasets 与 eval 两包的改动各自成提交。

## 已定决定
- G7：provision 写回 home.sha 到条件文档（默认写回，`--no-write-back` 保留旧行为）；条件页的「provision」动作就是这一步，变 ready 是一步。
- G6：model.endpoint 进起草可改字段与条件页可编辑字段（改了即新条件哈希，照旧）。
- G4：起草新条件时若源条件无 unit 段而计划走容器路径，按 harness 的默认 scopedHome 模板补齐（模板放在 eval 一处，四家各一行）。
- G5 已提前拆到 T62 热修；本任务不重复做，若 T62 先合入就以它为准。
- G1：未绑定会话里 eval_* / datasets_* 的 repo 参数只认与会话绑定相同的仓库；未绑定即拒绝并提示 /datasets bind——agent 不再能自己挑仓库。
- G3：/datasets bind 不带层参数缺省只绑 modelFacing 层；要开更多层必须显式写，并在回执里点名。
- G2：绑定回执在空会话也可见（composer 回执一行）。

## 测试
provision 写回与不写回；endpoint 进起草；unit 模板补齐；路径归一化（含旧绑定）；repo 参数拒绝；bind 层缺省；client：条件页 provision 一步变 ready。

## 完成判据
三包测试全绿，gate 绿；3171 上：一条新条件从起草到 ready 只经「provision」一次；未绑定会话里让 agent 起草，被拒并提示绑定；/datasets bind 不带参数后 datasets_read 读不到 answers/。

## 回报
分支与 commit；Agent Note；gate；第 4 步的人介入计数（目标 2）。
```

**验收（2026-09-17）**：`fix/eval-conditions-last-mile`（`51b20d7c`、`c0acd947`、`fb6e70c9`、`a7b63128`、`1eb9e1b2`、`24aa40a3`）合入 main `db3176a5`。未绑定与指向别处的拒绝原文、bind 缺省下 `[LAYER_NOT_ALLOWED]` 原文、四行表与写回逻辑都齐；G5 按文案留给 T62。Agent Note：`.agents/notes/implemented/bug-fix/2026-09-17-eval-conditions-last-mile.md`。

### T60 · 导出与终评：第 7、8 步的缺口清零（已完成，2026-09-18 活体验收通过）

```text
# 任务 T60：导出与终评——第 6、7、8 步的缺口清零

## 背景
T39 走查第 7 步（finalize · 报告）人介入 3 次、第 8 步（终评与初稿）2 次、第 6 步 1 次，其中五条是缺口：
- G15：报告页「Export bundle」与落盘的 report/summary.md 是两件事，导出之后还剩一条命令行 dsh-eval report，页面没有按钮。
- G17：bundle 在 run 结束时自动导出，之后打的 human-final 进不了 bundle；要重新导出 + 重跑 report，两处界面都没说。
- G11：run 刚启动时矩阵与格子两个子页仍显示「Not started yet…」，概览已是 Running；点一次 Refresh 才出现。
- G16：会话工作区不是题库工作树，agent 写分析初稿要人批一次沙箱升级到 danger-full-access——为写一份 markdown 放开整台机器。
- G13：成员子会话的 tab 条里有 Missions（主会话没有）；R5 / R6 的自隐判据没覆盖成员子会话。
另有 T53（小）：带 --out 导出的 bundle 在 run.meta 里无迹可寻，报告页只能让人「换个目录找」。与 G15 一起做。

## 先读
T39 日志（题库 i1-walk 分支 docs/i5-walkthrough-log.md 第 6、7、8 步与 G11 / G13 / G15 / G16 / G17；题库是多 agent 共享检出，只读用 git show，不 checkout）；packages/eval/src/run.ts 的 export 与 finalize、report.ts、service.ts 的 exportRun / finalize / humanFinal、client 的报告页与判官台、store 的轮询；packages/eval/src/client/preset-visibility.ts 与 packages/datasets 的同名判据；packages/eval-tool 的 eval_plan_draft 写题库的路径（T34 / T58）；T38 / T37 的 Agent Note；ui-spec §五（报告、判官台）§六。

## 分支
从 main 开 worktree ../dsh-plugins-wt-export-final，分支 feat/eval-export-and-final；改 packages/eval（必要时 packages/eval-tool、packages/datasets 的自隐判据；README 双语 + sidecar）。T62 与本任务并行且都动 eval 的 client：谁后合谁合 main，按 graft 法解，不 hunk 拼接。

## 已定决定
- G15 + T53：报告页「导出」一个动作把 bundle 与 report/summary.md 一起写盘（report 在 bundle 内），导出目录与 exportedAt 记成 run 级注解（orchestrator ns），报告页优先读它；CLI dsh-eval report 保留。
- G17：终评之后允许再导出——判官台与报告页都给「重新导出」；报告页显示 bundle 的 exportedAt，早于最后一条 human-final 就标「bundle 早于终评，需重新导出」（一句人话 + 按钮）。再导出进新目录，注解指向最新的那个，旧目录不删。
- G11：批准并启动之后详情页自动拉一次（启动回执落地即刷新）；run 已存在时矩阵与格子不再显示「Not started yet」；轮询节奏不改。
- G16：agent 写题库的窄口——只许写会话绑定仓库的工作树透传区（plans/、conditions/、本实验的分析初稿目录），路径白名单在工具里写死，越界即拒并回原文；不放开会话沙箱。形状二选一：扩 eval_plan_draft，或新加一个窄写工具；回报里写选了哪个与理由，ui-spec §六 由协调者改。
- G13：成员子会话的 tab 自隐判据与主会话同源（按预设里有没有伴生行判），评测会话的成员子会话里 Missions 不出现；题集 / 实验室两个 tab 在成员子会话里显示与否按同一判据。
- 新加的按钮与文案走 locale 词典、不写死英文；状态词与错误态按 ui-spec §九，整体收口归 T63。

## 测试
导出一并写 report 且注解落地；再导出后 exportedAt 更新、旧目录不动；「早于终评」标注逻辑；启动后自动拉一次（store）；写口的路径白名单与越界拒绝；成员子会话自隐判据。

## 完成判据
eval / eval-tool 测试全绿，gate 绿；3171 上：报告页一键导出后 bundle 里有 report/summary.md；打一条 human-final 后报告页出现「需重新导出」并能一键再导；agent 在会话里把分析初稿写进题库工作树不需要沙箱升级；成员子会话 tab 条没有 Missions。贴文本原文即可，截图由 T63 统一交。

## 回报
分支与 commit；Agent Note；gate；第 6、7、8 步的人介入计数（目标 6 步 0、7 步 2、8 步 1）；写口形状的选择与理由。
```

### T62 · 热修：绑定路径归一 + 错误态三段式（已完成，2026-09-17 验收；3171 重装仍归它）

```text
# 任务 T62：两个 tab 先能打开——绑定路径归一，错误态不再裸露异常

## 背景
3171 上题集 tab 报「~/.dsh/scratch/dataseek-eval-i5 is not a git repository: GitError: git rev-parse --show-toplevel failed」，实验室 › 条件页报「not a dataset repository (no datasets/ directory)」。根因是走查记的 G5：绑定里存的是字面 ~，git 与 datasets 的读路径不展开。同时两个 tab 把 error.message 与绝对路径原样渲染，用户看到的是异常原文。

## 先读
packages/datasets/src/binding.ts（repoPath 存法）、service.ts 与 remote.ts 里读 repoPath 的每一处、client 的 BindForm 与 DatasetsView 的错误渲染；packages/eval/src/client 里 22 处 error.message 渲染；ui-spec §九「错误态三段式」；T39 日志 G5。

## 分支
从 main 开 worktree ../dsh-plugins-wt-ui-hotfix，分支 fix/ui-binding-path-and-errors；改 packages/datasets 与 packages/eval（README 若提到绑定路径就补一句 + sidecar）。两包各自成提交。

## 已定决定
- 绑定写入时展开 ~ 并存 realpath；读取处统一走一个归一化函数；旧绑定读到 ~ 时就地归一并写回。
- 错误态组件（两个 tab 共用一个实现，各自 import 自己的副本不跨包 import）：第一行人话（按错误码映射：不是 git 仓库 / 不是题库 / 路径不存在 / 服务不在），第二行修法（能给命令就给命令），「详情」折叠里放异常原文与路径。页面不再直接渲染 error.message。
- 不改矩阵页等其它样式（归 T63）。
- 3171 的重装归本任务：按 T33a 第 3 步（源码模式 install.sh --source <检出> --fresh，经看门狗通道停起，锚点 worktree 快进到装的提交），装 main ≥ 本任务合入后的提交——T58 的 provision 写回、T59 的 permissions pin、T33d 的入口守卫随之上去；重装前后的提交号写进回报。

## 完成判据
datasets 与 eval 测试全绿，gate 绿；3171 重装后题集列表与条件页能打开；人为绑一个不存在的路径，两个 tab 的错误态都是三段式（贴渲染出来的文本原文即可，不要求截图——截图由 T63 统一交）。

## 回报
分支与 commit；Agent Note；gate；两个 tab 修前修后错误态的文本原文。
```

**验收（2026-09-17）**：`fix/ui-binding-path-and-errors`（`824a5104`、`f6231fc5`、`5a2c2b49`、`58f7e163`、`d8e0c31e`、`758a3363`、`85e6fc75`）合入 main `35b23bf7`。两个 tab 修前修后的错误态文本原文齐，四种码中英两套。Agent Note：`.agents/notes/implemented/bug-fix/2026-09-17-binding-path-and-error-seat.md`。**重装（2026-09-17 14:51）**：3171 从 `e0a37060` 到 `2c4476f8`（跨 68 提交），从 detached worktree 以源码模式装（`pnpm install --offline --frozen-lockfile` 9.4 s 装全，24 成员 / 177 条 patch 行），停起经看门狗通道（stop marker → TERM → 端口干净），锚点 guard/eval-3171 `--ff-only` 到 `2c4476f8`，checkpoint / clear / record deployment 录绿，supervise 起，13 s 就绪（303 交换 + cookie 200）。真机：绑定表单输字面 `~` 落盘即规范路径；把记录手改回 `~` 再打开，列表照常且文件就地迁移（旧绑定读一次自愈）；条件页整页打开（t57-container-keep 三条件，dsh 两条 ready）；绑不存在的路径，两个 tab 的错误态四段原文与本任务回报一致。默认会话 35 个工具（内建 21 + 插件 14：datasets 7、eval 5、subagent_dsh、list_capabilities），无 mission_*；技能 4。claude / codex 登录没碰。看门狗日志末尾那行无时间戳的 unplanned exit recovered 是上一轮的历史行。

**验收（2026-09-17 晚）**：`feat/eval-export-and-final`（`4b7a4633`、graft `c35da837`）合入 main `0bc517d3`。越界拒绝原文、T39 bundle 副本上导出动作的 BEFORE / AFTER 原文都齐；ankh-guard supervise 泳道 4 条红是负载抖动（load 56 → 70、11 个 vitest 并跑，本分支零 ankh-guard 文件），按既有规则记录。Agent Note：`.agents/notes/implemented/feature/2026-09-17-eval-export-and-final.md`。**活体验收（2026-09-18）**：四项原文齐（导出 / 重新导出的 JSON 回执与三份目录并存、G11 的毫秒时间线、G16 的写成功与拒绝原文、G13 的三条会话 tab 条），3171 停起未动、未起容器轮；没有往已 finalize 的 run 补写 human-final（会改它那格的记分来源），接受。残留在实施者自己的 scratch（demo bundle、题库 worktree 未提交）由其清理；3171 上多一个会话与一条 archived run（持有单元 0）不动。

**T60 补充（2026-09-17，回报已到后）**：

```text
# T60 补充：先并 main 解冲突，活体验收不起新容器轮

1. T63 已合入 main 00828fcd，与本分支在 packages/eval/src/client/LabView.tsx、ReportPage.tsx（及两个 README sidecar）冲突。在本 worktree 并 main，按 graft 法解：T63 的词表 / 组件 / 样式是基线，本任务的新按钮与文案挂到它的组件与 locale 词典上，不 hunk 拼接；sidecar 按合并后的 README.en.md 重录。解完 gate、报新 commit，合并归协调者。
2. 已定：写口形状取 eval_repo_write（不扩 eval_plan_draft），mission 的 effectivePresetOf 同改接受；ui-spec §五 §六 由协调者改。
3. 活体验收在 3171：合入已成（0bc517d3）；重装归 T63 的实施者，在 T55 21:31 的探针跑完之后做（同一配方：先 export PATH 工具链 bin 与 DSH_HOME=~/.dsh-lab，停法先 TERM 启动器层），装完给你信号再开跑。不起新的容器轮：报告页「导出」与「重新导出」、终评后的标注用 T39 那个已 finalize 的 run；G11 起一次 dsh 单条件宿主轮 P0（分钟级、只证自动拉与「正在启动」）；G16 在会话里让 agent 写一份分析初稿进题库工作树、再让它写 items/ 被拒，贴原文；G13 打开旧格子的成员子会话看 tab 条。都贴文本原文，不要求截图。3171 的停起不动，不与 T55 的探针、T65 的 pilot D 同时占单元。
```

### T63 · 界面整体收口：题集 + 实验室按视觉与文案基线重做（已合入 `00828fcd`，2026-09-17；待用户在 3171 上走查）

```text
# 任务 T63：两个 tab 的整体设计与文案收口——一个人从头到尾

## 背景
六个子页由不同的人各做各的，功能都在，但没有人做过整体设计：矩阵页把条件文档里所有键当因子摊开（unit.scopedHome.var、完整 home.sha 都在筛选行里），列头是 ["DEEPSEEK_API_KEY","DSH_HOME"] 这种数组，状态是 mixed (archived / ws-ready) 中英混杂，报告页把英文异常与绝对路径直接打在页上。用户看过之后的结论是「可读性低、设计感弱、体验差」。ui-spec §九 定了硬规则，本任务按它把两个 tab 从头到尾过一遍。

## 先读
ui-spec 全文（§九为准）；走查稿 scratch-storyboard/eval-flow-storyboard.html 里的目标样子（本地 open）；packages/mission 与 packages/datasets 的 *.module.css（宿主 tokens 的用法）；packages/eval/src/client 与 packages/datasets/src/client 全部页面；T39 日志的截图与缺口 G11 / G13。

## 分支
从 main 开 worktree ../dsh-plugins-wt-ui-polish，分支 feat/ui-polish-lab-datasets；改 packages/eval 与 packages/datasets 的 client（README 双语 + sidecar）。功能与数据面不动，只动呈现与文案；发现数据面缺字段就记下来不顺手扩。T60 与本任务并行且都动 eval 的 client：谁后合谁合 main，按 graft 法解，不 hunk 拼接。

## 已定决定
- 视觉：只用宿主 tokens；明暗两套都过；间距、字号、表格、chip、圆点、抽屉在两个 tab 用同一套写法。
- 文案：一张状态词表（ui-spec §九）落成 locale 词典，中英各一套，页面上不再出现英文状态词与键名；哈希缩 12 位；数组与 JSON 不当标题。
- 矩阵页重做：列头永远是条件 id，因子值作副标题（如「v4-flash」）；单因子时没有筛选行；多因子时「按因子分组」选择器默认折叠；卡格告警与哈希红边保留但换成 chip 与描边；run 级汇总一行放底部。
- 列表页：状态 chip 用词表；因子列显示人话（「模型」）而不是键名。
- 报告页：未导出态一句话 + 按钮；不变量四行用同一组件；比较未开的原因一句人话。
- 判官台与格子抽屉：同套组件。
- 交付：每页明暗两套截图（题集列表 / 题目详情 / 实验室列表 / 新建实验 / 概览 / 计划审阅 / 条件 / 矩阵 / 格子 / 报告 / 判官台）+ 对照 ui-spec §九 的核对表（每条规则：哪页怎么落的）。截图只在本任务统一截一次（登录、发一条消息进到聊天界面后逐页截），其它切片不各自截。

## 完成判据
两包测试全绿，gate 绿；3171 重装后用户点着走一遍，截图与核对表在回报里；用户提的问题记成清单一轮收完。

## 回报
分支与 commit；Agent Note；gate；截图集与核对表。
```

**验收（2026-09-17）**：`feat/ui-polish-lab-datasets`（九提交）合入 main `00828fcd`。协调者按 §九 看图验收通过；截图与核对表在 scratch-screenshots/t63/（git 忽略）。**重装（2026-09-17 20:59）**：3171 从 `b97a6338` 到 `00828fcd`，detached worktree 源码模式，24 成员 / 177 patch 行，19 s 就绪；实例 bundle 里 T63 的词典键都在；claude / codex 没碰。两个坑：install.sh preflight 要 dsh 在 PATH（工具链 bin），record deployment 要导出 DSH_HOME；stop marker + TERM 看门狗会把启动器与实例进程孤儿化、端口 60 秒不放（手工 TERM 才干净）——前者记进通用提醒，后者交 ankh-guard 线 ⑥。走查清单开在 scratch-screenshots/t63/walkthrough.md，W1（条件页键名列头，纯词典改动）、W2（英文术语列头，等用户定）已落，按「一轮收完」等用户走完再改。Agent Note：`.agents/notes/implemented/feature/2026-09-17-ui-polish-lab-datasets.md`。

**T63 补充（2026-09-17）**：

```text
# T63 补充：重装 3171，然后等用户走查

1. 3171 重装到 main 00828fcd 归你：detached worktree（git worktree add --detach ../dsh-plugins-wt-install-3171 00828fcd）→ pnpm install --offline --frozen-lockfile → install.sh --source <该目录> --fresh → 看门狗通道停起 → 锚点 guard/eval-3171 --ff-only；21:31 之前做完（T55 那时要跑探针），不碰 claude / codex 登录。回报重装前后提交号与就绪用时。
2. 用户走查两个 tab，问题记成清单一轮收完。协调者看图先记两条进清单：条件页列头仍是键名（model.declared / model.endpoint / scope / preset / lock）与英文动作词 provision，按 §九 换成人话（键名留 title）；几处列头是英文术语（canary / validate / attempt / rep）——等用户定要不要统一成中文。
3. 走查清单收完一轮再报；T60 合入后 3171 还要装一次，那次可以一起收。通用提醒照旧。
```

**T63 补充（二）（2026-09-18，用户走查后的清单，只收文案级；结构级归 T67）**：

```text
# T63 补充（二）：走查清单一轮收完——只做文案、颜色、格式，不动结构

用户走完 3171 上的两个 tab，意见分两层：结构级（四阶段导航、向导、详情重做、图表、并排盲评）归新任务 T67，本轮不碰；文案级的按下面收完即结案。ui-spec §九 新增了「术语表 / 色彩语义 / 数字与句子」三条，以它为准。

1. W1 条件页列头换人话（模型 / 端点 / 作用域 / 预设 / 锁 / 就绪），键名留 title；动作词 provision 换「准备环境」之类的人话（词典里定一次，两处一致）。
2. W2 英文术语列头统一：canary → 防泄标记，validate → 校验，attempt → 尝试次数，rep → 次数；harness 保留。
3. 术语表：矩阵形状 → 实验规模；因子 → 对比变量；条件 → 对比组（判官仍叫判官）；快照 → 题库版本；桶 + 阶段并成一列「运行状态」；格子 → 运行记录；判官台 → 人工评估；四条不变量 → 实验有效性校验。子页名与列表列头一并改，页面结构不动。
4. 色彩语义：绿 = 完成 / 成功，蓝 = 进行中，灰 = 未开始，红 = 失败 / 阻塞，橙 = 警告；已释放 / 已归档这类终态用灰。
5. 数字格式化：token 31.5k、时长 4 分 48 秒；报告页与矩阵页的判定句改温和提示（「当前为单对比组实验，无对比数据，下方是基线表现」）；一致性写成「评分者一致性：高（κ 0.85）」，低时「建议增加判官」。
6. 人工评估队列命名「P0-placeholder · 第 1 次」（种子顺序，不露对比组），加筛选（未评 / 已评 / 按题）。
7. 交：改动清单对照上面 1–6，测试全绿，gate 绿；不要求截图（T67 验收时协调者自己看）。合并归协调者；3171 重装与 T60 那次合并做。
```

**补充（二）验收（2026-09-18）**：`feat/ui-copy-terminology`（`fa133b3b`、`8d1901f4`）合入 main `87b713ec`。两处判断都认：矩阵 → 网格是 §九 v2 的口径；运行状态一列不是拼接（阶段常显、桶只在说了阶段说不出的事时出现）正是要的；终态灰、已判绿与色彩语义一致；正文「条件」→「对比组」超出字面但对，英文词典与契约路径不动。pivotMatrix / report 宿主端句子仍归 T66。3171 不单独装，随 T65 第二步那次。Agent Note：`.agents/notes/implemented/feature/2026-09-18-ui-glossary-and-formats.md`。

### T67 · 实验室 tab 按 ui-spec §五 v2 重构：四阶段、主动作、向导、运行记录详情、结果对比、人工评估（两个里程碑已完成，2026-09-18 验收；补充见下）

```text
# 任务 T67：实验室 tab 信息架构重构——让每一页都知道自己在哪、下一步做什么

## 背景
T63 按 §九 把文案与视觉收口了，用户走查后的结论仍是「问题挺多」：七个子页是标签正确的数据倾倒——概览与计划审阅几乎同一份定义列表、没有主动作，新建实验是一张裸表单，作者备注整段糊在页上，格子详情把 JSON 与文件名直接摊开，报告只有表格，判官台让人去点「格子 1」。根因是规格缺口：§五 v1 只定了七个子页装什么，没定人在每页做什么。ui-spec §五 已改成 v2（四阶段、每页一个主动作、术语表、色彩语义），本任务按它重构。

## 先读
ui-spec 全文（§五 v2、§九 三条新增为准）；T63 的 Agent Note 与 vocab.ts / 共用组件（Chip / EmptyState / Section / Detail / Word / Hash）——本任务在它们之上做，不另起一套；T60 的 Agent Note（导出注解、重新导出、启动后自动拉、成员子会话自隐）；packages/eval/src/client 全部页面与 store；packages/eval/src/report.ts（不变量与效率表的数据形状）、pivot 与 cell 投影；用户走查意见原文（本节「用户走查 T63」一段）。

## 分支
从 main 开 worktree ../dsh-plugins-wt-lab-v2，分支 feat/lab-v2-four-stages；只改 packages/eval 的 client（locale 词典、样式、页面）；数据面缺字段就记下来不顺手扩——例外见「已定决定」里点名可加的两处。README 双语 + sidecar。两个里程碑各自成一组提交、各自交一次回报，协调者分两次合。

## 已定决定
里程碑一（结构与术语）：
- 四阶段导航：实验设计 / 运行记录 / 结果对比 / 人工评估；旧的概览、计划审阅、条件并进实验设计三段（规模与变量 / 对比组与就绪 / 高级设置折叠），矩阵页并进运行记录顶部；页顶状态 + 一个主动作按状态机（草稿→去 validate；待批准→批准并启动；运行中→看运行记录；评估中→去人工评估；已完成→看结果；被拒→重新检查）。
- 同一个网格组件跑前跑中两用：跑前格内「计划 n 次」，跑中显示状态、得分、告警；单对比组时网格上方一句提示 + 「添加对比组」按钮。
- 就绪徽章：全过一枚「✓ 环境就绪」，否则逐条红叉 + 「重新检查」；就绪原文折进详情。
- 未绑定题库时实验设计页给「绑定题库」按钮，弹出题集 tab 的导入表单（同一个组件，不抛命令行）。
- 运行记录列表：题 × 对比组 × 次、运行状态一列、得分、耗时、尝试次数；筛选五档。
- 术语表与色彩语义按 §九；T63 补充（二）已改的词条沿用。
里程碑二（详情、报告、评估、向导）：
- 运行记录详情：头部大字得分（llm-draft 或 human-final，注明来源）+ 成功 / 异常标签；阶段时间轴（每段时长，从账本 transition 时间算）；参数配置键值表；附件区（产物按人话命名，点开预览；下载若要宿主文件服务，先记下来不做）。
- 结果对比：单对比组温和提示；实验有效性校验四条 ✓ / ⚠ + 悬停解释；效率柱状图（活跃时长、输出 token、cache read，用宿主已有的图表原语，没有就 CSS 柱，不引第三方库）；数字格式化；一致性一句话。
- 人工评估：同题各对比组产物左右并排、去指纹、按种子顺序编号，每格各自打分（契约不变，不做二选一）；队列筛选；llm-draft 与 human-final 并排。
- 四步向导替换新建实验表单：同一个服务面动词 draftExperiment，向导只是分步收集；每步都能回退，最后一步「保存草稿并 validate」。
- 数据面可加的两处（点名，别的不扩）：格子投影带各阶段 transition 时间戳（时间轴用）；报告投影带每条不变量的「为什么影响比较」一句（悬停用）。

## 不做
Cmd+K 全局搜索；「预期得分（历史数据）」；二选一盲评；产物下载（记下来）。

## 完成判据
每个里程碑：eval 测试全绿，gate 绿；协调者自己起临时实例驱浏览器看（不要求实施者截图），对照 §五 v2 的表逐页核：每页有状态与主动作、术语与颜色按 §九、底层信息都折着。里程碑二之后用户再走一遍，问题一轮收完。

## 回报
每个里程碑：分支与 commit；Agent Note（Alternatives considered 双语）；gate；对照 §五 v2 的核对表（每行：落在哪、怎么落的）；数据面记下来没做的清单。通用提醒照旧。
```

**验收（2026-09-18）**：`feat/lab-v2-four-stages`（`fc20bd82`、`6661530c`）合入 main `b2f0c7a5`，合并态 eval 850。Agent Notes：`.agents/notes/implemented/feature/2026-09-18-lab-four-stages.md`、`2026-09-18-lab-detail-bench-wizard.md`。协调者在临时实例上看图（明暗两套 + DOM 尺寸），14 行核对表全部成立；走查 13 条见下面的补充，都是呈现层。

**T67 补充（2026-09-18，已完成，验收见块后）**：

```text
# T67 补充：走查一轮收完（W3–W15，都是呈现层）

协调者 2026-09-18 在临时实例上（main b2f0c7a5，拷了 3171 的账本）逐页看了明暗两套，你那张 14 行的表全部核到。下面 10 条一次收完；截图与逐条清单在主检出的 scratch-screenshots/t67/walkthrough.md（git 忽略），每条写了看哪张图、改哪一行。

1. 状态色（W3）：LabView.module.css 的 .chipTag[data-tone='ok'] 现在用 --dsw-alias-state-business-primary（品牌蓝），busy 用 --dsw-alias-label-primary（正文色，看着是灰）——于是「已完成」蓝、「运行中」灰，§九 五色没落地。宿主主题有 --dsw-alias-state-success-primary：ok → success-primary，busy → business-primary。datasets 那份 chip 副本同改。
2. 判官台并排被裁（W8）：.judgeColumns 仍是三列模板 minmax(150px,180px) minmax(0,1.2fr) minmax(0,1fr)，判据表并进每列之后第三列空着，1440 宽下作答区只有 509 px（页宽 1134），两列各 358、benchColumns scrollWidth 728，第二份只露一半，macOS 横向滚动条默认不显示。改两列 minmax(150px,180px) minmax(0,1fr)，每列 minmax(320px,1fr)。
3. 判官台列内顺序（W9）：每列先铺完整产物（stage1/2 的 json 与 md，几千行）再到判据表，判官要滚很远才到打分处，两列不同步。产物默认折叠（保留「替换掉 n 处指纹」那行）、判据表置顶；或列内各自滚动、判据表固定。
4. 文案残留「计划审阅」（W10）：draft.notStartedHint（去「计划审阅」）、new.notStarting（启动是计划审阅页的…）、list.emptyHint、matrix.emptyHint、review.error 五处，这页已并入实验设计——改「实验设计」，空态的按钮直接跳过去。
5. 计划文件读不到（W11）：t60-g11-host 的工作树已删，实验设计页直接渲染 cannot read plan file: /Users/…/plans/t60-g11-host.json——英文原句加绝对路径。PLAN_UNREADABLE 走 ErrorState 三段式：「计划文件不在了（题库工作树已删）」+ 修法 + 详情折叠。
6. 缺失对比组（W12）：计划点名、绑定仓库里没有的对比组在表里被静默省略——pilot-d-preset 只列了判官一行，dsh-lean / dsh-full 不见，徽章却「✓ 环境就绪」；草稿页 ✗ 列表有「claude-exec-c 缺失」，表里也没它。表里给「缺失」行（conditions.missing 词已在），徽章不得 ✓。
7. 运行记录列（W4 / W5）：列头「得分」下面是「终评 / 脚本判定」这种来源词，读起来像分数叫「终评」——列名改「判定」（runs.col.verdict），或留「—」+ 悬停「分数在结果对比页」。「在态时长」对终态照样从现在往回算（已释放 · 2 天 1 小时）——终态显示「—」或整条记录总耗时（时间轴已能算）。
8. 时间轴底条（W7）：每行底下一条等长灰条，不按时长比例，像进度条但不表达任何东西——按时长比例（同一记录内归一），或去掉底条只留数字。
9. 英文词（W6 / W13 / W14）：结果对比动作行的 finalize（report.finalize 中文值就是 'finalize'）——词表定名，与 T57 那颗「回收」同名或叫「终评收口」；向导 ③ 的字段标签 rep → 次数，且 rep / 预算给缺省 1 / 30 分钟 / 10 轮（现在为空、「下一步」一直灰，与 ④ 步「都有缺省」不一致）；「保存草稿并 validate」→「保存草稿并校验」；配对表列头「逐 rep Δ」→「逐次 Δ」。
10. 草稿红叉行原因（W15）：红叉行只有名字没原因，原因散在下面的英文警告里——按 check code 映射一句人话放行尾（端点未解析 / 家目录指纹未写回 / 未加锁 / 文件缺失）；英文原文归 T66，不动数据面。

不做：校验警告的英文句子（T66 数据面）；lock 的 capabilities.source 警告（T65 rev12 装上即消）；「运行中 0/1」的陈旧行（README 写明的粗糙边）。

分支：从 main 开 worktree ../dsh-plugins-wt-lab-v2-fixups，分支 fix/lab-v2-walkthrough；只改 packages/eval 与 packages/datasets 的 client（README 提到的地方补一句 + sidecar）。T54 也在动 eval client（判官台提示、报告页来源计数），谁后合谁合 main、按 graft 法解，不 hunk 拼接。

判据：eval / datasets 测试全绿，gate 绿；回报按 1–10 逐条写落在哪一行；不要求截图，协调者再看一遍。通用提醒照旧。
```

**补充验收（2026-09-18）**：`fix/lab-v2-walkthrough`（`6ea07d75`）合入 main `e70f62fe`，合并态 eval 884 / datasets 214。十条逐条有落点：五色进 tokens 且加 `tests/tones.spec.ts` 读样式表钉住；`.judgeColumns` 改两列、答案列 `flex: 1 1 320px`；产物改 `<details>` 折叠、判据表置顶；五处「计划审阅」改掉；PLAN_UNREADABLE 走三段式（ErrorState 加可选 fix，两份副本同改）；缺失对比组成「缺失」行、徽章按计划自己的受试对象清单算；终态「在态时长」显示「—」、列名改「判定」；时间轴真凶是 Chip 作 grid item 被 stretch 拉满，改三列 + 按本记录最长段归一；finalize → 终评收口、rep → 次数、预算缺省 60 → 30、「保存草稿并校验」、「逐次 Δ」；红叉原因从 review 结构读、只有端点未解析借 validate 自己写的前缀。两处纠正：W13「无缺省」是协调者看错（框有缺省，卡的是阶段没勾）——留一条小项：阶段按 schema 缺省全勾或提示点名缺什么；W12 徽章信 review、表信注册表，定 review 赢。真机复核（临时实例重装到 `e70f62fe`，2026-09-18 18:27）：chip 已完成绿 / 运行中蓝 / 待批准橙；列头「判定」、终态在态时长「—」；时间轴条按时长比例（2 / 46 / 48 / 9 / 241 / 2 px）；动作行「终评收口」、无英文 finalize、无「逐 rep Δ」；判官台作答区 944 px、两列各 466、无横向溢出、8 个产物块默认折叠；计划文件不在了走三段式（人话 + 修法 + 详情折叠）；缺失对比组成「缺失」行；红叉行尾带原因（端点未解析 · 家目录指纹未写回 · 声明旁边没有锁 / 声明文件不在）；空态与向导不再出现「计划审阅」；向导 ③ 标签「次数 / 预算」、缺省 1 / 30 / 10；末步「保存草稿并校验」。十条全部落地。留一条小项（不阻塞）：向导 ③ 的阶段列表缺省没勾，提示只说「这一步填完才能往下走」不点名——按 schema 缺省全勾或提示点名。

### 题库共享检出的旧托管 worktree 清理（3171 重装到 ≥ 587c12ae 之后；共享资源，先报后做）

```text
# 任务：清掉题库共享检出里 3171 旧模型登记的 25 条托管 worktree

## 背景
T73 分支 1 起题库按 git archive 物化到 state/datasets/materialized/，不再开托管 worktree；分支 2 之后 eval 也不再读绑定。共享检出 ~/.dsh/scratch/dataseek-eval 的 .git 里还登记着旧模型开出来的 25 条托管 worktree（路径形如 …/state/datasets/worktrees/<16 位十六进制>/<题集>），分支 1 的 Agent Note（.agents/notes/implemented/architecture/2026-09-23-dataset-registry.md）写了清理规则。共享检出是多 agent 共用的，这次写它的 .git 属共享资源：第 2 步先贴候选清单报协调者，放行后再删。

## 先读
上面那份 Agent Note 的清理一节；通用提醒里题库共享检出的规则（不 checkout、HEAD 留在 i3-probes 050e22d1、只在 worktree 里写）。

## 步骤
1. git -C <共享检出> worktree list --porcelain 存一份；记 HEAD（rev-parse HEAD，应为 050e22d1）与行数（现在 38 行）。
2. 候选 = 路径匹配 /state/datasets/worktrees/[0-9a-f]{16}/[^/]+$ 且在 ~/.dsh-lab 之下的条目。排除 ~/.dsh/state/… 下的（那是 3182 的）；排除一切不匹配的（wt-t65 这类人手开的工作树、实验分支的工作树都不动）。候选清单先报协调者，放行后再做第 3 步。
3. 逐条 git worktree remove --force <path>；目录已不在的用 git worktree prune 收尾。不删任何分支、不 checkout、不动 HEAD、不 fetch。
4. 之后再存一份 worktree list：行数 = 38 − 候选数，HEAD 仍是 050e22d1，~/.dsh-lab/state/datasets/worktrees/ 下不再有目录。

## 不做
不删分支（15 条实验分支留着，去留另议）；不碰 ~/.dsh、~/.dsh-official、3080；不 pull。

## 回报
前后两份 worktree list（去绝对路径前缀）、删了几条、HEAD 前后、异常。通用提醒照旧。
```

### T74 · 方案卡与结论卡：plan 加「要回答的问题 / 预期 / 怎么算回答了」（协议 rev14），数字就地可改（已完成，2026-09-24 验收见块后）

```text
# 任务 T74：方案卡 + 结论卡回答问题 + 就地改数字（协议 rev14）

## 背景
T72 把结论卡放到了结果对比第一屏，但它只能给配对结论：plan 里没有「这次实验要回答什么」。ui-spec §五 实验设计的「上半段 · 方案」与结果对比 ①「结论卡」都要 rev14 的三个字段；§四 定这三个字段顺延到 rev14（rev13 归 T73 分支 2，已在 main 587c12ae）。就地改数字要写回同一份 plan——T73 之后 plan 在部署里的实验目录 experiments/<id>/plan.json，写入目标定了，本任务才可开。

## 先读
ui-spec §五（实验设计一行的「上半段 · 方案」、结果对比 ①、人工评估四个出口对结论来源的影响）与 §九；交互稿 v5 的「方案卡」「结果对比」两场景（proposals/prototypes/）；docs/dataset-authoring-protocol.md §6.5 的 plan schema（rev13 现状；packages/eval/src/schema.ts 的常量与 protocol.spec 的钉法——协议文档与代码常量要在同一提交里对齐，否则测试红）；T72 的 Agent Note（结论卡、就绪清单、experiments.ts 的状态推导）；T73 分支 2 的 Agent Note（实验目录、plan.json 逐字节保存、experiment-store.ts、experimentId 配对）；packages/eval/src/client/DesignPage.tsx、ReportPage.tsx、LabView.tsx，src/draft.ts、tool.ts（eval_plan_draft 的参数）；T72 补充（一）清单里「列表行卡片化（问题原文、规模）」一条；packages/datasets/src/client/preview.tsx（第 6 条用）。

## 分支
从本地 main（≥ 587c12ae）开 worktree ../dsh-plugins-wt-t74-question，分支 feat/t74-question-card；改 packages/eval（schema、draft、tool、client）、packages/eval-tool（eval_plan_draft 的参数说明）、docs/dataset-authoring-protocol（rev14，单独一个提交）；README 双语 + sidecar。T75 / T76 同期在 packages/eval 上开：谁后合谁合 main、按 graft 法解，不 hunk 拼接。

## 已定决定
1. 协议 rev14：plan 顶层加三个可选字符串——要回答的问题（一句）、预期（可空）、怎么算回答了（一句）；字段名建议 question / expectation / answeredWhen，更贴切的在 Note 里写理由。旧 plan 没有就不显示这块，validate 不因缺失报警；plan.example.json 与 §6.5 文档随 rev14 提交更新。
2. eval_plan_draft 收这三个字段（可选）落进 plan.json；工具说明加一句「起草时把人的问题原样写进 question」。SKILL 归 T73 分支 3，不在这里改。
3. 实验设计页上半段按 ui-spec：① 问题 / 预期 / 怎么算回答了；② 规模与对比变量、题库版本、判官与采样——次数、每格预算、判官采样数就地可改（启动前），写回同一份 plan.json：Remote 加一个只改这几个数字字段的动词，其它字节不动、写完回读；启动后冻结，控件只读并说明原因。③ 对比组表与计划网格已有，不动。
4. 结论卡第一句原样回答问题（有配对结论时「问题：… — 结论：…」；没有问题块时保持 T72 的配对结论）；「怎么算回答了」原文在卡上一行小字；预期与实际方向一致 / 相反用词表里的词，不加新颜色。
5. 实验室列表行带问题原文一行（有才显示，超长省略；T72 补充（一）记的那条），规模列沿用。
6. 顺手一条（用户 2026-09-23 问的）：结果对比第 ⑤ 块「分析初稿」现在是 <pre> 等宽原文，改成 markdown 渲染，做法与 packages/datasets/src/client/preview.tsx 的文档预览一致（同一宿主块 chrome；跨包复用有困难就在 eval 里做同样式的最小实现，Note 里写），不引第三方库；读取规则不变。
7. 状态词、颜色、术语按 §九；截图自查按 §九（临时实例配方，明 / 暗 / 400 三套：方案卡、结论卡、列表各一）。

## 不做
Cmd+K；「预期得分（历史数据）」；结构性改动（加题、加对比组）仍交给 agent（输入框预填引用，T72 的 setDraft 通道）；不改 run.meta 的形状；不改 SKILL。

## 完成判据
eval / eval-tool 测试全绿（rev14 的 protocol.spec 绿），gate 绿；临时实例上：起草带三个字段的实验 → 实验设计页上半段三段都在 → 改次数为 2 → plan.json 只有那一个数字变了、回读一致 → 批准后控件只读；导入的旧 plan（pilot-d）页面无此块、结论卡仍是配对结论；第 ⑤ 块渲染成 markdown；截图三套。

## 回报
分支与 commit（rev14 单列）；Agent Note（Alternatives considered 双语）；gate；截图路径；就地改数字的写回前后 diff。通用提醒照旧。
```

**验收（2026-09-24）**：`feat/t74-question-card`（`b3ca9ed2` rev14 单列、`e9a49cc5` 主体、`57533026` 400px 修）合入 main `e80a328c`。合并态（含分支 3）在 detached worktree 离线装依赖、建包后跑：eval 1053 / eval-tool 6 / datasets 238 / datasets-tool 7 全绿，scripts 196，tsc 干净。两处偏离都接受：字段落在协议 §6.4（plan 顶层那节，文案写成 §6.5 是协调者写错）；预期与实际只并排不判「一致 / 相反」（预期是自由文本，判断要理解那句话）。就地改数字是文本级替换（只换那几个 token 的字节，plan.json 逐字节保存的语义保住），写前比对、临时文件 + rename、写后回读，加判官这类结构改动拒绝——比文案要求的稳。⑤ 块 markdown 用官方 MarkdownText 包一层 `MarkdownDoc.tsx`（T75 复用）。协调者看了两张图（结论卡「问题：… — 结论：…」+ 怎么算回答了 + 预期 · 实际；设计页 ⓪ 要回答的问题 + 数字四格 + 「启动前可改」）。**一条要修（进补充清单）**：pilot-d 的结论卡写「dsh-lean 与 dsh-full 未分高下」，可这一对是被判定覆盖不一致拒绝排名（T71 的 `rankReason`），不是打平——`pair.rank === null` 把两种情形混在一起，实施者也报了；定：`rankReason` 在场且不是打平时写「暂时不能下结论：<原因>」，只有打平才写「未分高下」。Agent Note：`.agents/notes/implemented/feature/2026-09-24-eval-question-card.md`。

### T75 · 作答视图：按「题 × 组 × 次」并排，两个视角，盲评开关即人工评估视图，三处入口（已报，等 T76 之后合 main 解冲突，2026-09-24）

```text
# 任务 T75：作答视图（D6）

## 背景
ui-spec §五「作答视图」（D6 · 第 4 条）：跨阶段视图，从运行记录、人工评估、结果对比三处进入，按「题 × 组 × 次」定位，不向人展示路径。现在人工评估页（T67 判官台改造）已经把同题各对比组产物并排、去指纹；运行记录详情有附件区但只是「点开预览」；结果对比的格子只能跳运行记录（T69）。本任务把三处统一成一个组件：同一份并排视图，盲评开关决定露不露组名。T72 已合入，可开。

## 先读
ui-spec §五 作答视图一段、人工评估一行、运行记录一行的「看作答」；交互稿 v5「作答并排」「人工评估」两场景（proposals/prototypes/）；T67 两份 Agent Note（判官台并排、产物折叠、cellArtifact 三条规则）与 T69 的 Note（跳转与子会话）；packages/eval/src/client/JudgingPage.tsx、运行记录详情、ReportPage.tsx 的判据表格子；packages/eval/src/read.ts 的 cellArtifact；bundle 里 stage*.md 与判定注解的位置（report.ts 的 cell 投影）；packages/datasets/src/client/preview.tsx（markdown 渲染的宿主块 chrome——复用做法，跨包复用有困难就在 eval 里做同样式的最小实现，与 T74 第 6 条用同一个，谁先合谁定形）。

## 分支
从本地 main（≥ 587c12ae）开 worktree ../dsh-plugins-wt-t75-answers，分支 feat/t75-answer-view；只改 packages/eval 的 client 与 read（cellArtifact 若要加「一格多文件」的批量读动词，点名加、别的不扩）；README 双语 + sidecar。与 T74 / T76 同包，谁后合谁合 main、graft 法解。

## 已定决定
1. 一个组件（作答视图）：输入是「题 × 组 × 次」的定位（experimentId / runId + 题 + 对比组 + 次），按题并排各组、同一部分对齐；组名可显示，或按种子顺序换成 A / B（盲评开关）。
2. 两个视角：「提交的报告」——stage*.md 按 markdown 渲染，判官引用过的段落就地挂判定（判定注解里有引文才挂，没有就不挂，不猜）；「判定证据」——逐条判据的判定与理由、脚本输出（verify 层）。「过程」链到 T69 的打开子会话（已有入口，复用）。
3. 人工评估页 = 作答视图开盲评 + 每格打分（契约不变：每格一份分数，human-final 唯一写入口）；现有判官台「判据表置顶、产物折叠」的规矩保留在组件里。
4. 三处入口：运行记录详情「看作答」（定位到这一格）；人工评估队列（定位到题，盲评开）；结果对比判据表与配对表的格子（定位到题 × 组，多次时列出各次）。不向人展示路径。
5. 读取沿 cellArtifact 三条规则：只读本格、只读文本、超 256 KB 截断并说明；作答仍在 attempt 的 archive/workspace/，随 bundle 导出，本任务不改导出。
6. 状态词、颜色、术语按 §九；截图自查按 §九（明 / 暗 / 400：报告视角、证据视角、盲评各一）。

## 不做
二期「代码改动」diff（要钉住的 commit + populate-manifest，口径另评审）；二选一盲评；产物下载。

## 完成判据
eval 测试全绿，gate 绿；临时实例拷 pilot-d bundle（题库 wt-t65 工作树 exports 下的 run-20260918054718-8o0o-bundle）或 3171 账本的只读副本（不连 3171）：三处入口都定位到同一格，盲评开关切换组名 ↔ A / B，人工评估打分路径不变（已有测试仍绿），markdown 渲染、引用段落挂判定；截图三套。

## 回报
分支与 commit；Agent Note（Alternatives considered 双语）；gate；截图路径；数据面记下来没做的清单。通用提醒照旧。
```

**回报已到（2026-09-24），等合 main**：`feat/t75-answer-view`（`ae74dc1c` cellAnswers、`06b10ca9` 作答视图、`2d883a2e` README + Note），gate 两次过（后一次在盲评修复之后），eval 1046。与 T74（README.i18n、LabView.module.css、contract.ts、client/index.ts、service.ts）和 T76（README.i18n、CSS、LabView.tsx、locales.ts）都冲突（merge-tree 核过）：**等 T76 合入后，实施者把 main 合进分支、按 graft 法解（MarkdownDoc.tsx / markdown CSS / markdown.* 文案键与 T74 的取任一边）、gate 重跑后报 commit，协调者再合**。协调者看了两张图（具名面：dsh-lean 那列描边、stage1.md 渲染、C2 判定挂在被引用那段之下；盲评面：作答 A / B、过程入口收起、描边去掉）。设计取舍都认：判定只在证据原文引用某段（≥ 6 字）时挂上、不猜；盲评字母每次从 A 起；具名面的盲评只在显示层、真正的盲面仍是人工评估的 judgeQueue；配对表的「看作答」放题行。验收中修的一处（盲评时入口描边泄露组）已补测试。观察进补充清单：judgeQueue 不带 script 层，判官台上只有脚本判定的格子来源标「未判」、具名面标「仅脚本判定」，两边要一致；X-no-patch 这类否决型判据 pass=false 是好结果、页面按 pass 上色（题库 rubric 把极性写成正向，先问出题方是数据面还是页面的错）。数据面记下：`dataseek.verdict/1` 加位置或引文字段（rev15 候选），判定不必靠引文反查段落。

### T76 · 会话面：eval_plan_draft 工具行渲染成实验卡、eval_experiment_get、实验 tab 计数待证、S18 退路（已报，等合 main 解冲突，2026-09-24）

```text
# 任务 T76：会话面（D3）

## 背景
旅程的起点在会话：人说想法，agent 起草，然后人要能一跳到实验设计。现在 eval_plan_draft 的返回只是文本，人要自己去实验室列表找。ui-spec §五「跨面旅程」与 §六定了：工具行渲染成实验卡（宿主 tool.call.toolview，卡上没有批准按钮，「打开实验」进实验设计）；eval_experiment_get(id) 只读合成投影 + 作答索引；实验 tab 标签计数要证 conversation.view 的 label 能否随状态重绘；运行完成等节点回流会话需要宿主 API（S18，已登记在 docs/upstream-seam-registry.md）。T73 分支 2 已合入（experimentId 是稳定引用），可开。

## 先读
ui-spec §五 跨面旅程、§六 eval-tool 一行、§七 第 2 与第 8 步；交互稿 v5 总览与会话起草的场景（proposals/prototypes/）；T72 的 Agent Note（setDraft 通道、状态推导）；T73 分支 2 的 Agent Note（experimentId、experiment-store、eval_cells 的投影）；packages/eval-tool/src/index.ts 与 packages/eval/src/tool.ts；宿主 tool.call.toolview 的挂法——看仓里已经挂过 toolview 的包（grep 一下）；docs/upstream-seam-registry.md 的 S18 一节；packages/eval/src/client/index.ts 的 conversation.view 挂载（tab 标签）。

## 分支
从本地 main（≥ 587c12ae）开 worktree ../dsh-plugins-wt-t76-session，分支 feat/t76-session-face；改 packages/eval（client、tool、read）、packages/eval-tool；README 双语 + sidecar。与 T74 / T75 同包，谁后合谁合 main、graft 法解。

## 已定决定
1. eval_plan_draft 的工具行挂宿主 tool.call.toolview 渲染实验卡：名字、问题原文（rev14 有才显示，T74 未合就只有名字与规模）、规模、题库版本（id/set @ 短哈希）、状态；一个动作「打开实验」跳到实验室 › 实验设计（切 tab 的接口 T72 探过没有：退回列表并高亮该行，Note 里写）；没有批准按钮（R1，只在实验设计页）。
2. eval_experiment_get({experiment})：只读，= eval_cells + eval_run_status 合成的与页面同源投影 + 作答索引（每格：题 × 组 × 次 → 可读的产物名清单，不给路径）；agent 写分析按此引用。没有 run / finalize / provision，不写人工评估出口。eval-tool 注册、README 档位表更新；ui-spec §六 那一行由协调者回写。
3. 实验 tab 标签计数：先证 conversation.view 的 label 能否随状态重绘；能则显示「本会话发起、需要你处理」的个数，不能就不显示，不用 DOM 锚点硬改；结论写进 Note。
4. S18 退路：会话里不放实验 chip；运行完成 / 判官判完 / 人工评估完成三个节点不投通知（宿主缝未开），agent 用 eval_run_status 读；若 rc.1 宿主已有可用的只通知事件 API 就记下来不接（换线是另一个任务）。
5. 真机看实验卡需要一次真实的工具调用：要 provider 的话开跑前报协调者、由用户配，你不配、不复制凭据；没有 provider 就用客户端测试渲染实验卡 + 在临时实例页面里挂一次夹具截图，Note 里说明。截图按 §九（明 / 暗 / 400：会话里的实验卡一张、打开后的实验设计一张）。

## 不做
不做批准按钮；不做通知回流；不改 SKILL（T73 分支 3 管）；不动宿主。

## 完成判据
eval / eval-tool 测试全绿，gate 绿；实验卡渲染、「打开实验」到位；eval_experiment_get 对导入的 pilot-d 返回的投影与页面数字一致、返回里没有以 / 或 ~/ 开头的字符串；tab 计数有结论。

## 回报
分支与 commit；Agent Note（Alternatives considered 双语）；gate；截图路径；tab 计数的可行性结论；ui-spec 需要回写的句子。通用提醒照旧。
```

**回报已到（2026-09-24），等合 main**：`feat/t76-session-face`（`01cf4eef` eval_experiment_get、`ad688910` 实验卡、`139336e5` 标记行改细框），gate 过，eval 1048。与 T74 在 eval-tool/src/index.ts、两包 README、LabView.module.css 上冲突（merge-tree 核过）：**实施者把 main（≥ `e80a328c`）合进分支、按 graft 法解、gate 重跑后报 commit，协调者再合**；T75 排在它之后。协调者看了两张图（会话里的实验卡：名字 / 问题 / 规模 / 题库版本 / 待批准 + 「打开实验」；实验室列表被标出的一行细框）。三条结论先记：tab 标签计数做不到（SlotLabel 只在订阅 / 切语言时重读，T76 证伪；不显示、不用 DOM 锚点）；「打开实验」没有切标签接口，退回「在实验室列表标出这一行」（LabFocus 通道，宿主日后给了接口就直达设计页）；S18 三个候选（Session.append 无 ignorable、agent.inject 面向模型、shell.overlay root 作用域）只记不接。ui-spec 两句已回写（§五、§六）。实验卡的真机图是写进临时实例存储的夹具会话（没配 provider），客户端测试覆盖真实块形状，接受。观察进补充清单：条件 sha 设计页显示当前锁、run.meta 记开跑时的锁，页面标「开跑时 / 当前」；datasets 缺席时 draftRow 的 validate 直接拒绝（不在范围，低）。

**T74–T76 补充清单（并入 T72 补充（一），等用户走查后一起发）**：① 结论卡 `rank === null` 分「暂时不能下结论：<rankReason>」与「未分高下」（T74，已定）；② 条件 sha 标「开跑时 / 当前」（T76）；③ judgeQueue 带 script 层，判官台与具名面的来源词一致（T75）；④ X-no-patch 极性先问出题方（T75，数据面或页面待定）；⑤ SKILL「计划审阅」→「实验设计」（分支 3，随试点后修订）；⑥ datasets 缺席时 draftRow validate 的拒绝改三段式（T76，低）。

### T78 · host-016 之后的 main 在 0.1.5-rc.1 工具链上冒烟（3171 下一次重装的前置；可发，2026-09-25）

```text
# 任务 T78：host-016 之后的 main 在 0.1.5-rc.1 工具链上冒烟

## 背景
2026-09-25 凌晨 main 合入 host-016 适配线（59077d33 及后续）：pnpm-workspace.yaml 把官方线钉到 @deepseek-ai/*@0.1.7-rc.1，eval / eval-tool / datasets / datasets-tool 做了「双线」适配，compat 仍写 minHost / verifiedHost 0.1.5-rc.1。评测线的 3171 装的是 host-016 之前的 006779b0，3171 与所有临时实例都跑 ~/.dsh-toolchains/rc-0.1.5-rc.1（= 0.1.5-rc.1）。注意两边文档里的「rc.1」不是同一个版本：host-016 文档指 0.1.7-rc.1，评测线文档指 0.1.5-rc.1。源码两条线都兼容，不等于按 0.1.7 类型面构建的产物在 0.1.5 运行时里成立。本任务只回答一个问题：当前 main 在评测线工具链上装不装得起、跑不跑得通。结论决定下一次 3171 重装（带 T73 分支 3 / T74 / T75 / T76）怎么走。

## 先读
交接文档 profiles/web-eval/docs/handoff-2026-09-25.md §0、§5、§6；本文 §三「3171 重装到 main（T77 之后）」的装后核对五项（冒烟项照它来）；host-016 改到评测线的提交：21363d83（ISessions.open / current 移除迁移：mainSessionId 读 retainedBy.mainView 回落 current、openSession 改为按次探测 uiWorkspace）、fd1181e4（jobs 面 JobStart→JobSpec / JobSnapshot→JobView，rc.1 走 run(job) 环推、0.1.5 保留 readOutput 拉取）、12751fa1 / 6c4be81d / 2894c42b（Config 注解改裸 z）；proposals/active/2026-09-15-host-016-adaptation.md（只读，别人的工作流）。

## 分支
不改代码、不开分支。从本地 main 当前 HEAD 开 detached worktree：git worktree add --detach ../dsh-plugins-wt-t78-smoke main；回报里写明 HEAD 提交号。发现缺陷只记录、不修（修另立任务）。

## 步骤
1. 端口与模型配额是共享资源：先 lsof -nP -iTCP:<port> -sTCP:LISTEN 找一个空闲端口，报协调者后再起。不配 provider，所以不用模型配额。
2. 装：在 worktree 里 CI=true pnpm install --frozen-lockfile --prefer-offline（ECONNRESET 重跑即可）→ export PATH=~/.dsh-toolchains/rc-0.1.5-rc.1/node_modules/.bin:$PATH → TH=$(cd "$(mktemp -d)" && pwd -P)（DSH_HOME 必须是 realpath）→ export DSH_HOME=$TH → profiles/web-eval/scripts/install.sh --source <worktree> --fresh。记下构建与安装输出里的错误和警告，重点看 peer 版本、typert、import 阶段。不从 npm 装任何 @khorsheed 包。
3. 数据：按临时实例配方把 3171 账本拷一份只读副本到 $TH（rsync ~/.dsh-lab/，排除 .credentials.yaml、eval-creds/、local-agent/、state 里的 token / cookie / watchdog / launch-spec / instance-launch / self-restart-guard / last-*、*.log、profiles/、tarballs/、bin/、logs/、scratch/）；拷完 find $TH -iname '*token*' -o -iname '*cred*' 必须为空。
4. 起实例：dsh --profile web-eval --port <p> --no-open，stdout 只写进 $TH 下的 0600 文件，启动链接打码。记下就绪秒数，以及启动日志里的插件加载错误（「Failed to load plugins」、pending 行、import 报错）。provider 对话框点「Configure later」。
5. 冒烟（playwright；截一套明色即可，放 ~/.dsh/scratch/t78-shots/，不要放系统临时目录）：
   a. 题集、实验室两个 tab 都出现，打开时没有整页错误；浏览器 console 里没有 eval / datasets 的报错。
   b. 题集 tab：登记表随副本带过来就核对列表；没带过来就登记 dataseek-eval（跟踪 i1-walk）。对共享检出只读，前后 git rev-parse HEAD 与 git worktree list | wc -l 一致。
   c. 实验室：列表四组与「另有 n 个」；打开 pilot-d-preset 走一遍四阶段（实验设计的方案卡与就绪清单、运行记录网格与一格详情、结果对比的结论卡、人工评估页），每页都能打开。
   d. 双线改到的地方实测：切换会话后「本会话发起」的过滤跟着换（mainSessionId）；运行记录详情的「打开子会话」能跳过去（uiWorkspace.openSession 探测）；数字就地改写回一次再改回（T74 路径）。jobs 面的 readOutput 分支如果不起真 run 就走不到，写明「未覆盖」，不要为它配 provider。
   e. pilot-d bundle 报告页（题库 wt-t65 工作树 exports 下的 run-20260918054718-8o0o-bundle）：打得开，结论卡与有效性校验和 T71 / T74 验收记录一致（判定覆盖不一致、4/5 ⚠）。
6. 收尾：停实例（先核 pid 是自己的）、rm -rf $TH、git worktree remove 那个 worktree。（若 T79 紧接着要用同一套装法，经协调者同意可以留着实例给 T79，换装 T75 / T76 合入后的 main。）

## 不做
不修代码；不换工具链、不建 rc-0.1.7-rc.1 工具链（换线是另一个决定）；不碰 3171 / ~/.dsh / ~/.dsh-official / 3080 / 3093；不配 provider、不复制凭据；不起真 run；不在共享检出上 checkout。

## 完成判据
一句话结论：成立 / 不成立。成立的条件是第 2、4 步没有错误，第 5 步 a–c、e 全过。不成立时给出错误原文、定位到的提交（先从背景里那五个查起）、以及估计是小修还是结构性问题。

## 回报
main 提交号、端口、就绪秒数、第 2 / 4 步的告警摘录（打码）、第 5 步逐项原文、截图路径、未覆盖项、结论。通用提醒照旧。
```

**用户裁定（2026-09-25）**：① I5 收口顺序改为「T76 / T75 合入 → T79 联合走查 → T80 收口补充 → 3171 重装 → 用户走查」，补充不再等用户走查后才发——让用户看到的是补完的版本；② T73 分支 3 试点并进 3171 重装之后，在 3171 上跑：用户在 3171 上发试点那两句话，实施者只读 `~/.dsh-lab` 的会话记录核 8 条判据（不拿 token、不复制凭据）。代价：试点排在 T80 之后；判据不过要改 profile 文本时，要再装一次。**3185 撤掉**：分支 3 实施者停实例、删临时 home（`~/.dsh-t73pilot.*`），回报一句即可。**3171 重装文案写的时候要带上**：试点前先核 3171 登记表跟踪的分支（i1-walk）与 pilot-d 钉住的提交在 harness-comparison 上是否不同——不同才复现得出「版本不唯一」，判据 3 的候选哈希按实际改写；相同就在试点前另找一个钉旧提交的实验，或把判据 3 记为未覆盖。

### T79 · 联合走查：对照交互稿 v5 的 13 个场景，产出收口补充清单（T75 / T76 合入且 T78 成立后发，2026-09-25）

```text
# 任务 T79：I5 收口联合走查（交互稿作者 + 协调者）

## 背景
I5 收口批的代码（T71–T76）都已写完。用户 2026-09-25 定：先由交互稿作者与协调者在真机上对照交互稿 v5 走一遍整条旅程，把所有差距与已攒的补充合成一份清单、改完一轮（T80），再重装 3171 请用户走查。用户的参照线（09-23）：不满在内容、旅程和设计感，不在外壳；按场景对照、视觉同等层次、只用宿主 tokens；依赖宿主能力的待证项走退路不算不过。

## 先读
交互稿 proposals/prototypes/eval-journey-redesign.html（13 个场景）；提案 proposals/active/2026-09-23-eval-journey-redesign.md 的验收标准 1–7；ui-spec §五、§九；本文 §三 T72 验收段里的「T72 补充（一）」与 T76 一节末尾的「T74–T76 补充清单」；T71–T76 各自的 Agent Note。

## 环境
按 T78 的装法（0.1.5-rc.1 工具链、独立 DSH_HOME、3171 账本只读副本、不配 provider、不复制凭据），装 T75 / T76 都合入之后的 main。端口先报协调者。截图放 ~/.dsh/scratch/t79-shots/，明 / 暗 / 400 三套。

## 做法
1. 逐场景对照：旅程地图、提问、方案 · 实验卡、实验设计 · 方案段、就绪、运行、作答、人工评估 · 盲评、结论、实验列表、题库、Agent 旅程、决策清单。每个场景记「交互稿 / 真机 / 差距 / 修法 / 归属包」。
2. 需要真实模型才能看的两个场景（提问 = ask_user_question 选版本、Agent 旅程），真机只核能核的部分（实验卡用夹具会话），其余标「随 3171 上的 T73 试点验」，不算差距。
3. 把 T72 补充（一）与 T74–T76 补充清单逐条并进来，已被后续任务顺手做掉的划掉并注明提交。
4. 待用户定的三项按默认写进清单、标「默认」：旧 run 给批量归档按钮、归不归由用户点；X-no-patch 极性先问出题方（数据面问题不改页面）；短实验永不排名接受。
5. 分级：P0 = 旅程断（走不下去 / 说错话）；P1 = 与交互稿不在同等层次；P2 = 打磨。只有 P0 / P1 进 T80，P2 列出由协调者定。

## 不做
不改代码；不碰 3171 / ~/.dsh / ~/.dsh-official / 3080 / 3093；不配 provider；外壳不动。

## 交付
一份清单 profiles/web-eval/docs/t79-closeout-walkthrough.md（场景表 + 并入的旧补充 + 分级 + 按包切的修改批次建议），附截图路径。协调者据此写 T80 文案。

## 回报
清单路径、P0 / P1 / P2 各几条、按包的批次建议、截图路径。通用提醒照旧。
```


## 四、验收规程

实施 agent 回报四样：分支名与 commit、Agent Note 路径、`pnpm gate` 输出、一份脱敏的示例输出。协调者做的事：

1. 在独立 worktree 里 checkout 该分支，`git pull --rebase` 后跑 `pnpm gate`。
2. 对照任务段的「完成判据」逐条核，缺一条即打回，不做「差不多」。
   - UI 任务另按 §三 T70 的「验收参照线」：场景对照交互稿 v5、视觉同等层次、待证项走退路不算失败。
3. 读 Agent Note 的 Alternatives considered：没有记录真实取舍的不收。
4. mission / lab / datasets 的改动额外跑通用性 grep（红线词表见各提案验收标准）。
5. 多个分支同时绿时，按文件不重叠原则任意顺序合入；有重叠先合改动小的。
6. 迭代收口只看 README「迭代计划」里该行的完成判据；达到后把本文对应迭代的任务表状态更新，再写下一迭代的指引文案。
