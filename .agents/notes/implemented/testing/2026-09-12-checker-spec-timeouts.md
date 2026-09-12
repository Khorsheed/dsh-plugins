# Agent Note: Checker specs declare their real runtime instead of flapping at 5s

Status: implemented

## Problem

Two repo-root checker specs were the gate's most frequent reds, and both were false alarms: `scripts/deploy-3080.spec.ts` (the 3080 deploy-flow integration suite) and `scripts/check-build-scripts-declared.spec.ts` (the install-script declaration scan) timed out at vitest's 5-second default whenever the machine was under load, then passed standalone. The failures taught agents to expect red from `pnpm gate`'s script-tests stage, which is how real regressions get waved through.

Both had a concrete defect rather than inherent slowness. The deploy spec's fixture runs the real orchestrator via `spawnSync` with an inner 15-second process timeout — a test designed to legitimately take up to 15s can never fit a 5s default. The build-scripts checker globbed `node_modules/.pnpm/*/node_modules/**/package.json`: the `**` walk descended into every installed package's own nested `node_modules` tree, read thousands of manifests, and discarded them afterwards with the two-segment filter; the spec ran that walk twice.

## Decision

- `vitest.scripts.config.ts` sets `testTimeout: 30_000` for the repo-root script specs — they are integration tests (subprocess orchestrator runs, installed-tree scans), and 30s covers the deploy fixture's inner 15s spawn timeout with headroom. Unit-fast specs are unaffected; the timeout is a ceiling, not a floor.
- `check-build-scripts-declared.ts` scans with two segment-precise globs (`*/package.json` and `@*/*/package.json` under each `.pnpm/<key>/node_modules/`), eliminating the nested-tree descent. The old two-segment filter also leaked subpath manifests that are not installed packages (`zod/v4-mini/package.json` and 34 kin); the precise patterns exclude them. Parity check before/after: zero real packages lost, found set unchanged.
- The spec shares one scan across its two cases instead of walking the store twice.

## Alternatives considered

- **Per-test timeouts in each spec** — puts the knowledge in the right file but scatters it across N specs and invites the next integration spec to forget it; the config-level ceiling matches what every script spec in this directory actually is.
- **Raising the inner spawn timeout instead** — the 15s is already generous; the mismatch was vitest killing the test first.
- **Deleting or downgrading the flaky tests** — both are the only regression nets for the deploy flow and the allowBuilds contract (the koffi CI break of 2026-09-01 is frozen into one of them); the flake was the bug, not the tests.

## Consequences

- `pnpm run test:scripts` went from red-under-load to green across repeated runs in the same environment that previously failed; the build-scripts case dropped from >5s to milliseconds.
- Gate's script-tests stage no longer blocks unrelated merges on a loaded machine, removing the pressure to merge around a red gate.
- Given up: nothing behavioral — the checker enforces the same contract on the same found set, and no spec gains new skip paths.
- Gate memory pressure (pnpm `-r` concurrency × per-package vitest workers on whole-repo scopes) is a separate, unfixed concern owned by the gate's tuning, not by these specs.

## Testing

`pnpm run test:scripts` green across three consecutive runs in the worktree; a node-level parity script diffed old-vs-new glob coverage (427 vs 462 manifests, the 35 difference all subpath manifests, zero real packages lost).
