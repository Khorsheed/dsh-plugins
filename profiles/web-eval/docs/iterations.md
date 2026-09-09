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
| T29 | 代码 | local-agent：每次委派可覆盖 scoped home / 配置 | T3 | |
| T30a ✅ | 代码 | local-agent：四家 provider 插件配置加可选 `model`，不写 = 今天的表现，写了每轮委派以它起 CLI；改配置后新 run 走新值、进行中的 run 不受影响；`effectiveSettings.model` 报配置值并由回读核对；provider 设置卡「默认模型」（dev 域 UI，自由输入加最近值，不硬编码模型目录） | 无 | 合入 main `8633996`；codex `-m` / claude `--model` / kimi `-m`（常驻改写 default_model）；dsh 无按次传模型的启动面，不给键；真机 codex 与 claude 两轮回读命中，kimi 到请求记录为止（配额） |
| T30b | 代码 | local-agent：委派级模型参数——首轮委派指定、成员内固定、resume 不换；T31 的条件 provision 用它做同 harness 两模型；前置：dsh-local-agent-dsh-headless 开一条按次传模型的启动路，dsh 才能拿到 model 键 | T29 T30a | |
| T30c ✅ | 代码 | local-agent + eval：settle 观测加工具调用计数（次数 + 按名分布），效率表多一列；每轮的 token 与工具调用落进 bundle 的 `report/usage.jsonl`，计价留给 bundle 之外的非模型环节 | 无 | 合入 main `fc5141d`（2026-09-10）；四家都在已走过的折叠分支里数，byName 记各家自己的名字（codex 是 command_execution 不是卡片上的 Bash）；kimi / dsh 按本轮不按镜像窗口；usage.jsonl 每轮一行，多 `attempt` 与 `counted` 两列，效率表从 counted:true 加总复现；未报计数打「—」不补零；codex 的 function_call 未数（0.144.0 的 exec 流里 provider 本就不解析它）；只有 exec 路径报 settle 观测 |
| T29b | 代码 | eval + profile：`/eval run` 脱离会话轮次（后台 job，发起端断开不中止，CI 无浏览器也能发起）；plan 路径展开 `~`；install.sh 的 dsh 前置检查前移 | 无 | |
| T31 | 代码 | eval：`conditions provision` + 条件注册表数据面（模型等因子只展示与 diff，不给选）；一并定冻结决策 9 与「四家同一题」的互斥怎么解（第五个模型，或判官与选手同家不同模型） | T29 T30b | |
| T32 | 代码 | capability-catalog：按 preset scope 的能力清单哈希 | 无 | |
| T33 | 运维 | pilot B：dsh × 两模型；pilot C：claude × 两模型；pilot D：同 harness 两 preset | T29–T32 | 三份配对结果 |

T30c（2026-09-09 加）：效率表今天只有 token 与时长，工具调用数没人采；采集面已有、只差汇总，合成一条，不依赖 I3 与 T29。计价不让实施者做（2026-09-09 定）：token 与工具调用按轮落库即可，单价表由 bundle 之外的非模型环节套用。

模型切换（2026-09-08 定）：「配置能切模型、切了新 run 照新的走、缺省与今天一致、前端能切能指定」拆成两半。配置切换与设置卡是 T30a，不依赖 I3 与 T29，可与 T22 并行发；按次委派指定是 T30b，与条件 provision（T31）一起才有意义。界面上「指定某次 run 用哪个模型」走 I5 的计划审阅（T36）读条件文件，不另做入口。

**T30c 验收（2026-09-10）**：`feat/tool-calls-and-pricing`（`ae5244d`）合入 main `fc5141d`，只动 local-agent 家族与 eval；合并态 eval 324、local-agent 205、codex 150、claude-code 137、kimi 171、dsh 104 全绿。计数都折在各家已经走过的解析分支里，没有新增解析路径；byName 记各家自己的名字——codex 同一次调用计数写 command_execution、镜像卡片写 Bash，这正是「不做跨家归一」的可见处。kimi 与 dsh 按本轮而非镜像窗口数，live 轮询清空过 delta 的 settle 照样报得出，resume 轮不继承。真机 codex 与 claude 各两轮，toolCalls 与镜像出的工具卡片逐条对上。pilot A 复算 results.jsonl 逐字节相同，usage.jsonl 新增 7 行，counted:true 加总正好复现效率表的 21.0 min / 4 轮与 11.9 min / 2 轮。三条判断都接受：一、usage.jsonl 比文案多 `attempt` 与 `counted` 两列——重试格沿用同一 mission id，只有 cell 分不开两次 attempt；counted:false 的行留着，外部计价才能自选口径。二、codex 的 function_call 没数：0.144.0 的 exec 流里 provider 解析的是 command_execution / web_search_call / function_call_output，没有 function_call 分支，按「不新增解析路径」只数前两个，README 写明；要补是另一个决定。三、只有 exec 路径报 toolCalls，因为长驻驱动根本不发 settled（usage 与 observedModel 在那里本来就缺），评测钉的是 exec，口径不受影响；补长驻的 settled 通道另开。验收机上 verify-translation-pairing 报 packages/context-guard 的 sidecar 过期，那是另一位 agent 在主检出里未提交的 0.1.2-rc.1 适配工作，与本分支无关，未动。

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

## 四、验收规程

实施 agent 回报四样：分支名与 commit、Agent Note 路径、`pnpm gate` 输出、一份脱敏的示例输出。协调者做的事：

1. 在独立 worktree 里 checkout 该分支，`git pull --rebase` 后跑 `pnpm gate`。
2. 对照任务段的「完成判据」逐条核，缺一条即打回，不做「差不多」。
3. 读 Agent Note 的 Alternatives considered：没有记录真实取舍的不收。
4. mission / lab / datasets 的改动额外跑通用性 grep（红线词表见各提案验收标准）。
5. 多个分支同时绿时，按文件不重叠原则任意顺序合入；有重叠先合改动小的。
6. 迭代收口只看 README「迭代计划」里该行的完成判据；达到后把本文对应迭代的任务表状态更新，再写下一迭代的指引文案。
