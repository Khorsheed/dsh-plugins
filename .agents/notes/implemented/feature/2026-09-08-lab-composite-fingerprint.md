# Agent Note: lab — composite environment fingerprint

Status: implemented

English | [中文](2026-09-08-lab-composite-fingerprint.zh.md)

## Problem

An evaluation report licenses a comparison between cells only when it can show they ran in the same environment, and the mechanism it reads is `refs.fingerprint`. lab's fingerprint was the image's repo digest and nothing else. Two units off one image with different CPU or memory ceilings, with one extra mounted volume, or with a different set of injected environment variables produced the *same* fingerprint — the report would have licensed a comparison between measurements that are not comparable, and a timing-sensitive one especially so. Pilot A's report refused to compare at all for lack of any fingerprint; the first in-container report is meant to be released by this one, so it has to be honest before it is used.

The web-eval architecture had already defined what the fingerprint should be — image digest, CPU and memory ceilings, mount layout, injected env key names — and lab had not implemented it. A second gap sat underneath: `AcquireSpec` had no way to declare a resource ceiling at all, so the component the architecture named could not have been hashed even in principle.

## Decision

**The fingerprint is sha256 over a canonical JSON of four components, carried as `lab-env:<hex>`.** `DockerProvider.fingerprint(spec)` returns `EnvironmentFingerprint` — `{ fingerprint, components }` — instead of a bare string, and `acquire` takes that object. The components are:

| Component | Content | Deliberately excluded |
|---|---|---|
| `image` | the resolved repo digest (image id fallback; pulls when absent locally) | — |
| `resources` | `--cpus` and `--memory`, normalized (`4g`, `4096m` and `4294967296` are one ceiling; `2`, `2.0` and `2.00` are one count) | — |
| `mounts` | each mount's in-container path, type, and read-only bit, sorted by that path | the host `source`; declaration order |
| `envKeys` | injected variable names, sorted | the values |

Two exclusions carry the weight. **Host paths never enter**, because the same materialized input lands at a different host path on a different machine and in a different run — including them would split units that are in fact identical, which is the same dishonesty in the opposite direction. **Env values never enter**, because a value is a credential or a per-cell coordinate, not the shape of the environment; the components are printed, labeled, and archived, so a value there would leak.

The component shape is fixed: an undeclared ceiling is `null`, not a missing key, and an undeclared list is empty. `components.version` is part of the hash, so a later widening of the definition necessarily shifts every fingerprint — correct, because units judged identical under the narrow definition may not be under the wider one. (Superseded: [network, volume mounts and user](2026-09-09-lab-network-volume-user.md) replaced this with an undeclared-is-absent rule, so a wider definition moves only the fingerprints of units that declare the new component.)

**`AcquireSpec.resources` is applied, not merely hashed.** `acquire` passes `--cpus` / `--memory` to `docker run` from the same normalized values it hashed. A fingerprint that claimed a ceiling the container did not carry would be a new lie replacing the old one. A ceiling that cannot be normalized throws at fingerprint time rather than being hashed as a raw literal.

**The daemon stays the registry of record; the state directory is a mirror.** `acquire` writes the component JSON to a `dsh-lab.fingerprint-components` container label, and reconcile reads it back — so a unit that survives a host restart recovers *why* its fingerprint is what it is, with no host file in the trust path. Alongside that, lab now writes `units/<id>.json` under `stateDir` (`$DSH_HOME/lab`, else `<cwd>/.dsh-lab-state`, config-overridable). That file holds no authority: reconcile re-materializes it when it adopts a unit, `release` deletes it, a write failure warns and skips like mission registration, and deleting the whole directory loses nothing. The durable copy for a released unit is its archive `manifest.json`, which now carries `fingerprintComponents` beside `fingerprint`.

**A legacy bare digest stays a valid fingerprint with no components.** Units acquired before this line carry no components label; they reconcile with `fingerprintComponents` undefined, `fingerprint` reports `components: null` for them, and nothing reinterprets a digest into a component set. An unreadable or hand-edited label degrades the same way rather than crashing a reconcile that is rebuilding the whole registry.

**Two surfaces expose the components.** `dsh-lab status` gains an `ENV` column (short hash) next to `TASK`: identical TASK cells are the fairness proof and identical ENV cells the comparability proof, both visible at a glance across rows. `dsh-lab fingerprint` answers two questions with one verb — with a UNIT it prints a held unit's fingerprint and components; with the acquire-shaped flags it resolves what a spec *would* fingerprint as, acquiring nothing, so two invocations diffed before a run name the component that would make the cells incomparable.

