# Agent Note: Room invitation keeps its dialog and supports both directory backends

Status: implemented

## Problem

The session-header invite chip could lose its open dialog when the preset-composition visibility answer landed after the click, because the self-hide branch removed the component owning the dialog. The working-directory field was read-only, and Browse called only `uiWorkspace.pickDirectory`. Hosts with the browse directory backend reject that native-pick call, leaving neither a working picker nor a manual path entry.

## Decision

The header self-hide rule now gates only the chip. An invitation already open survives later visibility notifications; closing it reapplies the current rule. All three invite hosts — the header action, members view, and fresh-room capsule — share the same directory behavior.

The cwd field accepts direct text input. Native picking still uses `uiWorkspace.pickDirectory`, with `null` reserved for operator cancellation. If that call rejects and `uiWorkspace.listDirectory` is available, the dialog opens a Room-owned directory browser instead. The browser lists one Host directory level at a time, follows breadcrumbs and child directories, accepts a typed path, and returns only the selected absolute path. It does not create a Workspace or change the room session's cwd. Without either capability, the existing inline failure hint remains and the typed value is preserved.

Mobile Room-form recognition no longer depends on the cwd input being read-only.

## Alternatives considered

**Keep the native-only call and merely make the field editable.** Lost: manual entry would hide the backend mismatch rather than let browse-backend users choose a folder.

**Always replace native/mobile picking with the Room browser.** Lost: it would discard the Host's native chooser and the mobile directory flow that already work. The fallback runs only when native picking rejects; a cancellation never opens a second picker.

**Reuse ui-workspace's workspace-adoption surface.** Lost: this invitation needs a pure path override, not a new Workspace or a changed room cwd. The public listing primitive provides exactly the required Host boundary without that side effect.

## Consequences

The fix adds a small nested Modal and zh/en directory copy but no new package dependency or Host change. `RoomInviteInjected.listDirectory` is optional so older compositions keep the previous inline degradation. Aborting a superseded directory scan prevents stale results from replacing a newer location.

Regression coverage lives in `packages/room/tests/preset-visibility.client.spec.tsx` (dialog lifetime across visibility flips), `packages/room/tests/members.client.spec.tsx` (typed cwd, native cancellation, fallback navigation and selection), `packages/room/tests/slots.client.spec.tsx` (uiWorkspace wiring and missing-capability semantics), and `packages/mobile/tests/surface.client.spec.ts` (editable-cwd form recognition).
