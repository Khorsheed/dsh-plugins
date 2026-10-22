# Agent Note: codex child-session logs pass the released-log reader (native tool lifecycle)

Status: implemented

## Problem

A codex child session that used any tool failed to reopen: the released-log reader validates every cold read of a stored log (`assertReleasedV4Relationships`, harness `session-format-v3-to-v4/relationships.ts`), and the codex mirror's durable emission broke that contract on two axes, both invisible to the incremental append path and fatal on history reload:

- **Bare tool lifecycle.** `appendCodexTranscriptLine` folded `tool/call` without the advertising assistant/message the reader pairs against (`has no advertised tool lifecycle`), and closed the step without a result whenever the stream carried none (`leaves unresolved tool call`). A missing result is routine on both drives: `web_search_call` items never carry one, `dynamicToolCall`/`mcpToolCall` completions carry none on the live wire, and a kill truncates a command's output. Every tool-using codex child session in the wild was unloadable.
- **Exec path folded after `turn/end`.** The post-exit settle mirror ran after the turn boundary (appended at result-settle), so anything it folded — the held-back last line, a killed run's trailing command — landed outside an open turn (`step/start does not match the open turn and next step` on reload).

The kimi provider had the same defect class and shipped the reference fix — see [the kimi released-log note](2026-10-22-kimi-mirror-released-log-validity.md); this change ports it to codex's shapes. Codex's concurrent-step exposure is narrower than kimi's was: the exec live mirror holds back exactly the one volatile line (a `function_call_output` can still merge into it), and the live driver's `item/completed` notifications fold synchronously, so no fold ever sees a call whose result is still in flight.

## Decision

Codex child sessions emit only log shapes the released-log reader admits; tool lines fold the **native lifecycle in one atomic step**: `step/start` → an assistant/message advertising the `{type:'tool-call', id, name, arguments}` content block (strict-equal to the call event's) → `tool/call` → `tool/result` → `step/end`.

- **Shared fold** (`local-agent-codex/src/codex-cli-provider.ts` `appendCodexTranscriptLine`): the one fold every drive funnels through — the exec live mirror, the exec settle mirror, and the live driver's completion fold all call it, so the lifecycle fix lands on both transports at once. Unlike kimi, there is **no hold pass**: every codex fold sees a completed item, so a result missing at fold time will never arrive — the call resolves with the synthesized interrupted error result (`CODEX_INTERRUPTED_TOOL_RESULT`, the same text as kimi's placeholder for family consistency).
- **Exec `turn/end`** moved out of the settle chain into the post-exit mirror chain, appended after the settle mirror (still serialized behind the live mirror's queue) and persisted with it, so every mirrored step lands inside the turn window. The run's `result` still settles at the real moment — abort latency is unchanged; only the boundary event moved.
- **Live driver unchanged otherwise**: stream snapshots, step reservations, and the per-step event sequences the specs pin are exactly as before; only the tool fold's event composition changed.
- **Regression coverage**: `tests/expect-valid-log.ts` replays a spec's child-session log through the harness's own `assertReleasedV4Relationships`; the fold unit tests and the exec/live round, resume, crash, cancel, and abort specs assert it.

## Alternatives considered

- **Hold-if-unresulted, offset-style** (the kimi mirror's mid-round rule: stop the pass before an unresulted tool line, retry once the wire records the result). Codex's fold never observes that state — the exec hold-back covers the `function_call_output` merge window and the live wire completes items atomically — so a hold would only stall the offset forever on genuinely result-less item types (`web_search_call`). Synthesizing the interrupted result at fold time is the settle semantics applied everywhere, with no offset machinery.
- **Relax the validator upstream** (tolerate unadvertised calls or steps outside an open turn). A host change through the upstream pipeline that papers over the contract; the plugin-side emission meets the contract on every host line, today. Same answer as the kimi note.
- **Bare late-result backfill at the call's closed coordinates** (what kimi removed). The reader rejects a `tool/result` with `surfaceOp: 'append'` outside the open step; and codex's fold sites never need it — the result, when one exists, is already on the line at fold time.
- **Redesign the live driver's reservation ledger for dense step order.** A tool completing between a stream's reservation and its completion fold numbers the tool's step past the reservation, so the stored starts are not in wire order (the synthetic tool-first spec exercises exactly this). The reservation scheme is the live projection's chronological-order mechanism and the stream specs pin its exact sequences, so this change leaves it alone; the gap is recorded under Consequences.

## Consequences

- Tool-using codex child sessions — exec and live — survive the released-log reader on every path the specs replay, including a kill mid-command and result-less item types.
- A mirrored tool call now carries one extra assistant/message (the advertisement) in the child log; the real-time view's per-step anchoring is unchanged. Logs written before this change were append-only and stay invalid on cold read — the fix covers new folds only.
- The exec `turn/end` timestamp now includes settle-mirror quiescence; the run result's settle moment and abort latency are unchanged.
- Known gap, recorded for the package owner: the live driver's reservation ledger can still persist non-dense step starts when a tool completes between a stream's reservation and its completion fold (steps never overlap-open on this wire — `item/completed` folds synchronously — so the kimi-class violation does not occur, but a reload of such a log still fails the dense-step rule). Not observed in the wild for codex; kimi's gap-fill (`finalizeBefore`) is the template if it ever surfaces.

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-codex test` (20 files, 244 tests), including `expectValidReleasedLog` replays on the fold unit tests, the exec settle/resume/error/abort specs, and the live round/resume/crash/cancel/stream-settle specs; `pnpm --filter @khorsheed/dsh-local-agent-codex run build`.
