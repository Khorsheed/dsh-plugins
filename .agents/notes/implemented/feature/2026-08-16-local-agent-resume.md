# 三家 CLI 子代理支持续聊（resume）：家族自有工具 + localAgent 载体

## 背景：为什么不是官方 continuable seam

官方 `subagent` 的 continuable 能力（`prepareContinuable` + continuation manager）是 **Agent 型专属**：`send_message`/`interrupt_agent`（tool-subagent-control）通过 `ctx.subagents.followup`/`interrupt` 操作 continuation manager 持有的 `AgentHandle`，而 CLI 子代理（kimi/codex/claude）走的是 out-of-process one-shot provider，没有本地 Agent、没有 inbox、没有 `ctx.agents.create()` 的 Activation 所有权契约（上游 `subagent/README.md:147` 只提到 ACP `prepareContinuable` 需要"provider-specific descriptor data"来持久化远端会话 id，但 descriptor schema 严格拒绝未知字段，且该契约在上游缺失）。因此 CLI provider 无法接入官方 continuable seam——这是 option 1 被排除的结论。

## 采用方案（option 2：seam 外自管 resume）

- **自有工具**：各 bundle 的 patch 把官方 `@deepseek-ai/dsh-tool-subagent` 行替换为 `@khorsheed/dsh-local-agent-tool-subagent`，`toolName` 不变（`subagent_kimi`/`subagent_codex_local`/`subagent_claude_code_local`），schema = 官方子集（`description`/`prompt`）+ 可选 `resume?: string`（值为首次委派返回的 dsh 子会话 id）。
- **禁止 prompt 内嵌句柄**：任务文本不可信，伪造 resume 会劫持别人会话的上下文。工具只读 `resume` 参数，绝不从 prompt 提取句柄。
- **载体验证结论**：`descriptor.ts` 的 one-shot 键严格为 `version/mode/provider/label`，`assertKnownKeys` 对未知字段抛错——descriptor schema 严格放不下 resume 目标。故走 **localAgent 服务**在家族内部传递：委派 registry（子会话 id → CLI 会话 id + parent + provider）加按 (parent, provider) 分组的 intent FIFO。
- **续聊轮仍走 `ctx.subagents.start()`**：生命周期事件（`subagent/start`/`subagent/end`）和子代理展示不变；provider 在 start() 顶部消费一个 intent，resume intent 复用同一子会话、以递增 turn 追加新一轮。
- **每轮记账**：turn 编号递增；`turn/start`+`turn/end` 每轮成对（subagentTiming 逐轮累计）；usage 挂当轮 assistant 消息（tokenUsage 按 turn/step 去重累计）；kimi wire.jsonl 镜像改为增量（registry 记录 `kimiMirroredLines` 行偏移，续聊只镜像 delta，不重复追加）。
- 首个委派结果文本自述 `追问请带 resume="<childSessionId>"`（run.id == 子会话 id，seam 的 local-run 契约）。

## 关键实现点

- `LocalAgentRegistry` 新增：`recordDelegation`/`resolveDelegation`（伪造句柄拒绝：未知子会话、他人 parent、错误 provider）/`stageDelegationIntent`/`takeDelegationIntent`（FIFO，每工具调用 stage 恰好一个、每 start 消费恰好一个）/`acquireResumeLock`/`releaseResumeLock`（per-child resume 互斥）/`kimiMirroredLines`/`setKimiMirroredLines`/`listDelegations`。
- 三个 provider 的 `start()` 拆 fresh/resume：resume 经 `sessions.get(childSessionId)` 复用子会话（缺失即 fail loud），`nextTurn = turn/start 计数 + 1`，spawn 续聊命令（kimi `-S session_<id> -p`，-S 必须在 -p 前；claude `-p --resume <id>`；codex `exec --json resume <thread_id>`，thread_id 来自 `thread.started` 事件），返回 `id: childSessionId`。
- **resume 并发边界**：同一 dsh 子会话的 resume 必须串行——per-child 互斥锁放在框架注册表（与委派 registry 同层，未来 stop registry 复用）。provider 在 spawn 前 `acquireResumeLock(childSessionId)`，取不到即 fail loud（`该子会话有进行中的委派，等其完成后再追问`），**不排队静默等待**——模型拿到明确错误会自己重试。锁在 `run.result` 的 settle 路径（completed/error/aborted 都经 result resolve）与 start 异常路径都释放，不留死锁。fresh 委派不加锁（每次 mint 新子会话，天然无冲突）。
- 新鲜轮 settle 后记录 cliSessionId（kimi 从 stderr hint、claude 从结果 JSON `session_id`、codex 从 NDJSON `thread_id`）。
- 工具包 `@khorsheed/dsh-local-agent-tool-subagent`：inject `['tools','subagents','localAgent']`，execute 里先 `resolveDelegation` 校验再 stage，然后照常 `ctx.subagents.start()`，fresh 轮在结果 output 追加 `追问请带 resume="<run.id>"`。

## 验证

- 三种 CLI 续聊命令均实机验证：kimi `-S session_<id>`（42 记住了）、claude `--resume <id>`（42）、codex `exec resume <thread_id>`（同 thread_id 返回）。
- 测试：core delegation registry（含伪造句柄拒绝、FIFO 配对、mirror 偏移、resume lock 互斥/异子会话独立/释放无副作用）；工具包 10 例（schema 含 resume、fresh 自述句柄、resume 传 target、伪造句柄 isError、prompt 内嵌句柄被无视、mount/unmount）；三 provider 的 resume 测试（续聊 argv、复用子会话、turn 2、子会话缺失 fail loud、**同子会话并发第二个 resume 被拒且零 spawn**、settle 释放锁后可再次 resume）。
- `pnpm typecheck` 全绿；`pnpm test` 全绿；`verify-translation-pairing` 31 对同步。

