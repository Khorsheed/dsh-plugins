# dsh-lab

English | [中文](README.zh.md)

Controlled experiment units for the dsh ecosystem: an **experiment unit** is one isolated, condition-consistent, reproducible execution environment, and this plugin manages its lifecycle — acquire / populate / collect / release / status. It serves any workload shaped as *a batch of subjects × a batch of cases × identical isolated environments × comparable results* (evaluation runs, A/B config tests, cross-version regression, batch data-processing validation).

Three red lines define the character of the plugin:

1. **It records, never judges.** lab runs and registers facts (resource ids, environment fingerprints, artifacts); "passed?", "how good?" belong to whoever consumes the records.
2. **`release` is the gate's enforcement point.** When the unit is bound to a mission and the `@khorsheed/dsh-mission` plugin is present, `isReleasable` must pass — a failed query fails closed, and no option bypasses the check. Without a gate (no mission binding, or the plugin absent), release requires an explicit `force` and warns.
3. **It never fires work.** lab provides verbs; when to call them belongs to the human / agent / external orchestrator.

Milestones M1–M2 ship the service face (`ctx.lab`) and the `dsh-lab` CLI over the same kernel, with the docker provider: acquire / populate / collect / checkpoint / verify / archive / release / status, environment fingerprints, orphan-process compensation, and the `maxConcurrentUnits` safety valve. The model tools are M3.

## How it works

