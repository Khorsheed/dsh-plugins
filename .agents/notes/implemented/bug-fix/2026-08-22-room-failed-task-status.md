# Agent Note: Failed member runs close their task as failed

Status: implemented

English | [中文](2026-08-22-room-failed-task-status.zh.md)

## Problem

A live screenshot report: when a member run failed, the dispatch's auto-opened task stayed `in_progress` forever — the task panel showed the row spinning ("进行中 · 2 天前") and the task capsule kept sweeping its glare band, while the only failure signal was the chat flow's dim failed row. The engine's settle comment said "a failed run leaves the task for the human", but what it left was a task indistinguishable from one still working: the two surfaces disagreed, and the board lied.

## Decision

The task board gains a fifth status, `failed` (`RoomTaskStatus`, the `room/task-updated` wire event, and the client node fold all move together). The settle's task-closing loop now closes the member's open `in_progress` task to the run's OWN terminal state — `done` on completion, `cancelled` on abort, `failed` on fault — instead of only handling the first two. A failed task is terminal-from-the-engine but stays human-actionable: it is NOT `task-closed`, so `closeTask` still accepts it. The board's failed row renders a filled error-tone × glyph with the "失败"/"failed" label and a [关闭] button that dismisses to `cancelled` — never [完成], because a run that did not finish must not count as goal progress; re-dispatch is a fresh @-message, not a board action. Derived views exclude failure from liveness: the capsule's open count stays pending+in_progress, the runners (and therefore the sweeping glare) count `in_progress` only, and `taskProgress` drops `failed` from the denominator alongside `cancelled` (a failed task never advanced the goal). Old journals are untouched — tasks stranded `in_progress` before this fix replay as-is and close by hand.

## Alternatives considered

- **Leave the task in_progress and surface failure only in the chat row** — rejected: that was the bug; the board is the coordination surface and a permanently-spinning row reads as work in flight.
- **Auto-close failed runs' tasks as cancelled** — rejected: it erases the failure signal from the board (cancelled reads as "never part of the plan"), and the human should see that a run failed before dismissing it.
- **Offer [完成] on failed rows** — rejected: it lets a failed task count toward goal progress, which falsifies `taskProgress`; dismissal to `cancelled` carries the right semantics ("taken off the board, not accomplished").
- **Show a failed count on the collapsed capsule** — rejected for now: keeps the capsule vocabulary unchanged (open count + runners); the failed row stays visible in the panel, which is where the human acts on it.

## Consequences

- The `room/task-updated` wire event's status union widened; any third-party fold of that event must tolerate `failed` (the journal fold already passes statuses through).
- Host specs pin both directions: a failed settle closes the auto-opened task as `failed` (main-agent no-live-agent and facade-vanishing paths), and a `failed` task closes via `closeTask` to `cancelled` with a second close rejected `task-closed`. `taskProgress` excludes `failed` from the denominator. The client spec pins the failed row's glyph/label/[关闭] and the capsule's indifference to failed tasks.
- Verified live on the scratch instance (port 3199): a fresh dispatch to a member with an unregistered provider failed, the new task landed `failed` with the red glyph and [关闭], the capsule showed no sweep and no count, and [关闭] moved the row to `cancelled` (screenshots in `scratch-screenshots/`).
