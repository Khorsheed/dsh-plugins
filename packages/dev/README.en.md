# @khorsheed/dsh-dev-suite

English | [中文](README.md)

Write code in dsh: hand work to your local Kimi / Codex / Claude Code in one sentence, split a job among several agents in one room, and see at a glance which branch the session is on.

Getting the Codex or Claude Code installed on your machine to take on a piece of work used to mean opening a terminal, copy-pasting, and carrying the result back; with several worktrees open, you had to run git in a terminal to learn which branch the current session was on and how much was uncommitted. Install the dev suite and switch a session to 「开发模式」 (dev mode), and the agent delegates straight to your local coding CLIs, with the process visible live in a sub-session; the session header shows the branch and changed-line counts, one click away from the diff and commit history; when the job gets big, bring several agents into the same session — the coordinator splits the work, members hand in evidence, and acceptance is still your call. This suite is for people who do development in dsh.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/dev-mode.png" width="640" alt="dev mode at a glance: inviting room members, the worktree badge and change drawer in the session header, sub-agent task pills">

## Things you can say to the agent

- "Hand this parser bug to Codex, and tell me which files it changed when it's done."
- "Create a worktree for the login-page refactor and work there — don't touch main."
- "Invite Claude Code and Kimi: Claude Code writes the implementation, Kimi adds tests, you coordinate and show me the evidence at the end."
- "List every worktree in this repo — which ones still have uncommitted changes?"
- "Get the build and tests green before you restart the instance."

## Features

- **Delegate to your local coding CLIs** — Kimi, Codex and Claude Code each get a delegation tool; a delegation runs in a sub-session with its thinking, tool calls and replies visible live, and can be aborted or continued; they run in plugin-isolated directories, so your own CLI installs' config and credentials stay untouched.
- **Delegate to another dsh, too** — turn on the switch in the Local Agent card in settings and the agent can hand subtasks to an isolated headless dsh (off by default).
- **One session, a whole team of agents** — invite the first member and the session becomes a room: @ a name to assign work, several names to dispatch in parallel; the coordinator breaks down the goal, members hand in evidence, and you decide acceptance.
- **Know your branch at a glance** — the branch badge in the session header carries merged diff line counts; open it for pending changes, commit history and repo files in the right sidebar; the agent can list, switch, create and remove worktrees — removal always needs confirmation, and a worktree with uncommitted changes is always refused.
- **Quick decisions** — the agent can hand judgements like "is it, which one, what score" to the TypeSafe model and get answers back with probabilities and confidence, not prose to parse again.
- **Self-modification without taking the service down** — when the agent wants to restart after changing code, ankh-guard first checks that this change's build and tests passed before letting the restart through, so broken code does not take the service down along with the conversation in progress.
- **See what each request carries** — context-lens shows, per turn, the composition of every model request: where each system section came from, how many tool definitions rode along, the token and time distribution.
- **Everything in the official standard mode is still there** — plan mode, compaction, subagents, workflows and web search work as usual; the model tools for delegation, worktrees, rooms and quick decisions are granted to dev-mode sessions only, and no other session sees any of them.

## Members

| Member | What it does |
| --- | --- |
| Local agent core (`@khorsheed/dsh-local-agent`) | the family core: an isolated directory per CLI, slash commands like `/<harness> login`, the auth card in settings |
| Kimi (`@khorsheed/dsh-local-agent-kimi`) | delegate tasks to your local Kimi Code CLI |
| Codex (`@khorsheed/dsh-local-agent-codex`) | delegate tasks to your local Codex CLI |
| Claude Code (`@khorsheed/dsh-local-agent-claude-code`) | delegate tasks to your local Claude Code |
| dsh delegation (`@khorsheed/dsh-local-agent-dsh`) | delegate tasks to an isolated headless dsh (turned on in settings, off by default) |
| Worktrees (`@khorsheed/dsh-worktrees`) | the session worktree's branch, pending changes and commit history, live |
| Room (`@khorsheed/dsh-room`) | turn a session into a shared workspace with a coordinator and members |
| Quick decisions (`@khorsheed/dsh-typesafe`) | typed model judgements: yes/no probabilities, choices, grades, all with confidence |
| ankh-guard (`@khorsheed/dsh-ankh-guard`) | let a self-modifying restart through only after the build and tests are proven green |
| Context lens (`@khorsheed/dsh-context-lens`) | the full composition of every model request per turn: system-section attribution, tool definitions, token and time distribution |

## Install

Paste the package name `@khorsheed/dsh-dev-suite` into the host's add-plugin dialog (or pick it from the marketplace index), confirm, and restart the instance — this one install brings every member along as dependencies, and this package mounts the mode and the members. Then switch a session to 「开发模式」 in the mode selector.

The CLI equivalent:

