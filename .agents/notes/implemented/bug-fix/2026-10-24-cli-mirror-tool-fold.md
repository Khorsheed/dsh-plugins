# Agent Note: codex/claude child mirrors fold the deferred-tool loop faithfully

Status: implemented

## Problem

A room member round that ran a tool loop showed up in Context Lens as two bare adjacent 助手回复 records (codex), or a tool step marked 工具失败/被中断 followed by the reply (claude) — looking exactly like kimi's old "one round split into phantom messages" bug. Ground truth from the CLIs' own transcripts says the split itself is CORRECT (two real API calls with a tool call between, the same shape a dsh main-session tool loop has); what was broken is the mirror dropping the tool in between:

- **codex**: the member used codex's deferred discovery tool, which the rollout records as `custom_tool_call` / `custom_tool_call_output` items. The shared fold (`foldCodexStreamLine`) had branches for `command_execution` / `web_search_call` / `function_call` / `file_change` but none for custom tools, so the call and its result vanished — leaving two replies with nothing between them. (The live driver's `dynamicToolCall` case existed but dropped the result, which the app-server carries INLINE as `contentItems`.)
- **claude**: `ToolSearch` answers with `tool_result` content made of `tool_reference` blocks (one per discovered tool), and `toolResultText` kept only `text` blocks. The empty extraction skipped the attach, the call stayed resultless, and the settle closed the step with the interrupted placeholder (`（工具调用被中断，未能记录返回结果）`, `isError`) — a phantom failure for a call that had actually succeeded (the reply used the discovered tools). The held-back fold also bunched the whole round's mirror writes into one end-of-turn burst, which is why both lens records read 0.0s.

## Decision

Fix the two folds, leave the split semantics alone:

- codex exec/stream fold: `custom_tool_call` folds a tool line (`name` + `input` as the args); `custom_tool_call_output` flattens its string-or-block-array output and merges into the pending tool line by recency, the same idiom `function_call_output` uses. Counted as `custom_tool_call` in the tool accounting (the fold counts the CLI's own item types).
- codex live mapper: `dynamicToolCall` reads its inline `contentItems` text blocks as the result.
- claude fold: `toolResultText` also renders `tool_reference` blocks as the found tool names, one per line — the references ARE the result.

One API call = one lens record stays the rule; each mirrored step keeps its own step/start–step/end pair. No change to step grouping: codex's idiom already gives every tool line its own step, claude folds call+result into one step.

## Alternatives considered

- **Folding the whole member turn into one record**: rejected — it would break the one-request-one-record contract the lens is built on (and the kimi fold's rule), and hide real tool loops the main session shows fine.
- **Pairing custom_tool_call_output by `call_id`**: the stream orders a result right behind its call, and the fold's existing idiom (function_call_output) pairs by recency; a second map buys nothing until a stream interleaves two open custom calls, which codex does not emit.

## Consequences

- New codex member rounds show the deferred-tool call (`exec` etc.) as its own step between the two replies, with its real output; new claude member rounds show ToolSearch succeeding with the discovered tool list as its result.
- Old child logs are unchanged — a historical round keeps its phantom-interrupted look (the placeholder is what the log carries; re-mirroring old transcripts is a separate tooling question).
- Context Lens needs no change: the events are the standard tool/call + tool/result it already renders.

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-codex test` (251: exec fold spec gains a custom_tool_call round-trip with block-array output; live mapper spec gains the inline `contentItems` result) and `pnpm --filter @khorsheed/dsh-local-agent-claude-code test` (264: a ToolSearch tool_reference result folds to the found tool names and counts the call). Both fixtures mirror the observed rollouts/transcripts verbatim (member 剪刀手二号 / 剪刀手四号, 2026-10-23/24).
