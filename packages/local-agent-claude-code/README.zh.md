# `@khorsheed/dsh-local-agent-claude-code`

[English](README.md) | 中文

把编码任务委派给本地安装的 Claude Code,任意 dsh agent preset 都能用。本包——[local-agent 家族](../local-agent/README.md) 的 Claude Code harness——把 `subagent_claude_code_local` 工具挂到 profile 根:模型交出任务,一个一次性 `claude -p` 在委派会话的工作区内、作用域目录下执行,答案连同思考与工具活动实时镜像回 dsh 子代理会话。你自己的 `~/.claude` 绝不被动到。

## 特性

- **任意 preset 都能委派**——工具只在 profile 根挂载一次,每个 agent preset 都能交任务,无需逐 preset 变体。
- **作用域隔离**——本包启动的每个 Claude 进程(登录、委派)都以 `$DSH_HOME/local-agent/claude-code` 作为 `CLAUDE_CONFIG_DIR` 运行;config、project 会话与历史全部留在那里,与你的个人 `~/.claude` 互不干扰。
- **一条命令完成浏览器登录**——`/claude-code login` 运行 `claude auth login` OAuth 流程并把授权 URL 呈现在会话中;`/claude-code sessions`、`status`、`logout` 构成完整命令族。
- **续聊委派**——首次委派的结果会自述 `resume` 句柄;后续轮次把它传回,就在同一个 dsh 子会话里继续同一个 Claude 会话,并按轮记账。
- **实时流镜像**——子会话按顺序镜像 Claude 的事件流(思考 → reasoning 块、工具调用 → 工具行、回复 → assistant 文本);中止运行会立即 settle,并保留部分转写与真实 token 用量。
- **自带设置界面**——家族 core 的浏览器半在 设置 → 本地 Agent 呈现各 harness 的认证状态、web 登录与会话记录,按 harness 的 roster 驱动。

## 安装

前置依赖:一个可运行的 dsh profile(`dsh --profile web`、`--profile headless` 或自定义),以及 `PATH` 上的 Claude Code CLI(`claude`)——插件不负责安装。家族 core 与本包一起安装(`dsh plugin add` 只把**直接**依赖调和进 profile 的 bundles 层,所以一条命令里同时点名两个包):

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-claude-code
```

然后重启 profile——首次启动会 provisioning 作用域目录——并在会话里运行一次 `/claude-code login`。卸载:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-claude-code
```

移除 bundle 会注销 harness、其 `/claude-code` 命令族、工具行与 UI 行。作用域目录(`$DSH_HOME/local-agent/claude-code`)被刻意保留,重装后无需重新登录;删除它即可清除全部痕迹。

## 配置

bundle 行接受两个可选字段:

- `permissionMode`——`skip`(默认)给 `claude -p` 传 `--dangerously-skip-permissions`,子代理写文件无需交互审批;`normal` 不传,需审批的动作被拒绝(非交互模式下意味着产生文件的任务会失败)。
- `baseUrl`——为子 CLI 设置 `ANTHROPIC_BASE_URL`(例如自部署的模型路由器或 `https://proxy.example.com/anthropic` 这样的代理);缺省继承宿主进程环境。配置优先于环境。

**权限模式风险**:`skip` 授予子进程与运行 dsh 宿主的用户相同的文件系统触达——与 codex 不同,claude **没有 OS 级沙箱**,`skip` 子进程可以写用户能写的任何地方,包括委派工作区之外。`skip` 是可工作的默认,因为一次性 CLI 子代理没有审批面;当委派需要被限制时,改用 `normal`,或给宿主自身套沙箱(例如在沙箱化工作区内运行 dsh 宿主)。

