# Agent Note: Token-granularity live stream reserves its merge step lazily — tool-first rounds render chronologically

Status: implemented

English | [中文](2026-08-30-live-token-lazy-stream-step.zh.md)

## Problem

Live bug (codex member session, prod 3080 with `live: true` + `liveMirrorGranularity: token`): in a tool-first round the whole answer rendered **above** every tool card, and streamed text kept refreshing above the pinned tool rows ("tool-call 固定在下方，会话消息在 tool-call 上面刷新"). Root cause: the token-granularity design pinned the assistant chunk stream AND the settle's combined final message at `(turn, step 1)` and offset folded tool lines to `index + 2` so the merge key could never collide with a tool card (2026-08-27 codex/claude token-stream-final notes; kimi independently pinned step 1 too). The projection orders by `(turn, step)`, so the answer — generated after the tools — was hoisted above all of them. Kimi had the sharper version of the same bug: its fold numbers steps from the session event ledger, so a tool folded first took step 1 and the step-1 chunk stream **collided** with the tool card's merge key.

## Decision

- **The stream step is reserved lazily at the first think/text delta, not pinned to 1.** The reserved value is past everything already completed: `lines.length + 1` (codex, claude — covers the held-back carrier line) or the session step ledger's next step (kimi — `nextKimiSessionStep`, exported from `session-mirror.ts`, the same ledger the fold uses). Chunks and the settle's combined final message share this key, so the projection still replaces the stream in place.
- **codex/claude folds shift, not blanket-offset.** A folded line at or past the reserved stream step moves one slot up (`index + 2`); lines before it keep their positional step (`index + 1`). Kimi needs no offset at all: its fold numbers from the event ledger, so once the chunks occupy the reserved step, later folds naturally continue after it.
- **The stream-less fallback moves off step 1 too.** A token round with no deltas (codex) puts its fallback final message at `lines.length + 1`, never above the folded tools.

## Verification

Each provider's live-driver spec gains a tool-first token-mode test (two tools fold first, text streams, one more tool completes): tool steps `[1, 2, 4]`, chunks and the combined final at step 3 — exact chronology. codex also pins the stream-less fallback (tool at step 2, final at step 4). Existing step-1 assertions (delta-first rounds) are unchanged: with no completed items at first delta, the reservation still lands on step 1. Suites: codex 95, claude-code 89, kimi 122 — all green; builds green.

## Alternatives considered

**Per-item stream segmentation** (a new stream step whenever a new agentMessage item starts, so text → tools → more-text interleaves perfectly) — rejected as over-engineering: the dominant rounds are answer-only, tools-then-answer, and answer-then-tools, all exact under the single lazy reservation. The residual mis-order (a second text segment merges above an intervening tool) is documented here; the wire carries item ids, so segmentation can be added later without changing the fold contract.

**Keep step 1 and reorder only at settle** — rejected: the user-visible defect is during streaming (text refreshing above the pinned tool rows), which only the live reservation fixes.

## Consequences

Token-granularity live rounds now render in chronological order for the three CLI providers; event granularity is untouched. The three 2026-08-27 token-stream-final notes are updated in facts (the "stream owns step 1" lines now point here). One known residual: text segments separated by tool activity merge into the first segment's step (see Alternatives).
