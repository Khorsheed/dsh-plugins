# @khorsheed/dsh-video-suite

English | [中文](README.md)

The video editing mode in one install: the `dsh-video` agent preset plus the video studio — podcast and conversation editing, one mixed recording auto-split by speaker, cut by deleting words. One 「剪辑模式」 card in the inventory; a session switched to editing mode gets the `video_*` tools and the video-studio skill automatically; for more hands it can delegate to the local Codex / Claude Code / Kimi or open a room where several agents work together (the local-agent family and the room come with the pack).

## What the mode is

Editing mode is the editing-partner persona plus the editing workflow: you discuss what to cut in the conversation (every change is a proposal that lands only when you say so), the 剪辑 panel on the right shows the same project and tunes the details, and exports cover audio, video, subtitles and shownotes. Switch a session to 「剪辑模式」 in the mode selector and they are there; no other session sees any of them.

## Members

| member package | row id | contents |
| --- | --- | --- |
| `@khorsheed/dsh-video-studio` | `video-studio` | the studio: the project store and media jobs service core, plus the 剪辑 right-sidebar panel |
| `@khorsheed/dsh-transcribe` | `transcribe` | local transcription: the studio's speaker separation and ASR engine (split out of the studio 2026-10-20) |
| `@khorsheed/dsh-local-agent` | `local-agent` | the local CLI agent family core: shared scoped-homes root, delegation facade and Remote |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi` | Kimi CLI harness; `subagent_kimi` is granted by this bundle's preset |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex` (+ override `tool-subagent-codex`) | Codex CLI harness; `subagent_codex` is granted by this bundle's preset |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code` (+ override `tool-subagent-claude-code`) | Claude Code harness; `subagent_claude_code` is granted by this bundle's preset |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` | the dsh harness controller (Settings → 本地 Agent switch, off by default) |
| `@khorsheed/dsh-room` | `room` | the room: members come from the local agents and native dsh sub-members; `room-tool` is granted by this bundle's preset |

The `video_*` tools and the `video-studio` skill are not a profile-root row: they ship as the video-studio package's `./tool` composition entry, granted per session by the `video-studio-tool` grant inside this bundle's preset row.

## Install

Paste the package name `@khorsheed/dsh-video-suite` into the host's add-plugin dialog (or pick it from the marketplace index), confirm, and restart the instance — this one install brings the member along as a dependency, and the bundle's own patch mounts both the mode preset and the member row. Then switch a session to 「剪辑模式」 in the mode selector.

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

Removing the bundle removes the member along with the mode preset; to keep the member and disable a single row, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.7-rc.1`): ✅ full — pure composition; the member floors at `0.1.5-rc.1` (video-studio), but the mode preset row (an `@deepseek-ai/dsh-agent-preset` declaration) only exists on host `0.1.7-rc.1` and later, so the floor is the higher of the two. Member behavior details live in the member's own Compatibility section.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.2.1-rc.1).

**Version-line map**: `0.1.0` and later require host `0.1.7-rc.1` and up.

## Known Limitations

- **Removal is all-or-nothing** — removing this package removes the member along with it; to disable a single row, use the row-level switches on the bundle detail page.
- **This package holds the canonical preset row** — it once mirrored @khorsheed/dsh-presets, which retired on 2026-10-24.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A mode bundle = a family bundle plus one mode preset row.** The member row in `cordis.patch.yml` comes verbatim from the member's own `cordis.patch.yml`; the closing `preset-dsh-video` row (an `@deepseek-ai/dsh-agent-preset` declaration) is this package's own canonical copy (it once mirrored the retired `@khorsheed/dsh-presets`). The repo-wide check:plugins `dsh.bundle.kind: 'mode'` sanction pins the whole shape mechanically: rows may only come from the allowlist union of member canonical rows plus exactly one `preset-<mode>` row, members must be real self-mounting packages each contributing at least one row, and the mode value is unique across the tree.

**Installing me installs the member and the mode — without double-mounting.** The member is listed in `dependencies` (installation brings it along) and registered in `dsh.references` (the roster, read by pack-time and catalog checks). `dsh plugin add` reconciles only the profile's *direct* dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies THIS patch only; the member's own patch stays inert, so no row ever mounts twice. A member installed directly still self-mounts; any overlap is resolved by the row-level switches on the bundle detail page.

**`src/index.ts` exports only constants** (`MODE` / `FAMILY_MEMBERS`) so the package has a buildable `lib/` (a pack-dist requirement).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/video`). Issues and contributions welcome there.
