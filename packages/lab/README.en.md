# dsh-lab

English | [中文](README.md)

Controlled experiment units for the dsh ecosystem: an **experiment unit** is one isolated, condition-consistent, reproducible execution environment, and this plugin manages its lifecycle — acquire / populate / collect / release / status. It serves any workload shaped as *a batch of subjects × a batch of cases × identical isolated environments × comparable results* (evaluation runs, A/B config tests, cross-version regression, batch data-processing validation).

Three red lines define the character of the plugin:

1. **It records, never judges.** lab runs and registers facts (resource ids, environment fingerprints, artifacts); "passed?", "how good?" belong to whoever consumes the records.
2. **`release` is the gate's enforcement point.** When the unit is bound to a mission and the `@khorsheed/dsh-mission` plugin is present, `isReleasable` must pass — a failed query fails closed, and no option bypasses the check. Without a gate (no mission binding, or the plugin absent), release requires an explicit `force` and warns.
3. **It never fires work.** lab provides verbs; when to call them belongs to the human / agent / external orchestrator.

Milestones M1–M2 ship the service face (`ctx.lab`) and the `dsh-lab` CLI over the same kernel, with the docker provider: acquire / populate / collect / checkpoint / verify / archive / release / status, environment fingerprints, orphan-process compensation, and the `maxConcurrentUnits` safety valve. The model tools are M3.

## How it works

- **Unit** — one labeled container (`dsh-lab-<id>`). The docker daemon is the registry of record: unit id, fingerprint with its components, and mission binding ride resource labels, so `status` / `release` reconcile and survive a host restart. lab's one host directory is the **fingerprint mirror** (below); it holds no authority, and deleting it loses nothing.
- **Composite environment fingerprint** — environments differ → results aren't comparable, so "the same environment" has to be a mechanism rather than a convention. The fingerprint is sha256 over a canonical JSON of the components, carried as `lab-env:<hex>`:

  | Component | Content | Deliberately excluded |
  |---|---|---|
  | `image` | the repo digest `acquire` resolves (falling back to the image id, pulling when absent locally) | — |
  | `resources` | the `--cpus` and `--memory` ceilings, compared normalized (`4g` and `4096m` are one ceiling) | — |
  | `mounts` | each mount's **in-container** path, kind (`bind` / `volume`), and read-only bit, sorted by that path | host paths and volume NAMES (the same input lands elsewhere on another machine; one credential volume per harness is by design), declaration order |
  | `envKeys` | the **names** of the injected environment variables, sorted | values (a credential or a per-cell coordinate, not the shape of the environment) |
  | `network` | the docker network the unit joins, or `'none'` | — |
  | `user` | the in-container user (`uid[:gid]` or a name) | — |

  The component shape never varies: an undeclared scalar is `null` rather than a missing key. One image under different resource ceilings, with one extra mounted volume, one extra injected key, a different network, or a different user all fingerprint differently. Everything declared is really applied to the container (`--cpus` / `--memory` / `--network` / `--user`): the fingerprint never claims an isolation the container does not carry.

  The network matters most: **without a declared `network` the unit lands on docker's default bridge, which HAS NAT egress**. "The unit cannot reach the internet" is only expressible by naming an `--internal` network.

  **An undeclared component contributes nothing to the hash.** When the component set later grows, the fingerprint of a unit that declares none of the new components does NOT move — not a compatibility shim, but what a fingerprint means: it should change when the environment it describes changes, and a unit that declared no network before and declares none now is running in the same place. `version` numbers the **hashing rules** (canonicalization, normalization, this undeclared-is-absent rule), not the component inventory.
