# `@khorsheed/dsh-local-agent-codex`

[English](README.md) | 中文

把编码任务从任意 dsh agent preset 委派给你本地安装的 Codex CLI。每次委派都在插件隔离的作用域 `CODEX_HOME` 下 spawn 一个一次性 `codex exec`——你个人的 `~/.codex`（config、凭据、会话）完全不被触碰。本包是 [local-agent 家族](../local-agent/README.md) 的 Codex harness。

## 特性

- **任意 preset 皆可委派**——`subagent_codex_local` 工具挂在 profile 根，任何 agent preset 都能把任务交给 Codex，无需逐 preset 变体。
- **作用域目录隔离**——插件启动的每个 Codex 进程（登录、委派）都以作用域目录（默认 `$DSH_HOME/local-agent/codex`）作为 `CODEX_HOME` 运行；config、凭据、会话全部留在那里，与你自己的 `~/.codex` 互不干扰。
- **device-code 登录**——`/codex login` 把授权 URL 和验证码呈现在会话中；设置 → 本地 Agent 显示 harness 认证状态并提供网页登录按钮，已认证后另有退出登录按钮。
- **会话记录**——`/codex sessions` 列出作用域目录的 rollout 文件；家族 core 的设置分区呈现同一份列表并收窄到当前会话的工作区。
- **续聊（resume）**——后续轮次传入 `resume="<childSessionId>"` 即可在同一个 dsh 子会话里继续同一个 codex 线程，按轮记账。
- **自定义端点路由**——Codex 的 LLM 请求可经作用域 `config.toml` 里的自定义 provider 路由到你自己的路由端点。

## 安装

前置依赖：一个可运行的 dsh profile（`dsh --profile web`、`--profile headless` 或自定义），以及 `PATH` 上的 Codex CLI（`codex`，即你平时交互使用的那个二进制）。插件不负责安装、不替你登录、也不触碰你自己的 `~/.codex`。

```sh
# 1. Install the family core and this bundle into a profile.
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-codex

# 2. Restart the profile. The first start provisions the scoped home; the
#    subagent_codex_local tool mounts at the profile root, so every preset
#    can delegate — no preset step needed.

# 3. Run /codex login once from a session.
```

两个包必须同时点名：`dsh plugin add` 只把**直接**依赖调和进 profile 的 bundles 层，而 codex 包刻意不重复插入家族 core 行——重复会挂载两次 core。

卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-codex
```

移除 bundle 会注销 harness、其 `/<name>` 命令族、工具行与 UI 行。一个用户自有的目录会刻意保留：作用域目录（`$DSH_HOME/local-agent/codex`）保住会话与凭据，重装后无需重新登录。删除它即可清除全部痕迹。

## 配置

可选，写在 profile patch 层：

```yaml
- id: local-agent-codex
  config:
    sandbox: workspace-write   # codex exec 策略:read-only | workspace-write | danger-full-access
```

## 自定义端点

Codex 的 LLM 请求可以经自定义端点路由，但只能在作用域 `config.toml`（`$DSH_HOME/local-agent/codex/config.toml`）里**新增自定义 provider**——codex 拒绝覆盖内置 provider（`model_providers contains reserved built-in provider IDs`），且不认 `OPENAI_BASE_URL` 环境变量。原地编辑（预置逻辑从不覆盖已存在的 config）：

```toml
[model_providers.dsh-router]
name = "dsh-router"
base_url = "https://your-router.example/v1"
model_provider = "dsh-router"
```

最后一行让委派选择该自定义 provider。文件其余内容（`cli_auth_credentials_store`、其他 provider）必须保留。

⚠️ **凭据暴露**：codex 作用域的 `auth.json` token 会发送给处理请求的端点。把 `base_url` 指向不受信地址等于把该 token 交给它；只使用你控制或信任的端点。

每次委派在 info 级别记录生效的自定义端点（`subagent-codex: delegating via <endpoint>`），失败运行的报错文本会点名它使用的端点。更完整的 provider 编辑器（端点 + 模型 + 认证键）另行规划。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.1`）：✅ 完整——rc.8→0.1.1-rc.1 API 审计（2026-08-21）确认本插件消费的所有面无变化或纯增量（ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包），无需改动源码。
- 源码线(deepseek-harness master):✅

## 已知限制

- **登录需要一次交互**——device-code URL 出现在会话中；只有你在浏览器完成授权后凭据才会出现。没有 API key 路径。
- **`codex exec` 非交互运行**——沙箱策略本需审批的动作会被拒绝而非弹提示；`sandbox` 配置（默认 `workspace-write`）选择策略。
- **headless 注意**——`/codex` 命令与标题栏下拉需要 Web 会话；`--profile headless` 仍可通过挂载工具行的组合进行委派。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**bundle 组成。** bundle patch 注册 `codex` harness（`CODEX_HOME` 作用域目录、`codex login --device-auth` device-code 流程、rollout 文件会话记录），并把 `subagent_codex_local` 工具挂到 profile 根——`codex-local` 一次性 provider 在 harness 作用域目录下 spawn `codex exec`。浏览器设置分区（设置 → 本地 Agent）随家族 core 的 `./client` 半提供，按 harness 的 roster 驱动。家族 core（`local-agent` 行，共享作用域目录根）随 `@khorsheed/dsh-local-agent` 自己的 patch 提供，本包把它声明为依赖。

