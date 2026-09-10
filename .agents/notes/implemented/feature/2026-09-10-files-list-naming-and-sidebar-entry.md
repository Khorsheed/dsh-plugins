# Agent Note: Files-list naming split — header workspace capsule removed, local-files takes over the sidebar files card

Status: implemented

English | [中文](2026-09-10-files-list-naming-and-sidebar-entry.zh.md)

## Problem

Three pieces of user feedback converged on one confusion: our file browser presented itself as "工作区 / Workspace" while the official 0.1.5 surfaces claim that word — the session's workspace is the official sidebar's `工作区文件` card (`dsh-client-ui-sidebar-files`, workspace-scoped) and the official workspace switcher. Concretely: the session header carried a workspace capsule (folder icon + directory name, from the worktrees badge's left zone) duplicating file-browsing entries; our `conversation.view` tab was named 工作区; and the right-sidebar guide's 工作区文件 card looked like ours but is the official package's, which we neither can nor want to rename.

## Decision

The naming split: **工作区 / workspace stays with the official surfaces; our browser is 文件列表 / Files** — a git-agnostic browse of ANY directory, any time.

- **worktrees**: the badge's left (folder) capsule is removed — the header keeps only the branch capsule, and non-repo sessions now render no badge at all (the capsule was its only content there). The capsule was the badge's only opener for the local-files browser, but the browser surface itself (`shell.overlay`, with its workspace switcher and native directory picker) stays mounted per the explicit instruction to lose no capability. `aria.openLocal` / `local.title` leave the dictionary with it.
- **local-files**: the `conversation.view` tab label becomes 文件列表 / Files, and the browser additionally registers as a page-type right-sidebar tab. The kind is the official files type's OWN (`files`): `ui-sidebar-right`'s registry admits one `extension` registration per `builtin` kind and puts the extension in force — claims, `get`, the guide page, and the body/title seat lookup all follow the in-force definition, and the shadowed builtin resumes when the extension unregisters (verified in tab-registry.ts; this is NOT the utilities-list same-id double-render trap agent-32 hit — ids stay unique, the kind is the designed takeover channel). The guide therefore shows ONE files card — ours (官方 coloured folder glyph, order 40) — and the official workspace card disappears while we are installed. The default root is the session's workspace, read reactively from the session row's `cwd` (`useSessions`, the same read the official files tree makes), filling in when the row loads late; a manually chosen directory is remembered per session (`localStorage dsh-local-files-root:<sessionId>`) and restored across tab reopens and reloads. A toolbar 返回本工作区 button jumps to the current session's workspace root, hidden while already there.
- Old hosts keep working: the sidebar registration is a nested `ctx.plugin` pended on `sidebarRightTabs` (the ui-file-preview `documentPreviews` precedent — a composition without the service never activates it), so minHost stays 0.1.2-rc.1 and 0.1.2–0.1.4 hosts keep the conversation tab as the only entry.

The root memory stays PER-SESSION, not global: both seats are session-scoped surfaces, and a global memory would open session B's file list at whatever directory session A browsed last — contradicting the default-to-workspace contract exactly where sessions differ. Per-session memory still satisfies "remember my choice" across reopens and reloads, and 返回本工作区 always means the CURRENT session's workspace.

One typing fact fell out: `WorkspaceView`'s props no longer ride `PropsRuntime<'conversation.view'>` — that seat's owner share carries view-switching props the sidebar seat does not provide. The runtime share is spelled structurally (`sessionId` plus the `GlobalStandardProps` seat that brings `useSessions`), which fits both seats.

## Alternatives considered

**Renaming the guide card the user pointed at.** Impossible and unwanted: it belongs to the official `ui-sidebar-files` (workspace-scoped by design); the harness checkout is read-only. The follow-up question — can we shadow it — answered itself in the registry source: kind-level extension-over-builtin is a designed takeover channel with clean resume-on-uninstall, so the guide carries one files card while we are installed.

**A separate kind (`local-files`) alongside the official card.** Rejected once the shadowing mechanism was confirmed: the user wants one files card in the guide, and our browser (workspace default + any directory) is a functional superset of the official card's job.

**Global root memory ("remember last", period).** Rejected: the surfaces are session-scoped, and a global root would drag every session into the last-browsed directory of whichever session was active before — the workspace default exists precisely because each session has its own. Per-session memory keeps "remember my choice" honest without cross-session surprise.

**A disabled back-to-workspace button while at the workspace.** Rejected in favor of hiding: the action row already conditionally renders the open-in-app gestures, so a hidden button is the consistent local grammar.

**Keeping the capsule but renaming its label.** Rejected: the user's decision was removal — the header keeps worktrees' branch capsule only, and file browsing converges on the sidebar / conversation tab.

**Dropping the `shell.overlay` browser with its opener.** Rejected by instruction: the drawer keeps the workspace-switch and native-picker capabilities; only the header mount point left.

**Declaring `sidebarRightTabs` in the top-level inject (the worktrees / ui-file-preview pattern).** Rejected: those packages moved minHost to 0.1.5 with the sidebar; local-files keeps 0.1.2 compatibility, so the registration must pend invisibly instead of pending the whole plugin.

## Consequences

Every file-browsing entry now answers to one name (文件列表 / Files) in two places (conversation tab, sidebar guide — one card, the official workspace card shadowed); the header lost a capsule and non-repo sessions lost the badge entirely — an intentional subtraction. The `shell.overlay` browser is mounted but has no opener until a future surface calls `worktreesPanel.openLocalFiles` — kept deliberately, flagged here so nobody reads it as dead code. Coverage: the badge spec pins the non-repo null render; `tests/definition.client.spec.ts` pins the tab type's identity, page shape, the `files`-kind takeover, and guide entry; `tests/workspace-view.client.spec.tsx` pins root defaulting (workspace cwd, remembered wins, late-arriving session row fills in, manual choice never overridden) and the back-to-workspace button's visibility and click; the zh/en dictionaries stay key-synced. The deployed-3092 verification (capsule gone, one files card, default root, back-to-workspace) is owner-run — this change was verified statically and by unit tests only.
