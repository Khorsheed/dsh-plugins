# @khorsheed/dsh-local-agent-claude-code

[English](README.en.md) | 中文

把编码任务委派给本机的 Claude Code——思考、工具调用与回复实时流回，你的私人 `~/.claude` 分文不动。

点名本包 `./tool` 组合入口的 agent preset（如开发模式）即可发起委派：子会话全程可见、可中止、可续聊，每轮的账目（实际模型、token 用量、工具调用数）都真实回读。认证是端点凭据制（`baseUrl` + `apiKey`/`authToken`），作用域隔离——插件只管理 `$DSH_HOME/local-agent/claude-code` 这一份目录，你的个人安装与凭据自始至终置身事外。没有 OAuth 网页授权：容器轮与宿主轮用同一套凭据，容器里不需要再授权一次。[local-agent 家族](../local-agent/README.md) 的 Claude Code harness。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/08-local-agent.png" width="640" alt="设置 → 插件 → 插件配置里的 Local Agent 家族卡片，Claude Code 一行的状态点显示授权状态">

## 特性

- **按会话授予的委派**——`subagent_claude_code` 工具是本包的 `./tool` 组合入口，由点名它的 agent 预设授予该预设的会话，无需逐 preset 变体。
- **作用域隔离**——每个 Claude 进程都以 `$DSH_HOME/local-agent/claude-code` 为 `CLAUDE_CONFIG_DIR` 运行；你的个人 `~/.claude` 置身事外。
- **端点凭据，没有网页授权**——在 bundle 行配好 `baseUrl` + `apiKey`（或 `authToken`）即已认证，状态面板直接显示已认证；每个命名 scope 可用自己的 `endpoint-auth.json` 覆盖部署级配置。`sessions`/`status`/`logout` 与 设置 → 本地 Agent 面板构成完整一族。
- **续聊委派**——把结果自述的 `resume` 句柄传回，即可继续同一个 Claude 会话，并按轮记账。
- **实时流镜像**——子会话实时镜像 Claude 的思考、工具调用与回复；中止会保留部分转写与真实 token 用量。
- **模型回读与独立工作目录**——每轮从 stream-json 的 system/init 回读实际模型，写进委派记录；编排器可用 `cwd` 选项给每格独立目录，resume 换目录即拒绝。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-claude-code-card.png" width="640" alt="展开的「Local Agent · Claude Code」设置卡：认证块、默认模型选择与常驻模式（live）开关">

## 安装

前置依赖：一个可运行的 dsh profile，以及 `PATH` 上的 Claude Code CLI（`claude`）——插件不负责安装。家族 core 与本包一起安装（`dsh plugin add` 只调和**直接**依赖，所以两个包都点名）：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-claude-code
```

重启 web 实例后，打开 设置 → 插件 里本包的卡片，在「认证」区填端点与 key 即可（也可预配在 profile 的本包配置行）；都不配则状态为未认证。卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-claude-code
```

作用域目录在卸载时刻意保留——`endpoint-auth.json` 与会话记录都在其中；删除 `$DSH_HOME/local-agent/claude-code` 即可清除全部痕迹。

## 配置

bundle 行接受这些可选字段：

