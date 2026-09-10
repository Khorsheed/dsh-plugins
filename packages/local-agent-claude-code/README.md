# `@khorsheed/dsh-local-agent-claude-code`

[English](README.en.md) | 中文

把编码任务委派给本地安装的 Claude Code,任意 dsh agent preset 都能用——答案实时流回,你的个人 `~/.claude` 绝不被动到。[local-agent 家族](../local-agent/README.md) 的 Claude Code harness。

## 特性

- **任意 preset 都能委派**——工具只在 profile 根挂载一次,无需逐 preset 变体。
- **作用域隔离**——每个 Claude 进程都以 `$DSH_HOME/local-agent/claude-code` 为 `CLAUDE_CONFIG_DIR` 运行;你的个人 `~/.claude` 置身事外。
- **一条命令完成登录指引**——`/claude-code login` 在会话中给出需要在你自己终端运行的完整命令(claude ≥2.1 只在 TTY 打印 OAuth URL,宿主不再 spawn 抓取),并监听作用域目录识别登录完成;`sessions`/`status`/`logout` 与 设置 → 本地 Agent 面板构成完整一族。
- **续聊委派**——把结果自述的 `resume` 句柄传回,即可继续同一个 Claude 会话,并按轮记账。
- **实时流镜像**——子会话实时镜像 Claude 的思考、工具调用与回复;中止会保留部分转写与真实 token 用量。
- **模型回读与独立工作目录**——每轮从 stream-json 的 system/init 回读实际模型，写进委派记录；编排器可用 `cwd` 选项给每格独立目录，resume 换目录即拒绝。
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

bundle 行接受这些可选字段:

- `permissionMode`——`skip`(默认)传 `--dangerously-skip-permissions`,子代理写文件无需审批;`normal` 不传,需审批的动作(如写文件)被拒绝。
- `model`——每轮委派以它起 CLI(`claude -p --model <模型>`);不写就一个模型参数都不传。见下。
- `baseUrl`——为子 CLI 设置 `ANTHROPIC_BASE_URL`(例如自部署路由器或代理);缺省继承宿主进程环境。配置优先于环境。
- `live`——长驻驱动:每成员常驻一个 stream-json 进程(`--input-format stream-json`),按轮发 stdin 消息(runtime 级优雅中断 control interrupt、同形推送流);关闭或通道不可用即回一次性 `claude -p`。
- `liveIdleMs`——长驻 runtime 空闲回收时限(默认 30 分钟)。
- `liveMirrorGranularity`——live 镜像粒度(默认 `event`);`token` 仍以 `--include-partial-messages` 拉起并经运行进度通道实时上报增量,但宿主 0.1.5 移除了逐 chunk 会话事件,增量不再写入子会话日志,轮次以一条合并消息落定(最终文本不变)。

### 默认模型（`model`）

**不写 = 今天的表现。**没有这个键时，本插件在 argv 上一个模型参数都不加：跑哪个模型由作用域 `settings.json` 的 `model` 决定，它也没有时由 claude 自己的默认决定（本插件从不猜它是什么）。

**写了 = 每轮委派以它起 CLI。**新起一轮与续接（resume）、一次性与常驻（`live: true`）四种 argv 都带上 `--model <模型>`，位置在成员通道的 `--allowedTools …--` 之前——那个旗标是变长的，`--` 之后就是任务文本。

作用域 `settings.json` 不会被改写——`--model` 每轮覆盖它，文件仍是你编辑的样子。

设置卡「默认模型」写的是同一个键：一个自由输入框（不内置任何模型目录）加上此前存过的值作为候选，保存即生效于**下一轮**委派，进行中的轮次不受影响，不需要重载。清空后保存即取消该键，回到 YAML 组合基线、进而回到上面的「不写」。

**委派级的模型优先。**编排器可以经门面 `DelegationCallOptions.model` 给**某一次委派**点名模型，它排在这个键之前（顺序见家族核心 README 的四层）。首轮请求的值记进委派记录，resume 轮照它重发——resume 不接受 model 参数。带委派级 model 的轮次是 exec-only；这个插件配置键不受此限。

**这不是评测的缺口。**评测 run 的条件在建立时冻结：run 跑到一半改这个键，下一轮的模型回读会发现声明模型 ≠ 实测模型，run 直接判为 misattributed 而失败（冻结决策 5）。「切了新 run 照新走、进行中的 run 不被悄悄换掉」是设计出来的，不是漏掉的。

⚠️ `skip` 没有 OS 级沙箱——子进程可以写宿主用户能写的任何地方,包括工作区之外;作用域登录的 OAuth token 会发送给 `baseUrl` 指向的端点。委派需要限制时改用 `normal`;`baseUrl` 只指向你信任的地址。

