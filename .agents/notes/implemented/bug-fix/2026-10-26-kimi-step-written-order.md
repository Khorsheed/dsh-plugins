# Agent Note: Kimi mirror numbers a step when it writes it

Status: implemented

## Problem

A Kimi member's child log (session 2e9c1ffb…) failed to open: `step/start does not match the open turn and next step`. Kimi's own wire record of turn 1 was clean: steps 1–7 in order, with steps 3, 4 and 5 calling 3, 6 and 4 tools in parallel. The mirror wrote the steps as 1, 3, 7, 8, 2, 3, 4, 5, 6, 8, 9, … The steps had gaps, came out of order and repeated numbers. Turns 2 and 3 used one tool per step and were fine.

Two mechanisms produced it:

- **Reserved coordinates.** Each ACP tool notification and each think/text stream reserved a step number. A later durable write took the smallest free number (`nextKimiSessionStep` fills gaps), and a fold took the lowest number it paired with. The released-log reader admits only one past the last step, so any write below a higher written step, or above an unwritten one, corrupts the whole log.
- **Late notifications.** The wire flush can fold a step before its tools' ACP notifications arrive. A late notification then reserved a step that no fold ever released, and at settle the call was written a second time as an "orphan" with the interrupted placeholder.

b1d0d972 released empty stream reservations, and eb832cff made stream output preview-only. Neither changed how durable steps are numbered.

## Decision

- **The coordinate is decided at write time.** `nextWrittenKimiStep` returns one past the highest `step/start` the turn has written. The fold (`session-mirror.ts`), a stream's sealed triple (`finalizeStep`) and an orphan tool (`finalizeOrphanTool`) all use it. Reservations stay only as keys for the live preview.
- **A call already in the log reserves nothing.** A notification for a call the turn's log already carries is marked seen without a reservation, and settle skips writing an orphan for a logged call.

## Alternatives considered

- **Copy Kimi's wire step numbers.** Folds may drop a wire step whose content was already sealed, which would leave a gap. Numbering at write time cannot.
- **A shared write guard in local-agent core.** It would protect every provider, but it is not needed for this bug. It is still worth doing separately.

## Consequences

- Steps land dense and in write order. When a stream is sealed after a later fold, the step order follows when the steps were written, not when they began.
- Logs written before this fix keep their numbering. 2e9c1ffb was repaired offline (backup under `~/dsh-log-repair-backups/20261026/`).

## Testing

`local-agent-kimi` (286). A live-driver spec replays the in-the-wild race: one wire step folds before its tool's notification arrives, and a three-tool parallel step's notifications also arrive late. The spec asserts dense steps 1..n, each tool written once, the answer last, and a valid released log. On the previous code the same spec writes steps 1, 2, 4, 4, 4, 4, 4, 3.
