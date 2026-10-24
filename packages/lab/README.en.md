# @khorsheed/dsh-lab

English | [中文](README.md)

Give every experiment cell its own isolated, condition-consistent, reproducible Docker container, and turn "is this the same environment?" into a fingerprint you can compare.

A controlled experiment compares subjects, not environments: one question set, several harnesses, a few runs each — and as soon as one cell has an extra mount, a different network or other resource limits, the results stop being comparable. When an evaluation-mode plan carries a `unit` segment, the orchestrator uses this plugin to acquire one container unit per cell: put the task in, delegate and verify inside it, collect the output, archive the scene, and destroy it once the release gate passes. It fits any workload shaped as a batch of subjects × a batch of cases × isolated, consistent environments × results to compare, such as A/B-testing configurations or cross-version regression.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/lab-record-env.png" width="640" alt="An Experiments run-record detail: the environment fingerprint and container unit in the parameter table, matching the other cells of the same run">

## Features

- **The full unit lifecycle** — eight verbs, acquire / populate / collect / checkpoint / verify / archive / release / status; the `ctx.lab` service face and the `dsh-lab` CLI share one kernel.
- **A composite environment fingerprint** — image digest, resource limits, mounts (in-container path and type), environment variable key names, network and user are each a component, combined into `lab-env:<hex>`; what is declared is actually applied to the container, so the fingerprint never claims isolation the container lacks.
- **It records, never judges** — lab registers resource ids, fingerprints, artifacts and the verbatim output of verification commands; "passed?" and "how good?" belong to the consumer.
- **Release is the gate** — when a unit is bound to a mission and the mission ledger (installed with `@khorsheed/dsh-eval`) is present, `release` must pass `isReleasable` first, and a failed query is a refusal; without a gate it takes an explicit `force` plus a warning.
- **Survives restarts** — the docker daemon is the registry: unit ids, fingerprints and mission bindings ride on container labels, and reconcile re-adopts them after a host restart.
- **Failures keep the evidence** — a crashed cell is collected, then archived, then sent through the same gate, and only that cell gets a new attempt.
- **Guards against accidental concurrency and orphan processes** — `maxConcurrentUnits` (default 4) blocks accidental concurrency; in-container processes lab spawned itself are swept before release.
- **Several instances on one daemon, by scope** — an instance with a `scope` adopts and acts only on units in its own scope, and refuses everything across scopes.

Fairness and comparability at a glance:

```text
UNIT      MISSION           CONTAINER   LAST-ACTIVITY  TASK      ENV       LABELS
u-a3f9    cell-1:working    up 2h14m    3m ago         9f2c1a2b  4d1e77b0  task=F1,subject=A
u-b71c    cell-2:collected  up 2h14m    47m ago        9f2c1a2b  4d1e77b0  task=F1,subject=B
```

`dsh-lab status` prints one unit per row: matching TASK hashes mean the same task, matching ENV means comparable environments, and a `working` row with a long `LAST-ACTIVITY` gap is a stuck cell.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/lab-run-units.png" width="640" alt="The results page's unreclaimed-units section: each container the run still holds, its cell's state, and the reclaim button">

## Install

The recommended install comes with the evaluation mode (datasets, this plugin, the evaluation orchestrator and the local-agent delegation family, plus the evaluation-mode preset):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```

You can also install it alone:

```sh
dsh plugin --profile web add @khorsheed/dsh-lab
```

Restart the web instance to apply. Requirements: the docker CLI is reachable on the host; images must ship `sleep` and `sh` (checkpoint also needs `git`). Optional configuration: `maxConcurrentUnits` (default 4), `stateDir` (the fingerprint mirror directory, default `$DSH_HOME/lab`), `scope` (instance scope, off by default).

```sh
dsh plugin --profile web remove @khorsheed/dsh-lab
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.2.0-rc.2`): ✅ — the service face and docker provider work on the published host. Since T88 the evaluation family moves minHost up to 0.2.0-rc.2 together — 0.1.x hosts stay on the previous release line.
- source line (deepseek-harness master, fork or upstream): ✅ — same (verifiedHost: 0.2.1-rc.1); host-021 wave: full build+test green against the 0.2.1-rc.1 tree, no other surface changes.

Degraded / absent items (mirrors `dsh.compat` in package.json): without the mission ledger (installed with `@khorsheed/dsh-eval`) the release gate degrades to an explicit force flag plus a warning, and ref/artifact/checkpoint/verify registration is skipped with a warning. `dsh-lab` reads mission state through `dsh-mission get --json` (T89); an older mission CLI without `--json` gets an upgrade hint and that status is skipped. The `lab_*` model tools (M3) do not exist in this line yet.

## Known limitations

- **Docker is the only provider** — the worktree provider exists only as an interface shape; its isolation is an order of magnitude weaker and it must not be used for experiments that need comparability.
- **`populate` is a copy** — zero-copy read-only input has to be declared as `mounts` at acquire time; mounts cannot be added once the container exists.
- **The fingerprint records what was declared, not what was measured** — it catches "the configuration changed within one batch of runs", not "the two machines are identical"; host differences such as kernel or CPU model are not components. To assert no outbound network you must declare an `--internal` network explicitly.
- **The orphan sweep covers only lab's own exec** — processes from a foreign `docker exec` are invisible (removing the container still takes them).
- **No model tools** — the `lab_*` tools (M3) are deliberately absent on this line.

The full list is in the [reference](docs/reference.en.md#known-limitations-and-deferred-work).

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Architecture.** A `LabService` kernel with a provider (docker for now); the plugin entry provides it as `ctx.lab`, and the `dsh-lab` CLI runs the same kernel with a `child_process` runner. A unit is a labelled container `dsh-lab-<id>`; lab's only host directory is the fingerprint mirror (`units/<id>.json`), which has no authority — deleting it loses nothing.

**Fingerprint.** The sha256 of each component's canonical JSON; undeclared components take no part in the hash, so widening the component set leaves old units' fingerprints unchanged. `fingerprintOf(components)` is exported as a pure verb, which the evaluation orchestrator uses to compute the "environment class".

**Mission ledger integration.** The coupling to the mission ledger is probed: when present, refs, artifacts, checkpoints and verification annotations are registered and release goes through its gate; when absent, registration is skipped with a warning and release needs `force`. CLI mode does the same through the `dsh-mission` binary.

Deep reference:

- [Reference](docs/reference.en.md) — how it works and the fingerprint component table, install and configuration, the service face, per-instance scoped mounting, the CLI, the failure recovery loop, the full list of known limitations

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/lab`). Please file issues and contributions there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
