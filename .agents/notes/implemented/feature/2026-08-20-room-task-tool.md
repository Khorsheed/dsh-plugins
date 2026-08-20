# Agent Note: room — the room_task model tool (the board's third write path)

Status: implemented

English | [中文](2026-08-20-room-task-tool.zh.md)

## Problem

The room task board had exactly two write paths: the human's capsule UI (the `addTask`/`closeTask` Remotes) and the dispatch auto-open (an @-message journals an `in_progress` task per target). The room's MAIN agent had none: its official todo tool writes a private draft the room never sees, so when it wanted to publicly commit to a piece of work — the coordination gesture the board exists for — there was no channel. The gap was asymmetric in a way that confused models: members could be invited by the agent (`room_invite`) but the agent could not put a task on the shared board.

## Decision

`room_task` (packages/room/src/tool.ts) is the board's third write path, same family as `room_invite`: a `defineTool` definition registered through the deferred `ctx.inject(['tools'])` mount, gated at execute time on the calling session carrying the `room/created` marker, answering rejections with readable self-correcting text instead of throwing.

**Every write goes through the same host functions as the UI.** `add` calls `RoomService.addTask`, `close` calls `RoomService.closeTask` — a task the agent opens is byte-identical to a human-added one (a `pending` task on a member's lane). The tool's description states the public/private split explicitly: this board is shared with every member and the human; the agent's own todo tool stays the private work plan.

**`update` needed one new journal event.** The action edits an open task's title and/or `blockedBy`, which no existing event could carry. `room/task-edited` (`{ id, title?, blockedBy?: string | null }` — explicit null clears the wait) joins the vocabulary, the replay fold, and the persistence catalog; the backing `RoomService.updateTask` is a host method only, not a Remote, because the capsule UI edits nothing but the goal. Closed tasks take no edits (`task-closed`); a missing field set is `nothing-to-update`.

**Errors are self-correcting.** `member-not-found` answers with the live roster names; `task-not-found` with the open-task list (id — title — member — status), which is also how the model learns ids at all (the `add` success text returns the new id and tells the model to keep it). The blockedBy parameter is `oneOf` string/null so `update` can clear a wait; on `add` a null blockedBy is rejected with guidance to simply omit it.

## Alternatives considered

- **Teaching the main agent to write the board through its private todo tool plus a sync bridge** — rejected: two task models with a sync layer between them drift in both directions (status vocabularies differ, deletions are ambiguous), and the board's value is precisely that there is ONE list everyone reads; a direct write through the existing host functions has no drift surface.
- **`update` as a status transition (pending ↔ in_progress) instead of a field edit** — rejected: the dispatch engine and the speech settle already own status transitions (auto-open on dispatch, close on settle), so a model-driven status write would race the engine's; title/blockedBy edits are the gap no other writer covers.
- **Registering `updateTask` as a Remote for symmetry with addTask/closeTask** — rejected: no browser caller exists (the capsule UI edits only the goal), and an unwired Remote is surface area without a consumer; the method stays host-side until a UI need appears.

## Consequences

- The tool's output contract is text-only (`{ text }`), same as `room_invite`: the model reads the result, nothing renders it.
- Old journals replay unchanged (the new event type is additive); a build without room still refuses room logs wholesale, so the new type needed nothing beyond the catalog registration.
- The model can now hold the board consistent with reality (close what it finished, rename what changed scope) — the board's trustworthiness no longer depends on the human janitoring the main agent's lane.
- 7 new tests pin the gating, the add/close/update semantics, the `room/task-edited` fold (including null-clears), the persistence round-trip, and every self-correcting error text.

## Testing

`packages/room/tests/tool.host.spec.ts` gains a `room_task` describe (real composition: the service, the stubbed tools registry, a live room): registration shape and the shared-board wording, the non-agent/non-room gating, add landing byte-identical to the UI path with the id returned, off-roster member/blockedBy rejections carrying the roster, close's unknown/closed-id rejections carrying the open-task list, update's rename/re-target/null-clear/nothing-to-update/closed-task paths. `journal.host.spec.ts` pins the `room/task-edited` fold; `persistence.host.spec.ts` round-trips the new event type.
