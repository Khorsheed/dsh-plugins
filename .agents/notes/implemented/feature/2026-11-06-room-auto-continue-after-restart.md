# Agent Note: The room continues members a restart interrupted

Status: implemented

## Problem

A host restart cuts off every member round that is running at the time. Since batch 5 S7 such a round reads 待对账 (`uncertain` in the local-agent core's ledger). The composer shows 「N 位成员被重启打断：… · 全部继续」. The button sends 「继续」 to those members as the human, and that new message moves on from the lost round ([queueing and recovery in the core](2026-11-05-queue-and-recovery-in-core.md)). Nothing happens until someone opens the room and presses the button. A user who restarts 3080 to deploy, or whose host crashed overnight, comes back to idle members.

The member self-started rounds design (`proposals/active/2026-11-06-member-self-started-rounds.md`, outside the repo, section E and step M9) chose to let the room press that button itself. The user decided the following on 2026-11-06:

- It is a room setting and it is on by default.
- There is one mechanism, shared with 「全部继续」. The setting only decides who presses.
- Each interrupted round is continued automatically at most once.
- The round that triggered the restart is never continued automatically.
- A paused queue or a paused room is skipped.
- The message is shown as 「房间 · 自动」, with its text visible.

## Decision

- **One shared rule** (`packages/room/src/restart-continue.ts`).
  - `interruptedRounds(state)` lists each member's latest room round whose outcome a restart lost: `uncertain`, or a legacy failed run with the restart reason. It skips other callers' `execution:` rounds, rows waiting for 待对账, and rounds some message already continues (`RoomState.continued`, folded from every dispatch's `continues`).
  - Each round carries `blocked` when a guard holds:
    - `again`: its delivery is itself an auto-continue;
    - `self-restart`: the member's child session is the restart's recorded initiator;
    - `queue-paused`: the core's input queue for that member is paused;
    - `room-paused`: the room is paused.
  - `autoContinueRounds` is empty when the setting is off. Otherwise it is the unblocked rounds that have a run id and are not a formal goal's attempt. A goal attempt keeps its explicit reconciliation.
  - The composer's banner and the server's auto-continue both call this rule. The old composer-local filter is gone.
- **The setting.** `room/settings.autoContinueAfterRestart?: boolean`. Absent means on, so existing rooms get it too. `RoomSettings.autoContinueAfterRestart` is the folded value (default `true`), and `setSettings` accepts it. The switch is in the members tab's 协作设置, group 自动判断, below report timing.
- **The server presses the button** (`RoomService.autoContinue`, after `engine.recover()` in `ensureLive` and in a cold room's `resumeRoom`).
  - It reads `autoContinueRounds(engine.view(...))` and groups the rounds by their delivery's task.
  - For each group it moves on from the lost rounds, as the human's message does (`moveOnFromLostRounds`, which also settles the core's row; text `AUTO_CONTINUE_MOVED_ON_TEXT`). It then appends one `room/dispatch` with `origin: 'human'`, `via: 'auto-continue'`, `continues: [runId…]`, the task, and `RESTART_CONTINUE_TEXT`, and dispatches through the engine.
  - Everything from the read to the appends is synchronous. A concurrent pass therefore sees `continues` and finds nothing. It skips while a coordinator hand-off is running.
  - `getState` triggers a live access when the projection has rounds to continue. Opening a cold room after a restart is enough for it to run.
- **Two optional fields on the registered `room/dispatch`.** `via?: 'auto-continue'` and `continues?: string[]` (interrupted run ids). The human's 「全部继续」 writes `continues` too: `postMessage` takes `continues` and records the ids that are interrupted rounds of its targets. The two paths differ only in `via`. `executionFacts` maps `via: 'auto-continue'` to the existing `{ kind: 'restart', sessionId }` cause, so no new cause is added. `RoomDelivery.via` is projected.
- **The continue text** is one sentence for both presses. It says the instance restarted and interrupted the member, asks it to check files, tests, commits and deployments first, not to redo completed steps, and notes that lost background tasks are not re-run. It is `RESTART_CONTINUE_TEXT` on the server, and the client's `composer.continueText` in zh. The en string has the same meaning.
- **Projection facts** (`RoomState.restartFacts`, from `engine.view`). `queuePaused` lists member ids whose core inbox is paused (`CoreLedgers.paused`). `restartInitiator` comes from a duck-typed probe of the optional `selfRestartGuard` service's `lastRestart()?.initiatorMember`. Today no guard has that read (step M10 adds `initiatorMember`). With no guard, or without the read, the restart is treated as not self-triggered, and the at-most-once rule bounds the damage to one more restart.
- **Client** (`client/restart-view.ts` pure state, `client/RoomRestart.tsx`).
  - The composer banner shows 「重启后已自动继续 N 位成员 · 设置 ×」 while an auto-continue delivery is queued or running. Dismissing it is remembered in `localStorage` per room and dispatch seq.
  - The manual banner shows 「N 位成员被重启打断：… · 全部继续」. With the setting off it lists every round, as before. With the setting on it lists only blocked rounds (each with its reason) and goal attempts. A single blocked member reads 「X 被重启打断」 plus the reason.
  - The timeline row `room-auto-continue` is claimed from the auto `room/dispatch`. It shows the line 「已自动继续：A、B（重启打断）· 设置」 and the message card 「房间 · 自动」 with the full text.
  - The members tab line shows 「重启后已继续」 until that round ends, or 「被重启打断」 with 「等你决定」 or the reason.
  - 「设置」 opens the switch in place.

## Alternatives considered

- **Do it in the client.** Rejected by the design: several open browsers would each press the button. `recover()` runs once per pass on the server, and `continues` makes repeated passes idempotent.
- **A new dispatch origin (`room`) or a new execution cause.** Rejected. Readers of `origin` (task filing, team tree, lens contract) already treat `human` as "nobody's report". The design maps the auto press to the existing `restart` cause. `via` is enough to tell who pressed.
- **One dispatch for all members.** One `task` cannot hold members from different tasks, so each task group gets its own dispatch and its own timeline row. In the common case (one task) there is one row.
- **「设置」 jumps to the members tab.** The host hands `openView` only to conversation views, so a chat row or the composer cannot switch tabs (the eval plugin hit the same wall). The switch opens in place instead, with the same title and hint as the settings row.
- **Show rounds the room is about to continue in the manual banner.** Rejected. Pressing it between `getState` and the room's own pass would send the message twice.

## Consequences

- User-visible:
  1. After a restart, opening a room (or any mutation) continues interrupted members once, with the new message. The timeline shows 「已自动继续：…」 and the message from 「房间 · 自动」. The composer shows 「重启后已自动继续 N 位成员」.
  2. The human's 「全部继续」 now sends the same longer message instead of 「继续」.
  3. A round cut off again after an auto-continue, a paused member queue, a paused room, or a recorded self-restart falls back to the manual banner with a one-line reason.
  4. New settings row: 重启后自动继续.
- A `setSettings` call runs a live access before it writes. Turning the setting off on a room that has not been opened since the restart therefore continues first. In practice opening the room already did that.
- The auto-continue round costs the same as the human's press. It is a visible room round (no silent model call) and can be stopped.
- Out of scope, left to later steps: loading unopened rooms at host start (待定 7, M10), the guard's `initiatorMember` (M10), and reporting the continued round's result to the original sender. That last one is not done for the human's press either. The sender already gets the `uncertain` report from recovery.
- The room→lens contract fixture is unchanged. The contract run has no restart, and the new fields are optional and absent there.

## Testing

- `packages/room/tests/dispatch.host.spec.ts`, block "restart: the room continues interrupted rounds itself (M9)", 8 cases:
  - on: concurrent and repeated live access sends once. The dispatch carries `via`/`continues`, the lost round moves on in the core, the queued message rides along, and the cause is `restart`.
  - `getState` on the room continues once.
  - off: nothing is sent. The human's 「全部继续」 records `continues` and drops ids that are not interrupted rounds.
  - a round the human already continued is never continued again.
  - an auto-continued round interrupted again is not continued (`again`).
  - a guard recording the member blocks it (`self-restart`).
  - a guard without the read does not block, and the round is continued once.
  - a paused member queue blocks it (`queue-paused`), and so does a paused room (`room-paused`).
- `packages/room/tests/restart-continue.client.spec.tsx` covers the shared rule's filters and guards; the banner with the setting off (no reasons), on (pending rounds hidden), auto-continued (dismissible, 「设置」 toggles the switch), and interrupted again (reason, other member unaffected); the timeline row; and the members line.
- `packages/room/tests/room-composer.client.spec.tsx`: the existing 全部继续 case still passes on legacy rows (no run ids).
- Screenshots (not committed), from `packages/room/tests/preview/restart.html?state=autocont|manual|again|setting` at 1280 and 390, light and dark: `/tmp/m9-autocontinue/`.
- Not verified: a real host restart on 3080 with live CLI members.
