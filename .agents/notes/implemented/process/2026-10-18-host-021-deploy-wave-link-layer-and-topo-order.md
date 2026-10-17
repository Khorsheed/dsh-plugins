# Agent Note: host-021 deploy wave — link-layer refresh and topological deploy order

Status: implemented

## Problem

The 0.2.1-rc.1 host-upgrade deploy (2026-10-18, all 40 prod packages in one `deploy:3080` call) hit two gates no prior wave had exercised at this scale:

1. **The dependency-link check failed on 12 dangling symlinks.** The hand-provisioned official-package link layer (`~/.dsh-official/profiles/node_modules/@deepseek-ai/*` and its `local-agent/dsh/profiles` twin) symlinks into the harness checkout's `apps/cli/node_modules` tree, so peer resolution for profile installs always lands on the running host's own packages. An rc switch reshuffles that tree: rc.1 hoisted `dsh-skill-badge` to the cli top level, moved the otel packages into root `.pnpm`, dropped `dsh-invariants` and `dsh-subagent-in-process-driver` entirely, and removed two workspace packages upstream (`native/landlock-run`, `packages/experimental/schedule-bundle`) — whose on-disk residue became phantom dirs with dangling pnpm mirror links under `node_modules/.pnpm/node_modules/`.
2. **A lib wipe turns gate ① into a topological-ordering problem.** pack-dist's stale-types gate (ops.md 构建卫生 pit two) forced `rm -rf packages/*/lib` after the invariant sweep deleted `src/invariant.ts` from 35 packages. With lib/ gone, gate ①'s plain `pnpm --filter <pkg> build` in command-line order failed: `local-agent-dsh` imports `@khorsheed/dsh-local-agent-dsh-headless/wire` types, and headless was scheduled after it.

## Decision

- **Link-layer refresh is part of every host upgrade** (升线), alongside the documented 三件套 (lockfile / `minimumReleaseAgeExclude` / phantom-dir cleanup). Mechanically: retarget links whose package still exists at a new path, delete links whose package left the tree, delete phantom dirs (a clean `git status` in the checkout proves everything left is ignored residue). Record every `path -> target` in `~/.dsh-official/scratch/` before removal (this wave's record: `link-cleanup-20261018-host021.txt`), then verify with `pnpm deploy:check-links`.
- **Wave deploys pass `--package` in topological order of intra-repo type edges.** The edge inventory is greppable (`grep -rhoE "from '@khorsheed/dsh-[a-z0-9-]+" packages/<pkg>/src`); as of this wave it is: `local-agent` before its four providers and `room`; `local-agent-dsh-headless` before `local-agent-dsh`; `inline-html-render` before `canvas`. `ui-panel-kit` and `ui-content-preview` resolve from `src` (their exports point at source), so they need no lib and impose no order.
- The desktop profile (`~/.dsh/profiles/desktop`) still lists `@deepseek-ai/dsh-experimental-schedule-bundle`, which rc.1 removed upstream; it must drop that bundle before any desktop upgrade past 0.2.0.

## Alternatives considered

- **Teaching deploy-3080 to topo-sort `--package` internally**: the right long-term fix, but mid-wave is no time to change the gate's contract ("builds what you name, in the order you named"); recorded here instead.
- **One full repo rebuild before the deploy instead of ordering**: costs a full gen-typert regeneration because the freshness cache keys on the harness checkout's HEAD (the deploy must run against the freshly upgraded shared checkout, which has no stamp). Ordering is free.
- **Recreating the link layer from scratch with a provisioning script**: the layer's origin predates the repo's scripted era and no generator exists; a 232-entry regeneration script is justified only if the layer changes shape again.

## Consequences

- Cost: two burned deploy runs (~2 h of gate ① re-runs) discovering the two failure modes. Bought: the host-upgrade deploy is now a mechanical procedure with a verified checklist, and the rc.1 cutover completed with preflight PASS and canary PASS.
- `docs/ops.md`'s 升线三件套 should gain the link-layer refresh as a fourth item on the next docs pass (not edited mid-wave).
- The stale-types gate now has a wave-scale trigger on record: any change that deletes `src` files across packages must be followed by a lib wipe before deploy, and a lib wipe implies topological `--package` order.

## Related

- [host-021 invariant sweep](../simplification/2026-10-17-host-021-invariant-sweep.md) — the src deletion that armed the stale-types gate.
- [ankh-guard self-deploy reconfigure](2026-09-26-ankh-guard-self-deploy-reconfigure.md) — the install-anchor drift whose `reconfigure` verb fired again on this cutover, as designed.
