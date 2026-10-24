# @khorsheed/dsh-video-suite

English | [中文](README.md)

Edit podcasts and conversations in dsh: one mixed recording splits into each speaker automatically, the transcript is the editing desk, and deleting a sentence deletes that stretch of audio.

Editing a chat among friends used to mean hunting through waveforms in an editor for who said what, and cutting filler words and long pauses one by one. Install the video suite and switch a session to 「剪辑模式」 (video mode): after import, the recording splits into its voices automatically, and the voiceprints stored with the show recognize the regulars; the transcript is colored by speaker — click a sentence to cut it, click again to restore. What to cut is something you discuss with the agent in the session — it scans for filler words, long pauses and repetitions and offers them as a set of proposals awaiting your ✓, structural choices too, and nothing lands until you nod; details are tuned in the right-sidebar 「剪辑」 (editing) panel. Finally you export podcast audio, a full video with subtitles, SRT subtitles, the transcript and shownotes. When there is a lot to do, you can hand part of it to your local Codex / Claude Code / Kimi, or open a room and have several agents work on it together. This suite is for people who make podcasts and record conversations.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-video-hero.png" width="640" alt="a video-mode session: a set of edit proposals from the agent in the conversation on the left, the right-sidebar editing panel showing a speaker-colored transcript and the player">

## Things you can say to the agent

- "Import this episode's recording, split out the speakers, and check whether it's our two regular hosts."
- "Find the filler words and repetitions and give me a set of proposals."
- "The first ten minutes ramble — how would you cut them?"
- "Export an MP3 and an MP4 with subtitles, and write the shownotes."

## Features

- **Recognize speakers in one mixed recording** — on-device speaker separation finds the voices, then the voiceprints stored with the show recognize the regulars.
- **Delete a word, delete the audio** — the transcript is colored by speaker; click a sentence to cut it, click again to restore; by default only what stays is shown, and a mistaken cut can be undone within 6 seconds.
- **Proposals, never silent edits** — the filler words, pauses, repetitions and structural choices the agent finds come as a set of dashed proposals that take effect only on your ✓.
- **Pauses shortened, not deleted** — long pauses shrink to 0.6 seconds by default, with a per-speaker threshold.
- **Edit while you listen** — the player plays the edited cut or the raw audio, with the current paragraph and word highlighted as it goes.
- **Video aligns itself** — footage shot on a phone aligns to the recording by the audio waveform, no clap needed.
- **Show → project** — a show stores intro and outro, loudness target, subtitle style, editing habits and voiceprints, which each episode's project reuses.
- **Export** — MP3, 1080p MP4 (burned-in subtitles or a switchable subtitle track), SRT and TXT, running in the background with progress shown in both the panel and the session.
- **An extra pair of hands** — delegate work to your local Kimi / Codex / Claude Code, or open a room and have several agents work together.
- **Only in video-mode sessions** — the editing, delegation and room model tools are granted per session; no other session sees any of them.

## Members

| Member | What it does |
| --- | --- |
| Video studio (`@khorsheed/dsh-video-studio`) | shows, projects and media jobs, the right-sidebar 「剪辑」 panel |
| Local transcription (`@khorsheed/dsh-transcribe`) | the studio's speaker-separation and transcription engine (split out of the studio on 2026-10-20) |
| Local agent core (`@khorsheed/dsh-local-agent`) | the local CLI agent family core: an isolated directory per CLI, login commands and the settings card |
| Kimi (`@khorsheed/dsh-local-agent-kimi`) | delegate tasks to your local Kimi Code CLI |
| Codex (`@khorsheed/dsh-local-agent-codex`) | delegate tasks to your local Codex CLI |
| Claude Code (`@khorsheed/dsh-local-agent-claude-code`) | delegate tasks to your local Claude Code |
| dsh delegation (`@khorsheed/dsh-local-agent-dsh`) | delegate tasks to an isolated headless dsh (turned on in settings, off by default) |
| Room (`@khorsheed/dsh-room`) | turn a session into a workspace with a coordinator and members, drawn from local agents and native dsh sub-members |

## Install

Paste the package name `@khorsheed/dsh-video-suite` into the host's add-plugin dialog (or pick it from the marketplace index), confirm, and restart the instance — this one install brings every member along as dependencies, and this package mounts the mode and the members. Then switch a session to 「剪辑模式」 in the mode selector.

The CLI equivalent:

```sh
dsh plugin --profile web add @khorsheed/dsh-video-suite
```

<!-- collection:start -->
Recommended: install it together with the basic suite (the Video collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-video-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-video-suite
```

Removing the bundle removes the members too, video mode included; to keep the members and turn off just one, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.7-rc.1`): ✅ full — pure composition; the members floor at `0.1.5-rc.1` (video-studio), but the mode preset row (an `@deepseek-ai/dsh-agent-preset` declaration) only exists on host `0.1.7-rc.1` and later, so the floor is the higher of the two. Member behavior details are in their own Compatibility sections.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.2.1-rc.1).

**Version-line map**: `0.1.0` and later require host `0.1.7-rc.1` and up.

## Known Limitations

- **Needs ffmpeg on this machine** — editing and export need `ffmpeg` / `ffprobe`; the speech models (about 360 MB) download automatically on the first transcription.
- **A mixed recording cannot be cut for one speaker only** — cutting a span cuts everyone in it, and cross-talk and backchannels are kept by default; multitrack recordings with one mic per person are not supported yet.
- **Media is imported by path** — enter a local path in the panel or give one in the session; drag-and-drop upload in the browser is not built yet.
- **Speaker accuracy depends on the recording** — recordings far from the recorder, with similar voices or heavy cross-talk get split wrong and need merging or re-segmenting in the panel.
- **Install the CLIs yourself** — the CLIs used for delegation must be installed on `PATH` and logged in by you; this package neither installs nor logs in for you.
- **Uninstall is family-wide** — removing this package removes the members too; to turn off just one, use the row-level switches on the bundle detail page.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A mode pack = a family bundle + one mode preset row.** The package registers no service, tool, slot, or command. The member rows in `cordis.patch.yml` come verbatim from the member packages' own `cordis.patch.yml`; the final row, `preset-dsh-video` (an `@deepseek-ai/dsh-agent-preset` declaration, mode id `dsh-video`), is this package's own canonical copy — it once mirrored `@khorsheed/dsh-presets`, which retired on 2026-10-24. The repo-level check:plugins `dsh.bundle.kind: 'mode'` sanction pins the whole shape mechanically: rows may only come from "the members' canonical rows + exactly one preset-<mode> row", every member must be a real self-mounting package, every member contributes at least one row, and the mode value is unique across the tree.

| Member package | Row id |
| --- | --- |
| `@khorsheed/dsh-video-studio` | `video-studio`; `video-studio-tool` (granted by this package's preset) |
| `@khorsheed/dsh-transcribe` | `transcribe` |
| `@khorsheed/dsh-local-agent` | `local-agent` |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi`; `tool-subagent-kimi` (granted by this package's preset) |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex` (+ override `tool-subagent-codex`); `tool-subagent-codex-local` (granted by this package's preset) |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code` (+ override `tool-subagent-claude-code`); `tool-subagent-claude-code-local` (granted by this package's preset) |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` |
| `@khorsheed/dsh-room` | `room`; `room-tool` (granted by this package's preset) |

**Model tools granted per session.** Video mode = the editing-partner persona plus the editing workflow: the `video_*` tools and the `video-studio` skill are the video-studio package's `./tool` composition entry, granted per session at the `video-studio-tool` grant point in this package's preset row rather than mounted as a profile-root row; the delegation tools `subagent_kimi` / `subagent_codex` / `subagent_claude_code` and the room's `room-tool` work the same way. The two bare overrides disable the official preset's tool rows that share this family's tool names (`subagent_codex` / `subagent_claude_code`), carried verbatim from the codex / claude-code providers' own patches.

**A card-less library.** `@khorsheed/dsh-local-agent-dsh-headless` goes into `dependencies` but contributes no patch row; it never appears in the inventory and lives and dies with the family.

**Installing me = installing the members + one mode, never a double mount.** The members are listed in `dependencies` (installing brings them all) and registered in `dsh.references` (the family roster read at pack time and by the catalog layer). `dsh plugin add` reconciles only the profile's **direct** dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies **this** patch only; the members' own patches are not applied, so no row is ever mounted twice. A member installed on its own still self-mounts; the bundle detail page's row-level switches resolve any overlap.

**`src/index.ts` exports constants only** (`MODE` / `FAMILY_MEMBERS`), so the package has a buildable `lib/` (a hard requirement of pack-dist).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/video`). Issues and contributions go there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
