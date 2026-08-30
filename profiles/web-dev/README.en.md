# dsh-web-dev

[中文](README.md) | English

**Direct a team of agents to write code, and see exactly what they changed.** Delegate tasks to the coding agents installed on your machine — Kimi Code, Codex, Claude Code, or dsh itself — each with its own context and accounting; which branch a change landed on, which files moved, what each commit did, all visible inside the session; and several agents can collaborate in one conversation. The full baseline experience (message editing, artifact preview, task capsules) is included.

<!-- screenshot placeholder: docs/screenshots/web-dev-overview.png (pending) -->

> **Status**: pre-release. 13 of the 21 members are not on npm yet, so installation currently builds from [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) source (see [Install](#install)).

## Relationship to dsh-web-basic

**These are two profiles. You switch between them; you do not stack them.**

`dsh-web-basic` is the everyday mode: it completes dsh's Web GUI. `dsh-web-dev` is the development mode: the same baseline plus multi-agent delegation, live git state, and multi-agent rooms. You do not install the plugins twice — the two profiles are independent, and one command switches between them:

```sh
sh scripts/restart-into-web-dev.sh          # switch to development mode
# switch back with the matching script in the dsh-web-basic repo
```

The switch is a **same-port handover**: refresh the original address, no new port to remember. A preflight runs first — if the target composition cannot boot, the running instance is never stopped, and you stay where you were.

**Session data is unaffected**: sessions live in `$DSH_HOME/sessions/`, at home level, belonging to no profile. Switch away and back, and your history is still there.

## Install

**With an Agent (recommended)**: after installing [dsh](https://github.com/deepseek-ai/deepseek-harness), tell your agent:

> **Install this for me: https://github.com/Khorsheed/dsh-web-dev**

It will follow the agent install guide below, self-check, and hand the running instance over on the same port — you only need a hard refresh (Cmd/Ctrl+Shift+R) afterwards.

**Manual install**:

```sh
git clone https://github.com/Khorsheed/dsh-web-dev.git
sh dsh-web-dev/scripts/install.sh              # copy the profile into $DSH_HOME and install it
sh dsh-web-dev/scripts/restart-into-web-dev.sh  # hand the running instance over on the same port
```

<details>
<summary><strong>Agent install guide</strong> (follow this when a user says "install this for me")</summary>

Three stages, none of which needs browser-level verification.

**1. Install and self-check offline (leaves the running instance alone)**

```sh
git clone https://github.com/Khorsheed/dsh-web-dev.git /tmp/dsh-web-dev
sh /tmp/dsh-web-dev/scripts/install.sh
```

`install.sh` prints the composed row count. To verify by hand: `dsh --profile web-dev --dump-config | grep -c "@khorsheed"` should be 21. When `dsh` is not on PATH, use its full path (readable from the running instance's launch command via `ps`).

**2. Same-port handover (the critical step)**

```sh
sh /tmp/dsh-web-dev/scripts/restart-into-web-dev.sh [port, default 3080]
```

The script goes through the ankh-guard path: environment probe → credential record → preflight → watchdog stop-and-start with canary verification. **You will disconnect along with the host instance — this is expected.** The watchdog brings web-dev up on the original port. The script deliberately omits `--initiator`: the guard reads `$DSH_SESSION_ID` from your environment so the restart report can address your session, and you receive the "restart complete" followup when the user reopens it.

**3. Tell the user to hard-refresh**

The client bundles changed, so the browser needs Cmd/Ctrl+Shift+R.

</details>

## What is included

21 members across three layers:

**Baseline experience** (the same 12 as dsh-web-basic): message edit/withdraw/restore, history timeline, inline session-title editing, file preview (service + UI), local file browser, background task capsules, context-compaction reminder, inline HTML cards, capability catalog, shortcuts, ambient task feedback. Each is introduced in [dsh-web-basic's README](https://github.com/Khorsheed/dsh-web-basic#功能展示).

**Development capabilities** (the 8 unique to this profile): see [Features](#features).

**Operational guard**: `ankh-guard` — the safety gate for same-port handover and self-modifying restarts, which the switch scripts above run through.

## Features

### Local agent family: delegate to other coding agents

Delegate subtasks to the coding agent CLIs on your machine — Kimi Code, Codex, Claude Code, and dsh itself. Each harness runs under its own scoped home (`$DSH_HOME/local-agent/<name>`, mode 0700), and **never touches the private configuration and credentials in your user directory**.

- **Separate context and accounting**: a child session's tokens and KV cache never enter the parent; every delegation is accounted from real usage.
- **Resume across turns**: pass the child session id back to continue inside the same CLI session.
- **Live mode**: output streams into the member session, cancelling does not kill the process, and a crash resumes the session.
- **Two-way member channel**: open a member's sub-session to continue it directly; members can also notify each other.

<!-- screenshot placeholder: docs/screenshots/local-agent-delegation.png (pending) -->

### worktrees: live git state

A repo/worktree badge sits at the top right of every session, showing the current repository, branch, and combined diff size (green = clean, yellow = dirty). Opening it reveals the change drawer: uncommitted and committed file trees with diffs, an IDE-style commit log, and full repository file browsing. It displays git facts read-only and never writes to the repository.

<!-- screenshot placeholder: docs/screenshots/worktrees-drawer.png (pending) -->

### room: several agents inside one session

Invite an agent into any session and that session becomes a room: member tab, @-dispatch, multi-member capsules, a task board, and a notification gate. Members can summon each other, and progress stays visible on one conversation thread.

<!-- screenshot placeholder: docs/screenshots/room-members.png (pending) -->

## Install and remove members freely

Every member can be removed on its own, through the host's official verb — not a switch this profile invented:

```sh
dsh --profile web-dev plugin rm @khorsheed/dsh-whalesong    # remove
dsh --profile web-dev plugin add @khorsheed/dsh-whalesong   # add back
```

Removal restores exactly: no plugin modifies or replaces an official file, so the composition returns precisely to its prior state. Restart the instance for changes to take effect.

## Removing the whole profile

```sh
rm -rf "$DSH_HOME/profiles/web-dev"
```

Session data lives in `$DSH_HOME/sessions/` and does not go with the profile.

## License

[MIT](LICENSE)
