# @khorsheed/dsh-local-agent-dsh

[English](README.en.md) | 中文

把任务委派给 dsh 自己——一个跑在隔离 home 里、可跨轮续接的无头子 dsh，与 kimi / codex / claude-code harness 平级。

有些子任务值得一个完整而隔离的 dsh 实例：评测对照、独立的会话历史、自己的权限边界——同时绝不碰当前实例的状态。这个插件 spawn 一个子 dsh headless CLI：它在自己的 scoped home 下运行（profile、会话、状态全独立），用父级的 DeepSeek API key 认证，会话 id 由调用方指定、可跨轮续接。默认什么都不挂——在设置卡片上打开「DeepSeek 委派」开关后，模型才看得到 `subagent_dsh` 工具。

## 特性

- **委派给 dsh 自己**——spawn 一个子 dsh headless CLI 进程：一次性 exec（默认），或每成员常驻一个 `--serve` 进程的长驻驱动（`live: true`，runtime 级优雅中断、事件推送镜像）。
- **Scoped home 隔离**——子 dsh 自己的 `DSH_HOME`（`$DSH_HOME/local-agent/dsh`）：profile、会话与状态绝不混入父实例。
- **跨轮续接**——子会话 id 由调用方指定（`session-<uuid>`，绝不从 stdout 解析），后续轮传回即经 `--resume` 续接同一个子 dsh 会话。
- **无需单独登录**——子 dsh 通过父级的 `DEEPSEEK_API_KEY` 认证，无 device-code 流程；`/dsh status` 报告凭据是否可解析。
- **DeepSeek 委派开关，默认关**——开关打开之前模型看不到任何委派工具，委派只走官方内置子代理；开关经 settings watcher 实时翻转，无需重载。
- **过程实时可见**——子 dsh 的增量输出逐事件镜像进父会话的子代理面，settle 时再以文件镜像对账。
- **模型回读与独立工作目录**——每轮从子会话事件的 source 回读实际模型（`provider/model`），并数出本轮工具调用计数，一并写进委派记录；编排器可用 `cwd` 选项给每格独立目录，resume 换目录即拒绝。
- **评测就绪的供给**——命名 scope、按 scope 的 preset roster、`permissions` 权限边界、容器内委派（`docker exec`），全部经幂等的子 profile provisioning 落地。

## 安装

