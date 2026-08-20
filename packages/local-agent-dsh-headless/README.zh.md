# `@khorsheed/dsh-local-agent-dsh-headless`

[English](README.md) | 中文

`local-agent-dsh` harness 的子 dsh 一次性应用 bundle：基于 `dsh-base` 的直接 core Agent/Session 驱动，接受**调用方提供的会话 id**——`--session-id <id>` 用该确切 id 新建会话，`--resume <id>` 续接该 id 的既有会话——打印最终助手文本后退出。它是官方 `@deepseek-ai/dsh-headless` bundle 的兄弟版本，唯一区别是会话 id 归谁所有。

## 挂载纪律

**绝不要把这个 bundle 加进交互式 profile 的 `bundles`。** 它的 patch 携带子 profile 专属行——persona 覆盖、`hmr` 禁用、`tools` mode 覆盖、`code-runtime` insert、member-bridge MCP 行——挂进交互式组合会撞 `code-runtime` 重复 id，并把覆盖泄漏进真实用户会话。这个 bundle 只会被组合进 `headless-local-agent-dsh` 子 profile，由父侧 `local-agent-dsh` provider 在运行时自动 provision 到 dsh harness 的 scoped home 下（`provisionDshSubProfile`：子 profile 自己的 `package.json`、patch 层、bundle symlink 都在那里生成）——任何地方都不需要手工挂载。若确需主 profile 安全的形态，另拆一份 patch，不要复用这份。

patch 改动落地前必须做启动级验证（对组合了本 bundle 的 profile 跑 `dsh preflight`，或真实拉起一次子 dsh）：`!!js` 标签只支持标量，误标集合会在 profile 启动时直接失败，早于任何插件代码运行。`tests/patch.spec.ts` 在仓内钉住形状，但启动验证才是权威闸。

## 为什么用调用方提供的会话 id

local-agent 家族需要在多次委派之间续接**同一个** dsh 对话。父级 provider 生成一个 uuid，并在每一轮传同一个值：fresh 轮用它创建子 dsh 会话，之后的 resume 轮恰好续接该会话。id 以调用参数传递，绝不经过 stdout——子 dsh stdout 保持格式纯净，没有分隔符前缀，也不会把恰好长得像 id 的任务回答误解析成会话 id。

## Composition

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

startup provider 解析 task 位置参数与 `--session-id` / `--resume`（互斥）并发布调用；runner 创建（`agents.create({ sessionId })`）或续接（`agents.resume({ resumeSessionId })`）该会话、驱动任务、flush、打印最终助手文本，完成轮退出 0、否则退出 1——与官方 headless runner 一致。

## 调用

```sh
dsh --profile headless-local-agent-dsh --session-id 6ba7... "run the tests"   # fresh
dsh --profile headless-local-agent-dsh --resume 6ba7... "run the rest"       # resume
```

两个 flag 都不给时，runner 自生成 `session-<uuid>` id（官方 headless 行为），因此本 bundle 可作一次性使用的即插即用替代。

## 备注

- 子 dsh 会话存储在其自己的 `$DSH_HOME`（harness 的 scoped home）下，子 dsh 会话绝不会出现在父实例的会话列表里。
- 此 composition 里不装任何 `local-agent` 家族 bundle：base 自带的 in-process subagent 工具保留，但这里没有任何东西再 spawn 一个 dsh。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.0-rc.8`）：✅ 完整——rc.7→rc.8 API 审计（2026-08-20）确认本插件消费的所有面（slot、核心服务、核心事件、cordis 4.x、schemastery）均无变化或纯增量，无需改动源码。
- 源码线（deepseek-harness master）：✅
