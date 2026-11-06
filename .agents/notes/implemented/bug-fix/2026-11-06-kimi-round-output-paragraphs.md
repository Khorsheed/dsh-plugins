# Agent Note: A Kimi round's reply keeps its segments as paragraphs

Status: implemented

## Problem

A Kimi member that speaks several times in one round — a sentence, a tool call, another sentence, a thought, a conclusion — reached the room as one unbroken paragraph. The Kimi live driver (`packages/local-agent-kimi/src/live-driver.ts`) builds the round output from every `agent_message_chunk` of the round, and kimi's segments carry no trailing newline, so the room's `room/speech` read "我先看一下目录。找到了三个文件。结论：…".

## Decision

The Kimi live driver marks the current text segment ended when the ACP update stream shows something that is not text: an `agent_thought_chunk`, a `tool_call`, or a `tool_call_update`. The next text chunk after that is prefixed by `textSegmentSeparator(roundText, chunk)`, which makes exactly one blank line (`\n\n`), counting the newlines the previous text already ends with and the chunk already starts with; nothing is added at the start of the round. Chunks of one streamed segment are never split. The same text goes to the run's progress delta.

The room's `roundTextSoFar` (the text a question records as its `before` tail) joins the round's `assistant/message` segments with the same rule, so `askOffsets` still finds a tail that spans two segments in the paragraphed reply. Within one message, text blocks are concatenated as before.

Provider audit:

- **Claude Code** (live driver and `claude -p` provider): the output is the last assistant text block (`ClaudeStreamParser.text` / `parseClaudeStreamJson`), never a concatenation. Unchanged.
- **Codex** (live driver and `codex exec` provider): the output is the final-answer / last `agentMessage` item. Unchanged.
- **Kimi exec** (`kimi -p`): the output is the CLI's own printed stdout. Unchanged.

Stored replies are not rewritten.

## Alternatives considered

**Separate only when the previous text has no trailing newline at all (a single `\n` counts as separated).** Lost: a single newline after a list item or a line is not a paragraph break in markdown, so the next segment would still render glued (a lazy continuation of the list item). Topping up to one blank line costs nothing when the text already has one.

**Use the wire's step boundaries instead of the ACP stream.** Lost: the round output is built from the live chunks (the wire flushes late and is not the output source); the ACP stream's thought and tool updates are the boundaries the driver actually sees in order.

**Separate in the room when storing `room/speech`.** Lost: the room only sees the joined string; the boundaries exist only in the provider.

## Consequences

Kimi replies read as paragraphs in the room and anywhere else the run output is shown. A model call with no thought and no tool call between two text segments (no ACP boundary) still joins without a break in the output, while `roundTextSoFar` separates the two messages; a question whose tail spans exactly that join falls back to "asked mid-round" (-1), as every unmatched tail already did. Tests: `packages/local-agent-kimi/tests/live-driver.spec.ts` (multi-segment round, separator rule; the existing single-segment case stays `第一条回复`), `packages/room/tests/inline-questions.host.spec.ts` (segment join, tail spanning segments).
