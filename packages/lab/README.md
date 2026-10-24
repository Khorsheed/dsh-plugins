# @khorsheed/dsh-lab

[English](README.en.md) | 中文

给每一格实验一个隔离、条件一致、可重复的 Docker 容器，并把「环境是不是同一个」变成一个可以比对的指纹。

对照实验要比的是受试对象，不是环境：同一批题、几家 harness 各跑几次，只要某一格多挂了一个目录、换了张网络、资源上限不同，结果就不再可比。评测模式的计划带 `unit` 段时，编排器就用这个插件给每一格申请一个容器单元：放进题面、在里面委派与校验、收回产出、归档现场，过了释放闸再销毁。它同样适用于任何「一批受试对象 × 一批用例 × 隔离一致的环境 × 结果需对照」的场景，比如 A/B 测配置、跨版本回归。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/lab-record-env.png" width="640" alt="实验室运行记录详情：参数配置表里的环境指纹与容器单元，和同一 run 其余格子的指纹一致">

## 特性

- **完整的单元生命周期**——acquire / populate / collect / checkpoint / verify / archive / release / status 八个动词，服务面 `ctx.lab` 与 `dsh-lab` CLI 共用同一个内核。
- **复合环境指纹**——镜像 digest、资源上限、挂载（容器内路径与类型）、环境变量键名、网络、用户各算一个分量，合成 `lab-env:<hex>`；声明的东西真的加到容器上，指纹不会宣称容器并不具备的隔离。
- **只记录，不判断**——lab 登记资源标识、指纹、产物与校验命令的原样输出；「通过与否」「几分」是消费方的事。
- **释放就是过闸**——单元绑定任务且任务账本（随 `@khorsheed/dsh-eval` 安装）在场时，`release` 必须先通过 `isReleasable`，查询失败即拒绝；没有闸时要显式 `force` 并告警。
- **重启不丢**——docker daemon 就是注册表：单元 id、指纹与任务绑定都记在容器标签上，宿主重启后 reconcile 重新领养。
- **失败不毁现场**——崩溃的格子先 collect、再 archive、再走同一条闸，然后只为这一格开新 attempt。
- **防误并发与孤儿进程**——`maxConcurrentUnits`（缺省 4）挡住误并发；lab 自己 spawn 的容器内进程会在 release 前被清扫。
- **按实例作用域共用一个 daemon**——带 `scope` 的实例只领养、只操作自己作用域的单元，跨作用域一律拒绝。

一眼看出公平与可比：

```text
UNIT      MISSION           CONTAINER   LAST-ACTIVITY  TASK      ENV       LABELS
u-a3f9    cell-1:working    up 2h14m    3m ago         9f2c1a2b  4d1e77b0  task=F1,subject=A
u-b71c    cell-2:collected  up 2h14m    47m ago        9f2c1a2b  4d1e77b0  task=F1,subject=B
```

`dsh-lab status` 每行一个单元：TASK 哈希一致说明题面一致，ENV 一致说明环境可比，`working` 行配很长的 `LAST-ACTIVITY` 就是卡住了。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/lab-run-units.png" width="640" alt="结果对比页的「未回收单元」一节：逐个列出本 run 仍持有的容器、所属格子的状态与「回收」按钮">

## 安装

推荐随评测模式一起装（题集、本插件、评测编排器与 local-agent 委派家族，外加评测模式 preset）：

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```

也可以单独安装：

```sh
dsh plugin --profile web add @khorsheed/dsh-lab
```

重启 web 实例后生效。要求：宿主机能用 docker CLI；镜像需自带 `sleep` 与 `sh`（checkpoint 还需要 `git`）。可选配置：`maxConcurrentUnits`（缺省 4）、`stateDir`（指纹镜像目录，缺省 `$DSH_HOME/lab`）、`scope`（实例作用域，缺省不启用）。

```sh
dsh plugin --profile web remove @khorsheed/dsh-lab
```

## Compatibility

- npm release line（`@deepseek-ai/dsh@0.2.0-rc.2`）：✅ —— 服务面与 docker provider 在已发布宿主上完整可用。T88 起评测家族一起把 minHost 抬到 0.2.0-rc.2，0.1.x 宿主请停留在旧发布线。
- source line（deepseek-harness master，fork 或 upstream）：✅ —— 同上（verifiedHost: 0.2.1-rc.1）；host-021 波对 0.2.1-rc.1 树全量 build+test 绿，无其它表面变化。

降级 / 缺席项（与 package.json 的 `dsh.compat` 同步）：未安装任务账本（随 `@khorsheed/dsh-eval` 安装）时，release gate 降级为显式 force 标志加告警，refs / artifact / checkpoint / verify 登记 warn 跳过。`dsh-lab` 读 mission 状态走 `dsh-mission get --json`（T89），对不认 `--json` 的旧版 mission CLI 给出升级提示并跳过该项状态。`lab_*` 模型工具（M3）在本线尚不存在。

## 已知限制

- **只有 docker provider**——worktree provider 只有接口形状；它的隔离强度差一个量级，不得用于需要可比性的实验。
- **`populate` 是拷贝**——零拷贝只读输入要在 acquire 时用 `mounts` 声明，容器创建后无法追加挂载。
- **指纹记的是声明，不是实测**——它挡的是「同一批 run 里配置被改了」，不是「两台机器完全一样」；内核、CPU 型号等宿主差异不在分量里。要断言无外网，必须显式声明一张 `--internal` 网络。
- **孤儿清扫只覆盖 lab 自己的 exec**——外来的 `docker exec` 进程看不见（移除容器时仍会一起收走）。
- **没有模型工具**——`lab_*` 工具（M3）本线刻意缺席。

完整清单见[参考文档](docs/reference.md#已知限制与推迟的工作)。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**架构。** `LabService` 内核配 provider（目前是 docker）；插件入口把它作为 `ctx.lab` 提供，`dsh-lab` CLI 用同一个内核配 `child_process` 运行器。单元是带标签的容器 `dsh-lab-<id>`；lab 唯一的宿主目录是指纹镜像（`units/<id>.json`），没有权威，删掉不丢任何东西。

**指纹。** 各分量的规范化 JSON 取 sha256；未声明的分量不参与哈希，所以分量集变宽时老单元的指纹不变。`fingerprintOf(components)` 作为纯动词导出，评测编排器用它算「环境类」。

**任务账本集成。** 与 mission 账本的耦合是探测式的：在场时登记 refs、产物、检查点与校验注解，release 走它的闸；缺席时登记 warn 跳过、release 需 `force`。CLI 模式经 `dsh-mission` 二进制做同样的事。

深度参考：

- [参考文档](docs/reference.md)——工作原理与指纹分量表、安装配置、服务面、按实例作用域挂载、CLI、失败恢复循环、已知限制全文

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/lab`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
