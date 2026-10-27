# Agent Note: Context Lens shows ask_user_question as a question card

Status: implemented

## Problem

成员或主 agent 调用 `ask_user_question`（裸名，或带 MCP 前缀，如 `mcp__dsh-member__`）时，Context Lens 只显示原始参数和原始的 `{"answers":[…]}` 结果。想知道问了什么、人选了哪个、等了多久，只能肉眼读 JSON。驱动 10-27 修复之前写下的成员镜像还会丢掉嵌套的 `questions` 参数，这些调用什么都看不到。

## Decision

名字以 `ask_user_question` 结尾的工具调用渲染成标题为「问你」的卡片。每个问题占一行，`header` 显示成小标签。下面依次是选项（选中的高亮）、「你的回答」一行，以及「其他：…」形式的自由文本。卡片还会显示状态和等待时长。

- 问题取自调用自己的参数。参数缺失时，取房间的 `room/question` 记录，这样旧日志不用改写也能显示。
- 对房间记录时先按 `runId` 对：这次 run 的 `childSessionId` 必须是请求的 scope，`childTurn` 必须是请求的宿主轮次。run 确认不了轮次时，问题还必须在调用前后 30 分钟内。兜底是按同一成员、30 分钟内匹配：优先选回答与调用结果一致的记录，否则选时间最近的。
- 等待时长取房间的「提问 → 回答」时间。没有房间记录时，取调用自身的耗时。
- 状态：
  - 房间里的回答优先于调用结果，因为补答会在调用已经失败之后才到。这时调用自己的失败显示为一条附注。
  - 房间里被取消，显示「已过期，仍可回答」；`late: true` 显示「已补答」。
  - 失败文本的对应关系：`-32001` / "Request timed out" → 等待超时，"aborted before the user answered" → 已中止，"user cancelled" → 已取消，过期 → 已过期。其他情况显示原文。

## Alternatives considered

- **用房间里的问题改写旧成员日志。** 日志是只追加的历史，而真实内容本来就在房间里。
- **只按成员和时间对。** 同一会话里一个成员问好几次很常见，先按 `runId` 对可以避免串题。

## Consequences

Context Lens 只读，房间和各家 CLI 驱动都没有改动。一个调用既没有参数、也对不上房间记录时，卡片会说明这次没有记录问题内容。

## Testing

`context-lens`：`tests/ask.spec.ts` 覆盖名字识别、参数与房间两种来源、过期/补答/超时/中止/取消、runId 匹配、按成员兜底，以及拒绝几小时之外、确认不了轮次的 `runId` 记录。`tests/client-tool-results.spec.tsx` 渲染卡片的已回答和已过期两种状态。
