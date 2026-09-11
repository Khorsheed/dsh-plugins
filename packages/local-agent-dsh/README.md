# `@khorsheed/dsh-local-agent-dsh`

[English](README.en.md) | 中文

把任务委派给 dsh 自己——作为独立的本地 CLI 进程运行，与 kimi / codex / claude-code harness 平级。子 dsh 在自己的 scoped home 下运行，通过父级的 API key 认证，可跨轮续接；设置开关（默认关）打开后才启用委派工具。

## 特性

- **委派给 dsh 自己**——spawn 一个子 dsh headless CLI 进程。
- **Scoped home**——自己的 `DSH_HOME`（`$DSH_HOME/local-agent/dsh`）：profile、会话与状态绝不混入父实例。
- **跨轮续接**——把子会话 id 传回即可续接同一个子 dsh 会话。
- **无需单独登录**——通过父级的 `DEEPSEEK_API_KEY` 认证，无 device-code 流程。
- **DeepSeek 开关，默认关**——在 设置 → 本地 Agent 打开开关之前，模型看不到任何委派工具。
- **模型回读与独立工作目录**——每轮从子会话事件的 source 回读实际模型（`provider/model`），写进委派记录；编排器可用 `cwd` 选项给每格独立目录，resume 换目录即拒绝。
## 安装

家族核心与本 bundle 必须在同一条命令里指名，然后重启 profile：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-dsh
```

无需登录步骤；`/dsh status` 报告父级的 `DEEPSEEK_API_KEY` 凭据是否可解析。

tarball 安装（npm 上未发布的家族包）需要在 profile 的 `pnpm-workspace.yaml` 里把各家族包名 `overrides:` 钉到 `file:` tarball——tarball 内的家族边是 registry range，钉版让 headless 等成员以**传递**依赖解析（headless 自身不声明 `dsh.bundle`，即便被误装成直接依赖也不会被挂进组合，但无需如此）。

卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-dsh
```

scoped home（`$DSH_HOME/local-agent/dsh`）被有意保留——里面存着子 dsh 自己的会话；删除它即清除所有痕迹。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `profileName` | `headless-local-agent-dsh` | scoped home 下的子 dsh profile |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | 子 dsh 解析的凭据引用 |
| `cliLaunch` | 父级自身启动 | dsh 启动 argv 前缀覆盖 |
| `headlessBundleDir` | 从安装解析 | 子 profile 符号链接指向的 headless bundle 目录（scoped home 被多个文件系统解析时**必须 pin**，见下文「容器内委派」） |
| `live` | `false` | 长驻驱动：每成员常驻一个 `--serve` 子 dsh 进程，委派 = 向活着的 runtime 发 turn（runtime 级优雅中断、事件推送镜像）；关闭或通道不可用即回一次性 exec 路径 |
| `liveIdleMs` | `1800000`（30 分钟） | 长驻 runtime 的空闲回收时限 |
| `liveMirrorGranularity` | `event` | live 镜像粒度；`token` 的增量经运行进度通道实时上报，但宿主 0.1.5 移除了逐 chunk 会话事件，增量不再写入子会话日志，轮次以一条合并消息落定（最终文本不变） |

### 默认模型（`model`）

T30a 给三家 CLI harness 加了 `model` 插件配置键时，dsh 没拿到——因为无头子 dsh 的启动面上当时没有可以按次指定模型的位置。**现在有了**：headless 的 `--model <provider/model>` 覆盖子实例的默认模型选择，所以这个 harness 也有了同一把键。

**不写 = 今天的表现。**没有这个键时，本插件在 argv 上不加 `--model`：跑哪个模型由宿主实例自己的 `agentDefaultModel` 当前选择决定，与从前一模一样。

**写了 = 每轮委派以它起子 dsh。**新起一轮与续接（resume）同等对待，`--model` 排在 `--session-id` / `--resume` 之后。值写成 `provider/model`（与 `effectiveSettings.model` 报的形状相同）；只写模型名则沿用宿主实例的 provider。按第一个 `/` 切分，所以模型 id 里再带斜杠也不会被切坏。

设置卡「默认模型」写的是同一个键：一个自由输入框（不内置任何模型目录）加上此前存过的值作为候选，保存即生效于**下一轮**委派，不需要重载；清空后保存即取消该键。

