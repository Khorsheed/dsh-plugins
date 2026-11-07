# Agent Note: `room/background-task` is registered before anything writes it

Status: implemented

## Problem

The member self-started rounds design (`proposals/active/2026-11-06-member-self-started-rounds.md`, outside the repo) needs one fact that belongs to no execution: a CLI member's background task lost contact, for example because the host restarted while a Kimi `bash-…` task was running (C②). No round is running at that moment, so `room/run-state` and `room/speech` cannot carry it, and `local-agent/execution` is an execution record. The design adds a new room event type for it.

The host's stored-log reader refuses a whole log when it meets an event type missing from its catalog (`KNOWN_SESSION_EVENT_TYPES`). If the registration and the first write shipped in one build, rolling that build back would leave rooms that the previous build cannot open. So, as with batch 5 S0 (`2026-11-04-local-agent-execution-event-registered`), the type is registered one release before any build writes it.

## Decision

Step M0 registers `room/background-task` and writes nothing. Step M6 is its first writer.

- **Registration site.** `ROOM_EVENT_TYPES` in `packages/room/src/journal.ts`. The existing loops in `packages/room/src/index.ts` (module load, and the loader-resolved catalog at apply) add every entry of that list, so no other code changes.
- **Shape.** `SessionEventMap['room/background-task']` is `RoomBackgroundTaskEvent` (`packages/room/src/types.ts`), exactly the design's C② shape: `member`, `memberId`, `taskId` (the CLI's own task id), `label`, `state: 'lost'`, `because` (`RoomBackgroundTaskLostBecause`: `host-restart | process-reclaimed | process-exited`, the B① `lostBecause` values), optional `startedByRunId`. Both types are exported from the package root.
- **Replay.** `replay` folds nothing from the event in M0; the room state with and without it is the same. M6 adds the timeline line and the dedupe per `taskId`.
- **Never remove this registration** once any build writes the event, and do not rename the type. Later steps may add optional fields or new `state` / `because` values only.

## Alternatives considered

- **Register and write in the same step (M6).** Rejected: a rollback would leave rooms that do not open.
- **Carry the fact on `room/run-state` or `room/speech`.** Rejected by the design: there is no run to attach it to after a restart.

## Consequences

- Rooms written by M6 and later builds stay readable on any build from this one on, including after a rollback of M6+.
- The type is permanent vocabulary. Deleting it later costs every room that carries it.

## Testing

`packages/room/tests/background-task-event.host.spec.ts`:
- the type is in `ROOM_EVENT_TYPES` and in the host catalog after module load;
- a room log carrying the fact (with and without `startedByRunId`) round-trips through the real jsonl persistence reader, and `replay` gives the same room state as the log without it;
- the same log is refused (`SessionFormatUnsupportedError`) once the registration is removed, while the log without the fact still loads. This is the control;
- at M0 no file under `packages/room/src` other than `journal.ts` and `types.ts` named the type. Since M6 the assertion is: the only writer is `background-lost.ts` and the only reader is `client/nodes.ts` (see [the lost-at-restart note](2026-11-07-room-background-task-lost-at-restart.md)).

`packages/room/tests/persistence.host.spec.ts` also appends the event in its round-trip, because that test requires every `ROOM_EVENT_TYPES` entry to come back from a reload.
