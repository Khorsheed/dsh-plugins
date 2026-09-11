# dsh-mission

English | [中文](README.md)

Generic task management for the dsh ecosystem: a **mission** is one work item — state, labels, plan data (dependencies / one-shot schedule), attempts, opaque resource references, an artifact index, and append-only namespaced annotations; a **run** is a batch of missions created from a template. The template declares a state machine, the run freezes it, and every mission enforces it: declaration *is* enforcement — undeclared transitions fail loud, guards are deterministic, and nothing ever transitions automatically.

M1 ships the store, the state machine with three built-in guards, the run-template linter, the five-bucket projection, the service face (`ctx.mission`), twelve model tools, and the `dsh-mission` CLI; M2 adds the `/mission` slash face and gated run-bundle export; M4 adds the web session tab over a Typert Remote data face.

## How it works

- **Run** — one JSON file (`runs/<runId>.json`) holding the frozen state machine, every mission with its attempts, and all annotations. `runs/<runId>/data/…` is the append-only run-data tree submissions land in.
- **Mission** — a work item, unique id within its run. `labels` carry arbitrary coordinates (e.g. `layer=dwd`), `dependsOn` / `scheduledAt` are plan data. Plan data only moves the projection — mission never fires anything; starting work stays with the human / agent / external orchestrator.
- **Attempt vs checkpoint** — an attempt is a full re-run (`retry` requires a free-text `reason` and a domain-neutral `infrastructure | operator | outcome` category; the new attempt and its history record them, while the old attempt stays immutable); a checkpoint is a continuous progress point *inside* one attempt. They are never interchangeable.
- **Guards** — transition preconditions, three built-in types, no seam for more: `file-check` (expected files under a directory relative to the attempt's run-data directory — no interpolation; directory entries ending in `/` must recursively contain at least one regular file), `schema-check` (a named JSON input validates against a JSON Schema subset), `attested` (a key an external script or human registered via `attest`).

  `schema-check`'s `inputFrom` names its input (default `submission`):

  | `inputFrom` | validates | use |
  |---|---|---|
  | `submission` | the payload recorded by `submit` (also pre-validated at submit time) | structure-constrained outputs |
  | `run-meta` | the run's `meta` object | pin scene data at the earliest transition — e.g. require dataset-snapshot fields (`datasetId`/`commit`) so a changed snapshot can never silently ride along (the meta analogue of `refs.fingerprint`) |

  mission reads only JSON Schema — the concrete fields are scene data declared by the template, never plugin vocabulary.

  When the current state has one submission-input `schema-check` edge, `submit` still pre-validates it automatically. With several such edges, callers must pass the intended `to`, and only that edge is pre-validated. `transition` always re-runs the actual edge's guard; `to` does not move state.
- **Five-bucket projection** — the filter dimension for queue views, derived from the state-machine *shape* plus plan data: terminal state (no out-edge) → `done`; unmet `dependsOn` → `blocked`; future `scheduledAt` → `scheduled`; initial state (no in-edge) → `ready`; everything else → `active`.
- **Releasable states** — a template with a non-empty `releasableStates` declares "this run holds resources to release". `is-releasable` answers whether a mission's resources may be destroyed, and the linter enforces the gate's integrity (below). The run-status warning (`holding resource but not releasable`) fires only for missions holding `refs.resource` in a state UPSTREAM of the gate — a state downstream of a releasable state (e.g. `released`, reachable from `releasable` through the declared transitions) is settled and stays silent, while the immutable `refs` record is kept.

## Install and load

The package's single identity is **`@khorsheed/dsh-mission`**, developed in the `dsh-plugins` monorepo and published to npm from there:

```sh
npm install @deepseek-ai/dsh                            # the host (dsh web / dsh CLI)
dsh plugin --profile web add @khorsheed/dsh-mission     # this plugin
```

The package declares `dsh.bundle`, so the add reconciles its `cordis.patch.yml` row (a bare `mission` mount) into the profile's bundles layer — no hand-edited cordis.yml. A composition may mount the `mission` row id only once; check with `dsh --profile web --dump-config | grep mission` before adding to a composition that might already mount it. From source: clone the monorepo; the package lives at `packages/mission` (`pnpm install && pnpm run build`).

Config (all optional): `dataDir` — the host instance's data root (default `$DSH_HOME/state/mission`, else `<cwd>/.dsh-mission`). `tools` is no longer a key on this row: the model-tool grouping moved to the companion row `@khorsheed/dsh-mission-tool`, see [Model tools](#model-tools).

## Storage and concurrency

- Host-instance data root: plugin `dataDir` > `$DSH_HOME/state/mission/` > `<cwd>/.dsh-mission`.
- CLI data root: `--data-dir` > `$DSH_MISSION_DATA_DIR` > `$DSH_HOME/state/mission/` > `<cwd>/.dsh-mission`. A host instance patch's `dataDir` is invisible to the out-of-process CLI; to share the root, point the CLI at the same path explicitly with `--data-dir` or `DSH_MISSION_DATA_DIR`.
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

**This package registers no model tool any more (BREAKING)**: the tools and the `tool:mission` prompt section belong to the companion row `@khorsheed/dsh-mission-tool`, granted per session by an agent preset. Migration is two lines: install the companion as a dependency and add `- id: mission-tool` / `  name: '@khorsheed/dsh-mission-tool'` to the target preset's `agent.cordis.yml` (that row may carry `config: { tools: read }`). The inventory, group table, and behavior prose below describe the **companion's** tool face from here on; the service face, CLI, slash command, and tab still belong to this package.

`mission_run_create` / `mission_run_list` / `mission_run_status` / `mission_create` / `mission_list` / `mission_get` / `mission_transition` / `mission_submit` / `mission_annotate` / `mission_attest` / `mission_retry` / `mission_is_releasable`. `mission_submit.to` has the service face's intended-edge semantics; `mission_retry` requires `reason` and `category`. Write tools ride the standard `tools/pre-execute` approval pipeline; the calling session id is recorded into history as `tool:<sessionId>`. A companion system-prompt section (`tool:mission`) briefs the model. **Export is intentionally not a tool** — sharing a run bundle is an initiating-class human decision (CLI/slash/tab only, with the leak gate).

**Tools register as a group** — a mount picks one with `tools`, because a preset can only choose among the tools that were registered; it cannot subtract one the profile registered. Whether the model can write has to be decided where registration happens.

| `tools` | Registered |
|---|---|
| `all` (default) | the twelve above — byte-identical behavior to before this option existed |
| `read` | `mission_run_list` / `mission_run_status` / `mission_list` / `mission_get` |
| `none` | nothing |

`read` is for mounts where something else does the writing: the run is driven by a service-face caller, the CLI, or a person at the tab, and the model only reads the queue. `mission_is_releasable` is read-only yet stays in `all` — it answers whether a held resource may be destroyed, which belongs with the side holding it, and a `read` mount is by definition not that side. The system-prompt section (`tool:mission`) follows the group: `all` keeps the original text, `read` gets a text naming only those four tools and saying who writes instead, and `none` registers no section at all. The service face, CLI, slash command, and tab are unaffected in all three — the tool face is the only one the group trims.

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
dsh-mission submit MISSION_ID [--file SRC[:DEST]]... [--json JSON | --json-file F] [--to TO] [--checkpoint NAME] [--run ID]
dsh-mission annotate MISSION_ID --ns NS --payload JSON [--run ID]
dsh-mission attest MISSION_ID --key K [--note N] [--run ID]
dsh-mission retry MISSION_ID --reason TEXT --category infrastructure|operator|outcome [--run ID]
dsh-mission set-refs MISSION_ID [--resource R] [--fingerprint F] [--session S]... [--run ID]
dsh-mission add-artifact MISSION_ID --path P --kind K [--run ID]   # P must exist under the attempt's run-data dir
dsh-mission add-checkpoint MISSION_ID --name N [--ref R] [--artifact A]... [--run ID]
dsh-mission is-releasable MISSION_ID [--run ID]   # exit 0/1, for teardown scripts
dsh-mission export RUN_ID --out DIR [--snapshot-dir DIR] [--snapshot-repo R --snapshot-commit C [--snapshot-dataset ID]]
         [--layer NAME]... [--guarded NAME]...   # self-contained bundle (leak gate below)
```

## Slash commands

One `/mission` command with subcommands, a thin adapter over the same service kernel (humans, alongside the model tools for agents and the CLI for scripts):

```text
/mission queue [--run ID] [--bucket ready|scheduled|blocked|active|done] [--all]
/mission run list
/mission run status RUN_ID
/mission run create --template FILE [--id ID] [--meta JSON]
/mission retry MISSION_ID --reason TEXT --category infrastructure|operator|outcome [--run ID]
```

`queue` renders the five-bucket queue table (id / title / bucket / template state / plan-blocked / duration) with the held-but-unreleasable warning; it defaults to THIS session's runs (`originSession` filter), `--all` widens to every run, `--run` names one. `run status` prints the same projection table as the CLI. `run create` records the calling session as the run's `originSession`; writes are attributed `slash:<sessionId>` in history. Usage errors answer with the usage text. **Export is not a slash command yet** — it lands with the leak gate in the rest of M2.

## Export and the leak gate

`dsh-mission export RUN_ID --out DIR` writes a **self-contained bundle** `<runId>-bundle/`: `manifest.json` (frozen state machine, dataset snapshot reference, per-layer content hashes, the included-layer list with guarded layers plainly marked, the ns completeness report), `run.json`, `missions/<id>/attempt-N/{meta.json, annotations.json, artifacts/}`, `dataset/<layer>/` for every included layer, and a `methodology.md` stub for the human write-up. A bundle directory is never overwritten.

**The leak gate**: including a guarded (`modelFacing: false`) layer requires an interactive TTY confirmation — each guarded layer is listed and confirmed one by one. Non-TTY invocations are refused (fail-closed): an agent driving the CLI through Bash has no TTY and is stopped there, and no flag (including `--include-guarded`-style ones) bypasses the gate. The slash face has no confirmation channel at all, so `/mission export` refuses guarded layers and points at the TTY CLI; when the datasets plugin is mounted, the slash face resolves layer visibility from its metadata (explicit `--guarded` declarations otherwise).

**expectedNs**: when run meta declares `expectedNs`, `run status` and export print the per-cell namespace report — a missing ns is reported missing (never substituted by another namespace), and a cell whose annotations are all outside `expectedNs` is marked "only unlisted ns present" in the report and the manifest. Each ns also has `writtenBy`, the deduplicated set of writer prefixes across its current-attempt annotations (for example `tool:`, `cli`, `service`, `slash:`). If an expected ns was written only through `tool:`, the report states that fact without judging it.

## Session tab

The `missions` entry in the conversation tab ring (web profile): five-bucket filter chips (multi-select), a run scope selector (this session by default, all runs, or one run), and the task table — # / title / bucket / template state / plan-blocked / duration — with the unreleased-resource warning per run section. Selecting a row opens the detail panel (attempt / checkpoint / annotation counts) with the human gestures: retry after entering a reason and category (opens a new attempt), release check, and export bundle. The export dialog plans first, lists guarded (`modelFacing: false`) layers when any are included, and enables export only after each is individually acknowledged — the same gate as the CLI's TTY confirmation, re-checked host-side. Data rides the `mission` Typert Remote namespace (host side: `MissionRemoteService`, a thin adapter over `ctx.mission`).

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ — store, state machine and guards, linter, five-bucket projection, service face, CLI, and slash commands all work on the published host (the model tools come from the companion row `@khorsheed/dsh-mission-tool`, below). minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master, fork or upstream): ✅ — same (verifiedHost: 0.1.2-rc.1).

Degraded / absent items (mirrors `dsh.compat` in package.json): slash commands need an interactive UI adapter (web/TUI) — headless profiles have no command adapter, so `/mission` is unavailable there while tools, the service face, and the CLI stay fully functional. The model-tool grouping (`tools: 'read'` / `'none'`) is now a choice on the **companion row** `@khorsheed/dsh-mission-tool`, not a config key of this row — trimming the model tools per the table above is the mounting party's choice, not a missing host capability; the service face, CLI, slash command, and tab are unaffected. The 任务 tab self-hides: it registers only when the current session's preset composition names the `@khorsheed/dsh-mission-tool` row, read from the official `pluginInventory` Remote, and every unreadable path fails OPEN (stays visible). Release order matters: a pack that names a companion row needs the companion published / installed first — a row that fails to resolve reports the preset composition `broken` while the instance boots unaffected. The session tab is a web surface; TUI has no tab mechanism, and headless profiles expose the Remote data face without a browser consumer. The tab is live-smoke-tested on the `0.1.0-rc.8` web profile; earlier release lines share the same gateway conventions but were not smoke-tested.

## Known Limitations and Deferred Work

- **Templates are JSON, not YAML** — the proposal's examples are YAML, but v1 avoids a YAML dependency until the dependency decision is made; both forms describe the same document model.
- **`retry` is not idempotent by nature** — every reasoned call opens a real new attempt; repeating the same reason/category opens another one. All other writes are idempotent (identical repeats are no-ops).
- **The lock is best-effort against pid reuse** — a stale lock is reclaimed when its pid is dead or it is older than 60 s; a recycled pid inside that window can wait up to the 10 s lock timeout. Fine at the expected write density; the store can move to sqlite without touching the data model.
- **One initial state per template** — missions must start unambiguously; terminal states may be any number.
- **The tab has no submit button** — submitting outputs needs artifact upload plumbing the Remote face does not carry; `mission_submit` (tool) and `dsh-mission submit` (CLI) cover it. The export dialog's confirmation is the leak gate's web form: guarded layers must be acknowledged one by one, and the host re-checks the confirmed list against a fresh plan.
