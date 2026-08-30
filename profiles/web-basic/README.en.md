# dsh-web-basic

[中文](README.md) | English

**One profile, and your dsh web GUI feels finished.** Edit or withdraw sent messages, jump through long conversations, preview every file the agent touched, watch background jobs at a glance, get nudged before context runs out — the quality-of-life layer most users reach for first, installed in one go.

## Install

**With an agent (recommended)**: once you have [dsh](https://github.com/deepseek-ai/deepseek-harness), just tell it:

> **Install this for me: https://github.com/Khorsheed/dsh-web-basic**

It will follow the "Install guide for agents" below — install, self-check, and hand your current instance over to the pack on the same port. All you do is hard-refresh (Cmd/Ctrl+Shift+R) when it's done.

**Manual install**: no agent? Run three commands yourself:

```sh
git clone https://github.com/Khorsheed/dsh-web-basic.git
sh dsh-web-basic/scripts/install.sh   # copies the profile into $DSH_HOME and installs
sh dsh-web-basic/scripts/restart-into-web-basic.sh   # hands the running instance over to the pack on the same port
```

`restart-into-web-basic.sh` stops your current instance and brings web-basic up **on the same port** — just refresh the browser tab you already have. To run the pack side by side instead, boot it on a different port: `dsh --profile web-basic --port 3090`.

> **Status**: all 10 member plugins are live on npm (0.1.0).

<details>
<summary><strong>Install guide for agents</strong> (follow this when the user says "install this for me")</summary>

When the user asks you to install https://github.com/Khorsheed/dsh-web-basic, run the three stages below. No browser-level verification is needed anywhere.

**1. Install and self-check offline (do not touch the running instance)**

```sh
git clone https://github.com/Khorsheed/dsh-web-basic.git /tmp/dsh-web-basic
sh /tmp/dsh-web-basic/scripts/install.sh
```

The installer prints the composed row count. To double-check: `dsh --profile web-basic --dump-config | grep -c "@khorsheed"` should print 10 (ankh-guard / context-guard / file-preview / message-timeline / message-tools / session-title-edit / taskpilot / ui-file-preview / ui-shortcuts / whalesong). If `dsh` is not on PATH, use its absolute path (find it via `ps` from the current instance's command line).

**2. Hand over on the same port (the critical step)**

```sh
sh /tmp/dsh-web-basic/scripts/restart-into-web-basic.sh [port, default 3080]
```

The script drives the pack's own ankh-guard watchdog: environment probe → record a credential → adopt the current instance → watchdog stops the old one and boots the pack with a canary. **You will disconnect with the host — that is expected**: the watchdog brings web-basic up on the original port. The script deliberately omits `--initiator` so the guard reads `$DSH_SESSION_ID` from your environment — that is how the restart report finds your session: when the user reopens it, you receive the "restart complete" followup and continue. Note: snapshot-based continuation of interrupted turns needs the guard already mounted in the old instance (absent on a first install); that part exists from the second restart onward.

Two prerequisites — the script refuses early with a reason if either is missing:

- **Session permissions**: in a sandboxed session (writes fenced to the workspace), the detached watchdog gets reaped when the turn ends and the script refuses up front. Ask the user to switch to full-access mode (or hand them the command to run in a plain terminal).
- **Do NOT substitute `nohup ... &` or a hand-rolled `kill` + restart**: sandboxes reap by process tree, nohup does not protect against that, and a wrong stop/start order never comes back.

**3. Deliver**

Once `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/` returns 200, ask the user to **hard-refresh** (Cmd/Ctrl+Shift+R) — the new client bundles (the Produced tab, the dock pills, …) only load on a hard refresh; a plain reload may keep serving the cached shell. Then present the feature list (the README "What's inside" table): message edit/withdraw/restore, history timeline, inline title editing, artifact previews, background-job pills, context-compaction reminder, rebindable shortcuts, the whalesong ambience, and the ops guard. Known boundary: on a pure-npm deployment ankh-guard's composition preflight runs degraded (it warns and proceeds); everything else is fully functional.

</details>

## What's inside

| Plugin | What you get |
|---|---|
| message-tools | Edit, withdraw, and restore messages you already sent |
| message-timeline | A quiet timeline on the chat's left edge — hover to expand, click to jump |
| session-title-edit | Rename sessions inline in the chat header |
| file-preview + ui-file-preview | A Produced tab: preview every file the session touched, no IDE needed |
| taskpilot | Background jobs and sub-agents become pills above the composer — stop/interrupt in one click |
| context-guard | A compact button shows up before context overflow starts rejecting requests |
| ui-shortcuts | Esc to pause, Ctrl/Cmd+S to steer-send, Ctrl/Cmd+O for a new session — all rebindable |
| whalesong | Sidebar whale spouts while tasks run; a chime when they finish |
| ankh-guard | Ops assistant: when the agent wants to restart after changing code, it verifies the build and tests first — and rolls back if the boot fails |

Every member is an independent plugin: the pack just installs them together, and each can be removed or added on its own (see [Make it yours](#make-it-yours)). Each section below carries its standalone install command — if you want just one plugin without the pack, that one line is all you need.

## The tour

### message-tools — edit, withdraw, restore

Every user message carries a copy/edit/withdraw action row. Edits replace in place and re-send as a new message; a withdraw is real — the message and everything after it leaves the model's context, folding into an expandable divider with the original text refilled into your draft; one click restores them to the end of the conversation. No official package is touched.

```sh
dsh plugin --profile web add @khorsheed/dsh-client-message-tools
```

<details>
<summary>View the screenshots (5)</summary>

<img src="docs/screenshots/message-actions1.png" width="840" alt="message-tools: the action row on a user message">

<img src="docs/screenshots/message-actions2.png" width="840" alt="message-tools: editing in place and re-sending">

<img src="docs/screenshots/message-actions3.png" width="840" alt="message-tools: the withdrawal confirmation">

<img src="docs/screenshots/message-actions4.png" width="840" alt="message-tools: the divider and restore entry">

<img src="docs/screenshots/message-actions5.png" width="840" alt="message-tools: restored messages return as they were">

</details>

### message-timeline — history at a glance

A floating timeline along the chat's left edge, one row per user message. At rest it is a thin rail out of sight; hover to expand a preview, click to scroll straight to that message. Follows your reading position and pages older history at the top. A pure read of the session snapshot — zero model impact.

```sh
dsh plugin --profile web add @khorsheed/dsh-message-timeline
```

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/message-timeline1.png" width="840" alt="message-timeline: expanded on hover">

<img src="docs/screenshots/message-timeline2.png" width="840" alt="message-timeline: at rest, a thin rail">

</details>

### session-title-edit — rename inline

Click the pencil beside the title in the chat header and the title itself becomes an input — Enter saves, Escape cancels. A user-set title is pinned and never overwritten by auto-generation. Rides the official rename channel; the model never notices.

```sh
dsh plugin --profile web add @khorsheed/dsh-client-session-title-edit
```

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/session-title-edit1.png" width="840" alt="session-title-edit: the inline edit entry">

<img src="docs/screenshots/session-title-edit2.png" width="840" alt="session-title-edit: type and hit Enter">

</details>

### file-preview + ui-file-preview — session artifacts

The Produced tab lists every file the session wrote or edited (most recent first); select one to preview its current content in-page, or step through every write/edit diff with content search. The host service and the browser UI install as a pair — one command, two packages:

```sh
dsh plugin --profile web add @khorsheed/dsh-file-preview @khorsheed/dsh-client-ui-file-preview
```

<details>
<summary>View the screenshots (3)</summary>

<img src="docs/screenshots/file-preview1.png" width="840" alt="file-preview: file list and inline preview">

<img src="docs/screenshots/file-preview2.png" width="840" alt="file-preview: per-turn change history">

<img src="docs/screenshots/file-preview3.png" width="840" alt="file-preview: the Produced tab overview">

</details>

### taskpilot — pills for background work

Two pills above the composer — background jobs and sub-agents — each appearing only when there is something to show. Running jobs tick every second with a stop button; sub-agents show the full lineage with token cost and can be interrupted; click a row for the detail drawer with a replayed execution trace. All data comes from mirrors the product already keeps — zero model impact.

```sh
dsh plugin --profile web add @khorsheed/dsh-taskpilot
```

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/taskpilot1.png" width="840" alt="taskpilot: the sub-agent pill, expanded">

<img src="docs/screenshots/taskpilot2.png" width="840" alt="taskpilot: the jobs pill and detail drawer">

</details>

### context-guard — compact before you run out

When context occupancy crosses your configured ratio, a compact button appears in the composer toolbar — one click runs the official /compact, before overflow starts rejecting requests. Tune the ratio to your taste (0.01–1); lower means earlier.

```sh
dsh plugin --profile web add @khorsheed/dsh-context-guard
```

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/context-guard-button.png" width="840" alt="context-guard: the compact button">

<img src="docs/screenshots/context-guard-settings.png" width="840" alt="context-guard: the configurable ratio">

</details>

### ui-shortcuts — rebindable keys

Esc pauses the current task, Ctrl/Cmd+S steer-sends your draft, Ctrl/Cmd+O starts a new session. Click a keycap in settings to rebind; preferences persist. It also ships an action registry: any plugin can register its own keyboard action and gets a settings entry plus conflict-free dispatch for free.

```sh
dsh plugin --profile web add @khorsheed/dsh-ui-shortcuts
```

<details>
<summary>View the screenshots (1)</summary>

<img src="docs/screenshots/07-ui-shortcuts.png" width="840" alt="ui-shortcuts: rebinding keys in settings">

</details>

### whalesong — ambient status

While any session runs, the sidebar whale spouts and the tab icon moves; when a run finishes or stalls waiting for you, a short chime plays (synthesized WebAudio, silenced under `prefers-reduced-motion`). Read-only over the session list, zero model impact — install it and the page feels alive.

```sh
dsh plugin --profile web add @khorsheed/dsh-whalesong
```

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/whalesong1.png" width="840" alt="whalesong: spouting while tasks run">

<img src="docs/screenshots/whalesong2.png" width="840" alt="whalesong: chime and tab icon on completion">

</details>

### ankh-guard — ops guard

Let the agent change its own code and restart its own service without taking it down: restarts require a green build+test credential (bound to the git HEAD, time-boxed) and are refused without one; after the restart a canary reactivates the session to keep verifying; repeated boot failures roll back to the last known-good version. A must for self-hosted, AI-driven setups.

```sh
dsh plugin --profile web add @khorsheed/dsh-ankh-guard
```

<details>
<summary>View the screenshots (1)</summary>

<img src="docs/screenshots/ankh-guard.JPG" width="840" alt="ankh-guard: a guarded restart, end to end">

</details>

## Make it yours

- **Remove a member**: `dsh plugin --profile web-basic remove @khorsheed/dsh-<name>` — the rest keep working. The bundle is a starting point, not a lock-in.
- **Add more**: any `@khorsheed/dsh-*` plugin installs with the same `add` command.
- **Update**: `dsh plugin --profile web-basic update` pulls the newest versions in range.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Developing

Plugins live in [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) (single source of truth). This repo carries only the profile template and docs. Issues welcome.
