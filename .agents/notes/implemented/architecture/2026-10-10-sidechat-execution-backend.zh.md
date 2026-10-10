# Agent Note: sidechat execution backend port — open/send/read/cancel/release behind one owned seam

Status: implemented

## Problem

[执行路由接缝](2026-10-10-sidechat-execution-route-seam.md)让挂载方能钉住侧边 agent 的 route/cwd，但执行仍经由挂载 Context 的 `agents` 服务落地——而在消费方的拓扑里，那个服务**就是**管理宿主的注册表，每个侧边 agent 依旧落在管理宿主上。按目标重新实现一整套宿主 `agents` 服务不是可行的接缝（那个接口是宿主的整个 agent 世界：create/resume、作用域 setup、生命周期）。provider 契约需要一条 sidechat 自有的窄端口，恰好覆盖服务为执行而触达的一切。两个相邻缺口随它一起合上：运行中的侧边 turn 此前**没有**停止手势（唯一的停止是卸载时的 `disposeAgents`），而冷读路径（`inspectCold`）与 dispose 竞态直接焊死在 `ctx.agents`/持久化上，不在任何可注入边界之内。

## Decision

增量式；通用命名；版本保持 0.2.3；线上未动（生成的 typert 面逐字节一致——用重建的 `lib/typert.host.d.ts` / `lib/typert.remote-client.d.ts` 与主检出 diff 验证）。

- **端口**（`src/execution.ts`，从包根导出）：`SideChatExecutionBackend` = `capabilities` + `open(init)`（懒 create 与冷 resume 共用一个动词，由 `init.resume` 区分；resume 失败抛出，服务自己回退到全新打开）+ `readCold?(sessionId)`。`SideChatExecutionSession` = `sessionId` / `resolvedPresetId?` / `status` / `events()` / `send({ text, source })` / `syncTools?()` / `cancel?()` / `release()`。服务此前为执行而触达 `ctx.agents`、句柄、`inspectCold` 的**每一处**都改走端口：`ensureSession`/`openSession`（原 ensureAgent/spawnAgent）、live 状态覆盖、`stateOf`/`activityOf`、openWith 的工具再同步、send 的 followup、以及 `disposeAgents`（现在释放的是会话）。
- **open 载荷带解析结果**：`{ contextKey, sessionId, resume, route?, presetId?, cwd?, segmentText(), tools() }`——route/preset/cwd 由服务的解析链解析好（显式配置 > 调用会话 > 记录 > 插件配置；cwd 只是首次打开的事实，resume 重放创建时的一切）。`segmentText`/`tools` 是**活读取器**（进程内 thunk）：后端每轮组装重读它们——回合级新鲜度按构造对任何后端成立。引用（refs，即附件语义）永不到达后端——服务在 `send` 前已折成 `<quoted_context>` 正文块，投影时按同一格式解析回来，与之前完全一致。
- **默认后端**（`SideChatDefaultExecutionBackend`）是此前 `ctx.agents` 行为的原样抽出：**含** `agentDefaultModel` 探测的完整路由链、经 `composeSideAgent` 的 preset 链、cwd 链、作用域 setup（prompt section + 按名替换的调用方工具）、经 `inspectCold` 的冷读、以及经 agent 自带 `cancel({ kind: 'user' })` 的取消（按会话探测——老宿主线上 agent 无此能力时，其会话就没有 `cancel`）。`agentRoute`/`cwd` 配置键保留，经载荷消费。
- **注入**：`SideChatConfig.executionBackend`，构造期一次性（工厂配置先例）。缺席 = 默认后端 = 本地行为逐字节不变。注入后端后服务**绝不回退到部署默认**：`agentDefaultModel` 探测与「无调用方且无路由」的 `agent-unavailable` 拒绝都是仅默认后端的规则——被注入的后端自己拥有路由（载荷里的 `route` 是建议性的，可以缺席）。
- **能力逐项降级，绝不崩**：`{ presets, promptContext, callerTools, cancel, coldRead }`。服务侧闸门：`callerTools: false` 静默跳过 openWith 的工具同步；`cancel: false` 让停止手势带码拒绝；`coldRead: false` 让冷读诚实回答未知（transcript 空、错误/时间 null、status 仍 `cold`）。`presets`/`promptContext` 由后端自己兑现——服务照传 `presetId` 与读取器；能力标志绝不改写载荷。
- **停止手势是新暴露的，仅宿主侧**：`ctx.sideChat.stop(contextKey)`，`SideChatStopOutcome` 带码拒绝三分：`not-found` / `not-running` / `cancel-unsupported`。探查结论：sidechat 此前没有任何停止路径（客户端无按钮、服务无动词，只有卸载时的 dispose）；端口的 `cancel` 正是这个手势的载体。Remote 不动——线上保持原样。
- **dispose 联动**：open/dispose 竞态守卫推广到端口（`refuseLateSession` 把迟来的会话在落地时 release 并以带码 disposed 错误拒绝调用方）；同根重建在注入后端下同样成立——resume 经 `open({ resume: true })` 落到后端自己的持久日志上。

