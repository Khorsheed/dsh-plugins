# Agent Note: Background tasks lost at a reclaim reach the room

Status: implemented

## Problem

A Kimi member's resident process is kept alive while its background tasks run, up to a 4 h cap (M3, [keep-alive for background tasks](2026-11-06-kimi-keepalive-background-tasks.md)). At the cap the process is reclaimed anyway. A reload, a model switch or a live-setting drain also retires the process while tasks may be running. The tasks lose contact either way (`lostBecause: 'process-reclaimed'`). [Background tasks lost at a host restart](2026-11-07-room-background-task-lost-at-restart.md) (M6) brought host-restart losses into the room: a timeline line, and a 「失去联系」 follow-up to the dispatcher. A reclaim loss showed only in the tray, so a member's promise to report quietly lapsed, the case the design's C① and C② set out to close (`proposals/active/2026-11-06-member-self-started-rounds.md`, outside the repo).

## Decision

- **Kimi reports at reclaim time** (`packages/local-agent-kimi/src/live-switch.ts`). The driver's existing `onReclaimedWithTasks` hook (M3) lands in `LiveDriverSwitch.noteReclaimed`. The switch first remembers the tasks, so any read from then on says `process-reclaimed`, then calls the core's `noteBackgroundTasksLost(child, taskIds, 'process-reclaimed')`. The call is duck-typed: an older core without the hook is skipped, and a throw is logged. Plugin unload (`disposeAll`) still reclaims with `noteTasks: false`, so it reports nothing; the next host start's scan reads those tasks as `host-restart`.
- **The core re-emits with the parent** (`LocalAgentRegistry.noteBackgroundTasksLost`). It resolves the member's parent session from the delegation record or the member binding, then emits the host bus event `localAgent/background-tasks-lost { childSessionId, parentSessionId, taskIds, because }` (declared in the core's cordis `Events`; type `LocalAgentBackgroundTasksLost`). An unknown member or an empty list emits nothing.
- **The room records it then** (`RoomService.recordReclaimedBackgroundTasks`, listening on the event). It runs only when the parent is a room (`loadCold`). It brings the room live through `ensureLive`, the same access opening the room or the M10/M6 startup load performs, so a cold room is loaded too. It then calls `recordLostBackgroundTasks(room, { reported })`, the M6 path:
  - Only that member is read. Its reported tasks count as lost with `process-reclaimed` whatever their file says by now: after a reload the new process may already be up while Kimi's file still says `running`.
  - Each task gets one `room/background-task { …, because: 'process-reclaimed' }`, deduped on the room log by `memberId` + `taskId`. The timeline line already had its wording: 「X 的后台任务「…」在进程被收回后失去联系 · 结果不会自动回来」.
  - When the starting delivery would report (the M5/M6 rule), the follow-up goes through the gate with the same key `background-task:<memberId>:<taskId>` and the reclaim wording 「后台任务「…」在进程被收回后失去联系，它可能已经结束，也可能还在跑；没有结果。需要的话请让 X 核对后重做。」 (`lostReportText(member, label, because)`). Human-dispatched work gets the line only.
  - A reclaim pass does not replace the room's once-per-process restart scan.
- **First access as a fallback.** `lostToRecord` now accepts `process-reclaimed` next to `host-restart`. A room's first live access in a process therefore also records a reclaim loss that the event missed, for example while the room plugin was reloading. The 24 h lookback and the dedupe are unchanged, so the same task is never written twice, even when the next host start reads it as `host-restart`.

## Alternatives considered

- **Poll the tray read for newly lost tasks.** Rejected by the brief and the design: the trigger is the reclaim, and nothing watches files while no process runs.
- **Have the Kimi plugin call the room directly.** Rejected. Providers know nothing of rooms. The core already owns member→parent and the room already probes the core, which keeps the companion → core direction.
- **A new room event type.** Rejected: `room/background-task` was registered for exactly this fact and already carries `because`.
- **Trust the task file's state at read time.** Rejected. After a reload the file can still say `running` while a fresh process is up, and `withKnownLoss` then reads it as running, so the room would miss the loss. The reported ids are the fact.

## Consequences

- A reclaim at the 4 h cap, a reload, a model switch or a live-setting drain with tasks running now shows the amber line in the room, and the dispatcher hears 「失去联系」 when the work was a member's. A host restart reads differently (「在宿主重启后失去联系」).
- A cold room is loaded and its agent resumed for the follow-up, the same cost as the M6 startup load.
- Error-path reclaims (a dead runtime, a failed spawn, an aborted round) that still had running tasks report too: their process is just as gone.
- Not verified on a real Kimi process. The trigger path is covered by unit tests on the switch, the core and the room.

## Testing

- `packages/local-agent-kimi/tests/live-switch.spec.ts`: the switch remembers the tasks before telling the core (a read inside the report already says reclaimed). An older core without the hook, or a throwing one, still keeps the tray fact.
- `packages/local-agent/tests/delegation-facade.spec.ts`: `noteBackgroundTasksLost` emits with the parent, and an unknown member or an empty list emits nothing.
- `packages/room/tests/dispatch.host.spec.ts`:
  - A reclaim of member-dispatched work, where the file still says `running`, writes one fact (`process-reclaimed`) and one follow-up with the reclaim wording, reading only that member.
  - The same report again, and a later host-restart scan of the same task, write nothing more.
  - Human-dispatched work gets the fact only, and a parent that is not a room is never read.
  - The M6 restart case no longer lists a reclaimed task as "not this restart's news".
