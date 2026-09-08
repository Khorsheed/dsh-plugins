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
| T17 | 代码 | local-agent：容器内 exec 包装（exec 传输层；「CLI 驱动抽成独立包」推迟，理由进 Agent Note） | T16 T18b | |
| T18 ✅ | 代码 | lab：复合指纹（镜像 digest + 资源限制 + 挂载布局 + env 键），分量可读 | 无 | 合入 main `b7dc599`；`lab-env:<sha256>` + 分量 JSON；acquire 真传 `--cpus` / `--memory` |
| T18b ✅ | 代码 | lab：`network`（挂指定网或 none）、volume 挂载、`user`——T16 的三条硬缺口 | T18 | 合入 main `68e23d2`；三分量都真加到容器上再进指纹，未声明的分量不入哈希（旧指纹不变）；`--volume` 与 `--mount` 分立；pid 目录以 root 建 1777，非 root 单元才起得来 |
| T19 ✅ | 数据 | 探针：F2 / F3 阶段一二的 objective 判据写成 `.mjs` 探针；F2 阶段三的 verify 探针与 `verify/helpers/` | 无 | 题库 `i3-probes` `050e22d`（并入 i1-walk `d3ee214`）；25 条判定过 schema；3 条 objective 判据无探针，理由在 `docs/probes-selftest.md` |
| T19b | 数据 | F3 补一条与 A-N2 同形的 objective 负分判据；两题 core/bonus 计数对齐 standards.yml；探针改出 T24 定下的比例字段 | T24 | |
| T20 | 代码 | eval：容器路径（acquire / populate / checkpoint / verify / archive 交 lab；销毁路径唯一） | T17 T18b T28 | |
| T21 ✅ | profile | eval preset：不挂 Bash 与 docker | 无 | 合入 main `e1e12f1`；工具 43 → 39，差集恰为 bash / exit_plan_mode / ralph / workflow；四个 `subagent_<harness>` 预设挑不掉 → T27 |
| T22 | 运维 | 容器内跑 F2 阶段三一格；再跑四家同一题 | T16–T21 T27 T28 | |
| T23 ✅ | 代码 | eval：`finalize <runId>` 再入口（G13）；开跑前就绪检查做一次最小委派而不信 `authenticated`（G4）；效率表只计已完成格子（G15）；run 的 `--only` / `--max-cells` 记进 run.meta；validate 交叉核 plan.expectedNs 与题的判定源（G6 的 eval 半边） | 无 | 合入 main `0cd2139`；finalize 不强推、不碰 archived 以下；就绪检查每条件一次真委派，失败拒整 run；效率表只计已完成格子（pilot A 的 dsh-exec 21.0 → 11.9 min）；子集记 `run.meta.subset`；validate 对 expectedNs 出四种 warning；judge.ts 零改动 |
| T24 ✅ | 代码+数据 | 负分判据进报告（G11 + G12）：verdict 契约不动，极性取 rubric 叶子的 `negative` / 负 weight；导出时把权重表（id → weight、negative）写进 bundle `report/`，报告以「得分判据数」与加权分呈现；**追加**：比例字段进 §6.5 | 无 | 合入 main `979e624`；协议 v1-rev4：极性归 rubric、`ratio: {passed, total}` 进 §6.5、§6.7 禁止 evidence 前缀；导出写 `report/rubric-weights.json`（只有编号与数字）；报告主轴改「得分判据数」+ 缺陷清单表；题库三份 rubric 审计零改动 |
| T25 | 代码 | local-agent：`effectiveSettings.cliVersion` 填实（G1）；codex 回读在并发 run 里失效的原因与修复（G14）；status 增加「记录在、活性未知」一档（G4 的 local-agent 半边） | 无 | |
| T26 | 代码 | datasets：`validate` 增加可判性检查（G6）——rubric 有叶子、每个 kind 在该题上有判定源 | 无 | |
| T27 | 代码 | local-agent-tool-subagent：`tools: all \| none` 注册开关（T12/T13 同款）；pack 的 patch 把四家委派工具行设为 none | 无 | |
| T28 | 代码 | eval 探针运行器：题集级 verify 层随题物化、题内探针可 import 共享库；退出码三态（判不了 ≠ 失败）；先回填 task / by 再校验，§6.7 措辞对齐 | 无 | |

