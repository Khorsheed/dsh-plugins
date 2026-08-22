# Agent Note: local-agent-kimi live driver — 常驻 kimi acp(live-driver M3)

Status: implemented

[English](2026-08-22-local-agent-kimi-live-driver.md) | 中文

## Problem

`kimi-cli` provider 把每一轮委派驱动为一个全新的 `kimi -p` 进程:没有优雅中断(只有 SIGTERM/SIGKILL),镜像每 2 秒轮询会话的 wire.jsonl。[live-driver 提案](../../../../proposals/active/2026-08-20-local-agent-live-driver.md)把 kimi 排在第三家(M3),走 `kimi acp`——厂商的 Agent Client Protocol 服务——以 harness 的 `subagent-acp` 包为参照实现。M1([dsh](2026-08-22-local-agent-dsh-live-driver.md))与 M2([codex](2026-08-22-local-agent-codex-live-driver.md))定下的生命周期纪律由本驱动复用。

## Decision

`@khorsheed/dsh-local-agent-kimi` 上 `live: true` 把委派轮切到每成员一个常驻 `kimi acp` 进程,不触碰 facade、委派记录、resume 锁与成员通道契约。

**通道**:ACP over stdio,对本机 kimi 0.36.1 探针验证:`initialize` 报告 `loadSession: true`(崩溃恢复的前提),`session/new {cwd, mcpServers}` 给出服务端分配的会话 id(委派记录的 `cliSessionId`,远早于 exec 的 settle 时 stderr 解析),`session/load {sessionId, cwd, mcpServers}` 在崩溃后重挂,`session/prompt` 是 turn 长度请求、以 ACP stop reason 落定(映射:end_turn→completed、max_tokens→max-tokens、refusal→refusal、cancelled→aborted、其余一律 error——harness 参照实现的表),`session/cancel` 是优雅中断,stdin EOF 让服务端静默退出(回收阶梯)。握手**强制要求** `loadSession`;没有它熔断器跳闸、逐轮回退 exec——没有崩溃恢复的 live 模式不是 live 模式。wire 适配器自包含(不依赖 `@agentclientprotocol/sdk`):StringDecoder 帧解码、请求关联、server→client 请求应答。

**镜像刻意保持文件折叠。** kimi 的 ACP `session/update` 通知是 token 级 chunk,与 exec 镜像拥有的 wire.jsonl 行折叠**不同构**——而 ACP runtime 在同一个 scoped home 写同一个 wire.jsonl(session-view.ts 有记载)。所以推送只**触发**节流的 `mirrorKimiDelta` 过一遍(exec 路径逐字的 offset 簿记,经 `kimiMirroredLines`),settle 对账仍是权威,两条驱动路径不可能漂移。`liveMirrorGranularity: 'token'` 额外把 chunk 直接写成 `assistant/chunk`(绝不计入折叠 offset);运行输出从 `agent_message_chunk` 文本累积。

**轮关联**:每成员一进程、每 runtime 一会话,外加每会话的 turn 链——被取消轮的 `session/prompt` 必须先落定(cancelled),下一轮的 prompt 才发出,因此 stop-改口手势不可能把两轮的 chunk 流交错(ACP 更新不带 turn id,串行化就是关联)。

**审批**:`session/request_permission` 选第一个 allow_once/allow_always 选项(没有则 cancelled)——与 `kimi -p` 的自动批准一致,即提案的默认策略。

**生命周期**:逐字复用 M1/M2 纪律——惰性 spawn + 握手、同成员 spawn 去重、空闲回收(`liveIdleMs`,默认 30 分钟;stdin EOF → 宽限 → SIGTERM 阶梯)、崩溃重拉起 + `session/load`、5 分钟冷却的熔断器、卸载时 `disposeAll` 中止进行中的 spawn、一切窗口内取消生效(abort 监听器在一切 await 之前;握手与 abort 赛跑;呼叫方取消的握手绝不触发熔断;会话未建成时被取消的轮回收新 runtime)。

## Alternatives considered

- **依赖 `@agentclientprotocol/sdk`**——放弃:harness 参照用了它,但这个 peer 是 M1/M2 风格的约百行家族自有代码;为一条 live-only 路径给所有安装加依赖不值。SDK 日后替换 peer 不改契约。
- **把 ACP chunk 直接折进子会话(推送折叠)**——放弃:chunk 与 wire.jsonl 行折叠不同构(工具调用/结果配对、system-reminder 过滤、按请求的 usage 记录都在文件折叠里),推送折叠将是要保持同步的**第二份**折叠——正是 member-state 协作协议禁止单方面改动的发散。经共享文件折叠的触发式过一遍保持单一事实源。
- **`session/resume` 而非 `session/load`**——暂时放弃:kimi 0.36.1 两者都报告(`loadSession: true` 与 `sessionCapabilities.resume`),`load` 是 harness 生态优先探的经典 ACP 路径;握手闸检查的是我们实际使用的 `loadSession` 标志。
- **多会话共享进程**——放弃:成员桥 token 与成员的 ACP 会话都钉在一个进程上;每成员一进程让生命周期与 M1/M2 逐字一致。

## Consequences

- `live: true` 换来 runtime 级优雅取消(进程存活、会话可续)与推送触发的镜像(零 2 秒轮询);默认关——exec 路径未动,其测试原样通过。
- kimi 的折叠层接口**完全没有变**:驱动调用的就是既有的 `mirrorKimiDelta`(新增 export),offset 语义不变;没有新的传输侧折叠入口要审——member-state 协作方只需确认触发节奏。
- ACP 的 turn 长度 `session/prompt` 没有 accept ack,所以 turn 边界在 prompt 发出前打开;硬性 prompt 失败会把轮关成 error 并留下子侧可能没有的边界——与 exec 已有的窄缝同类(spawn 时开边、开工前崩)。
- 对 kimi 0.36.1 的真实启动探针验证:initialize 全能力面、无凭证的 `session/new` 干净失败(Authentication required)、stdin EOF 退出 0。完整带凭证委派轮属 3080 验收。

## Testing

- `tests/live-driver.spec.ts`:stop-reason 映射、fresh/resume 轮 settle、跨轮会话复用、崩溃重拉起 + `session/load`、`session/cancel` 取消且进程存活、stop-改口的 prompt 串行化、审批自动应答、token 粒度、session/new 失败卫生(无 dangling 边界、不碰熔断器)、空闲回收、握手窗口取消、loadSession 熔断闸、`disposeAll` 僵尸核算、provider 分流(委派记录用 ACP 会话 id)、exec 回退。
- settle 对账测试用真实 wire.jsonl fixture 走 exec 路径自己的 `mirrorKimiDelta` 与 offset 簿记。

## Related

- [dsh live driver (M1)](2026-08-22-local-agent-dsh-live-driver.md) 与 [codex live driver (M2)](2026-08-22-local-agent-codex-live-driver.md)——本驱动复用的生命周期纪律与取消窗口设计。