**委派级的模型优先。**编排器可以经门面 `DelegationCallOptions.model` 给**某一次委派**点名模型，它排在这个键之前（顺序见家族核心 README 的四层）。首轮请求的值记进委派记录，resume 轮照它重发——resume 不接受 model 参数。带委派级 model 的轮次是 exec-only：常驻 `--serve` 子 dsh 在起进程时就用自己的 `--model` 绑定了模型，之后托管它拿到的每个会话。

**这不是评测的缺口。**评测 run 的条件在建立时冻结：run 跑到一半改这个键，下一轮的模型回读会发现声明模型 ≠ 实测模型，run 直接判为 misattributed 而失败（冻结决策 5）。

**评测快照（effectiveSettings）。** 本 harness 向注册表声明的公平性设置快照有 drive(exec/live)、端点未固定、CLI 版本(拿委派真正要 spawn 的那条 launch argv 去问 `--version`,按入口脚本路径+mtime 缓存——无头子 dsh 复制的就是父实例自己的 build)与已配置模型(读宿主 `agentDefaultModel` 的当前选择,`provider/model` 格式——无头子 dsh 继承它;服务缺位或选择不可读就不给字段,绝不猜值)：无头子 dsh 没有沙箱或权限旋钮（web-eval 冻结基线称其无限制——字段缺位本身就是诚实的条件输入），端点即宿主实例的模型配置，本 provider 从不覆盖。`/dsh status` 与 `LocalAgentStatus` Remote 附带同一份快照。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：⚠️ 降级一处——`liveMirrorGranularity: token` 不再逐字写入子会话日志（宿主移除逐 chunk 事件），增量改走运行进度通道、轮次以一条合并消息落定（最终文本不变）；其余完整（适配 format v2/v3 与 handle 制 sessionPersistence，全量构建测试通过）；minHost 前移至 0.1.5-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）

## 已知限制

- 无交互式或 device-code 登录流程——子 dsh 只能通过父级的 `DEEPSEEK_API_KEY` 凭据认证；`/dsh login` 报告该 harness 无登录流程。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**会话日志按代次解析，不写死文件名。** 子 dsh 的历史住在 `<作用域目录>/sessions/<项目>/<会话 id>/` 里，但**哪个文件**是宿主的代次选择：最初的一代叫 `session.jsonl`，此后每一代带一个小写 `vN`——宿主 0.1.5 写的是 `session.v3.jsonl.zstd`；两种基名都可能再带 `.zstd`（压缩是缺省）。本包按宿主自己的规则解析目录里的每个条目（`^session(\.v[1-9][0-9]*)?\.jsonl$`，去掉压缩后缀后匹配——`.v0`、前导零、大写、`session.lock` 与临时文件都不是代次），取**版本号最高**的那一份，并把选中的文件名带回读回结果（`sessionLogFile`）。

写死一个文件名的代价是实测过的：宿主升到 0.1.5 之后，一轮委派照样 settle 成 `completed`，而 observedModel、usage、toolCalls **三样一起变成缺位**，`/dsh sessions` 一条都列不出来——读不到日志与「这一轮什么都没产生」在下游长得一模一样。会话镜像与 `/dsh sessions` 因此走同一个解析函数：两个读者不可能对「历史在哪个文件里」有不同看法。旧线的 `session.jsonl(.zstd)` 继续认，历史目录照读。

**模型回读与 cwd 覆盖。** 每轮 settle 后，provider 从子会话事件自身读取实际模型：本轮最后一个 `assistant/message` 事件的 `message.source`，格式化为 `provider/model`（与 effectiveSettings 快照报告已配置模型的形状一致）随 `settled` 进度事件上报，并合并进 `delegations.jsonl` 的 `observedModel` 字段；取不到即缺位，绝不猜测。编排器还可以经门面 `DelegationCallOptions.cwd` 给本轮指定工作目录（记录进 `cwd` 字段）；resume 轮解析出的目录若与首轮记录不一致，进程启动前即 fail loud——CLI 会话延续的是首轮所在目录的上下文。

**工具调用计数。** 每轮 settle 时，provider 顺带数出本轮的工具调用，随 `settled` 进度事件上报（`toolCalls: { count, byName }`）。数的是**本轮窗口**（模型与用量取的同一段 roundSpan）里的 `tool/call` 事件，按事件自带的工具名归类——因此 live 轮询已经镜像过的一轮，settle 那遍照样报得出真实计数。本轮一份，绝不累计；一次都没调用就整个字段缺位（缺席 ≠ 0）。

