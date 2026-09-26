# @khorsheed/dsh-local-agent-codex

[English](README.en.md) | 中文

把编码任务甩给你本机装好的 Codex CLI 跑——它自己的登录、自己的会话记录,你的 `~/.codex` 一根手指都不碰。

dsh 的 agent 已经能干活,但有些任务你就是想交给本机的 Codex CLI:它的账号、它的模型、你熟悉的工具链。这个插件把 Codex 接成 dsh 的本地子代理——任意 agent preset 都能经 `subagent_codex` 工具一句话委派;委派跑在插件隔离的作用域目录(`$DSH_HOME/local-agent/codex`)里,你的个人 config、凭据、会话完全不被触碰;过程细节(推理、工具调用、文件改动)实时镜像在子会话里,最终回答回到父会话。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/08-local-agent.png" width="640" alt="设置 → 插件配置页里的 Local Agent · Codex 卡片,卡头状态点一眼可见授权状态">

## 特性

- **任意 preset 皆可委派**——`subagent_codex` 工具挂在 profile 根,无需逐 preset 配置。
- **作用域目录隔离**——Codex 的全部状态(config、凭据、rollout 会话记录)留在 `$DSH_HOME/local-agent/codex`,与你的 `~/.codex` 互不干扰。
- **会话内登录**——`/codex login` 在伪终端里跑 `codex login`,授权页自动在浏览器打开;页面给出 code 时用 `/codex code <code>` 粘贴回来。设置卡片显示认证状态并提供退出登录。
- **常驻模式(live)**——每成员常驻一个 `codex app-server` 进程,按轮发 turn:输出实时流入子会话、取消不杀进程、崩溃后自动续上原线程;关闭或通道起不来即回一次性 `codex exec`,热切换无需重载。
- **设置卡片**——Plugins 详情页(0.1.5 为 设置 → 插件 → 插件配置)里的 Codex 卡:登录授权、默认模型(留空 = 跟随 CLI 默认)、常驻开关,保存即于下一轮生效。
- **线程续聊**——传入 `resume="<childSessionId>"` 在同一个 dsh 子会话里继续同一个 codex 线程,宿主重启后也续得上。
- **自定义端点**——经作用域 `config.toml` 的自定义 provider 把 Codex 的 LLM 请求路由到你自己的路由端点。
- **回读与独立工作目录**——每轮从本轮 rollout 回读实际模型、CLI 版本与用量写进委派记录;定位按 threadId + cwd + 时间窗,并发跑也读的是自己那一轮。编排器可用 `cwd` 选项给每格独立目录,resume 换目录即拒绝。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/local-agent-codex-card.png" width="640" alt="展开的 Codex 设置卡:认证状态与登录/退出、默认模型、常驻模式开关">

## 安装

前置依赖:一个可运行的 dsh profile 和 `PATH` 上的 Codex CLI(`codex`)——插件不安装它、也不替你登录。

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-codex
```

两个包必须同时点名——`dsh plugin add` 只调和**直接**依赖,家族 core 不会被传递依赖自动挂载。重启 web 实例后生效,然后在任意会话里跑一次 `/codex login` 完成授权。

卸载:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-codex
```

作用域目录(`$DSH_HOME/local-agent/codex`)会刻意保留,重装无需重新登录;删除它即可清除全部痕迹。

## 配置

可选,写在 profile patch 层:

```yaml
- id: local-agent-codex
  config:
    sandbox: workspace-write   # codex exec 策略:read-only | workspace-write | danger-full-access
    model: gpt-5.2             # 可选:每轮委派以它起 CLI;不写就一个模型参数都不传(见下)
    live: false                # 常驻驱动:每成员常驻一个 codex app-server 进程,按轮发 turn(运行时级优雅中断、事件推送镜像);关闭或通道不可用即回一次性 exec
    liveIdleMs: 1800000        # 常驻 runtime 空闲回收时限(默认 30 分钟)
```

