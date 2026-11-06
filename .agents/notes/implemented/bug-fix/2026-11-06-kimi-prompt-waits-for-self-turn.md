# Agent Note: A Kimi prompt waits for a turn Kimi opened itself

Status: implemented

## Problem

When a Kimi background task finishes while the member is idle, Kimi opens a turn on its own: the wire logs a `turn.prompt` with `origin.kind: 'task'` (legacy `background_task`), no `promptId`, then the turn's steps and a `turn.ended`. If the room sends `session/prompt` during that turn, the round looked "done instantly, no reply" and the real answer ran later with nobody watching.

What the installed kimi 2.4.1 binary does here (read-only, from its bundled source strings):

- The ACP server's `assertNoActiveTurn` only checks ACP's own in-flight request (`this.driver`). A turn Kimi opened itself has no ACP driver, so the check passes. `turn.agent_busy` is only raised when a second ACP prompt arrives during an ACP-driven turn.
- `agent.prompt()` then reaches the v2 engine, which queues the prompt FIFO behind the running turn (the SDK facade's note: "v1 drops a prompt submitted while a turn is active … v2 queues it FIFO"). The launch resolves `undefined`, and ACP's `driveLaunch` settles that with `stopReason: 'end_turn'` right away. No chunks, no error.
- Once the self turn ends, the queued prompt runs as its own turn. On the wire that is a user-origin `turn.prompt` with the prompt's text, its steps, and a `turn.ended`. ACP forwards none of its events, because `driverFor(turnId)` drops everything that isn't the turn of the current ACP request.
- `session/cancel` with no ACP driver does nothing, so ACP cannot cancel the queued turn.

This was confirmed by reading the binary only. It has not been reproduced on a live session, because that would need a paid model call.

## Decision

The Kimi live driver (`packages/local-agent-kimi/src/live-driver.ts`) reads the member's `wire.jsonl` around each prompt. The pure readers live in `packages/local-agent-kimi/src/self-turn.ts`.

- **Wait before sending.** Before `session/prompt`, `findOpenSelfTurn` checks whether the wire's last `turn.prompt` has no `turn.ended` after it and a non-user origin. The first check reads the wire synchronously, so a prompt with no self turn ahead of it still goes out in the same tick as before. If there is a self turn, the driver polls the wire (500 ms) until the turn ends, for at most 10 minutes. The round is already open, so the room shows the member as busy while it waits. The self turn's lines are mirrored as they land, and a cancel during the wait means the prompt is never sent. A self `turn.prompt` stamped before the current process spawned (`KimiLiveRuntime.spawnedAt`) is something a dead process left behind and is ignored.
- **Follow after a collision, never re-send.** A self turn can still open between the check and the send, and the wait can hit its bound. So an answerless `end_turn` runs `readQueuedPrompt` against the wire from the line count read just before the send. The first user-origin `turn.prompt` at or after that line is ours. It counts as queued when a self turn was open at the send or a self `turn.prompt` lands before it. In that case the driver keeps following the wire until that turn's `turn.ended`. It takes the answer from the turn's text `content.part`s, one segment per model step joined with `textSegmentSeparator`, and maps the end reason (`completed` → completed, `cancelled` → aborted, anything else → error). While following, the driver holds the member's turn chain, so the next prompt cannot go out under it.
- **Otherwise unchanged.** If our prompt opened its turn with no self turn ahead of it, or the wire shows nothing within a 2-second grace, the existing guard still applies: an answerless `end_turn` is an error, never an empty success.
- **Abandoned follow.** If a cancel or failure ends the follow before the queued turn ends, Kimi still runs that turn and ACP cannot stop it. `KimiLiveRuntime.queuedTurnAbandoned` makes the next prompt wait for any open turn, including a user-origin one, not only a self turn.

The timings can be overridden through `KimiLiveDriverTimeouts` (`selfTurnWaitMs`, `selfTurnPollMs`, `collisionGraceMs`). The self turn's own content still folds into the next dsh round under the 11-01 rule. Giving it its own execution is a later part of the member-self-started-rounds design.

## Alternatives considered

**Re-send the prompt after the self turn ends.** Rejected because the engine already holds the prompt. A second send would run the request twice.

**Treat the instant `end_turn` as an error and let the room retry.** Rejected because the queued turn still runs and answers with nobody watching, and a retry would also run the request twice.

**Wait for any open turn, not just a self-opened one.** Rejected as the default. Older wires and many fixtures have user `turn.prompt`s with no `turn.ended` and no timestamp, and ACP-driven turns have already ended by the time the turn chain lets the next prompt through. The broader wait is used only after an abandoned follow, the one case where a user-origin turn is known to still be running.

**Watch the wire with `fs.watch` instead of polling.** Not done here. The design's observer (B②) covers continuous watching. These waits are rare and bounded, so a 500 ms poll that reads the file is enough.

## Consequences

- A room dispatch that lands during a background-task turn now waits and gets the real answer, instead of looking finished and empty.
- A prompt can be held for up to 10 minutes behind a long self turn before it goes out. After that it is followed instead.
- A local cancel during a follow ends the dsh round, but Kimi's queued turn keeps running, because ACP cannot address it. Its lines fold into the next round.
- An answerless round with no collision now settles up to 2 seconds later (the grace that lets a slow wire flush show the collision).

## Testing

- `packages/local-agent-kimi/tests/self-turn.spec.ts` covers the readers: open self turn, legacy origin, stale-by-spawn-time, partial line, direct, unknown, queued, running and ended phases, and end-reason mapping.
- `packages/local-agent-kimi/tests/live-driver.spec.ts`, block "turns kimi opens on its own", uses FakeAcp plus a synthetic wire: the prompt waits for a self turn; a cancel during the wait never sends; a self turn that outlasts the bound is sent then followed; a collision returns the queued turn's answer, sends once, and logs a warning; a failed queued turn settles as an error; and with no self turn (and a stale one), the prompt goes out at once and an answerless `end_turn` stays an error.
