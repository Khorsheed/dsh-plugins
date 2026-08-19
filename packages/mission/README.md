# dsh-mission

English | [中文](README.zh.md)

Generic task management for the dsh ecosystem: a **mission** is one work item — state, labels, plan data (dependencies / one-shot schedule), attempts, opaque resource references, an artifact index, and append-only namespaced annotations; a **run** is a batch of missions created from a template. The template declares a state machine, the run freezes it, and every mission enforces it: declaration *is* enforcement — undeclared transitions fail loud, guards are deterministic, and nothing ever transitions automatically.

Milestone M1 ships the store, the state machine with three built-in guards, the run-template linter, the five-bucket projection, the service face (`ctx.mission`), twelve model tools, and the `dsh-mission` CLI; M2 adds the `/mission` slash face. Run-bundle export is the rest of M2; the session tab is M4.

## How it works

- **Run** — one JSON file (`runs/<runId>.json`) holding the frozen state machine, every mission with its attempts, and all annotations. `runs/<runId>/data/…` is the append-only run-data tree submissions land in.
- **Mission** — a work item, unique id within its run. `labels` carry arbitrary coordinates (e.g. `layer=dwd`), `dependsOn` / `scheduledAt` are plan data. Plan data only moves the projection — mission never fires anything; starting work stays with the human / agent / external orchestrator.
- **Attempt vs checkpoint** — an attempt is a full re-run (`retry` opens a new one, the old stays immutable); a checkpoint is a continuous progress point *inside* one attempt. They are never interchangeable.
- **Guards** — transition preconditions, three built-in types, no seam for more: `file-check` (expected files under a directory relative to the attempt's run-data directory — no interpolation), `schema-check` (the recorded submission validates against a JSON Schema subset), `attested` (a key an external script or human registered via `attest`).
- **Five-bucket projection** — the filter dimension for queue views, derived from the state-machine *shape* plus plan data: terminal state (no out-edge) → `done`; unmet `dependsOn` → `blocked`; future `scheduledAt` → `scheduled`; initial state (no in-edge) → `ready`; everything else → `active`.
- **Releasable states** — a template with a non-empty `releasableStates` declares "this run holds resources to release". `is-releasable` answers whether a mission's resources may be destroyed, and the linter enforces the gate's integrity (below).

## Install and load

The package's single identity is **`@khorsheed/dsh-mission`**, developed in the `dsh-plugins` monorepo and published to npm from there:

```sh
npm install @deepseek-ai/dsh                            # the host (dsh web / dsh CLI)
dsh plugin --profile web add @khorsheed/dsh-mission     # this plugin
```

The package declares `dsh.bundle`, so the add reconciles its `cordis.patch.yml` row (a bare `mission` mount) into the profile's bundles layer — no hand-edited cordis.yml. A composition may mount the `mission` row id only once; check with `dsh --profile web --dump-config | grep mission` before adding to a composition that might already mount it. From source: clone the monorepo; the package lives at `packages/mission` (`pnpm install && pnpm run build`).

Config (all optional): `dataDir` — the data root (default `$DSH_HOME/state/mission`, else `<cwd>/.dsh-mission`).

## Storage and concurrency

- Data root: plugin config / `--data-dir` > `$DSH_HOME/state/mission/` > `<cwd>/.dsh-mission`.
- `runs/<runId>.json` — state and index (run, missions, attempts, annotations); one run one file.
- `runs/<runId>/data/<missionId>/attempt-<N>/…` — the run-data body. Submissions **append**; identical bytes at an existing path are an idempotent no-op, different bytes fail loud. `file-check` dirs resolve relative to the attempt directory.
- Concurrent writes serialize on a per-run lock file (hand-rolled `wx`-create + stale-pid reclamation — no dependency); every mutation is lock → read → modify → temp-write → atomic-rename, so the in-host service and out-of-process CLI calls write the same store safely. Queries use the JSON index, never directory walks.

## Run templates (JSON)

```json
{
  "name": "content-pack-daily",
  "states": ["queued", "active", "done", "failed"],
  "transitions": [{ "from": "queued", "to": "active" }, { "from": "active", "to": "done" }, { "from": "active", "to": "failed" }],
  "missions": [
    { "id": "ods-extract", "labels": { "layer": "ods" } },
    { "id": "dwd-clean", "labels": { "layer": "dwd" }, "dependsOn": ["ods-extract"] }
  ]
}
```

The state machine also nests under a `stateMachine` key; both forms normalize identically. A template must have exactly one initial state. The built-in `simple` template (`queued → active → done | failed`) backs the zero-config implicit run every bare `mission_create` lands in (per-session when a session is known, `default` from the CLI).

**Lint** (`dsh-mission run lint`, also enforced at run creation — errors refuse the run):

- *error*: with a non-empty `releasableStates`, every transition **entering** a releasable state must carry a guard — an unguarded release permission is an empty gate;
- *warning*: a terminal state reachable **without** passing through any releasable state (resources may leak);
- *error*: a `schema-check` schema that is missing, unparsable, or outside the supported subset (`type` / `required` / `properties` / `items` / `if` / `then` / `const` / `enum` / `additionalProperties` — a hand-rolled validator, no ajv dependency).

The `simple` template's `releasableStates` is deliberately empty: everyday work items hold no destroyable resources, and a guard on every `active → done` would make the zero-config path impossible.

## Model tools

`mission_run_create` / `mission_run_list` / `mission_run_status` / `mission_create` / `mission_list` / `mission_get` / `mission_transition` / `mission_submit` / `mission_annotate` / `mission_attest` / `mission_retry` / `mission_is_releasable`. Write tools ride the standard `tools/pre-execute` approval pipeline; the calling session id is recorded into history as `tool:<sessionId>`. A companion system-prompt section (`tool:mission`) briefs the model. **Export is intentionally not a tool** — sharing a run bundle is an initiating-class human decision (M2, CLI/slash only).

## Service face

Other plugins consume `ctx.get('mission')` — an in-process contract, never a subprocess or a hand-written JSON file. Beyond everything the tools expose, the fine-grained methods are `setRefs` (resource handle / environment fingerprint / sessions), `addArtifact`, `addCheckpoint` (only the resource holder fills `ref`; it merges into `submit`'s ref-less checkpoint of the same name — never a duplicate entry), `annotate`, and `isReleasable`.

## CLI

`dsh-mission <command>` (or `node lib/cli.js`); every command takes `--data-dir DIR`. Exit codes: `0` ok / releasable, `1` failure / not releasable / lint errors, `2` usage.

```sh
dsh-mission run create --template t.json [--id ID] [--meta JSON]
dsh-mission run lint --template t.json        # errors refuse; exit 1 on errors
dsh-mission run list
dsh-mission run status RUN_ID                 # five-bucket projection table
dsh-mission create [--run ID] [--id ID] [--title T] [--label k=v]... [--depends-on a,b] [--scheduled-at MS]
dsh-mission list [--run ID] [--bucket B] [--label k=v]...
dsh-mission get MISSION_ID [--run ID]
dsh-mission transition MISSION_ID TO [--note N] [--run ID]
dsh-mission submit MISSION_ID [--file SRC[:DEST]]... [--json JSON | --json-file F] [--checkpoint NAME] [--run ID]
dsh-mission annotate MISSION_ID --ns NS --payload JSON [--run ID]
dsh-mission attest MISSION_ID --key K [--note N] [--run ID]
dsh-mission retry MISSION_ID [--run ID]
dsh-mission is-releasable MISSION_ID [--run ID]   # exit 0/1, for teardown scripts
```

## Slash commands

One `/mission` command with subcommands, a thin adapter over the same service kernel (humans, alongside the model tools for agents and the CLI for scripts):

```text
/mission queue [--run ID] [--bucket ready|scheduled|blocked|active|done] [--all]
/mission run list
/mission run status RUN_ID
/mission run create --template FILE [--id ID] [--meta JSON]
/mission retry MISSION_ID [--run ID]
```

`queue` renders the five-bucket queue table (id / title / bucket / template state / plan-blocked / duration) with the held-but-unreleasable warning; it defaults to THIS session's runs (`originSession` filter), `--all` widens to every run, `--run` names one. `run status` prints the same projection table as the CLI. `run create` records the calling session as the run's `originSession`; writes are attributed `slash:<sessionId>` in history. Usage errors answer with the usage text. **Export is not a slash command yet** — it lands with the leak gate in the rest of M2.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.6+`): ✅ — store, state machine and guards, linter, five-bucket projection, service face, model tools, CLI, and slash commands all work on the published host.
- source line (deepseek-harness master, fork or upstream): ✅ — same.

Degraded / absent items (mirrors `dsh.compat` in package.json): slash commands need an interactive UI adapter (web/TUI) — headless profiles have no command adapter, so `/mission` is unavailable there while tools, the service face, and the CLI stay fully functional. Run-bundle export (the rest of M2, with the leak gate and expectedNs completeness report) and the web session tab (M4) do not exist in this line yet.

## Known Limitations and Deferred Work

- **Templates are JSON, not YAML** — the proposal's examples are YAML, but v1 avoids a YAML dependency until the dependency decision is made; both forms describe the same document model.
- **`retry` is not idempotent by nature** — every call opens a real new attempt. All other writes are idempotent (identical repeats are no-ops).
- **The lock is best-effort against pid reuse** — a stale lock is reclaimed when its pid is dead or it is older than 60 s; a recycled pid inside that window can wait up to the 10 s lock timeout. Fine at the expected write density; the store can move to sqlite without touching the data model.
- **One initial state per template** — missions must start unambiguously; terminal states may be any number.
- **M2/M4 scope** — bundle export (with the leak gate and expectedNs completeness report) and the web session tab are designed in the proposal and deliberately absent here; the slash face shipped without export.