- `permissionMode`——`skip`（默认）传 `--dangerously-skip-permissions`，子代理写文件无需审批；`normal` 不传，需审批的动作（如写文件）被拒绝。
- `model`——每轮委派以它起 CLI（`claude -p --model <模型>`）；不写就一个模型参数都不传。见下。
- `baseUrl`——部署级端点，为子 CLI 设置 `ANTHROPIC_BASE_URL`（例如 `https://openproxy.to/claude` 这类中转，或自部署路由器）；不写即 Anthropic 官方端点。宿主 shell 里 export 的同名变量**从不被读取**——宿主环境对子进程一律清洗，路由只由配置与 scope 文件决定。**也可在设置卡「认证」区直接填**——卡片保存的是默认 scope 的 `endpoint-auth.json`（0600，只存本机，优先于这里的配置行），密钥绝不写进 profile 文件。
- `apiKey`——部署级凭据，以 `ANTHROPIC_API_KEY`（`x-api-key` 头）发给端点。设置卡可写（落 scope 文件，不回显）；写进 profile 时只放本地，绝不入库。
- `authToken`——部署级凭据的另一形态，以 `ANTHROPIC_AUTH_TOKEN`（`Authorization: Bearer` 头）发出——部分中转只认 Bearer。两个键都配时优先级由 CLI 自己决定。同样可在设置卡填写。
- `proxyUrl`——子 CLI 自身流量的 HTTP 代理，provision 进作用域 `settings.json` 的 env 块；宿主进程环境不带代理时（例如 supervisor 拉起的实例不继承 shell export）用这项。它是本地流量转发器，与 `baseUrl` 的端点路由是两个层面。
- `live`——长驻驱动：每成员常驻一个 stream-json 进程（`--input-format stream-json`），按轮发 stdin 消息（runtime 级优雅中断 control interrupt、同形推送流）；关闭或通道不可用即回一次性 `claude -p`。
- `liveIdleMs`——长驻 runtime 空闲回收时限（默认 30 分钟）。

> **迁移说明（下一发布线，破坏性变更）**——OAuth 网页授权整体移除：`/claude-code login` 不再存在，钥匙串/`.credentials.json` 协调随之删除；升级后首次启动会清扫作用域目录里残留的 OAuth 文件（`.credentials.json` 与 `.claude.json` 的 `oauthAccount` 标记），实测 claude 2.1.296 在两者并存时本就优先采用环境变量凭据。升级前先在设置卡或 profile 行配好 `baseUrl` + `apiKey`（官方端点的 console key 同样可用），否则升级即未认证。旧 `liveMirrorGranularity: event | token` 配置键继续兼容读取，但不再影响行为。

> **每个 scope 的覆盖**——`<作用域目录>/endpoint-auth.json`（0600）按字段覆盖，两层生效顺序：**scope 文件 > profile 的 YAML 行**，缺哪个字段就回落到配置值。一个只写 `apiKey` 的文件等于给这个 scope 换 key。设置卡「认证」区编辑的就是默认 scope 的这份文件（经家族 gateway 的 `endpointAuth`/`configureEndpoint` Remote，会话不在场也能读写）。`/claude-code logout` 清除的也是这个文件；凭据完全来自配置行时 logout 会拒绝并提示去改 profile。

### 可用模型（models.json）

设置卡「可用模型」区维护一份**有序模型短名单**：点「添加模型」从端点当前供应的目录（`GET /v1/models`）里勾选加入，所以列表里只会有端点真实供应的模型；拖动行调整顺序。**第一个模型就是默认模型**——每轮委派以它起 CLI（`claude -p --model <模型>`，常驻模式同一个旗标），优先级只低于成员会话级覆盖与委派级指定。列表保存在作用域目录的 `models.json`（每个命名 scope 可各有一份，与端点凭据同一套文件机制），编辑即保存，下一轮委派生效。成员会话里的模型/推理强度对话框与这份短名单严格一致：候选即名单（按名单顺序），名单外只保留成员当前绑定的模型以免既有绑定显示空白。

**留空 = 既有行为。** 列表为空时，模型照旧由这些层决定：插件配置或设置的 `model` 键 → 作用域 `settings.json` 的 `model` → CLI 内置默认（本插件从不猜它是什么）。一次性（exec）轮不改写作用域 `settings.json`；常驻（live）spawn 会把生效模型暂写进该文件（`--resume` 重挂认文件不认旗标），绑定空模型的 spawn 前再还原。

**评测快照（effectiveSettings）** 的 model 字段同一条解析链：名单第一项 → `model` 键 → 作用域文件；名单进不了快照（它是偏好不是公平性旋钮），回读的 `observedModel` 才是实测证据。run 冻结条件后中途改名单，下一轮的模型回读会发现声明 ≠ 实测并判 misattributed（冻结决策 5）。

