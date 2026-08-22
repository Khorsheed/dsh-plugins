# Agent Note: local-agent-claude-code live driver — 常驻 stream-json 进程(live-driver M4)

Status: implemented

[English](2026-08-23-local-agent-claude-code-live-driver.md) | 中文

## Problem

`claude-local` provider 把每一轮委派驱动为一个全新的 `claude -p` 进程:没有优雅中断(只有 SIGTERM/SIGKILL)。[live-driver 提案](../../../../proposals/active/2026-08-20-local-agent-live-driver.md)把 claude 排在最后一家(M4),走 Agent SDK 的 streaming-input 模式——也就是 CLI 的 `--input-format stream-json --output-format stream-json` 实时通道,直接驱动它,不引 SDK 依赖。M1([dsh](2026-08-22-local-agent-dsh-live-driver.md))、M2([codex](2026-08-22-local-agent-codex-live-driver.md))、M3([kimi](2026-08-22-local-agent-kimi-live-driver.md))定下的生命周期纪律由本驱动复用。

## Decision

`@khorsheed/dsh-local-agent-claude-code` 上 `live: true` 把委派轮切到每成员一个常驻 stream-json 进程,不触碰 facade、委派记录、resume 锁与成员通道契约。

**授权纪律(硬性要求)。** 常驻进程拿到的恰好是 exec 路径的 env:scoped `CLAUDE_CONFIG_DIR`,外加仅当插件配置给出时的 `ANTHROPIC_BASE_URL`。scoped `.claude.json` 里的 OAuth 标记和以该路径哈希的 keychain 条目,正是 exec 一次性进程本来就在用的;驱动绝不碰用户全局 `~/.claude`,绝不执行任何 `auth` 命令,所有探针都在一次性 scoped home 上完成。

**通道**(全部事实对 claude 2.1.236 探针验证):第一条 stdin `user` 消息触发 `system/init` 并携带 server 分配的 session id(每一轮都会重发 init——委派记录第一条);每轮以 `result` 事件关闭(`is_error`、usage、session id);`control_request {subtype:'interrupt'}` 得到 `control_response` 成功应答,即优雅 runtime 中断;新进程带 `--resume <session_id>` 以同一模式重挂盘上会話(崩溃恢复);stdin EOF 让进程静默退出(回收阶梯)。没有握手消息——通道靠首轮的 init 在有界窗口内自证(超时跳熔断);spawn 失败是唯一的另一处熔断点。

**折叠**:常驻流讲的是与 exec 路径逐字相同的事件词汇(`system`/`assistant`/`user`/`result`),每轮过共享的 `ClaudeStreamParser`,沿用 exec 实时镜像的留置规则(易变末行等到 `result`,当轮用量挂在它上面),经同一 `appendClaudeTranscriptLine` 核 append。token 粒度以 `--include-partial-messages` 拉起,把 `stream_event` 增量映射为 `assistant/chunk`。

**轮关联**:流事件不带 turn id,所以每成员同一时刻只跑一轮——per-runtime 链保证被取消轮的 `result` 落地后下一条消息才发出(claude 自己会排队 stdin 帧,但排队的 result 绝不能落进下一轮的接收槽)。settle 按身份清除本轮接收槽,且只在 result 落地之后:在飞轮的迟到 result 仍能抵达自己那一轮的 resolver,释放链条(stop-改口手势)。

**生命周期**:逐字复用 M1–M3 纪律——惰性 spawn、同成员 spawn 去重、空闲回收(`liveIdleMs`,默认 30 分钟;stdin EOF → 宽限 → SIGTERM 阶梯)、崩溃重拉起 + `--resume`、5 分钟冷却的熔断器、卸载时 `disposeAll` 中止进行中的 spawn、一切窗口内取消生效(abort 监听器在一切 await 之前;init 等待与 abort 赛跑;init 窗口内的取消回收从未自证的 runtime;呼叫方取消绝不触发熔断)。

## Alternatives considered

- **依赖 `@anthropic-ai/claude-agent-sdk`**——放弃:SDK 包装的就是这条 CLI 通道;直接驱动保持家族模式(不为 live-only 路径加依赖),双向都是 NDJSON。
- **把每轮的 `system/init` 当异常**——放弃:探针显示每轮都会以同一 session id 重发 init;驱动记录第一条、忽略其余。
- **settle 时无条件清除事件接收槽**——测试后放弃:被取消轮在其 turn 的 result 落地**之前**就已本地 settle,此时清槽会把链条吊死(测试抓到的 stop-改口死锁);接收槽现在活到 result 到达。
- **因为 claude 会排队 stdin 就省掉 per-runtime turn 链**——放弃:队列只保证执行顺序,排队轮的 `result` 会落进当时安装的任何接收槽——链条就是关联,与 kimi 同职。

## Consequences

- `live: true` 换来 runtime 级优雅中断(进程存活、会话可续),折叠零变更——常驻流与 exec 流同形,除 `stream_event` 增量(token 粒度)外没有新的传输侧映射;member-state 协作方在折叠侧几乎没有新东西要审。
- claude 授权面零接触:同一个 scoped config dir、同一个 keychain 条目、没有任何 `auth` 命令;全局 home 从不被读取。
- interrupt ack 与 `result` 之间的迟到事件会折进被取消轮(接收槽活到 `result`)——与 exec 的"保留部分成果"契约一致。
- 真实启动探针(claude 2.1.236,一次性 scoped home)验证:首消息后 init、逐轮重 init、单进程多轮、interrupt 控制应答、`--resume` 重挂、EOF 静默。完整带凭证委派轮属 3080 验收。

## Testing

- `tests/live-driver.spec.ts`:共享折叠下的 fresh/resume 轮 settle、runtime/会话复用、崩溃重拉起 + `--resume`、控制协议 interrupt 且进程存活、stop-改口的链条串行化、is_error 映射且保留部分成果、token 粒度(旗标 + chunk append)、env 纪律(仅 scoped 目录 + 可选 base URL)、空闲回收、init 窗口取消回收、init 超时熔断、`disposeAll` 僵尸核算、provider 分流、exec 回退。

## Related

- [dsh (M1)](2026-08-22-local-agent-dsh-live-driver.md)、[codex (M2)](2026-08-22-local-agent-codex-live-driver.md)、[kimi (M3)](2026-08-22-local-agent-kimi-live-driver.md)——本驱动复用的生命周期纪律与取消窗口设计。
