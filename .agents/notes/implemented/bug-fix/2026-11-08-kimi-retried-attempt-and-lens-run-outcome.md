# Agent Note: A Kimi step that was retried leaves nothing behind, and a room run's outcome comes from its execution record

Status: implemented

## Problem

Room round 149 of session 75844e33 (a Kimi member, child turn 135) completed. The room recorded the run as `done`, and so did the member's `local-agent/execution` end record. The child log still ended with three steps that Kimi never took: a `novel_extract` call with empty arguments, closed by the mirror's interrupted placeholder (`isError: true`); a reasoning-only step; and a turn end that came 10 s after Kimi's own. In Context Lens this showed as request #420 with no usage, 0.0 s and 「工具失败 1」, and the user read the round as failed.

Kimi's own wire shows what happened. Step 5 of Kimi turn 134 streamed for 163 s, then the connection dropped (`step.end finishReason: error`, then `turn.step.retrying`, `APIConnectionError: terminated`, `delayMs` 618). Kimi retried, and the wire records only the retry. The call id `tool_sl0Gfp7lOo1aRJzIaT5JqDqv` appears nowhere in Kimi's files. However, Kimi's ACP server (`acp-server/src/events-map.ts` and `session.ts` in the 11-02 binary) had already forwarded the dead attempt's thought chunks and a `tool_call`. That `tool_call` was created lazily from the first streamed argument delta (`status: pending`), and the server never sends anything when a step is retried. The live driver did the rest:

- The retry's wire fold called `completeStreams`, which takes the earliest open stream of each kind. That was the dead attempt's thought stream, so every later stream shifted down by one. The last one ("Respond concise.") was left open and was written at settle from its live text, as a reasoning-only step.
- The dead call's `toolSteps` reservation was never released by any wire line, so settle wrote it with `finalizeOrphanTool`: name from the ACP title, `args: ''`, and the interrupted result.
- Settle waited the full `settleFoldWaitMs` (10 s) for the stranded stream.

This was not Kimi K3 dropping nested arguments. The empty `arguments` is what `finalizeOrphanTool` always writes.

On the Lens side, the round row and member status in today's store already read `ok` for this round. The scope status, however, still came from the room's `room/run-state`, not from the execution's end record, so S8's rule (Lens reads execution records) was only half applied.

## Decision

- **Kimi transcript** (`session-view.ts`): every `turn.step.retrying` becomes a `retriedAttempts` entry `{ turn, from, until }`. `from` is the abandoned attempt's `step.begin` time, found by `stepId`. `until` is the retry's time plus the `delayMs` it announced, because the next attempt is not requested before then. All times are Kimi's own wall clock.
- **Mirror pass** (`session-mirror.ts`): before any unit folds, each retried attempt goes to the new optional `KimiMirrorStreams.discardAttempt` hook.
- **Live driver** (`live-driver.ts`): streams and ACP tool reservations now record when they first arrived. `discardAttempt` drops every unsealed think/text stream, and every not-yet-logged tool reservation, that first arrived inside the window. It ends their preview and frees their reserved step. Nothing of the dead attempt is folded or written. The retry streams again, and its wire step is the record.
- **Context Lens** (`store.ts`, `roomTurns`): a run's outcome is its execution's end record (`done` / `failed` / `cancelled`) when the child wrote one. The room's run state is the fallback only when there is no end record, or the end is `uncertain` (a restart cut it off). A failed tool call inside a done execution stays a tool failure on its own request (`toolErrors`) and never makes the member's scope `failed`. Rounds without records keep their fallback.

## Alternatives considered

- **Drop orphan tool calls whose ACP status never left `pending` at settle.** Rejected. It removes the fake call but not the shifted thought stream, and it would also hide a call that a crash cut off while its arguments were still streaming.
- **Discard everything open when the retry line is seen, without a time window.** Rejected. The mirror pass is throttled, so by the time it reads the line the retry may already be streaming, and its streams would be thrown away with the dead ones.
- **Have Lens hide or relabel requests whose only call carries the interrupted placeholder.** Rejected. That is inference from filler text. The fix belongs where the fake step is written, and Lens shows what the log records.
- **Rewrite the existing round 149 log.** Not done. Logs are append-only, and the fix applies to new rounds.

## Consequences

- New Kimi rounds whose model call is retried mid-stream no longer get a fake failed call, a stray reasoning step, or a 10 s settle delay. A preview of the dead attempt disappears when the next mirror pass reads the retry line.
- Round 149 and other already-written logs keep their fake step. Lens shows it as a usage-less request with one tool failure, inside a member scope that reads `ok`.
- A room run that the room marked `failed` but whose execution ended `done` now reads `ok`, and the reverse case reads `failed`. The execution record wins.

## Testing

- `packages/local-agent-kimi/tests/live-driver.spec.ts`: a synthetic wire and ACP replay of the incident. The dead attempt streams a thought and a `pending` tool call, then the wire records `step.end error` and `turn.step.retrying`, and the retry streams and is logged. The test expects no `tool/call` / `tool/result`, exactly one assistant message (the retry's reasoning and text), no trace of the dead thought, and a valid released log. It fails without the mirror hook and reproduces the incident's tool call.
- `packages/local-agent-kimi/tests/session-view.spec.ts`: the retry window (backoff included), and an open `from` when the attempt's begin was not seen.
- `packages/context-lens/tests/room-rounds.spec.ts`: a done execution with an errored call reads scope `ok`, `failedScopeCount` 0, and request `ok` / `toolErrors` 1. The record wins over the room state both ways, `cancelled` passes through, and `uncertain` falls back to the room state.
- Read-only checks against the real logs (scratch, not committed): the new parser reports the incident's window as turn 135, from 1794060137099 to 1794060301297, which brackets the dead attempt and ends 22 s before the retry's first token. Replaying the room and child logs through the Lens store gives round 149 member status `ok` and #420 `ok` / `toolErrors` 1.
- Not verified: a live Kimi round with a real retried step (that needs a dropped connection on 3080).

## Related

- [Context Lens reads the execution records](../simplification/2026-11-05-context-lens-reads-execution-records.md): the rule the Lens half completes.
- [Local-agent execution records are written](../feature/2026-11-04-local-agent-execution-records-written.md): the end record whose `outcome` now decides a run's status.
