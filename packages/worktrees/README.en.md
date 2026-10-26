# @khorsheed/dsh-worktrees

English | [中文](README.md)

Which branch this session is working on and how much is still uncommitted — one glance at the header tells you.

With several worktrees going at once, finding out which branch the current session is on and how much it has changed used to mean switching to a terminal and running git. With Worktrees installed, the session header gets a small branch tag showing the branch name and changed line counts, and it changes color when there are uncommitted changes; click it and the right sidebar opens the changes, the commit log and every file in the repository. What you get is the state of git without leaving the conversation — and when you spot something to fix, you fix it there.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/pilot-badge-standard.png" width="640" alt="The branch tag in the session header's top-right corner: branch name with changed lines +175 −34, next to the repository name">

## What it does

- **See where you're working at a glance**: the header tag shows the branch name and changed line counts, turns to a warning color when there are changes, and shows the breakdown on hover.
- **One click to the changes**: click the tag to open the "Worktrees" page in the right sidebar; "Worktree pending" lists every uncommitted file — pick one to see its diff or its current content.
- **The commit log and the whole repo too**: in "Repository commits", pick a commit to see the files it changed and what each became; "Repository" lets you browse every file in the repo, with images shown inline; local images and links inside a document show and open too.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/worktrees-tab.png" width="640" alt="The right sidebar's Worktrees page, Worktree pending: the changed-file tree on the left, the selected file's colored diff on the right">

- **Spot it, fix it**: in the "Content" view, click "Edit", make the change and save with ⌘S or "Save" — it is written to the worktree and the change list on the left updates. If the agent changed the file while you were editing, you're told and choose to overwrite or discard.
- **Move to another worktree**: pick one with "Switch worktree" at the top, then "Switch to this worktree", and the agent works in the new directory from its next turn on — without interrupting what it's doing.
- **The agent can manage worktrees for you**: ask it in the conversation to list, create, switch or remove worktrees; it always asks before removing one, and it can't remove the main checkout or a worktree with uncommitted changes.

## Install

In DSH, open Plugins → Add plugin, enter the package name below and click install:

```
@khorsheed/dsh-worktrees
```

It also comes with 开发套件 (the dev suite, `@khorsheed/dsh-dev-suite`). Once installed, open a session in "开发模式" (dev mode) inside a git repository and the branch tag appears in the top-right of the session header. Not seeing the tag in other modes is expected.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/pilot-badge-other-preset.png" width="640" alt="A session in another mode (极简模式, minimal mode) has no branch tag or Worktrees page; the session header shows only DSH's own buttons">

## Known limitations

- The tag doesn't refresh continuously: it updates when a turn ends, when you send a message or when you return to the window, so a change you just made in a terminal shows up a moment later.
- Files over 2 MB aren't previewed; on a phone it is view-only, and content from past commits is read-only.

## Compatibility

Requires DSH 0.1.5 or later; verified on 0.2.1.

## For developers

- Entry points: `src/index.ts` (the git service), `src/tool.ts` (the worktree tool agents use), `src/client/index.ts` (the tag and the sidebar page). Installed on its own (`dsh plugin --profile web add @khorsheed/dsh-worktrees`), the worktree tool must be granted by a mode, and the tag and page show only in that mode's sessions; don't add the plugin again to a configuration that already mounts it.
- Configuration, the path-based query and switch surface for server-side callers, compatibility details and internals are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/worktrees/docs/reference.en.md).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) — issues and contributions go there; changes are in [CHANGELOG.md](CHANGELOG.md).