**旧键迁移。** live 轮次统一消费增量输出:旧 `liveMirrorGranularity: event | token` 配置继续兼容读取,但不再影响行为,也不会改变运行中的进程。评测继续保留 exec 驱动;最终内容仍以 provider 完成项为准,包括工具记录和用量。

### 默认模型(`model`)

**不写 = 今天的表现。**没有这个键时,本插件在 argv 上一个模型参数都不加:跑哪个模型由作用域 `config.toml` 的顶层 `model` 决定,它也没有时由 codex 自己的默认决定。

**写了 = 每轮委派以它起 CLI。**新起一轮与续接(resume)同等对待:

| 驱动 | 传法 |
|---|---|
| 一次性(默认) | `codex exec -m <model> …`;`-m` 是 `codex exec` 自己的选项,因此排在 `resume` 子命令之前(`codex exec resume` 不认自己的 `-m`) |
| 常驻(`live: true`) | `codex app-server -c model="<model>" --stdio`;app-server 没有 `-m`,用 CLI 为此提供的进程级 `-c` 覆盖 |

作用域 `config.toml` 不会被改写——`-m` 每轮覆盖它,文件仍是你编辑的样子。

设置卡「默认模型」修改后续轮次使用的 provider 配置。共享选择器展示当前作用域的模型目录、发现来源和完整性,并保留按需填写模型 ID 的入口。清空选择后跟随有效配置及默认值链。保存不会打断当前轮次,也无需重载;共享选择器不可用时,卡片保留文本输入兜底。成员级模型和推理强度修改使用下文的持久控制面。

丰富目录读面现已保留原生显示名、隐藏候选和推理选项,遍历分页,并接入 core 缓存与刷新订阅。查询上下文跟随成员的 scope 和 cwd。刷新失败保留最后成功快照并标为过期;配置项和历史建议保留来源标识。共用模型菜单和成员 effort 控制已接入。运行中选择排到下一完整轮次(含工具续跑);core 统一持有当前/待生效配置、撤销与重试,冻结评测成员禁止变更。原生目录候选不等于账号权限证明。

**委派级的模型优先。**编排器可以经门面 `DelegationCallOptions.model` 给**某一次委派**点名模型,它排在这个键之前(固定顺序:会话覆盖 > 委派记录 > 本键 > 作用域 config > CLI 内置)。首轮请求的值记进委派记录,resume 轮照它重发——resume 不接受 model 参数。常驻模式下带模型的轮次不再被拒绝:它成为该成员的**起始模型**,在 app-server 起进程时绑定;若该成员的常驻 runtime 绑定的是另一个模型,先回收重生(同一 codex 线程经 thread/resume 续上),再以所点模型起新一轮。

**成员级切换(作曲器模型选择器)。**成员会话里可以按会话切换模型:一个内存中的会话级覆盖,优先级最高,宿主重启即失。切换在有轮次进行中时被拒绝;空闲时若成员有常驻 runtime 且绑定模型不同,切换即回收该 runtime——下一轮以新模型重生,CLI 会话(rollout)本身延续。一次性(exec)驱动下没有常驻进程,覆盖直接决定下一轮的 `-m`。

**这不是评测的缺口。**评测 run 的条件在建立时冻结:run 跑到一半改这个键,下一轮的模型回读会发现声明模型 ≠ 实测模型,run 直接判为 misattributed 而失败(冻结决策 5)。换句话说「切了新 run 照新走、进行中的 run 不被悄悄换掉」是设计出来的,不是漏掉的。

## 自定义端点

把 Codex 的 LLM 请求路由到你自己的端点:在作用域 `$DSH_HOME/local-agent/codex/config.toml` 里**新增自定义 provider**(内置 provider 不可覆盖、`OPENAI_BASE_URL` 不生效、预置逻辑从不覆盖已存在的 config):

```toml
[model_providers.dsh-router]
name = "dsh-router"
base_url = "https://your-router.example/v1"
model_provider = "dsh-router"
```

最后一行为委派选择该 provider;文件其余内容必须保留。

