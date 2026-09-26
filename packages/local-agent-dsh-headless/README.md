# @khorsheed/dsh-local-agent-dsh-headless

[English](README.en.md) | 中文

一个随叫随到的无头 dsh：会话 id 由调用方点名，跑完任务把最终回答打到 stdout 就退出；加 `--serve` 则常驻下来，一轮一轮地接活。

local-agent 家族要把任务委派给一个独立的 dsh 进程，还要跨多轮续接**同一个**子会话——这要求会话 id 归调用方所有，而不是由 runner 自己生成。本 bundle 是官方 `@deepseek-ai/dsh-headless` 的兄弟版本：同样是 `dsh-base` 之上直驱 Agent 的无头组合，唯一区别就是 id 归谁——这里 id 以 `--session-id` / `--resume` 传入，stdout 永不携带可解析的会话标记。你永远不需要自己安装或挂载它：父侧 `@khorsheed/dsh-local-agent-dsh` provider 会在运行时把子 profile 自动 provision 好。

## 特性

- **调用方点名的会话 id**——`--session-id <id>` 以该确切 id 新建会话，`--resume <id>` 续接它；id 走启动参数，绝不从 stdout 解析。
- **一次性语义**——驱动任务到落定、落盘 flush、把最终助手文本打上 stdout；轮次 `completed` 退出 0，其余一律退出 1（错误摘要走 stderr）。
- **常驻 serve 模式**——`--serve` 把 runner 切成长驻循环：`turn/start` 接一轮、`session/event` 逐事件推流、`session/assistant-stream` 转发原生 assistant 帧、`session/idle` 在日志落盘之后关轮、`turn/interrupt` 落地为进程内 `Agent.cancel` 优雅中断（进程不死、会话可续）、`shutdown` 或 stdin EOF 优雅退出。wire 契约见 `src/wire.ts`。
- **按启动点名模型与推理强度**——`--model <provider/model>` 覆盖本次启动的模型选择，`--effort <value>` 指定原生推理强度（按模型自报的列表校验，不认即响亮失败）；不给就逐字节沿用实例自己的选择。
- **隔离的会话存储**——子 dsh 会话住在自己的 scoped `$DSH_HOME` 下，绝不出现在父实例的会话列表里。
- **零手工挂载**——`headless-local-agent-dsh` 子 profile 由父级 provider 自动 provision，任何地方都不需要手工挂载。

## 安装

本 bundle 从不单独安装或挂载——它随父级 harness 一起进门（传递依赖），父级 provider 在运行时 provision 子 profile：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-dsh
```

重启 web 实例后生效。卸载走父级包，本 bundle 随之离开：

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-dsh
```

没有需要单独卸载的东西——本包在任何交互式 profile 里都没有行，也不许有（见已知限制）。

## 用法

通常由父级 provider 拉起本 bundle；直接调用也可以：

```sh
dsh --profile headless-local-agent-dsh --session-id 6ba7... "run the tests"   # 新建
dsh --profile headless-local-agent-dsh --resume 6ba7... "run the rest"        # 续接
dsh --profile headless-local-agent-dsh --serve                               # 常驻 live-driver 模式（stdio wire）
```

两个 flag 都不给时，runner 自生成 `session-<uuid>` id（官方 headless 行为），因此仍是一次性使用的即插即用替代。`--serve` 不接受 task 与 session flag——turn 与会话 id 全部走 wire。

### `--model <provider/model>` 与 `--effort <value>`

覆盖本次启动的模型选择：

```sh
dsh --profile headless-local-agent-dsh --model deepseek-official/deepseek-v4-pro --session-id 6ba7... "run the tests"
```

- 不给 `--model` = 用子实例自己 `agentDefaultModel` 的当前选择，与这个 flag 出现之前逐字节相同。
- 按**第一个** `/` 切分 provider 与 model，所以模型 id 里再带斜杠也不会被切坏；只写模型名（没有 `/`）则只换模型、沿用实例的 provider。开头或结尾的斜杠不算切分点——那会切出一个空的一半，agent 路由不了——整个值当模型名。
- 选择的其余部分原样带过：换模型不是重置配置。
- `--effort <value>` 指定本次启动的原生推理强度：值按所选模型自报的 effort 列表校验，模型不认就响亮拒绝，空值是用法错误。
- 两个 flag 与两种模式都正交：一次性轮次绑定这一轮，`--serve` 绑定这个常驻进程托管的**每一个**会话——runtime 的模型是进程事实，这正是父侧拒绝在长驻路径上按次给模型的原因。

父侧 `local-agent-dsh` provider 自动带上 `--model`：harness 的 `model` 插件配置键、或某一次委派自带的 `DelegationCallOptions.model`，都落成这个 flag。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——首个发布线（0.1.0-rc.6）即以 0.1.5-rc.1 API 面为基线，全量构建测试通过；minHost 即 0.1.5-rc.1，更旧的宿主没有可回退的旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）

## 已知限制

