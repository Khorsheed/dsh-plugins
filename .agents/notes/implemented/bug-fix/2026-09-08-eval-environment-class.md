# Agent Note: the environment invariant compares a class, the judging directory mirrors the repository, and one materialization hash serves both paths

Status: implemented

English | [中文](2026-09-08-eval-environment-class.zh.md)

## Problem

T20 gave `refs.fingerprint` the unit's composite lab fingerprint, and «环境一致» went from `unverifiable` to `ok` on a one-condition run. On the run the whole profile exists for it goes straight to `violated`.

The composite fingerprint includes the mount layout and the injected env key NAMES, and on the container path each condition mounts its own credential directory at its own in-container path under its own variable — `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `KIMI_CODE_HOME`, `DSH_HOME`. Four harnesses in one run therefore produce four fingerprints, the invariant reads `violated`, and the report refuses to compare anything. The four environments are the same image, the same ceilings, the same network, the same user; the only differences are the ones that make each subject itself.

Two smaller facts came with it. T19c found that a register-layout item's judging directory gains a `verify/` segment that does not exist in the repository (`items/P0/verify/checks/probes/x.mjs` for a file that lives at `items/P0/checks/probes/x.mjs`), so a probe's relative path to the dataset-level library lands one level short and the item has to carry a copy of it — every register-layout item will hit this. And T20's container path recorded lab's populate manifest as its materialization hash while the host path recorded the orchestrator's own, so «题面一致» could only ever be answered within one path.

## Decision

- **The invariant compares the environment the PLAN declared.** `refs.fingerprint` carries an environment CLASS: the unit's components minus the ones that condition contributed — its scoped-home mount target, the variable naming it, that harness's extras (dsh's `NODE_OPTIONS`), and the keys the condition declares in `env.keys`. What remains is image, ceilings, network, user, and the plan-level mounts and env keys. Same-class-different-unit is not a fudge: it is the question the report was always asking.
- **The subtraction is read back off the code that built the spec.** `conditionOwnedComponents` takes back exactly what `acquireSpecFor` put in, so the set is exact by construction rather than by pattern-matching component names. A condition's declared `env.keys` ride along because a subject's own credentials are part of the subject, not of the environment.
- **The hashing rule is not re-implemented.** lab's service face gains one pure verb, `fingerprintOf(components)` — literally the function `acquire` hashes with — and eval derives the class through it. A second copy of the canonicalization would drift the first time a component is added, and the derived class has to be comparable with a unit's own fingerprint by construction, not by coincidence. The label stays `lab-env:<sha256>` and the component `version` does not move: one algorithm over a smaller set.
- **The unit's own fingerprint stays recorded, and the report prints it.** It goes on the cell's `unit` annotation together with the excluded components, and lab's archive manifest carries it as before. Under the invariant line the report lists every cell's unit fingerprint and exactly which mount targets and env NAMES its class left out (never a value), so "same class, different units" is a thing the reader can see rather than take on faith. It does NOT go into refs: mission's refs carry `resource` / `fingerprint` / `sessions`, and a fourth key is a mission change this task does not own.
- **The judging directory reproduces the repository's real relative paths.** An item's layer file lands at `items/<id>/<layer>/<display>` when it follows the convention and at `items/<id>/<display>` when the descriptor re-homed it, which is what the display path already means in each case. Which is which is read from the `register` entries of the descriptor `datasets.show` already returns — optional on the face, so a facade that reports none degrades to the convention layout. A probe's `by` stays the display path: that names the verdict's origin, not a location.
- **A probe's cwd is the directory holding that item's checklist.** `items/<id>/verify` by convention, `items/<id>/checks` once re-homed — so the shared probe's `./checklist.yml` finds this item's own under either layout, which is what "cwd is the item's verify root" always meant. An item with no checklist falls back to the convention root.
- **One materialization hash, both paths.** `materialization.json` is the orchestrator's, computed identically on the host and in a unit, so the same item at the same commit produces the same number. lab's own hash of what it copied in keeps its claim under its own name in `populate-manifest.json` — it says "what went into the unit is this", which is a different statement, not a second spelling of the same one.

## Real-machine verification

Real docker, the real lab / mission / datasets services, the frozen T16 image on `eval-net` as user `1000`. Four conditions differing ONLY in the scoped home each mounts, one cell each, all four `released`. The report's invariant section, verbatim:

```
- **环境一致（refs.fingerprint 同 run 相同）** — ✅ 成立
  - 4 格指纹一致: lab-env:dcca…
  - 每格的单元指纹（含条件自有项，因而各不相同）与被排除的条件项：
  -   …claude-unit-rep1: lab-env:46c8df90eb84… — 排除 挂载 /creds/claude、env CLAUDE_CONFIG_DIR
  -   …codex-unit-rep1:  lab-env:5787bf0707fd… — 排除 挂载 /creds/codex、env CODEX_HOME
  -   …dsh-unit-rep1:    lab-env:b5ae4002ff10… — 排除 挂载 /creds/dsh、env DSH_HOME、env NODE_OPTIONS
  -   …kimi-unit-rep1:   lab-env:229995ada121… — 排除 挂载 /creds/kimi、env KIMI_CODE_HOME