**登录与凭据存储。** 登录只走 device-code：`/codex login` 把授权 URL 和验证码呈现在会话中、CLI 在后台轮询；用户授权后凭据写入作用域目录。首次启动会在作用域目录写入一份最小 `config.toml`，固定 `cli_auth_credentials_store = "file"`——Codex 默认的 `auto` 在 macOS 上会解析到系统 keychain，既把凭据泄漏到作用域目录之外，也让本包的 `auth.json` 存在性检查失效。已存在的 config 保持原样不动。`/codex logout` 删除作用域内的 `auth.json`，之后重新登录即可换一个账号。登录进行中时，设置分区会持续重新探测，直到凭据落地。

**会话记录。** `/codex sessions` 列出作用域目录下的 `sessions/YYYY/MM/DD/rollout-*.jsonl` rollout 文件（Codex 自有的 append-only 会话日志）——即本 agent 委派产生的会话，绝不是用户的私人会话。设置分区把列表收窄到 `workDir` 与当前会话 cwd 一致的记录，一个项目的 codex 会话不会出现在另一个项目的会话里；`/codex sessions` 本身始终显示完整列表。

**续聊（resume）。** `subagent_codex_local` 工具是家族自有工具（`@khorsheed/dsh-local-agent-tool-subagent`）——官方子集（`description`/`prompt`）加上一个可选 `resume` 参数。首次委派的结果文本会自述句柄（`追问请带 resume="<childSessionId>"`）；在后续轮次把它作为 `resume` 传回，就会在**同一个** dsh 子会话里继续**同一个** codex 线程（`codex exec --json resume <thread_id>`），并按轮记账：轮次号递增、每轮 `turn/start`/`turn/end` 成对、usage 挂在当轮的 assistant 消息上。句柄绝不进 prompt：它只从 `resume` 参数读取，localAgent registry 只对记录该委派的同一 parent 会话与 provider 解析句柄——伪造的句柄（未知子会话、他人 parent 的会话、或错误的 provider）在任何 CLI 进程启动前就被拒绝。descriptor 无法携带该目标（其 schema 拒绝未知字段），因此家族改经 `localAgent` 服务的委派 registry 传递。

**事件流镜像。** dsh 子代理会话按顺序镜像 `codex exec --json` 事件流：`reasoning` 事件折叠为 `reasoning` 块、`agent_message` 事件为回复文本、`command_execution`/`web_search_call`/`function_call_output` 事件为工具行（`[工具 Bash] <command> → output`）；最终 `agent_message` 作为运行输出，当轮用量挂在最后一条镜像的 assistant 消息上。流天然按轮增量，续聊轮各自追加自己的 turn，不会重复。中止运行会让工具结果立即 settle，并仍然镜像已收到的事件——被取消的轮保留部分推理/命令与真实用量。

**模型体验。** Codex 子会话是委派 Session 工作区内一个全新的一次性 `codex exec` 进程，以作用域目录启动。父级只提交独立的任务文本；父级对话永不跨进程边界。子会话为独立的 Codex 上下文与回合付费——子会话 token 永不进入父级上下文，KV cache 复用与父级请求缓存相互独立，只取决于作用域 Codex 安装自身的 provider、模型与历史。经由家族工具，父级只看到选定的 Codex 最终回答，或 Consumer 的精确错误，以及首次委派时的续聊自述；Codex 的评论、工具活动、工作区 diff 不会复制进父级 Session。父级输入只增加工具结果中保留的最终回答或错误（无 KV cache 影响）；本包自身不增加任何父级工具 schema。

**委派记账。** 子会话携带真实的用量与耗时：provider 在 CLI spawn 时开 `turn/start`、settle 时关 `turn/end`——失败或被取消也会关（reason `error`/`aborted`）——`subagentTiming` 投影的时长等于实际 CLI 运行时长，失败运行不会留下未闭合的耗时窗口；最终 `assistant/message` 携带从 `codex exec --json` 事件流解析的本回合 token 用量。codex 的 `input_tokens` 是**含缓存命中的总输入**（OpenAI 口径；`input_tokens + output_tokens` 等于 rollout 的 `total_tokens`），所以未缓存桶取 `input_tokens − cached_input_tokens`、`cached_input_tokens` 映射缓存读取、`output_tokens` 映射输出；codex 没有缓存写入概念。`tokenUsage` 投影据此统计委派，不会把缓存命中双重计数。每个续聊轮在各自递增的轮次号下重复这套记账。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-codex`）。问题与贡献请移步该仓库。