mission is untouched: `refs.fingerprint` remains one opaque string, and the components stay lab-side.

## Alternatives considered

**Keep the bare digest and let the report widen the check.** Rejected: the report would need to read resource limits, mounts and env off each unit and re-derive comparability itself, which puts the definition of "same environment" in the consumer rather than in the plugin that created the environment. One opaque string that is *already* honest is what a consumer can act on.

**Hash raw declared literals instead of normalizing.** Rejected: `4g` and `4096m` are the same ceiling, and a spec generator that emits one form for some cells and the other for the rest would report a false environment difference. Normalization is what makes equal environments hash equally. The cost is that an unparseable literal now throws instead of being hashed opaquely — the right trade, since docker would have rejected it at run time anyway, later and with a worse message.

**Include the host `source` of each mount.** Rejected: it is the single most likely cause of false differences — the same datasets worktree materializes under a different path per run and per machine — and it would put absolute host paths into a value that is labeled, printed and archived.

**Include env values, or a hash of them.** Rejected for values (credentials, and per-cell coordinates that are *supposed* to differ). A hash of values was also rejected: it still splits cells that legitimately differ by `EVAL_CELL`, and the key set is what actually describes the environment's shape.

**No state directory — labels only.** This was the standing position, taken when [the materialization manifest](2026-08-24-lab-materialization-status-view.md) rejected a lab-owned state directory. The brief for this task decided otherwise, and the decision holds only because the mirror was built with no authority: derived from labels, re-materialized on reconcile, removed at release. The earlier note's rationale still stands for anything that would be a *second source of truth* — a manifest still has no home here, and the caller still names those paths.

**Keep the state file after release as a diagnostic archive.** Rejected: it grows without bound and would quietly become the thing people trust. The archive manifest is where a released unit's environment belongs, and it now carries the components.

**Bare `sha256:<hex>` as the fingerprint string.** Rejected: it would be visually indistinguishable from an image id, which is exactly what the legacy fallback emits. The `lab-env:` scheme makes composite and legacy fingerprints tellable apart by eye and by `isComposite`.

## Consequences

- The fingerprint of every unit changes. Nothing in-repo pins a fingerprint string, and `refs.fingerprint` is opaque to mission, so the only visible effect is that pre-existing containers keep their legacy digests and read as "no components".
- `UnitProvider.fingerprint` / `acquire` changed signature (string → `EnvironmentFingerprint`). Acceptable pre-release; the one in-repo implementer besides `DockerProvider` is the integration suite's fake.
- lab now writes a host directory, which the invariant companion's doc comment previously denied. The comment is updated to state the narrower claim it can still defend: no *authoritative* host state.
- The fingerprint pins declarations, not measurements: the image's baked-in `ENV`, the kernel, the CPU model, and network policy are outside the components. It catches configuration drift within a run, not machine equivalence — recorded as a README limitation so a report does not over-read it.
- Resource ceilings are now applicable from lab (`resources`, `--cpus`, `--memory`), which the architecture's I3 row needed independently of the fingerprint.

## Testing

Package (100 tests green). Pure layer (`tests/fingerprint.spec.ts`): unit normalization in both directions and its refusals, key-order-insensitive canonical JSON, fixed component shape, scheme detection, short-form rendering, and label parsing that degrades rather than throws. Provider layer (`tests/docker.spec.ts`): the three behaviors the brief named — same image under different ceilings fingerprints differently, mount order does not matter, differing env values with identical keys fingerprint identically — plus differing env keys, unit-equivalent ceilings, host-path independence, extra/moved/writable mounts, a scan proving no host path and no env value reaches the serialized components, ceilings actually reaching `docker run`, and the components label. Service layer: mirror written at acquire and removed at release, re-materialized for a unit adopted after a restart, warn-and-skip on an unwritable mirror, legacy and garbled labels accepted as "no components", and the archive manifest carrying components (or `null`). CLI: `fingerprint` in both modes, the `ENV` column, and ceilings on the wire.

## Cross-references

- [lab M1](2026-08-20-lab-m1.md) · [M2 verbs](2026-08-20-lab-m2-verbs.md) · [M2 CLI](2026-08-20-lab-m2-cli.md)
- [materialization manifest and status view](2026-08-24-lab-materialization-status-view.md) — the no-state-directory position this note qualifies
