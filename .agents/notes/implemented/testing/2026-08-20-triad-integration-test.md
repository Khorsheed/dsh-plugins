# Agent Note: datasets → lab → mission three-package integration test

Status: implemented

English | [中文](2026-08-20-triad-integration-test.zh.md)

## Problem

The datasets, mission, and lab packages were each delivered (M1) with their own unit tests, but nothing exercised them against each other: the datasets `worktree_path` product consumed by lab's `populate`, lab's `MissionFace` calls landing in a real mission store, and mission's `file-check` guard gating lab's `release` had never run in one chain. Cross-package contracts (the [datasets](../../../proposals/active/2026-08-19-datasets-store.md), [mission](../../../proposals/active/2026-08-19-mission-tasks.md), and [lab](../../../proposals/active/2026-08-19-lab-experiment-units.md) proposals) were only verified package-locally, against fakes.

## Decision

A scripts-level integration pair: `scripts/integration-triad.mts` (the driver — builds fixtures, runs the whole chain, collects per-step evidence) and `scripts/integration-triad.spec.ts` (ten assertions over the evidence). It runs under `pnpm test:scripts` at the repo root, which has no source-plane alias preset — so the driver imports the three packages' service cores by RELATIVE path (`../packages/*/src/…`), whose transitive value imports are all `node:` or relative; no package.json dependency edge is added.

The chain (first half of the evaluation loop, no model): a throwaway git fixture (layers visible/verify/grading, grading `modelFacing:false`) → `snapshot` → `worktree_path(layers:['visible'])`; a bench-style JSON run template `pending → ws-ready → working → collected → archived → releasable → released` with a `file-check` guard (`archive/output.txt`) into `releasable` and `releasableStates: ['releasable']`; lab `acquire` (docker provider driven by a node `child_process` Exec adapter) → assert `refs.resource` + image-digest `fingerprint` landed in mission → `populate` the worktree in → `verify` probes the container sees ONLY the visible layer (sparse-checkout holding end-to-end) and produces `out/output.txt` → `collect` registers the artifact; then the gate: premature `archived → releasable` and premature `release` are BOTH refused (and the container survives), the driver writes the archive file into the attempt's run-data directory (simulating the orchestrator's export), the guard passes, `release` destroys the container, and history/annotations are asserted complete and append-only.

Docker is a soft dependency: `probeDocker()` checks the daemon, pulls `alpine:latest` with a bounded timeout, and falls back to any local image; with neither, the suite skips with a printed reason (CI-safe). Cleanup (`docker rm -f` fallback + temp-tree removal) runs in `afterAll`.

## Alternatives considered

- **Mounting all three plugins on a real cordis `Context` with stub `commands`/`tools`/`subprocess` services** (the form each package's own `apply` test uses) — rejected: the root-level `vitest run scripts` has no harness source-plane aliases, so `@deepseek-ai/cordis` would not resolve from `scripts/` without new root dependencies; and the cordis shell adds nothing to what this test pins — the cross-package contracts under test are the service faces (`createDatasetsService` / `MissionService` / `LabService`), which the packages' own tests already show ARE the cordis-provided instances. Per-package `apply` wiring stays covered by per-package specs.
- **Asserting inline inside the driver** — rejected: it would hide the assertion surface from the test runner and make failures read as driver crashes; the driver/evidence split keeps each step's expectations a named `it`.
- **Skipping the in-container visibility probe and asserting only the host-side worktree tree** — rejected: the proposal's guarantee is that the SPARSE-CHECKOUT mechanism holds along the whole chain into the container; a host-side assertion alone would leave the populate leg unverified.

## Consequences

- The three proposals' cross-package contract points are now pinned by one green run: worktree-path-as-interface, structural `MissionFace` compatibility against the real `MissionService`, fingerprint-in-refs, file-check gating release, and annotation/history audit shape. First-run result: all ten assertions green, no package bug found.
- The lab proposal's implementation record already listed M2's `checkpoint`/`verify`/`archive` as shipped when this test was commissioned under the assumption they were absent; the chain uses `verify` for the in-container probe and output production (which also produces the `lab`-ns annotations the audit step asserts), while the archive file is still written by the driver to keep the `file-check` leg independent of lab M2.
- With no network the alpine pull burns its bounded timeout once per run before the local-image fallback engages; a daemon with `alpine:latest` cached skips that cost.
- The test holds no opinion on the packages' cordis mounting; if a future bug lives in `apply` wiring, per-package specs own it.
- Real-docker smoke for the evaluation chain's SECOND half (submission, schema guards, export) remains open, as does a live-profile smoke.

## Testing

`scripts/integration-triad.spec.ts` (10 tests): snapshot pin and visible-only worktree tree; lint-clean template run creation; refs (resource + `sha256:` fingerprint) written via the service face; in-container visibility (`ls -R` evidence; grading/verify absent); collect round-trip with artifact registration; both premature-gate refusals with the surviving container; guard pass → release → container gone → final state `released`; six-entry history in order with actor/time and no phantom entries from refused attempts; two append-only `lab`-ns verify annotations. Verified green on a live docker daemon 28.1.1 with the `postgres:16-alpine` local fallback image (no network for the alpine pull at verification time).

**Second round (failure paths, 5 tests, the `runTriadFailures` driver, lab ↔ mission only)**: populate against a nonexistent source — fails loud, and the unit stays TRACKED (visible in status, container alive; no silent leak), mission stays at `working` with no phantom history; release is refused in that state. A unit bound to an UNKNOWN mission — acquire's registration warns, release fails CLOSED on the query error, and `force` is not a bypass. The attested-teardown path — `attest teardown-approved` → transition to `failed` (a releasable state) → release destroys the container. Second round green on the same daemon.

## Related

- [datasets M1 Agent Note](../feature/2026-08-19-datasets-store-m1.md), [mission M1 Agent Note](../feature/2026-08-19-mission-m1.md), [lab M1 Agent Note](../feature/2026-08-20-lab-m1.md), [lab M2 verbs Agent Note](../feature/2026-08-20-lab-m2-verbs.md) — the per-package deliveries this chain integrates.
