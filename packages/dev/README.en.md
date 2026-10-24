# @khorsheed/dsh-dev-suite

English | [中文](README.md)

A mode for writing code in DSH: hand work to the Codex, Claude Code or Kimi on your own machine, let several agents split a job in one session, and always see which branch you're on.

Getting your local Codex or Claude Code to help used to mean opening a terminal, copy-pasting, and carrying the result back; with a few worktrees open, you had to run git just to know which branch this session was pointed at. In dev mode, say "give this to Codex" and it runs on your machine, with the whole process visible in a sub-session; the session header shows the branch and how many lines changed; when the job gets big, invite a few agents to split it up, and acceptance is still your call.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/dev-mode.png" width="640" alt="A dev-mode session: a room inviting members, the branch badge and changes drawer in the session header, sub-agent task capsules above the input box">

## Things you can say to the agent

- "Hand this parser bug to Codex, and tell me which files it changed."
- "Make a new worktree for the login page refactor and work there; leave main alone."
- "Bring in Claude Code and Kimi: Claude Code writes it, Kimi adds tests, you coordinate, and show me the evidence."
- "Which worktrees does this repo have, and which ones have uncommitted changes?"

## What's inside

- **Your local coding tools** (Kimi, Codex, Claude Code): name who should do it and the agent passes the work along; you watch it live, stop it midway, or keep the conversation going.
- **Local DSH Delegation**: hand a subtask to a separate DSH running on its own. Off by default; turn it on in the "Local DSH Delegation" card in settings.
- **Room**: press "＋ Invite agent" and the session becomes a small team; @ someone to give them work, the coordinator splits tasks, members hand in evidence.
- **Worktrees**: the session header shows the current branch and changed lines; open it for pending changes and commit history. The agent can also create, switch and remove worktrees, and one with uncommitted changes is never removed.
- **TypeSafe**: for yes/no or pick-one calls, the agent gets an answer with a confidence attached instead of a paragraph to read through.
- **Ankh Guard**: when the agent wants to restart after changing code, it checks that the build and tests pass first, so broken code can't take your ongoing conversation down with it.
- **Context Lens**: see exactly what each request sent to the model and how many tokens it took.

Everything from the standard mode is still there: planning, compaction, sub-agents, web search.

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-dev-suite
```

It's best to also install `@khorsheed/dsh-basic` (Basic Essentials), which carries everyday things like editing messages and previewing files. Then start a new session, pick "开发模式" (dev mode), and tell the agent what you want to build.

All of this only shows up in dev-mode sessions; not seeing it in other modes is expected.

## Known limitations

- Kimi, Codex and Claude Code have to be installed and signed in by you; this suite doesn't do it.
- TypeSafe needs a TypeSafe key; without one it simply reports that it can't answer, nothing breaks.
- Ankh Guard only works on an instance supervised by a watchdog.

## Compatibility

Needs DSH 0.1.7 or later; verified on 0.2.1.

## For developers

Command-line install (same result as above):

<!-- collection:start -->
Recommended: install it together with the basic suite (the Dev collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-dev-suite
```
<!-- collection:end -->

- This package has no features of its own; it installs dev mode and the members above together. Uninstalling (`dsh plugin --profile web remove @khorsheed/dsh-dev-suite`) removes them together too; to turn off just one, switch it off on the suite's detail page.
- Each member's details are in its own README: [packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