⚠️ **凭据暴露**:作用域 `auth.json` token 会发送给处理请求的端点——只使用你控制或信任的端点。每次委派在 info 级别记录生效的端点。

**评测快照(effectiveSettings)。** 本 harness 向注册表声明一份实时读取的公平性设置快照,供评测条件哈希使用:drive(exec/live)、sandbox 策略(插件配置)、推理强度(读作用域 config 的顶层 `model_reasoning_effort`)、端点是否固定(读作用域 config 的自定义 provider,只报主机名)、已配置模型(先看插件配置的 `model` 键——它每轮覆盖文件;没有才读作用域 config 的顶层 `model`;都没有就不给字段)、CLI 版本(`codex --version`,按可执行文件路径+mtime 缓存;探测不到即字段缺位)。`/codex status` 与 `LocalAgentStatus` Remote 附带同一份快照。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.5-rc.1`):✅ 公开 API 兼容。生成中的内容走 local-agent 瞬时 Remote 与公开 Conversation 节点;增量耐久检查点负责恢复,最终原生消息保留转写与用量语义。端到端延迟验收由 room 协调者提案跟踪。minHost 0.1.5-rc.1,更旧宿主请停留在旧发布线。
- 源码线(deepseek-harness master):✅(verifiedHost: 0.1.5-rc.1)

## 已知限制

- **登录需要一次浏览器授权**——`/codex login` 自动打开授权页,CLI 追问 code 时以 `/codex code <code>` 粘贴回来;没有 API key 路径。
- **`codex exec` 非交互运行**——沙箱策略本需审批的动作会被拒绝而非弹提示;常驻模式下审批类请求同样按无人值守策略自动谢绝(cancel/decline)。见 `sandbox` 配置。
- **命名 scope 只走一次性 exec**——常驻 app-server 绑定缺省作用域目录,带 scope 的委派不进 live。
- **headless 注意**——`/codex` 命令需要 Web 会话;headless 仍可通过挂载工具行的组合进行委派。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**命名 scope。** `/codex login --scope <名>` 会在 `<homesRoot>/codex@<名>` 里另开一份作用域目录:目录建立时自动跑同一份 `config.toml` provision(把凭据存储钉在文件而非 macOS keychain),因此该 scope 的登录落在它自己的 `auth.json` 里。带 scope 的委派用它跑 `codex exec`、把 rollout 写进它、从它回读;只走 exec——常驻 app-server 绑的是缺省作用域目录。

**bundle 组成。** patch 注册 `codex` harness(`CODEX_HOME` 作用域目录、PTY 登录、rollout 文件会话记录),并把 `subagent_codex` 工具挂到 profile 根——官方 preset 的同名行本就 `disabled: true`,patch 再禁一次,社区安装永远不会注册出两个 `subagent_codex`;刻意在自有 preset 层重新启用官方行的用户会得到响亮的重名冲突,按设计必须二选一。`codex-local` provider 在该作用域目录下 spawn `codex exec`(live 未启用时的一次性驱动)。浏览器半部分随本包 `./client` 提供:Codex 设置卡组合家族 core 的共享 `ProviderAuthBlock`,独立安装落在 Plugins 页的包详情视图(`plugins.bundle.config`,按包名派发),作为家族 bundle 成员安装落在 bundle 详情页的行级配置入口(`plugins.row.config`),0.1.5 落在 设置 → 插件 → 插件配置(`settings.plugin.item`,按设置命名空间派发);卡片写入经绑定的 settingsScope 热生效,不用重载。core 本身来自声明为依赖的 `@khorsheed/dsh-local-agent`。

**登录与凭据。** `/codex login` 经宿主 subprocess seam 在伪终端里跑 `codex login`——CLI 自己起 localhost 回调服务并打开浏览器,这是第一类流程;命令回复附带从输出里抓取的授权 URL 作兜底链接,CLI 追问 code 时用户以 `/codex code <code>` 粘贴(写入子进程 stdin)。完成由监听作用域目录的凭证 watch 判定:`auth.json` 出现且时间戳新于 watch 起点——残留的旧凭证不会被误认成新登录。无浏览器的远程终端可以手动以 `CODEX_HOME` 指向作用域目录跑 `codex login --device-auth`,凭据落在同一份 `auth.json`。首次启动写入一份最小 `config.toml`,固定 `cli_auth_credentials_store = "file"`——Codex 默认的 `auto` 会解析到 macOS keychain,把凭据泄漏到作用域目录之外并使本包的 `auth.json` 存在性检查失效;已存在的 config 保持不动。`/codex logout` 删除作用域 `auth.json`,之后重新登录即可换账号。

**会话记录。** `/codex sessions` 列出作用域目录的 `sessions/YYYY/MM/DD/rollout-*.jsonl` 文件——仅本插件委派产生的会话,绝不含你的私人会话。会话头部的记录入口(家族 core 的客户端提供)把同一份列表收窄到 `workDir` 与当前会话 cwd 一致的记录。

**回读与 cwd 覆盖。** 每轮 settle 后,provider 从本轮自己的 rollout 文件里回读三件事,随 `settled` 进度事件上报并合并进 `delegations.jsonl`:模型(`turn_context.payload.model`——codex 0.144.0 的 exec 流事件根本不带 model,rollout 是唯一权威;按本轮时间窗过滤,resume 线程里先前轮次的模型不会被误读)、CLI 版本(`session_meta.payload.cli_version`——服务本轮的那个 codex build 自己写下的,比事后探测可执行文件更准)、以及非正常结束时流里缺失的 token 用量(最后一条 `token_count`)。取不到即缺位,绝不猜测。

**工具调用计数。** 每轮 settle 时,provider 顺带数出本轮的工具调用,随 `settled` 进度事件上报(`toolCalls: { count, byName }`)。计数只来自流解析**已经走过**的 `item.completed` 分支,不新增任何解析路径:`command_execution`、`web_search_call`、`file_change`、`function_call` 各记一次,`function_call_output` 是结果、不计。`byName` 的键是 **codex 自己的 item 类型**(`command_execution`),不是镜像卡片上的显示名(`Bash`)——记的是 CLI 怎么叫这件事。本轮一份,绝不累计;一次都没调用就整个字段缺位(缺席 ≠ 0)。实测:一轮「列目录并统计文件数」回读 `{count: 1, byName: {command_execution: 1}}`,两条命令的一轮回读 `{count: 2}`。

定位与扫描两处都按并发校准过。`turn_context` 是 codex 在**回合开始**时写的,所以一轮里之后产生的事件一多就会把它挤出文件尾——只扫尾部会读回 null(一次真实评测跑就是这么丢的:38 KB 的 smoke 轮读得到,100–500 KB 的正式格读不到),因此尾部扫不到就再做一次有界的整文件读。定位则在 threadId 之外把**本轮 cwd** 也算进去:并发委派会让多个格的文件落进同一个时间窗,`session_meta.payload.cwd` 才是区分它们的字段;窗口里有候选却没有一个对得上本轮目录时,宁可什么都不报也不报邻居那一轮(窗口里只有一个候选除外——那是路径写法差异,不是歧义)。编排器还可以经门面 `DelegationCallOptions.cwd` 给本轮指定工作目录(记录进 `cwd` 字段);resume 轮解析出的目录若与首轮记录不一致,进程启动前即 fail loud——CLI 会话延续的是首轮所在目录的上下文。

**容器内委派。** 编排器可以经门面 `DelegationCallOptions.exec`(`{ container, workdir, env? }`)让本轮跑在一个**已取得的容器**里:argv 变成 `docker exec -w <workdir> [-e NAME…] <container> codex exec …`,其余(流解析、settle、rollout 回读、记录)逐字节不变。`env` 必须给出容器内的 `CODEX_HOME`,且它应当是宿主作用域目录的 rw bind 挂载点——rollout 回读读的是宿主那份文件。容器轮固定走 exec 一次性驱动(长驻 app-server 是宿主进程),且不声明成员桥(宿主 unix socket 进不去容器)。实测:`eval-env:pinned` 单元里一次「回答 2+2」settle 为 `completed`,输出 `4`,`observedModel` 从容器写进宿主作用域目录的 rollout 里回读为 `gpt-5.6-sol`。

**续聊(resume)。** 家族工具(`@khorsheed/dsh-local-agent-tool-subagent`)在官方 `description`/`prompt` 子集上增加可选 `resume` 参数。首次委派的结果文本自述句柄(`追问请带 resume="<childSessionId>"`);后续轮次传回它即在**同一个** dsh 子会话里继续**同一个** codex 线程(`codex exec --json resume <thread_id>`),按轮记账。句柄只从 `resume` 参数读取,localAgent registry 仅对记录该委派的同一 parent 会话与 provider 解析——伪造句柄在任何 CLI 进程启动前就被拒绝。

**事件流镜像。** 子代理会话按顺序镜像 `codex exec --json` 事件流:`reasoning` → 推理块、`agent_message` → 回复文本、`command_execution`/`web_search_call`/`function_call_output` → 工具行(`[工具 Bash] <command> → output`),`file_change` → `ApplyPatch` 卡(逐 change 列出 kind 与路径),`function_call`(如 multi-agent 的 `wait`)→ 同名工具卡、结果由 `function_call_output` 并入;最终 `agent_message` 作为运行输出,当轮用量挂在最后一条镜像的 assistant 消息上。续聊轮各自追加自己的 turn,不会重复。中止会让工具结果立即 settle,并保留已收到的事件与用量。

**模型体验。** 每次委派都是委派 Session 工作区内一个全新的一次性 `codex exec` 进程。父级只提交任务文本、只看到最终回答或精确错误——Codex 的评论、工具活动、工作区 diff 不会跨进父级会话,子会话 token 也永不进入父级上下文。

**长驻驱动(`live: true`)。** 替代每轮 spawn:成员首轮委派拉起一个常驻 `codex app-server --stdio` 进程(同 scoped home、同 `-c` 成员桥声明),创建持久线程(`thread/start`,`ephemeral: false`),之后每轮 = 向活着的 runtime 发 `turn/start`;`item/completed` 事件即时折进子会话(与 exec 共享同一 `CodexTranscriptLine` 折叠与 append 核,最后一行留置到 `turn/completed` 以挂用量),`cancel` 落地为 `turn/interrupt`——进程不死、线程可续。审批类 server→client 请求按无人值守策略自动应答(cancel/decline,与 exec 行为一致)。runtime 空闲超时回收(app-server 无 shutdown 方法:stdin EOF → SIGTERM 阶梯),崩溃后下一轮自动重连并 `thread/resume` 盘上线程;握手失败进冷却熔断,逐轮回退 exec。

**委派记账。** provider 在 spawn 时开 `turn/start`、settle 时关 `turn/end`——失败或取消(`error`/`aborted`)同样关闭——`subagentTiming` 的时长等于实际 CLI 运行时长;最终 assistant 消息携带从事件流解析的 token 用量。codex 的 `input_tokens` 含缓存命中,所以未缓存桶取 `input_tokens − cached_input_tokens`、`cached_input_tokens` 映射缓存读取、没有缓存写入概念——`tokenUsage` 不会双重计数缓存命中。每个续聊轮在各自递增的轮次号下重复这套记账。**非 completed 终态(aborted/error)的用量回落。** 被中止/失败的轮次永远收不到 `turn.completed`,事件流里没有用量——但 codex 已把本轮真实 token 消耗写进了 scoped home 的 rollout 文件。此时 exec 镜像改读**本次 run 的 rollout 文件末条 `token_count`** 挂用量:文件按线程 id(`session_meta` 头)定位,流在 `thread.started` 之前就被截断时按 spawn 时间窗回落;口径与 `turn.completed` 完全一致(`input − cached` 等桶,共享 `usageFromCodex`)。硬杀到连 `token_count` 都没写出的极端情况仍保持无用量,不猜测。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/local-agent-codex`)。问题与贡献请移步该仓库。
