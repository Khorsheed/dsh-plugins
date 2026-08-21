# `@khorsheed/dsh-local-agent-dsh`

[English](README.md) | 中文

local-agent 家族的 dsh harness：把任务委派给 dsh 自己——作为独立的本地 CLI 进程运行，与 kimi / codex / claude-code harness 平级。子 dsh 在自己的 scoped home 下运行，保有自己的会话列表，通过父级的 API key 认证，并可跨轮续接。默认不挂载任何模型可见的东西；在设置里打开开关才启用委派工具。

## 特性

- **委派给 dsh 自己**——父级 spawn 一个子 dsh headless 进程执行任务，与其他家族 harness(kimi / codex / claude-code）平级。
- **Scoped home**——子 dsh 使用自己的 `DSH_HOME`(`$DSH_HOME/local-agent/dsh`)：独立的 profile、会话与状态，绝不混入父实例。
- **跨轮续接**——后续轮把子会话 id 传回，续接同一个子 dsh 会话。
- **无需单独登录**——子 dsh 通过父级解析出的 `DEEPSEEK_API_KEY` 认证，无 device-code 流程。
- **DeepSeek 开关，默认关**——在 设置 → 本地 Agent 里打开开关之前不挂载任何模型可见的东西；打开后注册 `subagent_dsh` 委派工具，与官方 in-process subagent 工具并存。

## 安装

家族核心与本 bundle 必须在同一条命令里指名——`dsh plugin add` 只会把*直接*依赖 reconciled 进 profile 的 bundles 层：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-dsh
```

然后重启 profile。无需登录步骤；`/dsh status` 报告父级的 `DEEPSEEK_API_KEY` 凭据是否可解析。

卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-dsh
```

移除 bundle 会注销 harness 及其 `/dsh` 命令族。scoped home(`$DSH_HOME/local-agent/dsh`）被有意保留——里面存着子 dsh 自己的会话；删除它即清除所有痕迹。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `profileName` | `headless-local-agent-dsh` | scoped home 下的子 dsh profile |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | 子 dsh 解析的凭据引用 |
| `cliLaunch` | 父级自身启动 | dsh 启动 argv 前缀覆盖 |
| `headlessBundleDir` | 从安装解析 | 子 profile 符号链接指向的 headless bundle 目录 |

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.1`）：✅ 完整——rc.8→0.1.1-rc.1 API 审计（2026-08-21）确认本插件消费的所有面无变化或纯增量（ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包），无需改动源码。
- 源码线（deepseek-harness master）：✅

## 已知限制

- 无交互式或 device-code 登录流程——子 dsh 只能通过父级的 `DEEPSEEK_API_KEY` 凭据认证；`/dsh login` 报告该 harness 无登录流程。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**DeepSeek 开关。** 与其他家族 harness 不同，本包**默认不挂载任何模型可见的东西**。互斥开关位于 设置 → 本地 Agent 页里 dsh harness 行的动作区内（namespace `local-agent-dsh`，默认 **off**）：

- **OFF**（默认）：实例保持现状——委派走官方 in-process subagent 工具。模型永远看不到 dsh 委派工具。
- **ON**：控制器注册 `dsh` harness、`dsh-cli` 委派 provider 与家族委派工具（`subagent_dsh`）。开关经 settings watcher 实时翻转组合。

官方 in-process subagent 工具归 base bundle 所有，不在开关控制范围内：OFF 时只剩它们，ON 时 `subagent_dsh` 与它们并存——两种委派形态语义不同（in-process continuable vs. 独立 CLI 进程），家族工具描述（"separate process, its own scoped home"）让模型可以区分。

**委派。**

1. provider 生成一个 uuid（`session-<uuid>`），记录委派（`childSessionId → cliSessionId` 恒等映射），并 spawn
   `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"`，env 为 `{ DSH_HOME: <scoped home>, DEEPSEEK_API_KEY: <resolved> }`，cwd 为父会话 cwd。
2. 子 dsh headless bundle（`@khorsheed/dsh-local-agent-dsh-headless`）用该确切 id 创建会话、运行任务、打印最终助手文本、退出 0/1。
3. 后续轮把子会话 id 作为 `resume` 传入；provider 解析委派并 spawn `--resume <uuid>`；子 dsh 经 `agents.resume` 续接同一会话。

子 dsh 会话 id 由调用方提供，绝不从 stdout 解析——子 dsh stdout 保持格式纯净。

**认证。** 无 device-code 登录：子 dsh 通过父级的 `DEEPSEEK_API_KEY` 凭据认证（`apiKeyRef` 配置，默认 `DEEPSEEK_API_KEY`）。`/dsh login` 报告该 harness 无登录流程；`/dsh status` 报告凭据是否可解析；`/dsh sessions` 从 scoped-home 存储列出子 dsh 自己的会话（绝不会混入父实例的会话列表）。

**子 profile 供给。** 子 dsh profile 位于 scoped home 下（`profiles/headless-local-agent-dsh`）：一个 manifest（`@deepseek-ai/dsh-base` + 家族 headless bundle）、一个空用户层、一条解析 headless bundle 的符号链接。其余一切（dsh-base 及其整个依赖图）都从 dsh 安装锚点解析，因此供给零 pnpm install 成本且幂等。父级复制自己的启动方式（`node --import tsx … bin.ts`，或配置 `cliLaunch`），让子 dsh 与父级跑同一个 dsh 构建。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-dsh`）。问题与贡献请移步该仓库。