成员会话里的 composer 模型选择器写入的是**会话级覆盖**——它排在委派模型与名单之前，只存内存、刻意不跨宿主重启、也不写进设置或名单。切换进行中轮次的成员会被拒绝；live 下换到不同模型会退役该成员的常驻 runtime，下一轮以新模型重挂**同一个** CLI 会话（对话不丢），换成相同模型则什么都不发生。成员级模型和推理强度修改使用下文的持久控制面。

模型读面来自**端点实际供应的模型**（`GET <baseUrl>/v1/models`，带已保存的凭据）——选择器列出的就是端点能跑的，凭据无效时列表为空并给出原因，绝不会用本地 CLI 的内置词汇表掩盖一个失效的 key。目录共用 core 缓存和刷新订阅；端点或凭据一变即重探（凭据轮换经短哈希进缓存键，密钥本体不进），传输错误保留上次成功数据并按计划重试。端点返回的 effort 能力会带上可选档位。目录外的模型 id 仍可手动输入。设置卡的「验证端点并获取模型」按钮是同一条探测的显式版本（无会话 Remote，未保存修改时禁用）。运行中选择排到下一完整轮次（含工具续跑）；core 统一持有当前/待生效配置、撤销与重试，冻结评测成员禁止变更。

**委派级的模型优先。** 编排器可以经门面 `DelegationCallOptions.model` 给**某一次委派**点名模型，它排在这个键之前（顺序见家族核心 README 的层序）。首轮请求的值记进委派记录，resume 轮照它重发——resume 不接受 model 参数。常驻模式下，首轮点名的模型作为该成员的起始模型在 runtime spawn 时绑定：已绑定不同模型的 runtime 先退役，同一个 CLI 会话经 `--resume` 在新进程上续起。

**成员会话级切换。** 成员会话的 composer 模型选择器经家族网关 `setMemberModel` 写入一个**会话级覆盖**——它排在委派模型与这个键之前，只存内存、刻意不跨宿主重启、也不写进设置。切换进行中轮次的成员会被拒绝；live 下换到不同模型会退役该成员的常驻 runtime，下一轮以新模型重挂**同一个** CLI 会话（对话不丢），换成相同模型则什么都不发生。

**这不是评测的缺口。** 评测 run 的条件在建立时冻结：run 跑到一半改这个键，下一轮的模型回读会发现声明模型 ≠ 实测模型，run 直接判为 misattributed 而失败（冻结决策 5）。「切了新 run 照新走、进行中的 run 不被悄悄换掉」是设计出来的，不是漏掉的。

⚠️ `skip` 没有 OS 级沙箱——子进程可以写宿主用户能写的任何地方，包括工作区之外；端点凭据会发送给 `baseUrl` 指向的端点。委派需要限制时改用 `normal`；`baseUrl` 只指向你信任的地址。

**评测快照（effectiveSettings）。** 本 harness 向注册表声明一份实时读取的公平性设置快照，供评测条件哈希使用：drive（exec/live）、permissionMode（skip/normal，插件配置）、端点是否固定（按 provider 的解析顺序——scope 的 `endpoint-auth.json` 逐字段覆盖插件配置，只报主机名；key 材料永远不进快照，文件名命中评测契约哈希的凭据拒绝名单，连摘要都不进条件指纹）、已配置模型（名单第一项 → 插件配置的 `model` 键 → 作用域 `settings.json` 的 `model`；CLI 自身的默认模型由 CLI 决定，绝不猜值，都没有就不给字段）、CLI 版本（`claude --version`，按可执行文件路径+mtime 缓存；探测不到即字段缺位）。`/claude-code status` 与 `LocalAgentStatus` Remote 附带同一份快照。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 公开 API 兼容。生成中的内容走 local-agent 瞬时 Remote 与公开 Conversation 节点；增量耐久恢复检查点负责落盘，最终原生消息保留转写与用量语义。浏览器 P95 验收由 room 协调者提案跟踪。minHost 0.1.5-rc.1——更旧宿主请停留在前一发布线。设置卡渲染为 core「本机 Agent 委派」家族卡的一节（Plugins 页 core 的 `plugins.item` 条目，0.1.7-alpha.1+；旧版 core 上回落为本包自己的 `plugins.item` 卡），`configForms.whileServed` 随宿主服务的 `local-agent-claude-code` 命名空间挂载；0.1.5 线不再呈现卡片（宿主删除了 `settings.plugin.item` 席位），其余表面不变。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.2.1-rc.1）——host-021 波对 0.2.1-rc.1 树全量 build+test 绿；委派迁移到 `ctx.subagents.startActivation`（受管 activation），run.id 改为每次执行唯一。

