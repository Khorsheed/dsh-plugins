# Agent Note: Kimi keeps a resident process while its background tasks run

Status: implemented

## Problem

Step M3 of the design `proposals/active/2026-11-06-member-self-started-rounds.md` (gitignored). A Kimi member's resident `kimi acp` process ran background tasks, and the live driver still reclaimed it after its 30-minute idle lifetime (`DEFAULT_LIVE_IDLE_MS`). Reclaiming the process cuts its tasks off. Kimi's task files keep saying `running`, and the result never comes back. A reload (重新载入) or a model switch replaces the process the same way, with no warning. The core types step (`2026-11-06-member-activity-core-types`) left `keepAliveUntil` unfilled for this step.

User decision on 2026-11-06: the keep-alive cap is 4 hours from the member's last activity.

## Decision

**Idle check** (`packages/local-agent-kimi/src/live-driver.ts`). When the idle timer fires, the driver first reads the member's background work: the ids of Kimi's running tasks (`readKimiBackgroundTasks`), and whether a turn kimi opened itself is still open on the wire (`findOpenSelfTurn` since the process spawned).

- No work: the runtime is reclaimed, as before.
- Work running: the runtime is kept, and the check runs again after `min(idle lifetime, time left to the cap)`.
- The cap is `DEFAULT_LIVE_KEEPALIVE_CAP_MS` (4 h), counted from the last activity. Activity is a round or preparation ending, a change in the set of running task ids, or an open self turn. At the cap the runtime is reclaimed as usual, with a warning.
- Work that has just ended gets one more full idle lifetime from the look that noticed it, then the normal reclaim.
- A round starting during the asynchronous read wins: the check stops when its timer is no longer the member's timer.

`config.keepAliveCapMs` and `config.backgroundWork` exist for tests. Production uses the default and the file read.

**`process-reclaimed`.** Every reclaim except plugin unload (`disposeAll`) reads the running task ids first and reports them through `config.onReclaimedWithTasks`. That covers the idle cap, reload, `retireRuntime` (model switch), the `ensureRuntime` model mismatch, and a settings drain. `LiveDriverSwitch` keeps the record per member across driver generations, in memory only. After a host restart every running task reads as `host-restart` (step M6). The Kimi `backgroundTasks` read (`index.ts`) reports a recorded task as `state: 'lost'`, `lostBecause: 'process-reclaimed'` in two cases: its file still says `running` and no process is alive, or Kimi itself already rewrote it to `lost`. Unrecorded `running`-without-process tasks are left as they are; the rest of the lost judgment (host start scan, `process-exited`) is M6.

**`keepAliveUntil`.** The same read hands the running ids to the driver hosting the member (`observeBackgroundTasks`). A change counts as activity there. The read fills `keepAliveUntil` (last activity + cap) when a resident process is alive and something runs. That is the tray's 「进程最晚保留到 HH:MM」.

**Self-heal deferral.** `retireIfToolsStale` (round-start respawn when the process lacks its mode tools) keeps the process while background tasks run, logs a warning, and looks again at the next round start.

**Reload confirmation** (core, the smallest change that lets the room ask). The design asks the 重新载入 action to confirm 「会让 N 项后台工作失去联系」 first.

- `registry.reloadMemberTools(childSessionId, options?)` and the gateway Remote `reloadMemberTools(childSessionId, options?)` take `LocalAgentMemberToolsReloadOptions { confirmBackgroundTasks?: boolean }`.
- Without the confirmation, a member whose live process runs background tasks gets `{ ok: false, reason: 'background-tasks', running: N }`, and nothing is done.
- `running` counts `state: 'running'` tasks from `memberBackgroundTasks`, only when `supported` and `processAlive`.
- The room asks again with `{ confirmBackgroundTasks: true }`.
- A harness without `backgroundTasks` is never refused. Starting a member that has no process (立即载入) is never refused, because no process means nothing to cut off.

**Model switch.** Saving a model goes through the member configuration controller (`apply` → `retireMemberRuntime`), not through reload. The driver does not refuse it, because refusing would leave the saved selection and the process out of step. The room's confirmation for that action reads the existing `memberBackgroundTasks` Remote before it saves: running tasks while `processAlive`. The driver records the cut-off tasks as `process-reclaimed`.

## Alternatives considered

**Refuse inside the driver's `reloadMember`.** The harness hook returns synchronously, but reading task files is asynchronous. A cached count could be stale. Changing the hook's return shape would also break an older core, which would read a refusal object as a handle. The core check reuses the harness `backgroundTasks` read that already exists, so it works for any future harness.

**Poll the task files between idle checks.** That is the B② watcher (step M4), which turns on only while work runs. Keep-alive only needs a look when the idle lifetime runs out, plus whatever the tray reads.

**Persist the reclaimed record.** After a restart the design says every running task is `host-restart`. A persisted `process-reclaimed` would compete with that rule and buy nothing.

## Consequences

- **Until room step M2 sends the confirmation, 重新载入 on a member with running background tasks is refused.** The current `MemberToolsLine` has no text for `background-tasks`, so the click does nothing visible. Deploy M3 together with M2, or after it.
- A model that starts a background task that never ends (`tail -f`, a dev server) holds its process for at most 4 hours past the last activity.
- Plugin unload still kills everything without recording anything; the next start reads it as `host-restart`.
- An older core with this Kimi package never passes the option and never refuses. Reloads behave as before, and only the idle keep-alive and the record apply.

## Testing

- `packages/local-agent-kimi/tests/live-driver.spec.ts`, block "background tasks keep the resident process (keep-alive)", using a fake clock:
  - tasks running → the process outlives the idle lifetime, and `observeBackgroundTasks` answers a deadline within the cap
  - the cap reached → reclaimed, with `bash-1` reported
  - a new task → the cap restarts
  - an open self turn → kept
  - tasks end → one more idle lifetime, then reclaimed with nothing recorded
  - no work → reclaimed at the idle lifetime
  - reload with tasks → recorded, and unload records nothing
  - the default file read → a `running` task file keeps the process, and a `completed` one lets it go
- `packages/local-agent/tests/member-tools-status.spec.ts`: two running tasks → refused with `running: 2` and no reload; confirmed → reloaded; a dead process → not refused.
