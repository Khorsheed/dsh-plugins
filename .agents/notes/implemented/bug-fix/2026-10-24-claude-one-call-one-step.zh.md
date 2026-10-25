# Agent Note:一次 claude API 调用折成一个 step,用量只记一次

Status: implemented

## 问题

claude 成员的 Context Lens 轨道上有两个肉眼可见的缺陷:

- 一次 API 调用显示成好几条请求记录。claude 把一条消息按内容块逐块发 assistant 事件(thinking / text / tool_use),而镜像把每块各折成一个 step——于是「先看看有什么工具」+ 调用 ToolSearch 这一次调用读成了两次请求。
- 逐调用用量落地后,这几条记录齐刷刷显示同一份用量:wire 在每个分块事件上重复整条消息的 usage,折叠也逐事件各自盖章。

## 决策

- 折叠给每行标 `messageId`,并维护按消息的盖章账:用量只留在该调用的最后一行,之前落在哪行就从哪行摘掉——即使不做组折叠,多块调用也恰好只记一次。
- exec 镜像(live 与 settle 两条路径)改为按组折叠(`groupClaudeTranscriptLines`):连续同 messageId 的行合成一个 step,一条混合内容的 assistant/message(推理 + 文本 + tool-call,与宿主、kimi 同形),工具生命周期包在其中,用量只记一次。无 id 的行保持单件单元,旧流与既有夹具的形状逐字不变。
- 整轮总量兜底(最后一个含非工具行的组)只在全流没有逐调用用量时启用;persistent live driver 的末尾流快照同样抑制,快照绝不与逐调用读数重复。persistent driver 保留按块的流式 step;上面的去重保证它不再重复记账。

## 备选方案

- **保留按块 step、只去重**:重复数字没了,但一次调用仍读成多次请求——这才是用户真正的不满。组折叠才是修复,不是审美偏好。
- **用量放到组的第一行**:文本 step 有数、工具 step 又是 —。最后一行与 kimi 的「一请求一条 usage.record」及宿主的工具 step 记账一致。

## 影响

- 新的 claude 轮次:一次 API 调用 = 一条 lens 记录,用量一次;文本 + ToolSearch 不再拆开,21.2k 不再在两条上重复。
- 另查证的「第 4 轮输入飙到 40k」是真实的上下文增长,不是重复计数:那次 `room_read` 返回了 38,337 字符(约 2 万 token,含完整 planCommands JSON Schema)。随后调用的 cache_read 与 cache_creation 分别对应旧前缀与新返回,并不重叠。room_read 返回体可以瘦身,是另一个优化候选。
- 旧子会话日志不变;persistent live driver 的 step 仍按块,但不再重复计数。

## 测试

`pnpm --filter @khorsheed/dsh-local-agent-claude-code test`(267):折叠层用例断言按 message 去重(较早块的用量被摘掉);exec 镜像用例把一次调用按分块事件驱动,断言只有一个 step、一条 [text, tool-call] 混合消息、一份用量、一套工具生命周期,且日志通过 released-log 校验。既有无 id 夹具套件逐字通过。
