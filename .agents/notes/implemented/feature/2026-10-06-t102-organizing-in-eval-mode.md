# Agent Note: Dataset organizing folds into the evaluation mode

Status: implemented

## Problem

T90 shipped dataset organizing as its own agent preset, 「题集整理」 (`dataset-authoring`), in both deployment shapes: the web-eval pack and the published dsh-presets bundle 3080 runs. Its reason ([T90 decision B](2026-10-01-t90-dataset-journey.md)) was isolation: the organizing agent reads answers, so an evaluation session must never inherit that context. In use the split cost more than it protected. Contestant visibility is enforced by the dataset's layers and by the orchestrator, not by what the planning agent has read. Meanwhile a person had two modes that both "work on evaluation data", picked the wrong one, and had to switch sessions to go from "organize this folder" to "plan a run on it". The organizing preset also carried the shell that frozen decision 12 kept out of the evaluation preset, which was the only reason the two could not be one.

## Decision

There is one evaluation mode. It plans and analyzes evaluations and organizes data into datasets.

### The merged composition

- **web-eval `preset-eval`** and **dsh-presets `preset-dsh-eval`** gain the rows `preset-dataset-authoring` had: `tool-bash` (disabled on Windows), `tool-pwsh` (enabled only on Windows), and `tool-web` with `fetch: true`. They still have no workflow engine, no ptc, no ralph and no plan-mode rows.
- **The datasets tool row moves to the `organize` tier.** The tier is redefined as `authoring` plus `datasets_propose_registration`. It registers the `dataset-authoring` skill and contributes one merged prompt section, `datasets:organize`, that covers both reading registered datasets and writing new ones. `all` is unchanged and still has no proposal verb. Before T102 `organize` meant "authoring plus the skill"; the proposal verb was a separate grant on the dataset-authoring preset only. Folding it into one tier makes "can organize" a single, checkable fact.
- **Both skills are available.** The `eval-tool` row (`all`) carries `eval-planning`; the datasets row's `organize` tier carries `dataset-authoring`.
- **One persona.** It opens with what the agent is ("You plan and analyze evaluations, and you organize data into datasets"). It keeps the single line that matters for the docker boundary — "Execution belongs to the deterministic orchestrator … Never start a run or control a container yourself, through the shell or otherwise — ask the person to run what needs running" — and the T82 line that registered datasets are exactly what `datasets_list` returns. The organizing paragraph tells the agent to load the dataset-authoring skill first, dry-run the proposal until it passes, then file it and stop. The persona has no other prohibitions; guards are decided after observation (below).
- **The registry stays human-written** (T90 decision A). The agent files proposals; a person confirms them on the 题集 tab.
- `scripts/eval-preset-parity.spec.ts` still pins the two copies equal. It now checks one pair, and a new test asserts neither side declares `dataset-authoring`. `scripts/web-eval-preset-bundle.spec.ts` re-pins the bundle sha.

### 「题集整理」 is removed

Both `preset-dataset-authoring` rows are deleted. `PRESET_IDS` in dsh-presets is `dev`, `dsh-eval`, `dsh-writing`. The mode no longer appears in the mode list.

**Existing dataset-authoring sessions are not migrated and have no fallback.** On resume the host's session controller resolves the stored preset id (`presets.resolve(id)` in `composeAgent`). For an id no row declares, this throws `agent-preset/not-found` ("Unknown agent preset: dataset-authoring"), so the session does not compose. Its transcript stays on disk and readable. No compatibility row was added: a hidden row would still be a second mode with its own persona, which is what T102 removes, and the official host has no "alias this id to that one" seam. Few such sessions exist (T90 shipped 2026-10-01). The remedy is to start a new evaluation session and point it at the same folder.

### 「添加题集 › 让 Agent 整理」 picks the preset by grant

The evaluation mode's id differs per deployment (`eval` on web-eval, `dsh-eval` on 3080), so a hardcoded default would be wrong on one of them. `authoringPreset` now defaults to `''`, and `organizingSetup()` on the datasets Remote resolves it on the host:

1. An explicitly configured `authoringPreset` is returned as is.
2. Otherwise `resolveOrganizingPreset` (`packages/datasets/src/organizing-preset.ts`) reads the host's `agentPresets` registry. It keeps the deployment default when that preset grants the organize tier. Otherwise it picks the first listed, unbroken preset that does.
3. If nothing grants the tier or the registry is unreadable, it returns `''`. The client then keeps the session's default preset, and the request text still names the skill.

"Grants" means: some enabled row named `@khorsheed/dsh-datasets/tool` in the preset's composition has `tools: organize`. It recurses into `cordis:group` rows, and a `!!js` `disabled` expression counts as enabled. The check runs on the host because the official `pluginInventory` lists rows by module name only, with no config. A tier is config, and every preset that mounts the datasets tool names the same module. The registry's `readDocument` returns the composition as the Loader's YAML, which this package already parses.

### Frozen decision 12, rewritten

Old wording: the evaluation preset carries no shell, so the docker socket is the orchestrator's alone.

New wording: the evaluation mode carries a shell. The docker socket still belongs only to the orchestrator, but the preset no longer guarantees that. Guards are decided after observation. The iterations.md table rows, both web-eval READMEs, T90 decision B and the dsh-presets comments carry the new wording.

### Observation points

The coordinator watches two things by reading evaluation session logs. No code is added for either.

- **Docker commands** run through the shell in an evaluation session: `docker`, `docker compose`, or anything touching the docker socket.
- **Writes under `state/eval` or `state/mission`** made by the agent rather than by the orchestrator.

Either one appearing is the trigger to design a guard (a shell deny-list, a persona line, or a sandbox profile). The choice of guard follows from what was observed.

## Alternatives considered

**Keep two modes and fix only the hardcoded id.** This keeps the isolation argument from T90 decision B. It loses because that argument does not hold: what a contestant sees is enforced by the dataset's layers and by the orchestrator, not by the planning agent's context. Keeping two modes also keeps the "which mode do I need" confusion that motivated T102.

**A new tier for the merged grant, leaving `organize` as it was.** `organize` had one consumer, the deleted preset. A new name would leave a dead tier behind and make every doc distinguish two almost-identical grants. Redefining `organize` keeps the tier list at five entries.

**Pick the organizing preset in the browser, like the eval door's T97 rule.** The browser only has `pluginInventory`, which carries row names and no config. That is enough for "does this preset mount the eval row" but not for "at which tier". Asking the host's preset registry is the one place that has the config.

**Pick by id convention** (try `eval`, then `dsh-eval`). This is simpler, but it breaks on any third deployment and on a renamed preset. It would also hardcode, by list, the thing the task says not to hardcode.

**A hidden compatibility row for `dataset-authoring`.** This would let old sessions resume. It loses because it keeps a second persona and composition alive, has to be excluded from the mode list by a mechanism the host does not offer, and protects at most a few days of sessions.

**Guards now** (a shell deny-list for `docker` or a persona prohibition list). No evidence yet says what an evaluation agent with a shell actually does. A guard designed blind is either too loose to matter or tight enough to break organizing, which legitimately uses the shell. The observation points come first.

## Consequences

- One mode for all evaluation work, in both deployments. The dataset journey ("organize, propose, a person registers, plan a run") stays inside one mode.
- The evaluation mode has a shell. That the docker socket stays with the orchestrator now rests on the persona line and on observation, not on composition. This is a deliberate step back from a structural guarantee, and the observation points are how it gets re-earned.
- Old `dataset-authoring` sessions fail to resume with `agent-preset/not-found`. Their transcripts are kept.
- An evaluation session's tool set grows: `bash` (or `pwsh`), `web_fetch`, and `datasets_propose_registration`.
- 「让 Agent 整理」 needs no per-deployment config. A deployment with no organizing preset degrades to the default mode, and the request text still names the skill.
- Tests: `packages/datasets/tests/organizing-preset.spec.ts` runs the pick against both real bundle patches. `packages/presets/tests/presets.spec.ts` and the two script specs pin the composition (shell rows, both skills, the organize tier, no dataset-authoring, dev and writing without evaluation items).
