# dsh-web-dev

[中文](README.md) | English

**Direct a team of agents to write code, and see exactly what they changed.** Delegate tasks to the coding agents installed on your machine — Kimi Code, Codex, Claude Code, or dsh itself — each with its own context and accounting; which branch a change landed on, which files moved, what each commit did, all visible inside the session; and several agents can collaborate in one conversation. The full baseline experience (message editing, artifact preview, task capsules) is included.

<!-- screenshot placeholder: docs/screenshots/web-dev-overview.png (pending) -->

> **Status**: pre-release. 13 of the 21 members are not on npm yet, so installation currently builds from [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) source (see [Install](#install)).

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

## Update

When the member list changes, pull and run the updater:

```sh
cd dsh-web-dev && git pull
sh scripts/update.sh
sh scripts/restart-into-web-dev.sh
```

`update.sh` overwrites `package.json` and the lockfile only — it **never touches your `cordis.patch.yml`**, which is your layer.

## Switching modes

```sh
sh scripts/restart-into-web-dev.sh          # switch to this profile, port 3080 by default
sh scripts/restart-into-web-dev.sh 3090     # pick a port
```

To switch to another profile, run the matching script in its own repo. The switch is a same-port handover: refresh the original address.

Installing several profiles: clone each and run its own `install.sh` — they do not interfere; **switch on the same port with each pack's restart script**, so there is no port to remember. With several installed, a membership update runs `update.sh` once per profile.

Sessions live in `$DSH_HOME/sessions/`, and credentials and shortcuts live under `$DSH_HOME` — **all shared across profiles**: log into Kimi under one and the next already has it.

> Running two instances over one `$DSH_HOME` is not recommended: they share session data and there is no cross-process write protection. Give a long-lived isolated instance (an evaluation one, say) its own `$DSH_HOME`.

## What is included

21 members across three layers:

**Baseline experience** (the same 12 as dsh-web-basic): message edit/withdraw/restore, history timeline, inline session-title editing, file preview (service + UI), local file browser, background task capsules, context-compaction reminder, inline HTML cards, capability catalog, shortcuts, ambient task feedback. Each is introduced in the [baseline member notes](https://github.com/Khorsheed/dsh-web-basic#功能展示).

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

## Adding and removing single members

```sh
dsh --profile web-dev plugin rm  @khorsheed/dsh-whalesong   # remove
dsh --profile web-dev plugin add @khorsheed/dsh-whalesong   # add back
sh scripts/restart-into-web-dev.sh                          # restart to apply
```

## Custom agent presets

This profile runs the official Standard preset. To build your own: **Settings → Agent presets** → copy a built-in preset and edit it, or use "create with Creation mode" at the bottom to have an agent build it with you. Your presets live in `$DSH_HOME/.agent-presets/` and are unaffected by updates to this profile.

## Removing the whole profile

```sh
rm -rf "$DSH_HOME/profiles/web-dev"
```

Session data lives in `$DSH_HOME/sessions/` and does not go with the profile.

## Related packs

| Pack | Role |
|---|---|
| [dsh-web-basic](https://github.com/Khorsheed/dsh-web-basic) | Everyday mode: the baseline experience only, without the development capabilities |

## License

[MIT](LICENSE)
