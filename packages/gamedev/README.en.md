# @khorsheed/dsh-gamedev-suite

English | [中文](README.md)

Make small games with the agent: settle the gameplay in conversation, read the chaptered design doc in the right sidebar, and play the latest version that passed each round's checks.

Making a small game used to mean writing the code yourself, or having a model write some code and then working out how to run it, hunting bugs, and watching fixes break something else. Install the gamedev suite and switch a session to 「游戏开发模式」 (gamedev mode), and the agent both writes the code and acts as your design partner: first you settle a one-line pitch, which kinds of elements the game has, and which art style to use, with two or three concrete options offered for every open question so you can decide; then it builds the smallest playable version as early as possible and improves it bit by bit from how playing it feels to you. At the end of every round, the plugin checks the changed project automatically — a failure goes back to the agent to fix on the spot, and only a pass reaches the play area of the right-sidebar 「游戏」 (game) tab. No game-design experience needed.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-gamedev-hero.png" width="640" alt="a gamedev-mode session: the round's change card at the end of the conversation on the left, the right-sidebar game console playing the latest version">

## Things you can say to the agent

- "I want to make a dodge-the-meteors game — give me a few gameplay directions first."
- "The hero jumps too low — raise it a bit and publish a new version for me to try."
- "Add an enemy that chases the player."
- "Fill out the 'Levels' chapter of the design doc."

## Features

- **A design mentor walks you through it** — every open question (gameplay, a mechanic, an element's look or numbers) comes with two or three concrete options and a one-line reason each, at most two questions at a time, and the decisions are yours.
- **Playable first, then iterate** — once the gameplay, element types and art style are settled, the smallest playable version comes first; each round changes one or two things, says what changed, and records decisions in the matching design chapter.
- **Automatic checks every round** — project-file validation, a headless smoke load in the local Chrome, and the test scripts the agent writes alongside the code; a failure goes back to the agent to fix within the same round (up to 2 times), and a pass goes into the play area.
- **The right-sidebar 「游戏」 console** — playtest tuning, look editing, the chaptered design doc, versions and rollback all live here.
- **A change card each round** — at the end of each round, a card at the end of the reply lists what this round changed, and each row's 「查看」 (view) jumps straight to the matching place in the right sidebar.
- **Edit in the panel, submit as a new version** — change looks, fields and lore under 「元素」 (elements) and the preview follows immediately, while the play area stays as it was.
- **A project is a folder** — the project lives in the session workspace with its version snapshots, check results and playtest records inside, so copying the folder takes everything along.
- **An extra pair of hands** — delegate work to your local Kimi / Codex / Claude Code, or open a room and have several agents work together.
- **Only in gamedev-mode sessions** — the game, delegation and room model tools are granted per session; no other session sees any of them.

## Members

| Member | What it does |
| --- | --- |
| Game dev (`@khorsheed/dsh-game`) | the right-sidebar 「游戏」 design console (playtest tuning, look editing, chaptered design doc, versions and rollback) and automatic end-of-round checks |
| Local agent core (`@khorsheed/dsh-local-agent`) | the local CLI agent family core: an isolated directory per CLI, login commands and the settings card |
| Kimi (`@khorsheed/dsh-local-agent-kimi`) | delegate tasks to your local Kimi Code CLI |
| Codex (`@khorsheed/dsh-local-agent-codex`) | delegate tasks to your local Codex CLI |
| Claude Code (`@khorsheed/dsh-local-agent-claude-code`) | delegate tasks to your local Claude Code |
| dsh delegation (`@khorsheed/dsh-local-agent-dsh`) | delegate tasks to an isolated headless dsh (turned on in settings, off by default) |
| Room (`@khorsheed/dsh-room`) | turn a session into a workspace with a coordinator and members, drawn from local agents and native dsh sub-members |

## Install

Paste the package name `@khorsheed/dsh-gamedev-suite` into the host's add-plugin dialog (or pick it from the marketplace index), confirm, and restart the instance — this one install brings every member along as dependencies, and this package mounts the mode and the members. Then switch a session to 「游戏开发模式」 in the mode selector.

The CLI equivalent:

```sh
dsh plugin --profile web add @khorsheed/dsh-gamedev-suite
```

<!-- collection:start -->
Recommended: install it together with the basic suite (the Gamedev collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-gamedev-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-gamedev-suite
```

Removing the bundle removes the members too, gamedev mode included; to keep the members and turn off just one, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.2.0-rc.1`): ✅ full — pure composition; the floor is the member's own (minHost `0.2.0-rc.1`, game's floor). Member behavior details are in their own Compatibility sections.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.2.1-rc.1).

