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
| `liveMirrorGranularity` | `event` | live 镜像粒度；`token` 额外把 `assistant/chunk` 增量写入子会话（写放大，opt-in） |

### 默认模型：本 harness 没有 `model` 键

同家族的 codex / claude-code / kimi 三个 provider 都有一个可选的 `model` 插件配置键，每轮委派以它起 CLI。**dsh 没有**，因为无头子 dsh 的启动面上没有可以按次指定模型的位置：`dsh --profile headless-local-agent-dsh` 只接受 `--session-id` / `--resume` / `--serve`，模型来自子实例自己 `agentDefaultModel` 服务的当前选择（headless bundle 的 agent loader 读的就是它）。给这个 harness 加一个 `model` 键就得先在 headless 侧开一条按次传模型的路，那是另一件事。

**所以：dsh 换模型 = 换宿主实例的默认模型。**改完之后新起的委派轮次即按新模型跑。同样地，评测 run 的条件在建立时冻结：run 跑到一半换宿主默认模型，下一轮的模型回读会判为 misattributed 而让 run 失败（冻结决策 5）。

**评测快照（effectiveSettings）。** 本 harness 向注册表声明的公平性设置快照有 drive(exec/live)、端点未固定、CLI 版本(拿委派真正要 spawn 的那条 launch argv 去问 `--version`,按入口脚本路径+mtime 缓存——无头子 dsh 复制的就是父实例自己的 build)与已配置模型(读宿主 `agentDefaultModel` 的当前选择,`provider/model` 格式——无头子 dsh 继承它;服务缺位或选择不可读就不给字段,绝不猜值)：无头子 dsh 没有沙箱或权限旋钮（web-eval 冻结基线称其无限制——字段缺位本身就是诚实的条件输入），端点即宿主实例的模型配置，本 provider 从不覆盖。`/dsh status` 与 `LocalAgentStatus` Remote 附带同一份快照。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.2`）：✅ 完整——rc.8→0.1.1-rc.1 API 审计（2026-08-21）确认本插件消费的所有面无变化或纯增量（ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包），无需改动源码；rc.1→rc.2 复核（2026-08-22）：消费面无变化，全量构建测试通过。
- 源码线（deepseek-harness master）：✅

## 已知限制

- 无交互式或 device-code 登录流程——子 dsh 只能通过父级的 `DEEPSEEK_API_KEY` 凭据认证；`/dsh login` 报告该 harness 无登录流程。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**模型回读与 cwd 覆盖。** 每轮 settle 后，provider 从子会话事件自身读取实际模型：本轮最后一个 `assistant/message` 事件的 `message.source`，格式化为 `provider/model`（与 effectiveSettings 快照报告已配置模型的形状一致）随 `settled` 进度事件上报，并合并进 `delegations.jsonl` 的 `observedModel` 字段；取不到即缺位，绝不猜测。编排器还可以经门面 `DelegationCallOptions.cwd` 给本轮指定工作目录（记录进 `cwd` 字段）；resume 轮解析出的目录若与首轮记录不一致，进程启动前即 fail loud——CLI 会话延续的是首轮所在目录的上下文。

**容器内委派。** 编排器可以经门面 `DelegationCallOptions.exec`（`{ container, workdir, env? }`）让本轮跑在一个**已取得的容器**里：argv 变成 `docker exec -w <workdir> [-e NAME…] <container> <原 argv>`，其余（会话镜像、settle、记录）逐字节不变。`env` 必须给出容器内的 `DSH_HOME`；解析出的 API key 只以 `-e DEEPSEEK_API_KEY` 的**名字**上 argv，值留在 docker 客户端环境里，不进宿主进程表。容器轮另有两条本包独有的行为。其一，**自动补 `NODE_OPTIONS=--use-env-proxy`**（调用方在 `target.env` 里自己给了就不覆盖）：dsh 的 HTTP 客户端是 node 的 `fetch`（undici），**默认不读** `HTTP(S)_PROXY`，在只有白名单代理、没有 NAT 出网的单元里会直连 API 并当场失败，而代理连一条 `CONNECT` 都收不到；这个开关打开 undici 的 `EnvHttpProxyAgent`。四家里只有 dsh 需要它，因此由 provider 自动补上，并在 `effectiveSettings.containerNodeOptions` 里报出来让条件文件看得见。其二，**跳过宿主侧子 profile 的 provisioning**：那份 profile 的 `node_modules` 符号链接指向宿主上的 headless bundle，在单元里解析不到；而作用域目录是 bind 挂载的，写进去等于在单元真正会读的目录里放一份坏 profile。容器轮的入口与 profile 由调用方用既有旋钮点名（`cliLaunch`、`profileName`），且**单元里必须备好家族 headless bundle 及其运行期依赖闭包**——镜像自带的 in-box `headless` profile 是另一个更小的 app，不认 `--session-id`/`--resume`，不足以承载一次委派轮。实测：`eval-env:pinned` 单元里备好之后，一次「回答 2+2」settle 为 `completed`、输出 `4`，`observedModel` 从容器写进宿主作用域目录的子 dsh 会话日志里回读为 `deepseek-official/deepseek-v4-flash`。

**同一 scoped home 被多个文件系统解析时（双文件系统契约）。** 当 scoped home 同时被宿主（判官委派、就绪检查）和容器单元（bind 挂载）读写——例如 T20c「一个主人，一个目录」的评测布局——子 profile 里那条 `node_modules` 符号链接的目标是一个**字符串**，由读到它的文件系统各自解释：指向宿主安装路径时链接在单元里悬空，而宿主侧就绪重探会重新 provision、把宿主专用路径再写回去（跳过容器轮自己的 provisioning 防不住这条**已存在**的链接）。契约只有一条：**把 `headlessBundleDir` pin 到一条在两个文件系统里都成立的绝对路径**——宿主侧在同名路径建一条符号链接指向宿主安装里的 bundle（Node 按 realpath 解析，其依赖闭包随之可用），镜像侧在同名路径放真安装。pin 住之后，就绪检查的重 provision 只是把同一目标重写一遍，不再产生宿主专用路径。两个被评估后否决的替代：其一，**把 bundle 拷进 scoped home**——家族代码在运行期从 `@deepseek-ai/*` 导入的是服务键与类（`credentialRef`、`TypertRemoteService`、`SessionId` 等），拷一份闭包会让这些包出现第二份实例，cordis 按实例身份做服务查找与类型判断，症状是静默的服务缺失而非报错；bundle 的 `@deepseek-ai` peer 必须从**运行该子 dsh 的同一份安装**解析，pin 在两个运行时里都保住了这一点，拷贝必然破坏。其二，**给单元加第二条 bundle 挂载**——破坏 T20c「挂载只有一条」的立场，且只有 dsh 一家需要。pin 因此是调用方的一条机器级前置条件（写进题库 env/README），本包零代码改动。

**DeepSeek 开关。** 与其他家族 harness 不同，本包默认不挂载任何模型可见的东西。互斥开关位于 dsh harness 行的动作区内（设置 → 本地 Agent，namespace `local-agent-dsh`，默认 off）：OFF 时委派走官方 in-process subagent 工具；ON 时注册 `dsh` harness、`dsh-cli` 委派 provider 与家族工具 `subagent_dsh`，与官方工具并存——两种委派形态语义不同（in-process continuable vs. 独立 CLI 进程），家族工具描述让模型可以区分。开关经 settings watcher 实时翻转组合。

**委派。** provider 生成一个 uuid（`session-<uuid>`），记录委派（`childSessionId → cliSessionId` 恒等映射），并 spawn `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"`，env 为 `{ DSH_HOME: <scoped home>, DEEPSEEK_API_KEY: <resolved> }`，cwd 为父会话 cwd。headless bundle（`@khorsheed/dsh-local-agent-dsh-headless`）用该确切 id 创建会话——id 由调用方提供，绝不从 stdout 解析——运行任务、打印最终助手文本、退出 0/1。后续轮把子会话 id 作为 `resume` 传入；provider spawn `--resume <uuid>`，子 dsh 经 `agents.resume` 续接同一会话。

**长驻驱动（`live: true`）。** 替代每轮 spawn：成员首轮委派拉起一个常驻 `--serve` 子 dsh 进程，之后每轮 = 经家族内部 stdio JSON-RPC wire（headless 包 `src/wire.ts`）向活着的 runtime 发 `turn/start`；会话事件以 `session/event` 通知即时推回并逐事件镜像进子会话（与文件镜像同一折叠规则，settle 时再跑一次文件镜像做对账），`cancel` 落地为 runtime 级 `turn/interrupt`（进程内 `Agent.cancel`）——进程不死、会话可续。runtime 空闲超时回收（wire `shutdown` → SIGTERM 阶梯），崩溃后下一轮自动重连并 `agents.resume` 盘上会话；spawn/握手失败标记通道不可用并永久回退 exec 路径。

**认证与供给。** 无 device-code 登录：子 dsh 通过父级的 `DEEPSEEK_API_KEY` 凭据认证（`apiKeyRef` 配置）；`/dsh status` 报告凭据是否可解析，`/dsh sessions` 从 scoped-home 存储列出子 dsh 自己的会话。子 profile 位于 `profiles/headless-local-agent-dsh`：一个 manifest（只列 `@deepseek-ai/dsh-base`）、headless 包的 patch 逐字节拷贝成的 profile 自己的 patch 层、一条解析 headless bundle 的符号链接（供 loader 解析 insert 行）——其余一切从 dsh 安装锚点解析，供给零 pnpm install 成本且幂等，内容漂移时自动重写（升级与旧格式自愈）。父级复制自己的启动方式（或配置 `cliLaunch`），让子 dsh 与父级跑同一个 dsh 构建。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-agent-dsh`）。问题与贡献请移步该仓库。
