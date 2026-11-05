# Agent Note: Room and CLI-member sessions keep their running spinner across a browser reload

Status: implemented

English | [中文](2026-11-05-session-running-heartbeat.zh.md)

## Problem

[The 10-27 session-list status note](../feature/2026-10-27-session-list-status-for-delegations.md) makes room sessions and local-agent child sessions show 运行中 by emitting the host's `api-session/status` event on each 0→1 and 1→0 flip. Its known limitation is that after a browser reload or reconnect the status stays lost until the next flip. The host computes the list summary's `running` from host agents only (`deepseek-harness packages/api/session-controller/src/list.ts`), the status event is emit-only with no replay (`packages/api/remotes/src/remote-events.ts`), and the client re-baselines every row from the summary on reload, reconnect, and `api-session/added` (`packages/client/ui-session/src/client/index.ts`). So a room whose members work for ten minutes reads idle for those ten minutes once the page is refreshed. A later `true` event overrides the baseline (`observeRunning`), and this stopgap relies on that.

## Decision

STOPGAP(session-activity-contribution): replace with host activity lease when upstream lands. The tag marks every site in code.

- **local-agent, facade runs (`trackRun`)**: the existing per-run progress heartbeat (`RUN_PROGRESS_HEARTBEAT_MS`, 5 s) also re-emits `running: true` while the entry still belongs to this run.
- **local-agent, tool-registered runs (`trackDelegationRun`)**: each entry gets a new unref'd interval (`SESSION_STATUS_HEARTBEAT_MS`, 4 s) that re-emits `running: true`. It is cleared when the run's result settles, before the existing final `false`, and in the plugin's dispose effect.
- **room**: one global unref'd interval (`ROOM_STATUS_HEARTBEAT_MS`, 4 s) iterates `activeRuns` and re-emits `running: true` for each room with a member run. `observeActivity` starts it when `activeRuns` gains its first room and stops it when the last room empties. A dispose effect also stops it.
- **Stale-run guard (core ledger)**: since batch 5 S7 the member's execution ledger says whether an execution is in flight, so a leaked run cannot spin forever. On each room beat, an active run that carries an `executionId` and a `childSessionId` is checked against its member's ledger row (`readMemberInbox`). If the row is settled, uncertain, or absent, the run is dropped with a host warning ("dropped a stale active run"). If that empties the room, the room settles exactly as on a normal last end: one `false`, unless the room's own agent is running. Runs without an `executionId` (the room's own agent, pre-S5 runs), a core without the ledger read, and an unreadable ledger keep the plain re-announce. In local-agent, a tool-registered entry carries no execution id, so its beat uses a conservative rule: the entry is retired (timer cleared, one `false`, warning) only when the member's ledger is readable and non-empty, no row is queued or running, and the latest row settled or turned uncertain after the entry was registered.
- The 0→1 / 1→0 flip logic, the final `false`, and the agent-stop re-emit are unchanged. Re-emits go through try/catch, so a host without the channel falls back to the old behaviour. Nothing is emitted while no run is active.
- 4 s matches the client's existing pendingCards poll. The facade path keeps its 5 s beat instead of adding a second timer.

## Alternatives considered

- **Host activity lease** (upstream proposal `docs/upstream-proposals/2026-10-27-session-activity-contribution.md`): this is the right fix, because the summary itself would carry plugin-contributed activity. It needs a host change, so this stopgap fills in until it lands.
- **Client-side re-query after reload**: the client has no live-state source that a plugin can read, and this would mean patching official client code.
- **Per-run timers in room**: rejected in favour of one timer per process, because a room can have many concurrent member runs.

## Consequences

- After a reload or reconnect, a running room or CLI child gets its spinner back within one beat (at most 4 s, or 5 s for facade runs).
- Each active run or active room sends a small event to every connected client every few seconds. Idle processes send nothing.
- If a run's terminal `room/run-state` is never journaled, the ledger guard retires it within one beat of the core settling it. A legacy run without an `executionId` has no such check and keeps reasserting `running` until its edge arrives. If the core settles a row a few milliseconds before the room journals the terminal edge, a beat can land in between: it drops the run early with a warning that is harmless, and the late edge does not settle the room a second time.
- Tests: `packages/local-agent/tests/delegation-facade.spec.ts` (status heartbeat: tool-registered beat plus final false, facade beat, ledger-retired leak, live and bypass runs kept, idle silence, dispose) and `packages/room/tests/session-status.host.spec.ts` (status heartbeat: beat plus final false plus timer cleared, ledger-dropped leak settles once, live and legacy runs kept, idle silence, dispose).
