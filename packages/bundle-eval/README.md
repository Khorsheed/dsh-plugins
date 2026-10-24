# @khorsheed/dsh-eval-suite

[English](README.en.md) | 中文

在本机把几家 CLI 智能体（harness）放进同一套题目里做对照评测——一个包装齐评测家族与委派家族。

题集登记成只读的数据来源，实验把「哪道题 × 哪个条件 × 第几次」展开成矩阵，编排器逐格委派、收卷、判分，账本记下每一格走过的每一步，结果页把配对结果摆在一起。这个模式包把题集、账本、容器单元、编排器四个评测成员与 local-agent 委派家族（核心加 kimi / codex / claude-code / dsh 四家 harness 提供方）一次装齐，同时携带 `dsh-eval`（评测模式）agent preset 行——切到评测模式的会话自动拿到按域裁剪的 `datasets_*` / `eval_*` 工具与题集整理能力。清单里只多一张「评测套件」卡片，不用逐包挑选。

## 特性

- **一次装齐两族**——datasets（题集登记与只读物化、题集 tab）、mission（运行与尝试的账本、释放闸）、lab（Docker 容器单元）、eval（编排器、实验室 tab）四个评测成员，外加 local-agent 委派家族（核心 + kimi / codex / claude-code / dsh 四家提供方）与评测模式 preset 行，一条 `dsh plugin add` 全部就位。
- **模型工具按会话授予**——`datasets_*`、`mission_*`、`eval_*` 工具不挂在 profile 根，而是各成员包自己的 `./tool` 组合入口（`@khorsheed/dsh-datasets/tool` 等），由 agent 预设点名授予；本包携带的 `preset-dsh-eval` 行就是评测模式的授予点（`datasets-tool` / `eval-tool`），没点名的预设一个都拿不到。
- **清单里只有一张卡**——locale 卡面元数据把整族归成一张「评测套件」卡。
- **纯组合，零运行时**——本包不注册任何服务/工具/槽位/命令；patch 逐字复用成员的规范行，装我不双挂（机制见文末实现原理）。

## 成员

| 成员包 | 行 id | 内容 |
| --- | --- | --- |
| `@khorsheed/dsh-datasets` | `datasets` | 题集登记、只读物化、题集 tab；`datasets_*` 工具是包内 `./tool` 组合入口，由预设点名授予 |
| `@khorsheed/dsh-mission` | `mission` | 运行 / 任务 / 尝试的账本与释放闸、任务 tab；`mission_*` 工具是包内 `./tool` 组合入口，由预设点名授予 |
| `@khorsheed/dsh-lab` | `lab` | 容器单元的申请、指纹、校验与销毁（Docker） |
| `@khorsheed/dsh-eval` | `eval` | 编排器：实验、条件库、运行、判分、报告、实验室 tab；`eval_*` 工具与 `/eval` 是包内 `./tool` 组合入口，由预设点名授予 |
| `@khorsheed/dsh-local-agent` | `local-agent` | 委派家族核心：scoped home 根、运行外观与各 harness 的共用门面——eval 的 run / provision 动词经它委派外部 CLI |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi` | Kimi harness 提供方 |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex` | Codex harness 提供方 |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code` | Claude Code harness 提供方 |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` | dsh harness 控制器（设置 → 本地 Agent 开关，默认关） |

（家族折叠前还有三个伴生包 `@khorsheed/dsh-datasets-tool` / `-mission-tool` / `-eval-tool`；已退役——各自折进核心包的 `./tool` 组合入口，预设行 id 不变。另有 deps-only 的 `@khorsheed/dsh-local-agent-dsh-headless` 随依赖到达，无卡片无行——与 dsh-dev 同一处理。）

评测会话**不**授予 local-agent 家族的 `subagent_*` 委派工具：eval 对 localAgent 是服务级消费（编排器委派运行），preset 行不点名任何 `./tool` 行。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-eval-suite
```

重启 web 实例后生效。挂载后评测家族四行、委派家族五行与评测模式 preset 一并就位；在会话的模式选择器里切到「评测模式」即获得按域裁剪的评测工具。要在其它预设里给模型评测工具，在那个 agent 预设里点名对应的 `./tool` 行，例如：

```yaml
- id: eval-tool
  name: '@khorsheed/dsh-eval/tool'
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-eval-suite
```

卸载即整族移除；想保留家族、只关某一行，用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：❌ 不支持——评测家族四成员地板统一为宿主 `0.2.0-rc.2`（local-agent 家族五成员地板 `0.1.5-rc.1`，低于它）。
- 源码线（deepseek-harness 0.2 线）：✅ 完整（minHost: 0.2.0-rc.2,verifiedHost: 0.2.1-rc.1)——host-021 波对 0.2.1-rc.1 树全量 build+test 绿,无其它表面变化。

**版本线对照**：`0.1.0` 起要求宿主 `0.2.0-rc.2` 及以后。

## 已知限制

- **lab 需要 Docker**——容器路径要本机有可用的 Docker 守护进程；没有时 lab 的动词在调用时报错，eval 的容器路径点名 lab 拒绝启动，宿主路径、题集与账本不受影响。bundle 不代装 Docker，也不代建评测镜像。
- **被评 CLI 本体自备**——各家 CLI 的安装与登录（`kimi login` / `codex login` / `claude auth` …）不在本包范围；委派家族本身（localAgent 服务与四家 harness 提供方）已随本包装齐，eval 的 run / provision 动词经 localAgent 门面委派，服务缺席时点名拒绝。
- **卸载是整族的**——remove 本包会把全部成员一起移除；单行停用请用 bundle 详情页的行级开关。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**纯组合元包（模式包）。** `cordis.patch.yml` 的成员行都来自对应成员包自己的 `cordis.patch.yml`，id 与 name 原样；末尾另有一行 `preset-dsh-eval`（`@deepseek-ai/dsh-agent-preset` 声明）逐字镜像自 `@khorsheed/dsh-presets`，由 `scripts/preset-mode-parity.spec.ts` 钉住两边不漂移（presets 包退役后此处为正本）。仓级 check:plugins 的 `dsh.bundle.kind: 'mode'` sanction 机械钉死这一点：行只允许落在「成员规范行全集 − 伴生组合行（`./tool` 等子路径入口行）＋ 恰好一行 preset-<mode>」白名单内，被减去的伴生行必须由本包 preset 组合点名授予（授予语义不丢），成员必须是真实自挂载包，每个成员必须至少贡献一行，mode 值全树唯一；同一行 id 出现在多个 bundle patch 里时（本包与 dsh-dev / bundle-local-agent 共享的 local-agent 行）内容必须一致。

**装我 = 装一族，不双挂。** 成员全部列进 `dependencies`（安装即带齐），同时登记进 `dsh.references`（家族名册供 pack 期与目录层读取）。机制依据：`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层（`reconcilePlugins`）——装本 bundle 只应用**本** patch，成员作为传递依赖到达，它们自己的 patch 不被应用，任何一行都不会挂两次。成员单独 `dsh plugin add` 仍自挂载（仓规不破）；两者同装时的行重叠由官方 bundle 详情页的行级开关解决。

**工具行不进 patch。** 三个 `./tool` 组合入口是预设授予点：profile 根挂一行等于给所有会话授予，正是工具行拆分要去掉的。

**`src/index.ts` 只导出常量**（`MODE` / `FAMILY_MEMBERS`），让包有可构建的 `lib/`（pack-dist 的硬性要求）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/bundle-eval`）。问题与贡献请移步该仓库。
