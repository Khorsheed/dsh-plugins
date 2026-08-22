# Agent Note: local-agent-codex live driver — 常驻 codex app-server(live-driver M2)

Status: implemented

[English](2026-08-22-local-agent-codex-live-driver.md) | 中文

## Problem

`codex-local` provider 把每一轮委派驱动为一个全新的 `codex exec` 进程:没有优雅中断(只有 SIGTERM/SIGKILL)、没有运行中 steer,镜像靠折叠轮询到的 stdout NDJSON 流。[live-driver 提案](../../../../proposals/active/2026-08-20-local-agent-live-driver.md)把 codex 排在第二家(M2),走 `codex app-server --stdio`——厂商的 experimental JSON-RPC 长驻通道——以 harness 的 `subagent-codex` 包为参照实现。M1 的 [dsh live driver](2026-08-22-local-agent-dsh-live-driver.md) 定下的生命周期纪律由本驱动复用。

## Decision

`@khorsheed/dsh-local-agent-codex` 上 `live: true` 把委派轮切到每成员一个常驻 app-server 进程,不触碰 facade、委派记录、resume 锁与成员通道契约。

**通道**:`codex app-server --stdio`(每成员一进程——成员桥的每进程 `-c` TOML 覆盖与 scoped `CODEX_HOME` 都钉在单个成员上,app-server 的多线程能力被刻意不用)。wire 适配器(`src/live-driver.ts` 的 `CodexWirePeer`)自包含——StringDecoder 帧解码持有跨块 UTF-8 尾巴、请求关联、server→client 请求应答——沿袭 M1 的零新依赖选择。协议事实由安装的 codex-cli 0.144.0 机械探得(`app-server generate-json-schema`):`initialize` → `thread/start {cwd, ephemeral: false, approvalPolicy: 'never', sandbox}`(持久线程,崩溃恢复才能 `thread/resume {threadId}`)→ `turn/start {threadId, input}` → 通知 `turn/started`、`item/completed`、`item/agentMessage/delta`、`item/reasoning/textDelta`、`thread/tokenUsage/updated`、`turn/completed {status: completed|interrupted|failed}`;优雅取消走 `turn/interrupt {threadId, turnId}`;没有 shutdown 方法,回收 = stdin EOF → 宽限 → SIGTERM 阶梯。

**折叠**:app-server 的 `item/completed` ThreadItem 经 `codexAppServerItemToLine` 映射到 exec 折叠的 `CodexTranscriptLine`(reasoning → think、agentMessage → text、commandExecution → 带聚合输出的 Bash 工具行、webSearch/mcpToolCall/plan → 工具/think 行),经同一 `appendCodexTranscriptLine` 核 append,沿用同一留置规则(易变的最后一行等到 `turn/completed`,当轮用量从 `thread/tokenUsage/updated` 取并挂在它上面)。任务文本在 turn 打开时落 `user/message`。token 粒度(`liveMirrorGranularity: 'token'`)额外按流式 item append `assistant/chunk` 增量。最终答案选择遵循 harness wire:`final_answer` 相位优先于无相位;commentary 不进输出选择。

**审批**:server→client 的审批/elicitation 请求按无人值守策略自动应答(优先 cancel 否则 decline、空权限授予、空回答、elicitation 拒绝——harness 参照实现的表),与 exec 行为一致,即提案的默认策略;人类审批中继钩子留给后续增量。

**轮关联**:turn id 由服务端分配,所以轮按 turn id 关联,而非调用方轮次号——一轮只接受自己 turn id 的通知(accept ack 在途时经 `turn/started` 提前观察),退役 turn id 把被取消轮的迟到 unwind 隔出去(stop-改口手势),settle 即清除本轮的接收槽。父侧 `turn/start` 边界只在 accept ack 之后打开,确定性拒绝不留 dangling 边界。

**生命周期**(逐字复用 M1 纪律):惰性 spawn + initialize 握手、同成员同时一个 spawn、空闲回收(`liveIdleMs`,默认 30 分钟)、崩溃重拉起并 `thread/resume` 委派记录里的线程 id、5 分钟冷却的通道熔断(逐轮回退 exec)、卸载时 `disposeAll` 中止并等待进行中的 spawn、一切窗口内取消生效(abort 监听器挂在所有 await 之前;握手与 abort 信号赛跑;呼叫方取消的握手绝不触发熔断)。

**委派身份**:与 dsh 不同,线程 id 由服务端分配;fresh 轮在 `thread/start` 响应时即记录委派(`cliSessionId = thread id`)——远早于 exec 的 settle 时 stdout 解析。

## Alternatives considered

- **依赖 `@deepseek-ai/dsh-sdk-protocol` 的 `JsonRpcLineTransport`**——放弃:传输层是 M1 风格的约 80 行家族自有代码,而把 `0.0.1-rc.1` 这条年轻的官方线钉进每个安装、只为一条 live-only 代码路径不值;自包含让 exec 用户零感知。
- **所有 codex 成员共享一个 app-server 进程**——放弃:成员桥配置是携带单成员 token 的每进程 `-c` 覆盖,`CODEX_HOME` 也按成员隔离;每成员一进程让两者构造性正确。wire 按 id 寻址线程,日后共享是优化而非重设计。
- **从盘上 rollout 文件做对账镜像**——M2 放弃:app-server 管道恰好一次按序投递事件,`turn/completed` 的留置回放即关轮;rollout 文件解析要给一个无文档的文件格式维护第二份折叠。
- **把 `sandbox` 配置映射到 on-request 审批模式**——放弃:无人值守委派绝不弹审批;exec 模式的实效策略就是 never-ask,所以线程跑 `approvalPolicy: 'never'` + 配置的沙箱。

## Consequences

- `live: true` 换来 runtime 级优雅中断(进程存活、线程可续)与推模式镜像(零 stdout 轮询);默认关——exec 路径未动,其测试原样通过。
- 折叠契约未变:`CodexTranscriptLine` + `appendCodexTranscriptLine` 逐字共享;app-server item 映射器是新增传输侧入口,留给 member-state 协作方审。
- app-server wire 在上游明确标注 experimental;协议漂移由驱动测试 + schema 探针方法(`generate-json-schema`)钉住,熔断 + exec 回退收容坏通道。
- 一轮若以丢失 `turn/completed` 的方式失败,该轮会挂到回收为止——由 interrupt/收敛阶梯与进程死亡监听缓解;没有单独的轮看门狗(接受,与 exec 依赖进程退出同类)。
- 对 codex-cli 0.144.0 的真实启动冒烟验证:initialize 握手、持久 `thread/start`、`turn/start` 接受、`turn/interrupt` 以 `interrupted` 关轮、stdin EOF 干净退出 0。完整带凭证委派轮属 3080 验收。

## Testing

- `tests/live-driver.spec.ts`:item→line 折叠映射、fresh/resume 轮 settle、跨轮线程复用、崩溃重拉起 + `thread/resume`、带 thread/turn id 的 interrupt、failed/interrupted 终态映射、stop-改口的 turn-id 标签隔离、无人值守审批自动应答、token 粒度、空闲回收、握手窗口取消、`disposeAll` 僵尸核算、provider 分流、握手失败的 exec 回退。
- 真实启动冒烟:真实 `codex app-server --stdio` 跑 scoped `CODEX_HOME`(握手、线程、turn、interrupt、EOF 退出 0)。

## Related

- [dsh live driver (M1)](2026-08-22-local-agent-dsh-live-driver.md)——本驱动复用的生命周期纪律与取消窗口设计。
