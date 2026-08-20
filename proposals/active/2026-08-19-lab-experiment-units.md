# 受控实验单元（lab）

- **分类**：plugin
- **状态**：in-progress（M1 已交付，见实现记录）
- **最后更新**：2026-08-20
- **查重结果**：已搜 `proposals/active/`、`proposals/closed/`（空）、`.agents/notes/`（含 archived）——无同意图提案。`mission-tasks` 提案明确不碰资源生命周期（"不透明资源引用"），本提案填补该空白；与 `datasets-store` 的关系是**可选协同方**（populate 的目录路径可由其 `worktree_path` 产出，无代码级依赖）。
- **官方依赖**：纯插件（`ctx.tools` / `ctx.commands` / `ctx.subprocess` 均已实测存在；状态与索引写 mission，输入内容收调用方给的目录路径，自身不新增持久化）

## 目标

交付 `@khorsheed/dsh-lab`：**受控实验单元的生命周期管理**。

一个实验单元 = 一个隔离、条件一致、可重复的执行环境。插件负责获取 / 物化输入 / 记检查点 / 跑验证 / 归档 / 释放；**不判断结果、不管状态机、不发起任务**。

服务的场景形状是：**一批受试对象 × 一批用例 × 隔离一致的执行环境 × 结果需对照**——评测是其中一种，A/B 测配置、跨版本回归、批量数据处理验证同样是。

## 现状

- **空白确认**：`mission` 提案明确"不碰容器生命周期，但持有释放许可"，`refs.resource` 是不透明标识；`datasets` 提案明确"没有 materialize，文件形态由编排侧用只读挂载 / `git worktree` 解决"。**两者都有意把资源生命周期留在外面，至今无人承接。**
- **已实测可用**：`ctx.subprocess` 管进程树与终止阶梯；`docker exec` 的孤儿进程问题已实测确认（杀宿主客户端后容器内进程仍存活），需 pidfile + 容器内 kill 补偿。
- **两种真实隔离需求**：容器（评测，条件完全一致）与 `git worktree`（日常改造类任务，本仓库 AGENTS.md「One worktree owns one change」即此形态）。provider 抽象因此不是投机。

## 方案

### 边界（三方分工）

| | 管什么 | 不管什么 |
|---|---|---|
| `datasets` | 版本化内容 | 谁在用、放哪 |
| `mission` | 状态、计划、判定记录 | 资源 |
| **`lab`** | **资源的获取 / 物化 / 检查点 / 验证执行 / 归档 / 释放** | **状态与判断**（只查 mission 的许可） |

依赖关系收敛到字符串级：`lab → mission`（写 refs/artifact、读 `is-releasable`，缺席时降级 warn）；**lab 对 datasets 无代码级依赖**——`populate` 收一个目录路径，路径由谁产出 lab 不关心（评测场景由 datasets 的 `worktree_path` 产出，层白名单在那一侧强制）；datasets 与 mission 互不依赖。任何一个包单独装都有完整价值。

### 动词

| 动词 | 作用 | 模型工具 |
|---|---|---|
| `acquire` | 按 provider 配置准备隔离单元；把资源标识与**环境指纹**（镜像 digest 等）写入 mission 的 `refs` | ✓ |
| `populate` | 把**指定目录**（通常是 datasets `worktree_path` 产出的整层只读视图，也接受调用方自供路径）物化进单元：docker 下零拷贝只读路径是 `acquire` 时声明的 `mounts`（容器创建后无法追加挂载），`populate` 本身是拷入单元可写层 | ✓ |
| `collect` | 从单元取回指定路径的产出，登记为 mission artifact —— `populate` 的反向 | ✓ |
| `checkpoint` | 记一个可回溯点（容器 provider 下即 `git tag`），写入 mission checkpoint 的 `ref` | ✓ |
| `verify` | 挂载验证物、执行、**原样记录退出码与输出**到 mission 的 `lab` ns | ✓ |
| `archive` | 导出单元内容 + 完整性校验，登记 artifact | ✓ |
| `release` | 查 `mission.is-releasable`，**通过才释放**；不通过或查询失败（fail closed）都拒绝执行；无 gate 时需显式 `force` 并 warn | — |
| `status` | 查询单元状态 | ✓ |

