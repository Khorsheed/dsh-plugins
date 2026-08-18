# local-agent 公开委派 API（start / resume / cancel + 进度事件）（local-agent-delegation-api）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-08-18
- **查重结果**：已搜 `proposals/active/`（仅 datasets-mission-bench，无关）、`proposals/closed/`（空）、`.agents/notes/`（含 archived）。命中 `.agents/notes/proposed/feature/2026-08-18-room-multi-agent-conversation.md`——那是**消费方**（room 插件）的设想，其「Requirement for local-agent」一节正是本提案的需求来源，两者为同一能力的供需两侧，不重复；另有 `implemented/feature/2026-08-16-local-agent-resume.md` 等家族 resume 机制的历史 note，为背景而非同一意图；原 `proposed/feature/2026-08-17-codex-resume-persistence-sandbox-instances-output-schema.md` 第 1 条（委派映射持久化）已**吸收进本提案 M4**，该 note 随之废弃（移入 `rejected/`，其第 2、3 条——双 sandbox 实例、output-schema——一并废弃，需要时另立 note）。无重复，新建。
- **官方依赖**：纯插件。所需官方契约均已实测存在（见「现状」）：`ctx.subagents.start(provider, request)` 接受调用方持有的 live `Agent` + 自备 `AbortSignal`，且 `start()` 内部不做会话归属校验；全局 `session/event` 事件对根 context 订阅者广播一切会话追加；one-shot run 的取消即 start 时传入的 AbortSignal。零 harness 改动。

需求来源：room note 的「Requirement for local-agent」一节（`.agents/notes/proposed/feature/2026-08-18-room-multi-agent-conversation.md`）。本提案是该需求在 local-agent 家族侧的立项，可行性已评估通过（评估结论已同用户确认）。

## 目标

在 `ctx.localAgent`（`LocalAgentRegistry`）上提供**公开的程序化委派 API**，让代表用户行事的插件（room、未来的编排器）一次调用完成委派，不再重新实现家族内部的 intent staging 协议：

1. **resume**：`resume(parentSessionId, provider, childSessionId, prompt, opts?): Promise<SubagentRun>`——一次调用封装 `resolveDelegation` 父会话归属校验、resume intent staging、每子会话 resume 锁（锁由 provider 在 start 内获取，API 负责正确配对与失败补偿）。
2. **start（fresh）**：`start(parentSessionId, provider, prompt, opts?): Promise<SubagentRun>`。
3. **进度可见性**：run 进行中的心跳 / transcript 增量事件，调用方在 settle 前可渲染「进行中」。
4. **中断入口**：`cancel(childSessionId): boolean`，非工具调用方按子会话 id 取消 in-flight run。

必须保持的三条约束（现状语义，逐字不动）：

- 父会话归属校验：resume 句柄必须指向同一父会话、同一 provider 记录过的委派；
- resume 句柄绝不进 prompt 文本（一等参数 + intent 通道，不序列化进任务文本）；
- 每子会话同时只有一个 in-flight resume。

非目标：不改变现有 `subagent_<provider>` 模型工具的任何行为；不要求消费方插件存在；不做 agent-to-agent 自主对话（那是 room 侧在本 API 之上的后续阶段）。

## 现状（官方契约实测 / 已有实现）

家族内部（本仓库，已核实）：