- **绝不要把这个 bundle 加进交互式 profile 的 `bundles`**——它的子 profile 专属 patch 行（persona 覆盖、`hmr` 禁用、`tools` mode、`ptc-runtime` insert、member-bridge MCP）会撞交互式组合，并把覆盖泄漏进真实用户会话。本包**不声明 `dsh.bundle`**（manifest 里标的是 `dsh.composition.component: "sub-profile-patch"`），手工加的 bundles 行在 boot 的 `loadProfile` 处直接 fail loud，这正是一道闸。
- **`dsh plugin add` 它本身不挂载任何东西，也无需如此**——本包曾声明 `dsh.bundle`，而 reconcilePlugins 会把声明该字段的直接依赖自动挂进组合的 layer 栈：2026-08-23 P0（prod web profile 撞 duplicate `code-runtime`）与 2026-09-03 G3 复发都是这一挂。声明已撤（T6），装成直接依赖只会得到一条 "plain dependency" 警告、不挂载——经 `@khorsheed/dsh-local-agent-dsh` **传递**安装即可，父级 provider 会自动 provision。包内不变量（`/invariant` 子路径）对挂进 web 组合（检出 `webStartup` 服务）依旧 fail loud。
- 此 composition 里不装任何其他 `local-agent` 家族 bundle——这里没有任何东西再 spawn 一个 dsh。
- patch 改动落地前必须做启动级验证（`dsh preflight` 或真实拉起一次子 dsh）：`!!js` 标签只支持标量，误标集合会在 profile 启动时直接失败。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

local-agent 家族需要在多次委派之间续接**同一个** dsh 对话：父级 provider 生成一个 uuid，并在每一轮传同一个值——fresh 轮用它创建子 dsh 会话，之后的 resume 轮恰好续接该会话。

本 bundle 的 patch 在自己的 profile 之上叠加 `dsh-base`（如 `headless-local-agent-dsh`），核心是两行 insert（节选自包内 `cordis.patch.yml`）：

```yaml
- insert:
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
        model: !!js ctx.localAgentDshHeadlessStartup.model
        effort: !!js ctx.localAgentDshHeadlessStartup.effort
```

startup provider 解析 task 位置参数与互斥的 `--session-id` / `--resume`（或 `--serve`）并发布调用；runner 等整棵 loader 树落定之后才动 agent——一次性模式经 `agents.create` / `agents.resume` 创建或续接该会话、驱动任务、打印最终助手文本并退出，serve 模式转入常驻 wire 循环（`src/serve.ts`）。子 profile 本身由父级 provider 在运行时 provision（`provisionDshSubProfile`）到 dsh harness 的 scoped home 下：manifest 只列 `@deepseek-ai/dsh-base`，本 bundle 的 patch 从包内 `cordis.patch.yml` 逐字节拷贝为该 profile 自己的 patch 层（本包不声明 `dsh.bundle`，见已知限制），另加一条解析本 bundle 的符号链接供 loader 解析 insert 行。

**wire 契约（`src/wire.ts`）。** 家族内部的行分隔 JSON-RPC 2.0 over stdio，帧格式与官方 `JsonRpcLineTransport`（`@deepseek-ai/dsh-sdk-protocol`）完全一致，将来换成官方 SDK server 只是机械替换——官方 server 今天用不了：它的 wire 没有轮次级中断（只有 `initialize` / `session/prompt` / `shutdown`），而优雅中断正是 live driver 存在的理由（上游 seam 登记：SDK-wire-interrupt 条目）。所有请求都是快速应答（`turn/start` 应答即「已受理」），轮次的事件与结局全部以通知回流，长轮永远不占着一条请求。`turn/start` 带上父侧的轮次号，并在本轮每个 `session/event` / `session/idle` 通知上回显，父侧借此丢弃被取消轮次的迟到收尾，不让它误 settle 下一轮；`session/idle` 在会话日志落盘**之后**才发出，父侧随即做的文件对账看到的就是完整一轮。握手（`initialize`）回报 server 名与协议版本（当前 1）；`session/prepare` 让父侧在起轮之前校验常驻进程绑定的模型与推理强度——不建会话、不生成。一个常驻进程服务一个成员。

**组合守卫。** `/invariant` 子路径注册一条组合不变量：检出 `webStartup` 服务（web 组合的标记）即 fail loud。loader 的 duplicate-id 失败虽响但难读，且只在 id 相撞时才触发——若上游改了 row id，persona 覆盖就会静音泄漏进真实用户会话；不变量是不相撞情形的那个清晰失败。

**preset roster（可选）。** 如果子 profile 的 patch 多带一层 `@deepseek-ai/dsh-agent-presets`（父级 provider 在这个 scope 声明了 preset 时写进去的），agent loader 会在 `setup` 里 join 它——在 agent 发布之前，因此 preset 的工具与提示词片段在第一次组装提示词之前就在位。没有这一层就什么也不做，模型可见的行留在宿主面、agent 从全局层读，与本行为出现之前逐字节相同。roster **拒绝**（preset id 不存在、composition 坏了）不会被降级绕过：mount 抛错，agent 创建回滚，启动带着 preset 名失败——一个被要求跑 preset X 却悄悄跑了全局层的子 dsh，会把这一轮归到它从没有过的能力面上。

**导出。** `.` 导出 runner 插件本体（`apply` / `inject` / `Config`）；`/startup` 导出命令行 provider（`localAgentDshHeadlessStartup` 服务的来源）；`/wire` 导出 wire 契约类型与协议常量；`/invariant` 导出组合守卫 companion。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-dsh-headless`）。问题与贡献请移步该仓库。
