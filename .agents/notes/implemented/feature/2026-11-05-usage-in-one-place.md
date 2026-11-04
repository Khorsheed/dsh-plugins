# Agent Note: usage is written in one place; the room reads it

Status: implemented

## Problem

Batch 5 (the unified execution entry, design `proposals/active/2026-11-03-unified-execution-entry.md`, outside the repo) requires write-side fact 3: a member round's usage is written in exactly one place. Before this step (S6), room kept its own copies:

- `room/execution-metadata` carried `tokens` and `usage`, copied from the `settled` progress event (the provider's settle report).
- `room/member-compacted` carried `beforeTokens`/`afterTokens`/`contextWindow`/`usage`, copied from the member log's `local-agent/compaction` fact.

The design's migration row S6 says room should stop storing numbers and read them through a core `readExecution`. User decision 2 (2026-11-03) overrides the row where they differ: record **both** figures and cross-check them. The CLI's self-reported round total is an independent fact (written since S1 as `providerReportedUsage` on the `local-agent/execution` end record). The per-call usage stays only on `assistant/message.usage`. The room shows the CLI total per round and a hint when the per-call sum differs.

## Decision

- **Core read** (`LocalAgentRegistry.readExecution(childSessionId, executionId)`, `packages/local-agent/src/index.ts`; pure fold `executionReadingsOf` in `packages/local-agent/src/execution-read.ts`). It is read-only and returns `LocalAgentExecutionReading` (`types.ts`):
  - `callUsage`/`calls`: the sum of every `assistant/message.usage` whose `turn` is in the execution's turns. Buckets are summed separately, and `totalTokens` is not summed because its meaning differs per CLI.
  - `providerReportedUsage`: copied verbatim from the end record.
  - `unrecorded`: copied verbatim from the end record.
  - `compactions`: the `local-agent/compaction` facts between the start and end records. They are never added into `callUsage`, and their sizes are context sizes, not usage.
  - `outcome`, `turns`, `operation`.

  An open execution's range runs from its start record to the next execution record, and its turns are the `turn/start`s in that range. A live log is re-folded only when its last seq moved. A cold log is read from storage once per child, the same pattern as `coldContexts`, and a failed read is not kept. Nothing is persisted.
- **Room stops copying.** `room/execution-metadata` new rows carry only `model`/`effort`. A settle report with no observation writes no row. `room/member-compacted` new rows carry `runId`/`outcome`/`summary`/`error`/`durationMs`/`unreported`. `unreported` stays: it is the core fact's write-time mark, it also drives the delivery outcome text, and it is not a number. Old fields stay in the types, documented as legacy, and old rows replay as written.
- **Room attaches the reading** (`RoomService.readExecutions`, called from `getState`). For every replayed run with an `executionId` and a `childSessionId`, room calls `localAgent.readExecution` through the existing probe (`readExecution` added to the optional part of `LocalAgentFacade`) and sets `RoomExecution.reading`. The reading is computed per read and never journaled. A missing facade, a core without the method, a failed read, or an unknown execution leaves the run as replayed.
- **Room client picks what to show** (`packages/room/src/client/round-usage.ts`):
  - `roundUsage(execution)`: if a reading has a CLI total, show the CLI total and its breakdown, with the per-call sum in the breakdown. When the sum differs by more than `max(50, 1% of the total)`, `gap` = sum − total.
  - If a reading has no CLI total (kimi, dsh), show the per-call sum.
  - With no reading, show the legacy stored `usage`/`tokens`. A reading always wins; the two are never mixed.
  - `compactionNumbers(row, execution)`: the last compaction fact in the reading, else the row's legacy copies.
- **Views.**
  - `RoomSpeechView`'s usage chip uses `roundUsage`. The panel title says which figure it is: 「本轮用量（CLI 报告）」 or 「本轮用量（逐次合计）」, and a legacy row keeps 「本轮用量」. A gap adds a quiet meta-styled hint next to the round: 「逐次合计比 CLI 报告少 {n}，可能有未记录的内部调用」 / "Calls sum to {n} less than the CLI total; possibly unrecorded internal calls", plus a "more" variant. It sits last in the action row and wraps onto its own line on a narrow reply; the breakdown panel repeats it in full.
  - `RoomCompactionView` now gets `roomStore` injected and reads through `compactionNumbers`.
  - `memberUsage` (stats chip), `executionRows` (tasks) and `team.ts` (team page) add the same per-round figure.
- **Decision-model usage** is untouched and stays only on `room/decision`.

## Alternatives considered

- **Show only the per-call sum** (the design row's original recommendation). This was overridden by user decision 2: the CLI total is shown, and the sum is the cross-check.
- **Compute the gap in the core.** Rejected. The core returns facts; whether and how to flag a difference is presentation. Room cannot import the core at runtime, so the comparison lives in a room client module.
- **Store the reading in the room log once the execution ends** (cheaper repeat reads). Rejected because it would be a copy again. Readings are cached in memory per child instead.
- **Drop `unreported` from new compaction rows.** It was kept: the core's mark is already on the fact, but the row also needs it when the core is absent at read time, and it drives `COMPACT_UNREPORTED_TEXT`.

## Consequences

- **User-visible:**
  - Claude Code and Codex rounds show the CLI's round total, the same figure as before S6, which also came from the settle report. Kimi and DSH rounds now show the per-call sum. Before, they showed whatever the provider's settle `usage` carried; for kimi that was usually the same sum.
  - A round whose calls do not add up to the CLI total shows the hint.
  - New compaction rows show the same numbers, read live from the fact.
  - Rounds from before S5/S6 show their stored numbers unchanged.
- **Degrade:** without local-agent, or with an older core lacking `readExecution`, new rounds show no usage (only the run time) and new compaction rows show no numbers. Nothing throws.
- **Cost:** `getState` now reads every execution's child log. Live logs fold once per change, and cold logs are read once per process. A room with many members and a long history pays one cold read per member on first view. This still needs a look on 3080, as the design's open item says.
- **Context Lens** never read `room/execution-metadata` or the compaction copies, so its source is untouched and stays green. Lens's own reading of the execution records is S8.

## Testing

- `packages/local-agent/tests/execution-read.spec.ts`:
  - `addUsage`.
  - `executionReadingsOf`: matching sum and total; a mismatch kept side by side; kimi with no total across several turns and executions; a compaction fact passed through and excluded from the sum; an open execution; a log without records.
  - `readExecution` live (re-read after the log moved) and cold, in a second context on the same JSONL store.
- `packages/room/tests/usage-reading.client.spec.tsx`:
  - `roundUsage`: tolerance, signed gap, kimi, reading-over-stored, legacy.
  - The speech chip: matching totals (both figures in the panel, no hint), a mismatch hint in zh and en, kimi titled 逐次合计, an old run's stored numbers.
  - The compaction row: a new row from the fact, an unrecorded fact, an old row's stored numbers.
  - `memberUsage` summing the three kinds.
- `packages/room/tests/dispatch.host.spec.ts`:
  - Metadata now carries only model/effort, and a usage-only report writes nothing.
  - `getState` attaches the reading and survives a throwing read.
  - `/compact` rows no longer copy numbers.
- `packages/room/tests/real-core.host.spec.ts`: on the real local-agent core, no room event carries `tokens`/`usage`, and `getState`'s run carries the core's reading (per-call sum 12 and CLI total 1,302).
- Screenshots from the room preview harness at 1280 and 390, with matching totals, the mismatch hint, and kimi, were checked by eye and not committed.
- Not verified against a real CLI or on 3080.
