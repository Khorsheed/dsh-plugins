# `@khorsheed/dsh-local-agent`

[English](README.en.md) | 中文

从 dsh web GUI 使用本机安装的编码 agent CLI——Kimi Code、Codex、Claude Code。每个 CLI 获得一个隔离的作用域目录、一组登录/会话/状态/退出的斜杠命令，以及设置里的认证分区。

<img src="../../docs/screenshots/08-local-agent.png" width="480" alt="设置 → 插件配置里的 Local Agent 卡片，卡头状态点一眼可见各 provider 授权状态">

## 特性

- **每个 CLI 一个作用域目录**——共享 homes 根下的隔离凭据/会话目录，以 0700 创建；你的本地 CLI 安装绝不被动到。
- **斜杠命令族**——`/<harness> login|sessions|status|logout`，device-code 登录 URL 通过命令回复呈现。
- **每 provider 一张设置卡片**——设置 → 插件 → 插件配置：认证状态点（卡头可见）、网页登录/退出、常驻模式（live）热切开关与输出粒度；卡片直接复用本包 client 面的共享 `ProviderAuthBlock`。
- **子 agent 委派**——把会话工作交给本机 CLI 并在之后 resume，宿主重启也能续上。

## 安装

core 本身就是 bundle；请把它与至少一个 harness bundle（`@khorsheed/dsh-local-agent-kimi`、`-codex`）一起安装——`dsh plugin add` 只激活**直接**依赖，仅靠 harness bundle 的传递依赖不会挂载本 core。

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent
```

然后重启 web 实例。卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent
```

## 配置

自定义组合挂载一次 core：