家族核心与本 bundle 必须在同一条命令里指名，然后重启 profile：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-dsh
```

重启后在本包的设置卡片（插件详情页；0.1.5 宿主：设置 → 插件 → 插件配置）打开「DeepSeek 委派」开关。无需登录步骤；`/dsh status` 报告父级的 `DEEPSEEK_API_KEY` 凭据是否可解析。

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
| `permissions` | 不写（跟随 dsh-base） | 子 dsh 的权限档：`read-only` / `workspace-write` / `danger-full-access`，由 provisioning 写进子 profile 的 patch 层，见下文「权限边界」 |
| `model` | 不写（跟随宿主默认） | 每轮委派以它起子 dsh（`--model <provider/model>`），见下文「默认模型」 |
| `live` | `false` | 长驻驱动：每成员常驻一个 `--serve` 子 dsh 进程，委派 = 向活着的 runtime 发 turn（runtime 级优雅中断、事件推送镜像）；关闭或通道不可用即回一次性 exec 路径 |
| `liveIdleMs` | `1800000`（30 分钟） | 长驻 runtime 的空闲回收时限 |

### 默认模型（`model`）

T30a 给三家 CLI harness 加了 `model` 插件配置键时，dsh 没拿到——因为无头子 dsh 的启动面上当时没有可以按次指定模型的位置。**现在有了**：headless 的 `--model <provider/model>` 覆盖子实例的默认模型选择，所以这个 harness 也有了同一把键。

**不写 = 今天的表现。**没有这个键时，本插件在 argv 上不加 `--model`：跑哪个模型由宿主实例自己的 `agentDefaultModel` 当前选择决定，与从前一模一样。

**写了 = 每轮委派以它起子 dsh。**新起一轮与续接（resume）同等对待，`--model` 排在 `--session-id` / `--resume` 之后。值写成 `provider/model`（与 `effectiveSettings.model` 报的形状相同）；只写模型名则沿用宿主实例的 provider。按第一个 `/` 切分，所以模型 id 里再带斜杠也不会被切坏。

设置卡「默认模型」修改后续轮次使用的 provider 配置。共享选择器展示当前作用域的模型目录、发现来源和完整性，并保留按需填写模型 ID 的入口。清空选择后跟随有效配置及默认值链。保存不会打断当前轮次，也无需重载；共享选择器不可用时，卡片保留文本输入兜底。成员级模型和推理强度修改使用下文的持久控制面。

丰富目录还通过可用的公开 `resolveModelInfo` 保留适配器显示名、解析路由和原生推理选项。目录共用 core 缓存与刷新订阅，区分部分枚举，整体刷新失败保留成功数据。宿主目录不证明被单独修改的 scoped 运行时配置相同。共用模型菜单和成员 effort 控制已接入。运行中选择排到下一完整轮次（含工具续跑）；core 统一持有当前/待生效配置、撤销与重试，冻结评测成员禁止变更。

**委派级的模型优先。**编排器可以经门面 `DelegationCallOptions.model` 给**某一次委派**点名模型，它排在这个键之前（固定顺序：会话覆盖 > 委派记录 > 本键 > 宿主默认选择 > CLI 内置）。首轮请求的值记进委派记录，resume 轮照它重发——resume 不接受 model 参数。常驻模式下带模型的轮次不再被拒绝：它成为该成员的**起始模型**，在 `--serve` 子 dsh 起进程时以 `--model` 绑定；若该成员的常驻 runtime 绑定的是另一个模型，先回收重生（子 dsh 会话从盘上 resume 续上），再以所点模型起新一轮。

**成员级切换（作曲器模型选择器）。**成员会话里可以按会话切换模型：一个内存中的会话级覆盖，优先级最高，宿主重启即失。切换在有轮次进行中时被拒绝；空闲时若成员有常驻 runtime 且绑定模型不同，切换即回收该 runtime——下一轮以新模型重生，子 dsh 会话本身延续。一次性（exec）驱动下没有常驻进程，覆盖直接决定下一轮的 `--model`。

**这不是评测的缺口。**评测 run 的条件在建立时冻结：run 跑到一半改这个键，下一轮的模型回读会发现声明模型 ≠ 实测模型，run 直接判为 misattributed 而失败（冻结决策 5）。

**评测快照（effectiveSettings）。** 本 harness 向注册表声明的公平性设置快照有 drive(exec/live)、端点未固定、CLI 版本(拿委派真正要 spawn 的那条 launch argv 去问 `--version`,按入口脚本路径+mtime 缓存——无头子 dsh 复制的就是父实例自己的 build)与已配置模型(读宿主 `agentDefaultModel` 的当前选择,`provider/model` 格式——无头子 dsh 继承它;服务缺位或选择不可读就不给字段,绝不猜值)：`sandbox` 是子 profile 钉住的权限档，**配了才报**（缺位仍然是诚实的条件输入——这个作用域不钉边界，跑的就是 dsh-base 组成的那一档），端点即宿主实例的模型配置，本 provider 从不覆盖。`/dsh status` 与 `LocalAgentStatus` Remote 附带同一份快照。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 公开 API 兼容；minHost 为 0.1.5-rc.1，更旧宿主留在前一发布线。生成中的内容走 local-agent 瞬时 Remote 与公开 Conversation 节点；后缀检查点负责恢复，最终原生消息保留转写与用量语义。浏览器 P95 另在 room 协调者提案中验收。一处设计内降级：宿主 0.1.5 退役了逐 chunk 的会话事件，token 粒度的增量不再落进子会话日志——它们改走 run-progress 通道，本轮 settle 为一条合并的 `assistant/message`（最终文本相同）；迟到的 usage 若其载体消息已镜像，则以一条 warn 丢弃（不存在 usage 回填事件）。旧 `liveMirrorGranularity: event | token` 配置继续兼容读取，但不再影响行为，也不会改变运行中的进程；评测继续保留 exec。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）

## 已知限制

- **无交互式或 device-code 登录流程**——子 dsh 只能通过父级的 `DEEPSEEK_API_KEY` 凭据认证；`/dsh login` 报告该 harness 无登录流程。
- **命名 scope 只走一次性 exec**——长驻 `serve` 进程按成员绑的是缺省 scoped home，命名 scope 的委派不走 live 驱动。
- **宿主 0.1.5 上 token 级增量不进子会话日志**——见 Compatibility 的降级说明；最终合并文本与逐 token 镜像完全一致。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**DeepSeek 开关。** 与其他家族 harness 不同，本包默认不挂载任何模型可见的东西。互斥开关位于 dsh harness 行的动作区内（设置卡片，namespace `local-agent-dsh`，默认 off）：OFF 时委派走官方 in-process subagent 工具；ON 时注册 `dsh` harness、`dsh-cli` 委派 provider 与家族工具 `subagent_dsh`，与官方工具并存——两种委派形态语义不同（in-process continuable vs. 独立 CLI 进程），家族工具描述让模型可以区分。开关经 settings watcher 实时翻转组合。

**委派。** provider 生成一个 uuid（`session-<uuid>`），记录委派（`childSessionId → cliSessionId` 恒等映射），并 spawn `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"`，env 为 `{ DSH_HOME: <scoped home>, DEEPSEEK_API_KEY: <resolved> }`，cwd 为父会话 cwd。headless bundle（`@khorsheed/dsh-local-agent-dsh-headless`）用该确切 id 创建会话——id 由调用方提供，绝不从 stdout 解析——运行任务、打印最终助手文本、退出 0/1。后续轮把子会话 id 作为 `resume` 传入；provider spawn `--resume <uuid>`，子 dsh 经 `agents.resume` 续接同一会话。

