# dsh-basic

[中文](README.md) | English

**A set of everyday, high-frequency experience plugins that make your DSH nicer — and freer.** Edit or withdraw messages you already sent; rename a session title in one click; background jobs at a glance and stoppable at will; a context-compaction reminder you configure yourself; mid-chat, have the agent sketch a preview card so you agree on the UI before it builds — no more rework loops; manage every skill and tool freely and assign them to different presets; a chime when a task completes; mobile access in a snap; safe restarts for plugin development — never again fear the little whale taking itself down…… The quality-of-life layer most users want first, installed in one go.

<img src="docs/screenshots/basic-mode.png" width="1000" alt="dsh-basic essentials at a glance: edit and withdraw messages, quote actions, session artifacts, the file list, the ideas space, and the compaction-reminder timing">

## Install

**The whole suite (recommended)**: on hosts ≥ `0.1.7-rc.2`, go to Settings → Plugins → Add plugin and enter `@khorsheed/dsh-basic`; or from the command line, `dsh plugin --profile web add @khorsheed/dsh-basic`. The suite installs all 14 members at once, and every member stays individually toggleable under Settings → Plugins. On release day, include a version floor — `@khorsheed/dsh-basic@^0.1.0`: pnpm hides versions younger than 24 hours by default (`minimumReleaseAge`, a supply-chain guard), so a bare name would miss the just-published version.

**Individual members**: every row in the table below is an independent plugin — copy its package name into the same dialog (or `dsh plugin add`). The suite is a convenient starting point, not a lock-in.

Requires host ≥ `0.1.5-rc.1`; for the older `0.1.2` / `0.1.1` lines see the install guide for agents at the end.

## The dsh-basic suite — plugin list

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
| context-lens | `@khorsheed/dsh-context-lens` | The context lens: per-turn inspection of each model request — composition, tokens, latency |
| inline-html-render | `@khorsheed/dsh-inline-html-render` | Agent-written HTML becomes sandboxed interactive cards in the conversation |
| capability-catalog | `@khorsheed/dsh-capability-catalog` | A settings page enumerating every skill and tool in the instance, with add-a-skill built in |
| whalesong | `@khorsheed/dsh-whalesong` | Sidebar whale spouts while tasks run; a chime when they finish |
| mobile | `@khorsheed/dsh-mobile` | A mobile presentation for phone browsers, plus the iOS bridge |
| ankh-guard | `@khorsheed/dsh-ankh-guard` | Ops assistant: when the agent wants to restart after changing code, it verifies the build and tests first — and rolls back if the boot fails |

### Version compatibility

**Host `0.2.0-rc.*` and later**: copy the specs with an `@^version` floor from the tables below. On release day do not paste a bare package name — pnpm 11 hides versions younger than 24 hours by default (`minimumReleaseAge`, a supply-chain guard), so a bare name resolves to the old 0.1.x-only line and the host compatibility check then rejects it; a floored spec auto-exempts the gate and installs the compatible new version.

**Host `0.1.5-rc.1` ~ `0.1.7.*`**: bare package names are fine — every one of the 14 members' latest works (the old plugin lines remain compatible on 0.1.x hosts, so the age-gate fallback is harmless there).

**Host `0.1.2-rc.1` ~ `0.1.4`**:

- **Installable at latest**: `@khorsheed/dsh-message-timeline`, `@khorsheed/dsh-client-session-title-edit`, `@khorsheed/dsh-context-guard`, `@khorsheed/dsh-whalesong`, `@khorsheed/dsh-inline-html-render`
- **Pin the older line** (copy the full spec): `@khorsheed/dsh-client-message-tools@^0.2.0`, `@khorsheed/dsh-file-preview@^0.2.0`, `@khorsheed/dsh-client-ui-file-preview@^0.2.0`, `@khorsheed/dsh-taskpilot@^0.2.0`, `@khorsheed/dsh-ankh-guard@^0.2.0`
- **Not available**: capability-catalog, mobile, quote, local-files, context-lens (no release for this line)

## The tour

