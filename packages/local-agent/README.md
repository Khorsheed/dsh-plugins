# @khorsheed/dsh-local-agent

[English](README.en.md) | 中文

从 dsh web 界面驱动本机装好的编码 agent CLI——Kimi Code、Codex、Claude Code，甚至另一个 dsh。

这是 local-agent 家族的核心包：每家 CLI 注册成一家 harness，得到共享 homes 根下一份 0700 的隔离作用域目录（你机器上原装的 CLI 安装绝不被动到）、一族 `/<harness> login|sessions|status|logout` 斜杠命令、设置里的一张认证卡片；家族的委派能力——把会话工作交给本机 CLI、之后跨宿主重启也能续跑——同样挂在这份注册表上。各家 harness 的实现在独立包里（`@khorsheed/dsh-local-agent-kimi` 等），本包自己一家都不含。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/08-local-agent.png" width="640" alt="设置 → 插件 → 可配置插件里的 Local Agent 卡片，卡头状态点一眼可见各 provider 授权状态">

## 特性

- **每个 CLI 一个作用域目录**——共享 homes 根下的隔离凭据/会话目录，以 0700 创建；你的本地 CLI 安装绝不被动到。
- **斜杠命令族**——`/<harness> login|sessions|status|logout`，device-code 登录 URL 通过命令回复呈现；另有家族命令 `/local-agent list`（已注册 harness 花名册）与 `/local-agent stop <childSessionId>`（取消在飞委派）。
- **每 provider 一张设置卡片**——落在设置 → 插件 → 可配置插件（`settings.plugin.item`，按设置命名空间派发）：卡头认证状态点、网页登录/退出、常驻模式（live）热切开关与输出粒度；卡片直接复用本包 client 面的共享 `ProviderAuthBlock`。
- **子 agent 委派与续跑**——把会话工作交给本机 CLI 并在之后 resume，宿主重启也能续上；委派记录按 harness 持久化在作用域目录的 `delegations.jsonl`。
- **成员会话保持可写**——委派的子会话不是只读回放：MemberComposer 让它继续接受输入（发送即 resume），实时输出流式呈现，模型与推理强度可在成员输入栏切换；运行中选择排到下一完整轮次生效，冻结的评测成员拒绝变更。
- **成员会话侧栏续写（宿主 0.1.6 起）**——官方 subagent 目录每行新增「在侧边栏打开」入口：成员会话本就是 one-shot subagent，侧栏内本家族 MemberComposer 自动当选为可写 composer，本包零改动受益；0.1.5 宿主没有该入口，行为不变。
- **一家多份登录（命名 scope）**——`/<harness> login --scope <名>` 在 `<homesRoot>/<家名>@<名>` 里另开一份作用域目录：各自登录、各自会话记录、各自 `delegations.jsonl`，凭证不复制。评测因此能在同一次 run 里比较同一家的两个账号。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-member.png" width="640" alt="委派给本机 CLI 的成员会话：实时输出流式呈现，底部成员输入栏可继续对话并切换模型">

## 安装

core 必须与至少一个 harness 包一起装——`dsh plugin add` 只激活**直接**依赖，仅靠 harness 包的传递依赖不会挂载本 core：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi   # 或 -codex / -claude-code / -dsh
```

想一次装齐整个家族（core + 四个委派 provider），改装元包 `@khorsheed/dsh-bundle-local-agent`。

重启 web 实例后生效。卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent
```

## 配置

自定义组合挂载一次 core：

```yaml
- id: local-agent
  name: '@khorsheed/dsh-local-agent'
  config:
    homesRoot: !!js dshHomePath('local-agent')
```

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——适配 0.1.5-rc.1（format v2/v3；handle 制 sessionPersistence），全量构建测试通过；minHost 前移至 0.1.5-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）。

## 已知限制