**长驻驱动（`live: true`）。** 替代每轮 spawn：成员首轮委派拉起一个常驻 `--serve` 子 dsh 进程，之后每轮 = 经家族内部 stdio JSON-RPC wire（headless 包 `src/wire.ts`）向活着的 runtime 发 `turn/start`；会话事件以 `session/event` 通知即时推回并逐事件镜像进子会话（与文件镜像同一折叠规则，settle 时再跑一次文件镜像做对账），`cancel` 落地为 runtime 级 `turn/interrupt`（进程内 `Agent.cancel`）——进程不死、会话可续。折叠规则是逐字拷贝：调用方任务的 `user/message`、每条 `assistant/message`、工具事件对，以及子 dsh 自己的 `step/start`–`step/end` 边界对（各带自己的 (turn, step) 坐标）都过河——宿主实时会话视图只在边界上登记 step，缺了边界 assistant 消息要等整页重建才渲染；turn 边界与脚手架用户消息（agent-instructions、plugin 等来源）留在子侧，被 interrupt 的 step 以开口对（有 start 无 end）原样过河，绝不合成边界。runtime 空闲超时回收（wire `shutdown` → SIGTERM 阶梯），崩溃后下一轮自动重连并 `agents.resume` 盘上会话；spawn/握手失败标记通道不可用并永久回退 exec 路径。

**认证与供给。** 无 device-code 登录：子 dsh 通过父级的 `DEEPSEEK_API_KEY` 凭据认证（`apiKeyRef` 配置）；`/dsh status` 报告凭据是否可解析，`/dsh sessions` 从 scoped-home 存储列出子 dsh 自己的会话。子 profile 位于 `profiles/headless-local-agent-dsh`：一个 manifest（只列 `@deepseek-ai/dsh-base`）、headless 包的 patch 逐字节拷贝成的 profile 自己的 patch 层、一条解析 headless bundle 的符号链接（供 loader 解析 insert 行）——其余一切从 dsh 安装锚点解析，供给零 pnpm install 成本且幂等，内容漂移时自动重写（升级与旧格式自愈）。父级复制自己的启动方式（或配置 `cliLaunch`），让子 dsh 与父级跑同一个 dsh 构建。

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

**scope 自带 preset 副本（容器轮唯一可行的形态）。** 上面那条把 preset 目录放进 `<作用域目录>/.agent-presets` 的做法，`provisionDshScope` 把它变成一条可核对的流程——而且它是**容器轮唯一跑得通的形态**：一个评测单元 bind 挂进去的只有 scoped home，roster 若把 `roots` 指向部署的 preset 根，那条路径在单元里根本不存在，子 dsh 起不来（`preset "eval-lean" not found`）。副本放在 scope 自己的用户根上，宿主是 `<scope>/.agent-presets/<id>`、单元里是 `/creds/dsh/.agent-presets/<id>`——同一个目录，因为单元挂的就是 scope。

