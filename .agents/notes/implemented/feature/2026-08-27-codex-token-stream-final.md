# Agent Note: codex live token-granularity stream completion (one combined final message)

Status: implemented

English | [中文](2026-08-27-codex-token-stream-final.zh.md)

## Problem

Under the token mirror granularity the codex live driver streamed `item/agentMessage/delta` / `item/reasoning/textDelta` as `assistant/chunk` events AND still folded the completed `agentMessage`/`reasoning` items into `assistant/message` events at settle, so the child session rendered the answer twice (stream plus fold). Worse, a round whose stream never got a final message kept the dangling **已停止** badge on a completed turn — the official projection merges by `(turn, step)`, and only an append-surface `assistant/message` at the stream's own `(turn, step)` replaces the stream; chunks without a final read as stopped. The kimi live driver fixed the same pair of symptoms first (see Cross-references); codex needed the isomorphic change on its own fold.

## Decision

The codex fold gains the same skip switch kimi's mirror owns, named per the package's conventions: `CodexMirrorOptions.skipAssistantContent` (`codex-cli-provider.ts`). With it, `appendCodexTranscriptLine` leaves think/text lines out (tool lines still fold) and reports whether it folded, so the live driver's `mirrorUpTo` neither attaches the round's usage to a folded line nor books the after-the-fact usage chunk — the usage rides the combined final message instead. Unlike kimi (where the file fold computes the window's usage and returns it on the delta), codex's usage source is the driver's own `thread/tokenUsage/updated` variable, so nothing needs returning: the skip simply leaves the variable unattached until settle.

The driver (`live-driver.ts`) mirrors kimi's token-mode mechanics:

- Deltas accumulate into `roundThink` / `roundText`, and every streamed chunk's seq lands in `chunkSeqs`. The chunk block layout is FIXED — `reasoning-delta` at index 0, `text-delta` at index 1 — matching the final message's content order (replacing the earlier per-item-id index map), and chunks pin to `(turn, step: 1)` instead of `mirrored + 1`, so a mid-stream tool fold cannot move the stream's merge key.
- Folded tool lines continue AFTER the stream's step 1 (`index + 2` in token mode), so a tool-first round's tool card never collides with the final message's `(turn, step 1)` merge key.
- The settle chain appends ONE combined `assistant/message` at the SAME `(turn, step: 1)`: content `[reasoning, text]` via the new `codexAssistantEvent` helper (the fold's inline `createAssistantMessage` call, exported and shared), the observed `thread/tokenUsage/updated` usage, `{ surfaceOp: 'append', sourceEventSeqs: chunkSeqs }`, and `interrupted: true` on any non-completed round so a cancelled turn reads 已停止 legitimately.
- Content fallback: deltas are the stream's content, but a server that completes items without streaming any delta would otherwise lose the answer to the skip — the final message then derives its blocks from the folded lines (think lines joined as reasoning, text lines as text).

Event granularity (the default) is byte-for-byte unchanged: no skip, the usage still attaches to the last folded non-tool line, and no combined final is appended.

## Alternatives considered

- **Folding the completed items alongside the stream and letting the UI dedupe** — rejected: the projection has no cross-event dedupe; duplication is exactly the bug.
- **Suppressing the fold only at turn/completed** — rejected: mid-turn folds (`mirrorUpTo(lines.length - 1)` per item) would still duplicate earlier think lines; the skip must ride every mirror pass, like kimi's.
- **Keeping the per-item-id block index map** — rejected: the final message combines all reasoning into block 0 and all text into block 1, so a stream indexed by item id cannot match the final's content order; the fixed layout is what makes the projection's whole-block replacement exact.
- **Returning the usage on a fold delta like kimi's `KimiMirrorDelta.usage`** — rejected: codex's fold never computes usage (it arrives as a notification the driver already owns), so there is no window value to return; attaching it to the final message at settle is the same exactly-once contract.

## Consequences

- Token-granularity live rounds render the answer exactly once: the stream lives at `(turn, step 1)` and the settle's single combined final replaces it in place, carrying the round's usage; a cancelled round's final carries `interrupted: true` and keeps the legitimate 已停止 reading.
- The exec path and the event granularity keep the previous fold untouched (the options parameter defaults off; `appendCodexTranscriptLine` only gained a return value callers may ignore).
- The kimi note's M2 follow-up ("re-check codex/claude-code settle mirrors") is now answered for codex's stream completion; codex's file-fold concerns do not apply (its fold is notification-sourced, not file-sourced).

## Testing

- `live-driver.spec.ts` +2, mirroring the kimi pair: the settle completes the stream with ONE combined final message (exactly one `assistant/message`, `(turn, step 1)`, content `[reasoning, text]`, usage from `thread/tokenUsage/updated`, non-empty `sourceEventSeqs`), and a cancelled round completes the stream as interrupted. The FakeAppServer fixture gains scripted `reasoningDeltas`. Suite: codex 93/93; `pnpm check:plugins` and `pnpm check:hygiene` clean.

## Cross-references

- [kimi live mirror fold fixes](2026-08-27-kimi-live-mirror-fold-fixes.md) — the landed template this change follows (its Consequences own the token-granularity stream-completion semantics).
