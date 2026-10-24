# @khorsheed/dsh-datasets

English | [中文](README.md)

Turn scattered questions into versioned datasets with per-layer visibility, so that during an evaluation the agent only gets the layers you allowed it to see.

Two things ruin an evaluation: the questions quietly change, so two rounds are not actually comparing the same set; or the answers and grading standards leak into what the players can see. This plugin keeps datasets in ordinary git repositories: a version is a commit, and an experiment pins one commit; every layer (task text, grading standards, check scripts…) declares who can see it, and the agent reads only through a registered reference `<id>/<set>` and cannot reach a layer it was not granted. Bringing in new data does not mean hand-writing a directory layout either — tell the Agent where the data is, it organizes it into a protocol repository and submits a registration request, and you confirm it on the dataset page after comparing it item by item.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-panel.png" width="640" alt="The global 「题集」 panel: datasets grouped by registered repository, with latest version, item count, agent-visible layers and the experiments using them">

## Features

- **Humans register, agents reference** — a dataset repository is registered once per deployment and tracks one branch; the agent knows only `<id>/<set>` references, and passing a path, an ambiguous name or an unregistered one gets a refusal it can act on.
- **Per-layer visibility** — every layer declares whether it is model-facing, and registration ticks the layers the agent may read for each set; the allow-list binds both the model tools and the read-only materialized views.
- **Versions pinned to commits** — single files are read straight from git objects, whole layers are materialized through `git archive` into content-addressed read-only directories, never touching a shared checkout's index, HEAD or worktree list.
- **The Agent organizes, you confirm** — 「添加题集」 (Add dataset) opens a new organizing session in which the Agent turns raw data into a protocol repository and submits a registration request; the plugin checks every file's destination and the validation result, and nothing takes effect until you press 「确认登记」 (Confirm registration).
- **Updates are gated** — when the tracked branch moves, changes the players cannot see follow automatically; changes they can see are marked 「新版本待确认」 (new version awaiting confirmation), and until you confirm, the agent still reads the confirmed version.
- **See at a glance who sees what** — an item's detail page shows "what the player will see" and "only judges and probes see this" side by side, so an answer drifting into a visible layer shows up there first; a line at the bottom says whether the item can be judged at all.
- **Authoring hygiene and judgeability checks** — `validate` checks descriptor shape, whether rubrics are judgeable, whether objective criteria have a probe, and whether the canary marker is planted; warnings never block.
- **Session tab and global panel** — the same view is both the 题集 tab in an evaluation session and the global 「题集」 panel in the left sidebar, which needs no session.
- **Model tools granted by preset, in tiers** — the `datasets_*` tools are the package's `./tool` composition entry with tiers `read` / `authoring` / `all` / `organize` / `none`; there is also the `dsh-datasets` CLI and the `/datasets` command.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-item-detail.png" width="640" alt="An item's detail page: a file tree colored by visibility on the left, the 'player will see' and 'only judges and probes' columns side by side on the right, with the judgeability line">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-review.png" width="640" alt="The registration review page: original directory → dataset side by side, per-layer visibility toggles, and the Confirm registration / Return to Agent buttons">

## Install

The recommended install comes with the evaluation mode (datasets, container units, the evaluation orchestrator and the local-agent delegation family, plus the evaluation-mode preset):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```

You can also install this plugin alone — storage, registration and validation assume nothing about what the data is for:

```sh
dsh plugin --profile web add @khorsheed/dsh-datasets
```

Restart the web instance to apply. New repositories default to `$DSH_HOME/datasets/<name>`; the registry lives at `$DSH_HOME/state/datasets/registry.json`. To give the model the dataset tools in a preset other than the evaluation mode, name the tool row in that agent preset:

```yaml
- id: datasets-tool
  name: '@khorsheed/dsh-datasets/tool'
  config: { tools: authoring }
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-datasets
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.2.0-rc.2`): ✅ — every capability works; the contract surface (`ctx.tools`, `ctx.commands`, log-only session events, the Typert Remote channel, `conversation.view`) is stable on this line. Since T82 only host 0.2.0 and later are supported (minHost 0.2.0-rc.2) — 0.1.x hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.2.1-rc.1; the 题集 tab live-smoked on a web-eval temp instance) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree, no other surface change.

Degraded items and how each host door is probed are detailed in the [reference](docs/reference.en.md#compatibility-details). This section mirrors the `dsh.compat` field in package.json; the two move together.

## Known limitations

- **Files written into the working tree are invisible until committed** — the tree, listing and validation all read git objects at HEAD, which is why a registration request requires the Agent to commit first.
- **The materialization cache is never collected** — each move of the tracked branch may add a read-only directory; to reclaim space delete the whole `materialized/` subtree (`chmod -R u+w` first).
- **The judgeability check knows only the `grading` / `verify` layer names** — a repository that keeps rubrics under other layer names is not checked.
- **Descriptors are JSON** — `dataset.json` / `item.json`, not YAML; `itemMetaSchema` is declared but not fully validated as JSON Schema.
- **Previews read whole files** — the session tab's preview has no byte cap; very large layer files are better consumed through the materialized view.
- **`/datasets` needs an interactive UI** — unavailable on headless profiles; the CLI is unaffected.

The full list is in the [reference](docs/reference.en.md#known-limitations-and-deferred-work).

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Storage.** A dataset is an ordinary git repository: `datasets/<id>/dataset.json` declares the layer list (visibility classes) and the item-metadata schema, and layer directories can sit at the set level or under `items/<item-id>/`. The plugin validates only the descriptor's shape and passes every other field through; it never interprets what a dataset means and never copies content out of the repository.

**Governance.** The registry is one JSON file under the state root, keyed by the realpath of the repository's git common dir; "latest" follows the tracked branch and never looks at HEAD. The layer allow-list is enforced on listing, reading and materialization; the web tab and the CLI are the human's view and are not bound by it, with sensitive layers marked 「· 敏感」. The allow-list prevents accidental reads and cross-process contamination; it is not a security boundary.

**Organizing and registration.** `datasets_propose_registration` writes only a request; the plugin checks the mapping against the repository's git objects and the original directory and runs the protocol validation — any problem blocks confirmation. The bundled `dataset-authoring` skill is registered by the tool row's `organize` tier.

**Interfaces.** The `ctx.datasets` service is optionally consumable by other plugins; the `datasetsRemote` Typert Remote is the data face of the tab and the panel; the `dsh-datasets` CLI mirrors the read verbs and adds the registration verbs.

Deep reference:

- [Reference](docs/reference.en.md) — repository layout and the `validate` rule table, the registry, per-instance mounting, model tools and tiers, CLI and slash commands, the 题集 tab and panel, compatibility details, the full list of known limitations
- [Dataset authoring protocol](../../docs/dataset-authoring-protocol.en.md)

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/datasets`). Please file issues and contributions there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