```ts
import { provisionDshScope, readScopeSubProfile } from '@khorsheed/dsh-local-agent-dsh/provision'

// 显式请求：从部署的 preset 根重新同步副本，并把决定持久化进 scope
provisionDshScope(scopedHome, config, { preset: 'eval-lean', presetRoot })
readScopeSubProfile(scopedHome)   // { preset: 'eval-lean' }
// 之后任何一次 provisioning（重启后的 materialize、宿主轮的自愈）都不必再被告知
provisionDshScope(scopedHome, config, { presetRoot })
```

三件事值得单独说：

- **preset 从哪儿解析出来**：*显式参数 → `<作用域目录>/sub-profile.json` → 插件 config*。中间那一档不是可选的便利：本模块**整份重写** `cordis.patch.yml`，而注册表在每个新宿主进程里第一次有人点名该 scope 时会重新 provision 它——手写进 patch 的 roster 层会就这样静默消失，下一次回读报「这个 scope 没有可读的 roster」。scope 自己那份声明是它活下来的方式，也是「两个 scope 各 roster 一个 preset」在一个**实例级** config 上唯一表达得出来的方式。
- **副本什么时候刷新**：只有带显式 `preset` 参数的那一次（评测的 `conditions provision`）会从部署的 preset 根重新同步。其余任何一次 provisioning 只在副本**不存在**时才复制，存在就原样留着并**报告**它是否仍与源逐字节相同——run 底下的受试对象不许被任何东西挪动。
- **作因子的 preset 不得写绝对路径**：同一份 preset 会被从三个目录读到（部署的 preset 根、scope 的副本、单元里的挂载点），绝对路径至少在其中两处是错的，而且 `skill-filesystem` 把读不到的根当空根，所以错得静音。要相对就用 loader 自己的表达式，官方 `cordis` preset 的写法：`!!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"`——`baseUrl` 是该组合文件自己的目录。带绝对路径的 preset 在快照这一步就被拒，消息里带这句写法。

**权限边界（`permissions`）。** 子 dsh 跑 bash 时的文件效应边界与审批策略，由 provisioning 多写一层 patch：两条**覆盖**行钉住 `sandbox-policy` 的 `mode` 与 `user-approval` 的 `policy`（两者按 dsh-base 自己的 `permission-presets` 表配对——`danger-full-access` 配 `never`，另两档配 `ask`；分开钉两个插件而让它们漂开，等于造一个跑不进去也问不到人的边界）。不写这一项就一层都不写，子 dsh 跑 dsh-base 组成的 `workspace-write` + `ask`——与本字段出现之前逐字节相同。

```ts
import { provisionDshSubProfile, readSubProfilePermissions } from '@khorsheed/dsh-local-agent-dsh/provision'

provisionDshSubProfile(scopedHome, { permissions: 'danger-full-access' })
readSubProfilePermissions(scopedHome)   // 'danger-full-access'——生成的层也是可解析的层
```

**为什么钉在作用域目录而不是环境变量。** dsh-base 那两行本来读 `DSH_PERMISSION_MODE`，但这个值属于受试对象：写进子 profile，它就随作用域目录走——包括被 bind 挂进容器单元的那一份，`home.sha` 已经把它哈希在内；走 spawn env 则每个变量名都要进单元的复合指纹，且与条件无关的键越多，「只差一个因子」越难说清。层落在 base 层之后，所以字面值压过那个环境变量，边界不再取决于谁起的进程。

**什么时候该钉 `danger-full-access`。** 只在**别的东西已经是边界**的时候：一次性评测单元、用完即毁的容器。在开发机上子 dsh 共享的是真实 home，`workspace-write` 才是对的默认值——这也是不写这一项时的表现。反过来，**单元里不钉就是跑不了 shell**：容器镜像通常既无 bubblewrap，内核也不给 Landlock（实测 `landlock-run` 的探针报 `unusable`），沙箱按设计 fail closed 而不是悄悄不设防，于是每一笔 bash 都拿到 `SANDBOX_UNAVAILABLE`；无头子 dsh 又没有审批通道，模型按提示升档重试也只会拿到「没有审批通道」。两条一起，选手在单元里就是没有 shell（I5·T39 的 G14 实测）。

