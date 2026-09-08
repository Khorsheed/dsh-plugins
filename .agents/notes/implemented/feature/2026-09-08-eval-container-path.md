# Agent Note: the eval run loop drives one lab unit per cell

Status: implemented

English | [中文](2026-09-08-eval-container-path.zh.md)

## Problem

The evaluation run loop was still "stages one and two, host directories": each cell got a directory under `$DSH_HOME/state/eval`, the item was materialized file by file with the orchestrator computing its own manifest, the delegation carried a `cwd`, probes were `execFile`d on the host, and archiving was a `cpSync`. Every isolation claim the comparison rests on — the sealed network, the pinned image, the per-harness credential boundary, the resource ceiling — existed only in the environment layer nobody was running against.

The three I3 prerequisites had landed: a delegation can name a container (`exec: {container, workdir, env}`, T17), a unit can be acquired with a network, a user, ceilings and mounts that all enter one composite fingerprint (T18b), and the probe runner materializes both verify layers with a tri-state exit code (T28). What was missing was the orchestration that puts them in one order.

One consequence was measurable rather than theoretical: the second of the architecture's four invariants, «环境一致», read `unverifiable` for the whole of pilot A, because `refs.fingerprint` had no writer.

## Decision

- **The switch is in the data, not in a flag.** A `dataseek.plan/1` gains an optional `unit` segment (`image`, and optionally `network` / `user` / `resources`). Present, every cell of the run executes inside one lab unit; absent, the run takes the host path, byte for byte what it was. A `dataseek.condition/1` gains an optional `unit.scopedHome` (`container`, `var`) — where that subject's credential directory is mounted and which variable names it — and `var` must also appear in `env.keys`, so the name that gets injected is a name the reviewed document admits to injecting. Contract revision v1-rev6.
- **The host side of the credentials is an operator fact, not a reviewed one.** The plan and the condition never carry a host path; the run is given `--creds-root DIR` and takes `<DIR>/<condition id>`, so the same pair of data files runs on another machine unchanged. The orchestrator checks that the directory exists, is non-empty, and is owned either by the unit's uid or by its own — and never opens a file inside it. The two acceptable owners are one rule, not a platform switch: a Linux host passes uids through, Docker Desktop remaps a bind mount to the container user, and any third uid is the case where the unit cannot read (or write back to) its own credentials.
- **One unit per cell, in the order the trajectory table has declared since step 11.** acquire (one mount, one env entry, mission + run ids) → populate (host materialization directory → `/workspace`, lab writing the manifest) → per stage: one delegation round with the exec target and no `cwd`, then `checkpoint(name: stage id)`, then `collect` back to the host mirror → probes through `lab.verify` → archive → release.
- **`refs.fingerprint` is written by the orchestrator, immediately after acquire.** lab writes the same two refs itself, but that registration is warn-and-skip by design, and an invariant may not rest on a write that is allowed to skip.
- **Where a probe runs is one interface with two implementations.** `ProbeExecutor` has `run` / `collect` / `outFile` / `discard`; the host executor is the old `execFile` path unchanged, the unit executor hands the judging directory to `lab.verify` as its material and points the probe at `/workspace`. The three exit states, the verdict contract and the backfill-before-validation order are shared code, because the thing being compared across the two paths must not be the judging.
- **Judging output stays out of the workspace.** `--out` goes to `/run/dsh-lab/verdicts/<probe>/`, and one `collect` after the last probe brings the whole tree back to the attempt's run data. The archive is the player's work; a verdict tree inside it would be in every bundle forever.
- **One destroy path, and it runs while the gate says yes.** `run.ts` holds a single `destroyUnit` and `lab.release` appears nowhere else. With `--finalize` the unit is destroyed between `archived → releasable` and `releasable → released`: `isReleasable` reads the CURRENT state against the template's `releasableStates`, which is `['releasable']` alone, so destroying after `released` would ask the gate a question it answers no to and every container would survive. A refused gate — no `--finalize`, or an empty `verdicts/` — still asks, is still refused, and the container STAYS with `{kind: 'unit-retained', reason}` on the cell. The failure path does `collect` → `archive` → the same gate, because releasing without archiving destroys the crash scene.
- **`force` appears exactly once**: the readiness probe unit. The pre-run check moved INTO a unit built from the same spec the cells get, because a credential that answers "authenticated" on the host proves nothing about one bind-mounted into a sealed container — that is pilot A's G4 one level up. That unit is bound to no mission and therefore has no gate; lab requires an explicit `force` for such a destroy precisely so a gate-less destroy is a sentence rather than a default.
- **Serial.** The container path pins `concurrency: 1` and refuses an explicit `>1` rather than silently overriding it; an `acquire` that hits `maxConcurrentUnits` is a defect to report, not a queue to join. Parallel units are I4.
- **Three changes in lab, all of them things the container path could not run without.** One addition: `AcquireSpec.ownWorkdir`, because `docker run --workdir X` creates a missing X as `root:root` and a unit declaring a non-root `user` then cannot write the directory its whole working life happens in — `populate` still succeeds (the daemon copies as root) and the FIRST write from inside fails. Two fixes: `acquire` now makes the scratch ROOT `/run/dsh-lab` world-writable and not only `/run/dsh-lab/pids`, without which `verify` on a non-root unit fails at its own `mkdir`; and `verify` hands its copied material to the unit's user, without which its own `rm -rf` fails file by file and the answer key stays in the unit until it is destroyed. Neither fix changes a verb's semantics — they are what makes the documented behavior actually happen on the units this project runs.

## Real-machine verification

