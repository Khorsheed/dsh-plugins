# Agent Note: Local-agent 子会话镜像补写 step 边界

Status: implemented

## Problem

一次委派 CLI 轮次（在 Codex 上观察到，但全家族同病）产出的结果是完整的——父会话拿到了完整答复，子会话日志里镜像事件一条不缺——但子会话的 web 实时视图只能看到用户 prompt 和工具卡片。最终 assistant 文本（以及所有中间的 think/text 行）在整页刷新之前完全不可见。

根因在宿主的实时会话渲染管线，不在数据。`ui-chat` 的 assistant 定义只物化 location 解析为 **step** 的 `assistant/message`，而 location index 在增量 append 路径上只从 `step/start`/`step/end` 边界事件学习 step（`ui-conversation` 的 `location-index.ts`；全量 `rebuild()` 会按显式 `(turn, step)` 坐标补建 step 草稿，这就是刷新后内容恢复的原因）。local-agent 的镜像从不写 step 边界：每条合成的 `assistant/message` 都解析为 turn 级 location，被实时视图静默丢弃；`user/message` 与 `tool/call`/`tool/result` 能渲染只是因为它们的定义不查 step location。live 驱动的 token 粒度模式上面还叠了第二个缺口：它唯一一条合并最终消息是在 `turn/end` **之后** append 的，落在 turn 窗口之外。

## Decision

每个镜像 step 都包上自己 `(turn, step)` 坐标的 `step/start`–`step/end` 边界对：

- **codex / claude-code**——`appendCodexTranscriptLine` / `appendClaudeTranscriptLine` 在每条折叠的 transcript line 前后写边界对；被 options 跳过的 line 不写边界。
- **kimi**——`mirrorKimiSessionDelta` 同样逐行包边界。迟到结果 backfill（`tool/result` 比它的 call 晚若干个 pass 到达）**裸用** call 的坐标——不写第二对边界，因为 live assembler 对同 context 的重复 start match 直接抛错。step 仍处于登记状态，裸结果仍能解析到 step location。
- **dsh**——镜像把 sub-dsh 会话真实的 `step/start`/`step/end` 事件逐字拷贝过河，不再当脚手架过滤掉（sub 会话的 turn 编号与父侧设计上对齐）。skip 前缀对齐在两侧同时计入边界，重复 poll 不会重拷一对。被 interrupt 而没有 end 的 step 以开口形态过河；绝不合成边界。
- **token 粒度合并最终消息**（codex / kimi / claude live 驱动）——从 detached 的 settle 后链（`turn/end` 之后）挪进 settle 链里、`turn/end` **之前**，并包边界对，使其在 turn 窗口内、footer 之上渲染。kimi 的窗口内写入先跑一遍有界的 settle 静默镜像（3 次稳定读 × 300ms，3s 上限），保证消息仍携带该轮 usage。

## Alternatives considered

- **上游修 ui-chat**——让 assistant 定义在无 step 边界时回退到 turn 级 location 渲染。那是宿主改动，必须走 upstream-change 流程；它是在糊弄契约而不是履行契约，而且宿主的 `TokenMeter.measure()` 折叠（对无 step 的 assistant message 直接**抛错**）只差一个调用方就会在镜像会话上炸开。插件侧补边界对今天在每一条宿主线上都成立。
- **kimi backfill 写第二对边界**——让每条内容事件都落在某对边界里看起来更整齐，但 assembler 每 context 只允许一个 start 的规则会让重复 `step/start` 变成实时视图里抛出的错误，比"裸结果照样渲染"严格更差。
- **kimi token settle 不等静默**——立即写合并消息能保持 result 延迟不变，但 prompt 响应之后才 flush 的 usage 记录会失去载体（宿主没有 usage 回填事件），该轮记账被静默丢掉。有界等待保住了 exactly-once 记账。

## Consequences

- 子会话实时视图现在随轮次推进渲染 assistant 文本、thinking 和 turn footer（耗时 + 用量），exec 与 live 两种驱动、四个 provider 全部生效。
- 镜像会话每个 step 多约两条事件。事件量本来就小；持久化批次不变。
- kimi token 粒度轮次的 settle 最多晚 ~0.9–3s（窗口内静默等待），取消路径同样——这是保住 usage 载体的代价；event 粒度轮次不受影响。
- token 统计从来不受影响：宿主的 `tokenUsage` 投影纯事件驱动（不依赖 step），member dock 的数字一直在计这些轮次。每条消息的计时丸（llmMs / TTFT / 解码速度）对镜像会话仍然缺失——它们需要 `step/start` 时间戳加逐 chunk 事件，而 exec 路径镜像的事件时间戳是镜像时刻。
- 插件今天**无法**向镜像子会话实现真·逐 token 流式：durable `assistant/live-chunk` 不在可 append 的 `SessionEventMap` 里，瞬态 `agent/assistant-stream` 总线按持有会话 Agent 句柄的一方路由——镜像会话没有 Agent。event 粒度镜像（按完成 item）就是上限。另外，`localAgent/run-progress` delta 通道仍无 UI 消费者（member dock 把 run progress 列为 "later"），逐字流式的实时增量在它落地之前不可见，这是设计内缺口而非渲染 bug。

## Testing

各 provider 的测试都带 `expectStepBoundaries` 帮助函数，断言每条镜像的 `assistant/message`、`tool/call`、`tool/result` 都落在同坐标边界对内（kimi 的帮助函数豁免设计内的裸 backfill）；token 粒度套件另外断言合并最终消息先于 `turn/end`、其坐标的事件序恰为 `step/start → assistant/message → step/end`；dsh 套件断言 poll → settle 不会重拷边界对。