## 子会话记录保真度批次（harness 对比前置）

目标是三家子会话记录达到可做对比的保真度，全部用本轮真实 wire/NDJSON/stream-json 样本做 fixture：

- **kimi usage 改求和**：`usage.record` 每条是一次 LLM 请求的口径（实测两轮 resume 会话 8 条：round1 三条 4027/7855/2799，round2 五条），镜像对 delta 内所有 record 求和、挂当轮最后一条 assistant 消息。`session-view` 现在输出 `usageRecords`（带 transcript 行位置），mirror 按偏移求和。
- **修 turn 对齐**：wire 的 `turnId`（loop 事件）就是 dsh 轮次号（1-based），mirror 直接用 `line.turn`，不再从 user 行数推——system-reminder 被过滤后 user 计数本就不可靠。
- **修续聊重复镜像**：根因是 `kimiMirroredLines` 存在委派记录里、而记录依赖 stderr hint 解析；hint 缺失时 offset 从未写入，resume 回落 fromLines=0 导致首轮内容镜像两次。修复：offset 独立成 `kimiMirrorOffsets` map（与委派记录解耦），resume 的 session id 用 intent 记录值而非重解析 stderr。回归测试：真实两轮 fixture 镜像后无重复 assistant 文本、usage 求和正确。
- **过滤 system-reminder**：kimi 自动权限模式的 `<system-reminder>` user 消息不进子会话（真实 wire 每轮都有）。
- **工具行补入参**：`tool.call.args` 渲染为 `[工具 WebSearch] 查询词`；`tool.result` 按 `parentUuid`/`toolCallId` 配回自己的调用（并行调用不再错配），无 id 时回退最近工具行。
- **codex 镜像全事件**：`reasoning`→`reasoning` 块、`agent_message`→文本、`command_execution`/`web_search_call`/`function_call_output`→工具行；最终 `agent_message` 为运行输出，usage 挂末条。流天然按轮增量。
- **claude 换 stream-json**：argv 改为 `--verbose --output-format stream-json`（CLI 对 `--print`+stream-json 强制 --verbose）；解析 system/assistant/user/result 事件，`thinking`→`reasoning` 块、`tool_use`+`tool_result`→工具行、`text`→回复；session_id 来自 system init，usage 来自 result 事件。

## 修 one-shot 委派中止链路（死等 + 内容保留）

**死等链路根因（3080 实盘复盘确认）**：父回合中止时，三个 provider 的 `requestCancel` 只翻 `runAbort` 标志位——`attempt` 的 race 只有 `child.done`/`processFailure` 两个分支，都等子进程退出才 settle；而 `settleRunResult` 的 `cancelled()` 在 `await attempt()` **之后**才检查，所以 abort 时 result 永不 settle。杀进程的 `dispose`（SIGTERM→grace→SIGKILL 梯子）又排在 result settle 之后，形成死等；CLI 子进程全程收不到任何信号。kimi/claude 之前看似能停是恰好快跑完自然退出，codex 长请求挂了 3.5 分钟、父回合卡死。

**官方契约依据**：`out-of-process.ts` 的 `subprocessRunHandle` 注释写明 dispose 的职责——"removes the abort listener, settles local cancellation — there is no assumption the child cooperates — and then awaits the backend's teardown to actual exit"。即 requestCancel 让 result **立即** settle，teardown 异步杀进程。本修复对齐该契约：三个 provider 的 attempt race 加 `abortBranch`（`runAbort` 触发即 reject），`settleRunResult` 观察到 `cancelled()` 后立即以 `'aborted'` settle；杀进程留在 dispose 的梯子里。

**中止也保留内容**：原来镜像/回写只在 `completed` 时跑，中止轮只落 `turn/end`——子会话空白、token 为 0，但 CLI 侧其实已产出内容（kimi/claude 那次是自然跑完的完整答案，被丢弃）。改为：镜像/回写挂在 `result.then(() => child.done).then(...)` 上——**先等 settle 链写好 turn/end、再等子进程真正退出**（stdout/wire 收完），然后无论 stopReason 都回写已产出内容和 usage（kimi 读 wire、codex 解析已收 NDJSON、claude 解析已收 stream-json）；`turn/end` 的 reason 保持 aborted/error 不变。kimi 的 mirror offset、codex 的 threadId、claude 的 sessionId 都在 abort/error 轮也记录，保证部分成果可继续 resume。**注意**：镜像链必须挂在 `result.then(() => child.done)` 而不是直接 `child.done.then`——直接挂会抢在 settle 链写 turn/end 之前 append，导致持久化批次缺 turn/end。

**验收标准**：父回合中止后工具结果秒回（result 立即 'aborted' settle）；子进程在 dispose 的 SIGTERM→grace→SIGKILL 内退出；中止轮子会话含已产出内容 + usage + 正确的 aborted/parent turn/end；进程已自然退出时 dispose 幂等不报错。测试用 10 分钟假 CLI（`done` 永不自行 resolve，`terminate()` 才释放）验证 abort 后 <1s settle、dispose 杀进程、幂等、中止轮内容保留。

## 后续

- stop registry 与委派 registry 共用同一记录结构（active 子进程登记）。
- 委派超时（stall timer）落地时应按轮重置。
- 官方 `settleRunResult` 先 `await attempt()` 再查 `cancelled()` 的缺陷仍待上游修复（中止无法打断挂起的 child.done 竞态）。
