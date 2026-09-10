# dsh-local-agent-dsh-headless

[English](README.en.md) | 中文

local-agent 家族的 headless 子 dsh 运行器，两种模式：一次性（默认）在一个由调用方命名的 dsh 会话里跑一个任务，把最终助手文本打到 stdout，然后进程退出；常驻（`--serve`）驻留进程，经家族内部 stdio JSON-RPC wire 接收 turn 并回推会话事件，支撑父侧 `local-agent-dsh` 的长驻驱动（`live: true`）。它是官方 `@deepseek-ai/dsh-headless` bundle 的兄弟版本，唯一区别是会话 id 归谁所有——你永远不需要自己安装或挂载它；父侧 `local-agent-dsh` provider 会在运行时自动 provision。

## 特性

- **调用方提供的会话 id**——`--session-id <id>` 用该确切 id 新建会话，`--resume <id>` 续接该会话；id 以调用参数传递，绝不经过 stdout。
- **一次性语义**——驱动任务、打印最终助手文本，完成轮退出 0、否则退出 1。
- **常驻 serve 模式**——`--serve` 把 runner 切成长驻循环：`turn/start` 驱动一轮、`session/event` 逐事件推流、`session/idle` 关轮（落盘 flush 之后）、`turn/interrupt` 落地为进程内 `Agent.cancel` 优雅中断（进程不死、会话可续）、`shutdown`/stdin EOF 优雅退出。wire 契约见 `src/wire.ts`。
- **隔离的会话存储**——子 dsh 会话存在自己的 scoped `$DSH_HOME` 下，绝不会出现在父实例的会话列表里。
- **零手工挂载**——`headless-local-agent-dsh` 子 profile 由父级 provider 自动 provision，任何地方都不需要手工挂载。

## 安装

本 bundle 从不单独安装或挂载——安装父级 harness 即一并带入：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent-dsh
```

没有需要单独卸载的东西；本 bundle 在任何交互式 profile 里都不存在。

## 用法

通常由父级 provider 拉起本 bundle；直接调用也可以：

```sh
dsh --profile headless-local-agent-dsh --session-id 6ba7... "run the tests"   # fresh
dsh --profile headless-local-agent-dsh --resume 6ba7... "run the rest"       # resume
dsh --profile headless-local-agent-dsh --serve                              # 常驻 live-driver 模式（stdio wire）
```

两个 flag 都不给时，runner 自生成 `session-<uuid>` id（官方 headless 行为），因此仍是一次性使用的即插即用替代。`--serve` 不接受 task 与 session flag——turn 与会话 id 全部走 wire。

### `--model <provider/model>`

覆盖本次启动的模型选择：

```bash
dsh --profile headless-local-agent-dsh --model deepseek-official/deepseek-v4-pro --session-id 6ba7... "run the tests"
```

- 不给 = 用子实例自己 `agentDefaultModel` 的当前选择，与这个 flag 出现之前逐字节相同。
- 按**第一个** `/` 切分成 provider 与 model，所以模型 id 里再带斜杠也不会被切坏；只写模型名（没有 `/`）则只换模型、沿用实例的 provider。开头或结尾的斜杠不算切分点——那会切出一个空的一半，agent 路由不了——整个值当模型名。
- 选择的其余部分原样带过（尤其是 reasoning effort）：换模型不是重置配置。
- 与两种模式都正交：一次性轮次绑定这一轮，`--serve` 绑定这个常驻进程托管的**每一个**会话——runtime 的模型是进程事实，这正是父侧拒绝在长驻路径上按次给模型的原因。

父侧 `local-agent-dsh` provider 自动带上它：harness 的 `model` 插件配置键、或某一次委派自带的 `DelegationCallOptions.model`，都落成这个 flag。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.2-rc.1`）：✅ 完整——基线迁移至 0.1.2-rc.1 API 面（单臂消费 0.1.2 API，0.1.1-rc.2 运行臂已退役），全量构建测试通过；minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.2-rc.1）

## 已知限制

- **绝不要把这个 bundle 加进交互式 profile 的 `bundles`**——它的子 profile 专属 patch 行（persona 覆盖、`hmr` 禁用、`tools` mode、`code-runtime` insert、member-bridge MCP）会撞交互式组合，并把覆盖泄漏进真实用户会话。本包**不声明 `dsh.bundle`**，因此手工加的 bundles 行在 boot 的 `loadProfile` 处直接 fail loud（"declares no dsh.bundle"），这正是一道闸。
- **它不会被 `dsh plugin add` 自动挂载，也无需如此**——本包曾声明 `dsh.bundle`，而 reconcilePlugins 会把声明该字段的直接依赖自动挂进组合的 layer 栈：2026-08-23 P0（prod web profile 撞 duplicate `code-runtime`）与 2026-09-03 G3 复发都是这一挂。声明已撤（T6），装成直接依赖只会得到一条 "plain dependency" 警告、不挂载——但也没有必要：经 `@khorsheed/dsh-local-agent-dsh` **传递**安装即可，父级 provider 会自动 provision。包内不变量对挂进 web 组合（检出 `webStartup` 服务）依旧 fail loud。
- 子 dsh 会话绝不会出现在父实例的会话列表里（独立的 scoped-home 存储）。
- 此 composition 里不装任何其他 `local-agent` 家族 bundle——这里没有任何东西再 spawn 一个 dsh。
- patch 改动落地前必须做启动级验证（`dsh preflight` 或真实拉起一次子 dsh）：`!!js` 标签只支持标量，误标集合会在 profile 启动时直接失败。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

local-agent 家族需要在多次委派之间续接**同一个** dsh 对话：父级 provider 生成一个 uuid，并在每一轮传同一个值——fresh 轮用它创建子 dsh 会话，之后的 resume 轮恰好续接该会话。

本 bundle 的 patch 在自己的 profile 之上叠加 `dsh-base`（如 `headless-local-agent-dsh`）：

```yaml
- id: local-agent-dsh-headless-startup
  name: '@khorsheed/dsh-local-agent-dsh-headless/startup'

- id: local-agent-dsh-headless-runner
  name: '@khorsheed/dsh-local-agent-dsh-headless'
  inject: [localAgentDshHeadlessStartup]
  config:
    task: !!js ctx.localAgentDshHeadlessStartup.task
    sessionId: !!js ctx.localAgentDshHeadlessStartup.sessionId
    resumeSessionId: !!js ctx.localAgentDshHeadlessStartup.resumeSessionId
    serve: !!js ctx.localAgentDshHeadlessStartup.serve ?? false
```

startup provider 解析 task 位置参数与互斥的 `--session-id` / `--resume`（或 `--serve`）并发布调用；一次性模式下 runner 通过 `agents.create` / `agents.resume` 创建或续接该会话、驱动任务、打印最终助手文本并退出，serve 模式下转入常驻 wire 循环（`src/serve.ts`）。子 profile 本身由父级 provider 在运行时 provision（`provisionDshSubProfile`）到 dsh harness 的 scoped home 下：manifest 只列 `@deepseek-ai/dsh-base`，本 bundle 的 patch 从包内 `cordis.patch.yml` 逐字节拷贝为该 profile 自己的 patch 层（本包不声明 `dsh.bundle`，见已知限制），另加一条解析本 bundle 的符号链接供 loader 解析 insert 行。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-dsh-headless`）。问题与贡献请移步该仓库。