**Version-line map**: `0.1.0` and later require host `0.2.0-rc.1` and up.

## Known Limitations

- **All visuals are drawn in code** — the host has no text-to-image, so art styles are limited to what code can draw well; games run in a sandbox, so code and assets must live in the project.
- **No sharing with others yet** — single-file export and publishing to outside platforms come later.
- **Checks need the local Chrome** — the automatic checks load the game in the local Chrome, headless.
- **Install the CLIs yourself** — the CLIs used for delegation must be installed on `PATH` and logged in by you; this package neither installs nor logs in for you.
- **Uninstall is family-wide** — removing this package removes the members too; to turn off just one, use the row-level switches on the bundle detail page.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A mode pack = a family bundle + one mode preset row.** The package registers no service, tool, slot, or command. The member rows in `cordis.patch.yml` come verbatim from the member packages' own `cordis.patch.yml` (the `game-agent` companion composition row stays out of the patch and lives only in the preset composition); the final row, `preset-dsh-gamedev` (an `@deepseek-ai/dsh-agent-preset` declaration, mode id `dsh-gamedev`), is this package's own canonical copy — it once mirrored `@khorsheed/dsh-presets`, which retired on 2026-10-24. The repo-level check:plugins `dsh.bundle.kind: 'mode'` sanction pins the whole shape mechanically: rows may only come from "the members' canonical rows − the companion composition rows + exactly one preset-<mode> row", every subtracted companion row must be granted by name in this package's preset composition, every member must be a real self-mounting package, every member contributes at least one row, and the mode value is unique across the tree.

| Member package | Row id |
| --- | --- |
| `@khorsheed/dsh-game` | `game`; `game-agent` (granted by this package's preset) |
| `@khorsheed/dsh-local-agent` | `local-agent` |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi`; `tool-subagent-kimi` (granted by this package's preset) |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex` (+ override `tool-subagent-codex`); `tool-subagent-codex-local` (granted by this package's preset) |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code` (+ override `tool-subagent-claude-code`); `tool-subagent-claude-code-local` (granted by this package's preset) |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` |
| `@khorsheed/dsh-room` | `room`; `room-tool` (granted by this package's preset) |

**Model tools granted per session.** Gamedev mode = the game-developer-and-design-mentor persona plus the game workbench. The game tools (`game_open` / `game_read` / `game_propose` / `game_publish`) and game skills (the game `./agent` entry) are not mounted as a profile-root row; they are granted per session at the `game-agent` grant point in this package's preset row. When the member is installed alone its own patch makes that entry globally available; on host 0.2.x this mode's sessions see the scoped copy shadow the global row, so there is no double registration crashing boot (pinned by the host's scoped.spec.ts). The delegation tools and `room-tool` are granted per session the same way; the two bare overrides disable the official preset's tool rows that share this family's tool names (`subagent_codex` / `subagent_claude_code`), carried verbatim from the codex / claude-code providers' own patches.

**A card-less library.** `@khorsheed/dsh-local-agent-dsh-headless` goes into `dependencies` but contributes no patch row; it never appears in the inventory and lives and dies with the family.

**Installing me = installing the members + one mode, never a double mount.** The members are listed in `dependencies` (installing brings them all) and registered in `dsh.references` (the family roster read at pack time and by the catalog layer). `dsh plugin add` reconciles only the profile's **direct** dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies **this** patch only; the members' own patches are not applied, so no row is ever mounted twice. A member installed on its own still self-mounts; the bundle detail page's row-level switches resolve any overlap.

**`src/index.ts` exports constants only** (`MODE` / `FAMILY_MEMBERS`), so the package has a buildable `lib/` (a hard requirement of pack-dist).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/gamedev`). Issues and contributions go there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
