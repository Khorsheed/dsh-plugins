# @khorsheed/dsh-eval-suite

English | [中文](README.md)

Put several CLI agents (Kimi, Codex, Claude Code, dsh) through the same set of tasks on your machine for a side-by-side evaluation: the same tasks, the same conditions, the results laid out next to each other.

Finding out whether a kind of task goes better with Codex or with Claude Code used to mean opening terminals one by one, feeding tasks by hand and comparing from memory; try another model or configuration and the earlier conditions no longer matched. Install the eval suite and switch a session to 「评测模式」 (eval mode): datasets are registered as read-only, version-pinned data sources; an experiment is a matrix of "which task × which comparison group × which repetition", the orchestrator delegates each cell to a local CLI, collects the answers and grades them, the ledger records every step each cell went through, and the results page lays the paired results side by side. The agent helps you read datasets, draft experiments and comparison groups, turn data you have on hand into a dataset, and read results to write a first-draft analysis; starting a run, registering a dataset and the final grading always remain your actions. This suite is for people who want to compare coding agents side by side on their own machine.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-bundle-eval-hero.png" width="640" alt="an eval-mode session: the 「实验室」 (experiments) page on the right showing an experiment's results comparison — one row per task, two comparison groups' scores and the difference side by side">

## Things you can say to the agent

- "List the registered datasets — how many tasks and layers does each have?"
- "Draft an experiment: compare Codex and Claude Code on this dataset, same model, one run each."
- "Turn the tasks in this directory into a dataset, validate it, then submit a registration request."
- "Read the results of the last run and write a first-draft analysis."

## Features

- **Datasets read-only and version-pinned** — once registered, a dataset is pinned by version and read only; the agent can only reference it through its registration, and nothing outside the layers allowed at registration is readable.
- **An experiment is a matrix** — tasks × comparison groups × repetitions; the 「实验室」 page on the right walks through four stages — experiment design, run records, results comparison, human evaluation — each topped by a status line and the one action to take next.
- **The agent drafts, you start** — the agent can draft experiments and comparison groups and write the analysis draft, but cannot start a run; you launch `/eval run`, which runs in the background and keeps going if you close the session or the tab.
- **Each cell delegated to a local CLI** — every cell is delegated through the local agent family to the matching CLI, running in a host directory or a Docker container.
- **Every step on the ledger** — the mission ledger records each cell's runs, attempts and state changes; results can be exported and re-checked.
- **Three grading paths** — probe scripts grade automatically, a blind judge drafts a grade, and the human final grade decides; in human evaluation the answers to the same task are laid out side by side without revealing which CLI produced which.
- **Results compared side by side** — the paired-difference table has one row per task: both sides' scores, the difference, and who graded it; when the sample is too small, the report says outright that it will not rank.
- **Data into datasets** — the agent can turn data on hand into a dataset, validate it and submit a registration request, which a human approves.
- **Only in eval-mode sessions** — the dataset and eval model tools are granted per session; no other session sees any of them.

## Members

| Member | What it does |
| --- | --- |
| Datasets (`@khorsheed/dsh-datasets`) | dataset registration and version-pinned read-only access, the 「题集」 (datasets) page |
| Lab (`@khorsheed/dsh-lab`) | acquiring, fingerprinting, verifying and destroying Docker container units |
| Eval (`@khorsheed/dsh-eval`) | the orchestrator: experiments, comparison groups, runs, grading, reports, the 「实验室」 page; also contains the mission ledger (folded in from dsh-mission on 2026-10-24) |
| Local agent core (`@khorsheed/dsh-local-agent`) | the delegation family core: eval's runs are delegated to each CLI through it |
| Kimi (`@khorsheed/dsh-local-agent-kimi`) | the Kimi CLI provider |
| Codex (`@khorsheed/dsh-local-agent-codex`) | the Codex CLI provider |
| Claude Code (`@khorsheed/dsh-local-agent-claude-code`) | the Claude Code provider |
| dsh delegation (`@khorsheed/dsh-local-agent-dsh`) | the dsh provider (Settings → Local Agent switch, off by default) |

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-eval-suite
```

Takes effect after the web instance restarts. Then switch a session to 「评测模式」 in the mode selector to get the domain-scoped evaluation tools.

<!-- collection:start -->
Recommended: install it together with the basic suite (the Eval collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-eval-suite
```

Removing the bundle removes the whole family; to keep the family and turn off a single member, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ❌ unsupported — the evaluation family members share a host floor of `0.2.0-rc.2` (the five local-agent family members floor at `0.1.5-rc.1`, below it).
- source line (deepseek-harness 0.2 line): ✅ full (minHost: 0.2.0-rc.2, verifiedHost: 0.2.1-rc.1) — the host-021 wave ran a full build+test green against the 0.2.1-rc.1 tree, with no other surface change.