## 已知限制

- **logout 只清 scope 自己的文件**——`endpoint-auth.json` 之外，来自插件配置的部署级凭据不受影响；要换它请编辑 profile 行。
- **凭据错误的代价是重试时长**——一把失效的 key 会让 CLI 在端点前重试到上限（实测约 8 分钟）才报出 401；`/claude-code status` 的 `rejected` 等级在那一轮 settle 后才出现。
- **交互会话记录可能缺失**——自定义 `CLAUDE_CONFIG_DIR` 下 CLI 可能不写转写（上游行为）。
- **headless 注意**——`/claude-code` 命令需要 Web 会话；`--profile headless` 可通过挂载工具行的组合委派。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**模型回读与 cwd 覆盖。** 每轮 settle 后，provider 把 stream-json `system`（init）事件 `model` 字段里的实际模型（如 `claude-opus-5[1m]`，原样回读，上下文变体后缀照留）随 `settled` 进度事件上报，并合并进 `delegations.jsonl` 的 `observedModel` 字段；取不到即缺位，绝不猜测。当任何一层、任何记录都没有模型时，「默认」面的最近观测提示读成员**自己的**转录（`projects/<cwd-slug>/<sessionId>.jsonl`；无成员面读全树最新的那份）——这是为 settle 通道之前的旧轮次准备的历史兜底；只读，绝不回写 `delegations.jsonl`。编排器还可以经门面 `DelegationCallOptions.cwd` 给本轮指定工作目录（记录进 `cwd` 字段）；resume 轮解析出的目录若与首轮记录不一致，进程启动前即 fail loud——CLI 会话延续的是首轮所在目录的上下文。

**工具调用计数。** 每轮 settle 时，provider 顺带数出本轮的工具调用，随 `settled` 进度事件上报（`toolCalls: { count, byName }`）。计数就在流解析**已经走过**的 `tool_use` 分支里，`byName` 的键是该块自己的 `name`（`Bash`、`Read`、`TodoWrite`，MCP 工具则是 `mcp__server__tool` 全名），原样保留、不跨家归一。`TodoWrite` 也计——折叠逻辑把它挪去了 todo 快照、不进 transcript，但 CLI 确实调了它。本轮一份，绝不累计；一次都没调用就整个字段缺位（缺席 ≠ 0）。实测：一轮「先 Read 两个文件再 Bash 列目录」回读 `{count: 3, byName: {Read: 2, Bash: 1}}`，与镜像出的工具卡片逐个对得上。

**端点凭据模型。** 认证只有一种形态：`endpoint-auth.ts` 把作用域 `endpoint-auth.json` 逐字段合并到插件配置三元组（`baseUrl`/`apiKey`/`authToken`）之上，provider、长驻驱动与模型目录在每次 spawn 前现解现注（`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`），换 key 即下一轮生效，无需重载。设置卡的凭据表单经家族 gateway 的 `endpointAuth`/`configureEndpoint` Remote 读写默认 scope 的这份文件——无会话通道，密钥既不回显也绝不落进 profile patch 文档。已实测：claude 2.1.296 在全新作用域目录里仅凭这组环境变量即可跑通 `claude -p`——CLI 自行脚手架 `.claude.json`，headless 模式没有 onboarding 或 key 批准门槛；与陈旧的 OAuth 文件并存时同样优先采用环境变量凭据（provision 仍会在升级后首次启动清扫这些残留）。状态探针是轻量文件+配置检查（有非空 key 即认证），绝不为探测 spawn CLI；`endpoint-auth.json` 的 mtime 充任凭据戳记——一轮 401 把等级打成 `rejected`，重写该文件（换 key）即恢复，与 OAuth 时代「重新登录改写标记」语义一一对应。

