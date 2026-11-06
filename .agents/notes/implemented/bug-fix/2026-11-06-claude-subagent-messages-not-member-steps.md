# Agent Note: A Claude Code subagent's messages are not the member's steps

Status: implemented

## Problem

When a Claude Code member calls its own `Agent` (formerly `Task`) tool, the stream-json output also carries the subagent's conversation: `assistant`, `user`, and (with `--include-partial-messages`) `stream_event` events whose `parent_tool_use_id` names the member's `Agent` call. The member fold (`foldClaudeStreamLine` in `packages/local-agent-claude-code/src/claude-cli-provider.ts`, shared by the exec settle parse and the incremental `ClaudeStreamParser`) and the live driver's event sink (`packages/local-agent-claude-code/src/live-driver.ts`) did not look at that field. The subagent's thinking, tool calls, and text were mirrored as the member's own steps; its per-call usage was stamped on member lines; its tool calls were counted in the member's tool accounting; and every subagent text block overwrote the fold's final answer, so a subagent's text could briefly — or, if it arrived last, finally — be the member's answer. In the live driver, a subagent's `stream_event` partials also reset the member's open call key and streamed into the member's live preview. Only the context reading (`context-reading.ts`) already skipped these events.

This is step M1 of the member-CLI-subagents design (`proposals/active/2026-11-06-member-cli-subagents.md`, gitignored).

## Decision

`claudeSubagentParentId(event)` returns the member tool call an `assistant`/`user`/`stream_event` event belongs to when `parent_tool_use_id` is a non-empty string (the member's own events carry `null` or nothing). The fold checks it first, before the timing boundary: a subagent event only increments `subagentEvents` (member tool_use id → event count) and returns. Nothing else of it is kept: no lines, no final answer, no usage, no tool accounting, no `lastEventAt` move (so the member's own generation windows are not cut by another conversation).

The live driver's `onEvent` checks the same helper right after the settled-round guard and before any `stream_event` handling: it hands the event to the turn's parser (so the liveness count lives in one place) and returns, so the member's call key, call usage, live streams, run-progress deltas, and mirror cursor are untouched.

`subagentEvents` is the "this call's subagent is alive" signal the design asks for; nothing consumes it yet. Mirroring the subagent's conversation is a later step (M4, from the CLI's `subagents/agent-*.jsonl` transcript, not from the stream).

## Alternatives considered

**Filter only `assistant` text in the final-answer assignment.** Lost: the subagent's thinking, tool cards, and usage would still land in the member's steps; the design is explicit that none of it belongs there.

**Drop subagent events in the live driver without passing them to the parser.** Lost: the liveness count would then exist only on the exec path; routing both paths through the one fold keeps them from drifting, as the fold's own comment requires.

**Mirror the subagent from the stream now.** Lost: without `--forward-subagent-text` the stream carries only part of the subagent's conversation, and full mirroring is designed to read the transcript file (M4).

## Consequences

A member round that uses `Agent` shows only the member's own steps: the `Agent` tool card and its result, then the member's continuation; the final answer is always the member's own last text. Streams without subagent events fold exactly as before. Tests: `tests/claude-cli-provider.spec.ts` (an interleaved stream parses identically to the member-only stream; the incremental parser's liveness count and an explicit `null` parent), `tests/live-driver.spec.ts` (a live round with subagent partials, messages, tool results, and a late text after the member's answer), and the exec and live mirror snapshot fixtures, which now interleave subagent events (see the snapshot commit for the diff).
