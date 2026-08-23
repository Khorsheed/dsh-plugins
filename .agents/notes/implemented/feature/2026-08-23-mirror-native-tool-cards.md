# Agent Note: mirrored tool activity renders as native tool cards

Status: implemented

English | [中文](2026-08-23-mirror-native-tool-cards.zh.md)

## Problem

Mirrored subagent sessions folded tool activity into `[工具 X] args → result` TEXT inside assistant messages, while thinking already mapped to the native `reasoning` block. The standard conversation renders text verbatim, so tool calls were hard to read — no card, no pairing, no collapse — even though the official UI has a native tool surface driven by `tool/call` + `tool/result` session events (agent-loop's own writes; rendered by ui-conversation's tool node).

## Decision

Every provider's mirror now emits the official event pair instead of text:

- `tool/call` with `{ turn, step, callId, name, arguments }`, then `tool/result` with `createToolResultMessage(...)` and `sourceEventSeqs` pointing at the CHILD's call event (never the source log's seq numbering). Render intent stays null, so cards use the documented generic JSON card.
- kimi (`session-mirror.ts`): the wire fold's tool line gains a stable `id` (wire `toolCallId`/`uuid`, else position-based). A result that merges into an ALREADY-mirrored line (parallel calls settle out of order) is backfilled from the child session's own event ledger — the empty-delta early return moved behind the backfill because a result merge does not change the line count.
- codex: `CodexTranscriptLine` splits `detail` into `args`/`result` and carries the stream item id; exec NDJSON fold and app-server item fold (`codexAppServerItemToLine`) both produce it.
- claude: tool lines carry the `tool_use` id and pair results by `tool_use_id` (last-tool-line fallback kept for id-less streams); exec and live share `ClaudeStreamParser`.
- dsh: the mirror's span filter lets the sub-dsh's own `tool/call`/`tool/result` events cross (they are already official format — verbatim except the remapped `sourceEventSeqs`); the live event path crosses them too.
- Run-progress delta texts keep the `[工具 X]` string form — that surface is plain text by design.

## Usage carriers (the subtle part)

`tool/call`/`tool/result` events have no usage slot, and the tokenUsage projection folds usage only from `assistant/message.data.usage` or an `assistant/chunk` usage chunk — at append time. A killed run's usage is only knowable at settle (codex recovers it from the rollout file), and by then the carrier line may already be mirrored. So: usage rides the last NON-tool transcript line (a kill mid-command ends the transcript with a tool line — exactly the case rollout recovery exists for), and when that carrier went out through the live mirror before the usage was knowable, the mirror books it as an `assistant/chunk` usage chunk pinned to the carrier's step (the projection replaces a repeated step sample, never double-counts).

## Alternatives considered

- **Keep text lines** — zero work, but the comparison/审查 use case needs readable tool activity; the native surface exists precisely for this.
- **Mutating the already-mirrored event's `data.usage`** — the token projection folds at append time, so a post-hoc mutation never reaches the UI totals; the usage chunk is the foldable channel.

## Consequences

- Mirrored cards are the generic JSON card (name + args + result, collapsible); per-tool render intents (`diff`, `terminal`) stay unavailable because the child session has no tool registry entries for the mirrored calls.
- Existing sessions mirrored before this change keep their text lines (the log is append-only; no migration).
- The kimi mirror's empty-delta pass now persists only when a backfill produced events.
