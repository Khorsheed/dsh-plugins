# Agent Note: kimi 子会话日志通过 released-log 读取校验（原子 step、原生工具生命周期）

Status: implemented

## Problem

一个 kimi live 委派的子会话无法重新打开：报 `stored session … is corrupt: … step/start does not match the open turn and next step`。released-log 读取端在每次冷读存储日志时校验（`assertReleasedV4Relationships`，harness `session-format-v3-to-v4/relationships.ts`）：step 必须稠密、严格顺序、同一时刻最多一个打开，且每个 tool call 必须有在先 assistant/message 的通告、并在 step 关闭前取得结果。

kimi provider 的事件发射以四种互相独立的方式违反了该契约：

- **并发打开的 step（本次观测到的故障）。** live driver 在流的第一份快照时写入 `step/start` 并保持打开，直到对应 wire 行被 fold 或轮次 settle。kimi 的 ACP 在毫秒级内完成 think→text 切换，而文件 fold 要等 CLI 的 wire flush 加 500ms 镜像节流，于是第二个 `step/start` 在第一个 step 未关闭时就已落盘。持久化是 append-only：非法顺序从那一刻起即成事实，即使正常 settle 也无法修复（`step/end` 排在两个 start 之后）。
- **裸工具生命周期。** mirror fold 的 `tool/call` 缺少读取端用于配对的通告消息；wire 尚无结果时就关闭 step（两者在读取时都会被拒）；迟到结果的 backfill 把裸 `tool/result` 追加到已关闭的坐标上（同样被拒）。
- **exec 路径在 `turn/end` 之后 fold。** 进程退出后的 settle 镜像原本排在 turn 边界之后，其 fold 出的任何内容都落在已关闭的 turn 之外。
- 这些在增量 append 路径上都不可见（那里没有 step 顺序规则），只在历史重载时暴露。

codex/claude 的 live driver 共用同一套 reservation 机制，但它们的 wire 会立即送达每个 item 的完成事件，step 在下一个打开前已关闭，实践中不会触发；它们的 mirror 同样存在裸工具生命周期缺陷（已有一个 claude 子会话在真实环境中命中 `no advertised tool lifecycle`），dsh 镜像还可能把子会话被中断的打开 step 带过 `turn/end`——两者不在本次改动范围内，记录在此供各包 owner 跟进。

## Decision

kimi 子会话只发射 released-log 读取端承认的日志形状，规则只有一条：**durable step 在内容到达时以一个原子的 `step/start`→…→`step/end` 三元组写入，绝不跨 append 保持打开。**

- **Live driver**（`local-agent-kimi/src/live-driver.ts`）：流式增量只经 `local-agent/stream` 通道发布（成员 live 节点由这些事件自物化，无需边界）。流的 durable 内容以一个三元组落盘——由其完成 wire 行的 fold、gap fill 或 settle 写入。ACP `tool_call` 通知只预约时序 step 号，通知时刻不落任何 durable 事件。kimi 从未写进 wire 的工具预约在 settle 时收尾为中断占位 step（通告的 call + 共享的 `KIMI_INTERRUPTED_TOOL_RESULT` 错误结果）。
- **Gap fill**（`finalizeBefore`）：fold 准备在 step S 写入前，先把所有小于 S 的活跃流预约按升序收尾，保证落盘 step 稠密。被封存的流仍按 kind 配对；其完成行随后丢弃而不是重复内容；封存后收到新增量的流重新预约新 step（plan 流的情形）。
- **Mirror**（`session-mirror.ts`）：工具行在一个 step 内 fold 完整原生生命周期——通告 tool-call 块的 assistant/message、`tool/call`、`tool/result`。wire 尚未记录结果的行会拦住整个 pass（偏移停在该行之前；结果会合入同一行位置，下个 pass 即可看到）；settle pass 用中断占位结果收尾剩余部分。usage 窗口在拦住处关闭，usage 载体的计算跳过已封存的配对（被丢弃的行不能作载体）。
- **exec 路径**（`kimi-cli-provider.ts`）：进程退出后的 settle 镜像改为在 `turn/end` 之前、仍在镜像队列内运行，镜像出的 step 全部落在 turn 窗口内。run 的 `result` 仍在同一时刻 settle（abort 延迟不变）；turn 边界随镜像落盘。
- **回归覆盖**：`tests/expect-valid-log.ts` 把规格里的子会话日志送进 harness 自己的 `assertReleasedV4Relationships` 回放；live-driver 与 mirror 的规格在覆盖流、工具、取消、续跑的轮次上都断言它。