### message-tools — edit, withdraw, restore

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-client-message-tools@^0.3.3` |
| `0.1.2` ~ `0.1.4` | `@khorsheed/dsh-client-message-tools@^0.2.0` |
| `0.1.x` | `@khorsheed/dsh-client-message-tools@^0.1.0` |

Every user message carries a copy/edit/withdraw action row. Edits replace in place and re-send as a new message; a withdraw is real — the message and everything after it leaves the model's context, folding into an expandable divider with the original text refilled into your draft; one click restores them to the end of the conversation. No official package is touched.

<details open>
<summary>Screenshots (5)</summary>

<img src="docs/screenshots/message-actions1.png" width="840" alt="message-tools: the action row on a user message">

<img src="docs/screenshots/message-actions2.png" width="840" alt="message-tools: editing in place and re-sending">

<img src="docs/screenshots/message-actions3.png" width="840" alt="message-tools: the withdrawal confirmation">

<img src="docs/screenshots/message-actions4.png" width="840" alt="message-tools: the divider and restore entry">

<img src="docs/screenshots/message-actions5.png" width="840" alt="message-tools: restored messages return as they were">

</details>

### message-timeline — history at a glance

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-message-timeline@^0.2.4` |
| `0.1.x` | `@khorsheed/dsh-message-timeline@^0.1.0` |

The official timeline gets costly to navigate in long sessions; I personally prefer locating by user messages — you can scan across many at once instead of scrolling up and down. A floating timeline along the chat's left edge, one row per user message. At rest it is a thin rail out of sight; hover to expand a preview, click to scroll straight to that message. Follows your reading position and pages older history at the top.

<details open>
<summary>Screenshots (2)</summary>

<img src="docs/screenshots/message-timeline1.png" width="840" alt="message-timeline: expanded on hover">

<img src="docs/screenshots/message-timeline2.png" width="840" alt="message-timeline: at rest, a thin rail">

</details>

### session-title-edit — rename inline

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-client-session-title-edit@^0.2.5` |
| `0.1.x` | `@khorsheed/dsh-client-session-title-edit@^0.1.0` |

Click the pencil beside the title in the chat header and the title itself becomes an input — Enter saves, Escape cancels. A user-set title is pinned and never overwritten by auto-generation. Rides the official rename channel; the model never notices.

<details open>
<summary>Screenshots (2)</summary>

<img src="docs/screenshots/session-title-edit1.png" width="840" alt="session-title-edit: the inline edit entry">

<img src="docs/screenshots/session-title-edit2.png" width="840" alt="session-title-edit: type and hit Enter">

</details>

### quote — quote anything

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-quote@^0.1.2` |
| earlier | no release available |

Select any text and a floating action menu appears — quote into the current session (lands in the composer), quote into a side chat, or copy. Other plugins can register their own action rows into the same menu.

<details open>
<summary>Screenshots (2)</summary>

<img src="docs/screenshots/quote-1.png" width="840" alt="quote: the floating menu over selected text">

<img src="docs/screenshots/quote-2.png" width="840" alt="quote: the quote lands in the composer">

</details>

### file-preview — session artifacts

| Host version | Install specs (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-file-preview@^0.4.1` (since 0.4.0 the host service and the UI ship as one package — one spec is everything) |
| `0.1.2` ~ `0.1.4` | `@khorsheed/dsh-file-preview@^0.2.0` + `@khorsheed/dsh-client-ui-file-preview@^0.2.0` (the old line is still the host/UI pair) |
| `0.1.x` | `@khorsheed/dsh-file-preview@^0.1.0` + `@khorsheed/dsh-client-ui-file-preview@^0.1.0` |

The Produced tab lists every file the session wrote or edited (most recent first) — especially handy in writing scenarios. Select one to preview its current content in-page, or step through every write/edit diff with content search.

<details open>
<summary>Screenshots (5)</summary>

<img src="docs/screenshots/file-preview-new1.png" width="840" alt="file-preview: file list and inline preview">

<img src="docs/screenshots/file-preview-new2.png" width="840" alt="file-preview: the persistent Produced-list entry">

<img src="docs/screenshots/file-preview-new3.png" width="840" alt="file-preview: the artifact list">

<img src="docs/screenshots/file-preview-new4.png" width="840" alt="file-preview: artifact content detail">

<img src="docs/screenshots/file-preview-new5.png" width="840" alt="file-preview: the per-edit diff">

</details>

### local-files — the local file browser

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-local-files@^0.1.2` |
| earlier | no release available |

Browse local directories beyond the workspace from the right sidebar: a lazy file tree with structured previews (rendered HTML/Markdown/JSON/CSV, inline images), git-agnostic, rooted at the current session's workspace by default but never locked to it. It takes over the official Files tab — the guide page shows a single files card, and the official card returns on uninstall. (The split: local-files browses any local directory; file-preview is the current session's artifacts — different semantics, two packages.)

