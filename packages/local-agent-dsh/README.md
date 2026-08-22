# `@khorsheed/dsh-local-agent-dsh`

[English](README.en.md) | 中文

把任务委派给 dsh 自己——作为独立的本地 CLI 进程运行，与 kimi / codex / claude-code harness 平级。子 dsh 在自己的 scoped home 下运行，通过父级的 API key 认证，可跨轮续接；设置开关（默认关）打开后才启用委派工具。

## 特性

- **委派给 dsh 自己**——spawn 一个子 dsh headless CLI 进程。
- **Scoped home**——自己的 `DSH_HOME`（`$DSH_HOME/local-agent/dsh`）：profile、会话与状态绝不混入父实例。
- **跨轮续接**——把子会话 id 传回即可续接同一个子 dsh 会话。
- **无需单独登录**——通过父级的 `DEEPSEEK_API_KEY` 认证，无 device-code 流程。
- **DeepSeek 开关，默认关**——在 设置 → 本地 Agent 打开开关之前，模型看不到任何委派工具。

## 安装

家族核心与本 bundle 必须在同一条命令里指名，然后重启 profile：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-dsh
```

无需登录步骤；`/dsh status` 报告父级的 `DEEPSEEK_API_KEY` 凭据是否可解析。

卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-dsh
```

scoped home（`$DSH_HOME/local-agent/dsh`）被有意保留——里面存着子 dsh 自己的会话；删除它即清除所有痕迹。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `profileName` | `headless-local-agent-dsh` | scoped home 下的子 dsh profile |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | 子 dsh 解析的凭据引用 |
| `cliLaunch` | 父级自身启动 | dsh 启动 argv 前缀覆盖 |
| `headlessBundleDir` | 从安装解析 | 子 profile 符号链接指向的 headless bundle 目录 |
| `live` | `false` | 长驻驱动：每成员常驻一个 `--serve` 子 dsh 进程，委派 = 向活着的 runtime 发 turn（runtime 级优雅中断、事件推送镜像）；关闭或通道不可用即回一次性 exec 路径 |
| `liveIdleMs` | `1800000`（30 分钟） | 长驻 runtime 的空闲回收时限 |
| `liveMirrorGranularity` | `event` | live 镜像粒度；`token` 额外把 `assistant/chunk` 增量写入子会话（写放大，opt-in） |

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.1`）：✅ 完整——rc.8→0.1.1-rc.1 API 审计（2026-08-21）确认本插件消费的所有面无变化或纯增量（ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包），无需改动源码。
- 源码线（deepseek-harness master）：✅

## 已知限制

- 无交互式或 device-code 登录流程——子 dsh 只能通过父级的 `DEEPSEEK_API_KEY` 凭据认证；`/dsh login` 报告该 harness 无登录流程。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**DeepSeek 开关。** 与其他家族 harness 不同，本包默认不挂载任何模型可见的东西。互斥开关位于 dsh harness 行的动作区内（设置 → 本地 Agent，namespace `local-agent-dsh`，默认 off）：OFF 时委派走官方 in-process subagent 工具；ON 时注册 `dsh` harness、`dsh-cli` 委派 provider 与家族工具 `subagent_dsh`，与官方工具并存——两种委派形态语义不同（in-process continuable vs. 独立 CLI 进程），家族工具描述让模型可以区分。开关经 settings watcher 实时翻转组合。

**委派。** provider 生成一个 uuid（`session-<uuid>`），记录委派（`childSessionId → cliSessionId` 恒等映射），并 spawn `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"`，env 为 `{ DSH_HOME: <scoped home>, DEEPSEEK_API_KEY: <resolved> }`，cwd 为父会话 cwd。headless bundle（`@khorsheed/dsh-local-agent-dsh-headless`）用该确切 id 创建会话——id 由调用方提供，绝不从 stdout 解析——运行任务、打印最终助手文本、退出 0/1。后续轮把子会话 id 作为 `resume` 传入；provider spawn `--resume <uuid>`，子 dsh 经 `agents.resume` 续接同一会话。

**长驻驱动（`live: true`）。** 替代每轮 spawn：成员首轮委派拉起一个常驻 `--serve` 子 dsh 进程，之后每轮 = 经家族内部 stdio JSON-RPC wire（headless 包 `src/wire.ts`）向活着的 runtime 发 `turn/start`；会话事件以 `session/event` 通知即时推回并逐事件镜像进子会话（与文件镜像同一折叠规则，settle 时再跑一次文件镜像做对账），`cancel` 落地为 runtime 级 `turn/interrupt`（进程内 `Agent.cancel`）——进程不死、会话可续。runtime 空闲超时回收（wire `shutdown` → SIGTERM 阶梯），崩溃后下一轮自动重连并 `agents.resume` 盘上会话；spawn/握手失败标记通道不可用并永久回退 exec 路径。

**认证与供给。** 无 device-code 登录：子 dsh 通过父级的 `DEEPSEEK_API_KEY` 凭据认证（`apiKeyRef` 配置）；`/dsh status` 报告凭据是否可解析，`/dsh sessions` 从 scoped-home 存储列出子 dsh 自己的会话。子 profile 位于 `profiles/headless-local-agent-dsh`：一个 manifest（`@deepseek-ai/dsh-base` + 家族 headless bundle）、一个空用户层、一条解析 headless bundle 的符号链接——其余一切从 dsh 安装锚点解析，供给零 pnpm install 成本且幂等。父级复制自己的启动方式（或配置 `cliLaunch`），让子 dsh 与父级跑同一个 dsh 构建。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-dsh`）。问题与贡献请移步该仓库。
