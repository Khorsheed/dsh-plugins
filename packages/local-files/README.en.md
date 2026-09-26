# @khorsheed/dsh-local-files

[English](README.en.md) | 中文

A standalone file-browser plugin: a **Files tab** in the right sidebar (entered from the guide page's "Files" card) — browsing any local directory git-agnostically (lazy-loading file tree + structured HTML/Markdown/JSON/CSV/image previews), defaulting to the current session's workspace but not limited to it. The data plane rides its own Typert Remote, decoupled from worktrees' git badge — worktrees only shows git status; this plugin only does plain local-file browsing.

## Features

- **Files tab** (a page-type `sidebar.right.pane.tab`, entered from the guide page's "Files" card): left file tree (lazy per-level loading, show/hide dot-files, toggle, draggable width) + right detail pane (structured HTML/Markdown/JSON/CSV preview + image preview; the title row's "Reload" gesture re-reads the current file — on-disk changes land without reselecting, and a failed re-read keeps the old content and reports through the existing error slot). The registration takes over the official `files` kind (the registry's designed extension-over-builtin shadowing), so the guide page shows a single files card — ours; the official "Workspace files" card resumes when this plugin unregisters.
- **Default root = the session's workspace**: same data source as the official files tree (the session row's `cwd`, read reactively — a late-loading row fills in); a manually chosen directory is remembered per session (localStorage `dsh-local-files-root:<sessionId>`) and restored across tab reopens and page reloads; the toolbar's "Back to original workspace" jumps to the current session's workspace root (hidden while already there).
- **Breadcrumb top bar + action row**: breadcrumbs navigate by level; the action buttons are "Choose Directory" (native directory picker), "Back to original workspace", "Open Folder" (shown when the host's open-in-app probe resolved a file manager), and "Refresh".
- **Git-agnostic**: it browses any absolute local path (including untracked, ignored, and git-external files), with no repository judgment.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-local-files      # install
dsh plugin --profile web remove @khorsheed/dsh-local-files   # uninstall
```

## Data plane

The host provides three pure `@Remote` methods — `listLocalDirectory` / `readLocalFile` / `readLocalImage` (namespace `localFiles`, global, no agent param) — mounted by the client through the official `ctx.remote.$mount` channel. Paths must be absolute (`assertSafeLocalPath` rejects empty, relative, and `..`-traversal shapes).

## Config

No config. It installs standalone as a plugin, or drops into a cordis.yml composition as a simple mount.

## Compatibility

| Host line | Verdict |
| --- | --- |
| npm release (`>= 0.1.5-rc.1`) | ✅ full |
| npm release (`0.1.2-rc.1` … `0.1.4.x`) | ❌ no browser surface — the only entry is the right-sidebar tab (0.1.5+); stay on the previous release line |
| deepseek-harness master | ✅ full (`verifiedHost: 0.1.5-rc.1`) |

- The right-sidebar tab is a web surface; on headless profiles with no browser consumer the plugin contributes nothing. The registration is straight-line into `ctx.sidebarRightTabs` (declared in the top-level inject) and takes over the official `files` kind at the extension band (the registry's built-in per-kind shadowing: the guide lists only in-force types, and the official card resumes on uninstall).
- The "open in folder / open in IDE" gestures ride the official open-in-app capability: the browser probes `GET /open-in-app/apps` once per page and shows a gesture only when the host resolved a backing app (file manager, resp. editor/IDE); the official open route accepts directories only, so a file gesture opens its containing directory. A failed probe keeps the gestures hidden — a silent degrade.
- minHost moves up to 0.1.5-rc.1 with the conversation.view tab's retirement (that tab was the only entry on 0.1.2–0.1.4).

> Nuance: this plugin is "browse any local directory"; file-preview is "current session's products". Their semantics differ, so they are two independent packages, not merged.
