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

- `LocalAgentRegistry` 新增：`recordDelegation`/`resolveDelegation`（伪造句柄拒绝：未知子会话、他人 parent、错误 provider）/`stageDelegationIntent`/`takeDelegationIntent`（FIFO，每工具调用 stage 恰好一个、每 start 消费恰好一个）/`kimiMirroredLines`/`setKimiMirroredLines`/`listDelegations`。
- 三个 provider 的 `start()` 拆 fresh/resume：resume 经 `sessions.get(childSessionId)` 复用子会话（缺失即 fail loud），`nextTurn = turn/start 计数 + 1`，spawn 续聊命令（kimi `-S session_<id> -p`，-S 必须在 -p 前；claude `-p --resume <id>`；codex `exec --json resume <thread_id>`，thread_id 来自 `thread.started` 事件），返回 `id: childSessionId`。
- 新鲜轮 settle 后记录 cliSessionId（kimi 从 stderr hint、claude 从结果 JSON `session_id`、codex 从 NDJSON `thread_id`）。
- 工具包 `@khorsheed/dsh-local-agent-tool-subagent`：inject `['tools','subagents','localAgent']`，execute 里先 `resolveDelegation` 校验再 stage，然后照常 `ctx.subagents.start()`，fresh 轮在结果 output 追加 `追问请带 resume="<run.id>"`。

## 验证

- 三种 CLI 续聊命令均实机验证：kimi `-S session_<id>`（42 记住了）、claude `--resume <id>`（42）、codex `exec resume <thread_id>`（同 thread_id 返回）。
- 测试：core delegation registry（含伪造句柄拒绝、FIFO 配对、mirror 偏移）；工具包 9 例（schema 含 resume、fresh 自述句柄、resume 传 target、伪造句柄 isError、prompt 内嵌句柄被无视、mount/unmount）；三 provider 各 2 例 resume 测试（续聊 argv、复用子会话、turn 2、子会话缺失 fail loud）。
- `pnpm typecheck` 全绿；`pnpm test` 全绿；`verify-translation-pairing` 31 对同步。

## 后续

- stop registry 与委派 registry 共用同一记录结构（active 子进程登记）。
- 委派超时（stall timer）落地时应按轮重置。
- 官方 `settleRunResult` 先 `await attempt()` 再查 `cancelled()` 的缺陷仍待上游修复（中止无法打断挂起的 child.done 竞态）。
