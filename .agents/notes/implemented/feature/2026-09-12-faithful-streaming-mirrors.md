# Agent Note: Faithful streaming mirrors — every item folds, deltas land as throttled snapshots

Status: implemented

## Problem

The live drivers' token granularity ("逐字流式") was a downgrade masquerading as the richer mode: think/text lines were never folded into the child session log (`skipAssistantContent` — a workaround for host 0.1.5 retiring the durable per-chunk event), tools were the only visible content during a round, and the round's entire text landed as ONE combined message at settle. Users who picked the "streaming" mode saw strictly less than event mode, and the log kept no faithful transcript for post-hoc debugging. True per-token streaming had no channel at all: durable `assistant/live-chunk` is not appendable by plugins, and the transient `agent/assistant-stream` bus requires holding the session's Agent handle, which a mirror session never has.

## Decision

Both granularities now mirror every item 1:1 (reasoning/text → `assistant/message`, tool items → `tool/call`+`tool/result`); `skipAssistantContent` is deleted everywhere. Token granularity adds the streaming layer on top: while an item streams, deltas accumulate into **throttled incremental snapshot `assistant/message` events** (default maximum batching wait 50 ms per pending item, configurable via `snapshotMinIntervalMs`; the legacy `snapshotMinChars` field is ignored) appended at the item's reserved `(turn, step)`. The host's ui-chat folds repeated settles at one coordinate into a single live-updating chat node (`settleMessage` replaces wholesale and publishes immediately — verified present on both host lines), so the UI renders one continuously growing message; the item's completion fold lands at the same coordinate and finalizes it, and usage rides the final carrier (the last non-tool fold, or the settle-time final snapshot when nothing folded carried it).

The step ledger keeps tool cards chronological: `reservedSteps` permanently records every stream reservation (`step = lines.length + reservedSteps.length + 1` at reserve time), sequential folds shift past every reservation before them, and per-item `streams` state (keyed by itemId where the CLI provides one — codex's app-server does; kimi's ACP and claude's stream-json use a per-kind synthetic key) pairs a completion to its reserved step. A completion folds at its own reserved step even when another item streamed in between; switching items flushes one freshness snapshot (skipped when the text has not grown); settle force-finalizes every unfinished stream inside the turn window (interrupted on non-completed rounds, the last one carrying the usage). A coordinate never gets a second `step/start` (the live assembler throws on duplicate starts) — the step opens at the first snapshot and closes at the completion fold or the settle finalization.

The shared core `LiveFlush` scheduler keeps the first pending deadline while coalescing updates; sparse tails no longer wait for another delta or a character threshold. Final folds cancel pending timers, and turn settlement disposes the scheduler before finalizing partial content. These snapshots still use the durable event mirror; this step does not establish the room coordinator proposal's end-to-end P95 or persistence-volume targets.

## Alternatives considered

- **The old combined-message design** — withheld all think/text until settle; strictly worse visibility than event mode and an unfaithful log. Replaced wholesale rather than patched.
- **Emitting `agent/assistant-stream` frames** — the host-native transient channel renders true per-token updates, but it is scoped to whoever holds the session's Agent handle; a mirror session has none, and minting an Agent per child session to unlock it is a far larger structural change than snapshots.
- **One message per snapshot batch with fresh steps** — every snapshot its own (turn, step) would render as dozens of stacked partial messages instead of one growing message; the repeated-settle merge at one coordinate is exactly what the chat assembler already supports.
- **Run-progress-only deltas (status quo ante)** — no UI consumes `localAgent/run-progress` today, so deltas there are invisible; snapshots put the same text where the rendering already is.

## Consequences

- Every mode now shows ALL content live: tools, reasoning, and text — event mode per completed item, token mode with intra-item growth. The child session log is a faithful transcript (debuggable after the fact), and an aborted round keeps its partial text with the interrupted badge.
- Log volume grows in token mode (throttled snapshots; a long turn adds tens of events). The `tokenUsage` projection's (turn, step) last-wins dedup keeps accounting exact.
- claude's event mode now also records usage (the result event feeds the parser in both modes — previously event mode never booked usage); kimi's mid-pass usage drop is fixed by the `usageAttached` window + remainder accumulator.
- Known limits: sparse step coordinates are possible when a completed-but-held-back streamed line coexists with a later reservation (double-counted in the reservation formula — harmless holes); per-kind synthetic keys share one stream across same-kind items on kimi/claude (their wires carry no item id); the snapshot stream means token mode is now strictly richer than event mode, at higher event volume.
- The `localAgent/run-progress` delta channel still has no UI consumer — snapshots made it unnecessary for display; it stays for programmatic callers.

## Testing

Each provider's token-granularity suites were rewritten to the new contract (throttled snapshots land in the log at the reserved step with growing text; each streamed item finalizes at its own step with usage and no interrupted badge; tool-first rounds keep chronological steps; stream-less rounds fold every item; aborted rounds finalize an interrupted snapshot). codex 166, kimi 187, claude-code 154 green.

## Related

- [Local-agent child-session mirrors emit step boundaries](2026-09-12-local-agent-mirror-step-boundaries.md) — the live-render contract snapshots build on.
- [Delegated child sessions reattach on the tool path and persist explicitly](2026-09-12-local-agent-child-session-durability.md) — snapshots persist through the same sync path.
