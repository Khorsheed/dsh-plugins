# dsh-lab

[English](README.md) | 中文

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
await ctx.lab.populate(unit.id, { source: '/path/to/layer', target: '/workspace' })
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
dsh-lab populate UNIT --source DIR [--target DIR]
dsh-lab collect UNIT --source DIR --target DIR [--kind K]
dsh-lab checkpoint UNIT --name NAME
dsh-lab verify UNIT [--source DIR] [--timeout-ms MS] -- CMD [ARGS...]
dsh-lab archive UNIT --target DIR [--kind K]
dsh-lab release UNIT [--force]
dsh-lab status [UNIT]
```

CLI 是同一个 `LabService` 内核配 `child_process` 运行器，mission 面适配到 `dsh-mission` 二进制：`release` 的 gate 走 `dsh-mission is-releasable` 的 0/1 退出码（其他退出码一律 fail closed），`verify` 把原样结果注解进 `lab` 命名空间。refs / artifact / checkpoint 的登记只在进程内服务面可用——mission CLI 没有这些动词，CLI 模式下这些写入 warn 跳过。

## Compatibility

- npm release line（`@deepseek-ai/dsh@0.1.0-rc.6+`）：✅ —— 服务面与 docker provider 在已发布宿主上完整可用。
- source line（deepseek-harness master，fork 或 upstream）：✅ —— 同上。

降级 / 缺席项（与 package.json 的 `dsh.compat` 同步）：未安装 `@khorsheed/dsh-mission` 时，release gate 降级为显式 force 标志加告警，refs / artifact / checkpoint / verify 登记 warn 跳过。`lab_*` 模型工具（M3）在本线尚不存在。

## 已知限制与推迟的工作

- **`populate` 是拷贝；挂载在 acquire 时声明**——docker 无法给已创建的容器追加挂载，因此零拷贝只读路径是 `acquire` 的 `mounts`，`populate` 是把一份拷贝物化进单元可写层（单元已在运行时，"进单元"就是这个意思）。
- **worktree provider 只有接口形状，未交付**——`UnitProvider` 接口按能容纳它的形状设计；真实需求出现时再实现。届时注意：worktree 单元的隔离强度差一个量级（共享文件系统、无网络与资源限制），不得用于需要可比性的实验。
- **孤儿补偿只覆盖 lab 自己的 exec**——`/run/dsh-lab/pids/` 下的 pidfile 只跟踪 provider spawn 的进程；外来的 `docker exec` 对清扫不可见（release 时的容器移除仍会收走一切）。
- **镜像必须自带 `sleep` 与 `sh`**——distroless 镜像需要自定义 `command`，且失去记 pid 的 wrapper；`checkpoint` 还要求单元内有 `git`。
- **checkpoint 需要可写工作区**——工作区在首次 checkpoint 时自动 `git init`；只读挂载的工作区无法提交，会报错（此时应 checkpoint 一个 populate 出来的目录）。
- **M3 范围**——`lab_*` 模型工具已在提案中设计，本线刻意缺席。
- **CLI 模式的 mission 登记是部分的**——`dsh-mission` 二进制只暴露 `annotate` 与 `is-releasable`，CLI 正好接线这两个（verify 记录、release gate）；refs / artifact / checkpoint 的登记走进程内服务面，CLI 模式下 warn 跳过。
