# @khorsheed/dsh-basic

[中文](README.md) | English

**A set of everyday, high-frequency experience plugins that make your DSH nicer — and freer.** Edit or withdraw messages you already sent; rename a session title in one click; background jobs at a glance and stoppable at will; a context-compaction reminder you configure yourself; mid-chat, have the agent sketch a preview card so you agree on the UI before it builds — no more rework loops; manage every skill and tool freely and assign them to different presets; a chime when a task completes; mobile access in a snap…… The quality-of-life layer most users want first, installed in one go.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/basic-mode.png" width="800" alt="dsh-basic essentials at a glance: edit and withdraw messages, quote actions, session artifacts, the file list, the ideas space, and the compaction-reminder timing">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-basic
```

That installs all 12 members below; restart DSH and they're ready. Every member can still be switched on or off on the Plugins page, and you can install any single one on its own — just enter its package name in the same dialog.

## The dsh-basic suite — plugin list

| Plugin | Package name (copy to install) | What you get |
|---|---|---|
| message-tools | `@khorsheed/dsh-client-message-tools` | Edit, withdraw, and restore messages you already sent |
| message-timeline | `@khorsheed/dsh-message-timeline` | A quiet timeline on the chat's left edge — hover to expand, click to jump |
| session-title-edit | `@khorsheed/dsh-client-session-title-edit` | Rename sessions inline in the chat header |
| quote | `@khorsheed/dsh-quote` | Select any text for a floating quote menu: into the composer / copy |
| file-preview | `@khorsheed/dsh-file-preview` | The Produced tab plus its host service in one package: preview every file the session touched, no IDE needed |
| local-files | `@khorsheed/dsh-local-files` | A local file browser in the right sidebar: lazy file tree + structured preview, any directory within reach |
| taskpilot | `@khorsheed/dsh-taskpilot` | Background jobs and sub-agents become pills above the composer — stop/interrupt in one click |
| context-guard | `@khorsheed/dsh-context-guard` | A compact button shows up before context overflow starts rejecting requests |
| inline-html-render | `@khorsheed/dsh-inline-html-render` | Agent-written HTML becomes sandboxed interactive cards in the conversation |
| capability-catalog | `@khorsheed/dsh-capability-catalog` | A settings page enumerating every skill and tool in the instance, with add-a-skill built in |
| whalesong | `@khorsheed/dsh-whalesong` | Sidebar whale spouts while tasks run; a chime when they finish |
| mobile | `@khorsheed/dsh-mobile` | A mobile presentation for phone browsers, plus the iOS bridge |

The restart guard (ankh-guard) and the context lens (context-lens) are developer tools; since 2026-10-24 they ship in the [Dev Suite](https://github.com/Khorsheed/dsh-dev).

## The tour

### message-tools — edit, withdraw, restore

Every user message carries a copy/edit/withdraw action row. Edits replace in place and re-send as a new message; a withdraw is real — the message and everything after it leaves the model's context, folding into an expandable divider with the original text refilled into your draft; one click restores them to the end of the conversation. No official package is touched.

<details open>
<summary>Screenshots (5)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions1.png" width="640" alt="message-tools: the action row on a user message">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions2.png" width="640" alt="message-tools: editing in place and re-sending">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions3.png" width="640" alt="message-tools: the withdrawal confirmation">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions4.png" width="640" alt="message-tools: the divider and restore entry">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions5.png" width="640" alt="message-tools: restored messages return as they were">

</details>

### message-timeline — history at a glance

The official timeline gets costly to navigate in long sessions; I personally prefer locating by user messages — you can scan across many at once instead of scrolling up and down. A floating timeline along the chat's left edge, one row per user message. At rest it is a thin rail out of sight; hover to expand a preview, click to scroll straight to that message. Follows your reading position and pages older history at the top.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-timeline1.png" width="640" alt="message-timeline: expanded on hover">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-timeline2.png" width="640" alt="message-timeline: at rest, a thin rail">

</details>

### session-title-edit — rename inline

Click the pencil beside the title in the chat header and the title itself becomes an input — Enter saves, Escape cancels. A user-set title is pinned and never overwritten by auto-generation. Rides the official rename channel; the model never notices.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/session-title-edit1.png" width="640" alt="session-title-edit: the inline edit entry">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/session-title-edit2.png" width="640" alt="session-title-edit: type and hit Enter">

</details>

### quote — quote anything

Select any text and a floating action menu appears — quote into the current session (lands in the composer) or copy. Other plugins can register their own action rows into the same menu.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/quote-1.png" width="640" alt="quote: the floating menu over selected text">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/quote-2.png" width="640" alt="quote: the quote lands in the composer">

</details>

### file-preview — session artifacts

The Produced tab lists every file the session wrote or edited (most recent first) — especially handy in writing scenarios. Select one to preview its current content in-page, or step through every write/edit diff with content search.

<details open>
<summary>Screenshots (5)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview-new1.png" width="640" alt="file-preview: file list and inline preview">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview-new2.png" width="640" alt="file-preview: the persistent Produced-list entry">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview-new3.png" width="640" alt="file-preview: the artifact list">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview-new4.png" width="260" alt="file-preview: artifact content detail"> <img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview-new5.png" width="260" alt="file-preview: the per-edit diff">

</details>

### local-files — the local file browser

Browse local directories beyond the workspace from the right sidebar: a lazy file tree with structured previews (rendered HTML/Markdown/JSON/CSV, inline images), git-agnostic, rooted at the current session's workspace by default but never locked to it. It takes over the official Files tab — the guide page shows a single files card, and the official card returns on uninstall. (The split: local-files browses any local directory; file-preview is the current session's artifacts — different semantics, two packages.)

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-files-1.png" width="260" alt="local-files: the files entry on the start page, defaulting to the session's working directory">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-files-2.png" width="640" alt="local-files: tree on the left, rendered Markdown preview with content search on the right">

</details>

### taskpilot — pills for background work

Two pills above the composer — background jobs and sub-agents — each appearing only when there is something to show. Running jobs tick every second with a stop button; sub-agents show the full lineage with token cost and can be interrupted; click a row for the detail drawer with a replayed execution trace. All data comes from mirrors the product already keeps — zero model impact.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/taskpilot1.png" width="640" alt="taskpilot: the sub-agent pill, expanded">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/taskpilot2.png" width="640" alt="taskpilot: the jobs pill and detail drawer">

</details>

### context-guard — compact before you run out

When context occupancy crosses your configured ratio, a compact button appears in the composer toolbar — one click runs the official /compact, before overflow starts rejecting requests. Tune the ratio to your taste (0.01–1); lower means earlier.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-guard-settings-2.png" width="640" alt="context-guard: the configurable ratio">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-guard-button.png" width="640" alt="context-guard: the compact button">

</details>

### inline-html-render — inline HTML cards

A ```` ```dsh-card ```` HTML block in the agent's reply renders as a sandboxed interactive card right in the conversation — sketch the UI first, agree on the details, then build it, instead of discovering the mismatch after everything is done. Sandboxed and isolated; animations settle down under `prefers-reduced-motion`.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/inline-html-card-1.png" width="640" alt="inline-html-render: an interactive card in the conversation">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/inline-html-card-2.png" width="640" alt="inline-html-render: sketching design variants as cards before touching code">