**评测快照（effectiveSettings）。** 本 harness 向注册表声明一份实时读取的公平性设置快照，供评测条件哈希使用：drive(exec/live)、permissionMode(skip/normal,插件配置)、端点是否固定(按 provider 的解析顺序——配置项优先于宿主进程环境的 `ANTHROPIC_BASE_URL`,只报主机名)、已配置模型(先看插件配置的 `model` 键——它每轮覆盖文件;没有才读作用域 `settings.json` 的 `model`;CLI 自身的默认模型由 CLI 决定,绝不猜值,都没有就不给字段)、CLI 版本(`claude --version`,按可执行文件路径+mtime 缓存;探测不到即字段缺位)。`/claude-code status` 与 `LocalAgentStatus` Remote 附带同一份快照。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：⚠️ 降级一处——`liveMirrorGranularity: token` 不再逐字写入子会话日志（宿主移除逐 chunk 事件），增量改走运行进度通道、轮次以一条合并消息落定（最终文本不变）；其余完整（适配 format v2/v3 与 handle 制 sessionPersistence，全量构建测试通过）；minHost 前移至 0.1.5-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）

## 已知限制

- **macOS logout 只删配置**——keychain 条目留给 CLI 自己的 `claude auth logout`;下次登录会重写同一槽位,残留无害。
- **Linux 凭据不隔离**(上游 bug #47661)——即使作用域目录没有凭据,claude 也会读默认 `~/.claude/.credentials.json`。
- **交互会话记录可能缺失**——自定义 `CLAUDE_CONFIG_DIR` 下 CLI 可能不写转写(上游行为)。
- **headless 注意**——`/claude-code` 命令需要 Web 会话;`--profile headless` 可通过挂载工具行的组合委派。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**模型回读与 cwd 覆盖。** 每轮 settle 后，provider 把 stream-json `system`（init）事件 `model` 字段里的实际模型（如 `claude-opus-5[1m]`，原样回读，上下文变体后缀照留）随 `settled` 进度事件上报，并合并进 `delegations.jsonl` 的 `observedModel` 字段；取不到即缺位，绝不猜测。编排器还可以经门面 `DelegationCallOptions.cwd` 给本轮指定工作目录（记录进 `cwd` 字段）；resume 轮解析出的目录若与首轮记录不一致，进程启动前即 fail loud——CLI 会话延续的是首轮所在目录的上下文。

**工具调用计数。** 每轮 settle 时，provider 顺带数出本轮的工具调用，随 `settled` 进度事件上报（`toolCalls: { count, byName }`）。计数就在流解析**已经走过**的 `tool_use` 分支里，`byName` 的键是该块自己的 `name`（`Bash`、`Read`、`TodoWrite`，MCP 工具则是 `mcp__server__tool` 全名），原样保留、不跨家归一。`TodoWrite` 也计——折叠逻辑把它挪去了 todo 快照、不进 transcript，但 CLI 确实调了它。本轮一份，绝不累计；一次都没调用就整个字段缺位（缺席 ≠ 0）。实测：一轮「先 Read 两个文件再 Bash 列目录」回读 `{count: 3, byName: {Read: 2, Bash: 1}}`，与镜像出的工具卡片逐个对得上。

**命名 scope。** `/claude-code login --scope <名>` 在 `<homesRoot>/claude-code@<名>` 里另开一份 `CLAUDE_CONFIG_DIR`：登录的 argv 由**被登录的那份目录**现算（`env CLAUDE_CONFIG_DIR=… claude auth login` 的赋值压过 spawn env，写死缺省目录会让 `--scope` 登错地方）。claude 的 keychain 项按配置目录路径哈希，命名 scope 因此自动拿到自己的 keychain 项——四家里唯一天然按路径隔离的凭据。带 scope 的委派用该目录跑 `claude -p`、按它做 keychain→文件同步、从它回读；只走 exec。

**容器内委派。** 编排器可以经门面 `DelegationCallOptions.exec`（`{ container, workdir, env? }`）让本轮跑在一个**已取得的容器**里：argv 变成 `docker exec -w <workdir> [-e NAME…] <container> claude -p …`，其余（stream-json 解析、settle、记录）逐字节不变。`env` 必须给出容器内的 `CLAUDE_CONFIG_DIR`；Linux 上 claude **写作用域目录但读默认 home**（上游 #47661），所以通常把宿主作用域目录 rw bind 到容器里的默认 home，再让 `CLAUDE_CONFIG_DIR` 指向同一处。每次 spawn 前的 keychain→文件同步照常在**宿主**作用域目录上跑，续期结果因此经挂载对容器可见。容器轮固定走 exec 一次性驱动，且不声明成员桥。**注意作用域 `settings.json` 里的宿主专用项**：实测那里给宿主守护进程用的 `https_proxy` 在容器内指向不存在的地址，本轮当场 `Connection refused`——挂进去的目录要由调用方备好。

```
src/index.ts                harness 注册、/claude-code 命令族、config schema
src/claude-cli-provider.ts  一次性 provider:spawn、流镜像、turn/token 记账
src/provision.ts            作用域目录 provisioning 与基于文件的 logout
src/records.ts              认证探测与作用域目录的会话记录列表
```

bundle patch 把 `claude-code` harness 注册进家族 core(`@khorsheed/dsh-local-agent`,声明为依赖——claude 包刻意不重复插入 core 行,重复会挂载两次),并挂载 `claude-local` provider,后者在 harness 作用域目录下 spawn `claude -p --verbose --output-format stream-json`。`subagent_claude_code` 工具是家族自有工具(`@khorsheed/dsh-local-agent-tool-subagent`):官方子集(`description`/`prompt`)加一个可选 `resume` 参数。

**作用域隔离。** macOS 上真实凭据在系统 keychain 的哈希条目里(`Claude Code-credentials-<sha256(configDir)[:8]>`,以作用域目录路径为键)——基于文件的 logout 够不到它,但下次登录会重写同一个槽位。Linux 上受上游 bug #47661 影响,`CLAUDE_CONFIG_DIR` 不隔离凭据文件(见已知限制)。认证探测只做轻量文件检查——看作用域 `.claude.json` 的 `oauthAccount`,绝不为了探测而 spawn CLI。

**会话记录。** `/claude-code sessions` 列出作用域目录下的 `projects/<cwd-slug>/<uuid>.jsonl` 会话文件——即本 agent 的委派,绝不是你的私人会话。slug 是工作区路径的有损编码,所以列出的 `workDir` 取自文件内容(第一条 `user` 事件的 `cwd` 字段),绝不取自目录名。设置面板呈现同一份列表并收窄到当前工作区。

**续聊安全。** 句柄绝不进 prompt:它只从 `resume` 参数读取,localAgent registry 只对记录该委派的同一 parent 会话与 provider 解析句柄——伪造的句柄(未知子会话、他人 parent 的会话、或错误的 provider)在任何 CLI 进程启动前就被拒绝。

**流镜像与记账。** `thinking` 块折叠为 `reasoning` 块、`tool_use`/`tool_result` 为工具行(`[工具 Bash] <command> → output`)、回复 `text` 为 assistant 文本;续聊轮各自追加自己的 turn,不会重复。provider 在 spawn 时开 `turn/start`、settle 时关 `turn/end`——失败与被取消同样关闭——因此 `subagentTiming` 时长等于实际 CLI 运行时长,不会留下未闭合窗口;最终 `assistant/message` 携带从 JSON 结果解析的 token 用量(`input_tokens`、`output_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`——Anthropic 各桶独立上报)。

**模型体验。** 子会话是委派会话工作区内一个全新的一次性 `claude -p`;父级只提交独立的任务文本,只看到最终回答或精确错误,以及首次委派时的续聊自述——Claude 的评论、工具活动、工作区 diff 不会复制进父级。子会话 token 永不进入父级上下文;子会话为独立的 Claude 上下文与回合付费(缓存复用只取决于作用域安装自身的 provider、模型与历史);父级 KV cache 不受影响。

**长驻驱动(`live: true`)。** 替代每轮 spawn:成员首轮委派拉起一个常驻 stream-json 进程(`claude -p --verbose --input-format stream-json --output-format stream-json`),第一条 stdin `user` 消息触发 `system/init`(server 分配 session id,即委派记录的 `cliSessionId`),之后每轮 = 一条 stdin 消息;事件流与 exec 的 stream-json **完全同形**,逐轮过同一个 `ClaudeStreamParser` 折叠(末行留置到 `result` 挂用量,与 exec 一致),`cancel` 落地为 `control_request interrupt`——进程不死、会话可续。回收阶梯是 stdin EOF → SIGTERM;崩溃后下一轮以 `--resume <session_id>` 重挂盘上会话。授权纪律与 exec 逐字一致:只注入作用域 `CLAUDE_CONFIG_DIR`(与可选的 `baseUrl` 覆盖),绝不碰全局 `~/.claude`,绝不执行任何 `auth` 命令。

**配置注意。** 宿主环境是启动时的快照——之后在别的 shell 里 `export ANTHROPIC_BASE_URL` 对运行中的进程无效,除非重启宿主;排查路由异常时检查宿主的实际环境而非你当前的 shell。每次委派在 info 级别记录有效端点(`subagent-claude: delegating via <endpoint>`),失败运行的报错文本会点名它。`skip` 作为默认是因为一次性 CLI 子代理没有审批面;委派需要被限制时,给宿主自身套沙箱(例如在沙箱化工作区内运行 dsh 宿主)。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/local-agent-claude-code`)。问题与贡献请移步该仓库。