**`release` 不是模型工具**（CLI / slash only），与 mission 把 `mission_is_releasable` 和 `export` 排除在模型面之外同源：销毁隔离单元不可逆，gate 只回答「状态上允许了吗」，回答不了「人现在还想不想进去看」。一个到达可释放状态的单元仍可能是人正要查的现场。

### 三条红线

1. **`verify` 只记录不判断。** 它跑命令、收退出码与输出，原样写进 mission。"通过与否""几分"是消费方的语义，插件不碰——这是通用性的关键，一旦 lab 开始解释结果就退化成评测专用件。
2. **`release` 是 gate 的执行点。** 内部查询 mission 状态，不通过就拒绝。调用方拿不到"跳过校验直接释放"的动词。
3. **不发起任何任务。** 与 mission「不点火」一致：lab 提供动作，何时调用由人 / agent / 外部编排决定。

### 对 mission 服务面的要求

lab 单向依赖 mission，走**服务面**（`ctx.get('mission')`）而非模型工具面或 CLI 子进程。mission 提案的接口表只列了模型工具 / CLI / slash 三面——下列方法需要在服务面可达，否则 lab 只能走子进程调 CLI（丢类型、丢错误）或直写其 JSON（破坏单一所有权）：

| lab 动词 | 需要的服务方法 | 用途 |
|---|---|---|
| `acquire` | 写 `refs.resource` 与环境指纹 | 资源标识登记到 attempt |
| `collect` / `archive` | 登记 artifact | 产出入册 |
| `checkpoint` | 登记 checkpoint 的 `ref` | 可回溯点 |
| `verify` | 追加 annotation（ns 固定为 `lab`） | 退出码与输出原样记录 |
| `release` | 读 is-releasable | gate 查询 |

三点约定：

1. **ns 固定为 `lab`。** mission 的 ns 写入端自由，但 lab 是程序化写入方，ns 浮动会让汇总端的 `expectedNs` 对不上。评测回路里人肉判定脚本写 `script` ns，lab 写 `lab` ns，两者不混。
2. **checkpoint 的 `ref` 只由 lab 填。** mission 自己在 `mission_submit` 时登记的 checkpoint 不带 `ref`（它不知道容器里的 git tag）。避免同一时刻出现两条 checkpoint。
3. **缺席时降级。** 未装 mission 时 lab 全部动词仍可用，登记类操作 warn 后跳过，`release` 的 gate 查询无从进行——此时要求显式 `--force` 参数，不静默放行。

### provider

第一版只实现 `docker`，接口按能容纳 `worktree` 的形状设计（两者都是当前存在的真实需求，非投机）。

**与 datasets 的 worktree 不是一回事**，实现时勿混：datasets 的托管 worktree 是**只读**的数据集层视图（题面从哪来），lab 的 worktree provider 是**可写**的工作隔离单元（活在哪干）。评测场景下两者同时存在——前者被 `populate` 物化进后者。

`docker` provider 必须处理已实测的孤儿进程问题：spawn 时写 pidfile，teardown 时**进容器按 pid 终止**，宿主侧杀 `docker exec` 客户端只是第一层。

### 一致性保障

- **环境指纹入 refs**：`acquire` 把镜像 digest（worktree 下为 base commit）写进 mission。**环境变了结果就不可比**，这与 dataset 快照同等重要，必须是机制而非约定。
- **`maxConcurrentUnits`**（config）：活跃单元达上限时 `acquire` 拒绝。插件不理解"哪些阶段可并发"（那是调用方的语义），但一个数字上限足以挡住误并发——而并发导致的耗时失真是隐蔽的，格子照常"完成"，数据已废。

## 里程碑

- **M1** 核心 + docker provider：`acquire` / `populate` / `collect` / `release` / `status`；pidfile 终止补偿；环境指纹写入；`maxConcurrentUnits`
- **M2** `checkpoint` / `verify` / `archive` + CLI 面
- **M3** 工具面（`lab_*`）+ systemPrompt 引导段 + slash
- **M4** 随一次真实实验端到端验收；记录耗时与卡点

## 验收标准（done 判定）

