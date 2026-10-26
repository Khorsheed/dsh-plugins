# @khorsheed/dsh-eval-suite

English | [中文](README.md)

> **Still being polished — not released yet.** This suite can't be installed from Plugins → Add plugin for now, and what follows may change.

**Everything for comparing coding agents on your own computer: the same questions, the same conditions, the results side by side.** Point at a folder and the agent turns the questions into a dataset; you go through it, and only your OK registers it — the version is pinned and the answers never leak to the agent being tested; say what you want to compare and it drafts the experiment, but "Approve and start" is yours alone to press; Kimi, Codex, Claude Code and DSH each work the questions on your machine, and for a cleaner comparison every cell gets its own Docker container, with a fingerprint that tells you whether the environments matched; check scripts grade first, a blind judge writes a first draft, and you read the answers side by side — without knowing who wrote which — before the final verdict; how many tries each cell took, where it got stuck and what it produced is all on record and can be exported for review; when there aren't enough samples, the report says plainly that it won't rank…… Everything you need to find out "who's better at this kind of job", with "评测模式" (eval mode) built in, installed in one go.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-bundle-eval-hero.png" width="800" alt="An eval-mode session: the Experiments page on the right comparing an experiment's results, one row per question with both groups' scores and the difference side by side">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-eval-suite
```

That installs all 8 members below; restart DSH and they're ready. It's best installed together with `@khorsheed/dsh-basic` (Basic Essentials), which carries everyday things like editing messages and previewing files.

Then start a new session, pick "评测模式" (eval mode), and tell the agent what you want to compare; or start straight from Datasets or Experiments in the left sidebar. The eval tools in a session only show up in eval mode, so not seeing them in other modes is expected.

Before you start: the tools being compared (Kimi, Codex, Claude Code) have to be installed by you; this suite doesn't do it. Running in containers needs a working Docker on your computer, and you prepare the eval images yourself — without Docker you can still run directly on the machine.

## Things you can say to the agent

- "List the registered datasets. How many questions does each have?"
- "Turn the questions in this folder into a dataset, check it, then submit it for registration."
- "Draft an experiment comparing Codex and Claude Code on this dataset, same model, one run each."
- "Run this one in containers, a clean environment per cell."
- "Which cell did the last experiment get stuck on, and why?"
- "Read the last results and write a first draft of the analysis."

## Plugin list

| Plugin | Package name (copy to install) | What you get |
|---|---|---|
| datasets | `@khorsheed/dsh-datasets` | Datasets: questions from anywhere turned into a dataset, registered only once you confirm; version pinned, answers never leak to the player |
| eval | `@khorsheed/dsh-eval` | Experiments: draft, run, grade and compare side by side, with every step on record |
| lab | `@khorsheed/dsh-lab` | A clean Docker container per cell, and a fingerprint that tells you whether the environments matched |
| local-agent | `@khorsheed/dsh-local-agent` | The base for local-agent delegation: a "Local Agent Delegation" card in settings for each tool's sign-in and model; the four below need it |
| local-agent-kimi | `@khorsheed/dsh-local-agent-kimi` | Put Kimi Code on your machine into the comparison |
| local-agent-codex | `@khorsheed/dsh-local-agent-codex` | Put Codex on your machine into the comparison |
| local-agent-claude-code | `@khorsheed/dsh-local-agent-claude-code` | Put Claude Code on your machine into the comparison |
| local-agent-dsh | `@khorsheed/dsh-local-agent-dsh` | Put a separate DSH running on its own into the comparison; ready once installed |

## Feature tour

### datasets: Datasets

Two things ruin an evaluation: the questions quietly change, so two rounds weren't really answering the same set; or the answers and grading rules end up where the player can see them. In Datasets in the left sidebar, press "Add a dataset" and choose "Let the Agent organize it": a new session opens where the agent shapes the raw data into a dataset, runs the checks, and hands it to you. The review page shows the original folder and the dataset side by side, with a visibility switch for each part; press "Confirm registration" if it looks right, or "Send back to the Agent" if not. Each question's page lists "What the player will see" next to "Only judges and probes see", so an answer in the wrong place shows up right away. When the source moves on, changes the player can see are marked "new version to confirm", and experiments keep the old version until you confirm.

<details open>
<summary>Screenshots (3)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-panel.png" width="640" alt="The Datasets panel in the left sidebar: datasets grouped by source, with the latest version, question count, what the agent can see and which experiments use them">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-review.png" width="640" alt="The review page waiting for your confirmation: original folder and dataset side by side, visibility switches per part, and the Confirm registration and Send back to the Agent buttons">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-item-detail.png" width="640" alt="A question's page: a file tree colored by visibility on the left, What the player will see and Only judges and probes see side by side on the right, and a line at the bottom saying whether it can be graded">

</details>

### eval: Eval

Finding out whether a kind of job goes better with Codex or Claude Code used to mean opening terminals one by one, feeding questions by hand and comparing from memory — and with another model, the earlier conditions no longer matched. Now press "New experiment" under Experiments, or just ask the agent; it drafts the dataset, the groups and how many times each cell runs, and you edit and approve. "Approve and start" is yours alone to press; the run goes on in the background, even if you close the tab, and before the first real cell each group runs one tiny task so an expired login, the wrong model or a blocked network is caught early. Grading has three rounds: the dataset's own check scripts go first, a blind judge writes a first draft, and on the "Human review" page you read the answers side by side and give the final verdict. The "Results" page runs its "Validity checks" first; if conditions didn't match or there were too few runs, you get the facts and no ranking. How many tries each cell took, where it got stuck and what it produced are all on record; you can retry, and export the whole run for someone else to check.

<details open>
<summary>Screenshots (3)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-lab-list.png" width="640" alt="The experiments list, grouped into needs you / running / done; each card shows the dataset version, comparison groups, progress and one main button">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-results.png" width="640" alt="The Results page: a verdict card and Validity checks 5/5 at the top, then each group's scores per criterion and the paired differences">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-human-review.png" width="640" alt="The Human review page: several answers to the same question side by side with their sources hidden, each column with the criteria table, judges A / B's first verdicts and score inputs">

</details>

### lab: Lab

A comparison is meant to compare agents, not environments. If one cell had an extra folder mounted, a different network or a different memory limit, the results stop being comparable, and that kind of difference is hard to spot afterwards. Set the experiment to run in containers and every cell gets a clean one: the question goes in, the agent works inside, its output is collected, and the container is removed once the record is checked. The image, resource limits, mounts and network all go into an environment fingerprint shown per cell under "Run records"; matching fingerprints mean the environment really was the same. When a cell crashes, its state is archived first, then that cell alone gets another try; when DSH restarts, containers still running are picked up again; containers not yet removed are listed under "Unreclaimed units" on the Results page, and "Reclaim" clears them.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/lab-record-env.png" width="640" alt="A run record's details: the environment fingerprint and container unit in the parameter table, matching the other cells of the same run">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/lab-run-units.png" width="640" alt="The Unreclaimed units section of the Results page: the containers this run still holds, the state of each one's cell, and a Reclaim button">

</details>

### Local agent delegation: Kimi, Codex, Claude Code and DSH

These are what you're comparing. Each is the tool you installed yourself, running in its own separate directory, so your existing setup and sign-ins are never touched; one tool can even be signed in with several accounts and compared against itself in the same experiment. The work streams into a sub-session as it happens, and results come back with real usage, timing and the model actually used, which eval uses to check that conditions matched. The "Local Agent Delegation" card in settings shows at a glance whether each one is signed in, and it's where you switch the default model; a separate DSH running on its own can compete as soon as it is installed — nothing to switch on.

<details open>
<summary>Screenshots (4)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/08-local-agent.png" width="640" alt="The Local Agent Delegation card in settings: one row per tool, with a status dot showing whether it is signed in">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-kimi-settings.png" width="640" alt="The Kimi section: sign-in status, default model and the always-on switch">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-codex-card.png" width="640" alt="The Codex section: sign-in status, default model and the always-on switch">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-claude-code-card.png" width="640" alt="The Claude Code section: sign-in, default model picker and the always-on switch">

</details>

## Make it yours

- **Remove a member**: disable/uninstall in Settings → Plugins, or `dsh plugin --profile <your profile> remove <package name>` — the rest keep working. Not comparing one of the tools? Turn off just that one; no containers? Turn off `lab` and run directly on the machine. `local-agent` is the base all four share, so turning it off stops them all. The suite is a starting point, not a lock-in.
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
| [Video Suite](https://github.com/Khorsheed/dsh-video) | `@khorsheed/dsh-video-suite` | A cutting room with speaker splitting and delete-the-word-deletes-the-audio, plus local-agent delegation — with "剪辑模式" (editing mode) |
| [Gamedev Suite](https://github.com/Khorsheed/dsh-gamedev) | `@khorsheed/dsh-gamedev-suite` | Build small games with the agent, plus local-agent delegation — with "游戏开发模式" (game dev mode) |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | The plugin monorepo: the capability map of every package and the development docs |

## Compatibility

Needs DSH 0.2.0 or later; verified on 0.2.1.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Developing

Plugins live in [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) (single source of truth); each member's details are in its own README under [packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages). This package has no features of its own; it installs eval mode and the members above together. Issues welcome.

## Install guide for agents

<details>
<summary><strong>Expand: whole-suite install + single-package CLI install</strong> (follow this when the user says "install this for me")</summary>

### 1. Installing the whole suite (recommended)

<!-- collection:start -->
Recommended: install it together with the basic suite (the Eval collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```
<!-- collection:end -->

Or Settings → Plugins → Add plugin, enter `@khorsheed/dsh-eval-suite`. Restart the web instance, then ask the user to **hard-refresh** (Cmd/Ctrl+Shift+R) — new interface code only loads on a hard refresh; a plain reload may keep serving the cached page. Then present the feature list (the plugin table above) and remind the user to start a new session in "评测模式" (eval mode).

Uninstalling the suite (`dsh plugin --profile web remove @khorsheed/dsh-eval-suite`) removes its members too; to turn off just one, switch it off on the suite's detail page.

### 2. Installing a single plugin

- **Dialog**: Settings → Plugins → Add plugin, enter the package name (e.g. `@khorsheed/dsh-datasets`), enable as prompted.
- **CLI**: `dsh plugin --profile <profile> add <package name>`; `remove` to uninstall, `update` to upgrade.
- When installing a single local agent (e.g. `@khorsheed/dsh-local-agent-codex`), install `@khorsheed/dsh-local-agent` alongside it.

</details>
