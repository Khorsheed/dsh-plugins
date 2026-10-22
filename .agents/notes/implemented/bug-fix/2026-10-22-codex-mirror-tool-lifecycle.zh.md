# Agent Note: codex 子会话日志通过 released-log 读取端(原生工具生命周期)

Status: implemented

## Problem

凡是用过工具的 codex 子会话都无法重新打开:released-log 读取端对存储日志的每次冷读都跑 `assertReleasedV4Relationships`(harness `session-format-v3-to-v4/relationships.ts`),而 codex 镜像的 durable 落盘在两个轴上违反了这份契约——增量 append 路径上看不见,历史重载时全部致命:

- **裸工具生命周期。** `appendCodexTranscriptLine` 折叠 `tool/call` 时不带读取端用于配对的通告 assistant/message(`has no advertised tool lifecycle`),且流里没有结果时直接关闭步骤(`leaves unresolved tool call`)。结果缺失在两条驱动上都是常态:`web_search_call` 项从不携带结果,live wire 上 `dynamicToolCall`/`mcpToolCall` 的完成项也没有,进程被杀还会截断命令输出。现网每个用过工具的 codex 子会话都无法加载。
- **exec 路径在 `turn/end` 之后折叠。** 退出后 settle 镜像跑在 turn 边界(结果 settle 时落盘)之后,它折叠的任何内容——被抑制的最后一行、被杀 run 的尾部命令——都落在开放 turn 之外(重载时报 `step/start does not match the open turn and next step`)。

kimi provider 有过同一缺陷族并已给出参考修复——见 [kimi released-log 笔记](2026-10-22-kimi-mirror-released-log-validity.md);本改动把它移植到 codex 的形态上。codex 的并发步骤暴露面比 kimi 窄:exec 实时镜像恰好只抑制那一行可变行(`function_call_output` 仍可能并入它),live driver 的 `item/completed` 通知同步折叠,因此没有任何折叠会看到结果仍在途中的调用。

## Decision

codex 子会话只落盘 released-log 读取端承认的日志形态;工具行在**一个原子步骤内折叠原生生命周期**:`step/start` → 通告 `{type:'tool-call', id, name, arguments}` 内容块的 assistant/message(与调用事件严格一致)→ `tool/call` → `tool/result` → `step/end`。

- **共享折叠**(`local-agent-codex/src/codex-cli-provider.ts` 的 `appendCodexTranscriptLine`):所有驱动共同经过的唯一折叠——exec 实时镜像、exec settle 镜像、live driver 的完成折叠都调用它,生命周期修复一次落到两条传输上。与 kimi 不同,这里**没有抑制趟**:codex 的每次折叠看到的都是已完成项,fold 时刻缺失的结果永远不会再到达——调用以合成的中断错误结果收尾(`CODEX_INTERRUPTED_TOOL_RESULT`,与 kimi 占位文本一致,保持家族统一)。
- **exec `turn/end`** 从 settle 链挪到退出后镜像链,在 settle 镜像之后落盘(仍串行在实时镜像队列之后)并随镜像持久化,每个镜像步骤都落在 turn 窗口内。run 的 `result` 仍在真实时刻 settle——中止延迟不变,挪的只有边界事件。
- **live driver 其余部分不动**:流式快照、步骤预留、规格钉住的按步骤事件序列全部照旧;只有工具折叠的事件组合变了。
- **回归覆盖**:`tests/expect-valid-log.ts` 把规格的子会话日志重放进 harness 自己的 `assertReleasedV4Relationships`;折叠单元测试与 exec/live 轮次、续聊、崩溃、取消、中止规格都断言它。

## Alternatives considered

- **未得结果即抑制,offset 式**(kimi 镜像的轮中规则:在未得结果的工具行前停下,等 wire 记录结果后重试)。codex 的折叠永远观察不到这个状态——exec 的抑制行覆盖了 `function_call_output` 的并入窗口,live wire 原子完成各项——抑制只会在真正无结果的项类型(`web_search_call`)上永远卡住 offset。折叠时刻直接合成中断结果,就是把 settle 语义应用到每一处,不需要 offset 机制。
- **上游放宽校验器**(容忍未通告调用或 turn 外的步骤)。那是走上游流程、粉饰契约的宿主改动;插件侧落盘在今天每一版宿主上都能满足契约。与 kimi 笔记的答案相同。
- **在已关闭坐标上裸回填迟到结果**(kimi 删掉的机制)。读取端拒绝开放步骤之外带 `surfaceOp: 'append'` 的 `tool/result`;而且 codex 的折叠点也不需要它——结果若存在,fold 时刻已经在行上。
- **重设 live driver 的预留账本以实现稠密步骤编号。** 工具在流预留与完成折叠之间完成时,其步骤号排在预留之后,存储的 start 不再按 wire 顺序(合成的 tool-first 规格正是这个形态)。预留方案是实时投影的时序机制,流式规格钉住了它的精确序列,本改动不动它;该缺口记入 Consequences。

## Consequences

- 用过工具的 codex 子会话——exec 与 live——在规格重放的每条路径上都经得起 released-log 读取端,包括命令执行中被杀和无结果项类型。
- 镜像的工具调用现在在子会话日志里多带一条 assistant/message(通告);实时视图的按步骤锚定不变。本改动之前写入的日志是 append-only,冷读仍然无效——修复只覆盖新折叠。
- exec 的 `turn/end` 时间戳现在包含 settle 镜像的静默期;run 结果的 settle 时刻与中止延迟不变。
- 已知缺口,留给包负责人:live driver 的预留账本在工具于流预留与完成折叠之间完成时,仍可能持久化非稠密的步骤 start(这条 wire 上步骤从不重叠开放——`item/completed` 同步折叠——所以 kimi 那类违规不会发生,但这种日志重载仍会卡在稠密步骤规则上)。codex 尚未在现网观察到;若出现,kimi 的 gap-fill(`finalizeBefore`)就是模板。

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-codex test`(20 个文件,244 个测试),含折叠单元测试、exec settle/resume/error/abort 规格、live 轮次/resume/crash/cancel/stream-settle 规格上的 `expectValidReleasedLog` 重放;`pnpm --filter @khorsheed/dsh-local-agent-codex run build`。