- **登录不是交互式终端**——web GUI 没有交互式终端面，各家有登录流程的 harness 各走一条适配通道：kimi 的 device-code URL 由命令回复呈现、CLI 在后台轮询；codex 与 claude（≥2.1）的认证只在 TTY 上跑，登录命令在伪终端包装下 spawn——CLI 自己打开浏览器，输出里兜底解析 OAuth URL，要输码时用 `/<harness> code <值>` 粘贴——registry 监听作用域目录识别登录完成。契约里另有 manual 交接变体（回复一条让用户在自己终端运行的完整命令），目前家族没有 harness 需要它；dsh harness 没有登录流程（继承宿主实例的凭据），`/dsh login` 如实回答。
- **homes 根位置**——默认 `$DSH_HOME/local-agent`，待 `var/state` 布局标准化后再议。
- **委派日志增长**——每个作用域目录的 `delegations.jsonl` 只增不减、无轮转。
- **harness 契约尚未冻结**——现有四家 provider（kimi / codex / claude-code / dsh）各自归纳了自己的一份，新 harness 入局前注册接口仍可能调整。
- **成员通道是 per-run token 单因子认证**——token 经 CLI 作用域 MCP 配置下发（0700 的 scoped home 挡住其他用户），run 落定即焚；宿主 0.1.5 移除子进程 pid 后没有第二因子。**残余风险**：同机同用户的兄弟成员 CLI（其模型驱动的 bash）能读到另一个成员的 token 并回放它——原 pid 校验也是自报字段，本就不防刻意伪造，去掉它没有实质降级；但刻意构造的跨成员调用现在是可能的。加固（socket 内核级 peer 凭证，或 spawn 时注入的 capability token）由 `proposals/active/2026-09-10-member-channel-auth-hardening.md` 跟踪。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

每个 harness 向 `ctx.localAgent` 注册：一个作用域目录、一个可选的登录声明（device-code 命令、伪终端包装的 TTY 登录，或 manual 交接变体）、一个会话记录适配器，以及可选的认证状态与退出登录探测。glue 供给每个作用域目录并注册 `/<harness> login|sessions|status|logout` 命令族；harness 间差异只剩 `homeEnvVar`、登录调用、records 适配器与认证/退出探测。

**委派不属于这个 seam。** 每个 harness bundle 各自向既有的 `subagent` 能力挂载 subagent-provider 行（讲 stdio ACP 的 harness 用 subagent-acp，Codex 用其 app-server provider），经 `localAgent.homeDir(name)` 读取作用域目录。

**程序查询走只读 Remote 通道。** `LocalAgentGateway`（服务键 `localAgentGateway`，生成物 `./remote`）通过 Typert Gateway 向浏览器暴露 roster、各 harness 状态与作用域会话。它不产生任何会话事件，因此 UI 轮询不会在会话日志里留下命令节点；登录与退出仍走斜杠命令通道——用户主动操作产生可见命令节点正是预期反馈。

**成员实时输出管线。** 成员（委派的子会话）的实时输出经流式 Remote 与公开 Conversation 节点呈现：provider 把一轮的增量交给 `LiveStreamPublisher`，浏览器侧更新最多合并 50ms（`LIVE_FLUSH_INTERVAL_MS`），增量恢复检查点按独立的一秒节奏追加 `local-agent/stream` 事件（`LIVE_CHECKPOINT_INTERVAL_MS`）；原生最终消息落定后替换临时展示，用量、工具与会话导航全部保留。重连读取新基线；宿主崩溃可能丢失未落检查点的末段，恢复内容明确标为部分记录。模型/effort 配置、模型目录与可见成员的实时输出在每个页面共用一条成员订阅（`MemberFeeds`），多成员及成员会话入口不会占满 HTTP/1 连接池。浏览器 P95 仍需在 room 协调者提案中验收。

