# @khorsheed/dsh-bundle-local-agent

English | [中文](README.md)

**Let DSH run a team of the agents on your machine.** Hand work to the local Kimi Code, Codex, Claude Code, or a second, separately running DSH in one sentence: watch it live, stop it midway, open the sub-session and keep talking, and pick up again after DSH restarts. Invite several agents into one session and split the work: @ someone to assign it, the coordinator breaks down the task, members bring evidence, and acceptance is still your call. A stuck member can even ask another session for help. Every agent's credential, models, and resident switch live on one card, and your existing CLI setup is never touched…… Everything local multi-agent work needs, installed in one go.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/bundle-local-agent-hero.png" width="800" alt="A room in game dev mode: Claude Code coordinates, and typing @ in the composer lists this room's members, recent sessions and other rooms">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-bundle-local-agent
```

That installs the 8 members below; restart DSH and the plugin list shows just one new card, 「多Agent协作」 (multi-agent). Each member can still be switched on or off on that card's detail page.

Before you start: install the Kimi, Codex, and Claude Code CLIs yourself; this suite doesn't install them. Then on the Plugins page open the 「本机 Agent 委派」 (Local Agent Delegation) card and enter the endpoint and key for each agent you want to use; the plugin detects each CLI's version and whether the endpoint is reachable.

Handing work off and inviting agents into a room happen in a mode that grants them, such as the Dev Suite's "开发模式" (dev mode) (the Gamedev and Video Suite modes include them too). If you mostly write code, installing the Dev Suite `@khorsheed/dsh-dev-suite` is simpler: it already includes this whole family.

## Member plugins

| Plugin | Package name (copy to install) | What you get |
|---|---|---|
| local-agent | `@khorsheed/dsh-local-agent` | The core the four local agents share: one Local Agent Delegation card for sign-in, models, and the resident switch; sub-sessions you can keep talking in |
| local-agent-kimi | `@khorsheed/dsh-local-agent-kimi` | Hand work to the local Kimi Code; watch it live, keep the conversation going |
| local-agent-codex | `@khorsheed/dsh-local-agent-codex` | Hand work to the local Codex; watch it live, keep the conversation going |
| local-agent-claude-code | `@khorsheed/dsh-local-agent-claude-code` | Hand work to the local Claude Code; thinking and replies stream back, every call's usage recorded |
| local-agent-dsh | `@khorsheed/dsh-local-agent-dsh` | Hand subtasks to a second, separately running DSH; ready to use in Dev, Game Dev and Video mode sessions |
| room | `@khorsheed/dsh-room` | The room (协作间): turn a session into a small team, @ someone to assign work, you decide acceptance |
| typesafe | `@khorsheed/dsh-typesafe` | Quick decisions: how the room decides on its own whether a new message joins an open task and when members' results are reported together |
| context-lens | `@khorsheed/dsh-context-lens` | Context Lens: click any turn to see what the model (each member included) received and where tokens and time went |

It also brings `@khorsheed/dsh-local-agent-dsh-headless`, the interface-less DSH behind Local DSH Delegation, which doesn't show up in the list on its own.

## Feature tour

### Local agent delegation: Kimi, Codex, Claude Code

Getting the local Codex or Claude Code to help used to mean opening a terminal, pasting things in, and carrying the result back yourself. Now DSH runs them for you: thinking, tool calls, and changed files appear live in a sub-session; you can stop it midway, or open the sub-session to keep talking and switch model and reasoning effort on the fly. The result comes back to the main session with its real usage and time. Each agent runs in its own separate folder; your existing config and sign-ins are never touched.

<details open>
<summary>Screenshots (1)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-settings.png" width="640" alt="The Local Agent Delegation card on the Plugins page: the Kimi section with sign-in status, endpoint, API key, available models and the resident-mode switch, with Codex and Claude Code folded below">

</details>

### room: the multi-agent room

Getting several agents onto one job used to mean copying and pasting between windows. Now press "＋ Invite agent" in a session and it becomes a small team: DSH coordinates, and you bring in Kimi, Codex, Claude Code, or a DSH carrying another mode. @ someone at the start of a message to assign them work, @ several to run them in parallel; the coordinator breaks down the task and members bring evidence. Finishing a generation isn't passing, and acceptance is up to you. A pill above the composer shows how many tasks are running and how many need you; the "Team" button on the members page draws how you, the coordinator, and the members connect. When a member hits something unfamiliar, it can ask another session or another room, and the reply comes back to it. Every member keeps its own session across rounds and restarts.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-invite.png" width="640" alt="The members page's empty state, turning the session into a multi-agent room, and the Invite agent entry in the session header">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-2.png" width="640" alt="The members page: each member's name, source, role, and model, plus Set as coordinator">

</details>

### context-lens: Context Lens

With several agents on one job, the hard part is seeing what each one is actually doing. Click the small icon under any turn's reply and the right sidebar opens that turn's breakdown: what the model received, how much hit the cache, where the tokens went. Switch to the time view and each agent gets its own lane, sub-agents listed separately, so you can see at a glance who is waiting and whose tools are slow.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-1.png" width="640" alt="Click the request-details icon under a reply and Context Lens opens that turn on the right: one tab for the main conversation and one per member, the requests listed on the left, the cache hit and breakpoint comparison on the right">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-4.png" width="640" alt=""Time breakdown": the turn's total split into model calls, tool calls and other, a color-coded timeline, and a tool-time table sorted by total">

</details>

## Make it yours

- **Use just one agent**: configure only the one you want on the 「本机 Agent 委派」 card (Codex, say), then in any session say "bring Codex in to review the code with me".
- **Uninstall**: removing this suite removes the whole family; to keep some agents, use the detail-page switches instead.
- **Add more**: any `@khorsheed/dsh-*` plugin installs the same way, by its package name.

## Other suites

| Suite | Package | What it's for |
|---|---|---|
| [Basic Essentials](https://github.com/Khorsheed/dsh-basic) | `@khorsheed/dsh-basic` | Edit and withdraw messages, browse files, background-job pills, mobile…… the layer everyone should have |
| [Dev Suite](https://github.com/Khorsheed/dsh-dev) | `@khorsheed/dsh-dev-suite` | Everything in this suite, plus live worktrees, quick decisions, and the restart guard; comes with "开发模式" (dev mode) |
| [Gamedev Suite](https://github.com/Khorsheed/dsh-gamedev) | `@khorsheed/dsh-gamedev-suite` | Make small games with the agent, local agents included; comes with "游戏开发模式" (game dev mode) |
| [Video Suite](https://github.com/Khorsheed/dsh-video) | `@khorsheed/dsh-video-suite` | Per-speaker mixes and an editor where deleting words deletes the audio, local agents included; comes with "剪辑模式" (editing mode) |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | The main plugin repo: a map of every plugin and the developer docs |

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- How the suite installs once without mounting anything twice, and where the members' rows come from: see the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/bundle-local-agent/docs/reference.en.md).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).

## Install guide for agents

<details>
<summary><strong>Expand: installing the whole suite + single packages from the command line</strong> (follow this when the user says "install it for me")</summary>

### 1. Install the suite (recommended)

```sh
dsh plugin --profile web add @khorsheed/dsh-bundle-local-agent
```

Or enter `@khorsheed/dsh-bundle-local-agent` under Plugins → Add plugin. Restart the web instance, then have the user **hard-refresh** the page (Cmd/Ctrl+Shift+R). Remind the user: the CLIs (`kimi` / `codex` / `claude`) must be installed by them, credentials go on the 「本机 Agent 委派」 card, and delegation and the room are used in sessions of a mode like "开发模式" (dev mode). Finish by presenting the feature list (the "Member plugins" table above).

### 2. Install a single plugin

- A single local agent must be named together with the core in one command: `dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-codex`.
- The room can be installed alone: `dsh plugin --profile web add @khorsheed/dsh-room`; without local agents it still works with native DSH members.
- Uninstall with `remove`, update with `update`.

</details>
