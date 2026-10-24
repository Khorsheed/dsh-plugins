# @khorsheed/dsh-eval-suite

[English](README.en.md) | 中文

在本机把几家 CLI 智能体（Kimi、Codex、Claude Code、dsh）放进同一套题目里做对照评测：同一批题、同样的条件，结果并排摆出来。

以前想知道「这类任务交给 Codex 好还是 Claude Code 好」，只能挨个开终端、手工喂题、凭印象比；换一个模型或配置再比一次，上次的条件早就对不上了。装上评测套件、把会话切到「评测模式」，题集登记成只读、钉住版本的数据来源；一个实验就是「哪道题 × 哪个对比组 × 第几次」的矩阵，编排器逐格委派给本机的 CLI、收卷、判分，账本记下每一格走过的每一步，结果对比页把配对结果并排摆出来。agent 帮你读题集、起草实验和对比组、把手头的数据整理成题集、读结果写分析初稿；起跑、登记题集和终评始终是你的动作。这个套件写给要在本机横向比较编码 agent 的人。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-bundle-eval-hero.png" width="640" alt="评测模式的会话：右侧「实验室」页显示一个实验的结果对比——每道题一行，两个对比组的得分与差值并排">

## 可以这样跟 agent 说

- 「列出已登记的题集，每个有多少题、分几层？」
- 「起草一个实验：用这个题集比较 Codex 和 Claude Code，同一个模型，各跑一次。」
- 「把这个目录里的题整理成题集，校验一遍，然后提交登记申请。」
- 「读一下上次 run 的结果，写一份分析初稿。」

## 特性

- **题集只读、钉版本**——题集登记后按版本钉住、只读取用，agent 只能按登记引用，登记时放行的层之外一概读不到。
- **实验是一张矩阵**——题 × 对比组 × 次数；右侧「实验室」页按实验设计、运行记录、结果对比、人工评估四个阶段走，每一步顶上一条状态和一个该做的动作。
- **agent 起草，你来起跑**——agent 能起草实验和对比组、写分析初稿，但起不动任何 run；`/eval run` 由你发起，在后台跑，关掉会话或标签页也照跑。
- **逐格委派到本机 CLI**——每一格经本地 Agent 家族委派给对应的 CLI，在宿主目录或 Docker 容器里跑。
- **每一步都有账**——任务账本记下每一格的运行、尝试与状态变化，结果可导出、可复核。
- **判分三条路**——探针脚本自动判、判官盲评出初稿、人工终评定结论；人工评估时同一道题的各份作答并排摆开，看不到出自哪家 CLI。
- **结果并排比**——配对差值表一行一道题：两侧得分、差值、由谁判；样本不够时报告直接说不排名。
- **数据整理成题集**——agent 可以把手头的数据整理成题集、校验、提交登记申请，登记由人批准。
- **只在评测模式的会话里出现**——题集与评测的模型工具按会话授予，其它会话一个也看不到。

## 成员

| 成员 | 它做什么 |
| --- | --- |
| 题集（`@khorsheed/dsh-datasets`） | 题集登记、钉版只读取用，「题集」页 |
| 实验单元（`@khorsheed/dsh-lab`） | Docker 容器单元的申请、指纹、校验与销毁 |
| 评测（`@khorsheed/dsh-eval`） | 编排器：实验、对比组、运行、判分、报告，「实验室」页；另含任务账本（2026-10-24 由 dsh-mission 并入） |
| 本地 Agent 核（`@khorsheed/dsh-local-agent`） | 委派家族核心：评测的运行经它委派给各家 CLI |
| Kimi（`@khorsheed/dsh-local-agent-kimi`） | Kimi CLI 提供方 |
| Codex（`@khorsheed/dsh-local-agent-codex`） | Codex CLI 提供方 |
| Claude Code（`@khorsheed/dsh-local-agent-claude-code`） | Claude Code 提供方 |
| dsh 委派（`@khorsheed/dsh-local-agent-dsh`） | dsh 提供方（设置 → 本地 Agent 开关，默认关） |

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-eval-suite
```

重启 web 实例后生效。随后在会话的模式选择器里切到「评测模式」即获得按域裁剪的评测工具。

<!-- collection:start -->
推荐连同基础体验一起装(「评测」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-eval-suite
```

卸载即整族移除；想保留家族、只关某一个成员，用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：❌ 不支持——评测家族成员地板统一为宿主 `0.2.0-rc.2`（local-agent 家族五成员地板 `0.1.5-rc.1`，低于它）。
- 源码线（deepseek-harness 0.2 线）：✅ 完整（minHost: 0.2.0-rc.2，verifiedHost: 0.2.1-rc.1）——host-021 波对 0.2.1-rc.1 树全量 build+test 绿，无其它表面变化。

