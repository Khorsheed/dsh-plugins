# Agent Note: Auto-continue judges the round's start, not its edge

Status: implemented

## Problem

After a host restart the room continues the rounds that restart cut off, once and on its own ([the room continues members a restart interrupted](../feature/2026-11-06-room-auto-continue-after-restart.md), M9). The 2026-11-06 hotfix limited this to rounds THIS restart cut off. Its test was when the room's journal got the round's interruption edge: an edge written before this process's room service started (`RestartFacts.bootedAt`) is an earlier restart's. The core's startup candidates ([restart initiator and startup room load](../feature/2026-11-06-restart-initiator-and-startup-room-load.md), M10) used the same kind of fact: a row is this restart's when this process converted it from `running`.

Both facts record when something got written down, not when the restart happened. The edge is written by whichever process first recovers the room. If no process loaded the room after the restart that cut the round off, the next process to load it writes a fresh edge, and the round reads as that process's restart. The M9 note listed this as a known residual. Two tests in `packages/room/tests/real-core.host.spec.ts` reproduce it on the real core, with synthetic room logs and member ledgers:

1. **The core converted the row, but the room never recovered.** Restart 1 cuts ada's round off while the room's 重启后自动继续 setting is off. The startup load reads the room cold, which loads ada's ledger, so the core row turns `uncertain`. The room is not loaded, so its journal still says `running`. The setting is turned back on, then restart 2 happens with nothing running. When someone opens the room in process 3, recovery writes the `uncertain` edge now, at or after `bootedAt`, and the room auto-continues a round restart 1 cut off. The same happens whenever process 2 had any reason not to load the room: a guard held, the restart was self-triggered, the build predates the startup load, or the process died within the 5 s delay. A self-triggered round is the worst case, since the guard exists to stop exactly that round being continued.
2. **Nobody loaded the ledger either.** Process 2 never reads ada's ledger, for example because it went down before anything touched it. In process 3 the ledger file still says `running`, so the core converts it now and names the room as a startup candidate. The room loads, writes a fresh edge and continues.

Before the fix, both tests failed (an `auto-continue` dispatch appeared, and the core named the room as a candidate).

## Decision

- **A durable host-process record** (`packages/local-agent/src/host-process.ts`, file `<homesRoot>/.host-process.json`). When the core starts, it reads the record. If the record names another process as current, it rotates: that process becomes `previous` and this one becomes `current`. A process is its pid plus its start time (`performance.timeOrigin`), so a plugin reload inside the same process leaves the record unchanged. `LocalAgentRegistry.hostProcesses()` returns `{ current, previous? }`.
- **The rule.** A round that started before the previous host process started was already cut off by that process's start. It is never the latest restart's, however late its interruption is written down. No date cutoff is involved: the comparison is between the round's own start and the previous process's start.
- **Room** (`restart-continue.ts`). `RestartFacts.previousProcessStartedAt` is projected in `engine.view` (`previousHostProcessStart`, a duck-typed probe of `hostProcesses`). A round whose run `startedAt` is earlier is `stale`, in addition to the M9 edge test. Stale rounds behave as before: the room never continues them on its own, and they stay in the human's 「全部继续」 banner without a reason. The rule covers CLI members and the room's own agent alike, because it uses the room's run start.
- **Core** (`member-inbox.ts`). A `running` row whose `admittedAt` (else `createdAt`) is earlier than the previous process's start is still converted to `uncertain` on load, since it still blocks admission until reconciled. It is no longer counted as cut off by this boot. `interruptedMembers()`, both the unloaded-file path and the converted-row path, therefore leaves it out, and the startup load never loads a room for it.
- **Without evidence nothing changes.** On the first boot with the record (no `previous`), without the local-agent core, or with a core that lacks `hostProcesses`, the old rules apply unchanged.

## Alternatives considered

- **Stamp each ledger row with the process that admitted it.** Rejected. It tells which process admitted a row, but whether that process was the one just before this one still needs a record of the process sequence. The room's own-agent rounds have no ledger row either.
- **Use ankh-guard's `last-restart.json`.** Rejected. Only guard-driven restarts write it, and a plain stop/start or a crash leaves no record. The room already treats the guard as optional.
- **A date cutoff (ignore rounds older than N hours).** Rejected by the brief, and it is wrong in both directions: a short-lived process 2 makes a recent round stale, and a long-running process makes an old round fresh.
- **Persist the record in the room.** Rejected. The room has no storage of its own. The core already owns the ledgers this decision is about and has a homes root to write to.
- **Treat every core plugin start as a boot.** Rejected. A core reload in the middle of a process's life would make every round started before the reload look stale at the next real restart. Keying on pid plus process start keeps the record per process.

## Consequences

- A round started before the previous process is never auto-continued and never makes the room a startup candidate. The human still sees it in the banner and can press 「全部继续」.
- The first host start after this ships has no `previous` record, so the old rules apply once. From the second start on, the rule holds.
- If the core plugin reloads mid-process while a member round runs, the new core still converts the row on load, and the row counts as this boot's only if it started after the previous process. This matches the M9 behaviour for the same case.
- Clock steps (NTP corrections) between processes could misjudge a round that started within the step. A wrong verdict only moves a round between "auto" and "banner"; it never loses one.

## Testing

- `packages/room/tests/real-core.host.spec.ts`: the two reproductions above (each failed before the fix). The crash helper now also starts a "new host process" by moving `performance.timeOrigin`, and the existing M9/M10 real-core cases still pass under it.
- `packages/room/tests/restart-continue.client.spec.tsx`: a round started before `previousProcessStartedAt` is stale even with a fresh edge. Without the fact, the edge rule alone applies.
- `packages/local-agent/tests/host-process.spec.ts`: rotation, a reload keeps the record, an unreadable record or failed write, and the comparison without evidence.
- `packages/local-agent/tests/member-inbox.spec.ts`: a `running` row admitted before the previous process is not listed, whether loaded or not. The same row started inside the previous process is listed.
- `packages/local-agent/tests/delegation-facade.spec.ts`: `hostProcesses()` on the first boot.