- **Fingerprint mirror** — `acquire` writes `{ fingerprint, components }` both to the container labels and to `units/<id>.json` under `stateDir` (default `$DSH_HOME/lab`, else `<cwd>/.dsh-lab-state`). The labels are the record; the file is a derived copy — reconcile re-materializes it when it adopts a unit that survived a host restart, and `release` removes it with the unit. It exists so that "why did these two cells not compare?" does not require parsing `docker inspect`; the durable copy for a released unit is in its archive's `manifest.json`.
- **Legacy fingerprints** — a bare digest recorded before this line is still accepted, as a fingerprint with no components; it is never reinterpreted into one. Such a unit still shows an ENV cell in `status`, and the `fingerprint` verb reports `components: null` for it.
- **Inputs** — two paths: declare `mounts` at acquire for a zero-copy mount (container mounts cannot be added after creation), with `type` either `bind` (the default; `source` is a host directory) or `volume` (`source` is a volume name — the path for writable state that must outlive one unit, such as a per-harness credential volume whose token refresh is written back), or `populate` a host directory into the running unit (a copy into the unit's writable layer). A directory path is the whole interface — a datasets `worktree_path` product or any caller-supplied path; lab has no code-level datasets dependency, and layer allowlists are enforced on the side that produced the path.
- **Materialization manifest** — `populate` returns `{ sha, count, files }` (per-file content hashes plus an overall hash over the sorted list), and with `manifestPath` writes the manifest file and registers it as a mission artifact of kind `materialization`. Identical inputs hash identically — the byte-level fairness proof across parallel units — and the manifest doubles as the baseline a later `collect` diffs against (what was given vs what was produced).
- **Activity facts, not verb timestamps** — `status` reports `lastActivityAt` from the newest workspace file mtime inside the unit (work writes files; lab is not invoked meanwhile, so a verb-call timestamp would be a fake metric), plus cumulative container CPU from cgroup `cpu.stat` as the secondary fact. Because `docker cp` preserves source mtimes, `populate` stamps a `.lab-materialized` marker into the target as the activity baseline — otherwise a freshly populated unit would look idle for the source's whole age.
- **Orphan-process compensation** — every in-container command lab spawns goes through a wrapper that records its own pid under `/run/dsh-lab/pids/`; `release` first sweeps those pids with SIGTERM inside the container, then removes the container. Coverage is the provider's own exec path — processes others exec into the unit are out of lab's reach. `acquire` creates that directory as root and makes it `1777` (like `/tmp`), because the unit may well run as a non-root user — a declared `user`, or the image's own `USER` (the evaluation image runs as `node` because one CLI refuses its sandbox mode under root) — and such a user cannot create anything under `/run`.
- **`maxConcurrentUnits`** — a plain ceiling (config, default 4): `acquire` refuses at the limit with an explicit error. lab doesn't know which phases may overlap (that's the caller's semantics); one number blocks accidental concurrency, which silently corrupts timing-sensitive measurements.
- **Checkpoint** — commit the workspace (auto-initialized as a git repo on first checkpoint) and tag it; the commit sha goes into the mission's checkpoint `ref`. A read-only mounted workspace fails loud — it cannot be committed, which is the correct signal.
- **Verify** — optionally copy verification material into a scratch dir, run the command in the workspace, remove the material, and record the outcome *verbatim* (exit code, stdout, stderr, duration, timeout fact) into the mission's `lab` annotation namespace. There is no pass/fail branch anywhere in the code path.
- **Archive** — export the workspace into a host directory plus a `manifest.json` (per-file sha256 + size, unit facts, fingerprint with its components), registered as a mission artifact. The archived components are the durable copy of a released unit's environment — the mirror goes away with `release`, the archive does not.

## Install and load

The package's single identity is **`@khorsheed/dsh-lab`**, developed in the `dsh-plugins` monorepo and published to npm from there:

```sh
npm install @deepseek-ai/dsh                            # the host (dsh web / dsh CLI)
dsh plugin --profile web add @khorsheed/dsh-lab         # this plugin
```

The package declares `dsh.bundle`, so the add reconciles its `cordis.patch.yml` row (a bare `lab` mount) into the profile's bundles layer — no hand-edited cordis.yml. A composition may mount the `lab` row id only once; check with `dsh --profile web --dump-config | grep lab` before adding to a composition that might already mount it. From source: clone the monorepo; the package lives at `packages/lab` (`pnpm install && pnpm run build`).

Config (all optional): `maxConcurrentUnits` — the held-unit ceiling (default 4); `stateDir` — the fingerprint mirror's directory (default `$DSH_HOME/lab`, else `<cwd>/.dsh-lab-state`).

Requirements: the docker CLI reachable from the host, and images that ship `sleep` and `sh` (the keep-alive command and the pid-recording wrapper).

## Service face

Other plugins and scripts consume `ctx.get('lab')` (typed as `ctx.lab`):

```ts
const unit = await ctx.lab.acquire({
  image: 'eval-env:latest',
  missionId: 'F1-a-r1',                       // optional mission binding
  mounts: [
    { source: worktreePath, target: '/input', readonly: true },        // bind (the default)
    { source: 'eval-creds-codex', target: '/creds', type: 'volume' },  // state that outlives the unit
  ],
  resources: { cpus: '2', memory: '4g' },     // these four are applied to the container AND hashed
  network: 'eval-net',                        // undeclared = docker's default bridge, which has egress
  user: '1000:1000',                          // undeclared = the image's own USER
  workdir: '/workspace',
  ownWorkdir: true,                           // create the workdir and hand it to the unit's user (below)
})
// unit.fingerprint = 'lab-env:<hex>' (written into the mission's refs, opaque there)
// unit.fingerprintComponents = { version, image, resources, mounts, envKeys, network, user }
await ctx.lab.populate(unit.id, { source: '/path/to/layer', manifestPath: '/host/run-data/materialization.json' })
// → { sha, count, files } — registered as a 'materialization' artifact
const { ref } = await ctx.lab.checkpoint(unit.id, { name: 'iter-1' })
const outcome = await ctx.lab.verify(unit.id, { command: ['npm', 'test'], source: '/path/to/checks', timeoutMs: 300_000 })
// outcome = { exitCode, stdout, stderr, durationMs, timedOut } — verbatim; also annotated into mission ns 'lab'
await ctx.lab.collect(unit.id, { source: '/workspace/out', target: '/host/archive/out', kind: 'archive' })
await ctx.lab.archive(unit.id, { target: '/host/archive/unit' })   // workspace/ + manifest.json (sha256 per file)
await ctx.lab.release(unit.id)                // gated by mission.isReleasable; force + warning without a gate
const units = await ctx.lab.status()          // reconciled against the docker daemon
ctx.lab.fingerprintOf(components)             // pure: the same hashing rule, over any component set
```

`ownWorkdir` exists for non-root units: `docker run --workdir X` creates a missing X as `root:root`, so a unit that declares a `user` — or an image that ships a non-root `USER`, as the evaluation image does — cannot write the directory its whole working life happens in. `populate` still succeeds (the daemon copies as root) and the FIRST write from inside the unit fails, which is the worst possible place to find out. With the flag, `acquire` creates the workdir as root and `chown`s it to the unit's own uid:gid — asked of the unit itself, so an image's own `USER` is served as well as an explicit `user`; where the daemon refuses `--user 0` (userns-remap) it falls back to a plain create, the behavior before the option existed. It is **not** a fingerprint component: the component shape never varies, and who owns a directory the unit was going to be handed anyway does not make two otherwise identical environments incomparable.

One thing at the same layer: `acquire` now also makes `/run/dsh-lab` itself `1777` (previously only `/run/dsh-lab/pids`). `verify` creates its material directory under it as the UNIT's user, and a root-owned `0755` parent made every verify-with-material call fail at `mkdir` on a non-root unit — i.e. exactly the units this project runs.

`fingerprintOf` is the hashing function `acquire` itself uses, exposed because a caller sometimes needs to ask what a DIFFERENT component set would hash to. The evaluation orchestrator is that case: comparing cells needs "the same environment the plan declared", not "the same unit", and those differ by exactly the components each condition contributes (its own credential mount, its own env variable). It takes the unit's components, drops those, and asks for the hash of what is left. Doing that arithmetic here rather than re-implementing the canonicalization keeps one hashing rule in the repository — a second copy would drift the first time a component is added. Pure: no unit, no provider, no daemon.

The mission integration is a probed structural face (`setRefs` / `addArtifact` / `addCheckpoint` / `annotate` / `isReleasable`), never an import: with `@khorsheed/dsh-mission` absent, registration writes warn-and-skip and `release` degrades to `force` + warning. A mission binding registered at acquire survives host restarts (it rides the container labels), so the gate still protects reconciled units.

## CLI

`dsh-lab <verb>` (or `node lib/cli.js`); data on stdout (JSON where the verb produces a value), diagnostics on stderr. Exit codes: `0` ok, `1` failure/refused, `2` usage.

```sh
dsh-lab acquire --image IMG [--mission ID] [--run ID] [--mount SRC:DST[:ro]]... [--volume NAME:DST[:ro]]...
                [--env K=V]... [--cpus N] [--memory SIZE] [--network NET] [--user UID[:GID]]
                [--workdir DIR] [--command JSON]
dsh-lab populate UNIT --source DIR [--target DIR] [--manifest FILE] [--artifact-path P]
dsh-lab collect UNIT --source DIR --target DIR [--kind K] [--artifact-path P]
dsh-lab checkpoint UNIT --name NAME
dsh-lab verify UNIT [--source DIR] [--timeout-ms MS] -- CMD [ARGS...]
dsh-lab archive UNIT --target DIR [--kind K] [--artifact-path P]
dsh-lab release UNIT [--force]
dsh-lab status [UNIT] [--json]
dsh-lab fingerprint UNIT | --image IMG [the same spec flags acquire takes]
```

Global: `--max-concurrent N`, `--state-dir DIR`. Mounts take two flags rather than guessing from the shape of `source`: `--mount` is a host directory, `--volume` a volume name — docker's `-v` decides bind-vs-volume by whether the source looks like a path, and a relative path silently becoming a volume is not a behavior worth inheriting.

Bare `dsh-lab status` prints the progress table — one row per unit joining container facts (up-time), in-container activity (workspace mtime), the mission state and coordinate labels (via the mission face, absent-tolerant), the materialization hash, and the environment fingerprint:

```text
UNIT      MISSION           CONTAINER   LAST-ACTIVITY  TASK      ENV       LABELS
u-a3f9    cell-1:working    up 2h14m    3m ago         9f2c1a2b  4d1e77b0  task=F1,subject=A
u-b71c    cell-2:collected  up 2h14m    47m ago        9f2c1a2b  4d1e77b0  task=F1,subject=B
```

Identical TASK hashes across rows are the fairness proof at a glance and identical ENV hashes the comparability proof; a long `LAST-ACTIVITY` gap on a `working` row is the stuck-cell signal. `--json` emits the structured rows instead (with the full `fingerprintComponents`).

`fingerprint` answers two questions: what IS this held unit's environment (pass a UNIT), and what WOULD this spec's environment be (pass the acquire-shaped flags — it acquires nothing). Diff two of those and you know which component differs:

```sh
$ dsh-lab fingerprint --image eval-env:latest --cpus 2 --memory 4g | jq -c '{fingerprint, r: .components.resources}'
{"fingerprint":"lab-env:4d1e77b0…","r":{"cpus":"2","memory":"4294967296"}}
$ dsh-lab fingerprint --image eval-env:latest --cpus 2 --memory 8g | jq -c '{fingerprint, r: .components.resources}'
{"fingerprint":"lab-env:0a93c62f…","r":{"cpus":"2","memory":"8589934592"}}
```

The CLI is the same `LabService` kernel over a `child_process` runner, with the mission face adapted to the `dsh-mission` bin: `release` gates on `dsh-mission is-releasable`'s 0/1 exit code (any other exit fails closed), and refs / artifacts / checkpoints / annotations register through the mission bin's verbs (`set-refs` / `add-artifact` / `add-checkpoint` / `annotate`). Without the bin on PATH, registration warns and skips, and `release` needs `--force`.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ — the service face and docker provider work on the published host. minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master, fork or upstream): ✅ — same (verifiedHost: 0.1.2-rc.1).

