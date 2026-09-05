# Agent Note: The merge gate is scoped by default, and says what it skipped

Status: implemented

## Problem

`pnpm gate` ran the whole repository every time: 26 packages built, 25 test suites, 26 tarballs packed — about nine minutes on an 8-core/16GB machine, during which the machine is saturated and the developer cannot touch the tree (an edit mid-run made the doc gates fail against a sidecar the run had already read).

Measurement suggested the cost was concentrated: one package's process-spawning suite read 250 of 409 summed test-seconds. **That framing was wrong in two ways, and the correction matters more than the original number.**

The reading predated that package sharding its own suite; it has since split the slow specs across four concurrent shards and injected a test-only sleep scale, and the package's own measurements put it far lower. And the statistic itself was unsound: summing each sub-vitest's reported `Duration` counts concurrent work as if it were serial. A later run made the error plain — a test step whose wall clock was 240 seconds reported a 1085-second "serial sum", overstating by 4.5×.

What survives the correction is the structural point, which never depended on the number: **a change touching no package source should not build 26 packages.** The distribution of cost decides how much scoping is worth, not whether it is right.

## Decision

The gate scopes to the change by default. Build, test and pack run against `pnpm --filter "...[<base>]"` — packages changed since the base ref **plus everything that depends on them**, which is pnpm's own dependency reckoning rather than ours. `--all` restores the whole-repo sweep; `--since <ref>` moves the base (default `origin/main`, falling back to local `main`).

Scoping is refused whenever the change touches a path that alters how every package builds or tests — `build/`, `scripts/`, `tsconfig.base.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, root `package.json`, `.github/`. Those change nothing pnpm counts as a package, so a shared vitest preset edit would otherwise scope to zero packages and skip every test while reporting green. That is the one failure mode scoping must not have, so the guard is a path list checked before pnpm is consulted at all.

Three smaller additions ride along, all from the same run:

- **Per-step timings, and the five slowest suites** with their share of the total. Every number in this note came from mining sub-command output of past runs, because the gate reported only a grand total. A cost nobody can see gets attributed to "the gate" rather than to the suite that owns it.
- **A declared-dependency check, first and fatal.** A merge that adds a dependency leaves a warm checkout's `node_modules` behind, and the build then dies minutes later on an unresolvable import naming neither cause nor fix — observed in this very run, 197 seconds to reach a `TS2307` that `pnpm install --frozen-lockfile` cleared in five. pnpm's own `verify-deps-before-run` does not cover it: that compares manifests against the lockfile, and the lockfile was already correct; only `node_modules` was short. The check is therefore what the build actually needs — every declared `dependencies`/`devDependencies` entry has a directory to resolve. Peers are skipped, since wide optional peers on official packages are the convention here. It reports and never repairs: a repo-root `pnpm install` under concurrent agents resolves multiple peer variants (conflict rule 3), so the fix is named and left to a human who knows who else is mid-build.
- **A working-tree fingerprint** (HEAD plus `git status --porcelain`) taken at the start and re-checked at the end. If the tree moved, the run is failed with an explicit message: the verdict describes neither the state it started on nor the one it ended on.

## Alternatives considered

**Cap concurrency instead.** Still worth doing separately, for memory stability — 16GB against 4-way workspace concurrency each spawning a vitest pool — but as a stability measure, not a speed one, and only with a number measured under both idle and loaded conditions rather than guessed. The first attempt to reason about it from a single reading produced the mismeasurement above; single wall-clock readings on a contended machine are noise, and a run whose failures came from a second gate running concurrently is not evidence about anything.

**Fix the slow suite and keep the gate whole-repo.** The highest-leverage change by far, and it is happening — but it belongs to ankh-guard's owner (package-level tests are owner-owned per docs/development.md), and it does not remove the structural point: a change touching no package source should not build 26 packages. The two fixes are independent and both worth having.

**Scope by explicit package list.** Rejected: it puts the dependency closure in the developer's head, and the first time someone forgets a dependent, the gate reports a green that CI will contradict. `...[ref]` makes pnpm own that reasoning.

**Keep the whole-repo run as the default and offer `--scoped`.** Rejected on how defaults actually behave: the expensive default is the one that gets skipped entirely under time pressure, and a gate that gets skipped protects nothing. Making the cheap path default and the full sweep explicit puts the friction where it does the least damage — mainline runs `--all` once before pushing, and CI runs everything unconditionally regardless.

## Consequences

- A typical package change now pays for its own package and its dependents instead of all 26.
- A scoped pass is weaker evidence than a full pass, by construction. The split is stated in the gate's own output (`scoped; pnpm gate --all before pushing`) and mirrors the ownership split already in force: owners iterate scoped, mainline sweeps before pushing, CI is unconditional.
- Every uncertainty in scope resolution resolves to the whole repo: a failed base-ref lookup, an unreadable diff or status, and — the one that would otherwise be a silent false green — a package filter that **errors**, which is indistinguishable from one that matched nothing unless failure is distinguished from empty output.
- The base ref is local `main`, not `origin/main`. Pushes are batched, so origin lags by tens of commits whose accumulated shared-layer changes would force every owner's run back to the whole repo — scoping that never scopes. `--since origin/main` is the right base for mainline's own pre-push sweep, and is how that sweep is expressed.
- Renames are read at both ends. `R  old -> new` prefix-checked as one string tests only the old path, so a file moved INTO a shared layer would not have triggered the fallback.
- The working-tree fingerprint hashes content, not the status listing: a file already reported as ` M path` keeps that line unchanged while its contents keep changing.
- `scripts/gate.spec.ts` drives scope resolution through an injected runner, so command failure, rename, untracked, invalid `--since`, empty scope and `--all` are all reachable without a repository.
- The `GLOBAL_PATHS` list is load-bearing and will rot silently if a new shared-layer path appears outside it. It is short and lives beside the reasoning; a future shared-layer directory must be added to it in the same change that creates it.
- `pack-all-dist` grew an `--only` filter for the scoped path. CI and release waves pass no filter, so the whole-repo packing guarantee is unchanged for both.
