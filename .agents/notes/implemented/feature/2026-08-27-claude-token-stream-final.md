# Agent Note: claude-code live token-granularity stream completion

Status: implemented

English | [中文](2026-08-27-claude-token-stream-final.zh.md)

## Problem

Under token granularity the claude-code live driver streamed `--include-partial-messages` deltas as `assistant/chunk` but still folded the same think/text lines into separate `assistant/message` events at settle — the official projection then rendered the content twice (stream + fold), and a stream whose chunks never completed carried a dangling 已停止 (interrupted) badge even for clean rounds. The kimi live driver had already solved the identical pair of defects (see the cross-referenced note); claude-code needed the isomorphic fix on its own fold (the shared `ClaudeStreamParser` path inside the live driver).

## Decision

The claude-code live driver's token granularity now mirrors the kimi sample (commit 13f0c62), adapted to the claude fold's shape:

- **Fold-layer skip, same contract as kimi's `skipAssistantContent`.** `mirrorUpTo` (the live fold loop) gains the token-mode skip: think/text lines are not folded into `assistant/message` events (tool lines still fold, as native `tool/call`/`tool/result` pairs), and the round's usage is redirected to the driver's `settleUsage` instead of being attached to a folded carrier line — including the carrier-mirrored-early case, which books `settleUsage` instead of an `assistant/chunk` usage event.
- **Usage source: the result event, through the fold's own computation.** The live driver intercepts `result` events and never fed them to the parser, so `parser.usage` was always undefined on this path. In token granularity the result event itself is now pushed through the fold (`usageFromClaude`, the existing computation); event granularity keeps the historical flush verbatim (its behavior is byte-for-byte unchanged).
- **Stream block layout matches the final message.** Chunks stream at the reserved `(turn, step)` with `reasoning-delta` at block index 0 and `text-delta` at index 1 (the claude stream's `thinking_delta`/`text_delta` vocabulary), accumulating `roundThink`/`roundText` and the chunk seqs. Folded tool lines at or past the reserved step shift to `index + 2` in token mode so the projection's `(turn, step)` merge key never collides with the stream. **Amended 2026-08-30:** the stream step is reserved lazily at the first delta (past every completed line) instead of pinned to 1 — step 1 hoisted the answer above a tool-first round's tool cards. See [the lazy-stream-step note](../bug-fix/2026-08-30-live-token-lazy-stream-step.md).
- **Settle completes the stream with ONE combined final message.** After the result-event flush, the settle chain appends a single synthetic `assistant/message` at the stream's same reserved `(turn, step)` — content `[reasoning, text]`, the fold's usage, `{ surfaceOp: 'append', sourceEventSeqs: chunkSeqs }`, and `interrupted: true` for any non-completed round. The official projection replaces the stream with it: no duplicated content, no dangling 已停止 badge, and a cancelled turn reads 已停止 legitimately.
- **Attribution helper.** `assistantEvent(blocks)` (exported from `claude-cli-provider.ts`, the kimi helper's namesake) is the single source of the `claude-local` message attribution, shared by the line fold and the synthetic final.

## Alternatives considered

- **Folding the result event unconditionally (event granularity too)** — rejected: it would also fix the event mode's silent usage gap, but the mandate here is token-granularity completion with event granularity byte-for-byte unchanged; the event-mode usage question is a separate decision.
- **Exporting `usageFromClaude` and computing usage in the driver** — rejected: pushing the result event through the fold reuses the existing computation verbatim and cannot drift from the exec path.
- **Computing folded steps from child-session events (kimi's fold style)** — rejected: claude's fold assigns steps positionally (`index + 1`); the `+1` offset in token mode reserves step 1 for the stream with a one-word change and stays stable per transcript line across flushes.

## Consequences

- Token granularity no longer double-renders: the fold skips think/text, the stream chunks carry the live view, and exactly one final `assistant/message` replaces the stream at settle with the round's usage attached.
- A clean round's stream loses the spurious 已停止 badge; an aborted round's final carries `interrupted: true`, so the badge is truthful.
- Event (default) granularity is untouched: no chunk events, the same fold, the same (usage-less) settle flush.
- The pre-existing event-mode usage gap (the live path never folded `result`, so no usage attached) is now documented; token mode does not share it.

## Testing

- `tests/live-driver.spec.ts` +2, mirroring the kimi pair over the extended `FakeClaude` fixture (thinking deltas): the settle completes the stream with ONE combined final message (content `[reasoning, text]`, usage, no `interrupted`, `sourceEventSeqs` non-empty, tool activity still folded); a cancelled round completes the stream as `interrupted: true`. Suite: claude-code 86/86; build, `check:plugins`, `check:hygiene` all green.

## Cross-references

- [kimi live mirror fold fixes](2026-08-27-kimi-live-mirror-fold-fixes.md) — the landed sample this mirrors, including the official projection semantics (merge key `(turn, step)`; the append-surface final replaces the stream).
