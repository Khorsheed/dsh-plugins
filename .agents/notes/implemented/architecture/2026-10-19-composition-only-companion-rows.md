# Agent Note: Companion rows go composition-only, and the eval suite takes the local-agent family

Status: implemented

## Problem

Two loose ends of the mode-pack settlement ([2026-10-18-mode-bundle-packs](2026-10-18-mode-bundle-packs.md)). First, gamedev and writing carried factory-DISABLED "handle rows" at the profile root (`game-agent`, `canvas-novel-agent`, plus a bare `canvas-agent` disable override) while dev/learning/video/bundle-eval never did — a leftover of the pre-0.2.x belief that a profile row and a preset-composition row with the same entry id fail the boot by double registration. The handle rows cluttered the plugin list with 已关闭 cards and existed only as a global-on backdoor. Second, the eval suite did not carry the local-agent family although eval's run verb delegates every cell through the `localAgent` service facade and refuses provisioning without it (`packages/eval/src/service.ts` run/provision) — the suite's core flow errored on a missing co-install.

## Decision

Companion tool/agent rows live ONLY in preset compositions. A mode pack's patch inserts its members' root rows (verbatim from the member patches) plus its one preset row; rows whose module name carries a subpath (`@khorsheed/dsh-game/agent`, `…/tool`) never appear at the profile root — the pack's preset grants them per session. gamedev dropped the disabled `game-agent` insert; writing dropped the disabled `canvas-novel-agent` insert and the bare `canvas-agent` override. Host 0.2.x voids the old crash rationale: a same-id row at the profile root and in a preset scope shadow rather than collide (the host's `packages/core/tools/tests/scoped.spec.ts` pins "scoped shadows global on a name conflict, in either registration order"), and the retired warnings in the canvas/game/canvas-novel/writing/gamedev patches and READMEs now say so.

Member patches flip the other way: game's and canvas-novel's `./agent` rows ship ENABLED in their own patches (canvas already did). A member patch is inert under its mode pack (the member arrives as a transitive dependency) and active on a standalone install — standalone now gets working tools out of the box instead of a toggle hunt.

bundle-eval's members gain the local-agent family (core + the kimi/codex/claude-code/dsh providers; headless rides along deps-only), rows copied verbatim from the dev pack including the two bare official-tool disables. preset-dsh-eval's composition is unchanged: the family is a SERVICE dependency of eval's run/provision path, not a session-tool grant. Overlapping membership between dev and bundle-eval is safe on purpose: same-id rows across bundle layers collapse to one entry (the later layer wins), and a new checker rule pins shared rows verbatim across bundles (comments stripped, single quotes normalized to double) so the copies cannot drift apart.

`scripts/check-plugin-independence.ts`'s mode sanction now reads: pack rows = the union of member patch items MINUS member rows whose name carries a subpath; each excluded subpath row id must be granted in the pack's inline preset composition with the same module name; every `@khorsheed` module named in the composition must belong to a member; plus the cross-bundle row-parity rule above. This codifies what dev/learning/video/bundle-eval already did.

## Alternatives considered

**A separate 多智能体协作 suite (revive bundle-local-agent), dev slimmed to match.** Rejected: the host reconciles only the profile's DIRECT dependency bundles — bundle-in-bundle does not mount (plugin-manager `installBundle` diff and `reconcile` both read one layer) — so dev could not "include" it; and a dev preset naming tool rows of a maybe-absent suite breaks the WHOLE preset (`agent-preset/invalid` at select time), not just the three tools. Overlap gives both suites self-containment with no preset surgery. bundle-local-agent stays retired; the cherry-pick path (core + provider, the provider pending until the core mounts) still serves delegation-outside-the-modes.

**Keep the handle rows.** Rejected: their only live demand was standalone installs, better served by enabled member rows; in suite context they were inert noise with a global-on footgun.

**Delete the member `./agent` rows entirely.** Rejected: standalone installs would lose the tools with no recovery path.

**Grant the delegation `./tool` rows globally in the dev pack.** Rejected: per-session grant keeps non-dev sessions' tool catalogs clean; the composition mechanism exists for exactly this.

## Consequences

- The plugin manager loses the `game-agent` / `canvas-novel-agent` 已关闭 cards; the settings inventory's preset section is unchanged (it reads compositions, not profile rows).
- Mixed standalone+suite installs of canvas now shadow instead of being force-disabled by the writing pack's override — the standalone choice wins; accepted as the honest layering.
- The mode-bundle-packs note's "deliberate deviation" paragraph is updated to this reality.
- The presets package keeps the old comment wording until its retirement (parity compares composition, not comments).

## Testing

`pnpm check:plugins` 0 findings over 48 packages; `pnpm test:scripts` green including the new rule unit/integration specs and both preset parity specs; per-package suites green (writing 7, gamedev 7, bundle-eval 8, canvas-novel 184, game 33, canvas 620); the full `pnpm run build && pnpm run test` gate against the 0.2.1 harness tree (DSH_HARNESS=deepseek-harness-021) green before commit.
