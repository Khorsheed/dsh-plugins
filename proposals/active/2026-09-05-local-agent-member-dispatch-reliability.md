# local-agent 成员派发可靠性(排队态 + 真实流式 + 运行/排队态可见)（local-agent-member-dispatch-reliability）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-09-05
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`(含 archived)。命中同一能力域的既有意图但非本意图:`local-agent-delegation-api`(verified,门面已交付,但其「M4 四 provider 实时镜像」实测不生效——见现状 §1)、`local-agent-live-driver`(done,长驻模式已交付)、`local-agent-member-state`(in-progress)、note `claude-token-stream-final` / `live-token-lazy-stream-step`(token 粒度流式完成逻辑)、`room-live-refresh`(room 刷新)。它们交付的是「机制」;本提案是机制交付后的**缺陷收口 + 缺失的排队态**,同一能力域的后续,非重复,新建。
- **官方依赖**：纯插件。修复全部落在 local-agent 家族 provider + room 表面,零 harness 改动。宿主 `session/queue` / `agent.inbox` 是**主 agent 专用**,不能直接端给 CLI 成员(成员在各自 child session,无 agent/inbox)——见现状 §3。

## 目标

让 local-agent 成员派发在真实使用里**可靠、可见**:

1. **排队而非硬失败**：同一 child session 在途 resume 冲突时,后续派发**排队等待**,而不是立刻 `failed`(现状 20ms 判死)。
2. **真实流式交付**：`live:true` + `liveMirrorGranularity:token` 下,子会话真正逐 token 记 `assistant/chunk`(现状实测 ~0 条)。
3. **运行/排队态可见**：room 或成员会话在「空闲 / 运行中 / 排队中」三态给出**持久醒目的指示**,不再让人"看不出 agent 是否在跑"。
4. **room 流式投影**(延伸)：room 把成员输出**增量流式投影**进聊天,而非等 settle 一次性整段。

## 现状(实测 + 代码)

> 全部实测于 2026-09-05,实例 :3080,profile web;`local-agent-claude-code` 设为 `live:true` + `liveMirrorGranularity:token`。

### 1. 流式不生效(最严重)

极简 `subagent_claude_code` 委派(子会话 `afa47a93-…-682d795f4e03`):`assistant/chunk: 0`,`assistant/message: 0`,仅 `turn/start` / `user/message` / `turn/end(completed)`。答案「2。」**只返回给父 agent,完全没落子会话**。

对照此前 room 成员 9 分钟 / 48 工具调用子会话 `92bd46b6-…`:`assistant/chunk: 1`,`assistant/message: 2`——是**事件粒度折叠**(assistant/message),不是 token 粒度流(chunk 应成串)。

结论:即便配 `token`,claudecode 路径产出的仍是**事件折叠式输出**,几乎无逐 token 流;直接工具委派甚至不落 assistant 内容。根因待钉(候选:live 通道 spawn/init 失败静默回退 exec;或 live driver 的 token 镜像/持久化对该用例未触发;或 `--include-partial-messages` 未真正传递),需求驱动根治:应产生成串 `assistant/chunk`(reasoning-delta / text-delta)。

### 2. resume 冲突硬失败,不排队

`local-agent/src/index.ts` L1019 `isResumeLocked` 快速失败。room 最近一次 @cc 派发(seq 16635)→ `room/run-state failed · elapsedMs=20 · error="localAgent: child session 92bd46b6… already has an in-flight resume"`。原因:同一 child session 被**并发 resume**(用户裸消息进主 agent,主 agent 又转派该 child),room 自己的按成员 FIFO 看不见房外那条 resume。成员忙 → 应排队,而非判死。

### 3. 没有成员维度的排队态

宿主 `ConversationSnapshot.queue` = 主 agent 的 `agent.inbox.nextTurn`(client/runtime README 已写明);CLI 成员在**自己的 child session**,无 agent/inbox,`session/queue` 无法承载成员派发排队。需要**成员维度**排队队列 + 「排队中」态;可参考宿主 QueueDock 形态(room 已在 `RoomQueueStrip` 渲染主 agent 队列,词条/样式可复用)。

### 4. room 从不流式投影成员输出

`packages/room/src/dispatch.ts` `runCliMember` 是 `await run.result` 后**追加一条完整 `room/speech`**;room 侧无任何增量投影,成员增量(子会话 chunk / provider `reportRunProgress` delta)room 不消费。

### 5. 无持久运行态指示

`RoomRunView` 内联「正在工作」行,`done/cancelled` 就地隐藏,失败行错误仅 hover 全文;面包屑/对话框头部无全局「谁在跑 / 谁排队」。主 agent 保留 harness 标准流式态,成员无对应物。

## 方案

分三层,让根修(§A)先落地:

- **A. local-agent 排队(根修)**：把「同一 child session 一个在途 resume」从**硬失败**改为**排队/接力**——`resumeLocks` 由 Set 升级为 per-child 等待-接力队列(`acquireResumeLock` 拿不到则挂起,settle 唤醒下一个),或对调用方返回可重试 `busy`;调用方(room)据此入队并显示「排队中」。兜底所有 resume 源(room 派发、主 agent 子代理、跨会话)。
- **B. 真实流式**：钉根因并让 token 粒度真正产生成串 `assistant/chunk`(检查 live 通道是否真实结算、`--include-partial-messages` 是否真正传递、live token 镜像的 settle-combined-final 是否触发);确保直接工具委派也落 assistant 内容。给出可自动化金样(简单问题 → 子会话 chunk 数 > 阈值)。
- **C. room 排队态 + 运行态指示**：room 识别「成员忙」为可排队条件,挂到成员 dispatch 队列,显示「⏳ cc 排队中…」;把「空闲 / 运行中 / 排队中」纳入持久运行态指示(类 harness thinking 态);(可选)room 流式投影成员增量。

## 里程碑

- **M-A**：local-agent per-child resume 队列 + 可重试 `busy`(带单测)。
- **M-B**：token 流式根因 + 真流式金样(简单问题 → chunk 成串 + 落子会话)。
- **M-C**：room 排队态 + 运行态指示(+ 可选 room 流式投影)。

## 实现记录

(实施时登记:相关 Agent Note / PR / 包名)

## 验收标准(done 判定,绑定可插拔交付)

- 以独立插件包交付(现状即 `@khorsheed/dsh-local-agent{,-claude-code}` + `@khorsheed/dsh-room`),`dsh plugin add / remove` 可装卸,零 harness 改动。
- 真实 CLI 探针(简单问题,`live:true + token`):子会话 `assistant/chunk` 数 ≥ 阈值,且答案已落子会话(非仅工具返回值)。
- 同一成员连续派发:第二次不再 `failed(in-flight resume)`,而是排队并在首轮结束后自动接力;room 显示「排队中」→「正在工作」→ 完成。
- room 顶 / 对话头部在成员运行/排队列时给出持久指示。
- 包内测试 + 家族测试全绿;`check:plugins` / `check:hygiene` 通过。

## 风险 / 放弃的东西

- live 通道若在特定环境根本起不来(seed 差异),须如实降级并暴露日志,不能静默回退 exec 制造「配了没效果」。
- 排队会掩盖瞬时并发,须防队列饥饿 / 死锁(每个 settle 路径必须唤醒,错误路径补救)。
- 若 token 流式根因落在 harness/claude 契约(`--include-partial-messages` / `stream-json` 支持),需记 seam/upstream 候选,并把该点降级为「已知有限」。
- 现阶段不扩大:room 流式投影(§方案 C 可选部分)、双成员并行、跨会话协调排队等后续另立。
