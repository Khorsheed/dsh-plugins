# Agent Note: Kimi 一轮的回复保留分段

Status: implemented

## Problem

Kimi 成员在一轮里会说好几段：一句话，一次工具调用，再一句，一段思考，最后结论。到了房间里却是一整段没有分隔的文字。Kimi live 驱动（`packages/local-agent-kimi/src/live-driver.ts`）把这一轮所有 `agent_message_chunk` 拼成输出，而 kimi 的各段末尾不带换行，于是房间的 `room/speech` 读成「我先看一下目录。找到了三个文件。结论：……」。

## Decision

Kimi live 驱动在 ACP 更新流出现非文本内容时，把当前文本段记为结束：`agent_thought_chunk`、`tool_call`、`tool_call_update`。此后的第一块文本前面加上 `textSegmentSeparator(roundText, chunk)`，补成恰好一个空行（`\n\n`），会算上前文已有的结尾换行和这块文本开头的换行；一轮开头不加。同一段流式文本内部从不断开。运行进度的 delta 用的是同一份文本。

房间的 `roundTextSoFar`（提问时记下的 `before` 尾巴）按同一规则拼接这一轮的各条 `assistant/message`，所以尾巴跨两段时，`askOffsets` 仍能在分段后的回复里找到它。同一条消息里的多个文本块照旧直接拼接。

各提供方核查：

- **Claude Code**（live 驱动和 `claude -p`）：输出是最后一个 assistant 文本块（`ClaudeStreamParser.text` / `parseClaudeStreamJson`），不是拼接。不改。
- **Codex**（live 驱动和 `codex exec`）：输出是 final answer 或最后一个 `agentMessage`。不改。
- **Kimi exec**（`kimi -p`）：输出是 CLI 自己打印的 stdout。不改。

已存的回复不改写。

## Alternatives considered

**前文只要以换行结尾就不再分隔（一个 `\n` 也算）。** 没选：在 markdown 里，列表项或一行后面只跟一个换行不算分段，下一段仍会粘上去（成为列表项的延续）。补到一个空行，在已有空行时什么都不加。

**用 wire 的步边界代替 ACP 流。** 没选：输出来自实时 chunk（wire 落盘晚，也不是输出来源）；驱动按顺序实际看到的边界就是 ACP 流里的思考和工具更新。

**在房间存 `room/speech` 时分段。** 没选：房间只拿到拼好的字符串，边界只在提供方那里存在。

## Consequences

Kimi 的回复在房间和其他展示运行输出的地方都按段落显示。两段文本之间如果既没有思考也没有工具调用（ACP 没有边界），输出里仍然连在一起，而 `roundTextSoFar` 会把两条消息分开；尾巴恰好跨这个接缝的提问会退回「轮中提问」（-1），和其他找不到尾巴的情况一样。测试：`packages/local-agent-kimi/tests/live-driver.spec.ts`（多段一轮、分隔规则；原有的单段用例仍是 `第一条回复`），`packages/room/tests/inline-questions.host.spec.ts`（分段拼接、尾巴跨段）。