**版本线对照**：`0.1.0` 起要求宿主 `0.2.0-rc.2` 及以后。

## 已知限制

- **lab 需要 Docker**——容器路径要本机有可用的 Docker 守护进程；没有时 lab 的动词在调用时报错，eval 的容器路径点名 lab 拒绝启动，宿主路径、题集与账本不受影响。本包不代装 Docker，也不代建评测镜像。
- **被评 CLI 本体自备**——各家 CLI 的安装与登录（`kimi login` / `codex login` / `claude auth` …）不在本包范围；委派家族本身（localAgent 服务与四家 harness 提供方）已随本包装齐，eval 的 run / provision 动词经 localAgent 门面委派，服务缺席时点名拒绝。
- **卸载是整族的**——remove 本包会把全部成员一起移除；单个停用请用 bundle 详情页的行级开关。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**纯组合元包（模式包）。** 本包不注册任何服务、工具、槽位或命令。`cordis.patch.yml` 的成员行都来自对应成员包自己的 `cordis.patch.yml`，id 与 name 原样；末尾另有一行 `preset-dsh-eval`（`@deepseek-ai/dsh-agent-preset` 声明，模式 id `dsh-eval`）是本包自有的正本——它曾镜像自 `@khorsheed/dsh-presets`，该包已于 2026-10-24 退役。仓级 check:plugins 的 `dsh.bundle.kind: 'mode'` sanction 机械钉死这一点：行只允许落在「成员规范行全集 − 伴生组合行（`./tool` 等子路径入口行）＋ 恰好一行 preset-<mode>」白名单内，被减去的伴生行必须由本包 preset 组合点名授予（授予语义不丢），成员必须是真实自挂载包，每个成员必须至少贡献一行，mode 值全树唯一；同一行 id 出现在多个 bundle patch 里时（本包与 dsh-dev / bundle-local-agent 共享的 local-agent 行）内容必须一致。

| 成员包 | 行 id |
| --- | --- |
| `@khorsheed/dsh-datasets` | `datasets`；`datasets-tool`（由本包 preset 授予） |
| `@khorsheed/dsh-lab` | `lab` |
| `@khorsheed/dsh-eval` | `eval`（一并挂载任务账本）；`eval-tool`（由本包 preset 授予） |
| `@khorsheed/dsh-local-agent` | `local-agent` |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi` |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex`（+ override `tool-subagent-codex`） |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code`（+ override `tool-subagent-claude-code`） |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` |

挂载后评测家族三行、委派家族五行与评测模式 preset 一并就位。家族折叠前还有三个伴生包 `@khorsheed/dsh-datasets-tool` / `-mission-tool` / `-eval-tool`，已退役——各自折进核心包的 `./tool` 组合入口，预设行 id 不变；任务账本 2026-10-24 由 `@khorsheed/dsh-mission` 并入 eval。另有 deps-only 的 `@khorsheed/dsh-local-agent-dsh-headless` 随依赖到达，无卡片无行——与 dsh-dev 同一处理。

**模型工具按会话授予。** `datasets_*` 与 `eval_*` 工具不挂在 profile 根，而是各成员包自己的 `./tool` 组合入口（`@khorsheed/dsh-datasets/tool`、`@khorsheed/dsh-eval/tool`），由 agent 预设点名授予；本包携带的 `preset-dsh-eval` 行就是评测模式的授予点（`datasets-tool` / `eval-tool`），没点名的预设一个都拿不到——profile 根挂一行等于给所有会话授予，正是工具行拆分要去掉的。要在其它预设里给模型评测工具，在那个 agent 预设里点名对应的 `./tool` 行，例如：

```yaml
- id: eval-tool
  name: '@khorsheed/dsh-eval/tool'
```

评测会话**不**授予 local-agent 家族的 `subagent_*` 委派工具：eval 对 localAgent 是服务级消费（编排器委派运行），preset 行不点名任何 local-agent 的 `./tool` 行。

**装我 = 装一族，不双挂。** 成员全部列进 `dependencies`（安装即带齐），同时登记进 `dsh.references`（家族名册供 pack 期与目录层读取）。机制依据：`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层（`reconcilePlugins`）——装本 bundle 只应用**本** patch，成员作为传递依赖到达，它们自己的 patch 不被应用，任何一行都不会挂两次。成员单独 `dsh plugin add` 仍自挂载（仓规不破）；两者同装时的行重叠由官方 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**（`MODE` / `FAMILY_MEMBERS`），让包有可构建的 `lib/`（pack-dist 的硬性要求）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/bundle-eval`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
