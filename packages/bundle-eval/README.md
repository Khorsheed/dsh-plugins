# @khorsheed/dsh-bundle-eval

[English](README.en.md) | 中文

在本机把几家 CLI 智能体（harness）放进同一套题目里做对照评测——一个包装齐整个评测家族。

题集登记成只读的数据来源，实验把「哪道题 × 哪个条件 × 第几次」展开成矩阵，编排器逐格委派、收卷、判分，账本记下每一格走过的每一步，结果页把配对结果摆在一起。这个家族 bundle 把题集、账本、容器单元与编排器四个成员一次装齐，清单里只多一张「评测」卡片，不用逐包挑选。

## 特性

- **一次装齐一族**——datasets（题集登记与只读物化、题集 tab）、mission（运行与尝试的账本、释放闸、任务 tab）、lab（Docker 容器单元）、eval（编排器、实验室 tab）四个成员，一条 `dsh plugin add` 全部就位。
- **模型工具按会话授予**——`datasets_*`、`mission_*`、`eval_*` 工具不挂在 profile 根，而是各成员包自己的 `./tool` 组合入口（`@khorsheed/dsh-datasets/tool` 等），由 agent 预设点名授予；没点名的预设一个都拿不到。
- **清单里只有一张卡**——locale 卡面元数据把整族归成一张「评测」卡。
- **纯组合，零运行时**——本包不注册任何服务/工具/槽位/命令；patch 逐字复用成员的规范行，装我不双挂（机制见文末实现原理）。

## 成员

| 成员包 | 行 id | 内容 |
| --- | --- | --- |
| `@khorsheed/dsh-datasets` | `datasets` | 题集登记、只读物化、题集 tab；`datasets_*` 工具是包内 `./tool` 组合入口，由预设点名授予 |
| `@khorsheed/dsh-mission` | `mission` | 运行 / 任务 / 尝试的账本与释放闸、任务 tab；`mission_*` 工具是包内 `./tool` 组合入口，由预设点名授予 |
| `@khorsheed/dsh-lab` | `lab` | 容器单元的申请、指纹、校验与销毁（Docker） |
| `@khorsheed/dsh-eval` | `eval` | 编排器：实验、条件库、运行、判分、报告、实验室 tab；`eval_*` 工具与 `/eval` 是包内 `./tool` 组合入口，由预设点名授予 |

（家族折叠前还有三个伴生包 `@khorsheed/dsh-datasets-tool` / `-mission-tool` / `-eval-tool`；已退役——各自折进核心包的 `./tool` 组合入口，预设行 id 不变。）

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-bundle-eval
```

重启 web 实例后生效。挂载后家族四行就位；要在某类会话里给模型评测工具，在那个 agent 预设里点名对应的 `./tool` 行，例如：

```yaml
- id: eval-tool
  name: '@khorsheed/dsh-eval/tool'
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-bundle-eval
```

卸载即整族移除；想保留家族、只关某一行，用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：❌ 不支持——成员地板统一为宿主 `0.2.0-rc.2`。
- 源码线（deepseek-harness 0.2 线）：✅ 完整（minHost: 0.2.0-rc.2,verifiedHost: 0.2.1-rc.1)——host-021 波对 0.2.1-rc.1 树全量 build+test 绿,无其它表面变化。

**版本线对照**：`0.1.0` 起要求宿主 `0.2.0-rc.2` 及以后。

## 已知限制

- **lab 需要 Docker**——容器路径要本机有可用的 Docker 守护进程；没有时 lab 的动词在调用时报错，eval 的容器路径点名 lab 拒绝启动，宿主路径、题集与账本不受影响。bundle 不代装 Docker，也不代建评测镜像。
- **只装 dsh 侧**——被评测的各家 CLI 本体与委派能力来自 local-agent 家族（`@khorsheed/dsh-bundle-local-agent`），不在本 bundle 里；eval 的 run 动词在缺 localAgent 时点名拒绝。
- **卸载是整族的**——remove 本包会把全部成员一起移除；单行停用请用 bundle 详情页的行级开关。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**纯组合元包。** `cordis.patch.yml` 的每一行都来自对应成员包自己的 `cordis.patch.yml`，id 与 name 原样。仓级 check:plugins 的 `dsh.bundle.kind: 'family'` sanction 机械钉死这一点：行只允许落在「成员规范行全集」白名单内，成员必须是真实自挂载包，每个成员必须至少贡献一行。

**装我 = 装一族，不双挂。** 成员全部列进 `dependencies`（安装即带齐），同时登记进 `dsh.references`（家族名册供 pack 期与目录层读取）。机制依据：`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层（`reconcilePlugins`）——装本 bundle 只应用**本** patch，成员作为传递依赖到达，它们自己的 patch 不被应用，任何一行都不会挂两次。成员单独 `dsh plugin add` 仍自挂载（仓规不破）；两者同装时的行重叠由官方 bundle 详情页的行级开关解决。

**工具行不进 patch。** 三个 `./tool` 组合入口是预设授予点：profile 根挂一行等于给所有会话授予，正是工具行拆分要去掉的。

**`src/index.ts` 只导出常量**（`FAMILY_MEMBERS`），让包有可构建的 `lib/`（pack-dist 的硬性要求）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/bundle-eval`）。问题与贡献请移步该仓库。