<details open>
<summary>Screenshots (2)</summary>

<img src="docs/screenshots/local-files-1.png" width="840" alt="local-files: the files entry on the start page, defaulting to the session's working directory">

<img src="docs/screenshots/local-files-2.png" width="840" alt="local-files: tree on the left, rendered Markdown preview with content search on the right">

</details>

### taskpilot — pills for background work

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-taskpilot@^0.3.4` |
| `0.1.2` ~ `0.1.4` | `@khorsheed/dsh-taskpilot@^0.2.0` |
| `0.1.x` | `@khorsheed/dsh-taskpilot@^0.1.0` |

Two pills above the composer — background jobs and sub-agents — each appearing only when there is something to show. Running jobs tick every second with a stop button; sub-agents show the full lineage with token cost and can be interrupted; click a row for the detail drawer with a replayed execution trace. All data comes from mirrors the product already keeps — zero model impact.

<details open>
<summary>Screenshots (2)</summary>

<img src="docs/screenshots/taskpilot1.png" width="840" alt="taskpilot: the sub-agent pill, expanded">

<img src="docs/screenshots/taskpilot2.png" width="840" alt="taskpilot: the jobs pill and detail drawer">

</details>

### context-guard — compact before you run out

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-context-guard@^0.2.4` |
| `0.1.x` | `@khorsheed/dsh-context-guard@^0.1.0` |

When context occupancy crosses your configured ratio, a compact button appears in the composer toolbar — one click runs the official /compact, before overflow starts rejecting requests. Tune the ratio to your taste (0.01–1); lower means earlier.

<details open>
<summary>Screenshots (2)</summary>

<img src="docs/screenshots/context-guard-settings-2.png" width="840" alt="context-guard: the configurable ratio">

<img src="docs/screenshots/context-guard-button.png" width="840" alt="context-guard: the compact button">

</details>

### inline-html-render — inline HTML cards

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-inline-html-render@^0.1.15` |
| earlier | no release available |

A ```` ```dsh-card ```` HTML block in the agent's reply renders as a sandboxed interactive card right in the conversation — sketch the UI first, agree on the details, then build it, instead of discovering the mismatch after everything is done. Sandboxed and isolated; animations settle down under `prefers-reduced-motion`.

<details open>
<summary>Screenshots (2)</summary>

<img src="docs/screenshots/inline-html-card-1.png" width="840" alt="inline-html-render: an interactive card in the conversation">

<img src="docs/screenshots/inline-html-card-2.png" width="840" alt="inline-html-render: sketching design variants as cards before touching code">

</details>

### capability-catalog — the capability catalog

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-capability-catalog@^0.1.97` |
| earlier | no release available |

A new Tools & Skills entry in settings: every skill and tool in the running instance, each labeled with its registration channel (official built-in / project / user / plugin); a three-column card grid, a detail modal with the full SKILL.md, metadata and credential config, and an add-skill modal that installs from an uploaded zip or a pasted SKILL.md.

<details open>
<summary>Screenshots (3)</summary>

<img src="docs/screenshots/capability-catalog-1.png" width="840" alt="capability-catalog: the three-column grid">

<img src="docs/screenshots/capability-catalog-2.png" width="840" alt="capability-catalog: skill detail">

<img src="docs/screenshots/capability-catalog-3.png" width="840" alt="capability-catalog: adding a skill">

</details>

### whalesong — ambient status

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.2-rc.1` | `@khorsheed/dsh-whalesong@^0.2.4` |
| `0.1.x` | `@khorsheed/dsh-whalesong@^0.1.0` |

While any session runs, the sidebar whale spouts and the tab icon moves; when a run finishes or stalls waiting for you, a short chime plays (synthesized WebAudio, silenced under `prefers-reduced-motion`).

<details open>
<summary>Screenshots (2)</summary>

<img src="docs/screenshots/whalesong1.png" width="840" alt="whalesong: spouting while tasks run">

<img src="docs/screenshots/whalesong2.png" width="840" alt="whalesong: chime and tab icon on completion">

</details>

