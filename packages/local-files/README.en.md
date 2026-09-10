# @khorsheed/dsh-local-files

[English](README.en.md) | 中文

A standalone workspace file-browser plugin: adds a **Workspace tab** to the session view ring, browsing the current session's workspace filesystem git-agnostically (lazy-loading file tree + structured HTML/Markdown/JSON/CSV/image previews). The data plane rides its own Typert Remote, decoupled from worktrees' git badge — worktrees only shows git status; this plugin only does plain local-file browsing.

## Features

- **Workspace tab** (`conversation.view` list entry, parallel to chat / products / worktrees): left file tree (lazy per-level loading, show/hide dot-files, toggle, draggable width) + right detail pane (structured HTML/Markdown/JSON/CSV preview + image preview).
- **Breadcrumb top bar + action row**: breadcrumbs navigate by level; the action buttons are "Choose Directory" (native directory picker), "Open Folder" (shown when the host's open-in-app probe resolved a file manager), and "Refresh".
- **Git-agnostic**: it browses any absolute local path (including untracked, ignored, and git-external files), with no repository judgment.
- **Per-session memory**: each session remembers its last-browsed root (localStorage `dsh-local-files-root:<sessionId>`); switching sessions restores it automatically without cross-talk.

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
| npm release (`0.1.2-rc.1` … `0.1.4.x`) | ⚠️ degraded — the external-open gestures stay hidden (the host has no open-in-app routes) |
| deepseek-harness master | ✅ full (open-in-app landed with 0.1.5; `verifiedHost: 0.1.2-rc.1`) |

- The Workspace tab is a web surface; on headless profiles with no browser consumer the plugin contributes nothing.
- The "open in folder / open in IDE" gestures are restored through the official open-in-app capability: the browser probes `GET /open-in-app/apps` once per page and shows a gesture only when the host resolved a backing app (file manager, resp. editor/IDE); the official open route accepts directories only, so a file gesture opens its containing directory. Hosts without open-in-app (< 0.1.5) fail the probe and keep the gestures hidden — a silent degrade, so minHost does not move.
- minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.

> Nuance: this plugin is "browse any local directory"; file-preview is "current session's products". Their semantics differ, so they are two independent packages, not merged.
