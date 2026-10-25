# Agent Note:codex live 轮次按 API 调用各自记录用量

Status: implemented

## 问题

codex 成员的中间步骤在 Context Lens 里显示 — tok:live 驱动只保留最后一次 `thread/tokenUsage/updated`,在轮末写到最后一条上。而且那一条带的是**末次调用**的用量,不是整轮合计——多调用轮次的 settle 上报(以及房间的每轮 token 数)因此一直少计。

## 决策

app-server 的 wire 以一次 `thread/tokenUsage/updated` 通知结束一次 API 调用,其中的 `tokenUsage.last` 就是该次调用自己的记账(位置与 rollout 的 `token_count` 相同:紧跟该次最后一个 item——已对照真实 rollout 验证)。现在每次通知把它的 `last` 盖到该次调用的最后一行(`usageByLine`),该行何时折叠就何时带上用量——包括仍保留结果合并扣留的最后一行。整轮兜底(最后一条非工具行)只在 wire 完全没有逐调用用量时启用;已有逐调用用量后,末尾流快照不再重复写末次读数。纯工具调用的用量落在工具行的通告 assistant/message 上(tool/call 与 tool/result 事件没有用量槽)。

settle 上报改为优先采用 wire 的累计 `tokenUsage.total`(不含数字的对象视为「未上报」,绝不覆盖逐调用读数),多调用轮次因此报出真实的整轮合计。

exec 轮次刻意不动:`codex exec --json` 只在 `turn.completed` 报用量;rollout 虽有逐调用 `last_token_usage`,但 exec 镜像实时写入只增日志、宿主没有 usage 回填缝——要么把所有镜像憋到 settle(杀死实时进度),要么等上游回填能力。

## 备选方案

- **把每次调用的所有行憋到用量通知到达再折叠**:通知紧跟该次最后一个 item,延迟其实可忽略——但工具调用行会因此在结果到达之前折叠成幻影中断。盖映射表、让行按原节奏折叠则完全绕开。
- **逐调用 `last` 求和当整轮合计**:只在「每轮每次调用恰好一条通知」时成立;wire 自带的累计 `total` 是权威值,不需要这个假设(且空 `total` 对象绝不能把它清零)。

## 影响

- 新的 codex live 轮次:每个结束了一次 API 调用的步骤都显示自己的输入/输出/缓存桶;同一次调用的更早行不带用量,不会重复计数。
- 房间每轮 token 合计现在是整轮总量,不再是末次调用。
- 旧日志不变;Context Lens 无需改动(同一个 `assistant/message.data.usage` 字段)。

## 测试

`pnpm --filter @khorsheed/dsh-local-agent-codex test`(252):两次调用的 live 轮次断言中间文本不带用量、工具行的通告消息带第一次调用的桶、最终回复带第二次的,settle 上报带累计总量。既有单调用用量断言原样通过。