- **Unit** — one labeled container (`dsh-lab-<id>`). The docker daemon is the registry of record: unit id, fingerprint, and mission binding ride resource labels, so `status` / `release` reconcile and survive a host restart — lab keeps no state files of its own.
- **Environment fingerprint** — `acquire` resolves the image's repo digest (falling back to the image id, pulling when absent locally) and writes it into the mission's refs together with the resource id. Environments differ → results aren't comparable; this is a mechanism, not a convention.
- **Inputs** — two paths: declare `mounts` at acquire for a zero-copy read-only bind mount (container mounts cannot be added after creation), or `populate` a host directory into the running unit (a copy into the unit's writable layer). A directory path is the whole interface — a datasets `worktree_path` product or any caller-supplied path; lab has no code-level datasets dependency, and layer allowlists are enforced on the side that produced the path.
- **Orphan-process compensation** — every in-container command lab spawns goes through a wrapper that records its own pid under `/run/dsh-lab/pids/`; `release` first sweeps those pids with SIGTERM inside the container, then removes the container. Coverage is the provider's own exec path — processes others exec into the unit are out of lab's reach.
- **`maxConcurrentUnits`** — a plain ceiling (config, default 4): `acquire` refuses at the limit with an explicit error. lab doesn't know which phases may overlap (that's the caller's semantics); one number blocks accidental concurrency, which silently corrupts timing-sensitive measurements.
- **Checkpoint** — commit the workspace (auto-initialized as a git repo on first checkpoint) and tag it; the commit sha goes into the mission's checkpoint `ref`. A read-only mounted workspace fails loud — it cannot be committed, which is the correct signal.
- **Verify** — optionally copy verification material into a scratch dir, run the command in the workspace, remove the material, and record the outcome *verbatim* (exit code, stdout, stderr, duration, timeout fact) into the mission's `lab` annotation namespace. There is no pass/fail branch anywhere in the code path.
- **Archive** — export the workspace into a host directory plus a `manifest.json` (per-file sha256 + size, unit facts, fingerprint), registered as a mission artifact.

## Install and load

The package's single identity is **`@khorsheed/dsh-lab`**, developed in the `dsh-plugins` monorepo and published to npm from there:

```sh
npm install @deepseek-ai/dsh                            # the host (dsh web / dsh CLI)
dsh plugin --profile web add @khorsheed/dsh-lab         # this plugin
```

The package declares `dsh.bundle`, so the add reconciles its `cordis.patch.yml` row (a bare `lab` mount) into the profile's bundles layer — no hand-edited cordis.yml. A composition may mount the `lab` row id only once; check with `dsh --profile web --dump-config | grep lab` before adding to a composition that might already mount it. From source: clone the monorepo; the package lives at `packages/lab` (`pnpm install && pnpm run build`).

Config (all optional): `maxConcurrentUnits` — the held-unit ceiling (default 4).

Requirements: the docker CLI reachable from the host, and images that ship `sleep` and `sh` (the keep-alive command and the pid-recording wrapper).

## Service face

Other plugins and scripts consume `ctx.get('lab')` (typed as `ctx.lab`):

```ts
const unit = await ctx.lab.acquire({
  image: 'eval-env:latest',
  missionId: 'F1-a-r1',                       // optional mission binding
  mounts: [{ source: worktreePath, target: '/input', readonly: true }],
})
await ctx.lab.populate(unit.id, { source: '/path/to/layer', target: '/workspace' })
const { ref } = await ctx.lab.checkpoint(unit.id, { name: 'iter-1' })
const outcome = await ctx.lab.verify(unit.id, { command: ['npm', 'test'], source: '/path/to/checks', timeoutMs: 300_000 })
// outcome = { exitCode, stdout, stderr, durationMs, timedOut } — verbatim; also annotated into mission ns 'lab'
await ctx.lab.collect(unit.id, { source: '/workspace/out', target: '/host/archive/out', kind: 'archive' })
await ctx.lab.archive(unit.id, { target: '/host/archive/unit' })   // workspace/ + manifest.json (sha256 per file)
await ctx.lab.release(unit.id)                // gated by mission.isReleasable; force + warning without a gate
const units = await ctx.lab.status()          // reconciled against the docker daemon
```

The mission integration is a probed structural face (`setRefs` / `addArtifact` / `addCheckpoint` / `annotate` / `isReleasable`), never an import: with `@khorsheed/dsh-mission` absent, registration writes warn-and-skip and `release` degrades to `force` + warning. A mission binding registered at acquire survives host restarts (it rides the container labels), so the gate still protects reconciled units.

## CLI

`dsh-lab <verb>` (or `node lib/cli.js`); data on stdout (JSON where the verb produces a value), diagnostics on stderr. Exit codes: `0` ok, `1` failure/refused, `2` usage.

```sh
dsh-lab acquire --image IMG [--mission ID] [--run ID] [--mount SRC:DST[:ro]]... [--env K=V]... [--workdir DIR] [--command JSON]
dsh-lab populate UNIT --source DIR [--target DIR]
dsh-lab collect UNIT --source DIR --target DIR [--kind K]
dsh-lab checkpoint UNIT --name NAME
dsh-lab verify UNIT [--source DIR] [--timeout-ms MS] -- CMD [ARGS...]
dsh-lab archive UNIT --target DIR [--kind K]
dsh-lab release UNIT [--force]
dsh-lab status [UNIT]
```

The CLI is the same `LabService` kernel over a `child_process` runner, with the mission face adapted to the `dsh-mission` bin: `release` gates on `dsh-mission is-releasable`'s 0/1 exit code (any other exit fails closed), and refs / artifacts / checkpoints / annotations register through the mission bin's verbs (`set-refs` / `add-artifact` / `add-checkpoint` / `annotate`). Without the bin on PATH, registration warns and skips, and `release` needs `--force`.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.6+`): ✅ — the service face and docker provider work on the published host.
- source line (deepseek-harness master, fork or upstream): ✅ — same.

Degraded / absent items (mirrors `dsh.compat` in package.json): without the `@khorsheed/dsh-mission` plugin the release gate degrades to an explicit force flag plus a warning, and ref/artifact/checkpoint/verify registration is skipped with a warning. The `lab_*` model tools (M3) do not exist in this line yet.

## Known Limitations and Deferred Work

- **`populate` copies; mounts are declared at acquire** — docker cannot add mounts to a created container, so the zero-copy read-only path is `acquire`'s `mounts`, and `populate` materializes a copy into the unit's writable layer (that is what "into the unit" means once it runs).
- **The worktree provider is interface-shaped but unshipped** — the `UnitProvider` interface admits it; it lands when a real need appears. When it does: a worktree unit is an order of magnitude weaker isolation (shared filesystem, no network or resource limits) and must never serve experiments that need comparability.
- **Orphan compensation covers lab's own execs only** — pidfiles under `/run/dsh-lab/pids/` track processes the provider spawned; a foreign `docker exec` into the unit is invisible to the sweep (container removal still reaps everything at release).
- **The docker image must ship `sleep` and `sh`** — distroless images need a custom `command` and lose the pidfile wrapper; `checkpoint` additionally needs `git` inside the unit.
- **A checkpoint needs a writable workspace** — the workspace is auto-initialized as a git repo on first checkpoint; a workspace that is a read-only mount cannot be committed and fails loud (checkpoint a populated directory instead).
- **M3 scope** — the `lab_*` model tools are designed in the proposal and deliberately absent here.
- **CLI-mode registration goes through the mission bin** — it requires `dsh-mission` on PATH and covers exactly its verb set (set-refs / add-artifact / add-checkpoint / annotate / is-releasable); anything richer belongs to the in-host service face.
