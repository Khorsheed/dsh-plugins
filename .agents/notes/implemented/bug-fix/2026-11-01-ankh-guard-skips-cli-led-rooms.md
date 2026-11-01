# Agent Note: ankh-guard does not wake a room led by an external member

Status: implemented

## Problem

After an unplanned recovery, ankh-guard queues its restart report as a followup turn for the first root agent created, and it queues a "continue" followup for every session whose turn the restart interrupted. On 2026-11-01 the first session opened after a crash was a collaboration room whose coordinator was a kimi command-line member. The room plugin refuses every host turn it did not dispatch itself (`Use the room input route for this coordinator; this input cannot be forwarded losslessly`), so the report became a failed host turn with zero requests and no user message. Context Lens then opened on that empty failed turn, because it was the session's latest turn. The report itself was lost, because the record had already been acknowledged.

## Decision

- **A room whose current coordinator is a `cli` member gets neither the report nor the continue.** `isExternalCoordinatorRoom(events)` (src/restart-context.ts) reads the room's own durable events: `room/created`, the `room/member-added` kinds keyed by `id ?? legacy:<seq>`, and the last `room/coordinator`. A room that never changed coordinator is led by the main agent and is not skipped.
- **`deliver` probes the live session synchronously** through `agent.session.snapshotEvents()`, the same face the room plugin gates on. A host without it, or any failure, delivers as before (fail open).
- **The skipped report stays pending**, so the next ordinary root session claims it.
- **The resume pass does not recreate such a room at all.** It uses the same probe over the cold log, next to the parked-on-user-input check. The room continues its interrupted member runs through its own design.

## Alternatives considered

- **Route the report through the room input path.** Rejected: that would speak to the external coordinator in the human's name, and it would make ankh-guard depend on the room plugin.
- **Skip every room session.** Rejected: a room the main agent still leads takes host turns normally and should keep receiving the report and the continue.

## Consequences

- If the restart's initiator is itself such a room, its report waits until the next restart replaces the record. This was accepted as rarer and harmless.
- The self-process lane's inventory grows by 3 (71 → 74).
