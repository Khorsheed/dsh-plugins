# @khorsheed/dsh-local-agent-claude-code

[English](README.en.md) | 中文

把编码任务委派给本机的 Claude Code——思考、工具调用与回复实时流回，你的私人 `~/.claude` 分文不动。

任意 dsh agent preset 都能发起委派：家族工具在 profile 根只挂一次，子会话全程可见、可中止、可续聊，每轮的账目（实际模型、token 用量、工具调用数）都真实回读。登录是作用域隔离的——插件只管理 `$DSH_HOME/local-agent/claude-code` 这一份目录，你的个人安装与凭据自始至终置身事外。[local-agent 家族](../local-agent/README.md) 的 Claude Code harness。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/08-local-agent.png" width="640" alt="设置 → 插件 → 插件配置里的 Local Agent 家族卡片，Claude Code 一行的状态点显示授权状态">

## 特性

- **任意 preset 都能委派**——工具只在 profile 根挂载一次，无需逐 preset 变体。
- **作用域隔离**——每个 Claude 进程都以 `$DSH_HOME/local-agent/claude-code` 为 `CLAUDE_CONFIG_DIR` 运行；你的个人 `~/.claude` 置身事外。
- **一条命令完成登录指引**——`/claude-code login` 在会话中给出需要在你自己终端运行的完整命令（claude ≥2.1 只在 TTY 打印 OAuth URL，宿主不再 spawn 抓取），并监听作用域目录识别登录完成；`sessions`/`status`/`logout` 与 设置 → 本地 Agent 面板构成完整一族。
- **续聊委派**——把结果自述的 `resume` 句柄传回，即可继续同一个 Claude 会话，并按轮记账。
- **实时流镜像**——子会话实时镜像 Claude 的思考、工具调用与回复；中止会保留部分转写与真实 token 用量。
- **模型回读与独立工作目录**——每轮从 stream-json 的 system/init 回读实际模型，写进委派记录；编排器可用 `cwd` 选项给每格独立目录，resume 换目录即拒绝。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-claude-code-card.png" width="640" alt="展开的「Local Agent · Claude Code」设置卡：认证块、默认模型选择与常驻模式（live）开关">

## 安装

前置依赖：一个可运行的 dsh profile，以及 `PATH` 上的 Claude Code CLI（`claude`）——插件不负责安装。家族 core 与本包一起安装（`dsh plugin add` 只调和**直接**依赖，所以两个包都点名）：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-claude-code
```

重启 web 实例后生效，然后在会话里运行一次 `/claude-code login`。卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-claude-code
```

作用域目录在卸载时刻意保留，重装无需重新登录；删除 `$DSH_HOME/local-agent/claude-code` 即可清除全部痕迹。

## 配置

bundle 行接受这些可选字段：

- `permissionMode`——`skip`（默认）传 `--dangerously-skip-permissions`，子代理写文件无需审批；`normal` 不传，需审批的动作（如写文件）被拒绝。
- `model`——每轮委派以它起 CLI（`claude -p --model <模型>`）；不写就一个模型参数都不传。见下。
- `baseUrl`——为子 CLI 设置 `ANTHROPIC_BASE_URL`（例如自部署路由器或代理）；缺省继承宿主进程环境。配置优先于环境。
- `proxyUrl`——子 CLI 自身流量（模型调用与 OAuth 续期）的 HTTP 代理，provision 进作用域 `settings.json` 的 env 块；宿主进程环境不带代理时（例如 supervisor 拉起的实例不继承 shell export）用这项。
- `live`——长驻驱动：每成员常驻一个 stream-json 进程（`--input-format stream-json`），按轮发 stdin 消息（runtime 级优雅中断 control interrupt、同形推送流）；关闭或通道不可用即回一次性 `claude -p`。
- `liveIdleMs`——长驻 runtime 空闲回收时限（默认 30 分钟）。

> **迁移说明**——live 轮次统一消费增量输出；旧 `liveMirrorGranularity: event | token` 配置键继续兼容读取，但不再影响行为，也不会改变运行中的进程。评测继续保留 exec；最终内容仍以 provider 完成项为准，包括工具记录和用量。

### 默认模型（`model`）

**不写 = 今天的表现。** 没有这个键时，本插件在 argv 上一个模型参数都不加：跑哪个模型由作用域 `settings.json` 的 `model` 决定，它也没有时由 claude 自己的默认决定（本插件从不猜它是什么）。