A real docker daemon, the real `LabService` / `DockerProvider` / `MissionService` / datasets service, the real dataset repository at `i3-probes`, the frozen T16 image (`eval-env:pinned`, `sha256:ed988b33…`) on `eval-net` as user `1000` with `cpus: 2, memory: 4g`. Two runs of P0-placeholder × one codex-shaped condition, each one cell:

| | run 1 (no `--finalize`) | run 2 (`--finalize`) |
|---|---|---|
| readiness | probe unit acquired, released with `force` | same |
| unit | `dsh-lab-19da99b0`, `lab-env:5787bf0707fd…` | `dsh-lab-4f8fd1e0`, the same fingerprint |
| stages | 2 rounds, both addressed at the unit (`workdir /workspace`, `cwd` absent), checkpointed `aec844e32cfe` / `0aaa9e255872` | `5489091a1523` / `29e97e451a71` |
| probes | `shared/helpers/probes/no-patch.sh`, `where: unit`, exit 0, `judged`, 1 verdict | same, 1 verdict |
| gate | `archived`; release REFUSED (`not in a releasable state`); container alive; `unit-retained` recorded | `releasable` → released; container gone |
| `lab status` | `taskHash 1c9767b3`, equal to the mission manifest's `sha` | — |

The archive holds `workspace/` + `verdicts/script.json` + `manifest.json`; `probe-verdicts/` sits beside it in the attempt's run data; the retained container's `/run/dsh-lab` holds nothing but `pids/`, and its `/workspace` holds the player's outputs and the materialized item, with no manifest and no verdicts. `dsh-eval report` on the released bundle prints **题面一致 ✅ / 环境一致 ✅ / 受试对象一致 ⚠️ / 程序一致 ✅** — the second of those was `unverifiable` for all of pilot A, and this is the first run in which it holds.

The host path was recomputed rather than assumed: `dsh-eval report` on pilot A's bundle produces a byte-identical `results.jsonl` on this branch, and its `summary.md` differs only in the bundle path, the timestamp, and one section T24 added after that summary was written.

The one thing this driver did NOT run is a real CLI round inside the unit: the delegation face wrote each stage's outputs from inside the container (`docker exec`) instead of spawning codex there. That transport is T17's measured seam against this same image, and the change here is which option the round carries — pinned at the argument level by tests. No credential was staged for this run: the mounted directory held a placeholder, because a run that never reaches the CLI has no business holding a real one.

## Alternatives considered

**Let lab's own artifact registration carry the fingerprint.** Rejected: `registerRefs` warns and skips on failure, by design, and the whole point of this task was an invariant that stopped being blank. The orchestrator writes it and lab writing it again is harmless.

**Have the orchestrator compute its own materialization manifest on the container path too, as it does on the host.** Rejected: `populate` already hashes the tree it copies, and two files called `materialization.json` carrying two different hashes is worse than either alone. The cost is real and is recorded: the two paths hash differently (`path\0sha\0` vs `path  sha`), so their numbers are comparable within a run and not across paths. The invariant only ever asks the within-run question, and the report reads both field names.

**Register the mid-stage `collect` as a workspace artifact.** Rejected: mission's export copies the whole attempt data directory, so a registered workspace would put a second copy of every cell's workspace in every bundle, beside the archive that already holds one. A one-line `workspace-mirror.json` is the artifact instead, and it says where the mirror lives — which is what a human debugging a cell actually wants.

**Collect each probe's verdicts as they are produced.** Rejected: one registered artifact per probe, and `lab.collect` registers unconditionally. Running every probe and then collecting once costs one extra pass over an in-memory list.

**Destroy the unit after the cell reaches `released`.** Rejected on measurement: `isReleasable` reads the current state and `releasableStates` is `['releasable']`, so every container would have survived every run. The destroy sits between the two transitions.

**Refuse a container run without `--finalize`.** Rejected: stopping at `archived` is a legitimate thing to want, and refusing it would make the "look at it before releasing it" workflow impossible. The run says out loud, before it starts, that every cell's unit will survive.

**Declare the workspace as a bind mount instead of populating into it.** Rejected: mounts are declared at acquire and enter the fingerprint, and a host-owned workspace would put the orchestrator's filesystem inside the unit. `populate` into the writable layer is what the architecture's step 12 says, and it is also what makes the materialization manifest evidence rather than a description.

**Give lab a `keep` list on `verify` so its cleanup would spare the verdicts directory.** Not needed: lab's cleanup only removes `/run/dsh-lab/verify`, and the verdicts live in a sibling. The option would have been an answer to a question nobody asked.

## Consequences

- The four invariants are down to one that this loop cannot establish on its own: «受试对象一致» still needs a model read-back, which is the provider's.
- **A multi-harness run does not share one fingerprint.** The composite fingerprint includes env key NAMES, and each harness names a different scoped-home variable, so four harnesses in one run make «环境一致» read `violated` under the existing rule. That is honest — the four environments genuinely differ — but it means the invariant as written cannot hold for the comparison this whole profile exists to run. Resolving it is a fingerprint-component or report-side decision, and it belongs to I4 rather than to a quiet change here.
- A failed cell keeps its container until a human looks at it. That is the intended trade of a single destroy path, and it interacts with `maxConcurrentUnits`: a run that fails repeatedly will hit the ceiling, which is reported as a defect rather than queued.
- Adding `unit` to an existing condition changes its hash and stales its lock — a re-provision, not an edit.
- lab's `verify` now hands its material to the unit's user, so a probe can write beside itself. Nothing relies on that; it is a consequence of making the cleanup work.