## Alternatives considered

- **上游放宽校验器**（容忍并发打开的 step 或迟到的越 step 结果）。属于走上游流程的宿主改动，且是在粉饰契约；client 装配器的一步一 start 规则也依然纹丝不动。插件侧的发射顺序在当前每条宿主线上都满足契约。
- **切换即关闭**：kind 切换或工具通知到达时立刻收尾当前流的 step。提前封存会让 reservation 失去意义——已封存坐标的 live 节点不再增长，中途的工具卡片还会迫使回答流重新预约——相比"在 fold 需要时恰好封存"（gap fill）没有任何收益。
- **按 wire 顺序重排未发布的 reservation**（让从未流式的 think 项排在流式回答之前 fold）。只有未发布的 reservation 可动，mirror 的 fold 账本与 driver 的 reservation 账本还得共用一套重编号协议，而收益只是罕见边角里的顺序美观——性价比不足，拒绝；接受的行为见 Consequences。
- **用保持打开的 step 保留进行中的工具卡片**：卡片能在工具运行期间显示，但其后的所有 fold 都被堵死，且工具被杀会导致 turn 永远无法关闭——严格劣于结果到达时再 fold 卡片。

## Consequences

- kimi 子会话——live 与 exec——在所有规格回放的路径上都通过 released-log 读取端，包括流式中途取消与工具被杀死断。
- live 渲染在与家族配套 core 上不变（`local-agent/stream` 通道本就承载它）。kimi 包搭配过旧、没有 `liveStreams` 的 core 时，子会话失去轮次中的部分文本（最终 fold 仍会补全 transcript）；家族是一起发布的，只有手工混装才会退化。
- 进行中的工具不再渲染 durable 卡片：卡片在 wire 记录结果时 fold（或在 settle 时以中断占位）。text/think 的实时流不受影响。
- 顺序保真以"live 到达序"而非 wire 序为准：从未流式的条目会排在先到达的流式条目之后 fold（reservation 建立时 wire 上那行还不可见）。若该静默条目的 fold 恰好丢弃了本轮 usage 载体，账目改由本轮 settle 观测承载而非消息——恰好一次保持，载体尽力而为。
- 工具结果的 `arguments`/`name` 保真度不变（沿用 wire 的渲染摘要）；本次改变的只是生命周期的合法性。
- 留给兄弟包 owner 的跟进项（附真实环境证据）：claude-code/codex 的 mirror 发射没有通告消息的裸 `tool/call`（已有一个损坏的 claude 子会话在案），dsh 镜像可能把子会话被中断的打开 step 带过 `turn/end`。它们的 reservation 时序让并发 step 违规不太可能而非不可能——两次快照落盘之间的崩溃即可复现。claude-code 那一半已落地：[claude-code 工具生命周期笔记](2026-10-22-claude-code-mirror-tool-lifecycle.md)。

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-kimi test`（22 个文件、275 个测试，含 `expectValidReleasedLog` 回放）；`pnpm --filter @khorsheed/dsh-local-agent-kimi run build`。暴露本缺陷的那个会话的修复（补缺失的 `step/end`、以 aborted 关闭 turn、保持 header 独立帧）已按同一套校验器语义手工验证。