**写了 = 每轮委派以它起 CLI。** 新起一轮与续接（resume）、一次性与常驻（`live: true`）四种 argv 都带上 `--model <模型>`，位置在成员通道的 `--allowedTools …--` 之前——那个旗标是变长的，`--` 之后就是任务文本。

一次性（exec）轮不改写作用域 `settings.json`——`--model` 每轮覆盖它，文件仍是你编辑的样子。常驻（live）spawn 会把成员的生效模型暂写进该文件（`--resume` 重挂时 CLI 认文件里的模型而不认 `--model` 旗标），绑定空模型的 spawn 前再还原；状态页与设置卡读到的「CLI 配置」层永远是你自己配的值，不会读到某个成员留下的暂写。

设置卡「默认模型」修改后续轮次使用的 provider 配置。共享选择器展示当前作用域的模型目录、发现来源和完整性，并保留按需填写模型 ID 的入口。清空选择后跟随有效配置及默认值链。保存不会打断当前轮次，也无需重载；共享选择器不可用时，卡片保留文本输入兜底。成员级模型和推理强度修改使用下文的持久控制面。

模型读面现已读取 Claude 原生 `initialize` 目录，保留选择别名、显示名、解析名称和支持的 effort 值。目录共用 core 缓存和刷新订阅，刷新失败保留成功数据，并独立标识历史建议。此 scoped 控制查询不发送用户任务、不写模型设置。旧 CLI 缺少目录时显示不支持；原生候选不证明账号权限。共用模型菜单和成员 effort 控制已接入。运行中选择排到下一完整轮次（含工具续跑）；core 统一持有当前/待生效配置、撤销与重试，冻结评测成员禁止变更。

**委派级的模型优先。** 编排器可以经门面 `DelegationCallOptions.model` 给**某一次委派**点名模型，它排在这个键之前（顺序见家族核心 README 的层序）。首轮请求的值记进委派记录，resume 轮照它重发——resume 不接受 model 参数。常驻模式下，首轮点名的模型作为该成员的起始模型在 runtime spawn 时绑定：已绑定不同模型的 runtime 先退役，同一个 CLI 会话经 `--resume` 在新进程上续起。

**成员会话级切换。** 成员会话的 composer 模型选择器经家族网关 `setMemberModel` 写入一个**会话级覆盖**——它排在委派模型与这个键之前，只存内存、刻意不跨宿主重启、也不写进设置。切换进行中轮次的成员会被拒绝；live 下换到不同模型会退役该成员的常驻 runtime，下一轮以新模型重挂**同一个** CLI 会话（对话不丢），换成相同模型则什么都不发生。

**这不是评测的缺口。** 评测 run 的条件在建立时冻结：run 跑到一半改这个键，下一轮的模型回读会发现声明模型 ≠ 实测模型，run 直接判为 misattributed 而失败（冻结决策 5）。「切了新 run 照新走、进行中的 run 不被悄悄换掉」是设计出来的，不是漏掉的。

⚠️ `skip` 没有 OS 级沙箱——子进程可以写宿主用户能写的任何地方，包括工作区之外；作用域登录的 OAuth token 会发送给 `baseUrl` 指向的端点。委派需要限制时改用 `normal`；`baseUrl` 只指向你信任的地址。

**评测快照（effectiveSettings）。** 本 harness 向注册表声明一份实时读取的公平性设置快照，供评测条件哈希使用：drive（exec/live）、permissionMode（skip/normal，插件配置）、端点是否固定（按 provider 的解析顺序——配置项优先于宿主进程环境的 `ANTHROPIC_BASE_URL`，只报主机名）、已配置模型（先看插件配置的 `model` 键——它每轮覆盖文件；没有才读作用域 `settings.json` 的 `model`；CLI 自身的默认模型由 CLI 决定，绝不猜值，都没有就不给字段）、CLI 版本（`claude --version`，按可执行文件路径+mtime 缓存；探测不到即字段缺位）。`/claude-code status` 与 `LocalAgentStatus` Remote 附带同一份快照。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 公开 API 兼容。生成中的内容走 local-agent 瞬时 Remote 与公开 Conversation 节点；增量耐久恢复检查点负责落盘，最终原生消息保留转写与用量语义。浏览器 P95 验收由 room 协调者提案跟踪。minHost 0.1.5-rc.1——更旧宿主请停留在前一发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）

