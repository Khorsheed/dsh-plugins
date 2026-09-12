# Agent Note: Companion tool packages and the core↔companion edge cycle that raced cold builds

Status: implemented

## Problem

A cold full-repo build failed deterministically: the companion tool packages (`mission-tool` / `datasets-tool` / `eval-tool` / `worktrees-tool` / `room-tool`) ran their `tsc` before their core's `lib/` existed, so `tsc` could not resolve `@khorsheed/dsh-<core>` and the build died. Warm checkouts masked it because the core's `lib/` was already on disk; CI, which installs and builds cold on every run, would have gone red the moment the companion rows merged.

The first hypothesis — "pnpm `-r run` topologically sorts only prod `dependencies`, so dev/peer edges are invisible to the sequencer" — is wrong. pnpm's projects graph (`createProjectsGraph`) builds edges from `peerDependencies`, `devDependencies`, `optionalDependencies`, AND `dependencies`. The actual cause: each core ALSO declared its companion (an optional peer + devDep, added so pack-dist's family-edge gate would accept the companion's module-name string in the core's client bundle). With both directions declared, core⇄companion formed a dependency cycle, and pnpm's `graphSequencer` schedules the members of a cycle into ONE chunk — run concurrently — so the companion's `tsc` raced the core's `gen-typert + tsc + tsdown`. Confirmed by experiment: deleting the reverse edges from one pair restores strict core → companion build order; the typecheck probe also showed filter expansion (`--filter pkg...`) saw the edge while sequencing did not order by it, which is the cycle signature, not a missing edge.

## Decision

Cross-package manifest edges go in ONE direction only: companion → core (the companion genuinely imports the core's `./tool` factory and types at build time).

- The five cores (`mission`, `datasets`, `eval`, `worktrees`, `room`) drop their reverse manifest edges on their companions (`peerDependencies` + `peerDependenciesMeta` + `devDependencies`). `room` keeps its unrelated `dsh-local-agent` optional pair.
- A sibling name a package mentions purely as DATA — the preset-visibility / badge gate constants that name the companion row in the client bundle — is declared in the manifest's `dsh.references` array. pack-dist's `verifyTarball` unions `dsh.references` into the declared set for its family-edge check, so the gate still fails on undeclared family references. `mission`, `datasets`, `worktrees`, and `room` carry the entry; `eval` needs none — its companion name survives only in comments, which the gate strips before scanning.
- `scripts/check-plugin-independence.ts` drops the reverse entries from `ALLOWED_EDGES` and its comment records why a data mention must never become an edge. `AGENTS.md`'s no-inter-plugin-dependencies bullet carries the one-direction rule.

## Alternatives considered

- **Companion's `dependencies` on the core (the local-agent pattern)** — fixes nothing: the reverse peer/dev edges still close the cycle, and the graph already contained both directions (peer and dev edges count). The cycle, not the edge kind, was the defect.
- **Companion build script builds the core first (`pnpm --filter <core> build && tsc ...`)** — ordering becomes self-guaranteed only if the reverse edges are ALSO dropped (otherwise both packages land in one chunk and the nested core build races the chunk's own core build on the same `tsbuildinfo`); it duplicates the core build in every full-repo build, and it hides the topology instead of repairing it. With the cycle broken, pnpm orders the pair correctly on its own.
- **tsc project references** — a core's build is `gen-typert && tsc -b && tsdown`; project references can drive `tsc` but not the typert generation or the bundle step, so the companion would still need the full core build to have run first.
- **Two-phase root build script (cores, then companions)** — repairs only the root `build` entry point; the gate's filtered builds and CI would still race whenever a filter covered a pair, and every future pair would need the same choreography.

## Consequences

- Cold builds are deterministic again: pnpm's own sequencing orders every core before its companion, in the root script, in `pnpm gate`'s filtered builds, and in CI.
- pack-dist's family-edge gate keeps its teeth: undeclared `@khorsheed/*` references in shipped artifacts still fail the pack; data mentions are declared explicitly in `dsh.references` instead of smuggling a dependency edge.
- deploy:3080 derives pack-dist's `--family` from a package's `@khorsheed/*` deps+peers, so packing a core no longer names its companion in `--family` — a no-op rewrite, since source and dist names share the `@khorsheed` scope (the pairs rewrite a name to itself). Deploying a companion was always an explicit `--package packages/<companion>`; nothing about registration or the profile changes.
- Given up: the (never-real) loader-level signal the reverse peer pretended to carry. The profile installs cores and companions as direct dependencies; the optional peer was never required by any install.
- The earlier "pnpm ignores dev/peer edges for run ordering" claim (recorded in [the memory-caps Agent Note](../../implemented/process/2026-09-12-test-memory-concurrency-caps.md)) is corrected there and superseded by this note.

## Testing

- Reproduced the cold failure on the `mission` pair (`rm -rf` both `lib/` dirs, `pnpm -r --filter` both, run build) — the companion started concurrently and failed; after dropping the reverse edges, the core builds to completion before the companion starts.
- Full cold-lib repo build (every `packages/*/lib` deleted, root `pnpm run build`) green.
- pack-dist on all five cores with deploy's `--family` derivation — all pass `verifyTarball` (the four `dsh.references` entries honored, eval needs none).
- `pnpm run test:scripts` green, including a new pack-dist spec case: a family name declared via `dsh.references` passes the family-edge check.
