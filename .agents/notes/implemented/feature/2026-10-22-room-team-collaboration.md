# Agent Note: Room team collaboration — lean member prompts and honest removal

Status: implemented

## Problem

Room member prompts were one user message that stacked everything: role instructions, the goal on every dispatch, and the full roster again whenever anyone joined, renamed or edited a role. The roster used the first line of each other member's instructions as their "role"; coordinator-written instructions are usually one paragraph, so a member read other members' complete briefings ("when asked to say hello, …") as if they were addressed to it. The roster also taught a trailing `@name <content>` line protocol "pending owner confirmation" while every provider already carried the `member_message` bridge tool. Separately, removing a member used the browser's native `confirm` and claimed "its run will be interrupted" while `removeMember` only journaled `room/member-removed`: a running member kept running, queued work stayed queued, and a coordinator waiting for its report waited forever.

## Decision

Delivered in steps against the plan the owner approved on 2026-10-22 (team view, free member messaging, presets and permissions follow in later commits of the same line).

**Prompt slimming.** A member's FIRST dispatch opens with one 【房间简报】: its name and public role, its private instructions, the goal, the other members by name + public role + provider (never their instructions), and the tool contract (`member_message` for CLI members, `room_message` for the room's own agent, `room_read` for the live roster; a written `@name` reaches nobody). Coordinator duties ride the briefing or the handoff, no longer every dispatch. Every later dispatch carries only deltas since the member's previous one: an instructions edit, a handoff, and one-line 【房间变动】 notes from `roomChangesSince` (joins with role/provider, leaves, renames, role changes, goal changes). The goal no longer rides every dispatch. The trailing-`@name` fallback parser is removed entirely: nothing teaches it any more, and a reply ending in a mention must not become a relay.

**Public role.** `role` (≤ 30 chars, `ROOM_ROLE_MAX`, rejected with `role-too-long`) joins the invite request, `room/member-added`, `room/member-updated` (null clears), the `room_invite` tool and the local-agent bridge's `room_invite` schema. Cards show it as a chip; the dialog labels instructions as private.

**Removal.** `removeMember` now does what the confirmation promises, in order: stops a running round through the existing `cancel`, cancels queued deliveries (`room/delivery-state` cancelled), closes open board tasks as cancelled — or hands pending ones to `transferPendingTo` via a new `room/task-edited.member` — leaves the roster, then reports each cancelled delivery to whoever waited on it (`DispatchEngine.reportOutcome`, now public; a removed sender is named from its last `room/member-added`). It returns a `RoomRemoval` summary. `restoreMember` re-adds the member under its old id, role, instructions and child session, so its memory carries on; cancelled work stays cancelled, and the engine skips any delivery that settled while it waited in the queue so an undo cannot resurrect it. The client replaces `window.confirm` with an in-card layer (`RemoveMemberConfirm`) that lists the actual consequences read from room state (`removalImpact`), offers the pending-task heir, focuses Cancel, closes on Escape/outside click, explains instead of failing for the current coordinator, and shows a five-second undo line with what the removal did. `RoomDelivery` gains `replyTo` so the client can name who is waiting.

## Alternatives considered

**Keep re-sending the roster when it changes, just trimmed.** Rejected: the member's own session already holds the roster it saw; deltas are cheaper and read as news, and `room_read` serves anyone who needs the whole picture.

**Keep the `@name` trailing-line fallback for providers without the bridge.** Rejected: all four providers ship the bridge, and the parser turned ordinary mentions at the end of a reply into relays.

**Session-level system-prompt channels per provider for the briefing.** Deferred, not rejected: the first-dispatch briefing removes the repetition now without touching four providers; moving it into `--append-system-prompt` and equivalents is a later, separable improvement.

**Promise "the resident process is reclaimed" in the removal layer.** Dropped: the facade has no reclaim entry; live runtimes are already reclaimed by their idle timeout, so the layer does not claim it.

## Consequences

- The paused cloud-collaboration line (`codex/room-*` branches) also edits `assemblePrompt` (a per-dispatch 【本轮来源】 label) and the invite dialog; the owner decided this local line lands first and that line adapts to it. Its source labels map naturally onto the message envelope planned for the next step.
- Old journals replay unchanged: absent `role` reads as none; legacy rooms simply get no more roster re-sends.
- Tests cover the briefing contents (no foreign instructions), delta-only later prompts, role validation, the `@name` reply staying plain speech, `roomChangesSince`, busy-member removal (stop, queue cancel, coordinator report, task transfer) with undo, and the confirmation layer's impact, coordinator and keyboard paths.