## 已知限制

- **macOS logout 只删配置**——keychain 条目留给 CLI 自己的 `claude auth logout`；下次登录会重写同一槽位，残留无害。
- **同一次授权不能被宿主轮与容器轮共用**——macOS 上两者用的是不同存储，任一侧轮换都会作废另一侧的 token family。容器化的条件用自己的命名 scope，见「容器内委派」。
- **Linux 凭据不隔离**（上游 bug #47661）——即使作用域目录没有凭据，claude 也会读默认 `~/.claude/.credentials.json`。
- **交互会话记录可能缺失**——自定义 `CLAUDE_CONFIG_DIR` 下 CLI 可能不写转写（上游行为）。
- **headless 注意**——`/claude-code` 命令需要 Web 会话；`--profile headless` 可通过挂载工具行的组合委派。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**模型回读与 cwd 覆盖。** 每轮 settle 后，provider 把 stream-json `system`（init）事件 `model` 字段里的实际模型（如 `claude-opus-5[1m]`，原样回读，上下文变体后缀照留）随 `settled` 进度事件上报，并合并进 `delegations.jsonl` 的 `observedModel` 字段；取不到即缺位，绝不猜测。当任何一层、任何记录都没有模型时，「默认」面的最近观测提示读成员**自己的**转录（`projects/<cwd-slug>/<sessionId>.jsonl`；无成员面读全树最新的那份）——这是为 settle 通道之前的旧轮次准备的历史兜底；只读，绝不回写 `delegations.jsonl`。编排器还可以经门面 `DelegationCallOptions.cwd` 给本轮指定工作目录（记录进 `cwd` 字段）；resume 轮解析出的目录若与首轮记录不一致，进程启动前即 fail loud——CLI 会话延续的是首轮所在目录的上下文。

**工具调用计数。** 每轮 settle 时，provider 顺带数出本轮的工具调用，随 `settled` 进度事件上报（`toolCalls: { count, byName }`）。计数就在流解析**已经走过**的 `tool_use` 分支里，`byName` 的键是该块自己的 `name`（`Bash`、`Read`、`TodoWrite`，MCP 工具则是 `mcp__server__tool` 全名），原样保留、不跨家归一。`TodoWrite` 也计——折叠逻辑把它挪去了 todo 快照、不进 transcript，但 CLI 确实调了它。本轮一份，绝不累计；一次都没调用就整个字段缺位（缺席 ≠ 0）。实测：一轮「先 Read 两个文件再 Bash 列目录」回读 `{count: 3, byName: {Read: 2, Bash: 1}}`，与镜像出的工具卡片逐个对得上。

**命名 scope。** `/claude-code login --scope <名>` 在 `<homesRoot>/claude-code@<名>` 里另开一份 `CLAUDE_CONFIG_DIR`：登录的 argv 由**被登录的那份目录**现算（`env CLAUDE_CONFIG_DIR=… claude auth login` 的赋值压过 spawn env，写死缺省目录会让 `--scope` 登错地方）。claude 的 keychain 项按配置目录路径哈希，命名 scope 因此自动拿到自己的 keychain 项——四家里唯一天然按路径隔离的凭据。带 scope 的委派用该目录跑 `claude -p`、按它做 keychain↔文件协调、从它回读；只走 exec。

**容器内委派。** 编排器可以经门面 `DelegationCallOptions.exec`（`{ container, workdir, env? }`）让本轮跑在一个**已取得的容器**里：argv 变成 `docker exec -w <workdir> [-e NAME…] <container> claude -p …`，其余（stream-json 解析、settle、记录）逐字节不变。`env` 必须给出容器内的 `CLAUDE_CONFIG_DIR`，调用方把宿主作用域目录 rw bind 到那条路径上。实测评测镜像里的 claude 2.1.272：容器内的 CLI **读写 `<CLAUDE_CONFIG_DIR>/.credentials.json`**，它整棵状态树（`projects/`、`sessions/` 等）也落在那里；上游 #47661 那种「Linux 写作用域目录、读默认 home」的老行为不描述这个版本。每次 spawn 前的凭据协调照常在**宿主**作用域目录上跑，续期结果因此经挂载对容器可见——而且它是**新者胜，不是单向镜像**，因为单元是同一个文件的**第二个写者**。单元里的 CLI 没有 keychain，只能在挂进去的文件里就地轮换凭证；此时若无条件地把 keychain 盖到文件上，下一轮拿到的就是单元已经用掉的 refresh token，端点拒绝，CLI 随即**清空该文件**——整台实例随之登出，因为那个文件就是实例的凭据。所以协调只在 keychain 那份不比文件旧时才写（以 access token 过期时间为准；任一侧没有过期时间就仍由 keychain 写，不可用的文件永远不会赢）。挂载保持读写还有第二个理由：本轮的会话记录落在同一目录的 `projects/` 下，评测的模型回读正是从这条挂载的宿主侧解析它们。容器轮固定走 exec 一次性驱动，且不声明成员桥。

