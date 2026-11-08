# Agent Note: a background task a host restart lost is said to be lost, and the dispatcher hears about it

Status: implemented

## Problem

When the host restarts, it kills every Kimi member's resident process. Any background task that process was running loses its process, and nobody will ever report its result. Kimi's own `tasks/<id>.json` keeps saying `running` until a later process loads the session. Before this change the room said nothing. The member's promise ("完成后我会继续汇报") quietly lapsed, and the dispatcher kept waiting. This is C② of `proposals/active/2026-11-06-member-self-started-rounds.md` (outside the repo). Step M0 registered `room/background-task` for this fact (see [the registration note](2026-11-06-room-background-task-event-registered.md)). M6 is its first writer.

## Decision

- **Kimi says what it knows** (`withKnownLoss`, `packages/local-agent-kimi/src/background-tasks.ts`). A task that started before this host process's Kimi plugin started reads as `lost` with `lostBecause: 'host-restart'`. That covers both a file still saying `running` and a file a later load rewrote to `lost`. A task our own generation reclaimed keeps `process-reclaimed`, as in M3. Nothing else is judged: there is no pid probe, and a running file with no process and no fact of ours stays as Kimi wrote it. Every tray read and the startup scan go through the same rule.
- **Core startup scan** (`LocalAgentRegistry.lostBackgroundTaskParents(since)`). It walks the delegation records whose harness has `backgroundTasks`, reads each member's task state with the member-log lookups skipped (`memberBackgroundTasks(child, { lookups: false })`), and returns the parents that have a `host-restart` loss started at or after `since`. It only reads files: no CLI process is started and no model is called.
- **Room, hooked into the M10 startup path.** `loadInterruptedRooms` loads the rooms the core names next to the interrupted ones, then calls `recordLostBackgroundTasks(room, { force: true })`. Any live access also scans a room once per host process (`scanLostOnce` in `ensureLive`), which covers a room opened before the startup pass. For each CLI member, each task that is `lost` with `host-restart` (or `process-reclaimed`, see the reclaim note linked under Consequences), started within `LOST_TASK_LOOKBACK_MS` (24 h) of this process's start, and not yet on the room's log (dedupe on `memberId` + `taskId`) gets one `room/background-task { member, memberId, taskId, label, state: 'lost', because, startedByRunId? }` (`because` = the task's `lostBecause`). The reads happen first; the dedupe check and the appends then run synchronously, so concurrent passes cannot write a task twice.
- **Timeline.** The room-event node claims the fact as `sub: 'background-lost'`. It renders one amber line between dashed rules: 「⚠ X 的后台任务「…」在宿主重启后失去联系 · 结果不会自动回来」.
- **Follow-up.** When the delivery behind `startedByRunId` would report (the M5 rule: `followUpDelivery` + `followUpRecipient`), the room sends a follow-up through the report gate. The key is `reportFor = background-task:<memberId>:<taskId>`, with `followUpOf` set to the delivery, outcome `uncertain`, and the fixed text 「后台任务「…」在宿主重启后失去联系，它可能已经结束，也可能还在跑；没有结果。需要的话请让 X 核对后重做。」. The envelope reads 「#mN 的后续回报 · 来自 X · 失去联系」, without the "user already saw this" suffix, because the human never saw a reply. The recipient's reply shows 「⚠ 收到 X 的后续回报 · 失去联系」 in amber. Human-dispatched work gets the timeline line only.

## Alternatives considered

- **Probe the task's pid.** Rejected: pids are reused, and the design only ever says "失去联系".
- **Write every lost task Kimi lists.** Rejected: a task file from weeks ago that still says `running` would wake dispatchers with stale news on the first boot after this ships. The 24 h lookback is a policy in the room; the `host-restart` reason itself stays a fact in Kimi.
- **A new local-agent event or a room projection field.** Rejected: the event was registered for exactly this purpose, and `replay` still folds nothing from it.

## Consequences

- A plugin reload, not only a host restart, also reads earlier tasks as `host-restart`. Either way the process is gone.
- A task lost to `process-reclaimed` (M3's 4 h cap, a reload, a model switch) is written to the room and followed up the same way, at the moment the process is reclaimed: see [background tasks lost at a reclaim reach the room](2026-11-08-room-background-task-lost-at-reclaim.md).
- A task started more than 24 h before the restart is not reported.

## Testing

- `packages/local-agent-kimi/tests/background-tasks.spec.ts`: `withKnownLoss`, covering host-restart for `running` and `lost` files whether or not a process is up, reclaimed vs. not, a running task of this process left alone, and ended tasks untouched.
- `packages/local-agent/tests/execution-read.spec.ts`: `lostBackgroundTaskParents` returns only parents with a `host-restart` loss since the cutoff, stops reading a parent once one member qualifies, and makes no member-log lookups.
- `packages/room/tests/dispatch.host.spec.ts`: a member-dispatched task produces one fact and one 「失去联系」 follow-up to ada with the fixed text, while reclaimed, ancient and running tasks are ignored, and a second pass writes nothing. A human-dispatched task produces the fact only. The startup load asks with `since = bootedAt − 24 h` and records.
- `packages/room/tests/nodes.client.spec.tsx`: the node and the amber line. `packages/room/tests/background-task-event.host.spec.ts`: only `background-lost.ts` writes the type, and only `client/nodes.ts` reads it.
- Preview: `packages/room/tests/preview/self-round.html?state=lost`.