- `LocalAgentRegistry` 就是 `ctx.localAgent` 服务实例，`stageDelegationIntent` / `takeDelegationIntent` / `acquireResumeLock` / `releaseResumeLock` / `resolveDelegation` / `recordDelegation` 均已是其 public 方法（`packages/local-agent/src/index.ts:217` 起）。「公开 API」= 在同一个类上加一层门面，纯增量。
- intent 配对：per-(parentSessionId, provider) FIFO；工具侧每次调用 stage 恰好一个 intent，provider 每次 `start()` 经 `takeDelegationIntent(request.parent.session.id, this.name)` 消费恰好一个（`packages/local-agent-tool-subagent/src/index.ts:230-238`；`packages/local-agent-kimi/src/kimi-cli-provider.ts:62`）。
- resume 锁：provider 在 `start()` 内 `acquireResumeLock(childSessionId)`，settle（completed/failed/cancelled）与出错路径均释放（`kimi-cli-provider.ts:149-153,180-188`）。fresh 不取锁。
- 委派记录：provider 在首轮 settle 后 `recordDelegation({ childSessionId: runId, provider, parentSessionId: request.parent.session.id, cliSessionId })`（`kimi-cli-provider.ts:126-134`）。
- resume 目标子会话必须 live，否则 provider fail loud（`kimi-cli-provider.ts:156-161`）。
- transcript 镜像（kimi 先例）当前是 **settle 后一次性**追加增量到 dsh 子会话（`packages/local-agent-kimi/src/session-mirror.ts`），run 进行中子会话静默。

**跨重启续跑链路的现状（room 评审指出的短板，核实结论）**：

- **已固化的部分**：CLI 侧状态各家都持久（codex rollout 文件、kimi session 目录、claude 项目 jsonl、dsh 子 dsh 会话）；dsh 子会话的镜像 transcript 也经 `sessionPersistence.append` 落盘（`session-mirror.ts:165-166`）。
- **断点一（映射未持久化）**：`childSessionId → { cliSessionId, parentSessionId, provider }` 只存在 `LocalAgentRegistry.delegations` 这个 in-memory Map（`packages/local-agent/src/index.ts:226`），重启即丢，`resolveDelegation` 第一步就失败。修复方案吸收自原 codex 持久化 note 第 1 条（已随该 note 废弃并入本提案 M4，设计见「方案 §2」）：scoped home 下每 harness 一个 append-only `delegations.jsonl`，归属校验保持不变。**该断点与 CLI 通信协议无关**——codex 切 app-server、kimi/claude 换任何 wire 都不修它，它是 dsh 侧簿记。
- **断点二（子会话不在场）**：重启后 dsh 子会话不在 live store，provider 在 start 内 fail loud。harness 已有成熟原语：`ctx.sessionPersistence.prepare(id)` 从持久层重建未发布的 Session（`deepseek-harness/packages/session/session-persistence/src/index.ts:155-168`，内部走 `sessions.prepare(id, { seed, meta, seedSource: 'persistence' })`），再由 `sessions.enter()` 挂进 live store。重型先例是 `ctx.agentLoop.resume()`（`core/agent-loop/src/index.ts:653`），但它会拉起完整 agent 循环——对 CLI provider 的子会话（纯 transcript 容器，无 agent 在其上跑）是错的工具；门面需要的是「prepare + enter」的轻量 reattach。

harness 侧（`~/code/deepseek-harness`，只读核实）：

- `ctx.subagents.start(name, request)`：`request.parent` 是 live `Agent` 对象（必填，无 parentSessionId 字段），`signal: AbortSignal` 必填；`start()` 自身**不做**归属校验，权限模型是 object-capability（`packages/subagent/subagent/src/types.ts:100-149`，`index.ts:414-426`）。live Agent 经 `ctx.agents.get(sessionId)` 获取，只返回存活 agent（`packages/core/agent/src/index.ts:583-585`）。
- 子会话血缘由 provider 从 `request.parent.session.id` 派生（`subagent/src/child-agent.ts:112`），与家族 intent 队列的 key 天然一致。
- `SubagentRun = { id: SessionId（== 本地 run 的子会话 id）, localAgent, result: Promise<SubagentResult>, dispose() }`，无事件发射器（`subagent/src/types.ts:249-275`）。`subagent/start` / `subagent/end` 生命周期事件按父会话 scope 过滤。
- 进度：全局 `session/event` 在每次 session append 后广播（含 `assistant/chunk` 令牌流），根 context 上的订阅者收所有会话、无 scope 限制（`packages/core/session/src/index.ts:76,641-646`；scope 行为见 `core/session/tests/scoped.spec.ts:36-49`）。apiproxy 与 session-projection 均用同一机制。
- 取消：one-shot run 无按 id 取消的官方 API（`ctx.subagents.interrupt` 只对 continuable child 有效，对 one-shot 是静默 no-op）；标准取消通道即 start 传入的 AbortSignal 与 `run.dispose()`。
- cordis 服务全局可见、调用不做会话级隔离；插件间 `ctx.provide` / `inject` / `ctx.get` 惯例不变。

