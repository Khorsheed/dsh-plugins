# @khorsheed/dsh-worktrees

[English](README.en.md) | 中文

A git-status visibility plugin for multi-worktree collaboration: a per-session **repo/worktree badge** in the session header, and a **changes drawer** (uncommitted/committed file tree with diffs, IDE-style commit log, full repository browse) behind it. Read-only git facts — it never writes to the repository and does no governance judgment.

## Features

- **Session badge** (header `conversation.session.header.utilities`): the current session's repository, branch, and combined diff line count; hover shows the uncommitted/committed breakdown; green = clean, yellow = changes.
- **Two click zones**: the repository segment opens the drawer in **Repository** mode (full browse); the branch segment opens **Changes** mode.
- **Changes drawer** (frame-wide `shell.overlay`, collapsed by default):
  - **Changes mode**: uncommitted + committed change segments in one file tree (VS Code Source Control style), leaves carry A/M/D/?? badges and line counts; selecting a file shows the right detail pane's `Diff | Content` toggle (colored diff / official CodeBlock); selecting collapses the left tree to an icon rail, click to restore.
  - **Commits mode**: the branch's own log (`main..HEAD`; short sha + subject + relative time); selecting a commit expands its **commit file tree** inline; clicking a file shows that commit's diff.
  - **Repository mode**: the full file list (`git ls-files -co`, tracked + untracked, ignored excluded) as a tree; clicking a file shows its content.
- **Git action row**: refresh / copy branch name / open folder (shown when loopback with `canOpenPath`).
- The tree defaults to the first level only, with expand-all / collapse-all — the whole tree is always reachable. All file lists are fetched once (client-side trie); only per-file diffs are fetched on demand.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-worktrees      # install
dsh plugin --profile web remove @khorsheed/dsh-worktrees   # uninstall
```

## Config

| Field | Default | Description |
|---|---|---|
| `baseRef` | `main` | Base branch for the committed segment (`base...HEAD`) and ahead/behind; `''` disables the committed segment entirely |
| `visiblePresets` | `[]` | Agent-preset ids the session-header badge stays visible for. Absent or empty = always visible (zero behavior change); a non-empty list hides the badge in sessions whose preset id is outside it, while sessions with NO preset stay visible (fail-open: the gate hides dev chrome in non-dev sessions, never breaks preset-less deployments). The config reaches the browser through the Remote's `badgeConfig` method — the web boot hands client entries no config |

## Compatibility

- **npm release line (≥ 0.1.2-rc.1)**: ⚠️ degraded — the badge mounts the `conversation.session.header.utilities` slot (currently empty — zero conflict); the drawer mounts the frame-wide `shell.overlay` (additive list, fresh id). The "open in folder / open in IDE" gestures are hidden on 0.1.2: the host description snapshot no longer carries `canOpenPath` (the capability became an RPC probe), so the loopback gate can never confirm it; restoration is a follow-up against the official `remote.session.canOpenWorkspacePath` RPC seam. minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- **deepseek-harness master**: same slots and service, identical behavior (verifiedHost: 0.1.2-rc.1). Headless profiles have no browser consumer and this plugin contributes nothing there (model tools belong to the governance phase, not yet implemented). The `visiblePresets` gate reads the session's agent preset: on the 0.1.2 line it reads the `projectionValues.agentPreset` session projection, on the 0.1.1 line (npm stable 0.1.1-rc.2) it reads the list row's top-level `agentPreset` field (that line's client row type predates the projection); sessions readable on NEITHER path stay visible (fail-open) — the badge hides only when the session does carry a preset and that preset is outside the list.
