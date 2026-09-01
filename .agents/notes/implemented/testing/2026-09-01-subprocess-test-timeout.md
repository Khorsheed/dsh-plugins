# Agent Note: The shared vitest preset carries a subprocess-sized timeout

Status: implemented

## Problem

`pnpm run test` at the repo root runs 25 packages' vitest instances concurrently, each with its own worker pool. Suites that spawn real subprocesses — `pnpm pack` plus `tar` in file-preview's 3d-artifact pack smoke, the CLI in datasets' read-verbs spec — finish in about 2s alone but land at 5.1–5.8s under that load, past vitest's 5000ms default.

Two properties made this hard to see for what it was. It is **not flaky**: three consecutive whole-repo runs failed, and the second failure landed in a different package than the first, which is what turned a suspected one-off into a class. And **CI never sees it**: the runner's IO is fast enough to stay under 5s, so `pnpm run test` is green there while the same command is red on a maintainer's machine — the command AGENTS.md requires before every commit.

## Decision

`dshTestConfig()` in `build/vitest.ts` sets `testTimeout: 30_000`. A larger budget costs a passing test nothing; it only changes how long a genuinely hung test takes to report.

Two packages carry no `vitest.config.ts` and therefore never see the preset: **file-preview** and **ankh-guard**. file-preview's pack smoke keeps the explicit per-test budget it was given (`3eeb210`) — for that package it is the only available mechanism, not a redundant one. ankh-guard's suites already pass, its own long-running cases carrying inline budgets.

## Alternatives considered

**A per-test timeout on each offender.** What the first fix did, before the class was visible. Rejected as the general answer once a second package hit the same wall while the first fix was still being reviewed: the offenders are not a fixed set, and each new one costs a cross-owner edit by whoever happens to hit it.

**A `slow`-tagged vitest project behind `pnpm test:slow`.** The structurally cleanest answer, and the one to reach for eventually. Rejected now for two reasons, the second decisive: one pack smoke does not pay for a vitest project plus a script plus CI wiring plus default-gate exclusion logic; and a lane excluded from the default gate drifts toward never being run. file-preview's owner reached the same conclusion independently in review, and set the revisit condition this note adopts: **two to three spawn-heavy suites that genuinely belong in the default gate**. At that point the migration is a shared-layer change and gets its own note.

**Cap `--workspace-concurrency` on the recursive run.** This treats the actual cause — the machine is oversubscribed, not the tests slow. Rejected because it taxes every run for everyone, on every machine, to fix a budget that was simply set for a different kind of test. The oversubscription is also what CI does, and CI is fine with it.

## Consequences

- A hung test now takes 30s rather than 5s to report. That is the whole cost.
- The two config-less packages sit outside this fix by construction. Adding a `vitest.config.ts` to either would fold them in; neither needs one today.
- CI's green is not evidence about local timing, and this cuts both ways: the blind-spot table in [docs/development.md](../../../docs/development.md) covers what CI sees and local runs do not, and this incident is the reverse direction of the same seam.
