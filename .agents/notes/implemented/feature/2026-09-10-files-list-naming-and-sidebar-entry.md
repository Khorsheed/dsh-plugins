# Agent Note: Files-list naming split — header workspace capsule removed, local-files gains a right-sidebar entry

Status: implemented

English | [中文](2026-09-10-files-list-naming-and-sidebar-entry.zh.md)

## Problem

Three pieces of user feedback converged on one confusion: our file browser presented itself as "工作区 / Workspace" while the official 0.1.5 surfaces claim that word — the session's workspace is the official sidebar's `工作区文件` card (`dsh-client-ui-sidebar-files`, workspace-scoped) and the official workspace switcher. Concretely: the session header carried a workspace capsule (folder icon + directory name, from the worktrees badge's left zone) duplicating file-browsing entries; our `conversation.view` tab was named 工作区; and the right-sidebar guide's 工作区文件 card looked like ours but is the official package's, which we neither can nor want to rename.

## Decision

The naming split: **工作区 / workspace stays with the official surfaces; our browser is 文件列表 / Files** — a git-agnostic browse of ANY directory, any time.

- **worktrees**: the badge's left (folder) capsule is removed — the header keeps only the branch capsule, and non-repo sessions now render no badge at all (the capsule was its only content there). The capsule was the badge's only opener for the local-files browser, but the browser surface itself (`shell.overlay`, with its workspace switcher and native directory picker) stays mounted per the explicit instruction to lose no capability. `aria.openLocal` / `local.title` leave the dictionary with it.
- **local-files**: the `conversation.view` tab label becomes 文件列表 / Files, and the browser additionally registers as a page-type right-sidebar tab (kind `local-files`): the definition into `ctx.sidebarRightTabs`, the body (the same `WorkspaceView`) into the keyed `sidebar.right.pane.tab` seat. The guide card reuses the official coloured folder sheet (`FileTypeIcon kind="folder"`, the official files card's own glyph) at order 40 — after the official files card (10), products (20), worktrees (30) — with the description carrying the semantic split (any directory, not just the workspace).
- Old hosts keep working: the sidebar registration is a nested `ctx.plugin` pended on `sidebarRightTabs` (the ui-file-preview `documentPreviews` precedent — a composition without the service never activates it), so minHost stays 0.1.2-rc.1 and 0.1.2–0.1.4 hosts keep the conversation tab as the only entry.

One typing fact fell out: `WorkspaceView`'s props no longer ride `PropsRuntime<'conversation.view'>` — that seat's owner share carries view-switching props the sidebar seat does not provide. The runtime share is now spelled structurally (the view consumes only `sessionId`), which fits both seats.

## Alternatives considered

**Renaming the guide card the user pointed at.** Impossible and unwanted: it belongs to the official `ui-sidebar-files` (workspace-scoped by design); the harness checkout is read-only, and renaming it would also contradict the split — that card SHOULD keep 工作区文件.

**Keeping the capsule but renaming its label.** Rejected: the user's decision was removal — the header keeps worktrees' branch capsule only, and file browsing converges on the sidebar / conversation tab.

**Dropping the `shell.overlay` browser with its opener.** Rejected by instruction: the drawer keeps the workspace-switch and native-picker capabilities; only the header mount point left.

**Declaring `sidebarRightTabs` in the top-level inject (the worktrees / ui-file-preview pattern).** Rejected: those packages moved minHost to 0.1.5 with the sidebar; local-files keeps 0.1.2 compatibility, so the registration must pend invisibly instead of pending the whole plugin.

## Consequences

Every file-browsing entry now answers to one name (文件列表 / Files) in two places (conversation tab, sidebar guide); the header lost a capsule and non-repo sessions lost the badge entirely — an intentional subtraction. The `shell.overlay` browser is mounted but has no opener until a future surface calls `worktreesPanel.openLocalFiles` — kept deliberately, flagged here so nobody reads it as dead code. Coverage: the badge spec pins the non-repo null render; `tests/definition.client.spec.ts` pins the tab type's identity, page shape, and guide entry; the zh/en dictionaries stay key-synced. The deployed-3092 verification (capsule gone, card renders, both entries open the browser) is owner-run — this change was verified statically and by unit tests only.
