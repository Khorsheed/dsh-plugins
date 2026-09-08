# `@khorsheed/dsh-local-agent-codex`

[English](README.en.md) | 中文

把编码任务从任意 dsh agent preset 委派给你本地安装的 Codex CLI。委派在插件隔离的作用域目录下运行，你个人的 `~/.codex`——config、凭据、会话——完全不被触碰。

## 特性

- **任意 preset 皆可委派**——`subagent_codex` 工具挂在 profile 根，无需逐 preset 配置。
- **作用域目录隔离**——Codex 的全部状态留在 `$DSH_HOME/local-agent/codex`，与你的 `~/.codex` 互不干扰。
- **会话内登录**——device-code `/codex login`，设置 → 本地 Agent 显示认证状态并提供退出登录按钮。
- **线程续聊**——传入 `resume="<childSessionId>"` 在同一个 dsh 子会话里继续同一个 codex 线程。
- **自定义端点**——经作用域 `config.toml` 的自定义 provider 把 Codex 的 LLM 请求路由到你自己的路由端点。
- **回读与独立工作目录**——每轮从本轮 rollout 回读实际模型、CLI 版本与用量写进委派记录；定位按 threadId + cwd + 时间窗，并发跑也读的是自己那一轮。编排器可用 `cwd` 选项给每格独立目录，resume 换目录即拒绝。
## 安装

前置依赖：一个可运行的 dsh profile 和 `PATH` 上的 Codex CLI（`codex`）——插件不安装它、也不替你登录。

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-codex
# restart the profile, then run /codex login once from a session
```

两个包必须同时点名——`dsh plugin add` 只调和**直接**依赖。

卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-codex
```

作用域目录（`$DSH_HOME/local-agent/codex`）会刻意保留，重装无需重新登录；删除它即可清除全部痕迹。

## 配置

可选，写在 profile patch 层：

```yaml
- id: local-agent-codex
  config:
    sandbox: workspace-write   # codex exec 策略:read-only | workspace-write | danger-full-access
    live: false                # 长驻驱动:每成员常驻一个 codex app-server 进程,按轮发 turn(runtime 级优雅中断、事件推送镜像);关闭或通道不可用即回一次性 exec
    liveIdleMs: 1800000        # 长驻 runtime 空闲回收时限(默认 30 分钟)
    liveMirrorGranularity: event  # live 镜像粒度;token 额外写入 assistant/chunk 增量(写放大,opt-in)
```

## 自定义端点

把 Codex 的 LLM 请求路由到你自己的端点：在作用域 `$DSH_HOME/local-agent/codex/config.toml` 里**新增自定义 provider**（内置 provider 不可覆盖、`OPENAI_BASE_URL` 不生效、预置逻辑从不覆盖已存在的 config）：

```toml
[model_providers.dsh-router]
name = "dsh-router"
base_url = "https://your-router.example/v1"
model_provider = "dsh-router"
```

最后一行为委派选择该 provider；文件其余内容必须保留。

⚠️ **凭据暴露**：作用域 `auth.json` token 会发送给处理请求的端点——只使用你控制或信任的端点。每次委派在 info 级别记录生效的端点。