**命名 scope。** 每个命名 scope 在 `<homesRoot>/claude-code@<名>` 另开一份 `CLAUDE_CONFIG_DIR`：自己的 `endpoint-auth.json`、自己的会话记录、自己的凭据等级。scope 文件缺省即跟随部署级配置——这正是一次配置、全部 scope 可用的来源。带 scope 的委派用该目录跑 `claude -p`、从它回读；只走 exec。

**容器内委派。** 编排器可以经门面 `DelegationCallOptions.exec`（`{ container, workdir, env? }`）让本轮跑在一个**已取得的容器**里：argv 变成 `docker exec -w <workdir> [-e NAME…] <container> claude -p …`，其余（stream-json 解析、settle、记录）逐字节不变。`env` 必须给出容器内的 `CLAUDE_CONFIG_DIR`，调用方把宿主作用域目录 rw bind 到那条路径上。端点凭据经家族的容器转发进入单元：provider 解析出的 `ANTHROPIC_*` 变量以**仅名字**的 `-e` 旗标转发，值由 docker 客户端进程环境携带——key 从不上 argv、不进进程表，容器轮因此**与宿主轮用同一套凭据，单元内没有任何授权步骤**。API key 无刷新无轮换，OAuth 时代「宿主与容器双写 refresh token 互杀」的问题在端点凭据下整体不存在。会话记录仍落在挂载目录的 `projects/` 下，评测的模型回读从宿主侧解析它们。容器轮固定走 exec 一次性驱动，且不声明成员桥。**注意作用域 `settings.json` 里的宿主专用项**：实测那里给宿主守护进程用的 `https_proxy` 在容器内指向不存在的地址，本轮当场 `Connection refused`——挂进去的目录要由调用方备好。

```
src/index.ts                harness 注册、/claude-code 命令族、config schema
src/endpoint-auth.ts        端点凭据：scope 文件 ↔ 配置的合并、env 构造、戳记与清除
src/claude-cli-provider.ts  一次性 provider:spawn、流镜像、turn/token 记账
src/provision.ts            作用域目录 provisioning（proxy env 块）
src/records.ts              作用域目录的会话记录列表与转写模型回读
src/tool.ts                 `./tool` 组合入口：`subagent_claude_code` 委派工具（预设点名授予）
```

bundle patch 把 `claude-code` harness 注册进家族 core（`@khorsheed/dsh-local-agent`，声明为依赖——claude 包刻意不重复插入 core 行，重复会挂载两次），并挂载 `claude-local` provider，后者在 harness 作用域目录下 spawn `claude -p --verbose --output-format stream-json`。`subagent_claude_code` 工具是家族自有工具（本包的 `./tool` 组合入口，实现共享自家族 core 的 `./tool-factory`），由点名该行的 agent 预设按会话授予：官方子集（`description`/`prompt`）加一个可选 `resume` 参数。

**会话记录。** `/claude-code sessions` 列出作用域目录下的 `projects/<cwd-slug>/<uuid>.jsonl` 会话文件——即本 agent 的委派，绝不是你的私人会话。slug 是工作区路径的有损编码，所以列出的 `workDir` 取自文件内容（第一条 `user` 事件的 `cwd` 字段），绝不取自目录名。设置面板呈现同一份列表并收窄到当前工作区。

**续聊安全。** 句柄绝不进 prompt：它只从 `resume` 参数读取，localAgent registry 只对记录该委派的同一 parent 会话与 provider 解析句柄——伪造的句柄（未知子会话、他人 parent 的会话、或错误的 provider）在任何 CLI 进程启动前就被拒绝。