**实测发现的一个既有隐患（本提案必须处理）**：stage 之后若 `ctx.subagents.start()` 在 provider 消费前抛错（provider 未注册、capability 校验失败），FIFO 中会残留孤儿 intent，被**下一次**同名 (parent, provider) 的 start 误消费，造成 fresh/resume 错配。现有工具路径同样存在该窗口；公开 API 调用面更宽，必须先堵住。

## 方案

全部改动落在本仓库：`packages/local-agent`（门面 + 事件 + 补偿 + M4 映射持久化）、各 CLI provider 包（进度镜像，`local-agent-kimi` / `-codex` / `-claude-code` / `-dsh` 按各自 transcript 格式）。无 harness 改动。

### 1. 门面 API（`LocalAgentRegistry` 新增方法）

```ts
// packages/local-agent/src/index.ts — LocalAgentRegistry
start(parentSessionId: string, provider: string, prompt: ContentBlock[], opts?: DelegationCallOptions): Promise<SubagentRun>
resume(parentSessionId: string, provider: string, childSessionId: string, prompt: ContentBlock[], opts?: DelegationCallOptions): Promise<SubagentRun>
cancel(childSessionId: string): boolean

interface DelegationCallOptions {
  label?: string                    // 子代理展示名，缺省取 harness displayName
  signal?: AbortSignal              // 调用方自备的额外取消通道（与 cancel() 并行有效）
  onProgress?: (event: LocalAgentRunProgress) => void   // 见 §4；与 cordis 事件并行有效
  reattach?: boolean                // M2+：缺省 true——子会话不在场时自动执行 §1 第 5 步的恢复配方；
                                    // 显式 false 则不在场即报错（现状语义）。M1 先交付配方本身，此开关随 room 验证后落地
}
```

命名定为 `resume`，不引入 `continue` 这个新词：与家族既有术语完全一致（intent kind `'resume'`、模型工具参数 `resume`、provider 的 `startXxxResume` 方法），也非保留字，方法与调用点都更直白。

`resume` 内部流程（一次调用封装全部约束）：

1. `ctx.subagents.getProvider(provider)` 存在性预检——不存在则 fail fast，**不 stage**（堵孤儿 intent 的第一道闸）。
2. `resolveDelegation(childSessionId, { provider, parentSessionId })`——归属校验原样复用，句柄未知 / 他父会话 / 他 provider 均抛错。映射来源：内存 Map 优先，miss 时读持久化的 `delegations.jsonl` 回填（§2，M4 落地；落地前 miss 即抛错，行为同现状）。
3. resume 锁只读预检（新增 `isResumeLocked(childSessionId)` 只读方法）——已锁则 fail fast，**不 stage**（第二道闸；正式互斥仍由 provider 内 `acquireResumeLock` 保证）。
4. `ctx.agents.get(SessionId(parentSessionId))` 解析 live 父 Agent——不在场则 fail loud（这是 harness 硬约束，见「风险」）。
5. **子会话在场性恢复（reattach 配方）**：`ctx.sessions.get(childSessionId)` 为 undefined 时，门面执行经过测试的恢复序列——`using prep = await ctx.sessionPersistence.prepare(SessionId(childSessionId))` → `ctx.sessions.enter(prep.session)`，detach disposer 由 registry 持有（随插件卸载统一释放，与 provider fresh 路径创建的子会话同生命周期）。此后 provider 内的 liveness 检查自然通过。配方在 M1 以单测固化，并写进门面 doc comment 供 room 侧直接引用。
6. `stageDelegationIntent(parentSessionId, provider, { kind: 'resume', childSessionId, cliSessionId })`，随后**同一同步执行流内** `await ctx.subagents.start(provider, { prompt, parent, label, signal })`——保持恰好一次配对。
7. start 抛错时经新增的 `unstageDelegationIntent(parentSessionId, provider, intent)`（按引用移除指定 intent）回滚——只有 provider 未来得及消费时才回滚得到，已消费则 no-op（第三道闸）。
8. 成功后在 `runs: Map<childSessionId, { controller: AbortController, run }>` 登记；`run.result` 任意 settle 路径清除登记。