```yaml
- id: local-agent
  name: '@khorsheed/dsh-local-agent'
  config:
    homesRoot: !!js dshHomePath('local-agent')
```

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.2`）：✅ 完整——基于 rc.8 类型面构建并通过测试。本构建**要求 rc.8**：`commands/execute` Remote 新增必填 `images` 参数（rc.6/rc.7 宿主会收到错位的参数）——在旧宿主上请停留在上一个构建。——亦在 0.1.1-rc.1 上验证（纯增量审计，2026-08-21）；rc.1→rc.2 复核（2026-08-22）：消费面无变化，全量构建测试通过
- 源码线(deepseek-harness master):✅

## 已知限制

- **登录为抓取式 prompt 或人工交接**——web GUI 没有交互式终端面：device-code harness（kimi/codex）的 URL 通过命令回复呈现、CLI 在后台轮询；认证只在 TTY 可用的 harness（claude ≥2.1）声明 manual 变体——`/login` 回复用户在自己终端运行的完整命令，registry 监听作用域目录识别登录完成。
- **homes 根位置**——默认 `$DSH_HOME/local-agent`，待 `var/state` 布局标准化后再议。
- **委派日志增长**——每个 harness 的 `delegations.jsonl` 只增不减、无轮转。
- **单样本形状**——harness 契约仅由 Kimi 归纳，尚未冻结。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

每个 harness 向 `ctx.localAgent` 注册：一个作用域目录、一个可选的登录声明（device-code 命令，或 TTY-only CLI 的 manual 交接变体）、一个会话记录适配器，以及可选的认证状态与退出登录探测。glue 供给每个作用域目录并注册 `/<harness> login|sessions|status|logout` 命令族；harness 间差异只剩 `homeEnvVar`、登录调用、records 适配器与认证/退出探测。

**委派不属于这个 seam。** 每个 harness bundle 各自向既有的 `subagent` 能力挂载 subagent-provider 行（讲 stdio ACP 的 harness 用 subagent-acp，Codex 用其 app-server provider），经 `localAgent.homeDir(name)` 读取作用域目录。

**程序查询走只读 Remote 通道。** `LocalAgentGateway`（服务键 `localAgentGateway`，生成物 `./remote`）通过 Typert Gateway 向浏览器暴露 roster、各 harness 状态与作用域会话。它不产生任何会话事件，因此 UI 轮询不会在会话日志里留下命令节点；登录与退出仍走斜杠命令通道——用户主动操作产生可见命令节点正是预期反馈。

**评测快照（effectiveSettings）。** 每个 harness 可声明一份当前生效的公平性相关设置：drive（exec/live）、沙箱或权限模式（各用自家词汇：codex 报 sandbox 策略、claude 报 permissionMode、kimi 报自动批准与否；没有该旋钮的 harness 字段缺位，缺位本身就是诚实的条件输入）、推理强度、已配置模型（各家读自家配置面：kimi 的 `default_model`、codex 的 `model`、claude 的作用域 `settings.json`、dsh 继承的宿主选择；读不到就不给字段，绝不猜默认值）、端点是否固定（只报主机名，绝不报完整 URL）、CLI 版本（问 CLI 自己：`probeCliVersion` 跑一次 `<cli> --version`，按可执行文件的解析路径+mtime+大小缓存，所以一次升级会自动重探，而没装、超时、非零退出、输出里没有版本形状的 token 都只是字段缺位）。快照是实时读——人改过的作用域配置报人改过的值——纯 JSON、绝不含凭证，`registry.effectiveSettings(name)` 供编排器读条件哈希，`/<harness> status` 与 `LocalAgentStatus` Remote 附带同一份（增量字段，旧客户端不受影响）。

**凭证只说知道的（credentialState）。** `LocalAgentStatus` 除 `authenticated` 布尔外还带一档 `credentialState`：`absent`（作用域家目录里没有凭证记录）、`present-unverified`（有记录，但本宿主进程里还没有任何一轮委派碰过它——一份过期且刷不动的凭证和一份能用的凭证形状完全一样，说不知道正是这一档的意义）、`verified`（自上次登录/登出以来有一轮委派真的打通了端点并完成）、`rejected`（某轮的端点拒了这份凭证，且此后没有新登录重写凭证标记）。`authenticated` 保持不变，恒等于 `verified || present-unverified`，所以设置卡片与既有客户端读到的还是原来那个布尔。这一档是每宿主进程的：重启后一份在场的凭证回到 `present-unverified`，因为那才是当下真正知道的；开跑前的主动活性探测不归这个字段。provider 在一轮 settle 成 completed 时调 `reportAuthSuccess`，与既有的 `reportAuthFailure` 对称。

**浏览器半身随本包提供。** `./client` 导出通过本包的 `dsh.client` manifest 自动挂载：成员 composer（委派的子会话可继续对话）+ 共享设置卡片构件（`ProviderAuthBlock`、认证状态总线、`AuthStatusDot`）——各 provider 包的 `settings.plugin.item` 卡片直接组合它们，UI 保持 provider 无关（只消费 `/<harness>` 命令族和只读 gateway）。

### 新增一个 harness

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

`login` 是可选的：没有登录流程的 harness（例如 dsh 自身——它通过宿主实例的 `DEEPSEEK_API_KEY` 认证，而非 device-code 流程）省略它，`/dsh login` 会回答"该 harness 无登录流程"而不是 spawn 一个 CLI。这类 harness 仍通过 `isAuthenticated` 报告 `status`，并正常列出会话；status 快照携带显式的 `loginable`/`logoutable` 能力标志，设置界面等表面因此不会提供会得到报错回复的操作。

### 委派 registry（resume 载体）

registry 还持有家族的**委派 registry**：每个子会话一条记录，记下该委派用的 provider 与 CLI 会话，以及按 (parent, provider) 分组的委派 intent FIFO。家族工具（`@khorsheed/dsh-local-agent-tool-subagent`，由各 harness bundle 的 patch 挂载）在每次调用 `ctx.subagents.start()` 前恰好 stage 一个 intent，归属 provider 每次 start 恰好消费一个——因此即使并行委派，fresh 轮与 resume 轮也能正确配对。resume 轮的句柄（dsh 子会话 id）经 registry 解析，凡是未知子会话、他人 parent 的会话、或错误 provider 的句柄都会被拒绝；subagent 请求 descriptor 无法携带该目标，因此本服务就是家族内部的载体。映射按 harness 持久化在其作用域目录下的 append-only `delegations.jsonl`（同一子会话最后一行生效），resume 句柄因此能跨宿主重启存活。

### 活跃委派 registry 与 `/local-agent stop`

registry 另持有**活跃委派 registry**（以 dsh 子会话 id 为键的在飞 run 表）：facade 启动的 run（`start`/`resume`——成员 composer、room 等程序化入口）与家族工具直接 `ctx.subagents.start()` 启动的 run（经 `trackDelegationRun` 登记）都落在同一张表里，条目在 run 结果 settle 时自清。`/local-agent stop <childSessionId>` 命令按这张表取消在飞的委派——语义对齐官方 `subagents.interrupt(targetSessionId)`：fire-and-return（发出取消信号即回复），目标缺席（未知子会话或无在飞 run）是显式说明的 accepted no-op，而非报错。这为 taskpilot 等表面提供了停止按钮的落点：对没有 live agent 的一次性子代理行，按钮改发 `/local-agent stop <childSessionId>`，local-agent 缺席时降级为无法停止的明确报错。

### Model Experience

**模型看到什么**——registry 本身不提交任何内容：`/<harness>` 命令回复与 `/local-agent list` roster 文本都是用户可见的命令文本，绝不是模型 prompt。模型可见效果只从 harness bundle 挂载 subagent provider 开始；父级随后通过 subagent 工具结果看到子会话的最终回答。

**Token 影响**——命令发现、执行与回复文本不产生任何模型 token。委派 token 属于 harness bundle 的 provider，由它为一个独立的子上下文付费。

**KV Cache 影响**——registry 元数据与命令回复从不进入模型请求、不影响其缓存；被委派的子会话独立拥有自己的缓存。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent`）。问题与贡献请移步该仓库。
