# `@khorsheed/dsh-local-agent-claude-code`

[English](README.md) | 中文

[local-agent 家族](../../local-agent/local-agent/README.md) 的 Claude Code harness。bundle patch 注册 `claude-code` harness（`CLAUDE_CONFIG_DIR` 作用域目录、`claude auth login` 浏览器流程、project 文件会话记录），并把 `subagent_claude_code_local` 工具行挂到 **profile 根**——`claude-local` 一次性 provider 在 harness 作用域目录下 spawn `claude -p --output-format json`，任意 agent preset 都能委派、无需逐 preset 变体。浏览器设置分区（设置 → 本地 Agent）随家族 core 的 `./client` 半提供，按 harness 的 roster 驱动。

> 家族 core（`local-agent` 行，共享作用域目录根）随框架包 `@deepseek-ai/dsh-local-agent` 自己的 patch 提供，本包把它声明为依赖——但 `dsh plugin add` 只把**直接**依赖调和进 profile 的 bundles 层，所以要与本包一起显式安装 core（两条命令）。claude 包刻意不重复插入该行——重复会挂载两次 core。

## 前置依赖

- 一个可运行的 dsh profile（`dsh --profile web`、`--profile headless` 或自定义）；与本包一起安装家族 core bundle。
- `PATH` 上有 Claude Code CLI（`claude`，即用户平时交互使用的那个二进制）。插件不负责安装、也不触碰用户自己的 `~/.claude`。

## 安装

```sh
# 1. Install the family core and this bundle into a profile.
dsh plugin --profile web add @deepseek-ai/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-claude-code

# 2. Restart the profile. The first start provisions the scoped home; the
#    subagent_claude_code_local tool mounts at the profile root, so every
#    preset can delegate — no preset step needed.

# 3. Run /claude-code login once from a session.
```