**Version-line map**: `0.1.0` and later require host `0.2.0-rc.2` and up.

## Known Limitations

- **lab needs Docker** — the container path needs a reachable Docker daemon on this machine; without one, lab's verbs fail at call time and eval's container path refuses to start, naming lab, while the host path, datasets and the ledger are unaffected. This package neither installs Docker nor builds evaluation images.
- **Bring the CLIs under test yourself** — installing and logging in to each CLI (`kimi login` / `codex login` / `claude auth` …) is out of scope; the delegation family itself (the localAgent service and the four harness providers) comes with this package, eval's run / provision verbs delegate through the localAgent facade, and they refuse by name when the service is absent.
- **Uninstall is family-wide** — removing this package removes every member together; to disable a single member, use the row-level switches on the bundle detail page.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A pure-composition meta-package (a mode pack).** The package registers no service, tool, slot, or command. The member rows in `cordis.patch.yml` all come from each member package's own `cordis.patch.yml`, id and name verbatim; the final row, `preset-dsh-eval` (an `@deepseek-ai/dsh-agent-preset` declaration, mode id `dsh-eval`), is this package's own canonical copy — it once mirrored `@khorsheed/dsh-presets`, which retired on 2026-10-24. The repo-level check:plugins `dsh.bundle.kind: 'mode'` sanction pins this mechanically: rows may only come from the allowlist "the members' canonical rows − the companion composition rows (`./tool` and other subpath entry rows) + exactly one preset-<mode> row", every subtracted companion row must be granted by name in this package's preset composition (so no grant is lost), every member must be a real self-mounting package, every member must contribute at least one row, and the mode value is unique across the tree; when the same row id appears in several bundle patches (the local-agent rows this package shares with dsh-dev / bundle-local-agent), their content must match.

| Member package | Row id |
| --- | --- |
| `@khorsheed/dsh-datasets` | `datasets`; `datasets-tool` (granted by this package's preset) |
| `@khorsheed/dsh-lab` | `lab` |
| `@khorsheed/dsh-eval` | `eval` (mounts the mission ledger too); `eval-tool` (granted by this package's preset) |
| `@khorsheed/dsh-local-agent` | `local-agent` |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi` |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex` (+ override `tool-subagent-codex`) |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code` (+ override `tool-subagent-claude-code`) |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` |

Once mounted, the evaluation family's three rows, the delegation family's five rows and the eval-mode preset are all in place. Before the family fold there were three companion packages, `@khorsheed/dsh-datasets-tool` / `-mission-tool` / `-eval-tool`; they are retired — each folded into its core package's `./tool` composition entry, with the preset row ids unchanged; the mission ledger folded from `@khorsheed/dsh-mission` into eval on 2026-10-24. The deps-only `@khorsheed/dsh-local-agent-dsh-headless` library also arrives as a dependency but contributes no card and no row — the same treatment as in dsh-dev.

**Model tools granted per session.** The `datasets_*` and `eval_*` tools are not mounted at the profile root: each is its member package's own `./tool` composition entry (`@khorsheed/dsh-datasets/tool`, `@khorsheed/dsh-eval/tool`), granted by the agent presets that name it; the `preset-dsh-eval` row this bundle carries is the eval mode's grant point (`datasets-tool` / `eval-tool`), and a preset that does not name them gets none — mounting a row at the profile root would grant every session, which is exactly what the tool-row split removes. To give the model evaluation tools in another preset, name the matching `./tool` row in that agent preset, for example:

```yaml
- id: eval-tool
  name: '@khorsheed/dsh-eval/tool'
```

Eval sessions are **not** granted the local-agent family's `subagent_*` delegation tools: eval consumes localAgent at the service level (the orchestrator delegates runs), and the preset row names no local-agent `./tool` row.

**Installing me = installing the family, never a double mount.** Every member is listed in `dependencies` (installing brings them all) and registered in `dsh.references` (the family roster read at pack time and by the catalog layer). Mechanism: `dsh plugin add` reconciles only the profile's **direct** dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies **this** patch only; the members arrive as transitive dependencies and their own patches are not applied, so no row is ever mounted twice. A member installed on its own with `dsh plugin add` still self-mounts (the repo rule holds); when both are installed, the official bundle detail page's row-level switches resolve the overlap.

**`src/index.ts` exports constants only** (`MODE` / `FAMILY_MEMBERS`), so the package has a buildable `lib/` (a hard requirement of pack-dist).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/bundle-eval`). Issues and contributions go there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