`start`（fresh）同理，跳过 2、3，stage `{ kind: 'fresh' }`；登记键用返回的 `run.id`（== 新子会话 id）。

`cancel(childSessionId)`：查 `runs` 映射，abort 登记时自建的 `AbortController`（其 signal 与 opts.signal 合并后传入 start），返回是否命中；未命中返回 false（不静默成功也不抛错）。同时保留 `run.dispose()` 作为调用方持有 run 句柄时的补充路径。

### 2. 委派映射持久化（M4，吸收自原 codex note 第 1 条）

- **存储形态**：每个 harness 一个 append-only 文件 `<scopedHome>/<harness>/delegations.jsonl`（harness 级簿记，与 `session_index.jsonl` / rollout 文件同域），按 childSessionId 取最后一条为当前值（与 `recordDelegation` 的替换语义一致）。
- **写路径**：`recordDelegation` 在写内存 Map 的同时追加一行。记录含 `kimiMirroredLines`——镜像 offset 随记录一并持久化，重启后 resume 不会从 offset 0 重复镜像首轮（这同时覆盖现状里独立于记录存活的 `kimiMirrorOffsets` 内存 Map 的重启缺口，`packages/local-agent/src/index.ts:250`）。
- **读路径**：`resolveDelegation` 内存 miss 时按 childSessionId 读对应文件回填内存；归属校验（parentSessionId / provider 匹配）对回填记录同样执行，一字不改。
- **不选子会话日志存储**（原 codex note 的取舍，沿用）：映射是 harness 簿记（「哪个 dsh 子会话对应哪个 CLI 线程」），子会话日志属 dsh 会话域，其生命周期（重开、清理、compaction）归会话系统所有；放 scoped home 让两个域各自演进。
- **清理**：jsonl 只增不减，长期 profile 的增长问题与 session_index/rollout 同级——M4 接受增长并在 README 写明，轮转/清理留后续。

### 3. 参数形态决策：parentSessionId 而非 Agent

按需求原文收 `parentSessionId: string`，内部经 `ctx.agents.get` 解析。已知取舍：cordis 插件同进程互信，任何插件都能经 `listDelegations()` 读到他人 parentSessionId，故归属校验对**插件调用方**是防误用而非安全边界；它真正的防护对象是不可信的模型文本（resume 句柄永不进 prompt，模型无法伪造一等参数通道）。这一语义在方法 doc comment 中写明。若未来需要更强约束，可加收 `parent: Agent` 的重载（object-capability 形态），届时不破坏既有签名。

### 4. 进度可见性（两级，分里程碑）

- **M2 心跳**：门面在 run 进行中发 cordis 事件 `'localAgent/run-progress'(childSessionId, { kind: 'heartbeat', elapsedMs, mirroredLines? })`（`mirroredLines` 读 `kimiMirroredLines` 等已有簿记），默认 5s 间隔，settle 即止。调用方可选 `opts.onProgress` 回调（同 payload），不便订阅 cordis 事件的调用方也能用。零 provider 改动。
- **M3 transcript 增量**：provider 在 run 进行中 tail 各自 CLI transcript（kimi：轮询 `readKimiTranscript` 的增量行；codex/claude：各自等价物），实时 mirror 进 dsh 子会话并由门面转发为 `{ kind: 'delta', text }` 进度事件。复用现有 `session-mirror.ts` 的 offset 簿记与 `surfaceOp: 'append'` 写路径；settle 时的末次镜像逻辑不变（幂等：offset 已推进则 delta 为空）。每个 provider 独立交付，互不被阻塞。