**命名 scope。** 带 scope 的委派跑 `<homesRoot>/dsh@<名>`：子 profile 随目录走——目录建立时就地 provision 一份，因此该 scope 的轮从它自己的 profile 起 sub-dsh、会话日志也写在它自己那儿。凭据不在目录里（dsh 通过宿主实例认证），所以命名 scope 换的是 profile 与会话记录，不是账号。只走 exec：长驻 `serve` 按成员绑的是缺省目录。

**按 scope 的 preset roster（能力面成为因子）。** 子 profile 的 patch 可以多带一层：一条 `insert` 行挂 `@deepseek-ai/dsh-agent-presets`，`default` 写这个 scope 的 preset id；headless 的 agent loader 在 agent setup 里 join 它。不带这一层就是本字段出现之前的表现——模型可见的行在宿主面，agent 从全局层读。带上之后**这个作用域目录就是能力面**：两个 scope 的 roster 写两个 preset，就是两个受试对象，差别是一份人能读的文件。

```ts
import { provisionDshSubProfile, readSubProfilePreset } from '@khorsheed/dsh-local-agent-dsh/provision'

provisionDshSubProfile(scopedHome, { preset: { id: 'eval-lean' } })
readSubProfilePreset(scopedHome)   // 'eval-lean'——生成的层也是可解析的层
```

preset 目录从哪来：子 dsh 以 `DSH_HOME=<作用域目录>` 启动，所以 roster 自带的用户根就是 `<作用域目录>/.agent-presets`——把一份 preset 目录放在那里，这个 scope 就有了自己的 preset（`roots` / `includeShippedRoot` / `includeUserRoot` 可另行指定）。roster 模块**不软链**：它是官方包，本来就在 dsh 安装锚点的闭包里、与 `@deepseek-ai/dsh-base` 并列。链第二份会给它第二份 `@deepseek-ai/cordis`，而 cordis 按实例身份做服务查找与类型判断，症状是静默的服务缺失而不是报错（与上文「双文件系统契约」里 bundle 那一节同一个坑）。锚点里真没有它的部署会拿到 loader 自己那句「模块解析不了」，比这一步能说的更准。preset id 只接受 `[a-z0-9][a-z0-9-]*`（它是目录名）。撤掉 `preset` 再 provision 一次，这一层原样消失。

**容器内委派。** 编排器可以经门面 `DelegationCallOptions.exec`（`{ container, workdir, env? }`）让本轮跑在一个**已取得的容器**里：argv 变成 `docker exec -w <workdir> [-e NAME…] <container> <原 argv>`，其余（会话镜像、settle、记录）逐字节不变。`env` 必须给出容器内的 `DSH_HOME`；解析出的 API key 只以 `-e DEEPSEEK_API_KEY` 的**名字**上 argv，值留在 docker 客户端环境里，不进宿主进程表。容器轮另有两条本包独有的行为。其一，**自动补 `NODE_OPTIONS=--use-env-proxy`**（调用方在 `target.env` 里自己给了就不覆盖）：dsh 的 HTTP 客户端是 node 的 `fetch`（undici），**默认不读** `HTTP(S)_PROXY`，在只有白名单代理、没有 NAT 出网的单元里会直连 API 并当场失败，而代理连一条 `CONNECT` 都收不到；这个开关打开 undici 的 `EnvHttpProxyAgent`。四家里只有 dsh 需要它，因此由 provider 自动补上，并在 `effectiveSettings.containerNodeOptions` 里报出来让条件文件看得见。其二，**跳过宿主侧子 profile 的 provisioning**：那份 profile 的 `node_modules` 符号链接指向宿主上的 headless bundle，在单元里解析不到；而作用域目录是 bind 挂载的，写进去等于在单元真正会读的目录里放一份坏 profile。容器轮的入口与 profile 由调用方用既有旋钮点名（`cliLaunch`、`profileName`），且**单元里必须备好家族 headless bundle 及其运行期依赖闭包**——镜像自带的 in-box `headless` profile 是另一个更小的 app，不认 `--session-id`/`--resume`，不足以承载一次委派轮。实测：`eval-env:pinned` 单元里备好之后，一次「回答 2+2」settle 为 `completed`、输出 `4`，`observedModel` 从容器写进宿主作用域目录的子 dsh 会话日志里回读为 `deepseek-official/deepseek-v4-flash`。

