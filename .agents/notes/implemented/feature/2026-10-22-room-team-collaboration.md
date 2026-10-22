# Agent Note: Room team collaboration — lean member prompts and honest removal

Status: implemented

## Problem

Room member prompts were one user message that stacked everything: role instructions, the goal on every dispatch, and the full roster again whenever anyone joined, renamed or edited a role. The roster used the first line of each other member's instructions as their "role"; coordinator-written instructions are usually one paragraph, so a member read other members' complete briefings ("when asked to say hello, …") as if they were addressed to it. The roster also taught a trailing `@name <content>` line protocol "pending owner confirmation" while every provider already carried the `member_message` bridge tool. Separately, removing a member used the browser's native `confirm` and claimed "its run will be interrupted" while `removeMember` only journaled `room/member-removed`: a running member kept running, queued work stayed queued, and a coordinator waiting for its report waited forever.

## Decision

Delivered in steps against the plan the owner approved on 2026-10-22 (presets and permissions follow in a later commit of the same line).

**Prompt slimming.** A member's FIRST dispatch opens with one 【房间简报】: its name and public role, its private instructions, the goal, the other members by name + public role + provider (never their instructions), and the tool contract (`member_message` for CLI members, `room_message` for the room's own agent, `room_read` for the live roster; a written `@name` reaches nobody). Coordinator duties ride the briefing or the handoff, no longer every dispatch. Every later dispatch carries only deltas since the member's previous one: an instructions edit, a handoff, and one-line 【房间变动】 notes from `roomChangesSince` (joins with role/provider, leaves, renames, role changes, goal changes). The goal no longer rides every dispatch. The trailing-`@name` fallback parser is removed entirely: nothing teaches it any more, and a reply ending in a mention must not become a relay.

**Public role.** `role` (≤ 30 chars, `ROOM_ROLE_MAX`, rejected with `role-too-long`) joins the invite request, `room/member-added`, `room/member-updated` (null clears), the `room_invite` tool and the local-agent bridge's `room_invite` schema. Cards show it as a chip; the dialog labels instructions as private.

**Removal.** `removeMember` now does what the confirmation promises, in order: stops a running round through the existing `cancel`, cancels queued deliveries (`room/delivery-state` cancelled), closes open board tasks as cancelled — or hands pending ones to `transferPendingTo` via a new `room/task-edited.member` — leaves the roster, then reports each cancelled delivery to whoever waited on it (`DispatchEngine.reportOutcome`, now public; a removed sender is named from its last `room/member-added`). It returns a `RoomRemoval` summary. `restoreMember` re-adds the member under its old id, role, instructions and child session, so its memory carries on; cancelled work stays cancelled, and the engine skips any delivery that settled while it waited in the queue so an undo cannot resurrect it. The client replaces `window.confirm` with an in-card layer (`RemoveMemberConfirm`) that lists the actual consequences read from room state (`removalImpact`), offers the pending-task heir, focuses Cancel, closes on Escape/outside click, explains instead of failing for the current coordinator, and shows a five-second undo line with what the removal did. `RoomDelivery` gains `replyTo` so the client can name who is waiting.

**Free member messaging with reports.** Every agent-originated message — the coordinator's delegations, any member's `room_message` / bridge `member_message`, delivery reports — goes through one path (`messaging.ts` `sendOrHold`). Any member may message any other; the coordinator-only restriction on `room_message` is gone (inviting members and board edits stay coordinator-only). A message is `kind: 'task'` by default — the recipient's final reply is reported back to the sender (`replyTo`), which generalizes the coordinator's report to every sender — or `notify`, an FYI that is never reported. Each dispatch records `from`, `kind`, `hop` and optional `inReplyTo`, and is delivered with an envelope line: `【来自 claude · #m12 · 派活】（你这一轮的最终回复会自动回报给对方…）`, `【来自 kimi · #m13 · 知会】`, `【#m12 的回报 · 来自 codex · 完成】` followed by the member's own conclusion. A sender reads back `sent #m12（… 做完后结果会自动回报给你，不用轮询）`. The room's own agent's report quotes its last assistant text from that turn. A CLI member's speech row records `reportedTo`, shown as 「→ 已汇报给 X」.