## 卸载

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-claude-code
```

移除 bundle 会注销 harness、其 `/<name>` 命令族、工具行与 UI 行。一个用户自有的目录会刻意保留：作用域目录（`$DSH_HOME/local-agent/claude-code`）保住配置，重装后无需重新登录。删除它即可清除全部痕迹。

## 作用域隔离

本包启动的每个 Claude 进程（登录、委派）都带着 harness 作用域目录（默认 `$DSH_HOME/local-agent/claude-code`）作为 `CLAUDE_CONFIG_DIR` 运行。config、project 会话与历史全部留在那里，与用户自己的 `~/.claude` 互不干扰。登录走浏览器 OAuth：`/claude-code login` 运行 `claude auth login` 并把授权 URL 呈现在会话中、CLI 在后台轮询；授权完成后作用域内的 `.claude.json` 记录 `oauthAccount`。`/claude-code logout` 删除作用域配置文件，之后重新登录即可换一个账号。

**凭据存储平台差异**：macOS 上真实凭据在系统 keychain 的哈希条目里（`Claude Code-credentials-<sha256(configDir)[:8]>`，以作用域目录路径为键）——`/claude-code logout` 够不到它（logout 契约是文件删除），但下次登录会重写同一个哈希槽，残留条目无害。Linux 上受上游 bug #47661 影响，`CLAUDE_CONFIG_DIR` **不隔离**凭据文件：claude 写作用域目录但读默认 `~/.claude/.credentials.json`，因此即使作用域目录没有凭据，委派也可能使用用户默认 home 的凭据。认证探测只做轻量文件检查——看作用域 `.claude.json` 的 `oauthAccount`，绝不为了探测而 spawn CLI。

## 会话记录

`/claude-code sessions` 列出作用域目录下的 `projects/<cwd-slug>/<uuid>.jsonl` 会话文件（Claude Code 自有的 append-only 会话日志）——即本 agent 委派产生的会话，绝不是用户的私人会话。目录 slug 是工作区路径的**有损**编码（分隔符转连字符，不同路径可能撞名），所以列出的 `workDir` 始终取自文件**内容**（第一条 `user` 事件的 `cwd` 字段），绝不取自目录名。家族 core 的浏览器设置分区呈现同一份列表并收窄到当前会话的工作区；`/claude-code sessions` 本身始终显示完整列表。

## Model Experience

### 子请求

#### 模型看到什么

Claude 子会话是委派 Session 工作区内一个全新的一次性 `claude -p` 进程，以作用域目录启动。父级只提交独立的任务文本；父级对话永不跨进程边界。

#### Token 影响

子会话为独立的 Claude 上下文与回合付费。子会话 token 永不进入父级上下文。

#### KV Cache 影响

与父级请求缓存相互独立。复用只取决于作用域 Claude 安装自身的 provider、模型与历史。

### 父级工具结果（间接）

#### 模型看到什么

经由 `dsh-tool-subagent`，父级只看到选定的 Claude 最终回答，或 Consumer 的精确错误。Claude 的评论、工具活动、工作区 diff 不会复制进父级 Session。

#### Token 影响

父级输入只增加工具结果中保留的最终回答或错误。本包自身不增加任何父级工具 schema。

#### KV Cache 影响

无。

### 委派记账

子会话携带真实的用量与耗时：provider 在 CLI spawn 时开 `turn/start`、settle 时关 `turn/end`——失败或被取消也会关（reason `error`/`aborted`）——`subagentTiming` 投影的时长等于实际 CLI 运行时长，失败运行不会留下未闭合的耗时窗口；最终 `assistant/message` 携带从 `claude -p --output-format json` 结果解析的本回合 token 用量（`input_tokens`→未缓存输入、`output_tokens`→输出、`cache_read_input_tokens`→缓存读取、`cache_creation_input_tokens`→缓存写入——Anthropic 各桶独立上报，无需减法），`tokenUsage` 投影据此统计委派。

## 配置

本包接受两个插件 config 字段（均可选）：

- `permissionMode`——`skip`（默认）给 `claude -p` 传 `--dangerously-skip-permissions`，子代理写文件无需交互审批；`normal` 不传（需审批的动作被拒绝）。
- `baseUrl`——为子 CLI 设置 `ANTHROPIC_BASE_URL`；缺省继承宿主进程环境（例如用户级代理 `https://proxy.example.com/anthropic`）。

**权限模式风险**：`skip` 授予子进程与运行 dsh 宿主的用户相同的文件系统触达——与 codex 不同，claude（以及 kimi）**没有 OS 级沙箱**，`skip` 子进程可以写用户能写的任何地方，包括委派工作区之外。`skip` 是可工作的默认，因为一次性 CLI 子代理没有审批面；当委派任务必须被限制在可审批动作内时切换到 `normal`（注意 `normal` 在非交互模式下会拒绝写，产生文件的任务会失败）。若委派既需要写文件又需要工作区隔离，优先给宿主自身套沙箱（例如在沙箱化工作区内运行 dsh 宿主）。

## 已知限制与后续工作

- **登录需要一次交互**——浏览器 OAuth URL 出现在会话中；只有用户在浏览器完成授权后凭据才会出现。
- **macOS logout 只删配置**——`/claude-code logout` 删除作用域 `.claude.json`；keychain 条目（以作用域目录路径哈希为键）留给 CLI 自己的 `claude auth logout`，下次登录会重写。
- **Linux 凭据不隔离**（上游 bug #47661）——`CLAUDE_CONFIG_DIR` 不重定向凭据文件；见上文。
- **交互会话记录可能缺失**——claude 的 headless `-p` 运行会写 project 会话文件，但自定义 `CLAUDE_CONFIG_DIR` 下的交互会话可能不写转写（上游行为）；records 列出 CLI 实际写出的内容。
- **v1 只镜像最终回答**——JSON 结果的 `result` 字段以单条 assistant 消息追加；完整的事件流镜像留待 v2。
- **headless 注意**——`/claude-code` 命令与标题栏下拉需要 Web 会话；`--profile headless` 仍可通过挂载工具行的组合进行委派。
