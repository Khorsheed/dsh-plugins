# Agent Note: host-021 sweep — invariant companions retired, engines.dsh declared repo-wide

Status: implemented

## Problem

Host 0.2.1-rc.1 (npm `next`, 2026-10-17) deletes `@deepseek-ai/dsh-invariants` and every `./invariant` subpath export upstream (`f028f256`). Our identity convention gave every self-mounting package a `src/invariant.ts` companion carrying a `PACKAGE_NAME` constant plus optional boot probes, with a `./invariant` export, a peer dep, a devDep, a tsdown entry, and (in 12 packages) a `tsconfig.host.json` `files` pin. Against the 0.2.1 type surface all of that fails to compile. At the same time 0.2.1-alpha.3 made `engines.dsh` the sole compatibility arbiter when present (peers ignored), and our peer ranges (`^0.1.0-rc.6`) systematically misjudge under 0.2.x.

## Decision

- **Pure removal, no replacement**: 34 of 35 packages (all but message-tools, deferred to wave batch 3 for its in-flight branch) drop `src/invariant.ts`, the `./invariant` export, peer/meta entries, tsdown entries, and tsconfig pins. The identity triangle in AGENTS.md becomes a pair; `check-plugin-independence.ts` keeps its existsSync-gated PACKAGE_NAME check for stragglers.
- **Dropped boot probes are accepted losses, recorded per commit body**: worktrees' git-on-PATH fail-loud, datasets' materialized-root integrity (the check itself survives in `src/materialize.ts` with its own unit tests), ankh-guard's state-file parse check, local-agent family's harness-contract audits, capture/dsh-reader/context-lens runtime sanity probes, mission's run-file parse check, canvas(-novel) vocabulary round-trips, quote/sidechat vocabulary self-tests, video-studio's spawn probe. 11 packages carried empty `() => {}` rituals. Upstream deleted the whole invariants system with no replacement hook; rebuilding it inside each package would be re-opening a seam. Failure modes fall back to each package's own degrade path (AGENTS.md "degrade, don't explode").
- **`engines.dsh` policy**: every swept package declares `"engines": { "dsh": ">=<dsh.compat.minHost> <0.3.0-0" }`. Lower bound keeps the minHost floor unmoved (016-wave principle); the `<0.3.0-0` cap excludes the next minor including its prereleases (semver-verified against the host's `includePrerelease` semantics) so an unverified host line fails closed at install rather than exploding at runtime. Floors move only when npm `latest` rolls forward.
- **Two-track wave strategy**: dual-line-safe mechanics (this sweep) land directly on main through six parallel worktrees (`chore/host-021-sweep-1..6`); 0.2.1-only work (message-tools chat-slot migration, pin bump, re-verification) lives in the `feat/host-021-adaptation` wave worktree gated against the dedicated `~/code/deepseek-harness-021` checkout. Shared `~/code/deepseek-harness` and 3080 stay on 0.2.0-rc.2 until the user green-lights the merge line, per the 016-wave rc discipline. Full plan: `proposals/active/2026-10-17-host-021-adaptation.md` (proposals are gitignored by design — the file lives in the shared checkout).

## Alternatives considered

- **Fold valuable probes into each package's `apply()`**: rejected — turns a mechanical sweep into per-package behavior design; the probes were boot-time assertions, not features, and the host itself abandoned the concept.
- **Keep `engines.dsh` unbounded (`>=` only)**: rejected — every 0.x host minor has broken us; an unbounded range claims compatibility we never verified.
- **One agent sweeping sequentially**: rejected by cost — 34 packages × (build+test) would serialize to hours; six worktrees ran the sweep in about two hours of wall time despite heavy CPU contention.

## Consequences

- 34 packages are dual-line clean: they build against both 0.2.0-rc.2 (current shared checkout) and carry the manifest declaration 0.2.1 wants. message-tools is the only remaining invariant carrier and the only chat-slot breakage; both are wave batch 3.
- The wave branch can now bump `pnpm-workspace.yaml` pins to 0.2.1-rc.1 without invariant noise in the red list.
- **Process lessons for the next parallel sweep** (all recorded by sweep agents):
  - gen-typert's freshness cache (`$DSH_HOME/scratch/typert-cache.json`) thrashes across parallel worktrees — a full regen in one worktree invalidates the stamp for all others; scoped `GEN_TYPERT_ONLY=<pkg>` (the deploy path) bypasses the shared cache and lock entirely.
  - `tsconfig.host.json`/`tsconfig.client.json` `files` arrays may pin `src/invariant.ts` — removal without the pin edit is a TS6053.
  - The package.json sweep spec must list `devDependencies` too (peers alone left 34 stale entries, cleaned in the root closeout commit).
  - `git rm` stages deletions immediately — agents must re-check `git status` before each per-package commit or the next package's deletion rides into the current one (two self-healed incidents).
  - ankh-guard's integration lane and datasets' git-fixture tests flake under sweep load (loadavg 28–40); both pass in isolation. ankh-guard's red lane matches the known 016-wave EADDRINUSE flake note (baseline shows the same failures, worse).
- `pnpm-lock.yaml` still references `@deepseek-ai/dsh-invariants@0.2.0-rc.2` in official packages' own peer-resolution suffixes — upstream's 0.2.0 graph, not ours; it disappears when the wave bumps the pin line.