第一波（2026-09-08 发出）：T16、T18、T19、T21、T23、T24 已验收；T25、T26 在跑。第二波（2026-09-08 发出）：T18b 已验收；T17、T27、T28 在跑；T19b 可发。T20 在 T17、T28 合入后发；T22 收尾。

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

验收：README I3 行；lab `status` 表里四格 TASK 哈希一致；release 被闸拒绝过至少一次且容器仍在；F2 阶段一二的 `script` 源非空且报告的负分判据方向正确。

### I4 · 放宽因子

目标：同 harness 两条件的配对结果。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T29 | 代码 | local-agent：每次委派可覆盖 scoped home / 配置 | T3 | |
| T30 | 代码 | local-agent：每 provider 的模型参数，首轮委派指定、成员内固定、resume 不换；provider 设置卡「默认模型」（dev 域 UI，自由输入加最近值，不硬编码模型目录） | T29 T3b | |
| T31 | 代码 | eval：`conditions provision` + 条件注册表数据面（模型等因子只展示与 diff，不给选） | T29 | |
| T32 | 代码 | capability-catalog：按 preset scope 的能力清单哈希 | 无 | |
| T33 | 运维 | pilot B：dsh × 两模型；pilot C：claude × 两模型；pilot D：同 harness 两 preset | T29–T32 | 三份配对结果 |

验收：README I4 行；report 的因子列由 condition diff 自动推出。

### I5 · agent 配实验 + 界面

目标：一句话 → 计划 → 批准 → 跑完 → 报告，人只做审批与终评。

| 任务 | 类型 | 内容 | 依赖 | 产出 |
|---|---|---|---|---|
| T34 | 代码 | `eval-planning` skill：起草 condition 与 plan，跑 validate，向人提交 | T14 T31 | |
| T35 | 代码 | eval client 半：实验台 tab | T14 | |
| T36 | 代码 | eval client 半：计划审阅（批准是人的动作） | T34 | |
| T37 | 代码 | eval client 半：判官台（human-final 唯一入口） | T9 | |
| T38 | 代码 | eval client 半：报告视图（Pareto、配对表、导出走既有闸） | T10 | |
| T39 | 运维 | 端到端：一句话到报告，记录人介入的次数与位置 | T34–T38 | |

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

### T25 · local-agent：CLI 版本回读、codex 并发回读、status 活性档（可发）

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

### T26 · datasets：validate 增加可判性检查（可发）

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

### T17 · local-agent：容器内 exec 包装（可发）

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

### T19b · 题库：F3 的 objective 负分判据、计数对齐、比例字段（可发）

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

### T27 · local-agent-tool-subagent：tools 注册开关，pack 关掉四家委派工具（可发）

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

### T28 · eval 探针运行器：题集级 verify 层、退出码三态、回填顺序（可发）

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

## 四、验收规程

实施 agent 回报四样：分支名与 commit、Agent Note 路径、`pnpm gate` 输出、一份脱敏的示例输出。协调者做的事：

1. 在独立 worktree 里 checkout 该分支，`git pull --rebase` 后跑 `pnpm gate`。
2. 对照任务段的「完成判据」逐条核，缺一条即打回，不做「差不多」。
3. 读 Agent Note 的 Alternatives considered：没有记录真实取舍的不收。
4. mission / lab / datasets 的改动额外跑通用性 grep（红线词表见各提案验收标准）。
5. 多个分支同时绿时，按文件不重叠原则任意顺序合入；有重叠先合改动小的。
6. 迭代收口只看 README「迭代计划」里该行的完成判据；达到后把本文对应迭代的任务表状态更新，再写下一迭代的指引文案。
