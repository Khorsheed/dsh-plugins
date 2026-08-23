# dsh-lab

[English](README.en.md) | 中文

dsh 生态的受控实验单元：一个**实验单元** = 一个隔离、条件一致、可重复的执行环境，本插件管理它的生命周期——获取 / 物化输入 / 取回产出 / 释放 / 状态查询。它服务的场景形状是：**一批受试对象 × 一批用例 × 隔离一致的执行环境 × 结果需对照**（评测、A/B 测配置、跨版本回归、批量数据处理验证）。

三条红线定义插件的品格：

1. **只记录，不判断。** lab 运行并登记事实（资源标识、环境指纹、产物）；"通过与否""几分"是消费方的语义。
2. **`release` 是 gate 的执行点。** 单元绑定 mission 且 `@khorsheed/dsh-mission` 插件在场时，`isReleasable` 必须通过——查询失败即拒绝（fail closed），任何选项都不能绕过校验。无 gate 时（未绑定 mission，或插件缺席），release 需要显式 `force` 并告警。
3. **不发起任何任务。** lab 提供动词；何时调用由人 / agent / 外部编排决定。

里程碑 M1–M2 交付服务面（`ctx.lab`）与同内核的 `dsh-lab` CLI，配 docker provider：acquire / populate / collect / checkpoint / verify / archive / release / status、环境指纹、孤儿进程补偿、`maxConcurrentUnits` 安全阀。模型工具属 M3。

## 工作原理

- **单元**——一个带标签的容器（`dsh-lab-<id>`）。docker daemon 即注册表：单元 id、指纹、mission 绑定都骑在资源标签上，`status` / `release` 靠 reconcile 重建——宿主机重启不丢，lab 自身不持有状态文件。
- **环境指纹**——`acquire` 解析镜像的 repo digest（缺省回退镜像 id，本地没有则先 pull），连同资源标识写进 mission 的 refs。环境变了结果就不可比——这是机制，不是约定。
- **输入**——两条路：acquire 时声明 `mounts` 获得零拷贝只读绑定挂载（容器创建后无法追加挂载）；或 `populate` 把宿主机目录拷入运行中的单元（进入单元可写层的一份拷贝）。目录路径就是全部接口——datasets `worktree_path` 的产出或调用方自供路径皆可；lab 对 datasets 无代码级依赖，层白名单由产出路径的那一侧强制。
- **物化清单**——`populate` 返回 `{ sha, count, files }`（逐文件内容哈希 + 排序后的整体哈希），给了 `manifestPath` 会写出清单文件并登记为 kind `materialization` 的 mission 产物。输入相同则哈希相同——并行单元拿到字节级相同题面的公平性证据——同时它还是 collect 的反向基线（哪些是给进去的、哪些是产出的）。
- **活动事实，不是动词时间戳**——`status` 的 `lastActivityAt` 取自单元内 workspace 文件的最新 mtime（干活就会写文件；那段时间 lab 根本不被调用，动词时间戳是假指标），辅以 cgroup `cpu.stat` 的容器累计 CPU。
- **孤儿进程补偿**——lab 自己 spawn 的每条容器内命令都经过一层 wrapper，把自身 pid 记到 `/run/dsh-lab/pids/`；`release` 先进容器按 pid SIGTERM 清扫，再移除容器。覆盖范围是 provider 自己的 exec 路径——他人 exec 进容器的进程不在 lab 的视野内。
- **`maxConcurrentUnits`**——一个纯数字上限（config，默认 4）：达到上限 `acquire` 拒绝并报错明确。lab 不理解"哪些阶段可并发"（那是调用方的语义），一个数字足以挡住误并发——而误并发会悄悄毁掉对耗时敏感的测量。
- **检查点**——提交工作区（首次 checkpoint 时自动 `git init`）并打 tag；commit sha 写入 mission 检查点的 `ref`。只读挂载的工作区会在此处报错——它无法被提交，这正是正确的信号。
- **验证**——可选地把验证物拷入临时目录、在工作区里执行命令、移除验证物，把结果**原样**（退出码、stdout、stderr、耗时、超时事实）记进 mission 的 `lab` 注解命名空间。整条代码路径上没有任何通过/失败分支。
- **归档**——把工作区导出到宿主机目录，附 `manifest.json`（逐文件 sha256 + 大小、单元事实、指纹），登记为 mission 产物。

