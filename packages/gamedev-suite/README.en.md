# @khorsheed/dsh-gamedev-suite

English | [中文](README.md)

**A one-stop kit for making small games with an agent: settle the gameplay in chat, the agent writes the code and keeps the design notes, and you play the latest version that passed each round's check in the right sidebar.** Say what kind of game you want; the agent gives you two or three options to pick from for each question and quickly builds a small playable version first. After every round of changes it checks the game itself, so a broken version never reaches you. Jump height and running speed can become sliders you tune while playing; the looks of the hero, enemies and items you can draw yourself, or have the agent offer three options at once. What you change in the panel is committed as a new version, and the agent won't change it back; every version is kept, you can roll back any time, and export one as a single file to send to friends. When there's a lot to do, hand work to the Kimi, Codex or Claude Code on your computer, or bring several agents into one session to build together. Comes with "游戏开发模式" (game dev mode), installed in one go.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-1.png" width="800" alt="The right sidebar's Game panel, Play: live v13 waiting for "Start", then sliders such as walk and sneak speed that take effect as you drag; a game-dev mode session on the left">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-gamedev-suite
```

That installs all 8 members below; restart DSH and they're ready. It's best to also install `@khorsheed/dsh-basic` (Basic Essentials), which carries everyday things like editing messages and previewing files.

Then start a new session, pick "游戏开发模式" (game dev mode), and tell the agent what game you'd like to make. All of this only shows up in game-dev-mode sessions; not seeing it in other modes is expected.

## Things you can say to the agent

- "I want a little game about dodging meteors. Give me a few gameplay directions first."
- "The hero doesn't jump high enough. Raise it a bit and send me a new build."
- "Add an enemy that chases the player."
- "Fill in the levels chapter of the design."
- "Hand the enemy behavior to Codex, and check its work when it's done."
- "Invite Claude Code and Kimi: one does the levels, the other the enemies, and you coordinate."

The agent asks at most two questions at a time, and every decision is yours.

## The gamedev suite — plugin list

| Plugin | Package name (copy to install) | What you get |
|---|---|---|
| game | `@khorsheed/dsh-game` | Game: the "Game" panel in the right sidebar — play, tune the feel, change looks, keep the design, manage versions |
| local-agent | `@khorsheed/dsh-local-agent`, `@khorsheed/dsh-local-agent-kimi`, `@khorsheed/dsh-local-agent-codex`, `@khorsheed/dsh-local-agent-claude-code`, `@khorsheed/dsh-local-agent-dsh` | Local agent delegation: hand work to Kimi, Codex, Claude Code or another DSH on your computer, watch it live and keep talking to it |
| room | `@khorsheed/dsh-room` | Room: bring several agents into one session, @ a name to give them work, a coordinator splits tasks, you have the final say |
| typesafe | `@khorsheed/dsh-typesafe` | Quick decisions: how the room decides on its own whether a new message joins an open task and when members' results are reported together |

## Features

### game: Game

Making a small game used to mean writing the code yourself, or having a model spit some out and then working out how to run it, hunting bugs, and watching each fix break something else. Now you just say what you want and what feels off after playing. The name, the one-line pitch, the kinds of things in the game, the art style: the agent asks about each in turn, and for the style you just pick one of the samples. It builds the smallest playable version first, checks its own work after every round, fixes what fails on the spot, and only a passing version lands under "Play" in the right-sidebar "Game" panel; want to look before anything goes live? Turn off "Auto-deploy". Numbers like jump height and run speed become sliders; drag them around and press "Finalize" when it feels right. The hero, enemies, items, even trees, rocks and houses live under "Elements": draw them yourself, or press "Ask the agent for a new look" and pick from three options; press "Commit as a new version" and what you changed in the panel goes into the game. "Design" keeps what you've decided, chapter by chapter; "Versions" keeps every version, so you can switch back to an old one, or export a single `.html` file and send it to a friend. At the end of each round, a card at the bottom of the reply lists what changed, and "View" jumps straight to it. The whole game is one folder in the session's workspace, so copying the folder takes it all with you. Everything on screen is drawn by code, with no AI image generation, and the checks use Chrome on this computer.

<details open>
<summary>Screenshots (3)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-2.png" width="640" alt="game: The Elements page: one tile per element — mountains, strange beasts, terrain, characters, buildings — each with a preview">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-3.png" width="640" alt="game: An element opened: the traveler's 3D model you can drag to rotate, with idle, sneak, walk and other animations, front, side and back views, then "Ask the agent to change the look" and its lore">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-4.png" width="640" alt="game: The Versions page: every change ships as a checked version; below live v13 the history, each with "Switch back", "Compare with v13" and "Export"">

</details>

### Local agent delegation

Getting a hand from Codex or Claude Code on your machine used to mean opening a terminal, copy-pasting, and carrying the results back. Now you say "give it to Codex" and the agent passes that piece of work to the Kimi, Codex or Claude Code installed on your computer: it works in a sub-session where its thinking, tool calls and replies show up live, and you can stop it midway; when it's done, the result comes back to your session with its usage and time. You can keep talking to the sub-session directly, switching model and reasoning effort in its own input bar, and it picks up again after DSH restarts. The plugins log in and keep their records in their own folders, so your existing setup and accounts on the computer are never touched. The "Local Agent Delegation" card in settings shows each tool's login state and default model at a glance. A separate DSH running on its own can take work too; it's ready in Game Dev mode sessions, with nothing to switch on.

<details open>
<summary>Screenshots (1)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-settings.png" width="640" alt="local agent delegation: The Local Agent Delegation card on the Plugins page: the Kimi section with sign-in status, endpoint, API key, available models and the resident-mode switch">

</details>

### room: Room

Getting several agents onto one job used to mean copy-pasting between windows. Press "＋ Invite agent" in a session to bring in the first member and the session becomes a room, with DSH's own agent as the first coordinator; after that, @ someone to give them work, @ several names to start them all at once, and any member can take over via "Set as coordinator" on the Members page. Members can message each other and report back to whoever gave them the work; to look first, set member-to-member messages to wait for your OK on the Members page, or pause the whole room. A pill above the chat box shows "● N tasks running"; open it for the task page — who gave what to whom, how long and how many tokens each took — and stop a whole task or just one subtask. The "Team" button draws how you, the coordinator and the members connect. For bigger work, set a formal goal with phases and tasks; members hand in evidence, and you decide whether it's accepted or goes back for rework. Every member keeps its own session, so you can open it any time to see what it did.

<details open>
<summary>Screenshots (3)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-1.png" width="640" alt="room: a room in progress, member receipts and run lines in the chat, the @ member menu open above the input box">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-invite.png" width="640" alt="room: the empty Members page offering to turn the session into a multi-agent room, and the Invite agent entry in the session header">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-2.png" width="640" alt="room: the Members page, member cards with name, source, role and model, and Set as coordinator">

</details>

## Make it yours

- **Remove a member**: open the gamedev suite's detail page in Settings → Plugins and switch that one off — the rest keep working. Uninstalling the suite (`dsh plugin --profile <your profile> remove @khorsheed/dsh-gamedev-suite`) removes its members with it.
- **Add more**: any `@khorsheed/dsh-*` plugin installs the same way — copy the package name.
- **Update**: from Settings → Plugins, or `dsh plugin --profile <your profile> update` to pull the newest versions in range.

## Other suites

The essentials are the layer everyone wants; add a suite for the scene you work in.

| Suite | Package | What it is |
|---|---|---|
| [Basic Essentials](https://github.com/Khorsheed/dsh-basic) | `@khorsheed/dsh-basic` | Everyday quality of life: edit and withdraw messages, session artifacts, background-job pills, compaction reminders, the capability catalog, mobile — recommended for everyone |
| [Dev Suite](https://github.com/Khorsheed/dsh-dev) | `@khorsheed/dsh-dev-suite` | Local coding-agent delegation, multi-agent rooms, live worktree state, quick judgements, the restart guard and the context lens — with "开发模式" (dev mode) |
| [Learning Suite](https://github.com/Khorsheed/dsh-learning) | `@khorsheed/dsh-learning-suite` | Library-style close reading, the reading space and local transcription — with "学习模式" (learning mode) |
| [Video Suite](https://github.com/Khorsheed/dsh-video) | `@khorsheed/dsh-video-suite` | A cutting room with speaker splitting and delete-the-word-deletes-the-audio, plus local-agent delegation — with "剪辑模式" (editing mode) |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | The plugin monorepo: the capability map of every package and the development docs |

## Compatibility

Needs DSH 0.2.0 or later; verified on 0.2.1.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Developing

Plugins live in [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) (single source of truth); each member's details are in its own README under [packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages). Issues welcome.

## Install guide for agents

<details>
<summary><strong>Expand: whole-suite install + single-package CLI install</strong> (follow this when the user says "install this for me")</summary>

### 1. Installing the whole suite (recommended)

<!-- collection:start -->
Recommended: install it together with the basic suite (the Gamedev collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-gamedev-suite
```
<!-- collection:end -->

Or Settings → Plugins → Add plugin, enter `@khorsheed/dsh-gamedev-suite`. Restart the web instance, then ask the user to **hard-refresh** (Cmd/Ctrl+Shift+R) — new interface code only loads on a hard refresh; a plain reload may keep serving the cached page. Then tell the user to start a new session in "游戏开发模式" (game dev mode) and present the feature list (the plugin table above).

### 2. Installing a single plugin

- **Dialog**: Settings → Plugins → Add plugin, enter the package name (e.g. `@khorsheed/dsh-room`), enable as prompted.
- **CLI**: `dsh plugin --profile <profile> add <package name>`; `remove` to uninstall, `update` to upgrade.
- The game installed on its own makes its tools available in every session; local agent delegation needs the core package plus at least one tool installed together (`add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-codex`).

</details>
