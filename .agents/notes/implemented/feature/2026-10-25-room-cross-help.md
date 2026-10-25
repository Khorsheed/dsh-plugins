# Agent Note: A room member asks another session for help

Status: implemented

English | [中文](2026-10-25-room-cross-help.zh.md)

## Problem

A room often hits a problem that another session already has the context for. The typical case: session A built a plugin, and the room using it hits an export error. Inviting a fresh member loses that context, and moving A into the room would take A away from its own work. The owner's design is in the prototype `proposals/prototypes/room-cross-help.html` (v3, finalized 2026-10-25). This change ships its first batch: the asking path from a room to a plain session, end to end.

## Decision

- **The helper stays where it is.** `room_help` (on the room tool row) names a session by its title, its id, or the host's `@[…](dsh-session:…)` mention, resolved through the host's `sessionReferenceResolver.listCandidates`. The room wakes a cold session with `sessionController.resolveAgent`, the same path the official scheduler uses. It queues the request with `agent.followup`, so a busy helper finishes its current turn first: the host's own queue.
- **The request is a card in the helper's session.** The queued `user/message` carries a `room-help` source: help id, asking room and its title, asking member, op, and the asker's own words. The client claims it as a `room-help-request` node, a card naming the room with a link back. This is the same claiming pattern dsh-game uses. The message content adds model-facing framing.
- **Helper tools are agent-local.** `room_help_reply` (final answer plus a short handoff) and `room_help_ask` (a question back) are registered on the helper agent's own `agent.ctx.tools`, never on a preset or the profile root. A pre-step hook equips an agent when a help message reaches its turn. It also equips, on the first step, any agent whose log already holds help requests, because a restart drops agent-local tools.
- **Answers travel as reports.** A helper's question or reply reaches the asking member as a report-origin `room/dispatch` with `reportFor: help:<id>`, the path plan reconciliation already uses. A running asker gets it in its current turn, and an idle one is woken. This matches how the host hands a background subagent's result to its parent. The asker answers a question, or follows up, by calling `room_help` with the help id.
- **A forgotten reply call still answers.** After the helper goes idle, a turn that claimed the request but recorded neither a reply nor a question hands over its last answer as a `fallback` reply. A request that left the queue unclaimed (the queue was cleared) fails the thread.
- **CLI members ask too.** The local-agent member bridge lists `room_help` among its room tools, and the room serves it through `receiveMemberCommand`, where the asker is the authenticated member. Session discovery ranks by the room's own agent, because a CLI member has no host agent.
- **Consent.** If the human @-mentioned the session in the room, or the room already asked it, the request goes straight out. Otherwise the first ask shows a 允许 / 不允许 card through the existing question card and waits up to 10 minutes.
- **Asking another room.** A room target goes through that room's own roster, never into its session directly. The request goes to the named member: the `member` argument, or the 「成员（房间）」 label the @ menu writes. With no member named it goes to the room's coordinator. It travels as a `help`-origin `room/dispatch` carrying `help: {id, room, roomTitle, from}`, and its envelope tells the member that its final reply goes back automatically. It also appears on that room's timeline as `room/help-in`, a card naming the member it went to. A paused room holds it at the gate like any agent message: the thread shows queued, and dismissing the hold fails the thread. When the dispatch settles, the engine's `settled` hook returns the member's final reply to the asking room's thread, or marks the thread failed.
- **Reminder.** A request still queued or running past the room's `helpReminderMinutes` (协作 setting 求助提醒, 10–120 in steps of 10, default 30) turns its row amber with the minutes waited, timed from when the thread entered that state. Nothing is cancelled.
- **Team and member list.**
  - The team tree hangs each asked target under whoever asked it last, as a dashed 外援 node that greys out once every ask has ended. Its deliveries are the asks. It counts in neither the member total nor the usage.
  - 加入房间成员 (on the team node, or a one-time hint under the third answered ask of one plain session, which can be dismissed for good) keeps the session on the member list: `room/help-link` / `room/help-unlink` / `room/help-nudge-dismissed`. It does not copy the session and does not change the roster; it is only an @ shortcut. The member page lists such sessions under 外部会话, and the @ menu puts them in the members group. Asking still goes through `room_help`, and usage stays in the helper's own session.
- **The @ menu.** The room composer's @ menu has two groups: this room's members, then other sessions from the host's own session-reference candidates. With nothing typed it lists the five most recent; typing matches both groups fuzzily, where the characters only have to appear in order, ranked exact > prefix > contiguous > in-order, then by recency. A room starts folded. Its arrow (or →) shows its members, and a typed query matches room members by name. The members' own sessions are left out. A picked session goes into the draft as the host's own session chip, through the scoped `slash/input-insert-reference` event; a host without that seam gets the mention as text. The sent text carries the `dsh-session:` mention, which is both the consent signal and what `room_help` resolves.
- **Journal.** `room/help` (asker, target, text), `room/help-message` (`question` / `reply` / `message`, handoff, fallback) and `room/help-state` (`queued` / `running` / `asking` / `replied` / `failed`). The room timeline shows each thread as one `room-help` row whose state and messages update in place, with 看求助内容 and 打开对方会话.

## Alternatives considered

**Granting the helper tools through a preset or the profile root.** Rejected. Every session would carry tools that only matter while a thread is open, and a plain session's preset is not ours to edit.

**A visible entry in the helper's queue dock.** Not available: the host dock lists only human-sourced items. The owner chose to show queue state on the room's row for now and judge it in use.

**Steering into a busy helper's turn.** Rejected. The helper belongs to someone else's work, so the request waits for the current turn to end.

## Consequences

- Restart: the helper's tools are restored, but the room's watcher of the helper's turn is in-memory. A thread open across a restart gets no fallback reply; the helper can still reply with the tool.
- Tests cover queuing with the room's source, the agent-local tools, the reply reaching the asker, the consent card, question and follow-up, the fallback reply, refusals, both client nodes, and persistence of the new events.