Degraded / absent items (mirrors `dsh.compat` in package.json): without the `@khorsheed/dsh-mission` plugin the release gate degrades to an explicit force flag plus a warning, and ref/artifact/checkpoint/verify registration is skipped with a warning. The `lab_*` model tools (M3) do not exist in this line yet.

## Failure recovery loop

A crashed cell loses nothing and re-runs alone. The loop (the orchestrator drives it; each step is one existing verb):

1. `collect` whatever output already exists (partial is the norm);
2. `archive` the unit — the crash scene (half-finished work, crash output, checkpoints) is the most valuable data in the run; releasing without it destroys evidence;
3. the orchestrator writes what the template's failure gate expects (e.g. a crash dump) into the attempt's run-data directory and `attest`s the teardown key;
4. the transition into the failed state passes its `file-check` — the failure path gets **no gate exception**: entering a releasable state carries the archive check just like the success path (express attested-plus-file-check as a state chain like `working → archived-failed → failed`, not a new guard combinator);
5. `release` destroys the unit; `mission_retry` opens a fresh attempt for that one cell (the old attempt stays immutable), and a new unit is acquired for it.

The integration suite runs this loop end to end (`scripts/integration-triad.spec.ts`, failure-path block).

## Known Limitations and Deferred Work

- **`populate` copies; mounts are declared at acquire** — docker cannot add mounts to a created container, so the zero-copy read-only path is `acquire`'s `mounts`, and `populate` materializes a copy into the unit's writable layer (that is what "into the unit" means once it runs).
- **The worktree provider is interface-shaped but unshipped** — the `UnitProvider` interface admits it; it lands when a real need appears. When it does: a worktree unit is an order of magnitude weaker isolation (shared filesystem, no network or resource limits) and must never serve experiments that need comparability.
- **Orphan compensation covers lab's own execs only** — pidfiles under `/run/dsh-lab/pids/` track processes the provider spawned; a foreign `docker exec` into the unit is invisible to the sweep (container removal still reaps everything at release).
- **The docker image must ship `sleep` and `sh`** — distroless images need a custom `command` and lose the pidfile wrapper; `checkpoint` additionally needs `git` inside the unit.
- **A checkpoint needs a writable workspace** — the workspace is auto-initialized as a git repo on first checkpoint; a workspace that is a read-only mount cannot be committed and fails loud (checkpoint a populated directory instead).
- **M3 scope** — the `lab_*` model tools are designed in the proposal and deliberately absent here.
- **The fingerprint records declarations, not measurements** — the `resources` component is the ceiling `acquire` declared and applied, not a value read back from the daemon afterwards; the image's own baked-in `ENV`, and host differences outside the cgroup (kernel, CPU model, network policy), are not components. It catches "the configuration changed mid-run", not "these two machines are identical".
- **The component set can widen without moving old fingerprints** — an undeclared component contributes nothing to the hash, so a new component shifts the fingerprint only of units that declare it. The cost is that "declared no network" and "the network component did not exist yet" are indistinguishable in the fingerprint: a `network: null` unit is on docker's default bridge because nobody addressed its networking, not because anyone confirmed that is where it belongs. Asserting isolation requires declaring it.
- **`lastActivityAt` needs GNU `stat` or busybox `date -r` in the image** — the workspace-mtime probe degrades to "no reading" on images with neither (the row shows `-`); the CPU fact needs cgroup `cpu.stat` (v2) or `cpuacct.usage` (v1).
- **CLI-mode registration goes through the mission bin** — it requires `dsh-mission` on PATH and covers exactly its verb set (set-refs / add-artifact / add-checkpoint / annotate / is-releasable / get); anything richer belongs to the in-host service face.
