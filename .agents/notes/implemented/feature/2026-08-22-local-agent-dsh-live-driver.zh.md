# Agent Note: local-agent-dsh live driver — 常驻子 dsh serve 模式(live-driver M1)

Status: implemented

[English](2026-08-22-local-agent-dsh-live-driver.md) | 中文

## Problem

`dsh-cli` provider(家族所有 provider 亦然)把每一轮委派驱动为一个一次性 CLI 进程。这个模型让三件事在物理上不可能:优雅中断(只有 SIGTERM/SIGKILL)、运行中 steer、低成本流式(M3 镜像每 2 秒轮询会话日志并重解析)。[live-driver 提案](../../../../proposals/active/2026-08-20-local-agent-live-driver.md)增加第二种驱动模式——每成员一个常驻 runtime、一轮 = 一个请求——并把 dsh 排在第一家(M1),因为通道是自家机制。

## Decision

`@khorsheed/dsh-local-agent-dsh` 上 `live: true` 把委派轮从一次性 exec 切到常驻子 dsh,且不触碰 facade、委派记录、resume 锁与成员通道的任何契约。

**通道是自家的,不是官方 SDK wire。** headless bundle(`@khorsheed/dsh-local-agent-dsh-headless`)新增 `--serve` 模式(`src/serve.ts`):常驻循环,在 stdio 上讲换行分隔的 JSON-RPC 2.0(`src/wire.ts`,帧格式与官方 `JsonRpcLineTransport` 完全同形制)。`initialize` / `turn/start` / `turn/interrupt` / `shutdown` 请求都是快速应答;turn 事件以 `session/event` 通知回流,turn 以 `session/idle` 关闭(在日志 flush 之后发送)。中断落地为进程内官方 `Agent.cancel({kind:'parent'})`。评估并暂时放弃了官方 `@deepseek-ai/dsh-sdk-jsonrpc-server`:它的 wire 没有 turn 级 interrupt——而优雅中断正是 live driver 的核心收益(上游接缝登记处 S8;官方 wire 长出 interrupt 之日,serve 模式退役)。

**provider 侧**(`src/live-driver.ts`,`DshLiveDriver`):每成员一个常驻 runtime(以调用方会话 id 为键,保持 `cliSessionId == childSessionId`),首个 live 轮惰性拉起 `--serve`,env 显式层与 exec 相同(`DSH_HOME`、`DEEPSEEK_API_KEY`、成员桥坐标)。一轮:provision 自愈 → 凭证 → `ensureRuntime`(spawn + `initialize` 握手)→ `turn/start` 在 wire 请求发出前就 append 进子会话(行处理是同步的,ack 所在块可能同批携带该 turn 的首批事件,父侧 turn 边界必须先开)→ 等 `session/idle` 通知 settle,走与 exec 相同的 `settleRunResult`/`subprocessRunHandle` 脚手架与逐字相同的三分支 `turn/end` 簿记。`cancel` 发 `turn/interrupt` 并本地 settle;teardown 阶梯刻意不杀进程(有界等待被中断的 turn 收敛)。

**生命周期纪律**(本模式的主要成本,刻意随 M1 一起交付):空闲超时回收(`liveIdleMs`,默认 30 分钟;wire `shutdown` → 宽限 → SIGTERM 阶梯)、插件卸载时 `disposeAll`、崩溃后下一轮重拉起并 `agents.resume` 盘上会话、spawn/握手失败永久回退 exec(`LiveChannelUnavailableError` → `driver.disabled`)。每个 runtime 在回收前都登记在 driver 注册表内,profile 重启不留僵尸。

**镜像共享折叠层,只换传输。** `session-mirror.ts` 新增的 `mirrorDshLiveEvent` 入口复用文件镜像的过滤/append 核(抽出 `appendMirroredMessageEvent`);settle 路径仍跑文件镜像 `mirrorDshSession` 做对账,其"已镜像前缀跳过"与 live 追加的事件去重——最终子会话 transcript 与 exec 构造上一致。`liveMirrorGranularity: 'token'`(默认 `'event'`)额外 append `assistant/chunk` 增量。成员通道注册从每轮改为每进程(常驻进程整个生命周期持有 spawn env;token 随回收/崩溃释放)。

## Alternatives considered

- **驱动官方 SDK JSON-RPC runtime(`dsh-jsonrpc-agent` + `@deepseek-ai/dsh-sdk-client`)**——M1 放弃:无 wire 级 interrupt/cancel(client 注释确认超时请求会跑到 runtime 关闭),cancel 只能维持杀进程,提案的第一项收益就没了。我们落地的 wire 与其同帧格式,官方长出 interrupt 后替换是机械替换(S8)。
- **所有 dsh 成员共享一个 runtime 进程**——M1 放弃:每成员一进程让生命周期、回收、成员通道 token 归属平凡正确;wire 已带 session id,日后共享是优化而非重设计。
- **推送触发的文件轮询,而非 wire 携带事件**——放弃:通知路径仍受盘上新鲜度限制,且每事件一次全量重读;wire 携带事件直接 append,文件镜像留作 settle 对账。
- **默认 token 粒度**——放弃:每条 delta 都是一次 append + 持久化 + 广播(写放大);按提案以文档化 opt-in 交付。

## Consequences

- `live: true` 换来 runtime 级优雅中断(进程存活、会话可续)与推模式事件镜像(零 2 秒轮询);`live` 关闭(默认)与之前逐字一致——exec 路径未动,其测试原样通过。
- 折叠层既有接口未变;`mirrorDshLiveEvent` 是新增的传输侧入口点,共享同一 append 核。按 member-state 协作协议,对方验收时应审的正是这个新增点。
- 刻意接受的新故障面:常驻进程(僵尸/泄漏风险)——由回收注册表、空闲收割器与 `disposeAll` 收敛,生命周期测试钉住。
- token 粒度流式已实现并有单元测试,但尚未对真实模型实测;首次真实实例运行应确认 `assistant/chunk` 事件如期流动。
- serve 模式启动已对真实子 dsh profile 冒烟验证(initialize 握手 + shutdown → 退出 0);完整真实 turn 需要有凭证的部署(3080 验收)。
- 常驻模式的 shutdown 必须卸下 stdin 监听:launcher 的有界退出以 `process.exitCode` 完成,要等事件循环排空才生效,而 flowing 状态的 stdin 管道会永远持有事件循环——一次性模式从不监听 stdin,所以只有 serve 模式会踩到。shutdown 路径移除监听、unref stdin,并武装 2 秒自退出兜底。M2+ 的常驻 runtime 必须复制这条纪律。

## Testing

- headless:`tests/serve.spec.ts`(wire 握手、turn 流、事件实时推送顺序、interrupt → `Agent.cancel`、shutdown/EOF 回收、畸形行、错误 turn),`--serve` startup 解析用例。
- provider:`tests/live-driver.spec.ts`(轮 settle 平价、runtime 复用、interrupt 不杀进程、token 粒度、空闲回收、shutdown 阶梯、崩溃重拉起、accept 失败回收、disposeAll 僵尸核算、provider 分流、exec 回退),外加 `tests/session-mirror.spec.ts` 里 `mirrorDshLiveEvent` 的折叠平价与 offset 一致性用例。
- 真实启动冒烟:对真实子 dsh profile 跑 `--serve`(initialize 握手 + shutdown 退出 0)。