```sh
dsh plugin --profile web add @khorsheed/dsh-dev-suite
```

<!-- collection:start -->
Recommended: install it together with the basic suite (the Dev collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-dev-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-dev-suite
```

Removing the bundle removes the whole family, dev mode included; to keep the family and turn off a single member, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.7-rc.1`): ✅ full — pure composition; the members floor at `0.1.5-rc.1`, but the mode preset row (an `@deepseek-ai/dsh-agent-preset` declaration) only exists on host `0.1.7-rc.1` and later, so the floor is the higher of the two. Per-member behavior differences are documented in each member's own Compatibility section.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.2.1-rc.1).

**Version-line map**: `0.1.0` and later require host `0.1.7-rc.1` and up.

## Known Limitations

- **Install the CLIs yourself** — each CLI (`kimi` / `codex` / `claude`) must be installed on `PATH` by you, and each logs in through its own `/<harness> login`; this package neither installs nor logs in for you.
- **Quick decisions need a TypeSafe key** — without one, judgements come back as structured failures rather than errors; how to set the key: [`@khorsheed/dsh-typesafe`](https://github.com/Khorsheed/dsh-plugins/tree/main/packages/typesafe).
- **ankh-guard needs a watchdog first** — it only takes effect on a watchdog-supervised instance and requires the deployment directory to be a git repository; how to do the first takeover: [`@khorsheed/dsh-ankh-guard`](https://github.com/Khorsheed/dsh-plugins/tree/main/packages/ankh-guard).
- **Uninstall is family-wide** — removing this package removes every member together; there is no "drop one member from the bundle" operation. To disable a single member, use the row-level switches on the bundle detail page.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A mode pack = a family bundle + one mode preset row.** The package registers no service, tool, slot, or command. The member rows in `cordis.patch.yml` (including two bare overrides that disable the official same-named tool rows) come verbatim from each member package's own `cordis.patch.yml`; the final row, `preset-dsh-dev` (an `@deepseek-ai/dsh-agent-preset` declaration, mode id `dsh-dev`), is this package's own canonical copy — it once mirrored `@khorsheed/dsh-presets`, which retired on 2026-10-24. The repo-level check:plugins `dsh.bundle.kind: 'mode'` sanction pins the whole shape mechanically: rows may only come from "the members' canonical rows + exactly one preset-<mode> row", every member must be a real self-mounting package, every member contributes at least one row, and the mode value is unique across the tree.

| Member package | Row id |
| --- | --- |
| `@khorsheed/dsh-local-agent` | `local-agent` |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi` |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex` (+ override `tool-subagent-codex`) |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code` (+ override `tool-subagent-claude-code`) |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` |
| `@khorsheed/dsh-worktrees` | `worktrees` |
| `@khorsheed/dsh-room` | `room` |
| `@khorsheed/dsh-typesafe` | `typesafe` |
| `@khorsheed/dsh-ankh-guard` | `ankh-guard` |
| `@khorsheed/dsh-context-lens` | `context-lens` |

The two bare overrides disable the official preset's tool rows that share this family's tool names (`subagent_codex` / `subagent_claude_code`), carried verbatim from the codex / claude-code providers' own patches.

**Model tools granted per session.** Dev mode = everything in the official standard mode, plus the community tool rows the preset composition names: the three delegation tools `tool-subagent-kimi` / `tool-subagent-codex-local` / `tool-subagent-claude-code-local` (each provider package's `./tool` entry; tool names `subagent_kimi` / `subagent_codex` / `subagent_claude_code`), `worktrees-tool`, `room-tool`, and `typesafe-tool` (`typesafe_judge` plus the `typesafe-decide` skill). These rows stay off the profile root — mounting them there would grant every session. `subagent_dsh` is not granted by the preset; local-agent-dsh's settings switch controls it.

**A card-less library.** `@khorsheed/dsh-local-agent-dsh-headless` (the provisioned surface of the child dsh) goes into `dependencies` but contributes no patch row — the same treatment as in @khorsheed/dsh-bundle-local-agent: it never appears in the inventory and lives and dies with the family.

**Installing me = installing a family + one mode, never a double mount.** Every member is listed in `dependencies` (installing brings them all) and registered in `dsh.references` (the family roster read at pack time and by the catalog layer). `dsh plugin add` reconciles only the profile's **direct** dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies **this** patch only; the members' own patches are not applied, so no row is ever mounted twice. A member installed on its own still self-mounts; the bundle detail page's row-level switches resolve any overlap.

**`src/index.ts` exports constants only** (`MODE` / `FAMILY_MEMBERS` / `FAMILY_DEPS_ONLY`), so the package has a buildable `lib/` (a hard requirement of pack-dist).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/dev`). Issues and contributions go there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
