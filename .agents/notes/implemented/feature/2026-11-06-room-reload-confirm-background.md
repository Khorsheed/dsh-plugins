# Agent Note: The room confirms before replacing a member process that runs background work

Status: implemented

## Problem

Kimi M3 (`2026-11-06-kimi-keepalive-background-tasks`) made the core refuse a reload while the member's live process runs background tasks. Unless the caller passes `confirmBackgroundTasks: true`, the core answers `{ ok: false, reason: 'background-tasks', running: N }` and does nothing. The design (`member-self-started-rounds` C①) asks the room to confirm such an operation in place: 「会让 N 项后台工作失去联系，继续吗？」.

The room had no way to pass the confirmation. Before this change its 重新载入 / 立即载入 line showed nothing at all for the new refusal. A model save in the edit dialog also replaces the process, and the driver does not block that retire, so the room has to ask on its own before saving.

## Decision

- **Request.** `reloadMemberTools(childSessionId, options?)` in `slots.ts` now takes the options. `client/index.ts` routes the call through the new `reloadThroughGateway` (`member-tools-view.ts`). That function forwards the options, and it degrades to `undefined` without the family, without the method, or when the read fails. An older core simply ignores the options.
- **Shared confirmation.** `BackgroundConfirm` (`MemberActivity.tsx`) shows the amber in-place line 「⚠ 会让 N 项后台工作失去联系，继续吗？」 with 取消 / 继续. On mount it scrolls into view and focuses 继续.
- **重新载入 / 立即载入** (`MemberToolsLine`). A `background-tasks` answer opens the confirmation. 继续 asks again with `{ confirmBackgroundTasks: true }`. 取消 drops the confirmation and sends no further request.
- **Model save** (`InviteDialog`, edit mode, CLI member with a session). When the model or effort changed, the dialog first calls `runningBackgroundTasks(childSessionId)`. If the count is positive, it shows the same confirmation and saves nothing until 继续.
  - The count is a fresh read of `memberBackgroundTasks` (`MemberActivityStore.readNow`). It counts `running` tasks only, and only when the process is alive (`runningBackground`). If no process is up, there is nothing to cut off, so the count is 0.
  - A save with no model change makes no read.

## Alternatives considered

**Count from the polled store instead of a fresh read.** The dialog may open before any poll has run, and a cached count can be 4 s stale. A one-off read at save time costs a single request and answers about the process as it is at that moment.

**Have the core refuse the model switch the way it refuses a reload.** The coordinator ruled that out for this step: the driver does not block model retire. The question therefore lives at the one place a person changes the model.

## Consequences

- Only the room's surfaces confirm. The member composer's own model control (local-agent) does not confirm yet.
- If the read fails, the count is 0 and the save goes through without a question. This degrades in the same direction as a missing family.

## Testing

- `packages/room/tests/background-confirm.client.spec.tsx` (11 cases) covers:
  - 重新载入: refusal, confirmation, then a retry carrying the option;
  - 取消 sends no retry;
  - 立即载入 behaves the same way;
  - the English copy;
  - model save with work running: confirmation, nothing saved, then 继续 saves; 取消; no background work; no model change, so no read;
  - `runningBackground` and `readNow`;
  - `reloadThroughGateway` with and without options, and its degrade paths.
- The preview page `activity.html?state=confirmReload|confirmSave` was captured at 1280 and 390, light and dark.
