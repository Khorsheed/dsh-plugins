# Agent Note: preset self-hide toggles apply registration switches on the next frame

Status: implemented

## Problem

ui-conversation's `refreshViews` re-reads every mounted session binding on any `conversation.view` registration change and throws UNCAUGHT on a binding whose session record is already released (`conversation/assembly.ts`, the stale-binding window). The preset self-hide tabs subscribed to `ctx.sessions.list` and re-registered SYNCHRONOUSLY inside the session-switch flush — exactly the window — so every hidden-tab switch was a coin flip against an aborted cordis flush. The production incident killed the message timeline (a later subscriber of the same flush) until a hard refresh. The upstream robustness proposal is `docs/upstream-proposals/2026-10-20-refreshviews-stale-binding-robustness.md`; our toggles were the amplifier and needed their own mitigation.

## Decision

In the four packages whose toggle registers a `conversation.view` entry — room (members tab), datasets (题集), eval (实验室), mission (任务) — the inline `RegistrationToggle` copy now applies criterion-driven register/unregister on the NEXT animation frame (`requestAnimationFrame`, zero-timeout fallback where no rAF exists) instead of synchronously:

- repeated `sync()` calls coalesce into one scheduled frame, which reads the LATEST criterion;
- `setReady(false)` stays SYNCHRONOUS on the teardown arm — it cancels a pending frame and unmounts a live registration on the spot, so nothing can register after the slot (or component) goes away;
- the frame re-checks readiness before acting.

Toggles that never touch `conversation.view` do not trigger `refreshViews` and were left alone (canvas, game, library, dsh-reader, video-studio, worktrees on `sidebarRightTabs`; context-lens on its three non-view slots). Two exceptions share a class with a `conversation.view` toggle and inherit the deferral harmlessly: room's plan tab type and eval's inspect tab type (both `sidebarRightTabs`) — splitting the per-package copy to spare them was not worth it.

## Alternatives considered

- **Wait for the upstream fix only**: rejected — the proposal is unmerged and our synchronous re-registration is the part we own; the mitigation stays harmless (one redundant frame) after the host hardens.
- **Keep the readiness gate's mount synchronous** (`setReady(true)` registers immediately, only criterion switches defer): rejected — it preserves first-paint timing but splits the timing rule per call site, and a slot declaration can itself land inside a session-release flush. One rule: everything schedules, teardown cancels.
- **Extract a shared toggle helper package**: rejected by the standing keep-copies-inline rule (docs/plugin-visibility.md); the four copies stay inline and identical.

## Consequences

- The four tabs appear/disappear one frame later than before — imperceptible, and the boot-time inventory answer already arrived asynchronously.
- Every `conversation.view` mutation now happens outside the session-list flush, so a stale binding can no longer abort it mid-flush from these packages.
- The client specs stub `requestAnimationFrame` as a zero timeout (apply specs flush through the existing `settled()`) or drive a manual frame queue (room's toggle unit spec).

## Testing

New and updated cases pin: switch-triggered unregister is not synchronous but applies on the next frame (apply-level, driving a real `list.set` session switch in datasets/eval/mission); burst coalescing and pending-frame cancellation on teardown (room's toggle unit spec). Package suites green: room 317/317, datasets 417/418 (the one failure is `organizing-preset.spec.ts` reading `profiles/web-eval`, deleted by a concurrent agent in this shared checkout — unrelated), eval 1351/1351, mission 161/161.
