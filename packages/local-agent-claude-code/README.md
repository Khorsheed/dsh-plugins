# `@khorsheed/dsh-local-agent-claude-code`

[English](README.en.md) | 中文

把编码任务委派给本地安装的 Claude Code,任意 dsh agent preset 都能用——答案实时流回,你的个人 `~/.claude` 绝不被动到。[local-agent 家族](../local-agent/README.md) 的 Claude Code harness。

## 特性

- **任意 preset 都能委派**——工具只在 profile 根挂载一次,无需逐 preset 变体。
- **作用域隔离**——每个 Claude 进程都以 `$DSH_HOME/local-agent/claude-code` 为 `CLAUDE_CONFIG_DIR` 运行;你的个人 `~/.claude` 置身事外。
- **一条命令完成登录指引**——`/claude-code login` 在会话中给出需要在你自己终端运行的完整命令(claude ≥2.1 只在 TTY 打印 OAuth URL,宿主不再 spawn 抓取),并监听作用域目录识别登录完成;`sessions`/`status`/`logout` 与 设置 → 本地 Agent 面板构成完整一族。
- **续聊委派**——把结果自述的 `resume` 句柄传回,即可继续同一个 Claude 会话,并按轮记账。
- **实时流镜像**——子会话实时镜像 Claude 的思考、工具调用与回复;中止会保留部分转写与真实 token 用量。

## 安装

前置依赖:一个可运行的 dsh profile,以及 `PATH` 上的 Claude Code CLI(`claude`)——插件不负责安装。家族 core 与本包一起安装(`dsh plugin add` 只调和**直接**依赖,所以两个包都点名):

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-claude-code
```

重启 profile,然后在会话里运行一次 `/claude-code login`。卸载:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-claude-code
```

作用域目录在卸载时刻意保留,重装无需重新登录;删除 `$DSH_HOME/local-agent/claude-code` 即可清除全部痕迹。

## 配置

bundle 行接受两个可选字段:

- `permissionMode`——`skip`(默认)传 `--dangerously-skip-permissions`,子代理写文件无需审批;`normal` 不传,需审批的动作(如写文件)被拒绝。
- `baseUrl`——为子 CLI 设置 `ANTHROPIC_BASE_URL`(例如自部署路由器或代理);缺省继承宿主进程环境。配置优先于环境。

⚠️ `skip` 没有 OS 级沙箱——子进程可以写宿主用户能写的任何地方,包括工作区之外;作用域登录的 OAuth token 会发送给 `baseUrl` 指向的端点。委派需要限制时改用 `normal`;`baseUrl` 只指向你信任的地址。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.1-rc.1`):✅ 完整——rc.8→0.1.1-rc.1 API 审计(2026-08-21)确认本插件消费的所有面无变化或纯增量(ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包),无需改动源码。
- 源码线(deepseek-harness master):✅

## 已知限制

- **macOS logout 只删配置**——keychain 条目留给 CLI 自己的 `claude auth logout`;下次登录会重写同一槽位,残留无害。
- **Linux 凭据不隔离**(上游 bug #47661)——即使作用域目录没有凭据,claude 也会读默认 `~/.claude/.credentials.json`。
- **交互会话记录可能缺失**——自定义 `CLAUDE_CONFIG_DIR` 下 CLI 可能不写转写(上游行为)。
- **headless 注意**——`/claude-code` 命令需要 Web 会话;`--profile headless` 可通过挂载工具行的组合委派。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

```
src/index.ts                harness 注册、/claude-code 命令族、config schema
src/claude-cli-provider.ts  一次性 provider:spawn、流镜像、turn/token 记账
src/provision.ts            作用域目录 provisioning 与基于文件的 logout
src/records.ts              认证探测与作用域目录的会话记录列表
```

bundle patch 把 `claude-code` harness 注册进家族 core(`@khorsheed/dsh-local-agent`,声明为依赖——claude 包刻意不重复插入 core 行,重复会挂载两次),并挂载 `claude-local` provider,后者在 harness 作用域目录下 spawn `claude -p --verbose --output-format stream-json`。`subagent_claude_code_local` 工具是家族自有工具(`@khorsheed/dsh-local-agent-tool-subagent`):官方子集(`description`/`prompt`)加一个可选 `resume` 参数。

**作用域隔离。** macOS 上真实凭据在系统 keychain 的哈希条目里(`Claude Code-credentials-<sha256(configDir)[:8]>`,以作用域目录路径为键)——基于文件的 logout 够不到它,但下次登录会重写同一个槽位。Linux 上受上游 bug #47661 影响,`CLAUDE_CONFIG_DIR` 不隔离凭据文件(见已知限制)。认证探测只做轻量文件检查——看作用域 `.claude.json` 的 `oauthAccount`,绝不为了探测而 spawn CLI。

**会话记录。** `/claude-code sessions` 列出作用域目录下的 `projects/<cwd-slug>/<uuid>.jsonl` 会话文件——即本 agent 的委派,绝不是你的私人会话。slug 是工作区路径的有损编码,所以列出的 `workDir` 取自文件内容(第一条 `user` 事件的 `cwd` 字段),绝不取自目录名。设置面板呈现同一份列表并收窄到当前工作区。

**续聊安全。** 句柄绝不进 prompt:它只从 `resume` 参数读取,localAgent registry 只对记录该委派的同一 parent 会话与 provider 解析句柄——伪造的句柄(未知子会话、他人 parent 的会话、或错误的 provider)在任何 CLI 进程启动前就被拒绝。

**流镜像与记账。** `thinking` 块折叠为 `reasoning` 块、`tool_use`/`tool_result` 为工具行(`[工具 Bash] <command> → output`)、回复 `text` 为 assistant 文本;续聊轮各自追加自己的 turn,不会重复。provider 在 spawn 时开 `turn/start`、settle 时关 `turn/end`——失败与被取消同样关闭——因此 `subagentTiming` 时长等于实际 CLI 运行时长,不会留下未闭合窗口;最终 `assistant/message` 携带从 JSON 结果解析的 token 用量(`input_tokens`、`output_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`——Anthropic 各桶独立上报)。

**模型体验。** 子会话是委派会话工作区内一个全新的一次性 `claude -p`;父级只提交独立的任务文本,只看到最终回答或精确错误,以及首次委派时的续聊自述——Claude 的评论、工具活动、工作区 diff 不会复制进父级。子会话 token 永不进入父级上下文;子会话为独立的 Claude 上下文与回合付费(缓存复用只取决于作用域安装自身的 provider、模型与历史);父级 KV cache 不受影响。

**配置注意。** 宿主环境是启动时的快照——之后在别的 shell 里 `export ANTHROPIC_BASE_URL` 对运行中的进程无效,除非重启宿主;排查路由异常时检查宿主的实际环境而非你当前的 shell。每次委派在 info 级别记录有效端点(`subagent-claude: delegating via <endpoint>`),失败运行的报错文本会点名它。`skip` 作为默认是因为一次性 CLI 子代理没有审批面;委派需要被限制时,给宿主自身套沙箱(例如在沙箱化工作区内运行 dsh 宿主)。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/local-agent-claude-code`)。问题与贡献请移步该仓库。
