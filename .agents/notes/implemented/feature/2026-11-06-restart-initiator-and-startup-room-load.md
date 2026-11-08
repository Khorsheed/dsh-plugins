# Agent Note: The restart names its member, and rooms nobody opens continue

Status: implemented

## Problem

Step M9 ([the room continues members a restart interrupted](2026-11-06-room-auto-continue-after-restart.md)) left two gaps. Both belong to step M10 of the member self-started rounds design (`proposals/active/2026-11-06-member-self-started-rounds.md`, outside the repo, section E).

- The room must not auto-continue the round that asked for the restart. M9 probes `selfRestartGuard.lastRestart()?.initiatorMember`, but no guard had that read. So every restart counted as "not self-triggered".
- The auto-continue pass runs on a room's live access. A room nobody opens after a restart never continues. User decision 7 (2026-11-06) chose to load such rooms after the host starts.

## Decision

- **ankh-guard records the member** (`packages/ankh-guard`).
  - `RestartRecord.initiatorMember?: string` is the member's dsh child session id. It is read from `DSH_LOCAL_AGENT_MEMBER` in the process that schedules the restart. That variable is set by the local-agent core on every member CLI process ([member self-deploy guard](2026-11-06-member-self-deploy-guard.md)). The guard names it by string (`LOCAL_AGENT_MEMBER_ENV`, `initiatorMemberFromEnv`) and does not import local-agent.
  - `schedule-exit` writes it into the restart marker. It also passes it to the exit agent as `WD_INITIATOR_MEMBER`, and the exit agent writes it into `last-restart.json`.
  - The `restart` verb's outcome record carries it. A composition-recovery record inherits it from the bare exit record it merges over, as it already did for `initiator`.
  - The field is optional. Old records read fine without it.
- **The read** is `SelfRestartGuard.lastRestart(): LastRestart | null`, where `LastRestart = Readonly<RestartRecord>`.
  - It is synchronous and reads `last-restart.json`, whether the report was delivered (`reportedAt`) or not.
  - It returns null when the file is missing or unreadable, or when the record has no `exitAt` (the exit agent found no listener, so nothing restarted).
  - It also returns null when `exitAt` lies more than `resumeMaxSnapshotAgeMs` (default 10 minutes) before this process booted. Such a record belongs to an earlier boot: a plain stop/start writes no record over it.
  - The shape matches M9's probe exactly, so `packages/room/src/dispatch.ts` `restartInitiatorMember` is unchanged.
- **The startup load** (`packages/room/src/startup-load.ts`, `RoomService.loadInterruptedRooms`).
  - The local-agent core answers which rooms to look at. `MemberInbox.interruptedMembers()` lists only members **the restart that started this process** cut off. A ledger file not loaded since the restart counts when a row still reads `running`. A loaded ledger counts when it holds an unreconciled row that this process itself converted from `running` to `uncertain` on load (tracked per member). A row that was already `uncertain` on disk is an older restart's leftover and never counts, and so is a row admitted before the previous host process started, whether still `running` on disk or converted now ([the host-process record](../bug-fix/2026-11-08-auto-continue-round-start-vs-previous-process.md)). On prod, auto-continue once resumed rounds interrupted weeks earlier (10-23 and 10-26), so the startup load must never load a room for stale rounds. The read is read-only: nothing is loaded, converted or saved, and unreadable or stray files are skipped.
  - `LocalAgentRegistry.interruptedMemberParents()` maps those members to their parent session ids through `memberBinding`. A member whose provider is not registered is left out.
  - 5 seconds after the room service starts (`STARTUP_ROOM_LOAD_DELAY_MS`), the room asks for those parents. It reads each one cold, as `getState` does. It loads a parent only when it is a room and `autoContinueRounds(engine.view(...))` is not empty. That is the same rule a live access applies, so the setting being off, a paused room, a paused member queue, a self-triggered restart and an already-continued round all leave the room unloaded.
  - Loading is `ensureLive`, the live access opening the room would do: recovery, then the M9 auto-continue pass.
  - At most 2 rooms load at once (`STARTUP_ROOM_LOAD_CONCURRENCY`). Each parent is visited once. A failure is logged and skipped. The walk stops when the plugin is disposed. With no core read, or nothing interrupted, nothing happens. No model is called outside the visible auto-continue round itself.
