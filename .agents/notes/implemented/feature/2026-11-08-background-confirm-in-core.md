# Agent Note: One background-work confirmation, owned by the core, on every model control

Status: implemented

## Problem

`member-self-started-rounds` C① asks every operation that replaces a member's process to confirm in place while that process runs background tasks: 「会让 N 项后台工作失去联系」. That covers saving a model or effort change, and 重新载入 / 立即载入.

The room already confirmed in two places ([room reload confirm](2026-11-06-room-reload-confirm-background.md)): its 重新载入 / 立即载入 line, and saves from the edit dialog. Two entry points did not:

- **The member's own model control** (local-agent `MemberConfiguration`). It is the room composer's seat when the coordinator is a CLI member, the member page's composer seat, and the live control an edit dialog may embed. A pick there applied at once.
- **The member page's older model picker** (`MemberComposer`, for a harness without member configuration). It also switched at once.

The confirmation itself lived in the room. local-agent cannot import room, so the core's own surfaces had nothing to reuse.

## Decision

- **The confirmation moves to the core.** local-agent `client/BackgroundConfirm.tsx` is the one confirmation: the amber row 「⚠ 会让 N 项后台工作失去联系，继续吗？」 with 取消 / 继续. It scrolls into view and focuses 继续. Its button rules are scoped (`.confirm button.go`) so a host panel's `.panel button` styles cannot restyle it.
  - It ships with `runningBackgroundTasks(read)`: count `running` tasks, only while the process is alive.
  - The locale keys are `member.background.{confirm,go,cancel}`.
- **The core's controls ask first.**
  - `MemberConfigurationFace.runningBackgroundTasks?` is a fresh `memberBackgroundTasks` read; any failure counts as 0. When it is positive, a pick in `MemberConfiguration` is held as a pending selection under the confirmation. 继续 applies it, 取消 drops it, and closing the menu also drops it.
  - `MemberComposer`'s picker does the same through the injected `runningBackgroundTasks`.
- **The room renders the core's confirmation.**
  - `LocalAgentUi.renderBackgroundConfirm?` and `LocalAgentUi.runningBackgroundTasks?` are new optional members.
  - The room's `BackgroundConfirm` (used by `MemberToolsLine` and `InviteDialog`) reads the core's renderer lazily at render time; the client entry registers that read through `setCoreBackgroundConfirm`. With a renderer present, the room shows the core's row. The room keeps its own copy only for a core that predates the renderer.
- **Unchanged.**
  - The room's own reads stay as they were: the edit dialog's count and the reload refusal.
  - Automatic reloads (the mode-tools self-heal) still defer while tasks run. They never ask.

## Alternatives considered

**Keep the room's component and add a look-alike in local-agent.** That would give two components to keep in step, and the brief asked for one shared confirmation.

**Import local-agent's component into the room bundle.** The room's client bundle can only import local-agent's types. A value import would either inline a private copy or be rejected by the bundle purity gate. The service seam is how the room already reaches local-agent's renderers (`renderMemberConfiguration`, `renderMemberInbox`).

**Have the core refuse a model switch the way it refuses a reload.** The core does not block a model retire (the earlier note records this decision). The question belongs where a person makes the change.

## Consequences

- Every surface that can replace a member process now asks the same question in the same words and style. The room's copy stays only as a fallback, and it can be removed once every core in the field ships `renderBackgroundConfirm`.
- A failed or unsupported count (Codex, Claude Code, or no process) asks nothing, the same direction as before.
- A pick on a member that is running a round still waits for the round boundary after 继续. The confirmation is about the process, not the timing.

## Testing

- `local-agent/tests/member-configuration.client.spec.tsx` (3 cases):
  - the confirmation appears and nothing is selected until 继续;
  - 取消 drops the pick, and closing the menu drops it too;
  - with a count of 0 or a failed read, the pick goes straight through.
- `local-agent/tests/member-composer.client.spec.tsx` (2 cases): the picker confirms (取消, then 继续); with no work it switches at once.
- `room/tests/background-confirm.client.spec.tsx`: the room renders the core's renderer when present (继续 retries with the confirmation), and its own copy when it is absent.
- Preview `room/tests/preview/activity.html?state=confirmPick` (the member's own model control) and `confirmSave` / `confirmReload` (the room's surfaces, now through the core's component), captured at 1280 and 390.
