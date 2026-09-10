# Agent Note: local-files retires the conversation.view tab — the sidebar Files tab is the single surface

Status: implemented

English | [中文](2026-09-10-local-files-conversation-tab-retirement.zh.md)

## Problem

The [naming-split change](../feature/2026-09-10-files-list-naming-and-sidebar-entry.md) left the file browser on two seats: the `conversation.view` tab and the right-Sidebar `files` tab. Once the sidebar tab defaulted to the session workspace (with per-session memory and the back-to-workspace gesture), the conversation tab duplicated it exactly, and the user picked the sidebar as the one home for file browsing.

## Decision

The `conversation.view` registration is removed; the browser mounts only as the right-Sidebar `files` tab. What left with the seat: the `@deepseek-ai/dsh-client-ui-conversation` dependency (peer/dev/inject — it existed only for that SlotMap merge), the top-level `slots` inject (the sidebar registration lives in the nested plugin, which reaches `sub.slots` through ancestor resolution — the ui-file-preview precedent), the composer-overlay bottom clearance (`data-conversation-composer-overlay` and the `--dsh-local-files-bottom-clearance` padding it fed), and the seat-agnostic wording in the contract. The browser body (`WorkspaceView`), the shared `browserFace`, the store, and the remote data plane are untouched. minHost moves to `0.1.5-rc.1`: the sidebar was the only 0.1.5+ surface, and with the conversation tab gone, 0.1.2–0.1.4 hosts get no browser surface at all — the Compatibility tables say so plainly (❌, stay on the previous release line) instead of pretending a degrade.

## Alternatives considered

**Keeping the conversation tab as a second entry.** Rejected by the user: two homes for one browser is exactly the duplication the naming split was cleaning up.

**Keeping minHost at 0.1.2-rc.1 because the host half still loads there.** Rejected: a plugin whose only surface is a sidebar tab does nothing on a host without the right Sidebar — an installable-but-invisible package is worse than an honest floor.

## Consequences

One plugin = one surface = one name (文件列表 / Files). The client bundle sheds the conversation.seat typing and the ui-conversation dependency edge; `inject` is down to `['remote', 'locale']`. On 0.1.2–0.1.4 hosts the plugin now contributes nothing — callers on those lines must stay on the old release (none exists on npm yet; the package is unpublished, so the retirement ships before anyone could depend on the tab). Tests: the suite pins the sidebar definition and the WorkspaceView behavior (26 tests green); no test referenced the removed seat. The related [feature note](../feature/2026-09-10-files-list-naming-and-sidebar-entry.md) is updated to the single-surface reality.
