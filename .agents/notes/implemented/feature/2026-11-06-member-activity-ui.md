# Agent Note: Member background activity: the room's tray, members line and session card

Status: implemented

## Problem

Step M2 of the design `2026-11-06-member-self-started-rounds.md` (under `proposals/active/`, not in the repository). The user decided on 2026-11-06 to take every recommendation. A Kimi member can run a command in the background and end its round. The room showed none of that: no count, no list, and nothing in the member's own session. The core read for it landed in M1 (`memberBackgroundTasks`, see `2026-11-06-member-activity-core-types`), but nothing called it.

The UI source of truth is the prototype `proposals/prototypes/member-activity.html`. This step covers its states 1–3 (capsule, tray, lost), 8–9 and 15 (background command card, expanded, lost), 16 (unsupported member) and the members page line.

## Decision

**One pure state module**, `packages/room/src/client/member-activity-view.ts`. Background commands and, later, background subagents share it.

- The five statuses are 运行中, 完成, 失败, 失去联系 and 已取消. Kimi's `timed-out` reads as 失败 (超时 on the pill), and `stopped` reads as 已取消.
- `activityGroups` builds the tray: one group per member in roster order, each with its tasks and its keep-alive time. The keep-alive time only shows while the process is up.
- `activityStrip` gives the capsule. It counts running tasks, and any lost task turns it amber. Tasks that ended recently do not raise it on their own.
- `memberActivityLine` gives the members page line. It counts running commands and running background subagents, or shows the lost count.
- `sessionActivityItems` gives a turn's command cards.
- `dispatcherOf` names who started a task only from the room's own records. It follows the task's `startedBy` execution to the room's execution record, then to that delivery, then to 你 or the sending member. A missing link means no name.
- A harness that answers `supported: false`, a session that is not a member, and a failed or missing read all show nothing. The room never shows 「0」.

**Components** (`MemberActivity.tsx`):

- `ActivityCapsule` sits in the task-capsule row as 「◔ 后台 N」, or amber 「⚠ 后台 · N 失去联系」.
- `ActivityTray` opens above the row. Each item shows its status pill, elapsed time, who started it, and for a lost task what we know. Each item has one jump: 查看输出, 打开, 查看 or 去看. The tray only jumps; it never stops or reruns anything.
- `MemberActivityLine` is the members page line. It sits on the member card under the head, never in the dialog preview.
- `ActivityCardShell` is the shared card shell: icon, type, description, status and elapsed time, actions, an optional one-line `now`, and the expanded body. `CommandCard` is the background command's use of it. Its line shows the last output. Expanded, it shows the command, the last output lines, the start time, who started it and the keep-alive time. Once the task has ended, the exit code replaces the elapsed time.

**Data and polling.**

- `MemberActivityStore` is created once in the room client. It reads local-agent's `memberBackgroundTasks` through the same duck-typed gateway probe as the other family reads.
- Each member session is polled on the room's existing 4 s cadence, and only while a surface shows that member. The surfaces are the composer, the members tab, and a turn tail that has a `Bash` call.
- A read answering null or `supported: false` stops that member's poll. Without the family or the read, nothing renders and nothing is polled over the wire.
- No host restart and no new event type is involved.

**Where the session card sits.** The card goes in `conversation.chat.turnTail` of the turn that issued the call, not in place of the tool row.

- A small Conversation Definition (`room/activity-calls`) keeps each turn's `Bash` call ids as Turn data.
- The tail entry matches them against the task's `callId`.
- The tray's jump opens the member session. An `ActivityReveals` hand-off lets the named card scroll itself into view and, for 查看输出/查看, open its body.

**Core additions (optional fields only).** `LocalAgentBackgroundTask` gains `callId?` and `outputTail?`.

- The Kimi reader already resolved the call id for `startedBy`; it now also returns it.
- It reads at most the last 4 KiB of the task's own `tasks/<id>/output.log` and keeps the last 6 non-empty lines. A cut first line is dropped, and for carriage-return redraws only the last frame is kept.
- `live-driver.ts` is untouched.

## Alternatives considered

**Replace the `Bash` tool row (`tool.call.toolview`, key `Bash`).** This would put the card exactly at the call. The slot is keyed by tool name, though. Taking `Bash` would also take every foreground Bash row of every Kimi and Claude Code member, and the host's generic row cannot be delegated to. A finished turn also folds its tool rows, so a card inside the fold would be hidden just when it matters. The turn tail keeps the card visible under the reply that launched the command.

**A separate Remote for the output.** A second `memberBackgroundTaskOutput` call per expanded card would add a seam for a few lines of text. A bounded tail on the listing costs one small read per task per poll, and only while a surface follows that member.

**Put the line on the team graph (TeamView).** In the prototype, the line sits on the members page row: avatar, name, role, provider and status. That row is `MemberCard` in the members tab. The edit dialog and the card's configuration stay as they are.

## Consequences

- Deviations from the prototype:
  - The card sits in the launching turn's tail, not on the tool row. While that turn is still running, no card shows; it appears once the turn ends.
  - 去看 opens the member session at the task's card, not at "the reply that took its result". The room does not show self-started rounds until M5, so 「结果在 HH:MM 那条回复」 only appears when the room has a record of that execution.
  - Background subagents appear in the tray and in the counts, but they have no session card yet. That card belongs to the CLI-subagent design and reuses `ActivityCardShell`.
  - The tray has a close button (×) in its header.
- The dispatcher name and the keep-alive time rely on facts that M3/M5 fill in (`keepAliveUntil`, `resultIn` mapped to a room execution). Until then those parts simply do not show.
- A member session opened directly from a link only names the dispatcher once its room has been pulled into the room store (`RoomStore.memberRoom`).
- The chat list may not mount a card that is far up in a long session. In that case the jump just opens the session.

## Testing

- `packages/room/tests/member-activity.client.spec.tsx` (26 cases) covers:
  - the state mapping, and unsupported, null and unread reads hiding everything;
  - capsule running and lost, and no capsule when idle or unsupported;
  - grouping and the keep-alive time;
  - the dispatcher chain;
  - members line counts, lost, hidden, and English;
  - elapsed time and duration parts, and the one jump per item;
  - the tray (running, ended, and lost wording that never says 已终止), and the capsule row opening and closing the tray;
  - the command card running, expanded, ended with an exit code, lost, and revealed from the tray;
  - the Turn-data definition and the tail, including that an unsupported member gets no card and a turn without `Bash` never reads;
  - the store's 4 s poll, unsubscribe, and stopping on an unsupported or non-member read.
- `packages/local-agent-kimi/tests/background-tasks.spec.ts` covers `callId` (from the state file and from the wire) and the output tail (last lines, progress redraws, a cut first line, empty file, no tail for agent tasks).
- The preview page `packages/room/tests/preview/activity.html?state=<strip|tray|lost|cmdrun|cmdout|cmdlost|unsupported|members>` renders the real components over scripted reads. It was screenshotted at 1280 and 390, light and dark, and compared with the prototype.