1. `dsh plugin add / remove` 可装可卸，零官方改动；无 mission 时降级为显式路径参数模式（`release` 退化为无 gate，**需显式 `force` 且必须 warn**）；无 datasets 时 `populate` 收显式目录路径，功能完整。
2. **通用性 grep**：源码不出现 `rubric` / `score` / `verdict` / `player` / `stage` / `judge`（动词 `verify` 除外，且其实现中无判断分支）。
3. `verify` 单测：命令失败 / 超时 / 无输出三种情形均**如实记录**，不产生任何"通过"结论。
4. `release` 单测：mission 未置 releasable 时拒绝（force 不可绕过）；is-releasable 查询失败 fail closed；无 mission 时需 `force` + warn 才放行；各路径均有测试。
5. **孤儿进程实测**：委派中途取消后，容器内无残留进程。
6. 环境指纹实测：同一 mission 两次 `acquire` 使用不同镜像时，`refs` 中记录不同 digest。
7. `maxConcurrentUnits` 实测：超限 `acquire` 拒绝且报错明确。
8. `pnpm run build && pnpm run test` 绿；双语 README + Compatibility + `dsh.compat`。

## 实现记录

- **M1 已交付**（2026-08-20，commit `71147bf`）：`packages/lab`（`@khorsheed/dsh-lab`）——`ctx.lab` 服务面 + docker provider（acquire / populate / collect / release / status）、环境指纹入 refs、容器标签即注册表（宿主重启后 reconcile，gate 不失效）、pidfile 终止补偿、`maxConcurrentUnits`；26 测试全绿（Exec 假件，无需 docker daemon）。Agent Note：`.agents/notes/implemented/feature/2026-08-20-lab-m1.md`（含偏离说明：populate 语义=acquire 时挂载 + 拷入单元；无 gate 的 release 需显式 force + warn；invariant 为无数据的所有权预留）。
- **M2 已交付**（2026-08-20）：`checkpoint` / `verify` / `archive` 三动词——checkpoint = 工作区 git（首次自动 init）+ tag，sha 入 mission checkpoint `ref`；verify 原样记录（退出码/stdout/stderr/耗时/超时事实）入 `lab` ns，无任何判断分支；archive = 工作区导出 + 逐文件 sha256 manifest。CLI 面 `dsh-lab`：同内核配 `child_process` 运行器，release gate 走 `dsh-mission is-releasable` 的 0/1 退出码（其他退出码 fail closed），verify 经 `dsh-mission annotate` 落记录；refs/artifact/checkpoint 登记仅进程内服务面（mission CLI 无此动词，CLI 模式 warn 跳过）。50 测试全绿（含桩 docker/dsh-mission 二进制的 CLI 端到端）。Agent Note：`.agents/notes/implemented/feature/2026-08-20-lab-m2-verbs.md` 与 `2026-08-20-lab-m2-cli.md`（后者含 M1 遗留 docker 前缀缺陷的修复说明）。待办：活 profile + 真 daemon 冒烟（验收 1/5/6/7）。

## 风险 / 放弃的东西

- **不做调度器**：不判断哪些单元该并发、不排计划、不点火。`maxConcurrentUnits` 是安全阀不是调度策略。
- **不做判断**：`verify` 记录而不结论；任何"通过率""得分"都在消费方。
- **provider 只做 docker**：`worktree` 接口预留但不实现，等真实需求出现再补——两种需求都已存在，但同时实现会拖慢 M1。
- **`worktree` provider 不得用于需要可比性的实验**：它与 docker 的隔离强度差一个量级——共享文件系统（`cd ..` 即可看到同级单元）、无网络隔离、无资源限制、环境取决于宿主。它的真实用途是单人并行改造多个任务（隔离为了不互相打断），不是防作弊与条件一致。接口就绪后需在文档与工具描述中写死这条限制。
- **`release` 在无 mission 时无 gate**：独立可用是硬要求，但此时不可逆操作失去保护——需显式 `force` 并 warn（对齐 mission 提案 §5 的消费方纪律）。使用方需自行保证归档。
- **输入路径即接口，无 datasets 依赖**：`populate` 只收目录路径——逐文件 `git show` 拼装与整仓拷贝两条路都不可接受，整层视图由 datasets 的 `worktree_path`（共享对象库 worktree + sparse-checkout 限层）产出，该接口已承入 `datasets-store` M1。路径从 datasets 来还是调用方自供，对 lab 同形态；层白名单的强制点在「经 datasets 获取内容」那一刻，谁自供路径谁为内容担保。
- **孤儿进程补偿不是完备方案**：pidfile 只覆盖已知的 `docker exec` 路径；provider 换实现时需重新验证终止语义。