- **The 「队列暂停」 guard means typed input is waiting** (`packages/room/src/core-ledger.ts` `CoreLedgers.paused`). When the core loads a ledger after a restart, it pauses every ledger that holds an uncertain row (`member-inbox.ts` `load`). M9 read the bare flag, so on a real core every interrupted member read `queue-paused`, and the room never continued anyone. The fake core in M9's tests did not pause, which hid this; the real-core test here exposed it. The guard now holds only when the queue is paused **and** a queued composer row is waiting. Those are the only rows the core holds back while paused; room rows still run. The existing real-core reconcile test turns the setting off, since manual reconciliation is what it tests.
- **An ownerless restart report does not go to a room** (`packages/ankh-guard/src/index.ts` `deliver`). A record with no `initiator` used to go to the first root agent created. The startup load can now create a room's agent with nobody watching, and that would have started a room turn nobody asked for. Room sessions (log has `room/created`) are therefore skipped for ownerless records. The next ordinary session reports instead. A record whose `initiator` is the room still goes there.

## Alternatives considered

- **A boolean `selfTriggered()` on the guard.** Rejected. M9 already ships the `lastRestart()` probe, and the whole record is useful beyond the room.
- **`lastRestart()` returns the last record regardless of age.** Rejected. After a manual stop/start, or a crash where a pending record was kept, an old member initiator would hold that member back on every later boot. The window is the same as the interrupted-session snapshot's.
- **The room enumerates all sessions to find rooms.** Rejected: this costs a persistence scan per boot. The core's ledger directory already holds exactly the members that matter, and each ledger entry knows its parent.
- **Load every parent with an interrupted member.** Rejected. A room with the setting off, or whose round is blocked by a guard, would pay a room-agent resume on every boot for nothing. The cold projection decides first.
- **Do it in local-agent**, since the core owns the ledger. Rejected because the core cannot load a room or judge the room's setting and guards. The core gives the list; the room decides and loads.

## Consequences

- After a restart, a room with an interrupted member continues within about 5 seconds of the host coming up, without anyone opening it, under the same rules and with the same visible rows as M9.
- A member that runs `dsh-ankh-guard schedule-exit` (or `restart`) itself is not auto-continued after that restart. Its room shows 「这次重启是它这一轮发起的」 and waits for the human. The deploy script already refuses restarts from members (M7). This covers a member that calls the guard directly.
- An ownerless crash-recovery report is never claimed by a room session, including a room a human opens. It waits for the next non-room session. This is the price of loading rooms unattended.
- The startup load does not wait for ankh-guard's cutover canary. It runs after a fixed delay, which is the same exposure a human opening the room during the canary already has.

## Testing

- `packages/ankh-guard/tests/self-restart-guard.spec.ts`:
  - `schedule-exit` inside a member writes `initiatorMember` to the marker.
  - `performExit` writes it next to `initiator`; an empty value writes nothing.
  - `initiatorMemberFromEnv` handles set, blank and absent values.
  - The `restart` verb outcome and a composition recovery keep the field.
  - `lastRestart()` returns a reported record, an old record without the field, null for an earlier boot's record, null for an error-only record, and null for an unreadable file.
  - An ownerless record skips a room agent, goes to the next ordinary session, and still reaches a room that is its initiator.
- `packages/local-agent/tests/member-inbox.spec.ts`: `interruptedMembers` before and after a crash leaves files byte-identical, lists a row this boot converted once, drops it once reconciled, skips corrupt or stray files, and returns nothing without a directory. The leftover of an earlier restart, read from disk or loaded, is not listed.
- `packages/local-agent/tests/delegation-facade.spec.ts`: `interruptedMemberParents` lists distinct parents for ledgers still `running` on disk. Stale `uncertain`, settled and unknown members are left out.
- `packages/room/tests/real-core.host.spec.ts`: on the real core, a crash leaves the delivery uncertain and the ledger paused. `interruptedMemberParents` names the room, the startup load brings it live, and the room continues once. Later passes do nothing more, and the core's row is cancelled.
- `packages/room/tests/real-core.host.spec.ts`: a room whose only interrupted round is an older restart's leftover is not loaded at start. Restart 1 happens with the setting off; the setting is turned back on; restart 2 happens with nothing running. The core names no room, and nothing is loaded or continued.
- `packages/room/tests/dispatch.host.spec.ts`: the M9 `queue-paused` case now waits behind a queued composer row.
- `packages/room/tests/dispatch.host.spec.ts`, block "rooms nobody opens are loaded once at host start (M10)":
  - The room is found through the core and loaded once; duplicates and non-sessions are skipped. The room continues once, and a second pass loads nothing.
  - Setting off, or a paused room: not loaded.
  - The guard naming the member: not loaded.
  - No interrupted members, no core read, or a throwing read: no-op.
  - `loadEach` visits each candidate once, keeps at most 2 in flight, reports failures, and stops when disposed.
