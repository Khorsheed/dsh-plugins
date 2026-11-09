# Agent Note: A member queue's boot pause lifts once the restart's lost round is settled

Status: implemented

## Problem

After a restart, auto-continue resumed an interrupted member, yet the room composer kept showing 「队列已暂停；重启后请先核对未完成消息。」 with a resume button and nothing queued. At boot the member inbox turns every running row `uncertain` and pauses the queue so nothing replays before the lost round is decided. Auto-continue (and moving on by messaging the member) settles that row through `reconcileExecution`, but `reconcile` never cleared `paused`. The flag outlived its reason, and the banner asked the user to check messages that no longer existed.

## Decision

- The inbox records who paused it: `pausedBy: 'restart'` when boot recovery pauses it. An operator's `pause()` clears the marker, so that pause never lifts by itself.
- `reconcile` and `cancel` lift a restart pause once nothing is left to decide: no `uncertain` row and no queued composer input. Composer input still waiting keeps the pause, because replaying it blindly is exactly what the pause prevents.
- Recovery leaves an existing operator pause unmarked.

## Alternatives considered

**Never pause at boot when auto-continue is on.** Auto-continue is a room setting, but the inbox belongs to the member core, and composer input queued before the restart still needs a decision.

**Clear the pause from the room after auto-continue.** Clearing it there would also lift an operator's own pause. Only the inbox knows why it paused.

## Consequences

After auto-continue, the banner disappears unless composer input is still waiting. Ledgers paused by earlier restarts carry no marker and need one 「继续队列」 click.

## Testing

`packages/local-agent/tests/member-inbox.spec.ts` covers:

- A reconciled room round lifts the restart pause.
- Queued composer input keeps the pause until it is cancelled.
- An operator pause carries no marker.

## Superseded

Superseded on 2026-11-09 by the [restart-recovery consolidation](../feature/2026-11-09-restart-recovery-consolidation.md): the core never pauses a ledger at boot any more, so there is nothing to lift. A file that still carries an older core's `pausedBy: 'restart'` loads unpaused; an operator's own pause (no `pausedBy`) is untouched. `liftRestartPause` is gone.