**同一 scoped home 被多个文件系统解析时（双文件系统契约）。** 当 scoped home 同时被宿主（判官委派、就绪检查）和容器单元（bind 挂载）读写——例如 T20c「一个主人，一个目录」的评测布局——子 profile 里那条 `node_modules` 符号链接的目标是一个**字符串**，由读到它的文件系统各自解释：指向宿主安装路径时链接在单元里悬空，而宿主侧就绪重探会重新 provision、把宿主专用路径再写回去（跳过容器轮自己的 provisioning 防不住这条**已存在**的链接）。契约只有一条：**把 `headlessBundleDir` pin 到一条在两个文件系统里都成立的绝对路径**——宿主侧在同名路径建一条符号链接指向宿主安装里的 bundle（Node 按 realpath 解析，其依赖闭包随之可用），镜像侧在同名路径放真安装。pin 住之后，就绪检查的重 provision 只是把同一目标重写一遍，不再产生宿主专用路径。两个被评估后否决的替代：其一，**把 bundle 拷进 scoped home**——家族代码在运行期从 `@deepseek-ai/*` 导入的是服务键与类（`credentialRef`、`TypertRemoteService`、`SessionId` 等），拷一份闭包会让这些包出现第二份实例，cordis 按实例身份做服务查找与类型判断，症状是静默的服务缺失而非报错；bundle 的 `@deepseek-ai` peer 必须从**运行该子 dsh 的同一份安装**解析，pin 在两个运行时里都保住了这一点，拷贝必然破坏。其二，**给单元加第二条 bundle 挂载**——破坏 T20c「挂载只有一条」的立场，且只有 dsh 一家需要。pin 因此是调用方的一条机器级前置条件（写进题库 env/README），本包零代码改动。

**DeepSeek 开关。** 与其他家族 harness 不同，本包默认不挂载任何模型可见的东西。互斥开关位于 dsh harness 行的动作区内（设置 → 本地 Agent，namespace `local-agent-dsh`，默认 off）：OFF 时委派走官方 in-process subagent 工具；ON 时注册 `dsh` harness、`dsh-cli` 委派 provider 与家族工具 `subagent_dsh`，与官方工具并存——两种委派形态语义不同（in-process continuable vs. 独立 CLI 进程），家族工具描述让模型可以区分。开关经 settings watcher 实时翻转组合。

**委派。** provider 生成一个 uuid（`session-<uuid>`），记录委派（`childSessionId → cliSessionId` 恒等映射），并 spawn `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"`，env 为 `{ DSH_HOME: <scoped home>, DEEPSEEK_API_KEY: <resolved> }`，cwd 为父会话 cwd。headless bundle（`@khorsheed/dsh-local-agent-dsh-headless`）用该确切 id 创建会话——id 由调用方提供，绝不从 stdout 解析——运行任务、打印最终助手文本、退出 0/1。后续轮把子会话 id 作为 `resume` 传入；provider spawn `--resume <uuid>`，子 dsh 经 `agents.resume` 续接同一会话。

**长驻驱动（`live: true`）。** 替代每轮 spawn：成员首轮委派拉起一个常驻 `--serve` 子 dsh 进程，之后每轮 = 经家族内部 stdio JSON-RPC wire（headless 包 `src/wire.ts`）向活着的 runtime 发 `turn/start`；会话事件以 `session/event` 通知即时推回并逐事件镜像进子会话（与文件镜像同一折叠规则，settle 时再跑一次文件镜像做对账），`cancel` 落地为 runtime 级 `turn/interrupt`（进程内 `Agent.cancel`）——进程不死、会话可续。runtime 空闲超时回收（wire `shutdown` → SIGTERM 阶梯），崩溃后下一轮自动重连并 `agents.resume` 盘上会话；spawn/握手失败标记通道不可用并永久回退 exec 路径。

**认证与供给。** 无 device-code 登录：子 dsh 通过父级的 `DEEPSEEK_API_KEY` 凭据认证（`apiKeyRef` 配置）；`/dsh status` 报告凭据是否可解析，`/dsh sessions` 从 scoped-home 存储列出子 dsh 自己的会话。子 profile 位于 `profiles/headless-local-agent-dsh`：一个 manifest（只列 `@deepseek-ai/dsh-base`）、headless 包的 patch 逐字节拷贝成的 profile 自己的 patch 层、一条解析 headless bundle 的符号链接（供 loader 解析 insert 行）——其余一切从 dsh 安装锚点解析，供给零 pnpm install 成本且幂等，内容漂移时自动重写（升级与旧格式自愈）。父级复制自己的启动方式（或配置 `cliLaunch`），让子 dsh 与父级跑同一个 dsh 构建。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-dsh`）。问题与贡献请移步该仓库。