```

Four unit fingerprints, one class, and the difference named. «题面一致» reads `8b38bb4698fa… × 4 格一致`, and a host-path run of the same item at the same commit records `8b38bb4698fa110fdf4054e4c34e59d9c2f22cf7721f2c9c1ea6ed12fcb0f073` — the same number the container cells recorded, which is what the unified algorithm buys.

Pilot A's bundle recomputes to a byte-identical `results.jsonl`; its «环境一致» line is unchanged (`⚠️ 无法核验 · 本 run 无指纹`), because a run with no fingerprints still has none.

The register layout is verified by a fixture item rather than by P0: the same probe, importing the dataset-level library by `../../../../verify/helpers/lib/kit.mjs`, judges successfully under both layouts, and the shared probe reads the register item's checklist from its own `checks/` directory. (Giving P0's probe its library back by deleting the copy is a dataset edit, which belongs to T22.)

## Alternatives considered

**Drop `mounts` and `envKeys` from the composite fingerprint in lab.** Rejected: they are environment facts. A unit with an extra mounted volume or an extra injected variable IS a different environment, and a fingerprint that cannot say so lets a report license a comparison it has no right to. What the evaluation needs is a narrower question asked of the same components, not a blunter fingerprint for everyone.

**Give the class its own hashing rule in eval.** Rejected: two implementations of one canonicalization drift, and the first symptom would be a class that no longer equals the fingerprint of a unit acquired with exactly those components — the property that makes the class meaningful. Hence a pure verb on lab.

**Hash the class with a new `version`.** Rejected: the rules did not change. `version` numbers the hashing rules, not the component inventory (which is what `ADDITIVE_COMPONENTS` is for), and moving it would have moved every fingerprint in the repository for a change that moved no environment.

**Put the unit fingerprint in `refs.unitFingerprint`.** Wanted, and not done: mission's `setRefs` writes three keys and silently ignores anything else, so the write would have been a no-op that looked like a record. The annotation and the archive manifest carry it instead, and the report reads the annotation.

**Detect the register layout by the shape of the display path** (e.g. "a first segment that is not the layer name means re-homed"). Rejected: a convention display's first segment is not the layer name either (`probes/x.mjs`), so the rule would misfile every convention item. The descriptor is on the wire already and says so exactly.

**Materialize the verify layers through `datasets.worktree_path`,** which would give real paths for free (and is what the architecture's step 16 sketches). Deferred: it puts the answer key in the shared, deduplicated, retained worktree store, and the layer's whole discipline is that it does not outlive its use. Reproducing the paths in the throwaway judging directory keeps that property.

**Keep lab's populate hash as `materialization.json` on the container path and teach the report to compare across algorithms.** Rejected: there is nothing to teach — two hashes of the same bytes by two rules are simply not comparable, and the invariant's whole content is a comparison.

## Consequences

- «环境一致» is now answerable for the comparison the profile exists to run, and T22's fifth step is unblocked.
- A run whose cells differ in image, ceilings, network, user, or in a PLAN-level mount or variable still reads `violated` — the class narrows the question, it does not weaken it.
- The container path now writes two records per cell, `materialization.json` and `populate-manifest.json`, and the bundle carries both. They answer different questions and disagreeing is not a failure.
- A dataset whose facade does not report a descriptor keeps the convention layout, which is what every dataset got before; a register item on such a facade is materialized as it was, and its probes still cannot reach the shared library. The fix requires the descriptor, and saying so is better than guessing.
- `registerPatternMatches` is a six-line restatement of the authoring protocol's glob rule inside eval, pinned by a test against the same cases. Community plugins do not import sibling packages, and this is the same trade the JSON-schema subset validator already makes.
