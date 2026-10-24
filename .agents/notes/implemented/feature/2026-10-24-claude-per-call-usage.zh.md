# Agent Note:claude 子会话日志携带逐调用用量(来自每个 assistant 事件的内联上报)

Status: implemented

## 问题

在 Context Lens 里,claude 成员的中间步骤(那些 Bash 调用)显示 — tok:只有一轮的最后一条回复带用量,而且带的是整轮总量。与此同时 kimi 成员早已按请求记账。claude 的 wire 从来不缺数据:stream-json 流里每个 assistant 事件都内联上报当次 API 调用的用量(`input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens`);末尾的 `result` 事件带的是整轮合计(已验证:result 的各桶等于逐事件之和)。折叠只是从没读过 `message.usage`。

## 决策

折叠把每个 assistant 事件的内联用量盖到该事件折出的最后一行(`ClaudeTranscriptLine.usage`):多块调用(思考 + 文本 + tool_use)只记一次;纯工具调用的用量落在工具行的通告 assistant/message 上(`tool/call`/`tool/result` 事件本身没有用量槽)。写出路径一律 line.usage 优先;整轮总量(来自 `result` 事件)降级为纯兜底——只有当整条流没有任何逐调用用量时才写到最后一条非工具行(否则求和型读者会重复计数)。live 路径无需等待:用量随事件到达,历史上「carrier 在用量可知之前就被镜像走」的丢失基本消失。整轮总量继续供运行记账(进度/settle 上报),不变。

codex 刻意不在本次改动内:它的 exec 流只在 `turn.completed` 报用量(而且还是最后一次调用的);rollout 的 `token_count` 事件虽然带逐调用 `last_token_usage`,但 exec 镜像是实时写入的,宿主日志只增不改、没有 usage 回填事件——逐调用挂接要么把所有镜像憋到 settle(杀死实时进度),要么等上游提供回填缝。记录在此,下次有人问可以直接从证据开始。

## 备选方案

- **整轮总量留最后一条 + 其余行带逐调用**:每个求和型读者(lens 的轮次合计、宿主 tokenUsage 投影)都会重复计数。否决。
- **多块调用的每一行都带该次用量**:一次调用粒度上的重复计数。最后一行规则与 kimi 的「一次请求一条 usage.record」落位一致。

## 影响

- 新的 claude 成员轮次:每个结束了一次 API 调用的步骤在 Context Lens 里显示自己的输入/输出/缓存桶;工具步骤不再是 —。
- 旧子会话日志不变(总量在最后一条,依然可读;旧轮次的中间调用在逐记录缓存分析里缺席)。
- Context Lens 无需改动:同一个 `assistant/message.data.usage` 字段,只是按调用填上了。

## 测试

`pnpm --filter @khorsheed/dsh-local-agent-claude-code test`(266):折叠层用例断言每次调用的用量落在自己的最后一行(思考+tool_use → 工具行;回复 → 文本行),且 `parsed.usage` 上 result 事件的整轮总量不动;exec 镜像用例用可控子进程跑一轮两次调用,断言两条 assistant 消息各带各的桶、没有任何消息携带整轮总量。既有的「用量挂最后一条」用例保持通过:它们的夹具流没有逐事件用量,兜底路径被原样覆盖。
