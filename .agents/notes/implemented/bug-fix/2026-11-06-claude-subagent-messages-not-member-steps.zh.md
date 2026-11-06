# Agent Note：Claude Code 子智能体的消息不是成员的步

Status: implemented

## 问题

Claude Code 成员调用自己的 `Agent`（旧名 `Task`）工具时，stream-json 输出里也带着子智能体的对话：`assistant`、`user`，以及（开了 `--include-partial-messages` 时）`stream_event` 事件，它们的 `parent_tool_use_id` 指向成员的那次 `Agent` 调用。成员的折叠（`packages/local-agent-claude-code/src/claude-cli-provider.ts` 的 `foldClaudeStreamLine`，exec 收尾解析与增量 `ClaudeStreamParser` 共用）和 live 驱动的事件入口（`packages/local-agent-claude-code/src/live-driver.ts`）都不看这个字段。子智能体的思考、工具调用、文字被镜像成成员自己的步；它每次请求的 usage 记到成员的行上；它的工具调用计入成员的工具统计；每条子智能体文字都覆盖折叠的最终回答，于是子智能体的话可能短暂地——如果它最后到达，则最终地——成为成员的回答。live 驱动里，子智能体的 `stream_event` 增量还会重置成员当前请求的键、流进成员的实时预览。只有上下文读数（`context-reading.ts`）原本就跳过这些事件。

这是成员 CLI 子智能体设计（`proposals/active/2026-11-06-member-cli-subagents.md`，gitignored）的 M1 步。

## 决定

`claudeSubagentParentId(event)`：`assistant`/`user`/`stream_event` 事件的 `parent_tool_use_id` 是非空字符串时，返回它所属的成员工具调用（成员自己的事件那里是 `null` 或没有）。折叠最先检查它，在计时边界之前：子智能体事件只让 `subagentEvents`（成员 tool_use id → 事件计数）加一然后返回。别的一概不留：不产生行、不改最终回答、不记 usage、不计工具、不移动 `lastEventAt`（成员自己的生成区间不被另一段对话切开）。

live 驱动的 `onEvent` 在「轮已结束」守卫之后、处理任何 `stream_event` 之前检查同一个函数：把事件交给本轮的 parser（活性计数只存在一处）然后返回，成员的请求键、请求 usage、实时流、运行进度增量和镜像游标都不受影响。

`subagentEvents` 就是设计里说的「这个调用的子智能体还活着」信号；目前还没有消费方。镜像子智能体的对话是后面的步骤（M4，读 CLI 的 `subagents/agent-*.jsonl` 转录，不从流里取）。

## 考虑过的方案

**只在最终回答赋值处过滤 `assistant` 文字。** 放弃：子智能体的思考、工具卡和 usage 仍会落进成员的步；设计明确这些都不属于成员。

**live 驱动直接丢弃子智能体事件、不交给 parser。** 放弃：那样活性计数只存在于 exec 路径；两条路径都走同一个折叠，才不会分叉，这正是折叠自身注释的要求。

**现在就从流里镜像子智能体。** 放弃：不传 `--forward-subagent-text` 时流里只有子智能体对话的一部分，完整镜像设计为读转录文件（M4）。

## 影响

用了 `Agent` 的成员轮只显示成员自己的步：`Agent` 工具卡及其结果，然后是成员的后续；最终回答总是成员自己的最后一段文字。不含子智能体事件的流折叠结果与以前完全相同。测试：`tests/claude-cli-provider.spec.ts`（穿插子智能体事件的流与只有成员事件的流解析结果相同；增量 parser 的活性计数与显式 `null` 父 id），`tests/live-driver.spec.ts`（live 轮里有子智能体增量、消息、工具结果，以及成员回答之后迟到的一段文字），以及 exec 与 live 的镜像快照夹具，它们现在穿插了子智能体事件（差异见快照那次提交）。
