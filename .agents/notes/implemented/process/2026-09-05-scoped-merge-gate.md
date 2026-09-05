# Agent Note: The merge gate is scoped by default, and says what it skipped

Status: implemented

## Problem

`pnpm gate` ran the whole repository every time: 26 packages built, 25 test suites, 26 tarballs packed — about nine minutes on an 8-core/16GB machine, during which the machine is saturated and the developer cannot touch the tree (an edit mid-run made the doc gates fail against a sidecar the run had already read).

Measurement, once the gate was instrumented, showed the cost was not evenly spread. Of 409 serial test-seconds, **ankh-guard alone was 250** — 61% of the test phase and 46% of the whole gate — concentrated in one spec file (118 tests, 247s) whose slowest cases wait on real process lifecycles: boot timeouts, port-bind retries, give-up backoff. One case waits 48.8 seconds.

Two consequences followed. Every change paid that cost, including changes touching no package source at all. And because a critical path cannot be shortened by parallelism, no concurrency tuning could help: while that file runs, the test phase cannot finish faster than 247 seconds.

## Decision

The gate scopes to the change by default. Build, test and pack run against `pnpm --filter "...[<base>]"` — packages changed since the base ref **plus everything that depends on them**, which is pnpm's own dependency reckoning rather than ours. `--all` restores the whole-repo sweep; `--since <ref>` moves the base (default `origin/main`, falling back to local `main`).

Scoping is refused whenever the change touches a path that alters how every package builds or tests — `build/`, `scripts/`, `tsconfig.base.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, root `package.json`, `.github/`. Those change nothing pnpm counts as a package, so a shared vitest preset edit would otherwise scope to zero packages and skip every test while reporting green. That is the one failure mode scoping must not have, so the guard is a path list checked before pnpm is consulted at all.

Three smaller additions ride along, all from the same run:

- **Per-step timings, and the five slowest suites** with their share of the total. Every number in this note came from mining sub-command output of past runs, because the gate reported only a grand total. A cost nobody can see gets attributed to "the gate" rather than to the suite that owns it.
- **A declared-dependency check, first and fatal.** A merge that adds a dependency leaves a warm checkout's `node_modules` behind, and the build then dies minutes later on an unresolvable import naming neither cause nor fix — observed in this very run, 197 seconds to reach a `TS2307` that `pnpm install --frozen-lockfile` cleared in five. pnpm's own `verify-deps-before-run` does not cover it: that compares manifests against the lockfile, and the lockfile was already correct; only `node_modules` was short. The check is therefore what the build actually needs — every declared `dependencies`/`devDependencies` entry has a directory to resolve. Peers are skipped, since wide optional peers on official packages are the convention here. It reports and never repairs: a repo-root `pnpm install` under concurrent agents resolves multiple peer variants (conflict rule 3), so the fix is named and left to a human who knows who else is mid-build.
- **A working-tree fingerprint** (HEAD plus `git status --porcelain`) taken at the start and re-checked at the end. If the tree moved, the run is failed with an explicit message: the verdict describes neither the state it started on nor the one it ended on.

## Alternatives considered

**Cap concurrency instead.** The instinctive fix, and it does not work here: the dominant term is a critical path, not contention. Capping cannot make the test phase shorter than its longest suite. It remains worth doing separately for memory stability — 16GB against 4-way workspace concurrency each spawning a vitest pool — but as a stability measure, not a speed one, and only with a measured number rather than a guessed one.

**Fix the slow suite and keep the gate whole-repo.** The highest-leverage change by far, and it is happening — but it belongs to ankh-guard's owner (package-level tests are owner-owned per docs/development.md), and it does not remove the structural point: a change touching no package source should not build 26 packages. The two fixes are independent and both worth having.

**Scope by explicit package list.** Rejected: it puts the dependency closure in the developer's head, and the first time someone forgets a dependent, the gate reports a green that CI will contradict. `...[ref]` makes pnpm own that reasoning.

**Keep the whole-repo run as the default and offer `--scoped`.** Rejected on how defaults actually behave: the expensive default is the one that gets skipped entirely under time pressure, and a gate that gets skipped protects nothing. Making the cheap path default and the full sweep explicit puts the friction where it does the least damage — mainline runs `--all` once before pushing, and CI runs everything unconditionally regardless.

## Consequences

- A typical package change now pays for its own package and its dependents instead of all 26.
- A scoped pass is weaker evidence than a full pass, by construction. The split is stated in the gate's own output (`scoped; pnpm gate --all before pushing`) and mirrors the ownership split already in force: owners iterate scoped, mainline sweeps before pushing, CI is unconditional.
- The `GLOBAL_PATHS` list is load-bearing and will rot silently if a new shared-layer path appears outside it. It is short and lives beside the reasoning; a future shared-layer directory must be added to it in the same change that creates it.
- `pack-all-dist` grew an `--only` filter for the scoped path. CI and release waves pass no filter, so the whole-repo packing guarantee is unchanged for both.
