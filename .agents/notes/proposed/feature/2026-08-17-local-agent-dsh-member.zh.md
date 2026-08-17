# Agent Note: local-agent 家族新增 dsh 成员（local-agent-dsh）

Status: proposed

[English](2026-08-17-local-agent-dsh-member.md) | 中文

## Problem

`@khorsheed/dsh-local-agent` 家族（kimi / codex / claude-code）缺少本引擎自身的成员：把 dsh 自己作为本地 CLI 委派出去。dsh 成员与其他三个同形（scoped home、会话记录、委派 provider、resume），同时复用父实例已有的 `DEEPSEEK_API_KEY`——不需要新的登录流程。浏览器设置区（Settings → 本地 Agent）需要一个互斥的 DeepSeek 开关：ON 注册 dsh provider 与委派工具（外部进程、自己的 `$DSH_HOME`、可指定 cwd、跨重启 resume）；OFF 不注册，委派继续走官方 in-process subagent（当前行为）。互斥是为了避免模型同时看到两个重叠的委派工具。

## Proposal

### 1. 带 resume 的家族 headless runner（替换官方 runner 行）

官方 `@deepseek-ai/dsh-headless` bundle 的 runner 是补丁插入的插件（`- id: headless-runner / name: '@deepseek-ai/dsh-headless'`，config: `task`）。家族 headless profile 复用官方 dsh-base 组合，但**禁用官方 runner 行并插入家族 runner**——与家族替换 tool-subagent 行完全相同的补丁替换机制。家族 runner 镜像官方逻辑（`agents.create` + `followup` + summarize + io.exit），两处不同：

- **会话 id 由 provider 提供，绝不从 stdout 解析**：首轮跑 `dsh --profile <family-headless> --session-id <uuid> "<task>"`，runner 把该 uuid 传给 `agents.create({ sessionId, ... })`；resume 跑 `dsh --profile <family-headless> --resume <uuid> "<task>"`，runner 调 `ctx.agents.resume({ resumeSessionId, agentOptions, setup })`（公开 API，官方 continuation 冷续路径已用）。官方 headless stdout 保持格式纯净——没有分隔符前缀，也不会把恰好长得像 id 的任务回答误解析成会话 id。这比 kimi/claude/codex 干净，它们都得从输出流里找回会话 id。
- **cwd 可指定**：官方 runner 用 `process.cwd()`；家族 runner 继承 provider spawn 的 cwd。

### 2. `local-agent-dsh` harness + `dsh-cli` provider

- Harness `name: 'dsh'`，scoped home `$DSH_HOME/local-agent/dsh`（子 dsh 自己的 `DSH_HOME`，会话存储就在其中——跨重启持久）。记录读取子 dsh 会话存储。`delegationProvider: 'dsh-cli'`。
- 无登录 UI/设备码：`isAuthenticated` = `ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))` 是否出值；`login` 省略。
- Provider spawn `dsh --profile <family-headless> [--session-id <uuid> | --resume <uuid>] "<task>"`，`spec.env` 显式含**两者**：
  - `DEEPSEEK_API_KEY`（从 `ctx.credentials` 解析；`scrubbedParentEnv` 因命中 `SENSITIVE_ENV_PATTERN` 会去掉它，而显式 env 层在 scrub 之后合并），
  - `DSH_HOME=<parent $DSH_HOME>/local-agent/dsh`（scrub 会去掉所有 `DSH_*` 名；不显式注入的话子 dsh 会落到默认 `~/.dsh`，把会话写进父实例的存储——子 dsh 会话悄悄混进父会话列表）。
- Spawn cwd = 父会话 cwd。
- Resume 走现有家族 resume 机制（intent FIFO、per-child 锁、per-round 记账）；`childSessionId → cliSessionId` 映射中 `cliSessionId` 即 provider 提供的 uuid。

### 3. local-agent core：`login` 变为可选

`LocalAgentHarness.login` 目前是必填（`handle()` 调 `this.login(harness)`，读 `harness.login.command`）。改为可选；登录分支对无 login 的 harness 报告"无登录流程"。`isAuthenticated` 已支持探测式检查（dsh harness 用它）。

### 4. 设置区互斥开关

设置区加一行 DeepSeek 开关。宿主侧用 `SettingsScope.watch()` 订阅：ON 注册 `DshCliProvider`（effect-scoped、可逆）+ 委派工具；OFF dispose 掉。官方 in-process subagent 工具属 base bundle，不在开关控制范围内——OFF 时自然只剩官方工具。默认 OFF = 当前行为。

## Alternatives considered

### 为什么 provider 提供会话 id 而不是解析 stdout？

解析 stdout 需要分隔符前缀，污染官方格式纯净的 headless stdout，且任务回答里恰好含 id 样字符串时会误判。`agents.create({ sessionId })` 本来就接受调用方提供的 id，provider 反正要持有这个 id 做 resume。解析引入三个失败模式、零收益。

### 为什么复用官方 headless 组合而不是自建最小 profile？

官方 base bundle 带着 in-process 委派工具（`tool-subagent` spawn/continuable、`tool-subagent-fork` 一次性、`tool-subagent-control` send_message/interrupt、`list-agents`）。这是特性而非风险——让 dsh 的子 agent 能力与 claude 的 Task 工具对等。真正的安全边界是**base 不含 local-agent 家族**：进程递归的 dsh→dsh→dsh 需要家族自己的 profile 增补才会出现，而 in-process 委派不 spawn 新进程（env 不会传给孙进程）。base 的 subagent 行保留官方默认 `maxDepth`；家族 profile 原样用官方组合。

## Acceptance criteria

- 首轮：`dsh --profile <family-headless> --session-id <uuid> "task"` 用该确切 id 建会话、打印最终回答、退出。Resume：`--resume <uuid> "follow-up"` 续同一会话并打印回答。
- 重启父 profile 后 resume 一条 dsh 委派：映射经 scoped-home 文件存活，父会话归属校验仍拒绝伪造的跨会话句柄，续聊轮追加进同一个 dsh 子会话。
- 子 dsh 以 `DSH_HOME=$DSH_HOME/local-agent/dsh` 和 `DEEPSEEK_API_KEY` 运行；其会话从不出现于父实例会话列表。
- 设置开关：ON 注册 dsh 工具，OFF dispose，默认 OFF；模型不会同时看到 dsh 工具与官方 subagent 工具。

## Risks

- `agents.resume` 在此组合中未经实证，直到真正跑通（`setup` 里的模型选择必须与 `agents.create` 同样接线）。写 provider 前先手动 nonce 验证：`--session-id <uuid> "记住口令 X"` 再 `--resume <uuid> "刚才的口令是什么"`。
- 家族 headless profile 绝不加入 local-agent 家族 bundle——那会重新打开 base 边界关掉的进程递归嵌套。
- 凭证传播：key 显式进入子 dsh env；子 dsh LLM 层消费同一 ref（预期如此），家族 profile 不得装会向孙进程转发 env 的委派工具。
