# @khorsheed/dsh-eval-suite

English | [中文](README.md)

Run controlled comparisons of several CLI agents (harnesses) on one set of tasks, on this machine — with the evaluation family and the delegation family in one install.

A dataset is registered as a read-only source, an experiment expands "which task × which condition × which repetition" into a matrix, the orchestrator delegates, collects, and judges cell by cell, the ledger records every step each cell took, and the results page lays the paired outcomes side by side. This mode bundle installs the four evaluation members — datasets, ledger, container units, and orchestrator — plus the local-agent delegation family (the core and the kimi / codex / claude-code / dsh harness providers) at once, and also carries the `dsh-eval` (评测模式) agent preset row: a session switched to evaluation mode automatically gets the domain-trimmed `datasets_*` / `eval_*` tools and the dataset-organizing capability. A single 「评测套件」 card is added to the inventory instead of making you pick packages one by one.

## Features

- **Two families in one install** — datasets (dataset registry and read-only materialization, the 题集 tab), mission (the run and attempt ledger, the release gate), lab (Docker container units), and eval (the orchestrator, the 实验室 tab), plus the local-agent delegation family (the core and the kimi / codex / claude-code / dsh providers) and the evaluation-mode preset row, all from a single `dsh plugin add`.
- **Model tools granted per session** — the `datasets_*`, `mission_*`, and `eval_*` tools are not mounted at the profile root: each is its member package's own `./tool` composition entry (`@khorsheed/dsh-datasets/tool` and so on), granted by the agent presets that name it; the `preset-dsh-eval` row this bundle carries is the evaluation mode's grant point (`datasets-tool` / `eval-tool`), and a preset that does not name it gets none.
- **One card in the inventory** — locale card metadata folds the family into a single 「评测套件」 card.
- **Pure composition, zero runtime** — the package registers no service, tool, slot, or command of its own; the patch reuses the members' canonical rows verbatim and never double-mounts (mechanism in How it works below).

## Members

| Member package | Row id | Contents |
| --- | --- | --- |
| `@khorsheed/dsh-datasets` | `datasets` | Dataset registry, read-only materialization, the 题集 tab; the `datasets_*` tools are the package's `./tool` composition entry, granted by the presets that name it |
| `@khorsheed/dsh-mission` | `mission` | The run / mission / attempt ledger and release gate, the 任务 tab; the `mission_*` tools are the package's `./tool` composition entry, granted by the presets that name it |
| `@khorsheed/dsh-lab` | `lab` | Container unit acquire, fingerprint, verify, and destroy (Docker) |
| `@khorsheed/dsh-eval` | `eval` | The orchestrator: experiments, condition library, runs, judging, reports, the 实验室 tab; the `eval_*` tools and `/eval` are the package's `./tool` composition entry, granted by the presets that name it |
| `@khorsheed/dsh-local-agent` | `local-agent` | The delegation family core: the scoped-homes root, run facades and the shared harness face — eval's run / provision verbs delegate to the external CLIs through it |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi` | The Kimi harness provider |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex` | The Codex harness provider |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code` | The Claude Code harness provider |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` | The dsh harness controller (Settings → 本地 Agent switch, default off) |

(Before the family fold there were three companion packages, `@khorsheed/dsh-datasets-tool` / `-mission-tool` / `-eval-tool`; they are retired — each folded into its core package's `./tool` composition entry, with the preset row ids unchanged. The deps-only `@khorsheed/dsh-local-agent-dsh-headless` library also arrives as a dependency but contributes no card and no row — the same treatment as in dsh-dev.)

Evaluation sessions are NOT granted the local-agent family's `subagent_*` delegation tools: eval consumes localAgent at the service level (the orchestrator delegates the runs), and the preset row names no `./tool` row of the family.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-eval-suite
```

Takes effect after the web instance restarts. Once mounted, the evaluation family's four rows, the delegation family's five rows and the evaluation-mode preset are all in place; switch a session to 「评测模式」 in the mode selector to get the domain-trimmed evaluation tools. To give the model the evaluation tools in a different preset, name the matching `./tool` row in that agent preset, for example:

```yaml
- id: eval-tool
  name: '@khorsheed/dsh-eval/tool'
```

<!-- collection:start -->
Recommended: install it together with the basic suite (the Eval collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-eval-suite
```

Uninstalling removes the whole family; to keep the family but turn one row off, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ❌ unsupported — the four evaluation members floor at host `0.2.0-rc.2` together (the five local-agent members floor at `0.1.5-rc.1`, below it).
- Source line (deepseek-harness 0.2 line): ✅ full (minHost: 0.2.0-rc.2, verifiedHost: 0.2.1-rc.1) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree; no other surface changes.

**Version line**: from `0.1.0`, requires host `0.2.0-rc.2` or later.

## Known limitations

- **lab needs Docker** — the container path needs a reachable Docker daemon on the machine; without one, lab's verbs fail at call time and eval's container path refuses naming lab, while the host path, datasets, and the ledger are unaffected. The bundle neither installs Docker nor builds the evaluation image.
- **Bring the evaluated CLIs yourself** — installing and logging in each CLI (`kimi login` / `codex login` / `claude auth` …) is outside this package; the delegation family itself (the localAgent service and the four harness providers) arrives with this bundle, and eval's run / provision verbs delegate through the localAgent facade, refusing by name when it is absent.
- **Uninstall is family-wide** — removing this package removes every member with it; to disable a single row, use the row-level switches on the bundle detail page.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A pure composition meta package (a mode bundle).** The member rows in `cordis.patch.yml` come from the matching member package's own `cordis.patch.yml`, id and name verbatim; the closing `preset-dsh-eval` row (an `@deepseek-ai/dsh-agent-preset` declaration) is this package's own canonical copy (it once mirrored the retired `@khorsheed/dsh-presets`). The repo-level check:plugins `dsh.bundle.kind: 'mode'` sanction pins this mechanically: rows may only fall inside the allowlist of "the union of the members' canonical rows minus the companion composition rows (the `./tool` subpath entries), plus exactly one preset-<mode> row", every subtracted companion row must be granted by this bundle's preset composition, members must be real self-mounting packages, every member must contribute at least one row, the mode value is unique across the tree, and a row id shared by several bundle patches (the local-agent rows this bundle shares with dsh-dev and bundle-local-agent) must carry identical content.

**Install me = install the family, no double mount.** Every member is listed in `dependencies` (installing brings them all) and registered in `dsh.references` (the family roster that pack-time and catalog checks read). The mechanism: `dsh plugin add` reconciles only the profile's **direct** dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies **this** patch only; the members arrive as transitive dependencies and their own patches are not applied, so no row mounts twice. A member added on its own with `dsh plugin add` still self-mounts (the repo rule holds); when both are installed, the overlapping rows are resolved by the official bundle detail page's row-level switches.

**No tool rows in the patch.** The three `./tool` composition entries are preset grant points: a profile-root row grants every session, which is exactly what the tool-row split removed.

**`src/index.ts` only exports constants** (`MODE` / `FAMILY_MEMBERS`), so the package has a buildable `lib/` (a hard requirement of pack-dist).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/bundle-eval`). Please file issues and contributions there.