**评测快照（effectiveSettings）。** 本 harness 向注册表声明一份实时读取的公平性设置快照，供评测条件哈希使用：drive(exec/live)、sandbox 策略(插件配置)、推理强度(读作用域 config 的顶层 `model_reasoning_effort`)、端点是否固定(读作用域 config 的自定义 provider,只报主机名)、已配置模型(读作用域 config 的顶层 `model`,没有就不给字段)、CLI 版本(`codex --version`,按可执行文件路径+mtime 缓存;探测不到即字段缺位)。`/codex status` 与 `LocalAgentStatus` Remote 附带同一份快照。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.2`）：✅ 完整——rc.8→0.1.1-rc.1 API 审计（2026-08-21）确认本插件消费的所有面无变化或纯增量（ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包），无需改动源码；rc.1→rc.2 复核（2026-08-22）：消费面无变化，全量构建测试通过。
- 源码线(deepseek-harness master):✅

## 已知限制

- **登录需要一次浏览器授权**——仅 device-code，没有 API key 路径。
- **`codex exec` 非交互运行**——沙箱策略本需审批的动作会被拒绝而非弹提示；见 `sandbox` 配置。
- **headless 注意**——`/codex` 命令需要 Web 会话；headless 仍可通过挂载工具行的组合进行委派。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**bundle 组成。** patch 注册 `codex` harness（`CODEX_HOME` 作用域目录、device-code 登录、rollout 文件会话记录），并把 `subagent_codex` 工具挂到 profile 根；`codex-local` 一次性 provider 在该作用域目录下 spawn `codex exec`。设置分区随家族 core 的 `./client` 半提供；core 本身来自声明为依赖的 `@khorsheed/dsh-local-agent`。

**登录与凭据。** `/codex login` 在会话中显示 device-code URL 并在后台轮询；用户授权后凭据写入作用域目录。首次启动写入一份最小 `config.toml`，固定 `cli_auth_credentials_store = "file"`——Codex 默认的 `auto` 会解析到 macOS keychain，把凭据泄漏到作用域目录之外并使本包的 `auth.json` 存在性检查失效；已存在的 config 保持不动。`/codex logout` 删除作用域 `auth.json`，之后重新登录即可换账号。

**会话记录。** `/codex sessions` 列出作用域目录的 `sessions/YYYY/MM/DD/rollout-*.jsonl` 文件——仅本插件委派产生的会话，绝不含你的私人会话。设置分区把列表收窄到 `workDir` 与当前会话 cwd 一致的记录。

**回读与 cwd 覆盖。** 每轮 settle 后，provider 从本轮自己的 rollout 文件里回读三件事，随 `settled` 进度事件上报并合并进 `delegations.jsonl`：模型（`turn_context.payload.model`——codex 0.144.0 的 exec 流事件根本不带 model，rollout 是唯一权威；按本轮时间窗过滤，resume 线程里先前轮次的模型不会被误读）、CLI 版本（`session_meta.payload.cli_version`——服务本轮的那个 codex build 自己写下的，比事后探测可执行文件更准）、以及非正常结束时流里缺失的 token 用量（最后一条 `token_count`）。取不到即缺位，绝不猜测。

定位与扫描两处都按并发校准过。`turn_context` 是 codex 在**回合开始**时写的，所以一轮里之后产生的事件一多就会把它挤出文件尾——只扫尾部会读回 null（一次真实评测跑就是这么丢的：38 KB 的 smoke 轮读得到，100–500 KB 的正式格读不到），因此尾部扫不到就再做一次有界的整文件读。定位则在 threadId 之外把**本轮 cwd** 也算进去：并发委派会让多个格的文件落进同一个时间窗，`session_meta.payload.cwd` 才是区分它们的字段；窗口里有候选却没有一个对得上本轮目录时，宁可什么都不报也不报邻居那一轮（窗口里只有一个候选除外——那是路径写法差异，不是歧义）。编排器还可以经门面 `DelegationCallOptions.cwd` 给本轮指定工作目录（记录进 `cwd` 字段）；resume 轮解析出的目录若与首轮记录不一致，进程启动前即 fail loud——CLI 会话延续的是首轮所在目录的上下文。

**续聊（resume）。** 家族工具（`@khorsheed/dsh-local-agent-tool-subagent`）在官方 `description`/`prompt` 子集上增加可选 `resume` 参数。首次委派的结果文本自述句柄（`追问请带 resume="<childSessionId>"`）；后续轮次传回它即在**同一个** dsh 子会话里继续**同一个** codex 线程（`codex exec --json resume <thread_id>`），按轮记账。句柄只从 `resume` 参数读取，localAgent registry 仅对记录该委派的同一 parent 会话与 provider 解析——伪造句柄在任何 CLI 进程启动前就被拒绝。

**事件流镜像。** 子代理会话按顺序镜像 `codex exec --json` 事件流：`reasoning` → 推理块、`agent_message` → 回复文本、`command_execution`/`web_search_call`/`function_call_output` → 工具行（`[工具 Bash] <command> → output`）；最终 `agent_message` 作为运行输出，当轮用量挂在最后一条镜像的 assistant 消息上。续聊轮各自追加自己的 turn，不会重复。中止会让工具结果立即 settle，并保留已收到的事件与用量。

**模型体验。** 每次委派都是委派 Session 工作区内一个全新的一次性 `codex exec` 进程。父级只提交任务文本、只看到最终回答或精确错误——Codex 的评论、工具活动、工作区 diff 不会跨进父级会话，子会话 token 也永不进入父级上下文。

**长驻驱动（`live: true`）。** 替代每轮 spawn：成员首轮委派拉起一个常驻 `codex app-server --stdio` 进程（同 scoped home、同 `-c` 成员桥声明），创建持久线程（`thread/start`，`ephemeral: false`），之后每轮 = 向活着的 runtime 发 `turn/start`；`item/completed` 事件即时折进子会话（与 exec 共享同一 `CodexTranscriptLine` 折叠与 append 核，最后一行留置到 `turn/completed` 以挂用量），`cancel` 落地为 `turn/interrupt`——进程不死、线程可续。审批类 server→client 请求按无人值守策略自动应答（cancel/decline，与 exec 行为一致）。runtime 空闲超时回收（app-server 无 shutdown 方法：stdin EOF → SIGTERM 阶梯），崩溃后下一轮自动重连并 `thread/resume` 盘上线程；握手失败进冷却熔断，逐轮回退 exec。

**委派记账。** provider 在 spawn 时开 `turn/start`、settle 时关 `turn/end`——失败或取消（`error`/`aborted`）同样关闭——`subagentTiming` 的时长等于实际 CLI 运行时长；最终 assistant 消息携带从事件流解析的 token 用量。codex 的 `input_tokens` 含缓存命中，所以未缓存桶取 `input_tokens − cached_input_tokens`、`cached_input_tokens` 映射缓存读取、没有缓存写入概念——`tokenUsage` 不会双重计数缓存命中。每个续聊轮在各自递增的轮次号下重复这套记账。**非 completed 终态（aborted/error）的用量回落。** 被中止/失败的轮次永远收不到 `turn.completed`，事件流里没有用量——但 codex 已把本轮真实 token 消耗写进了 scoped home 的 rollout 文件。此时 exec 镜像改读**本次 run 的 rollout 文件末条 `token_count`** 挂用量：文件按线程 id（`session_meta` 头）定位，流在 `thread.started` 之前就被截断时按 spawn 时间窗回落；口径与 `turn.completed` 完全一致（`input − cached` 等桶，共享 `usageFromCodex`）。硬杀到连 `token_count` 都没写出的极端情况仍保持无用量，不猜测。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-codex`）。问题与贡献请移步该仓库。
