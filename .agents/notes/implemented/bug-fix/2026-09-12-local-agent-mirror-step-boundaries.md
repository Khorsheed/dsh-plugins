# Agent Note: Local-agent child-session mirrors emit step boundaries

Status: implemented

## Problem

A delegated CLI round (Codex observed, but the whole family shared the defect) produced its full result — the parent session received the complete answer and the child session log held every mirrored event — yet the subsession's real-time web view showed only the user prompt and the tool cards. The final assistant text (and every interim think/text line) was invisible until a full page reload.

The root cause sits in the host's live conversation pipeline, not in the data. `ui-chat`'s assistant definition only materializes an `assistant/message` whose location resolves to a **step**, and the location index learns steps exclusively from `step/start`/`step/end` boundary events on the incremental append path (`ui-conversation`'s `location-index.ts`; a full `rebuild()` additionally mints step drafts from explicit `(turn, step)` coordinates, which is why a reload recovered the content). The local-agent mirrors never appended step boundaries: every synthesized `assistant/message` resolved to a turn-level location and was silently dropped live, while `user/message` and `tool/call`/`tool/result` rendered because their definitions never consult the step location. The live drivers' token-granularity mode had a second gap on top: its one combined final message was appended *after* `turn/end`, outside the turn window.

## Decision

Every mirrored step is wrapped in the `step/start`–`step/end` pair at its own `(turn, step)`:

- **codex / claude-code** — `appendCodexTranscriptLine` / `appendClaudeTranscriptLine` emit the boundary pair around each folded transcript line; a line the options skip writes no boundary.
- **kimi** — `mirrorKimiSessionDelta` wraps each folded line the same way. The late-result backfill (a `tool/result` arriving passes after its call folded) reuses the call's coordinates **bare** — no second boundary pair, because the live assembler throws on a duplicate start match for the same context. The step stays registered, so the bare result still resolves to the step location.
- **dsh** — the mirror copies the sub-dsh session's real `step/start`/`step/end` events verbatim instead of filtering them out as scaffolding (the sub-session's turn numbering matches the parent's by design). The skip-prefix alignment counts boundaries on both sides, so repeated polls never re-copy a pair. An interrupted step without its end crosses open; no boundary is ever synthesized.
- **token-granularity combined final message** (codex / kimi / claude live drivers) — moved from the detached post-settle chain (after `turn/end`) into the settle chain *before* `turn/end`, wrapped in the boundary pair, so it renders inside the turn window above the footer. kimi's in-window write first runs the bounded settle-quiesce mirror (3 stable reads × 300 ms, 3 s deadline) so the message still carries the round's usage.

## Alternatives considered

- **Upstream fix in ui-chat** — let the assistant definition fall back to turn-level locations when no step boundary exists. That is a host change and must go through the upstream-change pipeline; it also papers over the contract rather than meeting it, and leaves the host's `TokenMeter.measure()` fold (which *throws* on step-less assistant messages) one caller away from breaking on a mirrored session. The plugin-side boundary pair meets the host contract on every host line, today.
- **A second boundary pair for the kimi backfill** — keeping every content event inside *some* pair looked tidier, but the assembler's one-start-per-context rule makes a duplicate `step/start` a thrown error in the live view, strictly worse than a bare result that renders anyway.
- **kimi token settle without the quiesce wait** — writing the combined message immediately keeps the result latency unchanged, but the usage record that flushes after the prompt response then has no carrier (the host has no usage-backfill event) and the round's accounting is silently dropped. The bounded wait preserves exactly-once accounting.

## Consequences

- The live subsession view now renders assistant text, thinking, and the turn footer (duration + usage) as the round unfolds, on both exec and live drives, for all four providers.
- Mirrored sessions carry roughly two extra events per step. Event volume was already small; persistence batches are unchanged.
- kimi token-granularity rounds settle up to ~0.9–3 s later (the in-window quiesce), including on the cancel path — the price of keeping the usage carrier; event-granularity rounds are unaffected.
- Token statistics were never at risk: the host's `tokenUsage` projection is purely event-driven (no step dependency), and the member dock's numbers counted these rounds all along. Per-message timing pills (llmMs / TTFT / decode speed) remain absent for mirrored sessions — they need `step/start` timestamps plus per-chunk events, and exec-path mirroring stamps events at mirror time.
- True per-token streaming into a mirrored child session is **not** achievable from a plugin today: durable `assistant/live-chunk` is not in the appendable `SessionEventMap`, and the transient `agent/assistant-stream` bus is scoped to whoever holds the session's Agent handle — a mirror session has none. Event-granularity mirroring (per completed item) is the ceiling. Separately, the `localAgent/run-progress` delta channel still has no UI consumer (the member dock lists run progress as "later"), so 逐字流式's live deltas remain invisible by design until that lands.

## Testing

Each provider's specs carry an `expectStepBoundaries` helper asserting every mirrored `assistant/message`, `tool/call`, and `tool/result` sits inside a same-coordinate boundary pair (kimi's helper exempts the sanctioned bare backfill); the token-granularity suites additionally assert the combined final message precedes `turn/end` and its coordinate's event order is exactly `step/start → assistant/message → step/end`; the dsh suites assert poll → settle never re-copies a pair.
