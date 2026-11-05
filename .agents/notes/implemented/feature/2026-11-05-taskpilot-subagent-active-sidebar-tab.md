# Agent Note: TaskPilot subagent rows open as tabs in the active Sidebar pane

Status: implemented

## Problem

The Sidebar-first navigation introduced in [TaskPilot subagent rows prefer the host Sidebar chat](2026-11-05-taskpilot-subagent-sidebar-navigation.md) passed `preferNewPane: true`, matching the host catalog's trailing-arrow action. On a wide screen this split the right Sidebar and gave the subagent a separate pane. Users instead want to keep the existing Sidebar layout and open the child as another tab in the current pane.

## Decision

TaskPilot's `openSubagent` helper calls `ctx.sidebarRight.openResource` with only `kind: 'subagentchat'`. It no longer requests a new pane. The host's default placement therefore lands a new child chat in the active docked pane, preserves its existing tabs, expands the column when necessary, and reveals an already-open copy of the same child where it currently resides.

The address resolution and conversation-page fallback are unchanged. The host catalog's own Sidebar action is not modified, and TaskPilot does not use `replaceTab`: opening a child must not close the user's current Sidebar tab.

## Alternatives considered

**Keep `preferNewPane: true`.** Rejected because splitting the Sidebar is the layout disruption reported by the user; the host default already provides the requested tab behavior.

**Replace the active Sidebar tab with the child chat.** Rejected because it would destroy the user's current viewing context. The composer dock also has no current Sidebar tab occurrence to supply as a replacement target.

**Change the host catalog to use the same placement.** Rejected as out of scope: this request concerns TaskPilot's rows, and the host's native catalog deliberately keeps its split-pane action.

## Consequences

Opening different subagents adds tabs to the current Sidebar pane instead of creating more panes. Existing Sidebar content stays open. A child already open in another pane is revealed there rather than duplicated or moved; closing that copy before the next click lets the child reopen in the active pane. Users can still split or float a tab through the host's own layout controls.

This note supersedes only the previous note's `preferNewPane` placement. Sidebar-first opening, direct-parent address resolution, and older-host fallback remain in force.

## Testing

`tests/subagent-navigation.spec.ts` pins the exact resource-open options as `{ kind: 'subagentchat' }` for all three address modes, so a later `preferNewPane` reintroduction fails the test. The existing address and fallback cases are unchanged.