**评测快照（effectiveSettings）。** 每个 harness 可声明一份当前生效的公平性相关设置：drive（exec/live）、沙箱或权限模式（各用自家词汇：codex 报 sandbox 策略、claude 报 permissionMode、kimi 报自动批准与否；没有该旋钮的 harness 字段缺位，缺位本身就是诚实的条件输入）、推理强度、已配置模型（各家读自家配置面：kimi 的 `default_model`、codex 的 `model`、claude 的作用域 `settings.json`、dsh 继承的宿主选择；读不到就不给字段，绝不猜默认值）、端点是否固定（只报主机名，绝不报完整 URL）、CLI 版本（问 CLI 自己：`probeCliVersion` 跑一次 `<cli> --version`，按可执行文件的解析路径+mtime+大小缓存，所以一次升级会自动重探，而没装、超时、非零退出、输出里没有版本形状的 token 都只是字段缺位）。快照是实时读——人改过的作用域配置报人改过的值——纯 JSON、绝不含凭证，`registry.effectiveSettings(name)` 供编排器读条件哈希，`/<harness> status` 与 `LocalAgentStatus` Remote 附带同一份（增量字段，旧客户端不受影响）。

**凭证只说知道的（credentialState）。** `LocalAgentStatus` 除 `authenticated` 布尔外还带一档 `credentialState`：`absent`（作用域家目录里没有凭证记录）、`present-unverified`（有记录，但本宿主进程里还没有任何一轮委派碰过它——一份过期且刷不动的凭证和一份能用的凭证形状完全一样，说不知道正是这一档的意义）、`verified`（自上次登录/登出以来有一轮委派真的打通了端点并完成）、`rejected`（某轮的端点拒了这份凭证，且此后没有新登录重写凭证标记）。`authenticated` 保持不变，恒等于 `verified || present-unverified`，所以设置卡片与既有客户端读到的还是原来那个布尔。这一档是每宿主进程的：重启后一份在场的凭证回到 `present-unverified`，因为那才是当下真正知道的；开跑前的主动活性探测不归这个字段。provider 在一轮 settle 成 completed 时调 `reportAuthSuccess`，与既有的 `reportAuthFailure` 对称。

**浏览器半身随本包提供。** `./client` 导出通过本包的 `dsh.client` manifest 自动挂载：成员 composer（委派的子会话可继续对话）+ 共享设置卡片构件（`ProviderAuthBlock`、认证状态总线、`AuthStatusDot`）——各 provider 包的设置卡片（0.1.5 `settings.plugin.item` 卡）直接组合它们，UI 保持 provider 无关（只消费 `/<harness>` 命令族和只读 gateway）。

### 新增一个 harness

harness bundle 向 core 注册，并挂载自己的委派行：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { LocalAgentSessionRecord } from '@khorsheed/dsh-local-agent'

const listCodexSessions = async (homeDir: string): Promise<readonly LocalAgentSessionRecord[]> => []

