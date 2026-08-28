# Agent Note: 镜像工具活动渲染为原生工具卡片

Status: implemented

[English](2026-08-23-mirror-native-tool-cards.md) | 中文

## 问题

此前镜像进子会话的工具活动被折叠成 assistant 消息里的 `[工具 X] args → result` 纯文本,而思考早已映射为原生 `reasoning` block。官方对话视图对文本原样渲染,所以工具调用难读——无卡片、无配对、无折叠——尽管官方 UI 本来就有由 `tool/call` + `tool/result` 会话事件驱动的原生工具面(agent-loop 自己的写法,ui-conversation 的 tool 节点渲染)。

## 决策

四家 provider 的镜像统一改为发官方事件对,不再写文本:

- `tool/call` 带 `{ turn, step, callId, name, arguments }`,随后 `tool/result` 带 `createToolResultMessage(...)`,`sourceEventSeqs` 指向子会话里的 call 事件(绝不引用源日志的 seq 编号)。render intent 保持 null,卡片走文档化的 generic JSON card。
- kimi(`session-mirror.ts`):wire fold 的 tool 行新增稳定 `id`(wire 的 `toolCallId`/`uuid`,否则按位置合成)。结果合并进已镜像行(并行调用乱序 settle)时,从子会话自身的事件台账回填 `tool/result`——空 delta 的提前返回挪到回填之后,因为结果合并不改变行数。
- codex:`CodexTranscriptLine` 把 `detail` 拆成 `args`/`result` 并携带流条目 id;exec NDJSON fold 与 app-server 条目 fold(`codexAppServerItemToLine`)共用该形状。
- claude:tool 行携带 `tool_use` id,结果按 `tool_use_id` 配对(无 id 的流保留"最后一条 tool 行"兜底);exec 与 live 共用 `ClaudeStreamParser`。
- dsh:镜像的 span 过滤器放行子 dsh 自己的 `tool/call`/`tool/result` 事件(本来就是官方格式——除 `sourceEventSeqs` 重映射外逐字拷贝);live 逐事件路径同样放行。
- run-progress 的 delta 文本保留 `[工具 X]` 字符串形式——那个面本来就是纯文本。

## usage 挂载(微妙的部分)

`tool/call`/`tool/result` 事件没有 usage 槽位,而 tokenUsage 投影只在 append 时从 `assistant/message.data.usage` 或 `assistant/chunk` 的 usage chunk 折叠。被杀掉的 run 只有在 settle 时才拿得到用量(codex 从 rollout 文件恢复),此时载体行可能早已镜像出去。因此:usage 挂在最后一条非 tool 的转写行(命令执行中被杀时转写恰好以 tool 行结尾——这正是 rollout 恢复存在的场景);当载体已通过实时镜像先于 usage 发出时,镜像改用钉在载体 step 上的 `assistant/chunk` usage chunk 记账(投影对同 step 的重复样本是替换而非重复计数)。

## 考虑过的替代方案

- **保留文本行**——零成本,但对比/审查场景需要可读的工具活动;原生面就是为此存在的。
- **改写已镜像事件的 `data.usage`**——token 投影在 append 时折叠,事后改写永远到不了 UI 汇总;usage chunk 才是可折叠的通道。

## 影响

- 镜像卡片是 generic JSON card(名称 + 入参 + 结果,可折叠);逐工具的 render intent(`diff`、`terminal`)不可用,因为子会话的工具注册表里没有这些镜像调用的条目。
- 本改动之前镜像的会话保留文本行(日志只追加,不做迁移)。
- kimi 镜像的空 delta pass 现在只在回填产生了事件时才持久化。