</details>

### capability-catalog — the capability catalog

A new Tools & Skills entry in settings: every skill and tool in the running instance, each labeled with its registration channel (official built-in / project / user / plugin); a three-column card grid, a detail modal with the full SKILL.md, metadata and credential config, and an add-skill modal that installs from an uploaded zip or a pasted SKILL.md.

<details open>
<summary>Screenshots (3)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/capability-catalog-1.png" width="640" alt="capability-catalog: the three-column grid">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/capability-catalog-2.png" width="640" alt="capability-catalog: skill detail">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/capability-catalog-3.png" width="640" alt="capability-catalog: adding a skill">

</details>

### whalesong — ambient status

While any session runs, the sidebar whale spouts and the tab icon moves; when a run finishes or stalls waiting for you, a short chime plays (synthesized WebAudio, silenced under `prefers-reduced-motion`).

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/whalesong1.png" width="640" alt="whalesong: spouting while tasks run">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/whalesong2.png" width="640" alt="whalesong: chime and tab icon on completion">

</details>

### mobile — mobile access

A mobile presentation of the web UI for phone browsers, plus the iOS bridge — check in on sessions, hand out tasks, and handle approvals away from your desk.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/mobile-conversation.png" width="260" alt="mobile: the conversation view on a phone"> <img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/mobile-library.png" width="260" alt="mobile: the list view on a phone">

</details>

## Make it yours

- **Remove a member**: disable/uninstall in Settings → Plugins, or `dsh plugin --profile <your profile> remove <package name>` — the rest keep working. The suite is a starting point, not a lock-in.
- **Add more**: any `@khorsheed/dsh-*` plugin installs the same way — copy the package name.
- **Update**: from Settings → Plugins, or `dsh plugin --profile <your profile> update` to pull the newest versions in range.

## Other suites

The essentials are the layer everyone wants; add a suite for the scene you work in.

| Suite | Package | What it is |
|---|---|---|
| [Dev Suite](https://github.com/Khorsheed/dsh-dev) | `@khorsheed/dsh-dev-suite` | Local coding-agent delegation, multi-agent rooms, live worktree state, quick judgements, the restart guard and the context lens — with "开发模式" (dev mode) |
| [Learning Suite](https://github.com/Khorsheed/dsh-learning) | `@khorsheed/dsh-learning-suite` | Library-style close reading, the reading space and local transcription — with "学习模式" (learning mode) |
| [Video Suite](https://github.com/Khorsheed/dsh-video) | `@khorsheed/dsh-video-suite` | A cutting room with speaker splitting and delete-the-word-deletes-the-audio, plus local-agent delegation — with "剪辑模式" (editing mode) |
| [Gamedev Suite](https://github.com/Khorsheed/dsh-gamedev) | `@khorsheed/dsh-gamedev-suite` | Build small games with the agent, plus local-agent delegation — with "游戏开发模式" (game dev mode) |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | The plugin monorepo: the capability map of every package and the development docs |

## Compatibility

Needs DSH 0.1.5 or later; verified on 0.2.1.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Developing

Plugins live in [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) (single source of truth). This repo carries only the profile template and docs. Issues welcome.

## Install guide for agents

<details>
<summary><strong>Expand: whole-suite install + single-package CLI install</strong> (follow this when the user says "install this for me")</summary>

### 1. Installing the whole suite (recommended)

```sh
dsh plugin --profile web add @khorsheed/dsh-basic
```

Or Settings → Plugins → Add plugin, enter `@khorsheed/dsh-basic`. Restart the web instance, then ask the user to **hard-refresh** (Cmd/Ctrl+Shift+R) — new interface code only loads on a hard refresh; a plain reload may keep serving the cached page. Then present the feature list (the plugin table above).

### 2. Installing a single plugin

- **Dialog**: Settings → Plugins → Add plugin, enter the package name (e.g. `@khorsheed/dsh-whalesong`), enable as prompted.
- **CLI**: `dsh plugin --profile <profile> add <package name>`; `remove` to uninstall, `update` to upgrade.

</details>