**容器轮必须用自己的 scope，这条纪律不是可选项。** claude 是这几家里唯一有两个凭据存储的，而实测 macOS 2.1.274 它们并没有同一个读者：**宿主 CLI 读写 keychain**，而单元里的 CLI——Linux、没有 keychain——读写挂进去的文件。同一次授权被两个存储各续一次，就是被续了两次；服务端轮换一次性 refresh token 的做法是把整个 **token family 作废**，于是没有最后续到的那一侧手里就是一个死 token。端到端实测过：容器轮轮换了文件，紧接着的宿主轮报 `OAuth session expired and could not be refreshed`，而文件自己的 access token 离过期还有好几个小时，只能重登才能恢复。新者胜保住的是**文件那一侧**（单元与所有状态探针读的就是它），但没有任何东西能把单元的轮换写回 keychain（`security add-generic-password` 只能把密文放进 argv，因此否决）。所以容器侧与宿主侧必须是**两次独立授权**：每个容器化的 claude 条件用自己的命名 scope，用 `/claude-code login --scope <名>` 授权一次，且**永不**在该 scope 上跑宿主轮。评测会在取单元之前就拒绝违反这条的计划。**注意作用域 `settings.json` 里的宿主专用项**：实测那里给宿主守护进程用的 `https_proxy` 在容器内指向不存在的地址，本轮当场 `Connection refused`——挂进去的目录要由调用方备好。

```
src/index.ts                harness 注册、/claude-code 命令族、config schema
src/claude-cli-provider.ts  一次性 provider:spawn、流镜像、turn/token 记账
src/provision.ts            作用域目录 provisioning 与基于文件的 logout
src/records.ts              认证探测与作用域目录的会话记录列表
```

bundle patch 把 `claude-code` harness 注册进家族 core（`@khorsheed/dsh-local-agent`，声明为依赖——claude 包刻意不重复插入 core 行，重复会挂载两次），并挂载 `claude-local` provider，后者在 harness 作用域目录下 spawn `claude -p --verbose --output-format stream-json`。`subagent_claude_code` 工具是家族自有工具（`@khorsheed/dsh-local-agent-tool-subagent`）：官方子集（`description`/`prompt`）加一个可选 `resume` 参数。

**作用域隔离。** macOS 上真实凭据在系统 keychain 的哈希条目里（`Claude Code-credentials-<sha256(configDir)[:8]>`，以作用域目录路径为键）——基于文件的 logout 够不到它，但下次登录会重写同一个槽位。**CLI 自己用哪个存储是随版本变的，且由实测而非假定确定**：2.1.236 写 keychain、读文件（这个镜像正是为那条分裂而存在），而 2.1.274 在 macOS 上读写 keychain，2.1.272 在 Linux 上读写作用域文件。因此文件对本包自己的探针与容器轮仍是权威；keychain 才是当前 macOS 上宿主 CLI 真正用的那个。认证探测只做轻量文件检查——看作用域 `.claude.json` 的 `oauthAccount`，绝不为了探测而 spawn CLI。该探测同样会协调两个存储，因此遵守与 spawn 点一致的新者胜规则：它在每次状态读与每次就绪检查时都会跑，那里若是无条件镜像，同样会把容器轮的续期抹掉。

**会话记录。** `/claude-code sessions` 列出作用域目录下的 `projects/<cwd-slug>/<uuid>.jsonl` 会话文件——即本 agent 的委派，绝不是你的私人会话。slug 是工作区路径的有损编码，所以列出的 `workDir` 取自文件内容（第一条 `user` 事件的 `cwd` 字段），绝不取自目录名。设置面板呈现同一份列表并收窄到当前工作区。