**容器内委派。** 编排器可以经门面 `DelegationCallOptions.exec`（`{ container, workdir, env? }`）让本轮跑在一个**已取得的容器**里：argv 变成 `docker exec -w <workdir> [-e NAME…] <container> <原 argv>`，其余（会话镜像、settle、记录）逐字节不变。`env` 必须给出容器内的 `DSH_HOME`；解析出的 API key 只以 `-e DEEPSEEK_API_KEY` 的**名字**上 argv，值留在 docker 客户端环境里，不进宿主进程表。容器轮另有两条本包独有的行为。其一，**自动补 `NODE_OPTIONS=--use-env-proxy`**（调用方在 `target.env` 里自己给了就不覆盖）：dsh 的 HTTP 客户端是 node 的 `fetch`（undici），**默认不读** `HTTP(S)_PROXY`，在只有白名单代理、没有 NAT 出网的单元里会直连 API 并当场失败，而代理连一条 `CONNECT` 都收不到；这个开关打开 undici 的 `EnvHttpProxyAgent`。四家里只有 dsh 需要它，因此由 provider 自动补上，并在 `effectiveSettings.containerNodeOptions` 里报出来让条件文件看得见。其二，**跳过宿主侧子 profile 的 provisioning**：那份 profile 的 `node_modules` 符号链接指向宿主上的 headless bundle，在单元里解析不到；而作用域目录是 bind 挂载的，写进去等于在单元真正会读的目录里放一份坏 profile。容器轮的入口与 profile 由调用方用既有旋钮点名（`cliLaunch`、`profileName`），且**单元里必须备好家族 headless bundle 及其运行期依赖闭包**——镜像自带的 in-box `headless` profile 是另一个更小的 app，不认 `--session-id`/`--resume`，不足以承载一次委派轮。实测：`eval-env:pinned` 单元里备好之后，一次「回答 2+2」settle 为 `completed`、输出 `4`，`observedModel` 从容器写进宿主作用域目录的子 dsh 会话日志里回读为 `deepseek-official/deepseek-v4-flash`。

**同一 scoped home 被多个文件系统解析时（双文件系统契约）。** 当 scoped home 同时被宿主（判官委派、就绪检查）和容器单元（bind 挂载）读写——例如 T20c「一个主人，一个目录」的评测布局——子 profile 里那条 `node_modules` 符号链接的目标是一个**字符串**，由读到它的文件系统各自解释：指向宿主安装路径时链接在单元里悬空，而宿主侧就绪重探会重新 provision、把宿主专用路径再写回去（跳过容器轮自己的 provisioning 防不住这条**已存在**的链接）。契约只有一条：**把 `headlessBundleDir` pin 到一条在两个文件系统里都成立的绝对路径**——宿主侧在同名路径建一条符号链接指向宿主安装里的 bundle（Node 按 realpath 解析，其依赖闭包随之可用），镜像侧在同名路径放真安装。pin 住之后，就绪检查的重 provision 只是把同一目标重写一遍，不再产生宿主专用路径。两个被评估后否决的替代：其一，**把 bundle 拷进 scoped home**——家族代码在运行期从 `@deepseek-ai/*` 导入的是服务键与类（`credentialRef`、`TypertRemoteService`、`SessionId` 等），拷一份闭包会让这些包出现第二份实例，cordis 按实例身份做服务查找与类型判断，症状是静默的服务缺失而非报错；bundle 的 `@deepseek-ai` peer 必须从**运行该子 dsh 的同一份安装**解析，pin 在两个运行时里都保住了这一点，拷贝必然破坏。其二，**给单元加第二条 bundle 挂载**——破坏 T20c「挂载只有一条」的立场，且只有 dsh 一家需要。pin 因此是调用方的一条机器级前置条件（写进题库 env/README），本包零代码改动。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-dsh`）。问题与贡献请移步该仓库。
