# Agent Note: dsh child-session logs close the copied interrupted tail before turn/end

Status: implemented

## Problem

Two dsh provider child sessions failed to reopen in the wild: `stored session … is corrupt: … turn/end does not match the open turn with no open step`. The released-log reader (`assertReleasedV4Relationships`, harness `session-format-v3-to-v4/relationships.ts`) validates every cold read of a stored log: a `turn/end` must land on a turn with no open step and no advertised-but-unresolved tool call, and every `assistant/message` / `tool/call` / `tool/result` append must match the currently open step.

The dsh mirror copies the sub-dsh session's real events verbatim (the design in [local-agent mirror step boundaries](2026-09-12-local-agent-mirror-step-boundaries.md) — "an interrupted step without its end crosses open; no boundary is ever synthesized"). When the sub-dsh died mid-step (the exec kill ladder, a live-runtime crash), the copied open step — and any advertised-but-unresolved tool calls inside it — sat in the child session when the provider appended its own `turn/end`, producing exactly the rejected sequence. Two more gaps compounded it: the exec path's settle mirror ran AFTER `turn/end` (anything the final pass folded landed outside the turn window), and its `turn/end` could go unpersisted — the mirror's persist fires only when a pass appended events, so a poll-drained settle wrote the boundary to no store. The kimi sibling's defect class was fixed the same day in [kimi mirror released-log validity](2026-10-22-kimi-mirror-released-log-validity.md); this change is the dsh half it called out.

## Decision

The copy stays verbatim for everything that is complete; the settle flow closes the copied interrupted tail before the provider's `turn/end` lands.

- **Mirror** (`local-agent-dsh/src/session-mirror.ts`): new `closeMirroredOpenStep(childSession)` scans the current turn for a copied `step/start` whose `step/end` never crossed. For each tool call the turn's assistant messages advertised but no result resolved, it appends a synthesized interrupted `tool/result` at the open step — a started call gets the family's shared placeholder text `（工具调用被中断，未能记录返回结果）` with `ToolOutcomeUnknownError`/`TOOL_OUTCOME_UNKNOWN` and `sourceEventSeqs` paired to the copied call event, exactly like a real mirrored result; a call that never started gets the validator's exact TOOL_NOT_STARTED repair shape (the `interrupted-tool-result-<callId>-<seq>` id, `ToolNotStartedError`, the prescribed English text, and NO `sourceEventSeqs` — the reader admits only that shape). Then the synthesized `step/end` closes the step. Mid-round transports (poll passes, live push) still never synthesize: the sub-dsh may yet write its own end, and a synthesized boundary would collide with it on a later pass. A sibling `mirroredOpenStep(childSession)` reports the open copied step.
- **Exec path** (`dsh-cli-provider.ts`): `turn/end` moved from the result settle chain into the post-exit mirror queue, after the settle pass and the closure, and is persisted explicitly — the mirror's conditional persist skips a no-op pass, which was exactly the case that lost the boundary. The run's `result` still settles at the same moment (abort latency unchanged); the boundary lands with the mirror.
- **Live path** (`live-driver.ts`): the reconciliation mirror, the closure, and `turn/end` moved into the result settle chain (the kimi live driver's shape). The per-member round chain holds until `result` settles, so a resume round's `turn/start` can never overtake the previous round's `turn/end`; the price is one small file read per round before settlement. The interrupted-stream fold now fires only while its step is still open (the `mirroredOpenStep` guard): a graceful sub-dsh unwind writes its own interrupted message and `step/end`, and an append at the closed step would itself fail the reader.
- **Regression coverage**: `tests/expect-valid-log.ts` (copied unchanged from the kimi package) replays a spec's child-session log through the harness's own validator; the mirror, exec-provider, and live-driver specs assert it on normal rounds, resume rounds, cancels mid-stream, and interrupted mid-step tails.

## Alternatives considered

- **Reuse the harness's `interruptedTurnClosers`** (`dsh-session/repair.ts`) over the child log. Its shapes are the validator's own, but it also synthesizes a `turn/end` with the `interrupted` reason — the provider owns that boundary and must record the round's real stop reason (`completed`/`aborted`/`error`) — and its started-call repair text is the harness's English retry guidance, while the family renders the shared Chinese placeholder for a started-but-unresolved call (kimi parity on the same surface). The closure reuses its shapes and id vocabulary, not the function.
- **Close the open step at copy time** (the span loop or the live fold). A synthesized `step/end` collides with the sub-dsh's own late `step/end` on a later pass — a duplicated end for the same (turn, step) breaks the prefix-skip alignment and the reader alike. The open pair must stay open while the sub-dsh may still write; only settle knows the process is done.
- **A detached live settle chain** (the exec path's shape). The live driver's round serializer holds only until `result` settles, so round N+1's `turn/start` could land before round N's detached `turn/end` — invalid on cold read. In-chaining costs one reconciliation read per round and removes the race. The exec path keeps the detached queue (its settle mirror must wait for process exit, and `result` must settle immediately on abort); its resume race is accepted as theoretical — a resume round requires a model round-trip while the mirror queue drains in milliseconds, and the kimi fix accepted the same shape.
- **Filter the open step out of the copy** (never cross an unclosed `step/start`). The real-time view then drops the interrupted round's last reply (a message materializes only at a step boundary) — the very defect the boundary copying fixed — and the prefix-skip alignment would need a second filter set.

## Consequences

- dsh child sessions — exec and live — pass the released-log reader on every path the specs replay, including a kill mid-step with calls started and never started.
- The exec-path `turn/end` is durable even when the settle mirror is a no-op; the closure's synthesized events persist through the same explicit sync.
- The exec `turn/end` timestamp grows by the settle-mirror quiescence; the live `result` settles one reconciliation file-read later. Neither changes abort latency.
- An interrupted live stream whose step already closed (a dropped notification edge) no longer folds its partial text at the closed step; the file reconciliation pass recovers the sub-dsh's own interrupted message instead.
- The 09-12 note's dsh bullet is updated: "no boundary is ever synthesized" now holds only mid-round; the settle closure is the documented exception.
- A session already corrupted before this fix stays corrupt on disk — the mirror never rewrites history; repair is the manual procedure the kimi note records.

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-dsh test` (18 files, 249 tests) including `expectValidReleasedLog` replays on the interrupted-tail, normal-round, resume, cancel, and live-push parity specs; `pnpm --filter @khorsheed/dsh-local-agent-dsh run build`.