事件经 declaration merging 注册进 cordis `Events`（`localAgent/harness-added` 先例，`packages/local-agent/src/index.ts:174-188`），不消费的插件零开销。

### 5. 消费方契约（room 侧，非本提案交付物）

room 插件 `inject: ['localAgent']` 可选化（缺席则 CLI 成员能力降级，主 agent 成员仍可用，符合 AGENTS.md「independent, but compatible」）。room 会话 live 时以其 session id 为 parentSessionId 调 `resume`；委派记录天然落在 room 会话名下（与「主 agent 邀请、room 接管 resume 句柄」的协同路径一致）。

### 6. 测试

- `packages/local-agent/tests/`：门面单测——归属校验三失败路径、恰好一次配对（含并行 fresh/resume 交错）、三道孤儿 intent 闸、cancel 命中/未命中、心跳事件发射与 settle 停止。沿用现有 `delegation.spec.ts` 的 scripted provider 模式。
- provider 侧（M3）：模拟 transcript 增长，断言增量镜像不重复、settle 末次幂等。
- 回归：现有 `pnpm --filter <pkg> test` 全绿；不装 room 的 profile 行为逐字不变。

## 里程碑

- **M1 门面**：`start` / `resume` / `cancel` + `unstageDelegationIntent` + `isResumeLocked` + **经过单测的 reattach 恢复配方**（§1 第 5 步，写进 doc comment，room 侧验证）+ 单测。交付后 room 即可发委派与取消；进程内子会话被卸载的场景也能续跑。M1 验收**不含**跨重启 resume（映射持久化未落地前 `resolveDelegation` 必然 miss）。
- **M2 心跳 + reattach 开关**：`localAgent/run-progress` 心跳事件 + `opts.onProgress` + `opts.reattach`（room 验证配方后落地）。
- **M3 增量镜像**：按 provider 逐个落地（kimi 先行，其 mirror 簿记最成熟）。
- **M4 委派映射持久化 + 跨重启续跑**：实现 §2 的 `delegations.jsonl`——`recordDelegation` 追加写、`resolveDelegation` miss 回填、归属校验逐字不变、`kimiMirroredLines` 随记录持久化。本里程碑由原 codex 持久化 note 第 1 条吸收而来（该 note 已废弃），无外部依赖。落地后跨重启链路闭合：映射回填 → 子会话 reattach（M1 配方）→ provider resume。

每个里程碑独立 commit + Agent Note（AGENTS.md 要求），本提案「实现记录」登记。

## 实现记录

- **M1 已落地**（2026-08-18，`local-agent-delegation-api` 分支）：门面 `start` / `resume` / `cancel` + `unstageDelegationIntent` + `isResumeLocked` + reattach 配方（enter-only，不写 `announce`，理由与证据见 note 与 `resume` doc comment）+ 15 个门面单测。Agent Note：`.agents/notes/implemented/feature/2026-08-18-local-agent-delegation-facade.md`（含 zh 对照与 sidecar）。
- 需求来源：`.agents/notes/proposed/feature/2026-08-18-room-multi-agent-conversation.md`（消费方设想；本提案交付后更新该 note 的 Requirement 一节为已满足）。
- 评审记录：room 侧第一轮评审（2026-08-18）指出跨重启续跑链路的两个断点（映射未持久化、子会话不在场），已吸收——现状一节补充核实结论，M1 增加 reattach 配方，M4 吸收原 codex 持久化 note 第 1 条；方法名经评审定为 `resume`（沿用家族既有术语），不引入 `continue`。
- 废弃：`.agents/notes/rejected/feature/2026-08-17-codex-resume-persistence-sandbox-instances-output-schema.md`——第 1 条并入本提案 M4，第 2、3 条（双 sandbox 实例、output-schema）随之废弃，需要时另立 note。
- 背景 note：`implemented/feature/2026-08-16-local-agent-resume.md`、`implemented/feature/2026-08-18-local-agent-dsh-session-mirror.md`。

