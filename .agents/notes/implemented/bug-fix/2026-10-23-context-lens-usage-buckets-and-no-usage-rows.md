# Agent Note: Context Lens counts cache-write input and never labels a usage-less row "failed"

Status: implemented

## Problem

Two user-visible falsehoods in the Context Lens request list, both surfaced through local-agent child sessions:

1. **A Claude Code first turn showed an input of 2 tok for a 559-character prompt.** The providers emit the host's disjoint usage buckets faithfully (`claude-cli-provider.ts` maps `cache_creation_input_tokens` to `cacheWriteTokens`), but the panel's `RequestUsage` had no `cacheWriteTokens` field, the log lane's `readUsage` stripped the bucket at the boundary, and `inputTotal` summed only uncached + cache-read. Anthropic's `input_tokens` excludes both cache directions, so a cache-writing (first) request — whole prompt in cache creation — displayed as nearly input-free with a 0.0% hit rate.
2. **A kimi delegation always opened with a `#1 · —` row reading 请求失败 that had never failed.** The kimi mirror folds each wire content line into its own step, so a round of an `always_thinking` model becomes a pure-thinking fold plus a text fold; usage attaches to the window's last fold only. TokenView rendered ANY settled row without usage as `req.failed` regardless of its actual `ok` status, and every summarizer collapsed a reasoning-only response into `kind: 'none'` (`—`), so the row carried no explanation of what it was.

## Decision

- **Count all three disjoint input buckets everywhere.** `RequestUsage` gains `cacheWriteTokens` (types.ts); the log lane's `readUsage` passes it through; `inputTotal` (client aggregate) and the turn list's `totalInputTokens` (store) sum uncached + cache-read + cache-write; the 未命中/miss figure becomes `inputMiss` = uncached + cache-write (a cache write was processed in full). `cachePct`'s denominator is the three-bucket total.
- **A reasoning-only response gets its own summary kind.** `ResponseSummary` gains `{ kind: 'reasoning' }`, assigned identically by all three summarizers (store live lane, log-lane committed message, log-lane stream-span attempt); the panel localizes it (思考 / Thinking), so a thinking fold reads `#1 · 思考` instead of `#1 · —`.
- **"No usage" is a statement about the record, never about the outcome.** TokenView's no-usage fallback reads the row's status: streaming → 流式中, failed → 请求失败, anything else → `—`.

## Alternatives considered

- **Fix the providers or merge the kimi think/text folds into one record.** The providers were never wrong — the loss happened at the panel's read and aggregate layers. Merging folds would break the mirror's one-wire-line → one-step contract (see [the kimi mirror log-validity note](2026-10-22-kimi-mirror-released-log-validity.md)) for a purely cosmetic gain.
- **Give cache-write its own metric cell.** The facts grid is fixed at 输入/命中/未命中/耗时 by design; under the hit-or-miss question that grid answers, a cache write is a miss.
- **Keep turn totals on raw `inputTokens`.** The turn row would keep disagreeing with its own requests (which already counted cache reads); the menu's 输入 figure now means the same thing as the request detail's.

## Consequences

- Claude Code (and any cache-writing provider) requests show their true input; hit rates on first turns stay honestly at 0% instead of masquerading as tiny requests. Turn totals grow to match — they now include cache reads too, which they previously excluded.
- History heals on reload: the usage objects already persisted in child logs carry `cacheWriteTokens`, so re-reading a log through the fixed lane restores the bucket with no migration.
- Kimi tabs read `#1 · 思考` → `#2 · 助手回复`; genuinely failed requests are unchanged (status flag plus the `error` field). A failed attempt with partial reasoning also summarizes as 思考 — its failure still shows through the status flag, not the summary.
- The `0.0s` duration on mirror folds stays: folds are written in one synchronous pass and the panel reports what the log knows.

## Testing

`pnpm --filter @khorsheed/dsh-context-lens test` (24 files, 216 tests): three-bucket accounting and `inputMiss` units, store live-lane turn totals over a cache-write fixture, reasoning-summary agreement across the live / settled-log / failed-attempt lanes, and TokenView rows never labeling a settled usage-less row as failed. Package build and the repo `pnpm gate` are green.