**自定义端点注意**:宿主环境是启动时的快照——长驻的 dsh 进程在启动时捕获 `ANTHROPIC_BASE_URL`,之后在别的 shell 里 export 对运行中的进程无效,除非重启宿主;排查委派路由异常时,检查宿主的实际环境而非你当前的 shell。⚠️ 作用域登录的 OAuth token 会发送给处理请求的端点——`baseUrl` 只指向你控制或信任的地址。每次委派在 info 级别记录有效端点(`subagent-claude: delegating via <endpoint>`),失败运行的报错文本会点名它使用的端点。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.1-rc.1`):✅ 完整——rc.8→0.1.1-rc.1 API 审计(2026-08-21)确认本插件消费的所有面无变化或纯增量(ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包),无需改动源码。
- 源码线(deepseek-harness master):✅

## 已知限制

- **登录需要一次交互**——浏览器 OAuth URL 出现在会话中;只有用户在浏览器完成授权后凭据才会出现。
- **macOS logout 只删配置**——`/claude-code logout` 删除作用域 `.claude.json`;系统 keychain 条目(以作用域目录路径哈希为键)留给 CLI 自己的 `claude auth logout`,下次登录会重写同一槽位,残留条目无害。
- **Linux 凭据不隔离**(上游 bug #47661)——`CLAUDE_CONFIG_DIR` 不重定向凭据文件:claude 写作用域目录但读默认 `~/.claude/.credentials.json`,因此即使作用域目录没有凭据,委派也可能使用用户默认 home 的凭据。
- **交互会话记录可能缺失**——headless `-p` 运行会写 project 会话文件,但自定义 `CLAUDE_CONFIG_DIR` 下的交互会话可能不写转写(上游行为);records 列出 CLI 实际写出的内容。
- **headless 注意**——`/claude-code` 命令与标题栏下拉需要 Web 会话;`--profile headless` 仍可通过挂载工具行的组合进行委派。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

bundle patch 把 `claude-code` harness 注册进家族 core(`@khorsheed/dsh-local-agent`,声明为依赖——claude 包刻意不重复插入 core 行,重复会挂载两次),并挂载 `claude-local` 一次性 provider,后者在 harness 作用域目录下 spawn `claude -p --verbose --output-format stream-json`。

**作用域隔离。** macOS 上真实凭据在系统 keychain 的哈希条目里(`Claude Code-credentials-<sha256(configDir)[:8]>`,以作用域目录路径为键)——`/claude-code logout` 够不到它(logout 契约是文件删除),但下次登录会重写同一个哈希槽。Linux 上受上游 bug #47661 影响,`CLAUDE_CONFIG_DIR` **不隔离**凭据文件(见已知限制)。认证探测只做轻量文件检查——看作用域 `.claude.json` 的 `oauthAccount`,绝不为了探测而 spawn CLI。

**会话记录。** `/claude-code sessions` 列出作用域目录下的 `projects/<cwd-slug>/<uuid>.jsonl` 会话文件(Claude Code 自有的 append-only 会话日志)——即本 agent 委派产生的会话,绝不是用户的私人会话。目录 slug 是工作区路径的**有损**编码(分隔符转连字符,不同路径可能撞名),所以列出的 `workDir` 始终取自文件**内容**(第一条 `user` 事件的 `cwd` 字段),绝不取自目录名。家族 core 的浏览器设置分区呈现同一份列表并收窄到当前会话的工作区;`/claude-code sessions` 本身始终显示完整列表。

**续聊安全。** `subagent_claude_code_local` 工具是家族自有工具(`@khorsheed/dsh-local-agent-tool-subagent`)——官方子集(`description`/`prompt`)加上一个可选 `resume` 参数。句柄绝不进 prompt:它只从 `resume` 参数读取,localAgent registry 只对记录该委派的同一 parent 会话与 provider 解析句柄——伪造的句柄(未知子会话、他人 parent 的会话、或错误的 provider)在任何 CLI 进程启动前就被拒绝。descriptor 无法携带该目标(其 schema 拒绝未知字段),因此家族改经 `localAgent` 服务的委派 registry 传递。

**流镜像。** 委派以 `claude -p --verbose --output-format stream-json` 运行,dsh 子代理会话按顺序镜像事件流:`thinking` 块折叠为 `reasoning` 块、`tool_use`/`tool_result` 块为工具行(`[工具 Bash] <command> → output`)、回复 `text` 块为 assistant 文本;最终 assistant 文本作为运行输出,当轮用量挂在最后一条镜像的 assistant 消息上。续聊轮各自追加自己的 turn,不会重复。

**委派记账。** 子会话携带真实的用量与耗时:provider 在 CLI spawn 时开 `turn/start`、settle 时关 `turn/end`——失败或被取消也会关(reason `error`/`aborted`)——`subagentTiming` 投影的时长等于实际 CLI 运行时长,失败运行不会留下未闭合的耗时窗口。最终 `assistant/message` 携带从 JSON 结果解析的本回合 token 用量(`input_tokens`→未缓存输入、`output_tokens`→输出、`cache_read_input_tokens`→缓存读取、`cache_creation_input_tokens`→缓存写入——Anthropic 各桶独立上报,无需减法),`tokenUsage` 投影据此统计委派。

**模型体验。** Claude 子会话是委派 Session 工作区内一个全新的一次性 `claude -p` 进程,以作用域目录启动;父级只提交独立的任务文本,父级对话永不跨进程边界。经由家族工具,父级只看到选定的 Claude 最终回答或 Consumer 的精确错误,以及首次委派时的续聊自述——Claude 的评论、工具活动、工作区 diff 不会复制进父级 Session。子会话 token 永不进入父级上下文,子会话为独立的 Claude 上下文与回合付费(缓存复用只取决于作用域 Claude 安装自身的 provider、模型与历史),父级 KV cache 不受影响。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/local-agent-claude-code`)。问题与贡献请移步该仓库。