## 安装与加载

本包的唯一身份是 **`@khorsheed/dsh-lab`**，在 `dsh-plugins` monorepo 开发并从该处发布到 npm：

```sh
npm install @deepseek-ai/dsh                            # 宿主（dsh web / dsh CLI）
dsh plugin --profile web add @khorsheed/dsh-lab         # 本插件
```

包声明了 `dsh.bundle`，add 会把它的 `cordis.patch.yml` 行（裸 `lab` 挂载）reconcile 进 profile 的 bundles 层——无需手改 cordis.yml。一个组合里 `lab` 行 id 只能挂载一次；往可能已挂载该 id 的组合里添加前，先 `dsh --profile web --dump-config | grep lab` 检查。从源码：克隆 monorepo，包在 `packages/lab`（`pnpm install && pnpm run build`）。

配置（均可选）：`maxConcurrentUnits`——持有单元上限（默认 4）。

要求：宿主机可达 docker CLI；镜像需自带 `sleep` 与 `sh`（保活命令与记 pid 的 wrapper 依赖它们）。

## 服务面

其他插件与脚本经 `ctx.get('lab')` 消费（类型即 `ctx.lab`）：

```ts
const unit = await ctx.lab.acquire({
  image: 'eval-env:latest',
  missionId: 'F1-a-r1',                       // 可选的 mission 绑定
  mounts: [{ source: worktreePath, target: '/input', readonly: true }],
})
await ctx.lab.populate(unit.id, { source: '/path/to/layer', manifestPath: '/host/run-data/materialization.json' })
// → { sha, count, files } —— 登记为 'materialization' 产物
const { ref } = await ctx.lab.checkpoint(unit.id, { name: 'iter-1' })
const outcome = await ctx.lab.verify(unit.id, { command: ['npm', 'test'], source: '/path/to/checks', timeoutMs: 300_000 })
// outcome = { exitCode, stdout, stderr, durationMs, timedOut } —— 原样；同时注解进 mission 的 'lab' 命名空间
await ctx.lab.collect(unit.id, { source: '/workspace/out', target: '/host/archive/out', kind: 'archive' })
await ctx.lab.archive(unit.id, { target: '/host/archive/unit' })   // workspace/ + manifest.json（逐文件 sha256）
await ctx.lab.release(unit.id)                // 由 mission.isReleasable 放行；无 gate 时需 force + 告警
const units = await ctx.lab.status()          // 与 docker daemon reconcile 后的视图
```

mission 集成是探测式的结构化接口（`setRefs` / `addArtifact` / `addCheckpoint` / `annotate` / `isReleasable`），不是 import：`@khorsheed/dsh-mission` 缺席时，登记类写入 warn 跳过，`release` 降级为 `force` + 告警。acquire 时登记的 mission 绑定骑在容器标签上，宿主重启后仍在——gate 照样保护 reconcile 回来的单元。

## CLI

`dsh-lab <动词>`（或 `node lib/cli.js`）；数据走 stdout（有值的动词输出 JSON），诊断走 stderr。退出码：`0` 正常，`1` 失败/拒绝，`2` 用法错误。

```sh
dsh-lab acquire --image IMG [--mission ID] [--run ID] [--mount SRC:DST[:ro]]... [--env K=V]... [--workdir DIR] [--command JSON]
dsh-lab populate UNIT --source DIR [--target DIR] [--manifest FILE]
dsh-lab collect UNIT --source DIR --target DIR [--kind K]
dsh-lab checkpoint UNIT --name NAME
dsh-lab verify UNIT [--source DIR] [--timeout-ms MS] -- CMD [ARGS...]
dsh-lab archive UNIT --target DIR [--kind K]
dsh-lab release UNIT [--force]
dsh-lab status [UNIT] [--json]
```

裸 `dsh-lab status` 输出进度表——每行一个单元，join 容器事实（运行时长）、容器内活动（workspace mtime）、mission 状态与坐标标签（经 mission 面，缺席降级）、物化清单哈希：

```text
UNIT      MISSION           CONTAINER   LAST-ACTIVITY  TASK     LABELS
u-a3f9    cell-1:working    up 2h14m    3m ago         9f2c1a2b  task=F1,subject=A
u-b71c    cell-2:collected  up 2h14m    47m ago        9f2c1a2b  task=F1,subject=B
```

