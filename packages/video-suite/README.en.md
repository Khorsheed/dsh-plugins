# @khorsheed/dsh-video-suite

English | [中文](README.md)

**Everything for editing podcasts and conversations: the transcript is your editing desk, and deleting a sentence cuts that stretch of audio.** One mixed recording is split into each speaker, and once you name a new voice, the same show recognizes it next time; click a sentence to cut it and again to bring it back, and your original recording is never touched; the agent scans for filler words, long pauses and repeats and lists them as a set of suggestions, nothing counts until you press "Accept", and long pauses get shortened rather than cut out; edit while you listen, with the current sentence highlighted, and fix mistranscribed words in place; phone footage lines up with the audio by sound, no clapping needed; intro and outro, subtitle style and your regulars' voices are saved with the show and reused every episode; export an MP3, a subtitled MP4, SRT subtitles and the transcript in one go, and have the agent write the shownotes in the session; transcription runs entirely on your own computer…… Everything an episode needs, with "剪辑模式" (editing mode) built in, installed in one go.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-video-hero.png" width="1000" alt="An editing-mode session: a set of edit suggestions from the agent in the chat, and the Studio panel in the right sidebar showing the speaker-colored transcript and player">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-video-suite
```

That installs all 8 members below; restart DSH and they're ready. It's best installed together with `@khorsheed/dsh-basic` (Basic Essentials), which carries everyday things like editing messages and previewing files.

Then start a new session, pick "剪辑模式" (editing mode), and tell the agent where the recording is. The Studio panel in the right sidebar only appears in editing-mode sessions, so not seeing it in other modes is expected.

Before you start: you need ffmpeg on your computer, and the first transcription downloads a speech model of about 360 MB. To hand work to Kimi, Codex or Claude Code on your machine, install them yourself first.

## Things you can say to the agent

- "Import this episode, split out the speakers, and check whether they're our two regular hosts."
- "Find the filler words and the repeated bits and give me a set of suggestions."
- "The first ten minutes ramble. How would you cut them?"
- "Shorten the long pauses a bit — don't cut them out entirely."
- "Export an MP3 and a subtitled MP4, and write the shownotes."

## Plugin list

| Plugin | Package name (copy to install) | What you get |
|---|---|---|
| video-studio | `@khorsheed/dsh-video-studio` | Studio in the right sidebar: a speaker-colored transcript, click a sentence to cut it, the agent's suggestions wait for your OK, one-step export |
| transcribe | `@khorsheed/dsh-transcribe` | Turns the recording into timed text on your own computer and works out who is speaking |
| local-agent | `@khorsheed/dsh-local-agent` | The base for local-agent delegation: a "Local Agent Delegation" card in settings for each tool's sign-in and model; the four below need it |
| local-agent-kimi | `@khorsheed/dsh-local-agent-kimi` | Hand part of a big job to Kimi Code on your machine |
| local-agent-codex | `@khorsheed/dsh-local-agent-codex` | Hand part of a big job to Codex on your machine |
| local-agent-claude-code | `@khorsheed/dsh-local-agent-claude-code` | Hand part of a big job to Claude Code on your machine |
| local-agent-dsh | `@khorsheed/dsh-local-agent-dsh` | Hand a subtask to a separate DSH running on its own; off by default, turn it on in settings |
| room | `@khorsheed/dsh-room` | Bring several agents into one session to work on an episode together |

## Feature tour

### video-studio: Studio

A few friends talk for an hour around one recorder, and editing it used to mean staring at waveforms to work out who's speaking and slicing out filler words one by one. Now hand over the recording, and the Studio panel in the right sidebar shows the transcript colored by speaker: click a sentence to cut it, click again to bring it back, undo if you slip, and your original recording is never touched. Talk over what to cut with the agent in the session; it lists filler words, long pauses and repeats as a set of suggestions, and nothing counts until you press "Accept". Press "Agent assist" and it writes a request into the input box; add what you most want fixed and send. The player at the bottom plays either the "Edited" cut or the "Original", with the current word highlighted; fix mistranscribed words in place, which changes the text and subtitles but not the sound. Phone footage lines up with the audio by sound; each show's intro and outro, loudness, subtitle style and regulars' voices are saved once and reused every episode. Exports run in the background, with progress in both the panel and the session: MP3, 1080p MP4 (subtitles burned in or as a track you can switch off), SRT subtitles and the transcript.

<details open>
<summary>Screenshots (4)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-0.png" width="840" alt="The right sidebar's start page: Studio sits below Session products, Files and Context Lens">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-1.png" width="840" alt="The Sources page: a recording with video, five voices recognized, one row per voice with its length, ▶ Listen and "Merge into…"">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-2.png" width="840" alt="The Transcript page: text split by speaker; selecting a passage offers "Play from here", "Cut" and "Edit text…"; find & replace, scan for fillers and pauses and AI edit at the top, a player switching between edited and original at the bottom">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-3.png" width="840" alt="The Settings page: this episode, the show and global layers — audio and video loudness, intro and outro music, caption style, pauses and fillers, each able to follow the show">

</details>

### transcribe: Local Transcription

This is what Studio's speaker separation and transcription run on: it turns a long recording into timed text on this computer, tells who is speaking even when everyone shared one mic, and your recording never has to go anywhere else. It handles both Chinese and English. The first time, it downloads the speech model; after that it starts right away. It has no screen of its own — the results show up in Studio's transcript; and if you also have the writing or learning suite, it's what makes transcripts for videos and podcasts without subtitles in the reading space.

### Local agent delegation: Kimi, Codex, Claude Code and DSH

When there's a lot to do, say "give this part to Codex" and it runs on your machine, with the process streaming into a sub-session; you can stop it midway, or open the sub-session and keep talking to it, and the result comes back to your main session with real usage and timing. Each tool runs in its own separate directory, so your existing setup and sign-ins are never touched. The "Local Agent Delegation" card in settings shows at a glance whether each one is signed in, and it's where you switch the default model; "Local DSH Delegation" is off by default — turn it on when you need it.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-settings.png" width="840" alt="The Local Agent Delegation card on the Plugins page: the Kimi section with sign-in status, endpoint, API key, available models and the resident-mode switch">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-member.png" width="840" alt="Opening a delegated sub-session and continuing the conversation right there">

</details>

### room: Room

An episode involves a lot: a rough cut, picking highlights, writing shownotes. Press "＋ Invite agent" in a session and it becomes a small team: DSH coordinates, and you bring in Kimi, Codex, Claude Code, or a DSH set up with another mode. @ a name at the start to hand that member the work, @ several to run them in parallel; the coordinator splits tasks and members hand in results, and acceptance is up to you. A capsule above the input box tells you how many tasks are running and how many need you; open it to see who handed what to whom and how long each took.

<details open>
<summary>Screenshots (3)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-1.png" width="840" alt="A room in progress: member receipts and run rows in the chat, and the @ member menu open above the input box">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-invite.png" width="840" alt="The members page's empty state, turning the session into a multi-agent room, and the Invite agent entry in the session header">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-2.png" width="840" alt="The members page: each member's name, source, role and model, with Set as coordinator">

</details>

## Make it yours

- **Remove a member**: disable/uninstall in Settings → Plugins, or `dsh plugin --profile <your profile> remove <package name>` — the rest keep working. Don't use one of the local agents? Turn off just that one; `local-agent` is the base all four share, so turning it off stops them all; `transcribe` is the engine behind Studio's speaker separation and transcription, so keep it. The suite is a starting point, not a lock-in.
- **Add more**: any `@khorsheed/dsh-*` plugin installs the same way — copy the package name.
- **Update**: from Settings → Plugins, or `dsh plugin --profile <your profile> update` to pull the newest versions in range.

## Other suites

The essentials are the layer everyone wants; add a suite for the scene you work in.

| Suite | Package | What it is |
|---|---|---|
| [Basic Essentials](https://github.com/Khorsheed/dsh-basic) | `@khorsheed/dsh-basic` | Edit and withdraw messages, the timeline, title editing, quoting, artifact preview, local files, task capsules, compaction reminders, inline cards, the capability catalog, completion chimes, mobile |
| [Dev Suite](https://github.com/Khorsheed/dsh-dev) | `@khorsheed/dsh-dev-suite` | Local coding-agent delegation, multi-agent rooms, live worktree state, quick judgements, the restart guard and the context lens — with "开发模式" (dev mode) |
| [Writing Suite](https://github.com/Khorsheed/dsh-writing) | `@khorsheed/dsh-writing-suite` | The idea canvas, the novel genre, the reading space and local transcription — with "写作模式" (writing mode) |
| [Learning Suite](https://github.com/Khorsheed/dsh-learning) | `@khorsheed/dsh-learning-suite` | Library-style close reading, the idea canvas and the reading space — with "学习模式" (learning mode) |
| [Gamedev Suite](https://github.com/Khorsheed/dsh-gamedev) | `@khorsheed/dsh-gamedev-suite` | Build small games with the agent, plus local-agent delegation — with "游戏开发模式" (game dev mode) |
| [Eval Suite](https://github.com/Khorsheed/dsh-eval) | `@khorsheed/dsh-eval-suite` | Compare agents on this machine: question sets, experiments, judging and reports — with "评测模式" (eval mode) |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | The plugin monorepo: the capability map of every package and the development docs |

## Compatibility

Needs DSH 0.1.7 or later; verified on 0.2.1.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Developing

Plugins live in [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) (single source of truth); each member's details are in its own README under [packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages). This package has no features of its own; it installs editing mode and the members above together. Issues welcome.

## Install guide for agents

<details>
<summary><strong>Expand: whole-suite install + single-package CLI install</strong> (follow this when the user says "install this for me")</summary>

### 1. Installing the whole suite (recommended)

<!-- collection:start -->
Recommended: install it together with the basic suite (the Video collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-video-suite
```
<!-- collection:end -->

Or Settings → Plugins → Add plugin, enter `@khorsheed/dsh-video-suite`. Restart the web instance, then ask the user to **hard-refresh** (Cmd/Ctrl+Shift+R) — new interface code only loads on a hard refresh; a plain reload may keep serving the cached page. Then present the feature list (the plugin table above), remind the user to start a new session in "剪辑模式" (editing mode), and check that ffmpeg is installed.

Uninstalling the suite (`dsh plugin --profile web remove @khorsheed/dsh-video-suite`) removes its members too; to turn off just one, switch it off on the suite's detail page.

### 2. Installing a single plugin

- **Dialog**: Settings → Plugins → Add plugin, enter the package name (e.g. `@khorsheed/dsh-video-studio`), enable as prompted.
- **CLI**: `dsh plugin --profile <profile> add <package name>`; `remove` to uninstall, `update` to upgrade.
- When installing a single local agent (e.g. `@khorsheed/dsh-local-agent-codex`), install `@khorsheed/dsh-local-agent` alongside it.

</details>
