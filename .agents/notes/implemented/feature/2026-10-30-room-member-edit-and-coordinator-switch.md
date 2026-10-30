# Agent Note: one model form for invite and edit, an editable native dsh, and a coordinator switch in the composer

Status: implemented

## Problem

- **Two model controls in one dialog.** Inviting showed local-agent's two-select picker (model + effort). Editing a started member swapped in the live member-configuration popover (「模型 › / 推理强度 / 暂未取得此模型的强度选项…」), which applies on pick. The same dialog behaved two ways, and the edit control read as worse.
- **The room's own agent (dsh) could not be edited.** No name, no role or instructions, no model. Its model is the session's, which only the composer's model seat switched.
- **Handing the coordinator role over** lived only on the members tab (设为协调者), away from where the human decides who a message goes to.

Decided with the user on 2026-10-30 (mockup `proposals/prototypes/room-member-dialog-coordinator.html`, local only).

## Decision

- **local-agent** adds an optional form face on `LocalAgentUi`:
  - `renderMemberModelPicker(childSessionId, props)` — the same `HarnessModelPicker` selects, over the member's own directory;
  - `readMemberSelection(childSessionId)` — the latest intent as a draft. A following choice drafts as what it resolves to, because the picker fills an empty value with its first entry, and an untouched form must save nothing;
  - `saveMemberSelection(childSessionId, draft)` — queued through the member control's `select`, exactly like the live pick; `deferred` when a round is in flight.
  
  Helpers are in `client/member-selection.ts`.
- **room's edit dialog**, for a started CLI member on a core with that face, renders the selects and saves on 保存. A running member gets 「本轮结束后生效」, and the members tab flashes it after a deferred save. An older core keeps the live control.
- **dsh is editable.** The edit dialog shows name, role, instructions, and the session model as two selects built from `ctx.modelDirectories` (provider-grouped models, then the picked model's efforts); saving calls `directory.select`. Provider, mode and cwd are not offered. `updateMember` now accepts renaming the main agent: its identity is its join seq (`legacy:<seq>`), seating keys on `isRoomLog`, and every check uses `kind === 'main-agent'`. Removing it stays refused.
- **Composer.** The coordinator line is the anchor of the host's `Menu` (`@deepseek-ai/dsh-client-ui-primitives`, the menu the host's model seat uses), not a room-drawn list. It lists every member with role · provider, the current one checked. Picking one calls `setCoordinator` at once, with no confirm; the handover journals its usual timeline row. While any member runs or a delivery is queued, running or uncertain — the server's own `coordinator-busy` condition — the menu still opens (a dead trigger read as a bug), but it shows the reason under its title and greys out every other member. So the rule surfaces before the pick instead of after.

## Alternatives considered

- **A confirm step before the handover.** The user chose immediate handover; the timeline row records it.
- **Allow handover while the coordinator runs, letting it finish its round.** The user chose not to: in-flight work makes "who answers next" ambiguous.
- **Keep the live control in edit and only restyle it.** That keeps two interaction models in one dialog.

## Consequences

Invite and edit share one model form, and changes apply only on 保存. The room's own agent reads and edits like any member. The coordinator is switched where messages are written.

## Testing

- `local-agent`: `member-selection.spec` covers draft ↔ selection, including following choices drafting as their resolution.
- `room`:
  - members spec: a started member's picker draft, save through `saveMemberSelection` with no roster write, and the deferred notice; editing dsh — the fixed line, no cwd field, the session model prefilled, rename saved, model untouched; dsh's card has 编辑 but no 移除.
  - composer spec: the menu lists members and hands over on pick; while a delivery runs, the menu opens with the reason and a greyed member that cannot be picked.
  - service spec: renaming dsh keeps one main agent, still the coordinator.