**Holds and settings.** A new `room/settings` event (members tab 协作设置) carries `memberMessages` (`free` default / `confirm`), `hopLimit` (default 10, 2–50) and `paused`. `hop` is 1 for a human message (or a send outside any room round) and the sender's running delivery's hop + 1 otherwise; reports count. A message is held as a pending relay carrying its would-be dispatch (`reason` + `intent`) when the room is paused, the hop exceeds the limit, or — for non-coordinator member messages only — the room asks for confirmation. Confirming releases exactly that dispatch (a hop-limit release restarts the budget: 「继续这条链」); resuming a paused room releases its holds in order, re-checking the other rules. Legacy relays keep the old confirm path.

**Team view.** The members tab gains a 团队 button (and 在团队中定位 on each card) that opens a right-sidebar page (`room-team`, registered like the plan page and shown under the same room-chrome toggle). `teamOf` projects the replayed state into a tree: each member sits under whoever handed it the most tasks (walked from the human, so it is always a tree; untasked members sit under the coordinator), edges count tasks, returned reports and FYIs, and each node sums its rounds, time and observed tokens and lists the deliveries it received. One layout adapts to its own width: below 600px an indented tree whose nodes expand into their deliveries and a session link; wider, the same tree drawn top-down with SVG edges (solid tasks, green return path for reports, dashed FYIs off the tree) and the selected member's details below. A `member` navigation param selects and reveals that member on every navigation. The optional context-composition bar from context-lens is not wired yet; cost is not shown (no pricing data).

## Alternatives considered

**Keep re-sending the roster when it changes, just trimmed.** Rejected: the member's own session already holds the roster it saw; deltas are cheaper and read as news, and `room_read` serves anyone who needs the whole picture.

**Keep the `@name` trailing-line fallback for providers without the bridge.** Rejected: all four providers ship the bridge, and the parser turned ordinary mentions at the end of a reply into relays.

**Session-level system-prompt channels per provider for the briefing.** Deferred, not rejected: the first-dispatch briefing removes the repetition now without touching four providers; moving it into `--append-system-prompt` and equivalents is a later, separable improvement.

**Promise "the resident process is reclaimed" in the removal layer.** Dropped: the facade has no reclaim entry; live runtimes are already reclaimed by their idle timeout, so the layer does not claim it.

**Count hops only between the same pair of members.** Considered to stop ping-pong without limiting long relays; the owner kept whole-chain counting with a default of 10 (a normal implement → review → test → report relay is about 7 hops).

**One node per delivery, like the reference screenshot.** Rejected: room members are standing, so a few rounds would spread dozens of nodes; members are nodes and deliveries hang under them.

**A separate conversation tab for the team.** The owner chose an entry on the members tab opening a sidebar page, which keeps the main area for the conversation.

**Confirm every member message by default.** The previous phase-1 behavior; the owner decided members talk freely and confirmation becomes a setting.

## Consequences

- The paused cloud-collaboration line (`codex/room-*` branches) also edits `assemblePrompt` (a per-dispatch 【本轮来源】 label) and the invite dialog; the owner decided this local line lands first and that line adapts to it. Its source labels map naturally onto the message envelope planned for the next step.
- Old journals replay unchanged: absent `role` reads as none; legacy rooms simply get no more roster re-sends; dispatches without `hop` count as chain starts; relays without `intent` keep the old confirm path.
- The bridge receipt widens from `sent | pending-confirm | busy` to those words followed by an explanation (`sent #m12 …`); local-agent passes it through verbatim and its type allows both forms.
- Tests cover the briefing contents (no foreign instructions), delta-only later prompts, role validation, the `@name` reply staying plain speech, `roomChangesSince`, busy-member removal (stop, queue cancel, coordinator report, task transfer) with undo, the confirmation layer's impact, coordinator and keyboard paths, member-to-member tasks reported back with their message id, notify without a report, hop-limit holds and their release, pause/resume ordering, and confirm mode holding member messages but not coordinator delegations.
