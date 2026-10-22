# Agent Note: kimi child-session logs pass the released-log reader (atomic steps, native tool lifecycle)

Status: implemented

## Problem

A kimi live delegation's child session failed to reopen: `stored session … is corrupt: … step/start does not match the open turn and next step`. The released-log reader validates every cold read of a stored log (`assertReleasedV4Relationships`, harness `session-format-v3-to-v4/relationships.ts`), and it admits only dense, strictly sequential steps — one open at a time — with each tool call advertised by a prior assistant/message and resolved before its step closes.

The kimi provider's emission broke that contract in four independent ways:

- **Concurrent open steps (the observed failure).** The live driver opened `step/start` at a stream's first snapshot and held the step open until the wire line folded or the round settled. kimi's ACP pushes think→text transitions within milliseconds while the file fold waits on the CLI's wire flush plus a 500 ms mirror throttle, so a second `step/start` persisted while the first step was still open. Persistence is append-only: the invalid order was durable from that moment, and even a clean settle could not repair it (the `step/end`s landed after both starts).
- **Bare tool lifecycle.** The mirror folded `tool/call` without the advertising assistant/message the reader pairs against, and closed the step without the result when the wire had none yet (both rejected on read); the late-result backfill appended a bare `tool/result` at an already-closed coordinate (also rejected).
- **Exec path folded after `turn/end`.** The post-exit settle mirror ran after the turn boundary, so any content it folded landed outside an open turn.
- Every one of these was invisible to the incremental append path (no step sequencing rule there) and surfaced only on history reload.

The codex/claude live drivers share the reservation machinery but their wires deliver per-item completions immediately, so their steps close before the next opens and the violation does not occur in practice. Their mirrors share the bare-tool-lifecycle defect (a claude child session with the `no advertised tool lifecycle` failure exists in the wild), and the dsh mirror can copy a sub-session's open step across `turn/end` — both outside this change's scope, recorded here for the package owners.

## Decision

Kimi child sessions emit only log shapes the released-log reader admits, with one rule: **a durable step is written as one atomic `step/start`→…→`step/end` triple at content-arrival time, never held open across appends.**

- **Live driver** (`local-agent-kimi/src/live-driver.ts`): streaming deltas publish through the `local-agent/stream` channel only (the member live node self-materializes from those events; no boundary needed). A stream's durable content lands as one triple — written by its completing wire line's fold, by a gap fill, or at settle. ACP `tool_call` notifications only reserve the chronological step number; nothing durable lands at notification time. A tool reservation kimi never logged to the wire finalizes at settle as an interrupted placeholder step (advertised call + the shared `KIMI_INTERRUPTED_TOOL_RESULT` error result).
- **Gap fill** (`finalizeBefore`): a fold about to write at step S first finalizes every live stream reservation below S in ascending order, keeping the stored steps dense. A sealed stream stays paired by kind; its completing wire line then drops instead of duplicating the content, and a sealed stream that receives new deltas re-reserves a fresh step (the plan stream's case).
- **Mirror** (`session-mirror.ts`): a tool line folds the native lifecycle in one step — an assistant/message advertising the tool-call block, the `tool/call`, its `tool/result`. A line whose result the wire has not recorded holds the pass (the offset stops before it; results merge into the call's line in place, so the next pass sees them); the settle pass folds the remainder with the interrupted placeholder. The usage window closes at the held line, and the usage carrier computation skips sealed pairings (a dropped line cannot carry).
- **Exec path** (`kimi-cli-provider.ts`): the post-exit settle mirror now runs BEFORE `turn/end` inside the mirror queue, so mirrored steps land inside the turn window. The run's `result` still settles at the same moment (abort latency unchanged); the turn boundary lands with the mirror.
- **Regression coverage**: `tests/expect-valid-log.ts` replays a spec's child-session log through the harness's own `assertReleasedV4Relationships`; the live-driver and mirror specs assert it on the rounds that exercise streams, tools, cancels, and resumes.

## Alternatives considered

- **Relax the validator upstream** (tolerate concurrent open steps or late out-of-step results). A host change through the upstream pipeline that papers over the contract and leaves the client assembler's one-start-per-context rule untouched; the plugin-side emission order meets the contract on every host line, today.
- **Close-on-switch**: finalize the active stream's step the moment a kind switch or tool notification arrives. Eager sealing forfeits the reservation's purpose — the live node at a sealed coordinate can no longer grow, and a mid-round tool card would force the answer stream to re-reserve — while gaining nothing over sealing exactly when a fold needs the step (gap fill).
- **Renumber unpublished reservations to follow wire order** (an unstreamed think item folding before a streamed answer). Only unpublished reservations may move, the mirror's fold ledger and the driver's reservation ledger would need a shared renumbering protocol, and the win is cosmetic ordering in a rare edge — rejected as disproportionate; the accepted behavior is documented under Consequences.
- **Keep the in-progress tool card via a held-open step**: the card would show while the tool runs, but every later fold stalls behind it and a killed tool leaves the turn unclosable — strictly worse than folding the card when the result lands.

## Consequences

- kimi child sessions — live and exec — survive the released-log reader on every path the specs replay, including cancellation mid-stream and tools interrupted by a kill.
- Live rendering is unchanged on the family-paired core (the `local-agent/stream` channel already carried it). A kimi package paired with a core too old for `liveStreams` loses mid-round partial text in the child session (final folds still complete the transcript); the family ships together, so this degrades only a hand-mixed install.
- An in-progress tool no longer renders a durable card while it runs: the card folds when the wire records the result (or with the interrupted placeholder at settle). Live text/think streams are unaffected.
- Order fidelity is live-arrival order, not wire order: an item that never streamed a delta folds after a streamed item that arrived first (the wire's earlier line was invisible when the reservation was made). If that silent item's fold drops the round's usage carrier, the accounting lands on the round's settled observation instead of a message — exactly-once is preserved, the carrier is best-effort.
- The tool result's `arguments`/`name` fidelity is unchanged (the wire's rendered summary, as before); what changed is only the lifecycle's validity.
- Follow-ups for the sibling owners, with in-the-wild evidence: claude-code/codex mirrors emit bare `tool/call` without the advertising message (a corrupt claude child session exists on record), and the dsh mirror can copy an interrupted sub-session's open step across `turn/end`. Their reservation timing makes the concurrent-step violation unlikely, not impossible — a crash between two snapshot persists reproduces it. The claude-code half shipped: [the claude-code tool-lifecycle note](2026-10-22-claude-code-mirror-tool-lifecycle.md).

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-kimi test` (22 files, 275 tests) including `expectValidReleasedLog` replays; `pnpm --filter @khorsheed/dsh-local-agent-kimi run build`. The repair of the session that surfaced the defect (inserting the missing `step/end`, closing the turn as aborted, header frame kept independent) was verified against the same validator semantics by hand.
