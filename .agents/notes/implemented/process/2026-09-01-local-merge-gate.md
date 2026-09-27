# Agent Note: A local merge gate for a repo whose CI runs on the human's schedule

Status: implemented

## Problem

CI runs on push to main, and pushes are coordinated by the human rather than automated. That is a deliberate choice — the repository goes public later, and the coordinator wants each push to be a decision. Its consequence is that CI feedback arrives on the coordinator's schedule, not the change's.

On 2026-09-01 the cost came due. A week of work (378 commits, last push 2026-08-25) reached CI at once and failed three times in a row:

1. `cc31c1a` retired taskpilot's `tsconfig.paths.json` mechanism and deleted `scripts/sync-harness-paths.mjs`, but left the CI step invoking it — `MODULE_NOT_FOUND`.
2. `room` merged on 08-29 pulled `koffi` in transitively; pnpm ≥ 11 hard-fails a cold install on an unreviewed dependency build script — `ERR_PNPM_IGNORED_BUILDS`.
3. The `dsh-basic` mirror had drifted from `profiles/basic`.

None of the three was findable locally. The first lives only in the workflow file, which no local command reads. The second only reproduces on a cold `pnpm install`; a warm `node_modules` never re-raises it. The third needs network and mirror push rights.

The naive fixes both fail. Pushing on every merge is not available — the coordinator has reserved that call. Routing every package's tests through mainline makes one agent the bottleneck for 25 packages and replaces a two-minute local signal with a half-day round trip; it also would not have caught any of the three, because all three are integration-layer, not package-layer.

## Decision

`pnpm gate` (`scripts/gate.mts`) is the pre-merge gate a package owner runs in their own worktree. It runs every CI step that is reproducible from a warm checkout, cheapest first, and stops at the first failure: the two new checkers below, hygiene over the full tree, plugin independence, the three doc gates, the checkers' own specs, then build, test, and pack-all.

Two new checkers stand in for the CI steps that a warm checkout cannot reproduce:

- **`check-workflow-refs`** parses `.github/workflows/*.yml` and asserts that every repo file and every `pnpm run` / `npm run` target a step invokes actually exists. Steps carrying `working-directory` are skipped — those run inside the cloned harness. This is failure 1, made local.
- **`check-build-scripts-declared`** walks the installed tree for dependencies carrying `preinstall`/`install`/`postinstall` and requires each to have an explicit verdict in `pnpm-workspace.yaml`'s `allowBuilds`. Either verdict passes; the absence of a decision fails. This is failure 2, made local, without needing a cold install.

A third gap gets an advisory rather than a gate: the gate's first step compares the local `DSH_HARNESS` checkout's `git describe` against the `ref:` pinned in `ci.yml` and says so when they differ. Being ahead is the normal state (guard checkpoint commits land in the deployment checkout), so failing on it would train people to ignore the gate; knowing your types came from a different tree than CI's is still worth a line.

`pnpm gate --full` additionally runs the real workflow under `act` in Docker, which is the only local way to reproduce the cold install. It is opt-in because it needs Docker and an `act` install, and it reports a clear install instruction rather than silently passing when `act` is absent.

The mirror `--check` gates are deliberately excluded from the gate: mirror drift is mainline's to fix (syncing needs push rights to the mirror repo), so it must not block an owner's merge. CI keeps them, which is where failure 3 belongs.

Branch protection is unavailable — GitHub answers 403 ("Upgrade to GitHub Pro or make this repository public") for both the protected-branch and the ruleset endpoints on a private repo under a Free plan. `.githooks/pre-push` therefore enforces the two protections that matter most locally: no non-fast-forward push to main, no deletion of main. When the repository goes public, the server-side rule should be enabled and this hook becomes a fast local echo of it.

## Alternatives considered

**Push on every merge and let CI be the gate.** The straightforward fix, and what most projects do. Not available here: the coordinator has reserved the push decision because the repository is going public and each push is a visibility decision. Recorded because the constraint may lift — if it does, most of this note's machinery becomes redundancy rather than the primary net.

**Fork + PR, or branch pushes with required status checks.** The standard open-source answer, and the right destination once the repo is public. Rejected for now on two counts: required status checks are incompatible with the direct-push model (the check cannot run before the push it gates), and branch protection is not purchasable on the current plan. `docs/development.md` records this as the migration path rather than a rejection.

**Centralize all testing with mainline.** Considered because it was the coordinator's first instinct. Rejected on evidence: all three failures were integration-layer and none was caused by a package owner, while the package-level suites they would hand over (ankh-guard's 116 tests, room's 183) tell mainline nothing an owner does not already learn in two minutes. The split that holds is "your package" versus "everyone's combination", not "development" versus "testing".

**Reproduce the cold install in the default gate.** Rejected as the default: wiping `node_modules` costs minutes and disturbs a checkout that the production profile `link:`s. `--full` offers it on demand, and `check-build-scripts-declared` covers the failure mode that class has actually produced.

**Parse the lockfile instead of the installed tree for install scripts.** Preferred on principle — the lockfile is platform-independent — but lockfile v9 does not record `requiresBuild`, so the information is not there. The installed tree is the available source; its blind spot (a dependency that only installs on another platform) is documented in the checker and left to CI's cold install.

## Consequences

- A package owner's obligation grows by three second-scale checkers; the build and test they were already required to run before committing are unchanged.
- The gate is only as good as its coverage of the blind spots, and one blind spot remains by construction: a cold install on a platform this machine is not. CI stays the backstop, which makes push cadence part of the design rather than a preference — a net that is only collected weekly is what produced this incident.
- Both checkers freeze their originating incident in their specs, so a regression reproduces the 2026-09-01 failures rather than an abstraction of them.
- `pnpm gate` duplicates the CI step list in a second place. They will drift; `check-workflow-refs` catches the drift that matters (a step invoking something that does not exist), not a step that CI runs and the gate forgot.