### mobile — mobile access

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-mobile@^0.2.0` |
| earlier | no release available |

A mobile presentation of the web UI for phone browsers, plus the iOS bridge — check in on sessions, hand out tasks, and handle approvals away from your desk.

<details open>
<summary>Screenshots (2)</summary>

<img src="docs/screenshots/mobile-conversation.png" width="840" alt="mobile: the conversation view on a phone">

<img src="docs/screenshots/mobile-library.png" width="840" alt="mobile: the list view on a phone">

</details>

### ankh-guard — ops guard

| Host version | Install spec (copy into the dialog) |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-ankh-guard@^0.4.1` |
| `0.1.2` ~ `0.1.4` | `@khorsheed/dsh-ankh-guard@^0.2.0` |
| `0.1.x` | `@khorsheed/dsh-ankh-guard@^0.1.0` |

Let the agent change its own code and restart its own service without taking it down: restarts require a green build+test credential (bound to the git HEAD, time-boxed) and are refused without one; after the restart a canary reactivates the session to keep verifying; repeated boot failures roll back to the last known-good version. A must for self-hosted, AI-driven setups.

<details open>
<summary>Screenshots (1)</summary>

<img src="docs/screenshots/ankh-guard.JPG" width="840" alt="ankh-guard: a guarded restart, end to end">

</details>

## Make it yours

- **Remove a member**: disable/uninstall in Settings → Plugins, or `dsh plugin --profile <your profile> remove <package name>` — the rest keep working. The suite is a starting point, not a lock-in.
- **Add more**: any `@khorsheed/dsh-*` plugin installs the same way — copy the package name.
- **Update**: from Settings → Plugins, or `dsh plugin --profile <your profile> update` to pull the newest versions in range.

## Other suites

| Suite | What it is |
|---|---|
| [dsh-dev](https://github.com/Khorsheed/dsh-dev) | The dev suite: local coding-agent delegation, live worktree state, room multi-agent collaboration — with the dev-mode preset |
| [dsh-writing](https://github.com/Khorsheed/dsh-writing) | The writing suite: the idea canvas + the novel genre — with the writing-mode preset |
| [dsh-learning](https://github.com/Khorsheed/dsh-learning) | The learning suite: library-style project close reading — with the learning-mode preset |
| [dsh-video](https://github.com/Khorsheed/dsh-video) | The video suite: a cutting room with speaker splitting and delete-the-word-deletes-the-audio — with the video-mode preset |
| [dsh-gamedev](https://github.com/Khorsheed/dsh-gamedev) | The gamedev suite: build small games with the agent — with the gamedev-mode preset |
| [dsh-eval](https://github.com/Khorsheed/dsh-eval) | The eval suite: on-machine harness comparison — with the eval-mode preset |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | The plugin monorepo: the capability map of every package, the preset designs, and the development docs |

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Developing

Plugins live in [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) (single source of truth). This repo carries only the profile template and docs. Issues welcome.

## Install guide for agents

<details>
<summary><strong>Expand: whole-suite install + single-package CLI install</strong> (follow this when the user says "install this for me")</summary>

### 1. Installing the whole suite (recommended)

Works on hosts ≥ `0.1.5-rc.1`. From the command line:

```sh
dsh plugin --profile web add @khorsheed/dsh-basic@^0.1.0   # the floor exempts pnpm's new-release protection on release day; a bare name is fine afterwards
```

On hosts ≥ `0.1.7-rc.2` the dialog works too: Settings → Plugins → Add plugin, enter `@khorsheed/dsh-basic`, enable as prompted.

Restart the web instance, then ask the user to **hard-refresh** (Cmd/Ctrl+Shift+R) — the new client bundles (the Produced tab, the dock pills, …) only load on a hard refresh; a plain reload may keep serving the cached shell. Then present the feature list (the "plugin list" table above).

Older host lines: `0.1.2` ~ `0.1.4` stay with the `host-0.1.2-line` tag archive; `0.1.0` / `0.1.1` use the `host-0.1.1-line` tag.

### 2. Installing a single plugin

- **Dialog (0.1.7-rc.2+, recommended)**: Settings → Plugins → Add plugin, enter the package name (e.g. `@khorsheed/dsh-whalesong`), enable as prompted. On older hosts remember the release-line suffix (see "Version compatibility" above); on `0.2.0-rc.*` and later, add the floor on release day too (each table carries it).
- **CLI**: `dsh plugin --profile <profile> add <package name>`; `remove` to uninstall, `update` to upgrade.

</details>
