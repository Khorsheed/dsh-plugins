# Agent Note: The room invite dialog offers the model's reasoning-effort row

Status: implemented

## Problem

The room's invite dialog let you pin a member's model but not its reasoning effort, even though every layer below already speaks effort: the local-agent core's delegation `start`/`prepareMember` options take `effort`, all three CLI providers bind it at spawn (kimi via its scoped config, codex via `-c model_reasoning_effort=…`, claude-code via `CLAUDE_CODE_EFFORT_LEVEL`), and the family client's `ModelConfigurationFields` already renders a model+effort pair — the shared `HarnessModelPicker` just mounted it with `showEffort={false}` and dropped the effort half of every selection.

## Decision

Mirror the invite-time model channel exactly, one layer up at a time:

- **`HarnessModelPicker`** grows an optional `effort: { value, onChange }` prop. Present = the menu shows the effort row and reports both halves of each selection, and stays open on a pick (pane navigation, the member-configuration card's behavior) instead of closing. Absent = the picker is byte-for-byte the old model-only control, so the provider settings cards are untouched.
- **Room invite dialog** keeps an `effort` draft ('' = follow the harness default) beside the model draft, passes it to the picker, resets it on provider switch, and omits it from the invite when blank. The legacy plain-input fallback (a brokerless harness) stays model-only — degrade, don't explode.
- **Room host** threads `effort` everywhere `model` already goes: `RoomInviteRequest` / `room/member-added` / `RoomMember` / `room/member-updated` (with null-clears) / `RoomUpdateMemberRequest`, the journal replay folds, the invite validation (blank effort = `empty-text`), the updateMember guards (`configuration-owned-by-core` for a started member, effort counts as an update), `restoreMember`, `prepareMember`, and the first dispatch's facade `start` call. The agent-facing `room_command` invite accepts `effort` like `model`.

Edit-mode ownership is unchanged: a STARTED member's configuration (model and effort alike) belongs to the shared member-configuration card, which replaces the dialog's own field; the dialog's effort draft only exists for the journaled intent of a never-started member, and the edit diff journals it only when that member still has no child session.

## Alternatives considered

- **A separate effort dropdown in the dialog**: duplicates vocabulary the model directory already owns (per-model `reasoning.options`) and drifts the moment a harness changes its levels; riding `ModelConfigurationFields` keeps one source of truth.
- **Extending `LocalAgentModelInfo` with effort choices for the legacy input**: the legacy branch exists precisely for compositions without the family client half; enriching it buys a degraded-path feature at contract cost. The picker's own directory read already carries the options, so only the picker path gained the row.

## Consequences

- New invites can pin effort; old journals replay identically (the key is absent, never blank).
- A started member's effort still changes only through the member-configuration card (core-owned, round-boundary queued); the room journal never double-writes it.
- Context Lens reads the spawn-bound effort through the existing `request/header` channel (2026-10-23-external-agent-request-headers) — no consumer change needed.
- The in-flight `room-members-extension` branch prototyped an effort field of its own; this implementation is the base it rebases onto (theirs was dialog-local; this one threads host + journal + providers).

## Testing

`pnpm --filter @khorsheed/dsh-local-agent test` (picker spec: the effort prop opens the row, reports both halves, keeps the menu open) and `pnpm --filter @khorsheed/dsh-room test` (service.host: invite/updateMember effort journaling, trim, null/blank clears, blank rejection; dispatch.host: the facade start call carries `effort` only when invited with one; members.client: the shared picker's effort choice lands in the invite request).
