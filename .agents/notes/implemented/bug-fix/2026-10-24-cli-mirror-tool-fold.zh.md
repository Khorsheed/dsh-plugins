# Agent Note:codex/claude 子会话镜像如实折叠延迟工具循环

Status: implemented

## 问题

房间里跑了工具循环的成员轮次,在 Context Lens 里要么显示成两条光秃秃的相邻「助手回复」(codex),要么显示成一个标着「工具失败/被中断」的工具步骤加一条回复(claude)——看上去和 kimi 之前的「一轮被拆成幻影多条」一模一样。但 CLI 自己的转录(rollout / transcript)给出的地面实况是:拆分本身是对的(两次真实的 API 调用,中间夹一次工具调用,与 dsh 主会话的工具循环同形);真正坏的是镜像把中间的工具丢了:

- **codex**:成员用了 codex 的延迟发现工具,rollout 记为 `custom_tool_call` / `custom_tool_call_output` item。共享折叠(`foldCodexStreamLine`)有 `command_execution` / `web_search_call` / `function_call` / `file_change` 的分支,唯独没有 custom 工具——调用和结果一起消失,留下两条回复中间空无一物。(live 驱动有 `dynamicToolCall` 分支,但把结果丢了:app-server 把结果内联在 item 的 `contentItems` 里。)
- **claude**:`ToolSearch` 的结果是由 `tool_reference` 块(每个被发现的工具一块)组成的 `tool_result`,而 `toolResultText` 只保留 `text` 块。提取出来是空串,跳过了挂接,这次调用一直没有结果,settle 时步骤以中断占位(`（工具调用被中断，未能记录返回结果）`,`isError`)关闭——一次实际成功的调用(回复里确实用到了发现的工具)被记成了幻影失败。被扣住的折叠还把整轮的镜像写入挤成轮末一次爆发,这就是 lens 里两条记录都显示 0.0s 的原因。

## 决策

修两个折叠,拆分的语义不动:

- codex exec/流折叠:`custom_tool_call` 折出工具行(`name` + `input` 作参数);`custom_tool_call_output` 把 string 或块数组的输出摊平,按就近原则并进pending工具行——与 `function_call_output` 同一惯用法。工具记账按 `custom_tool_call` 计(折叠一贯按 CLI 自己的 item 类型记账)。
- codex live 映射:`dynamicToolCall` 读取内联 `contentItems` 的文本块作为结果。
- claude 折叠:`toolResultText` 也把 `tool_reference` 块渲染成发现的工具名,一行一个——这些引用本身就是结果。

「一次 API 调用 = 一条 lens 记录」的规则不变;每个镜像 step 仍各自包在 step/start–step/end 边界对里。step 分组不动:codex 本来就让每条工具行独占一个 step,claude 把调用+结果折进一个 step。

## 备选方案

- **把成员整轮折成一条记录**:否决——会破坏 lens 赖以工作的「一请求一记录」契约(也是 kimi 折叠确立的规则),还会把主会话本来展示得好好的真实工具循环藏起来。
- **按 `call_id` 配对 custom_tool_call_output**:流里结果紧跟调用,折叠既有的惯用法(function_call_output)就是就近配对;除非流会交错两个未决的 custom 调用(codex 不会),多维护一张映射表没有收益。

## 影响

- 新的 codex 成员轮次会把延迟工具调用(`exec` 等)显示为两条回复之间的独立步骤,带真实输出;新的 claude 成员轮次里 ToolSearch 显示为成功,结果是被发现的工具列表。
- 旧子会话日志不变——历史轮次保持幻影中断的样子(日志里写的就是占位结果;要不要重镜像旧转录是另一个工具问题)。
- Context Lens 无需改动:写出的事件就是它已经在渲染的标准 tool/call + tool/result。

## 测试

`pnpm --filter @khorsheed/dsh-local-agent-codex test`(251:exec 折叠用例新增 custom_tool_call 块数组输出的往返;live 映射用例新增内联 `contentItems` 结果)与 `pnpm --filter @khorsheed/dsh-local-agent-claude-code test`(264:ToolSearch 的 tool_reference 结果折成发现的工具名并计入记账)。两处夹具逐字取自观测到的 rollout/transcript(成员 剪刀手二号 / 剪刀手四号,2026-10-23/24)。
