# dsh-basic

[中文](README.md) | English

**A set of everyday, high-frequency experience plugins that make your DSH nicer — and freer.** Edit or withdraw messages you already sent; rename a session title in one click; background jobs at a glance and stoppable at will; a context-compaction reminder you configure yourself; mid-chat, have the agent sketch a preview card so you agree on the UI before it builds — no more rework loops; manage every skill and tool freely and assign them to different presets; a chime when a task completes; mobile access in a snap; safe restarts for plugin development — never again fear the little whale taking itself down…… The quality-of-life layer most users want first, installed in one go.

Every member is an independent plugin — copy its package name into the host's "Add plugin" dialog (0.1.7-rc.2+: Settings → Plugins) and install freely. If the official host later opens up custom-profile installation, this repo will support one-command install.
The everyday conversation plugins can also be installed straight as the `@khorsheed/dsh-bundle-conversation-toolbox` bundle — seven at once (see the end of [The tour](#the-tour)).

<img src="docs/screenshots/basic-mode.png" width="1000" alt="dsh-basic everyday mode at a glance: edit and withdraw messages, quote actions, session artifacts, the file list, the ideas space, and the compaction-reminder timing">

## The dsh-basic pack — plugin list

| Plugin | Package name (copy to install) | What you get |
|---|---|---|
| message-tools | `@khorsheed/dsh-client-message-tools` | Edit, withdraw, and restore messages you already sent |
| message-timeline | `@khorsheed/dsh-message-timeline` | A quiet timeline on the chat's left edge — hover to expand, click to jump |
| session-title-edit | `@khorsheed/dsh-client-session-title-edit` | Rename sessions inline in the chat header |
| quote | `@khorsheed/dsh-quote` | Select any text for a floating quote menu: into the composer / side chat / copy |
| file-preview | `@khorsheed/dsh-file-preview` | The Produced tab plus its host service in one package: preview every file the session touched, no IDE needed |
| local-files | `@khorsheed/dsh-local-files` | A local file browser in the right sidebar: lazy file tree + structured preview, any directory within reach |
| taskpilot | `@khorsheed/dsh-taskpilot` | Background jobs and sub-agents become pills above the composer — stop/interrupt in one click |
| context-guard | `@khorsheed/dsh-context-guard` | A compact button shows up before context overflow starts rejecting requests |
| inline-html-render | `@khorsheed/dsh-inline-html-render` | Agent-written HTML becomes sandboxed interactive cards in the conversation |
| capability-catalog | `@khorsheed/dsh-capability-catalog` | A settings page enumerating every skill and tool in the instance, with add-a-skill built in |
| ui-shortcuts | `@khorsheed/dsh-ui-shortcuts` | Esc to pause, Ctrl/Cmd+S to steer-send, Ctrl/Cmd+O for a new session — all rebindable |
| whalesong | `@khorsheed/dsh-whalesong` | Sidebar whale spouts while tasks run; a chime when they finish |
| mobile | `@khorsheed/dsh-mobile` | A mobile presentation for phone browsers, plus the iOS bridge |
| ankh-guard | `@khorsheed/dsh-ankh-guard` | Ops assistant: when the agent wants to restart after changing code, it verifies the build and tests first — and rolls back if the boot fails |

### Version compatibility

**Host ≥ `0.1.5-rc.1`**: use the package names as-is; all 14 members' latest works.

**Host `0.1.2-rc.1` ~ `0.1.4`**:

- **Installable at latest**: `@khorsheed/dsh-message-timeline`, `@khorsheed/dsh-client-session-title-edit`, `@khorsheed/dsh-context-guard`, `@khorsheed/dsh-ui-shortcuts`, `@khorsheed/dsh-whalesong`, `@khorsheed/dsh-inline-html-render`
- **Pin the older line** (copy the full spec): `@khorsheed/dsh-client-message-tools@^0.2.0`, `@khorsheed/dsh-file-preview@^0.2.0`, `@khorsheed/dsh-client-ui-file-preview@^0.2.0`, `@khorsheed/dsh-taskpilot@^0.2.0`, `@khorsheed/dsh-ankh-guard@^0.2.0`
- **Not available**: capability-catalog, mobile, quote, local-files (no release for this line)

## The tour

### message-tools — edit, withdraw, restore

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-client-message-tools` |
| `0.1.2` ~ `0.1.4` | `@khorsheed/dsh-client-message-tools@^0.2.0` |
| `0.1.x` | `@khorsheed/dsh-client-message-tools@^0.1.0` |

Every user message carries a copy/edit/withdraw action row. Edits replace in place and re-send as a new message; a withdraw is real — the message and everything after it leaves the model's context, folding into an expandable divider with the original text refilled into your draft; one click restores them to the end of the conversation. No official package is touched.

<details>
<summary>View the screenshots (5)</summary>

<img src="docs/screenshots/message-actions1.png" width="840" alt="message-tools: the action row on a user message">

<img src="docs/screenshots/message-actions2.png" width="840" alt="message-tools: editing in place and re-sending">

<img src="docs/screenshots/message-actions3.png" width="840" alt="message-tools: the withdrawal confirmation">

<img src="docs/screenshots/message-actions4.png" width="840" alt="message-tools: the divider and restore entry">

<img src="docs/screenshots/message-actions5.png" width="840" alt="message-tools: restored messages return as they were">

</details>

### message-timeline — history at a glance

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-message-timeline` |
| `0.1.x` | `@khorsheed/dsh-message-timeline@^0.1.0` |

The official timeline gets costly to navigate in long sessions; I personally prefer locating by user messages — you can scan across many at once instead of scrolling up and down. A floating timeline along the chat's left edge, one row per user message. At rest it is a thin rail out of sight; hover to expand a preview, click to scroll straight to that message. Follows your reading position and pages older history at the top.

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/message-timeline1.png" width="840" alt="message-timeline: expanded on hover">

<img src="docs/screenshots/message-timeline2.png" width="840" alt="message-timeline: at rest, a thin rail">

</details>

### session-title-edit — rename inline

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-client-session-title-edit` |
| `0.1.x` | `@khorsheed/dsh-client-session-title-edit@^0.1.0` |

Click the pencil beside the title in the chat header and the title itself becomes an input — Enter saves, Escape cancels. A user-set title is pinned and never overwritten by auto-generation. Rides the official rename channel; the model never notices.

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/session-title-edit1.png" width="840" alt="session-title-edit: the inline edit entry">

<img src="docs/screenshots/session-title-edit2.png" width="840" alt="session-title-edit: type and hit Enter">

</details>

### quote — quote anything

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-quote` |
| earlier | no release available |

Select any text and a floating action menu appears — quote into the current session (lands in the composer), quote into a side chat, or copy. Other plugins can register their own action rows into the same menu.

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/quote-1.png" width="840" alt="quote: the floating menu over selected text">

<img src="docs/screenshots/quote-2.png" width="840" alt="quote: the quote lands in the composer">

</details>

### file-preview — session artifacts

| Host version | Install specs (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-file-preview` (since 0.4.0 the host service and the UI ship as one package — one spec is everything) |
| `0.1.2` ~ `0.1.4` | `@khorsheed/dsh-file-preview@^0.2.0` + `@khorsheed/dsh-client-ui-file-preview@^0.2.0` (the old line is still the host/UI pair) |
| `0.1.x` | `@khorsheed/dsh-file-preview@^0.1.0` + `@khorsheed/dsh-client-ui-file-preview@^0.1.0` |

The Produced tab lists every file the session wrote or edited (most recent first) — especially handy in writing scenarios. Select one to preview its current content in-page, or step through every write/edit diff with content search.

<details>
<summary>View the screenshots (5)</summary>

<img src="docs/screenshots/file-preview-new1.png" width="840" alt="file-preview: file list and inline preview">

<img src="docs/screenshots/file-preview-new2.png" width="840" alt="file-preview: the persistent Produced-list entry">

<img src="docs/screenshots/file-preview-new3.png" width="840" alt="file-preview: the artifact list">

<img src="docs/screenshots/file-preview-new4.png" width="840" alt="file-preview: artifact content detail">

<img src="docs/screenshots/file-preview-new5.png" width="840" alt="file-preview: the per-edit diff">

</details>

### local-files — the local file browser

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-local-files` |
| earlier | no release available |

Browse local directories beyond the workspace from the right sidebar: a lazy file tree with structured previews (rendered HTML/Markdown/JSON/CSV, inline images), git-agnostic, rooted at the current session's workspace by default but never locked to it. It takes over the official Files tab — the guide page shows a single files card, and the official card returns on uninstall. (The split: local-files browses any local directory; file-preview is the current session's artifacts — different semantics, two packages.)

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/local-files-1.png" width="840" alt="local-files: the files entry on the start page, defaulting to the session's working directory">

<img src="docs/screenshots/local-files-2.png" width="840" alt="local-files: tree on the left, rendered Markdown preview with content search on the right">

</details>

### taskpilot — pills for background work

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-taskpilot` |
| `0.1.2` ~ `0.1.4` | `@khorsheed/dsh-taskpilot@^0.2.0` |
| `0.1.x` | `@khorsheed/dsh-taskpilot@^0.1.0` |

Two pills above the composer — background jobs and sub-agents — each appearing only when there is something to show. Running jobs tick every second with a stop button; sub-agents show the full lineage with token cost and can be interrupted; click a row for the detail drawer with a replayed execution trace. All data comes from mirrors the product already keeps — zero model impact.

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/taskpilot1.png" width="840" alt="taskpilot: the sub-agent pill, expanded">

<img src="docs/screenshots/taskpilot2.png" width="840" alt="taskpilot: the jobs pill and detail drawer">

</details>

### context-guard — compact before you run out

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-context-guard` |
| `0.1.x` | `@khorsheed/dsh-context-guard@^0.1.0` |

When context occupancy crosses your configured ratio, a compact button appears in the composer toolbar — one click runs the official /compact, before overflow starts rejecting requests. Tune the ratio to your taste (0.01–1); lower means earlier.

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/context-guard-settings-2.png" width="840" alt="context-guard: the configurable ratio">

<img src="docs/screenshots/context-guard-button.png" width="840" alt="context-guard: the compact button">

</details>

### inline-html-render — inline HTML cards

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-inline-html-render` |
| earlier | no release available |

A ```` ```dsh-card ```` HTML block in the agent's reply renders as a sandboxed interactive card right in the conversation — sketch the UI first, agree on the details, then build it, instead of discovering the mismatch after everything is done. Sandboxed and isolated; animations settle down under `prefers-reduced-motion`.

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/inline-html-card-1.png" width="840" alt="inline-html-render: an interactive card in the conversation">

<img src="docs/screenshots/inline-html-card-2.png" width="840" alt="inline-html-render: sketching design variants as cards before touching code">

</details>

### capability-catalog — the capability catalog

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-capability-catalog` |
| earlier | no release available |

A new Tools & Skills entry in settings: every skill and tool in the running instance, each labeled with its registration channel (official built-in / project / user / plugin); a three-column card grid, a detail modal with the full SKILL.md, metadata and credential config, and an add-skill modal that installs from an uploaded zip or a pasted SKILL.md.

<details>
<summary>View the screenshots (3)</summary>

<img src="docs/screenshots/capability-catalog-1.png" width="840" alt="capability-catalog: the three-column grid">

<img src="docs/screenshots/capability-catalog-2.png" width="840" alt="capability-catalog: skill detail">

<img src="docs/screenshots/capability-catalog-3.png" width="840" alt="capability-catalog: adding a skill">

</details>

### ui-shortcuts — rebindable keys

Since 0.1.7-rc.2 the host ships its own shortcut settings — you can use the official capability directly.

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-ui-shortcuts` |
| `0.1.x` | `@khorsheed/dsh-ui-shortcuts@^0.1.0` |

Esc pauses the current task, Ctrl/Cmd+S steer-sends your draft, Ctrl/Cmd+O starts a new session. Click a keycap in settings to rebind; preferences persist. It also ships an action registry: any plugin can register its own keyboard action and gets a settings entry plus conflict-free dispatch for free.

<details>
<summary>View the screenshots (1)</summary>

<img src="docs/screenshots/07-ui-shortcuts.png" width="840" alt="ui-shortcuts: rebinding keys in settings">

</details>

### whalesong — ambient status

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-whalesong` |
| `0.1.x` | `@khorsheed/dsh-whalesong@^0.1.0` |

While any session runs, the sidebar whale spouts and the tab icon moves; when a run finishes or stalls waiting for you, a short chime plays (synthesized WebAudio, silenced under `prefers-reduced-motion`).

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/whalesong1.png" width="840" alt="whalesong: spouting while tasks run">

<img src="docs/screenshots/whalesong2.png" width="840" alt="whalesong: chime and tab icon on completion">

</details>

### mobile — mobile access

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-mobile` |
| earlier | no release available |

A mobile presentation of the web UI for phone browsers, plus the iOS bridge — check in on sessions, hand out tasks, and handle approvals away from your desk.

<details>
<summary>View the screenshots (2)</summary>

<img src="docs/screenshots/mobile-conversation.png" width="840" alt="mobile: the conversation view on a phone">

<img src="docs/screenshots/mobile-library.png" width="840" alt="mobile: the list view on a phone">

</details>

### ankh-guard — ops guard

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-ankh-guard` |
| `0.1.2` ~ `0.1.4` | `@khorsheed/dsh-ankh-guard@^0.2.0` |
| `0.1.x` | `@khorsheed/dsh-ankh-guard@^0.1.0` |

Let the agent change its own code and restart its own service without taking it down: restarts require a green build+test credential (bound to the git HEAD, time-boxed) and are refused without one; after the restart a canary reactivates the session to keep verifying; repeated boot failures roll back to the last known-good version. A must for self-hosted, AI-driven setups.

<details>
<summary>View the screenshots (1)</summary>

<img src="docs/screenshots/ankh-guard.JPG" width="840" alt="ankh-guard: a guarded restart, end to end">

</details>

### Bundle install: bundle-conversation-toolbox (the seven-piece conversation toolbox)

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-bundle-conversation-toolbox` |
| earlier | no release available (install members individually per the tables above) |

Don't want to pick one by one? This single meta package installs the seven conversation tools at once: message-tools, message-timeline, session-title-edit, quote, inline-html-render, context-guard, taskpilot. Members arrive as npm dependencies, and the bundle's patch re-mounts each member's canonical rows verbatim; afterwards every component stays individually disable-able under Settings → Plugins — the bundle packages the install, not your choices.

<details>
<summary>View the screenshots (1)</summary>

<img src="docs/screenshots/bundle-conversation-toolbox.png" width="840" alt="bundle-conversation-toolbox: the detail page listing seven components, each individually switchable">

</details>

## Make it yours

- **Remove a member**: disable/uninstall in Settings → Plugins, or `dsh plugin --profile <your profile> remove <package name>` — the rest keep working. The bundle is a starting point, not a lock-in.
- **Add more**: any `@khorsheed/dsh-*` plugin installs the same way — copy the package name.
- **Update**: from Settings → Plugins, or `dsh plugin --profile <your profile> update` to pull the newest versions in range.

## Other packs

| Pack | What it is |
|---|---|
| [dsh-dev](https://github.com/Khorsheed/dsh-dev) | Development mode: everything in this pack, plus local coding-agent delegation, live worktree state, and room multi-agent collaboration |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | The plugin monorepo: the capability map of every package, the preset designs, and the development docs |

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Developing

Plugins live in [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) (single source of truth). This repo carries only the profile template and docs. Issues welcome.

## Install guide for agents

<details>
<summary><strong>Expand: whole-pack install + single-package CLI install</strong> (follow this when the user says "install this for me"; users without an agent can run the same commands by hand)</summary>

### 1. Installing the whole pack

A whole-pack install requires host ≥ `0.1.5-rc.1` (capability-catalog, mobile, quote, local-files, and the latest lines of five members all floor there); on the `0.1.2` line stay with the pre-rename archive (a `host-0.1.2-line` tag ships with the next publish wave), and on `0.1.0` / `0.1.1` hosts use the `host-0.1.1-line` tag.

**0. Pick the release line by host version first (skipping this can install plugins that won't boot)**

```sh
dsh --version    # or read the host version from the running instance's process info
```

- Host `0.1.5` or newer (any rc included) → use the main line (clone the default branch).
- Host `0.1.2-rc.*` ~ `0.1.4` → stay with the older archive (the `host-0.1.2-line` tag).
- Host `0.1.0-rc.*` / `0.1.1-rc.*` → use the legacy line: after cloning, `git -C /tmp/dsh-basic checkout host-0.1.1-line`; members stay on 0.1.x (no further updates).

**1. Install and self-check offline (do not touch the running instance)**

```sh
git clone https://github.com/Khorsheed/dsh-basic.git /tmp/dsh-basic
sh /tmp/dsh-basic/scripts/install.sh
```

The installer prints the composed row count. To double-check: `dsh --profile basic --dump-config | grep -c "@khorsheed"` should print 14 (ankh-guard / capability-catalog / context-guard / file-preview / inline-html-render / local-files / message-timeline / message-tools / mobile / quote / session-title-edit / taskpilot / ui-shortcuts / whalesong). If `dsh` is not on PATH, use its absolute path (find it via `ps` from the current instance's command line).

**2. Hand over on the same port (the critical step)**

```sh
sh /tmp/dsh-basic/scripts/restart-into-basic.sh [port, default 3080]
```

The script drives the pack's own ankh-guard watchdog: environment probe → record a credential → adopt the current instance → watchdog stops the old one and boots the pack with a canary. **You will disconnect with the host — that is expected**: the watchdog brings basic up on the original port. The script deliberately omits `--initiator` so the guard reads `$DSH_SESSION_ID` from your environment — that is how the restart report finds your session: when the user reopens it, you receive the "restart complete" followup and continue. Note: snapshot-based continuation of interrupted turns needs the guard already mounted in the old instance (absent on a first install); that part exists from the second restart onward.

Two prerequisites — the script refuses early with a reason if either is missing:

- **Session permissions**: in a sandboxed session (writes fenced to the workspace), the detached watchdog gets reaped when the turn ends and the script refuses up front. Ask the user to switch to full-access mode (or hand them the command to run in a plain terminal).
- **Do NOT substitute `nohup ... &` or a hand-rolled `kill` + restart**: sandboxes reap by process tree, nohup does not protect against that, and a wrong stop/start order never comes back.

**3. Deliver**

Once `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/` returns 200, ask the user to **hard-refresh** (Cmd/Ctrl+Shift+R) — the new client bundles (the Produced tab, the dock pills, …) only load on a hard refresh; a plain reload may keep serving the cached shell. Then present the feature list (the README plugin-list table). Known boundary: on a pure-npm deployment ankh-guard's composition preflight runs degraded (it warns and proceeds); everything else is fully functional.

### 2. Installing a single plugin

- **Dialog (0.1.7-rc.2+, recommended)**: Settings → Plugins → Add plugin, enter the package name (e.g. `@khorsheed/dsh-whalesong`), enable as prompted. On older hosts remember the release-line suffix (see "Version compatibility" above).
- **CLI**: `dsh plugin --profile <profile> add <package name>`; `remove` to uninstall, `update` to upgrade.
- **Bundle install**: the seven everyday conversation plugins also install in one shot via the meta package — `dsh plugin --profile <profile> add @khorsheed/dsh-bundle-conversation-toolbox`; member rows stay individually disable-able under Settings → Plugins.

</details>
