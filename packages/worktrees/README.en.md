# @khorsheed/dsh-worktrees

[English](README.en.md) | 中文

A git-status visibility plugin for multi-worktree collaboration: a per-session **repo/worktree badge** in the session header, and a right-sidebar **worktrees tab** (the selected worktree's pending changes with diffs, IDE-style repository commit log, full repository browse) behind it. Read-only git facts — it never writes to the repository and does no governance judgment.

## Features

- **Session badge** (header `conversation.session.header.utilities`): the current session's branch and combined diff line count; hover shows the uncommitted/committed breakdown; green = clean, yellow = changes. Repository sessions only — the badge used to carry a folder capsule opening the local-files browser; as of 2026-09-10 that workspace capsule left the header (file browsing converged on the local-files plugin's right-sidebar Files card), while the browser surface (`shell.overlay`) stays mounted.
- **One click zone**: the branch capsule opens the right-sidebar worktrees tab (Changes mode).
- **Worktrees tab** (an official right-Sidebar page-type tab, kind `worktrees`, opened through `ctx.sidebarRight.openTab` and also enterable from the sidebar's guide page):
  - **Worktree pending mode**: the currently selected worktree's full uncommitted set (worktree dimension, deliberately NOT session-filtered; picking another worktree in the header switcher repoints the list), VS Code Source Control style, leaves carry A/M/D/?? badges and line counts; selecting a file shows the right detail pane's `Diff | Content` toggle (colored diff / official CodeBlock); selecting collapses the left tree to an icon rail, click to restore.
  - **Repository commits mode**: the branch's own log (`main..HEAD`; short sha + subject + relative time); selecting a commit expands its **commit file tree** inline; clicking a file shows that commit's diff.
  - **Repository mode**: the full file list (`git ls-files -co`, tracked + untracked, ignored excluded) as a tree; clicking a file shows its content.
- **Git action row**: refresh / copy branch name / show in folder (shown when the official open-in-app probe confirms a host file manager).
- The tree defaults to the first level only, with expand-all / collapse-all — the whole tree is always reachable. All file lists are fetched once (client-side trie); only per-file diffs are fetched on demand.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-worktrees      # install
dsh plugin --profile web remove @khorsheed/dsh-worktrees   # uninstall
```

> **The model tool split out (BREAKING)**: the core no longer registers the model-facing `worktrees` tool at the profile root — the tool now rides the companion `@khorsheed/dsh-worktrees-tool`, **granted per session** through agent-preset compositions (migration: install the companion and add `- id: worktrees-tool / name: '@khorsheed/dsh-worktrees-tool'` to the target preset's `agent.cordis.yml`; the web-dev dev preset already carries it). The badge / service / Remote are unchanged; the right-sidebar tab TYPE now self-hides on the same criterion at the REGISTRATION level — the guide enumerates registrations, so hidden means unregistered (opened tabs are stored per session, so an ungranted session's layout never held one).

## Config

| Field | Default | Description |
|---|---|---|
| `baseRef` | `main` | Base branch for the committed segment (`base...HEAD`) and ahead/behind; `''` disables the committed segment entirely |
| `visiblePresets` | `[]` | A **manual override** for badge and right-sidebar tab visibility. Absent or empty = the **composition criterion**: the official `pluginInventory` preset-composition data decides — visible exactly when the current session's preset composition names the `@khorsheed/dsh-worktrees-tool` row; unavailable composition data (no namespace, RPC failure, a missing or broken preset group), sessions with NO preset, and the no-session home state all stay visible (fail-open). A non-empty list falls back to the pilot semantics: sessions whose preset id is outside the list render no badge and register no tab type. The config reaches the browser through the Remote's `badgeConfig` method — the web boot hands client entries no config |

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`)**: ✅ full — the changes/commits/repository view migrated to the official right-sidebar tab surface (a page type registered into `ctx.sidebarRightTabs`, its body in the keyed `sidebar.right.pane.tab` seat, opened from the badge through `ctx.sidebarRight.openTab`); the "show in folder" gesture now rides the official open-in-app route probe (GET `/open-in-app/apps` + POST `/open-in-app/open`, directories only), restoring the gesture 0.1.2 had to hide. The badge stays in `conversation.session.header.utilities`: the 0.1.5 header corner is a single slot the shipped web composition already occupies with ui-sidebar-right's ExpandButton, and single-slot semantics are shadowing (same priority throws at registration, a different priority replaces the occupant) — no coexistence. The badge's and the tab type's default visibility criterion reads the official `pluginInventory` composition data (the tab at the registration level: the guide enumerates registrations, so hidden means unregistered; verified live on 0.1.5: visible on the dev preset, hidden on standard, clean flips). Full build and tests pass; minHost moves up to 0.1.5-rc.1 — older hosts stay on the previous release line.
- **deepseek-harness master**: ✅ (verifiedHost: 0.1.5-rc.1). Headless profiles have no browser consumer and this plugin contributes nothing there. Badge and tab visibility: by default both read the official `pluginInventory.list()` preset-composition data (visible when the session's preset names the `@khorsheed/dsh-worktrees-tool` row); a non-empty `visiblePresets` is a manual override (read from the session's `projectionValues.agentPreset` projection); both paths fail open when the read is unavailable.

**Version-line map**: `0.2.0` and later support host `0.1.5-rc.1` and up; hosts on `0.1.2-rc.1` stay on `0.1.0-rc.9`.
