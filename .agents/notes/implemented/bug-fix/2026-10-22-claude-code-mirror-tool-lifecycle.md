# Agent Note: claude-code child-session logs pass the released-log reader (native tool lifecycle, turn/end after the settle mirror)

Status: implemented

## Problem

A claude-code child session in the wild (provider `claude-local`) failed to reopen: `stored session … is corrupt: … tool/call toolu_01HTBMTKPK… has no advertised tool lifecycle`. The released-log reader (`assertReleasedV4Relationships`, harness `session-format-v3-to-v4/relationships.ts`) validates every cold read of a stored log: a `tool/call` must match a `{type:'tool-call'}` block advertised by a prior assistant/message in the same turn (same id, name, arguments, strict-equal), every advertised call must resolve before its step closes, and each step must sit inside an open turn.

The claude mirror broke that contract on two axes, both invisible to the incremental append path and fatal on cold reads — the same defect class the [kimi released-log note](2026-10-22-kimi-mirror-released-log-validity.md) resolved for its own mirror and flagged for this package:

- **Bare tool lifecycle.** `appendClaudeTranscriptLine` folded a tool line as a `tool/call` with no advertising assistant/message, and closed the step without a result when the stream had none yet (both rejected on read). The mid-run fold made it worse: a tool line that stopped being the volatile last line before its `tool_result` arrived folded the bare call DURABLY — persistence is append-only, so no later pass could repair it.
- **Exec `turn/end` before the settle mirror.** The boundary was appended in the settle chain while the post-exit mirror ran afterwards, so every mirrored step landed after the turn had closed — rejected on read for any run whose live mirror had not kept up (a fast exit, an abort, a first-chunk race).

Unlike kimi, no concurrent-open-step failure occurs on real claude wires: the stream-json wire delivers per-item completions in order (a `tool_result` before any later line), so steps close before the next opens. One synthetic ordering still produces an invalid sequence — see Consequences.

## Decision

Claude child sessions emit only log shapes the released-log reader admits; a tool line writes its native lifecycle as one atomic step:

- **Fold** (`claude-cli-provider.ts` `appendClaudeTranscriptLine`): a tool line now folds `step/start` → an assistant/message advertising the `{type:'tool-call'}` block (id/name/arguments identical to the call event's) → `tool/call` → `tool/result` → `step/end`. A line still unresulted at settle folds the result as `CLAUDE_INTERRUPTED_TOOL_RESULT` (`（工具调用被中断，未能记录返回结果）`, the kimi text verbatim) with `isError: true`.
- **Hold mid-round**: both incremental folds (the exec live mirror's flush and the live driver's `mirrorUpTo`) stop before the first tool line whose result the stream has not recorded yet; the result merges into the call's line in place, so the next pass retries from there and folds the complete lifecycle. Settle passes (the exec post-exit mirror, the live driver's result-event and final flushes) never hold — the round is over, so the placeholder applies.
- **Exec `turn/end` lands after the settle mirror**, still behind the live mirror's queue, and the boundary persists after itself (the mirror's own persist precedes it, so without this the stored log would miss the boundary — a legal open-turn tail, but the timing window would stay open on reload). The run's `result` still settles at its own moment (abort latency unchanged); only the boundary moved. The settle mirror now parses the post-exit drained stdout buffer rather than the streamed accumulation variable — the authority `collectOutput` already preferred.
- **The mirror queue heals between tasks**: `enqueue` chains onto a caught tail, so a failing flush no longer poisons the queue for the settle mirror and the turn boundary (each caller still sees its own task's rejection).
- **Regression coverage**: `tests/expect-valid-log.ts` (copied unchanged from the kimi package) replays a spec's child-session log through the harness's own `assertReleasedV4Relationships`; the exec-round, live-round, hold, resume, and abort specs assert it on their final logs.

## Alternatives considered

- **Relax the validator upstream** (tolerate unadvertised calls or result-less step closes). Same answer as kimi's: a host change papers over the contract and leaves the client assembler's pairing rule untouched; the plugin-side emission meets the contract on every host line, today.
- **Advertise but drop unresulted calls at settle.** Loses the record that the tool ran at all; the placeholder keeps the card visible and reads honestly as interrupted. Kimi precedent.
- **Port kimi's `finalizeBefore` gap fill to the live driver's stream reservations.** The one remaining non-admissible shape is a synthetic fold order — a line folding above a stream reservation that never durably opened (the tool-first live spec exercises exactly that). Real claude streams deliver the `tool_result` before any later delta, so the gap needs protocol disorder or a crash between two persists; the pinned stream snapshot sequences are deliberately untouched here. Recorded as the follow-up in Consequences.
- **Leave the boundary unpersisted after the mirror** (let the next sync carry it). There is no next sync on a settle path; the stored log would permanently lack `turn/end`.

## Consequences

- claude child sessions — exec and live — survive the released-log reader on every path the specs replay, including a kill mid-tool and a tool result arriving after its line left the hold-back window.
- An in-progress tool whose result outlives the last-line window no longer renders a durable card while it runs: the card folds when the result merges (or with the interrupted placeholder at settle). Text/think streaming is unaffected.
- The interrupted placeholder reads as an error result (`isError: true`) — an honest interrupted marker, shared verbatim with kimi.
- Live mid-run ordering now keeps the durable log valid on a disordered wire; the run-progress delta for a held tool line lands when the lifecycle folds, not when the call first appears.
- **Known remaining gap** (also flagged in the kimi note): a live stream reservation that never durably opened can still leave a step gap when a later line folds above it — the tool-first live spec's synthetic ordering demonstrates it and is intentionally not replayed through the validator. The kimi note's crash-window remark applies verbatim. (The codex sibling carried the same bare-tool-lifecycle defect; it was fixed in parallel — see [codex mirror tool lifecycle](2026-10-22-codex-mirror-tool-lifecycle.md).)

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-claude-code test` (19 files, 258 tests — `expectValidReleasedLog` replays on exec rounds, live rounds, resume, and aborts, plus new hold and interrupted-placeholder specs on both drives); `pnpm --filter @khorsheed/dsh-local-agent-claude-code run build`. The placeholder shape was verified against the real validator with negative replays (a bare `tool/call` fails with `no advertised tool lifecycle`; an unresolved advertised call fails at `step/end`).