**流镜像与记账。** `thinking` 块折叠为 `reasoning` 块、`tool_use`/`tool_result` 为工具行（`[工具 Bash] <command> → output`）、回复 `text` 为 assistant 文本；续聊轮各自追加自己的 turn，不会重复。编辑类调用（Edit/Write/MultiEdit/NotebookEdit）折叠为 ApplyPatch 式卡片——路径在参数行，真正的改动（旧/新串或整个文件体）在卡身，与 codex 的 fileChange 镜像同一形态；服务端工具（`server_tool_use` 的 web_search/web_fetch）与其结果按 id 配对成可见的 WebSearch/WebFetch 卡；`redacted_thinking` 折叠为一行可见的占位思考（内容按设计由服务端加密，不可见——行内注明）；其余工具的输入取单一标量摘要，取不到就给一份截断的 JSON 摘要而不是丢空。每个镜像 step 都包在同 (turn, step) 的 `step/start`–`step/end` 边界对内——宿主实时会话视图只在边界上登记 step，缺了边界 assistant 消息要等整页重建才渲染。工具行在自己的一个 step 内原子折叠完整的原生生命周期：先发一条携带 `{type:'tool-call'}` 块的 assistant/message 作通告，再写 `tool/call` 与 `tool/result`——released-log 读取端冷读时按通告配对调用与结果，并要求 step 关闭前结果已落实；流里还没有结果的调用会扣住当次折叠（结果会原地并回该行，下一拍自然带出），轮次结束仍无结果的以中断占位结果（`（工具调用被中断，未能记录返回结果）`，与 kimi 同款）收尾并标 isError。provider 在 spawn 时开 `turn/start`，`turn/end` 落在退出后 settle 镜像**之后**（仍在镜像队列内）——失败与被取消同样关闭——因此 `subagentTiming` 时长等于实际 CLI 运行时长，镜像 step 永不落在关窗之后；最终 `assistant/message` 携带从 JSON 结果解析的 token 用量（`input_tokens`、`output_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`——Anthropic 各桶独立上报）。

**模型体验。** 子会话是委派会话工作区内一个全新的一次性 `claude -p`；父级只提交独立的任务文本，只看到最终回答或精确错误，以及首次委派时的续聊自述——Claude 的评论、工具活动、工作区 diff 不会复制进父级。子会话 token 永不进入父级上下文；子会话为独立的 Claude 上下文与回合付费（缓存复用只取决于作用域安装自身的 provider、模型与历史）；父级 KV cache 不受影响。

**长驻驱动（`live: true`）。** 替代每轮 spawn：成员首轮委派拉起一个常驻 stream-json 进程（`claude -p --verbose --input-format stream-json --output-format stream-json`），第一条 stdin `user` 消息触发 `system/init`（server 分配 session id，即委派记录的 `cliSessionId`），之后每轮 = 一条 stdin 消息；事件流与 exec 的 stream-json **完全同形**，逐轮过同一个 `ClaudeStreamParser` 折叠（末行留置到 `result` 挂用量，与 exec 一致），`cancel` 落地为 `control_request interrupt`——进程不死、会话可续。回收阶梯是 stdin EOF → SIGTERM；崩溃后下一轮以 `--resume <session_id>` 重挂盘上会话。runtime 在 spawn 时绑定成员的生效模型（会话级覆盖 → 委派模型 → 设置键），并把它暂写进作用域 `settings.json`（`--resume` 重挂认文件不认旗标）；绑定模型与新一轮解析不一致的 runtime 先退役再重挂。`permissionMode: normal` 的 spawn 不带 `--dangerously-skip-permissions`，CLI 的 server→client 控制请求（`can_use_tool` 审批面）由驱动自动应答 allow——子代理没有审批面，与 exec 在 skip 下的有效行为一致；其余子类型应答 error 而不是沉默挂起。授权纪律与 exec 逐字一致：只注入作用域 `CLAUDE_CONFIG_DIR` 与解析出的端点凭据变量，绝不碰全局 `~/.claude`，绝不执行任何 `auth` 命令。

**配置注意。** 每次委派在 info 级别记录有效端点（`subagent-claude: delegating via <endpoint>`），失败运行的报错文本会点名它；排查路由异常时看这份日志与 profile 行，而不是你当前 shell 的环境。`skip` 作为默认是因为一次性 CLI 子代理没有审批面；委派需要被限制时，给宿主自身套沙箱（例如在沙箱化工作区内运行 dsh 宿主）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-claude-code`）。问题与贡献请移步该仓库。
