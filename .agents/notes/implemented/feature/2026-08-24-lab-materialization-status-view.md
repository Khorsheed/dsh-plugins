# Agent Note: lab — materialization manifest, activity facts, progress view, failure loop

Status: implemented

English | [中文](2026-08-24-lab-materialization-status-view.zh.md)

## Problem

Third contact round with the evaluation side, four requirements in priority order: (1) `populate` must return a materialization manifest (per-file hashes + overall hash) registered as a mission artifact — the byte-level proof that parallel units received identical inputs; (2) the failure recovery loop must archive the crash scene BEFORE release, with no gate exception on the failure path; (3) `status` must report in-container activity (workspace mtime primary, container CPU secondary), not lab verb-call timestamps — lab is not invoked while work runs inside the unit, so that reading would be a fake metric; (4) `dsh-lab status` becomes the progress view joining unit + mission state + activity + the materialization hash, depending on mission only, never on datasets.

## Decision

**Materialization manifest.** `populate` hashes the source BEFORE the copy (per-file sha256; symlinks hash as `symlink:<target>`; the overall `sha` is sha256 over the sorted `path  sha` lines) and returns `{ sha, count, files }` (`PopulateResult`). Hashing first also makes a bad source fail fast before any provider call. With the new `manifestPath` option the manifest file is written and registered via `addArtifact` as kind `materialization` — lab owns no state directory (M1 stance), so the caller names the location (the attempt's run-data directory in the evaluation flow). The artifact registration code that collect/archive already used was extracted into one `registerArtifact` helper, preserving the warn-and-skip discipline.

**Activity facts.** `UnitProvider.activity(resource, workspace)` samples: newest workspace file mtime (GNU `stat -c`, falling back to busybox `date -r`; absence of both is a no-reading, not an error) and cumulative container CPU (cgroup v2 `cpu.stat` `usage_usec`, v1 `cpuacct.usage` fallback). Both go through the pidfile wrapper. `status` merges them as `lastActivityAt` / `cpuUsageUsec` on running units only.

**Progress view.** `status` rows gain `missionState` / `missionLabels` / `taskHash` when the unit is mission-bound and the face answers — the face gained `get` (sync-or-async like `isReleasable`; the CLI face spawns `dsh-mission get`, whose JSON output IS machine-readable). `taskHash` is the manifest hash's short prefix read from the `materialization` artifact's file. The join degrades to a warning per unit, never a failure. The CLI prints a padded table by default (`--json` for structured rows); identical TASK hashes across rows are the fairness signal, a long LAST-ACTIVITY gap on a working row is the stuck-cell signal. Labels render generically — lab never learns coordinate names.

**Failure loop in the integration suite.** The failure template became a state chain `working → archived-failed` (attested) `→ failed` (file-check on `archive/crash-dump.txt`), `releasableStates: ['failed']` — no new guard combinator, per the handoff. The driver now runs the loop: collect → orchestrator dump → attest → a premature `archived-failed → failed` transition REFUSED (file-check names the missing dump) → dump written → gate passes → release destroys. The main chain's populate gained the manifest leg (artifact kind `materialization` asserted).

## Alternatives considered

- **Manifest hash inside the artifact record or checkpoint ref instead of a manifest file** — rejected: the artifact record is `{path, kind}` and the progress view must read the hash from mission-visible data; a real file at `manifestPath` is the only self-describing form, and it doubles as the collect baseline.
- **lab owning a state directory for manifests** — rejected: it breaks M1's "no owned persistence" stance; the caller names the path, exactly like collect/archive targets.
- **CPU percentage from `docker stats`** — rejected: instantaneous percentage is not a cumulative fact; cgroup `cpu.stat` `usage_usec` is, and reads through the same exec path.
- **A `working → failed` direct attested transition (second round's shape)** — superseded: the handoff requires the failure path to pass the archive check too, expressed as the `archived-failed` intermediate state.

## Consequences

- 60 package tests + 16 integration assertions green on a live daemon; the integration failure block now pins "no archive → not releasable" on the failure path, mirroring the success path.
- `populate`'s return type changed (`void` → `PopulateResult`) — acceptable pre-release; the one in-repo caller (triad driver) is updated.
- `lastActivityAt` needs GNU `stat` or busybox `date -r` in the image; otherwise the row shows `-` (documented limitation).
- The manifest includes the worktree's `.git` pointer file when the source is a git worktree — harmless for fairness comparison (identical across same-commit worktrees), visible in the count.
- M3 (`lab_*` tools) remains the next milestone; the live-profile smoke is still open.

## Testing

Package: populate manifest (content hash values, identical-source identical-sha, manifest file + artifact registration, missing source fails before provider), status enrichment (activity merge, mission join incl. taskHash, join-failure degradation), docker activity (mtime max, cgroup v2, v1 fallback, unreadable tolerated), CLI table vs `--json`, CLI `get` wiring via stub bin. Integration: the manifest leg in the main chain, and the failure loop's premature-transition refusal + gate pass + release.

## Cross-references

- [lab proposal](../../../proposals/active/2026-08-19-lab-experiment-units.md)
- [lab M1](2026-08-20-lab-m1.md) · [M2 verbs](2026-08-20-lab-m2-verbs.md) · [M2 CLI](2026-08-20-lab-m2-cli.md) · [triad integration](../testing/2026-08-20-triad-integration-test.md)
