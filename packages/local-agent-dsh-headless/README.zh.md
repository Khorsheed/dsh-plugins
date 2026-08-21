# dsh-local-agent-dsh-headless

[English](README.md) | 中文

local-agent 家族的一次性 headless 子 dsh 运行器：在一个 dsh 会话里跑一个任务——用你传入的确切 id 新建（`--session-id`），或续接既有会话（`--resume`）——把最终助手文本打到 stdout，然后进程退出。它是官方 `@deepseek-ai/dsh-headless` bundle 的兄弟版本，唯一区别是会话 id 归谁所有。你永远不需要自己安装或挂载它：父侧 `local-agent-dsh` provider 会在运行时把它自动 provision 进自己的子 profile。

## 特性

- **调用方提供的会话 id**——`--session-id <id>` 用该确切 id 新建会话；`--resume <id>` 续接该 id 的既有会话。id 以调用参数传递，绝不经过 stdout，子 dsh 输出保持格式纯净——没有分隔符前缀，也不会把恰好长得像 id 的任务回答误解析成会话 id。
- **一次性语义**——驱动任务、flush、打印最终助手文本，完成轮退出 0、否则退出 1——与官方 headless runner 一致。
- **隔离的会话存储**——子 dsh 会话存在其自己的 `$DSH_HOME`（harness 的 scoped home）下，绝不会出现在父实例的会话列表里。
- **零手工挂载**——只会被组合进 `headless-local-agent-dsh` 子 profile，由父级 provider 自动 provision——任何地方都不需要手工挂载。

## 安装

本 bundle 从不单独安装或挂载。安装父级 harness 即一并带入：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent-dsh
```

随后父级 provider 会把本 bundle 自动 provision 到 dsh harness scoped home 下的 `headless-local-agent-dsh` 子 profile。没有需要单独卸载的东西——本 bundle 在任何交互式 profile 里都不存在。

## 用法

通常由父级 provider 拉起本 bundle；直接调用也可以：

```sh
dsh --profile headless-local-agent-dsh --session-id 6ba7... "run the tests"   # fresh
dsh --profile headless-local-agent-dsh --resume 6ba7... "run the rest"       # resume
```

两个 flag 都不给时，runner 自生成 `session-<uuid>` id（官方 headless 行为），因此本 bundle 可作一次性使用的即插即用替代。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.1`）：✅ 完整——rc.8→0.1.1-rc.1 API 审计（2026-08-21）确认本插件消费的所有面无变化或纯增量（ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包），无需改动源码。
- 源码线（deepseek-harness master）：✅

## 已知限制

- **绝不要把这个 bundle 加进交互式 profile 的 `bundles`。** 它的 patch 携带子 profile 专属行——persona 覆盖、`hmr` 禁用、`tools` mode 覆盖、`code-runtime` insert、member-bridge MCP 行——挂进交互式组合会撞 `code-runtime` 重复 id，并把覆盖泄漏进真实用户会话。若确需主 profile 安全的形态，另拆一份 patch，不要复用这份。
- 子 dsh 会话绝不会出现在父实例的会话列表里（独立的 scoped-home 存储）。
- 此 composition 里不装任何 `local-agent` 家族 bundle：base 自带的 in-process subagent 工具保留，但这里没有任何东西再 spawn 一个 dsh。
- patch 改动落地前必须做启动级验证（对组合了本 bundle 的 profile 跑 `dsh preflight`，或真实拉起一次子 dsh）：`!!js` 标签只支持标量，误标集合会在 profile 启动时直接失败，早于任何插件代码运行。`tests/patch.spec.ts` 在仓内钉住形状，但启动验证才是权威闸。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

local-agent 家族需要在多次委派之间续接**同一个** dsh 对话。父级 provider 生成一个 uuid，并在每一轮传同一个值：fresh 轮用它创建子 dsh 会话，之后的 resume 轮恰好续接该会话。

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
```

startup provider 解析 task 位置参数与 `--session-id` / `--resume`（互斥）并发布调用；runner 创建（`agents.create({ sessionId })`）或续接（`agents.resume({ resumeSessionId })`）该会话、驱动任务、flush、打印最终助手文本并退出。

子 profile 由父级 provider 在运行时 provision（`provisionDshSubProfile`）到 dsh harness 的 scoped home 下：子 profile 自己的 `package.json`、patch 层、bundle symlink 都在那里生成。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-dsh-headless`）。问题与贡献请移步该仓库。