**续聊安全。** 句柄绝不进 prompt：它只从 `resume` 参数读取，localAgent registry 只对记录该委派的同一 parent 会话与 provider 解析句柄——伪造的句柄（未知子会话、他人 parent 的会话、或错误的 provider）在任何 CLI 进程启动前就被拒绝。

**流镜像与记账。** `thinking` 块折叠为 `reasoning` 块、`tool_use`/`tool_result` 为工具行（`[工具 Bash] <command> → output`）、回复 `text` 为 assistant 文本；续聊轮各自追加自己的 turn，不会重复。编辑类调用（Edit/Write/MultiEdit/NotebookEdit）折叠为 ApplyPatch 式卡片——路径在参数行，真正的改动（旧/新串或整个文件体）在卡身，与 codex 的 fileChange 镜像同一形态；服务端工具（`server_tool_use` 的 web_search/web_fetch）与其结果按 id 配对成可见的 WebSearch/WebFetch 卡；`redacted_thinking` 折叠为一行可见的占位思考（内容按设计由服务端加密，不可见——行内注明）；其余工具的输入取单一标量摘要，取不到就给一份截断的 JSON 摘要而不是丢空。每个镜像 step 都包在同 (turn, step) 的 `step/start`–`step/end` 边界对内——宿主实时会话视图只在边界上登记 step，缺了边界 assistant 消息要等整页重建才渲染。provider 在 spawn 时开 `turn/start`、settle 时关 `turn/end`——失败与被取消同样关闭——因此 `subagentTiming` 时长等于实际 CLI 运行时长，不会留下未闭合窗口；最终 `assistant/message` 携带从 JSON 结果解析的 token 用量（`input_tokens`、`output_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`——Anthropic 各桶独立上报）。

**模型体验。** 子会话是委派会话工作区内一个全新的一次性 `claude -p`；父级只提交独立的任务文本，只看到最终回答或精确错误，以及首次委派时的续聊自述——Claude 的评论、工具活动、工作区 diff 不会复制进父级。子会话 token 永不进入父级上下文；子会话为独立的 Claude 上下文与回合付费（缓存复用只取决于作用域安装自身的 provider、模型与历史）；父级 KV cache 不受影响。

**长驻驱动（`live: true`）。** 替代每轮 spawn：成员首轮委派拉起一个常驻 stream-json 进程（`claude -p --verbose --input-format stream-json --output-format stream-json`），第一条 stdin `user` 消息触发 `system/init`（server 分配 session id，即委派记录的 `cliSessionId`），之后每轮 = 一条 stdin 消息；事件流与 exec 的 stream-json **完全同形**，逐轮过同一个 `ClaudeStreamParser` 折叠（末行留置到 `result` 挂用量，与 exec 一致），`cancel` 落地为 `control_request interrupt`——进程不死、会话可续。回收阶梯是 stdin EOF → SIGTERM；崩溃后下一轮以 `--resume <session_id>` 重挂盘上会话。runtime 在 spawn 时绑定成员的生效模型（会话级覆盖 → 委派模型 → 设置键），并把它暂写进作用域 `settings.json`（`--resume` 重挂认文件不认旗标）；绑定模型与新一轮解析不一致的 runtime 先退役再重挂。`permissionMode: normal` 的 spawn 不带 `--dangerously-skip-permissions`，CLI 的 server→client 控制请求（`can_use_tool` 审批面）由驱动自动应答 allow——子代理没有审批面，与 exec 在 skip 下的有效行为一致；其余子类型应答 error 而不是沉默挂起。授权纪律与 exec 逐字一致：只注入作用域 `CLAUDE_CONFIG_DIR`（与可选的 `baseUrl` 覆盖），绝不碰全局 `~/.claude`，绝不执行任何 `auth` 命令。

**配置注意。** 宿主环境是启动时的快照——之后在别的 shell 里 `export ANTHROPIC_BASE_URL` 对运行中的进程无效，除非重启宿主；排查路由异常时检查宿主的实际环境而非你当前的 shell。每次委派在 info 级别记录有效端点（`subagent-claude: delegating via <endpoint>`），失败运行的报错文本会点名它。`skip` 作为默认是因为一次性 CLI 子代理没有审批面；委派需要被限制时，给宿主自身套沙箱（例如在沙箱化工作区内运行 dsh 宿主）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-claude-code`）。问题与贡献请移步该仓库。
