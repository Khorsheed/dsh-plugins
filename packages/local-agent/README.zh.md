# `@khorsheed/dsh-local-agent`

[English](README.md) | 中文

本地代码 agent 家族核心。每个本机安装的编码 agent CLI——Kimi Code、Codex、Claude Code——向 `ctx.localAgent` 注册为一个 **harness**：共享 homes 根下的一个作用域目录（其状态绝不触碰用户的本地安装；目录以 0700 创建，因为里面是凭据与会话）、一个可选的 device-code 登录命令、一个会话记录适配器，以及可选的认证状态与退出登录探测。glue 供给每个作用域目录并注册 `/<harness> login|sessions|status|logout` 命令族。

**委派不属于这个 seam。** 每个 harness bundle 各自向既有的 `subagent` 能力挂载 subagent-provider 行（讲 stdio ACP 的 harness 用 subagent-acp，Codex 用其 app-server provider），经 `localAgent.homeDir(name)` 读取作用域目录。本包只拥有 harness 身份与生命周期——harness 间差异只剩 `homeEnvVar`、（可选的）登录调用、records 适配器、认证探测与退出登录路径，别无其他。

**程序查询走只读 Remote 通道。** `LocalAgentGateway`（服务键 `localAgentGateway`，生成物 `./remote`）通过 Typert Gateway 向浏览器暴露 roster、各 harness 状态与作用域会话。它不产生任何会话事件，因此 UI 轮询不会在会话日志里留下命令节点；登录与退出仍走斜杠命令通道——用户主动操作产生可见命令节点正是预期反馈。

**浏览器半身随本包提供。** `./client` 导出（一个 `dsh.client` 行）是 roster 驱动的设置分区（设置 → 本地 Agent）：每个 harness 的认证状态、网页登录设备码、退出登录、委派 preset 状态。它通过本包的 `dsh.client` manifest 自动挂载——不再需要独立 UI 包，因为 UI 是 provider 无关的（只消费 `/<harness>` 命令族和只读 gateway），且没有独立消费方。该分区还声明了 provider-neutral 的贡献槽（行列表下方的 `local-agent.settings.row` 与每个 harness 行动作区内的 `local-agent.settings.row-action`），harness bundle 可以贡献自己的设置行与按 harness 的动作（如 dsh 的启用/禁用开关），分区无需认识它们。

## 安装

core 本身就是 bundle：本包的 `cordis.patch.yml` 插入 `local-agent` 行（共享作用域目录根），每个 harness bundle（`@khorsheed/dsh-local-agent-kimi`、`-codex`、未来的 claude）都把本包声明为依赖。请把 core 与 harness bundle 一起安装——`dsh plugin add` 只把**直接**依赖调和进 profile 的 bundles 层，仅靠 harness bundle 的传递依赖不会激活本 patch。自定义组合挂载一次 core：

```yaml
- id: local-agent
  name: '@khorsheed/dsh-local-agent'
  config:
    homesRoot: !!js dshHomePath('local-agent')
```

## 新增一个 harness

harness bundle 向 core 注册，并挂载自己的委派行：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { LocalAgentSessionRecord } from '@khorsheed/dsh-local-agent'

const listCodexSessions = async (homeDir: string): Promise<readonly LocalAgentSessionRecord[]> => []

/** Register the Codex harness into the local-agent registry. */
export function registerCodex(ctx: Context): void {
  ctx.localAgent.register({
    name: 'codex',                 // command prefix + scoped-home dir
    displayName: 'Codex',
    homeEnvVar: 'CODEX_HOME',
    delegationProvider: 'codex',  // subagent provider name; cross-checked at load
    login: { command: 'codex', args: ['login'] },
    records: { listSessions: listCodexSessions },
    // Optional: report auth from the scoped home and sign out of it, so
    // /codex status|logout work and the settings tab can switch accounts.
    isAuthenticated: async () => false,
    logout: async () => {},
  })
}
```

`login` 是可选的：没有登录流程的 harness（例如 dsh 自身——它通过宿主实例的 `DEEPSEEK_API_KEY` 认证，而非 device-code 流程）省略它，`/dsh login` 会回答"该 harness 无登录流程"而不是 spawn 一个 CLI。这类 harness 仍通过 `isAuthenticated` 报告 `status`，并正常列出会话。status 快照携带显式的 `loginable`/`logoutable` 能力标志（由 harness 定义推导），设置界面等表面因此不会提供会得到报错回复的登录/退出操作。

## 委派 registry（resume 载体）

除 harness 身份之外，registry 还持有家族的**委派 registry**：每个子会话一条记录，记下该委派用的 provider 与 CLI 会话，以及按 (parent, provider) 分组的委派 intent FIFO。家族工具（`@khorsheed/dsh-local-agent-tool-subagent`，由各 harness bundle 的 patch 挂载）在每次调用 `ctx.subagents.start()` 前恰好 stage 一个 intent，归属 provider 每次 start 恰好消费一个——因此即使并行委派，fresh 轮与 resume 轮也能正确配对。resume 轮的句柄（dsh 子会话 id）经 registry 解析，凡是未知子会话、他人 parent 的会话、或错误 provider 的句柄都会被拒绝。subagent 请求 descriptor 无法携带该目标（其 schema 拒绝未知字段），因此本服务就是家族内部的载体；同一份记录未来也会喂给 stop registry。映射按 harness 持久化在该 harness 作用域目录下的 append-only `delegations.jsonl`（同一子会话最后一行生效，kimi 镜像 offset 随记录同行），resume 句柄因此能跨宿主重启存活。

## Model Experience

### Harness 命令回复

#### 模型看到什么

registry 本身不提交任何内容。`/<harness> login|sessions|status` 回复与 `/local-agent list` roster 文本都是用户可见的命令文本，绝不是模型 prompt。模型可见效果只从委派挂载 subagent provider 开始——那是 harness bundle 的职责——父级随后通过 subagent 工具结果看到子会话的最终回答。

#### Token 影响

命令发现、执行与回复文本不产生任何模型 token。委派 token 属于 harness bundle 的 provider，由它为一个独立的子上下文付费。

#### KV Cache 影响

registry 元数据与命令回复从不进入模型请求、不影响其缓存；被委派的子会话独立拥有自己的缓存。

## 兼容性

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.1`）：✅ 完整——基于 rc.8 类型面构建并通过测试。本构建**要求 rc.8**：`commands/execute` Remote 新增必填 `images` 参数（rc.6/rc.7 宿主会收到错位的参数）——在旧宿主上请停留在上一个构建。——亦在 0.1.1-rc.1 上验证（纯增量审计，2026-08-21）
- 源码线(deepseek-harness master):✅

## 已知限制与后续工作

- **登录为抓取式 prompt**——web GUI 没有交互式终端面，device-code URL 通过命令回复呈现、CLI 在后台轮询；面向 CLI 面的终端式登录留待后续。
- **homes 根位置**——默认 `$DSH_HOME/local-agent` 先于 formal 的 `var/state` 布局；待 harness home 布局标准化后再议。
- **委派日志增长**——每个 harness 的 `delegations.jsonl` 只增不减、无轮转（与 session_index/rollout 文件同级增长）；轮转/清理留待后续。
- **单样本形状**——harness 契约由 Kimi 归纳；冻结形状前应先做 Codex spike（records 适配器 + 登录探测）。