/** Register the Codex harness into the local-agent registry. */
export function registerCodex(ctx: Context): void {
  ctx.localAgent.register({
    name: 'codex',                 // command prefix + scoped-home dir
    displayName: 'Codex',
    homeEnvVar: 'CODEX_HOME',
    delegationProvider: 'codex',  // subagent provider name; cross-checked at load
    login: { command: 'codex', args: ['login'] },
    records: { listSessions: listCodexSessions },
    // Optional: report auth from the scoped home and sign out of it, so
    // /codex status|logout work and the settings tab can switch accounts.
    isAuthenticated: async () => false,
    logout: async () => {},
  })
}
```

`login` 是可选的：没有登录流程的 harness（例如 dsh 自身——它通过宿主实例的 `DEEPSEEK_API_KEY` 认证，而非 device-code 流程）省略它，`/dsh login` 会回答"该 harness 无登录流程"而不是 spawn 一个 CLI。这类 harness 仍通过 `isAuthenticated` 报告 `status`，并正常列出会话；status 快照携带显式的 `loginable`/`logoutable` 能力标志，设置界面等表面因此不会提供会得到报错回复的操作。

### 委派 registry（resume 载体）

registry 还持有家族的**委派 registry**：每个子会话一条记录，记下该委派用的 provider 与 CLI 会话，以及按 (parent, provider) 分组的委派 intent FIFO。家族工具（`@khorsheed/dsh-local-agent-tool-subagent`，由各 harness bundle 的 patch 挂载）在每次调用 `ctx.subagents.start()` 前恰好 stage 一个 intent，归属 provider 每次 start 恰好消费一个——因此即使并行委派，fresh 轮与 resume 轮也能正确配对。resume 轮的句柄（dsh 子会话 id）经 registry 解析，凡是未知子会话、他人 parent 的会话、或错误 provider 的句柄都会被拒绝；subagent 请求 descriptor 无法携带该目标，因此本服务就是家族内部的载体。映射按 harness 持久化在其作用域目录下的 append-only `delegations.jsonl`（同一子会话最后一行生效），resume 句柄因此能跨宿主重启存活。

### 委派调用选项（facade）

`registry.start(parent, provider, prompt, options)` 与 `registry.resume(…)` 的 `options`（`DelegationCallOptions`）——纯增量，每个字段缺位就是它出现之前的行为：

| 字段 | 作用 |
|---|---|
| `label` | 子会话显示名；缺位用 harness 自己的显示名 |
| `signal` | 调用方自己的取消通道，与 facade 内部 controller 熔合 |
| `onProgress` | 本次调用的进度回调，与 `localAgent/run-progress` 事件同样的载荷 |
| `reattach` | 仅 `resume`：子会话不在线时从持久化恢复（默认 true），传 `false` 则 fail loud |
| `cwd` | 本轮 CLI 的工作目录；resume 轮必须与首轮记录一致，否则进程启动前 fail loud |
| `exec` | 本轮在**已取得的容器里**跑：`{ container, workdir, env? }` |
| `model` | 本**次委派**跑哪个模型：只在 `start` 上接受，`resume` 传了即 fail loud——首轮请求的值记进委派记录，之后每轮照它重发（首轮没写就一直不写）。exec 与 live 都接受（provider 在起进程/runtime 时绑定它）。取值顺序见下 |
| `scope` | 本轮跑该家的**命名作用域目录**（`<homesRoot>/<家名>@<scope>`）；resume 轮必须与首轮记录的 scope 一致（含"都没有"），否则 fail loud |

**每轮的 settle 观测。** provider 在一轮的输出流解析完之后调用 `recordRoundSettled`，家族把它转成一条 `settled` 进度事件：本轮的 `observedModel`、`cliVersion`、`usage`，以及本轮的 `toolCalls`（`{ count, byName }`）。每个字段取不到就缺位，绝不猜、绝不补零。

`toolCalls` 只从 provider **已经解析过**的转录事件里数出来——不新开解析路径、不再走一遍流。`byName` 的键是各家 CLI 自己的工具词汇（codex 的 `command_execution`、claude 的 `Bash`/`Read`、kimi 与 dsh 各自事件里的工具名），原样保留、**不跨家归一**：因此横比只比 `count`，`byName` 是给人读的。归一化会凭空造出一份 CLI 之间从未约定过的等价关系。

`observedModel` 与 `cliVersion` 会并进委派记录（记录讲的是这次委派的最新状态），`toolCalls` **只走事件**：它属于某一轮，合并进记录等于用最新一轮悄悄盖掉上一轮的计数。settle 先于记录到达（记录点在各 provider 自己手里：live 轮在 session/new 时记录，exec 轮在 settle 后解析输出时记录）也不丢观测——家族先暂存，`recordDelegation` 落地时并入；exec 与 live 两条驱动路径都会上报。

**模型的五层取值顺序。** 一轮 CLI 用哪个模型，按固定顺序取第一个有值的：

1. **会话级覆盖**（成员 composer 的模型切换器设置；存内存，宿主重启即失效）
2. **本次委派的 `model`**（`start` 的调用选项；resume 轮从委派记录里读回同一个值）
3. **该家插件配置的 `model` 键**（T30a，按 provider 全局生效）
4. **该家作用域配置文件**（codex 的 `model`、claude 的 `settings.json`、kimi 的 `default_model`、dsh 继承宿主实例的默认模型选择）
5. **CLI 自己的默认**

五层都没有 = argv 上一个模型参数都不加，与这些键出现之前逐字节相同。空白算没写。

**为什么 resume 不接受 model。** 模型属于这次**委派**，不属于它的某一轮：首轮请求什么就记什么，之后每轮照发。中途换模型 CLI 会照办，而转录里看不出来——所以那是调用方的错误，fail loud，而不是被悄悄忽略的字段。要换模型走成员 composer 的切换器（下面的会话级覆盖），它在转录里是有迹可循的一层。

**成员输入栏的模型与推理配置。** 成员输入栏与 Room 协调者入口共用 core 的配置面板，显示本轮有效值、待生效选择及准备错误。常用菜单仅展示模型与强度，选择即提交；继承与 CLI 默认语义只保留为旧配置的后台兼容。设置和邀请保留已有选择，未选择时采用目录第一个可见候选；设置仍需保存。选择菜单只显示模型与强度，不提供自定义 ID、目录详情或常驻的来源诊断；目录仍在后台自动更新。设置与成员菜单均支持点击外部、按 Escape 关闭，浮层按可用空间调整方向。没有原生强度选项时显示不可用说明，不猜测候选。忙时可以选择，新值在当前完整轮次及工具续跑结束后准备生效。配置意图、版本与待生效项持久化，重启后核对原生状态；用户可撤销待生效项或重试失败准备。冻结评测成员禁止变更。legacy `setMemberModel` 接入同一控制器，不再保留忙时拒绝的另一套语义。

`effectiveSettings.model` 报的仍是**设置层往下**的答案——「一轮没有自带模型时会跑什么」，也就是条件快照要问的那个 harness 级设置；委派记录与会话覆盖不进快照。

**容器内委派（`exec` 目标）。** 给了它，provider 把 argv 换成 `docker exec -w <workdir> [-e NAME…] <container> <原 argv>`；stdio 仍是 pipe，流解析、settle、回读、`delegations.jsonl` 记录全部与宿主路径逐字节相同。家族只用 `exec` 这一个 docker 动词——取得、挂载、销毁容器是调用方（lab）的事。

- **值不上 argv。** 每个转发的变量只以 `-e NAME` 出现，值留在 docker 客户端自己的环境里由它解析——provider 解析出的凭据因此不进宿主进程表。转发集 = provider 显式 env 层里有值的项，按键被 `target.env` 覆盖；`PATH`/`HOME`/代理这些走继承白名单的变量**不转发**，容器里它们属于镜像与 `docker run`。
- **作用域目录必须由调用方点名。** `target.env` 必须给出容器内的作用域目录变量（`CODEX_HOME` / `CLAUDE_CONFIG_DIR` / `KIMI_CODE_HOME` / `DSH_HOME`），否则进程启动前 fail loud：宿主路径在容器里什么都不是，照转会让 CLI 从一个空目录起步——没凭据、没有可回读的 rollout，而且失败原因不出现在任何输出里。
- **作用域目录是宿主目录、rw bind 挂进容器。** 回读（codex 的 rollout、kimi 的 wire log、子 dsh 的会话日志）直接读宿主文件系统，凭据续期也回写到宿主目录。**挂什么由调用方备好**：把活的作用域目录整个挂进去，宿主专用的设置会跟着进去（实测：claude 作用域 `settings.json` 里给宿主守护进程用的 `https_proxy` 在容器里指向不存在的地址，本轮当场 `Connection refused`）。
- **容器轮是 exec-only、且没有成员通道。** 长驻驱动跑的是宿主上的常驻进程，正是 `exec` 目标要替换的传输；成员桥是宿主 unix socket，其 MCP 声明还带着宿主 node 路径。两者都是明确放弃，不是没接上。
- **resume 由调用方重复同一个目标。** 记录里的锚是宿主 `cwd`，换了容器它仍然相等——这一条记录抓不到。

### 命名 scope：一家多份作用域目录

缺省作用域目录是 `<homesRoot>/<家名>`——逐字节还是那一份。给一个**名字**（只允许 `[a-z0-9-]`，是名字不是路径）就得到与它**同级**的另一份：`<homesRoot>/<家名>@<名>`。不嵌在缺省目录里面，因为那份目录归各家 CLI 自己管，往里塞第二棵状态树迟早被它自己清掉或读串。

- **惰性建立。** 目录在第一次被点名时创建（`/<家> login|status|sessions|logout --scope <名>`、带 `scope` 的委派、评测的挂载源都算点名）：`mkdir` 0700，然后跑该家自己的 provision（codex 的 `config.toml`、kimi 的 provider/model 配置与权限、claude 的作用域目录、dsh 的子 profile）。缺省目录的 provision 时机不变——仍由各 harness bundle 的 apply 负责。
- **刻意 provision 一个 scope：`provisionScope(家, 名, 选项)`。** 上面那次是「有人点了这个目录的名」的副作用：每进程每 (家, scope) 只跑一次、不带选项、失败只留一行日志。`provisionScope` 是刻意的那一次——它**等**（并且先等掉上面那次可能刚启动的那一遍，两个写者写的是同一批文件）、**抛**（问了要有答复，失败不能读成成功），并把该家的**回读**交回来。选项目前只有一项 `preset`：preset 是**受试对象**的属性而不是部署的，一条评测条件说「这个 scope 组这个 preset」时，知道答案的是条件文档，而插件 config 一个实例只有一份。只有 dsh 读这一项；另三家收下参数并忽略，provisioning 因此逐字节不变。
- **凭证不复制。** 新 scope 是空的：`status` 报 `credentialState: absent`，委派按今天的规则失败，要用它先 `/<家> login --scope <名>` 登一次。claude 的 keychain 项按配置目录路径哈希，命名 scope 因此自动拿到自己的项——这是四家里唯一天然按路径安全的部分。
- **一切按目录走。** 该 scope 的会话记录、`delegations.jsonl`、effective-settings 快照（harness 的 `effectiveSettings(homeDir)` 收目录参数）、CLI 版本探测、登录态与委派回读，全部落在它自己的目录里。委派记录带 `scope`，resume 轮拿它当锚：换了 scope（或首轮有、这轮没有）在进程启动前就拒绝——继续同一个 CLI 会话却换了账号，是事后修不回来的那种错。
- **边界（明确放弃，不是没接上）。** 带 scope 的委派**只走 exec**：常驻驱动（codex 的 app-server、claude/kimi 的 ACP、子 dsh 的 serve）按成员绑的是缺省作用域目录，撞上 live 直接拒绝而不是悄悄降级。kimi 的成员桥声明写在作用域目录的 `mcp.json` 里、`member-bridge.sock` 又是 homes 根级单例，所以带 scope 的 kimi 轮不带成员通道。dsh 的子 profile 随目录走，不需要特殊处理。

### 活跃委派 registry 与 `/local-agent stop`

registry 另持有**活跃委派 registry**（以 dsh 子会话 id 为键的在飞 run 表）：facade 启动的 run（`start`/`resume`——成员 composer、room 等程序化入口）与家族工具直接 `ctx.subagents.start()` 启动的 run（经 `trackDelegationRun` 登记）都落在同一张表里，条目在 run 结果 settle 时自清。`/local-agent stop <childSessionId>` 命令按这张表取消在飞的委派——语义对齐官方 `subagents.interrupt(targetSessionId)`：fire-and-return（发出取消信号即回复），目标缺席（未知子会话或无在飞 run）是显式说明的 accepted no-op，而非报错。这为 taskpilot 等表面提供了停止按钮的落点：对没有 live agent 的一次性子代理行，按钮改发 `/local-agent stop <childSessionId>`，local-agent 缺席时降级为无法停止的明确报错。

### Model Experience

**模型看到什么**——registry 本身不提交任何内容：`/<harness>` 命令回复与 `/local-agent list` roster 文本都是用户可见的命令文本，绝不是模型 prompt。模型可见效果只从 harness bundle 挂载 subagent provider 开始；父级随后通过 subagent 工具结果看到子会话的最终回答。

**Token 影响**——命令发现、执行与回复文本不产生任何模型 token。委派 token 属于 harness bundle 的 provider，由它为一个独立的子上下文付费。

**KV Cache 影响**——registry 元数据与命令回复从不进入模型请求、不影响其缓存；被委派的子会话独立拥有自己的缓存。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent`）。问题与贡献请移步该仓库。
