# Agent Note: TaskPilot subagent rows prefer the host Sidebar chat

Status: implemented

## Problem

TaskPilot's subagent rows called `uiWorkspace.openSession`, so inspecting a child replaced the current parent conversation with the child's full conversation page. The host subagent catalog already offers a right-Sidebar chat for the same child, and users expect TaskPilot's row click to use that less disruptive destination by default.

## Decision

`packages/taskpilot/src/client/subagent-navigation.ts` owns the row destination. It resolves the selected child's `SubagentAddress` through `ctx.sessions.subagentAddress`, retaining the direct parent and the one-shot, continuable, or unknown mode even for deep descendants. It then opens the documented `dsh-resource://subagentchat/session/<child>?parent=<parent>&mode=<mode>` resource through `ctx.sidebarRight.openResource` with `kind: 'subagentchat'` and `preferNewPane: true`, matching the host catalog's Sidebar action.

When the address is unavailable or the resource open throws because no tab type claims it, the helper falls back to the existing `uiWorkspace.openSession` route. TaskPilot therefore keeps its existing host floor and remains usable in custom compositions without the host's subagent Sidebar chat. No host files or new runtime package dependencies are involved.

## Alternatives considered

**Keep full-page navigation as the default and add a separate Sidebar button.** Rejected because it preserves the disruptive primary action the user asked to change and adds a second row action without a new capability.

**Import the host ui-subagent address helper or catalog action.** Rejected because the client entry does not export the Sidebar address helper, and a feature-to-feature runtime import would couple TaskPilot's loading to ui-subagent. The documented resource protocol is sufficient and lets older compositions fail soft to the existing route.

**Reconstruct the address from TaskPilot's summary row alone.** Rejected because summaries do not reliably carry the child's continuation mode. The session service already resolves retained, catalog-derived, and unknown-mode listed addresses without opening the child.

## Consequences

On hosts providing the subagent Sidebar chat, clicking any TaskPilot descendant keeps the parent conversation in place and opens the child in the right Sidebar, preferring a separate pane. Interrupt behavior and background-job navigation are unchanged. Older hosts retain the previous full-page behavior instead of gaining a dead click.

The helper owns a small copy of the documented resource-address encoding rather than a runtime dependency on its host feature owner. The navigation specs pin the encoding, all three modes, placement options, and both fallback paths; a future incompatible protocol change requires updating this adapter.

## Testing

`tests/subagent-navigation.spec.ts` verifies that Sidebar opens do not navigate the main conversation, that parent and mode parameters reach the resource address, and that missing addresses or rejected resource claims use the conversation-page fallback. `tests/taskpilot-dock.spec.tsx` verifies that a deep descendant row invokes the same injected navigation action.

## Related

- [TaskPilot subagent rows open as tabs in the active Sidebar pane](2026-11-05-taskpilot-subagent-active-sidebar-tab.md) — supersedes this note's `preferNewPane` placement while retaining the Sidebar-first navigation and compatibility fallback decided here.