## Alternatives considered

- **按目标重新实现 `agents` 服务**（消费方的第一版形态）：注册表接口是宿主的整个 agent 世界；那么宽的假货是分叉，不是接缝。端口恰好是 sidechat 实际执行的操作集合——窄到一个 provider 能诚实地实现。
- **后端返回投影好的 transcript 行**（而非原始会话事件）：投影词汇（`projectTranscript`、`<quoted_context>` 反折叠、turn-end 错误扫描）就得由每个后端重实现；原始 `SessionEvent[]` 把投影器留在服务里独一份，且默认后端的事件**就是**会话日志——投影保真度按构造保持。
- **按变更推送快照**（segment/tools 以值的形式进载荷、openWith 时再推）：不保每轮新鲜，除非每次变更都推送，还得为每类贡献加一条同步动词；活读取器以零新增表面对任何后端保住新鲜度不变量（prompt-section 文本提供器模式的推广）。
- **放宽 Remote 面**（线上停止动词、或无调用方 send）：拒绝——这条接缝只供宿主侧消费，浏览器永远持有会话，且 typert 边界已否决可选 agent lookup（见[路由接缝笔记](2026-10-10-sidechat-execution-route-seam.md)）。
- **让 `agents`/`sessions` 注入随后端注入而变为可选**：cordis 的 inject 是静态的；注入后端后 Context 的 `agents` 只是永不被动用（空桩即可，README 已记），`sessions` 仍供电 cwd 继承链。不值得为此改 boot 语义。
- **`cancel` 放在后端而非会话上**：cancel 指向某个 live 会话；按会话的可选方法还能建模老宿主线上 `Agent` 无此能力的情形——降级为带码拒绝而非崩溃。

## Consequences

- 新增模块 `src/execution.ts`（端口 + 默认后端）；包根导出端口类型与 `SideChatDefaultExecutionBackend`；`SideChatConfig` 增加 `executionBackend`；服务新增 `stop`；`tsconfig.host.json` 收录新文件。Remote 面、客户端、线上全部未动。
- 十四个新契约测试：端口驱动 open/send/read/release 且 `ctx.agents` 与 `sessionPersistence` 为抛错桩；载荷携带解析好的 route/preset/cwd；注入后端时绝不探测部署默认；无调用方且无路由的 send 经注入后端照常解析；冷读来自后端（绝不 resume）；同根重建经端口 resume；open/dispose 竞态把迟来会话恰好 release 一次；每条能力降级路径；能力标志绝不改写载荷；stop 经端口取消（默认后端经 agent 自带 `cancel({ kind: 'user' })`）；stop 的带码拒绝与 dispose 后拒绝。全部 96 个既有测试**原样**通过——默认后端抽出的行为逐字节一致（总计 110）。
- [路由接缝笔记](2026-10-10-sidechat-execution-route-seam.md)里「`agentRoute`/`cwd` 对非本地目标够用」的隐含假设在该情形下被取代（事实已在该笔记更新）：那两个键只参数化「经 Context 的 `agents` 服务的创建」；在别处执行的接缝是注入后端。
- 注入的后端仍须容忍包的静态 inject（`agents`、`sessions`——README 已记空桩）；在 `release` 与下一次 `open({ resume: true })` 之间什么都不持久的后端，会让该上下文下次发送时降级为全新会话（resume 失败回退，映射自我纠正）。

## Related

- [sidechat 执行路由接缝](2026-10-10-sidechat-execution-route-seam.md)——本端口所基于的配置键与 dispose 守卫。