## 验收标准（done 判定，绑定可插拔交付）

- 一个不经过任何模型工具的测试/演示插件，在仅挂载 local-agent 家族（core + 一个 CLI provider）的 profile 下：`start` 发起 fresh 委派并拿到 `SubagentRun`；用返回的 `run.id` 作句柄 `resume` 同一 CLI 会话（子会话 transcript 证实是续轮而非新会话）；`cancel` 中断一个 in-flight run，其 `run.result` 以 `aborted` 类 stopReason settle。
- 归属校验：以错误的 parentSessionId / provider 调 `resume` 被拒；resume 句柄不出现在任何 prompt 文本路径（grep 验证）。
- 并发：同一子会话第二个 `resume` 在锁持有期间 fail loud；不同子会话并行互不阻塞；start 失败路径不留孤儿 intent（后续 start 不串扰）。
- reattach 配方：持久化后卸载的子会话（模拟进程内不在场）经配方恢复后 `resume` 成功，镜像增量落进同一子会话；room 侧在真实 profile 复验。
- 跨重启（M4）：重启 profile 后 `resume` 昨天留下的委派——映射从 `delegations.jsonl` 回填、归属校验仍拒绝跨会话伪造句柄、子会话自动 reattach、镜像从持久化的 offset 续走不重复、续轮落进同一 CLI 会话与同一 dsh 子会话。
- 进度：run settle 前订阅者收到 ≥1 次心跳（M2）；M3 后增量事件与子会话最终 transcript 一致、无重复行。
- 隔离性：不装 room 的现有用户体验逐字不变——家族全部既有测试绿，`subagent_<provider>` 工具行为不变；新增方法/事件均为增量，无签名变更。
- 交付形态：改动随家族既有包发布（`@khorsheed/dsh-local-agent` 及 provider 包），无新包、无 harness 改动；两包 README 的 Compatibility 一节与 `dsh.compat` 同步更新。

## 风险 / 放弃的东西

- **父会话必须 live（harness 硬约束，绕不过）**：`ctx.agents.get` 只返回存活 agent；room 所有者会话不在场时无法委派。缓解：文档明示 + fail loud 报错引导；room 侧可将委派挂在自身长期存活的 room 会话下。若未来确需「离线父会话委派」，属官方契约扩展（upstream 候选），届时另立提案。
- **跨重启续跑的两个断点修复都在本提案内**：M4 映射持久化 + M1 reattach 配方（官方 `sessionPersistence.prepare` + `sessions.enter` 原语，不引入重型 `agentLoop.resume`）。两者合起来才是完整链路，只做一半则跨重启 resume 仍断——验收标准已按此拆分。
- **M3 是最大成本项**：三个 CLI provider 各自 transcript 格式的 tail/增量解析；M2 心跳先行保证 room 有「进行中」可渲染，M3 逐 provider 交付、不互相阻塞。
- **取消语义以 CLI 进程被杀为准**：abort 后 CLI 侧可能已写部分输出；与工具路径现状一致，不引入新语义。
- **原 codex note 第 2、3 条被放弃**：双 sandbox 实例与 output-schema 结构化结论随 note 废弃而不再有立项载体；若评测/互审场景重新需要，按查重铁律另立 note（这是本次「吸收 + 废弃」决策明确放弃的东西）。
- **插件调用方的归属校验是防误用非安全边界**（见 §3）：接受并文档化，不做过度设计。
