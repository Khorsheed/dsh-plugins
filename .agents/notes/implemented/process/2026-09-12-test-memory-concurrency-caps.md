# Agent Note: Bound test/build memory by forks-per-GB and workspace concurrency 2

Status: implemented

## Problem

On a 16GB / 8-core machine a repo-wide `pnpm run test` (and `pnpm gate`'s test step) was memory-hostile: pnpm `-r` runs 4 packages concurrently by default, and each package's vitest instance forked one worker per CPU — up to 4 × 8 = 32 node processes, each transforming the harness source plane at several hundred MB RSS. Measured baseline on this machine: ~5.1GB peak node RSS for the test stage alone, before counting the editor, the harness, and whatever other agents were running — the gate's worst reds were timeouts caused by the resulting memory pressure, not by broken code. The same multiplier applied to the build stage (4 concurrent `tsc -b` + tsdown pairs).

## Decision

The memory ceiling becomes a config property instead of a load accident:

- `build/vitest.ts` (`dshTestConfig`) caps each package's forks at `max(2, min(cpus, floor(memGB / 4)))` — a 16GB machine gets 4, an 8GB machine 2, a 64GB machine 8 (still CPU-bound). `DSH_TEST_MAX_WORKERS` overrides on any vitest version; vitest ≥4 also honors its native `VITEST_MAX_WORKERS` over the config value.
- `vitest.scripts.config.ts` caps the repo-root checker specs at 4 workers (they are subprocess-heavy integration specs).
- The root `build`/`test` scripts and `pnpm gate`'s build/test steps run pnpm with `--workspace-concurrency=2` (from the default 4).

Worst case is now 2 instances × 4 forks ≈ 8 test forks instead of 32.

## Alternatives considered

- **Limiting only the gate, not the root scripts** — the same OOM hits any agent running `pnpm run test` directly (the documented entry point), so the caps live at the shared layers both paths use.
- **A fixed worker count (e.g. 2) everywhere** — simple, but punishes both small machines (no adaptive floor) and large ones (a 64GB runner deserves its CPUs); the per-GB formula scales without a knob.
- **vitest `pool: 'threads'`** — threads share one address space and would cut RSS the most, but several suites spawn real subprocesses and rely on process isolation semantics (cwd, env, ports); changing the pool is a behavioral risk this change deliberately does not take.
- **Concurrency 1** — safest and slowest; measurements showed concurrency 2 with 4 forks keeps the whole-repo test wall time unchanged (~190s vs ~192s baseline), so there was no wall-time reason to serialize further.

## Consequences

- Measured on the same machine: peak node RSS ~5.1GB → ~3.9GB and average ~2.3GB → ~1.8GB across a run that additionally included two full cold builds; the test wall time is unchanged. The ceiling is now deterministic — 2 × 4 forks — rather than 4 × CPU-count.
- Single-package runs (`pnpm --filter <pkg> test`, the documented inner loop) keep up to 4 forks on a 16GB machine; big-memory machines keep their CPU count.
- Given up: some wall-time headroom on machines that could absorb 32 forks — they can reclaim it with `DSH_TEST_MAX_WORKERS` / `--workspace-concurrency`.
- The cold-build companion-tool ordering race (`*-tool` tsc starting before its core's lib exists) was a separate pre-existing problem this change did not touch. It has since been diagnosed and fixed: the cause was NOT "pnpm ignores dev/peer edges for run ordering" as an earlier version of this bullet claimed — peer and dev edges DO count in pnpm's projects graph — but the core↔companion dependency cycle formed by the reverse manifest edges, which the sequencer schedules into one concurrent chunk. The shipped mechanism (one-direction edges + `dsh.references` for data mentions) is recorded in [the companion-edge-cycle Agent Note](../../implemented/process/2026-09-12-companion-edge-cycle-cold-build.md).

## Testing

Repeated full-repo `pnpm run build` and `pnpm run test` green in the worktree with the caps active; RSS sampled at 3s intervals before/after (`ps` sum over node processes); `pnpm gate` green.