各行 TASK 哈希一致即公平性当场可见；`working` 行配一个很长的 `LAST-ACTIVITY` 间隔就是卡格信号。`--json` 输出结构化行。

CLI 是同一个 `LabService` 内核配 `child_process` 运行器，mission 面适配到 `dsh-mission` 二进制：`release` 的 gate 走 `dsh-mission is-releasable` 的 0/1 退出码（其他退出码一律 fail closed），refs / artifact / checkpoint / 注解经 mission 二进制的动词登记（`set-refs` / `add-artifact` / `add-checkpoint` / `annotate`）。PATH 上没有该二进制时，登记 warn 跳过，`release` 需 `--force`。

## Compatibility

- npm release line（`@deepseek-ai/dsh@0.1.0-rc.6+`）：✅ —— 服务面与 docker provider 在已发布宿主上完整可用。
- source line（deepseek-harness master，fork 或 upstream）：✅ —— 同上。

降级 / 缺席项（与 package.json 的 `dsh.compat` 同步）：未安装 `@khorsheed/dsh-mission` 时，release gate 降级为显式 force 标志加告警，refs / artifact / checkpoint / verify 登记 warn 跳过。`lab_*` 模型工具（M3）在本线尚不存在。

## 失败恢复循环

一格崩溃不丢现场、只重跑这一格。循环如下（编排方驱动；每一步都是既有动词）：

1. `collect` 收回已存在的产出（残缺是常态）；
2. `archive` 归档单元——崩溃现场（半成品、崩溃输出、检查点）是整轮里最值钱的数据，不归档就 release 等于毁证据；
3. 编排方把模板失败 gate 期待的东西（如崩溃转储）写进该 attempt 的运行数据目录，并 `attest` 拆除键；
4. 转入失败态的转移过 `file-check`——**失败路径无 gate 例外**：进入可释放态同样带归档校验，与成功路径同款（attested + file-check 的组合用状态链表达，如 `working → archived-failed → failed`，不新增 guard 组合机制）；
5. `release` 销毁单元；`mission_retry` 为这一格开新 attempt（原 attempt 不可变保留），并为它 acquire 新单元。

联调套件端到端跑这条循环（`scripts/integration-triad.spec.ts` 失败路径块）。

## 已知限制与推迟的工作

- **`populate` 是拷贝；挂载在 acquire 时声明**——docker 无法给已创建的容器追加挂载，因此零拷贝只读路径是 `acquire` 的 `mounts`，`populate` 是把一份拷贝物化进单元可写层（单元已在运行时，"进单元"就是这个意思）。
- **worktree provider 只有接口形状，未交付**——`UnitProvider` 接口按能容纳它的形状设计；真实需求出现时再实现。届时注意：worktree 单元的隔离强度差一个量级（共享文件系统、无网络与资源限制），不得用于需要可比性的实验。
- **孤儿补偿只覆盖 lab 自己的 exec**——`/run/dsh-lab/pids/` 下的 pidfile 只跟踪 provider spawn 的进程；外来的 `docker exec` 对清扫不可见（release 时的容器移除仍会收走一切）。
- **镜像必须自带 `sleep` 与 `sh`**——distroless 镜像需要自定义 `command`，且失去记 pid 的 wrapper；`checkpoint` 还要求单元内有 `git`。
- **checkpoint 需要可写工作区**——工作区在首次 checkpoint 时自动 `git init`；只读挂载的工作区无法提交，会报错（此时应 checkpoint 一个 populate 出来的目录）。
- **M3 范围**——`lab_*` 模型工具已在提案中设计，本线刻意缺席。
- **`lastActivityAt` 需要镜像内有 GNU `stat` 或 busybox `date -r`**——两者都没有时 mtime 探测降级为无读数（该行显示 `-`）；CPU 事实需要 cgroup `cpu.stat`（v2）或 `cpuacct.usage`（v1）。
- **CLI 模式的登记走 mission 二进制**——要求 PATH 上有 `dsh-mission`，覆盖面正好是其动词集（set-refs / add-artifact / add-checkpoint / annotate / is-releasable / get）；更丰富的登记走进程内服务面。
