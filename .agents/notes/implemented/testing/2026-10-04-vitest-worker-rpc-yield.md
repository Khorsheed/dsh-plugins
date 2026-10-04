# Agent Note: Test workers yield every test so vitest's RPC replies are read

Status: implemented

[English](2026-10-04-vitest-worker-rpc-yield.md) | [中文](2026-10-04-vitest-worker-rpc-yield.zh.md)

## Problem

Plugin deploys and merges kept failing `pnpm gate` at the script-tests stage with every assertion green and one unhandled error: `[vitest-worker]: Timeout calling "onTaskUpdate"`. Agents read it as "the machine is overloaded, retry", and the comment in `vitest.scripts.config.ts` said the same ("rerun on a quieter machine"). Retries on a loaded machine kept failing, so each deploy burned several gate runs.

The actual mechanism is in the worker, not the main process. vitest 3.2.7 reports each test start over a birpc request whose 60s timer (`DEFAULT_TIMEOUT = 6e4`, no config knob) runs **in the worker**. The main process answers within milliseconds, but the worker only reads the answer when its own event loop reaches the poll phase, and the runner never yields between tests. `scripts/deploy-3080.spec.ts` ran the real orchestrator through `spawnSync` in all 26 tests, so the whole file was one synchronous block. When the block ends, Node runs the timers phase before the poll phase: the 60s timer fires ahead of the reply that has been sitting in the queue. Load does not cause the failure. It stretches the block over the line: the file takes 44s on an idle machine and 100–150s under multi-agent load.

Evidence (2026-10-04):

- `deploy-3080.spec.ts` run **alone** (no concurrent spec files, idle main process) at load average 29 took 98s and reproduced the error, with 26/26 passing.
- The same file at load average 39 with a one-tick yield before each test took 126s and produced no error.
- A synthetic spec of three 25s busy-wait tests fails without the yield and passes with it, regardless of machine load.

Ankh Guard hit the same root cause on 2026-09-08 with a single 71.2s synchronous test body ([test admission note](2026-09-08-test-admission-and-lane-diagnostics.md)). That fix covered only the one test and was never applied repo-wide.

## Decision

- **Async subprocesses in deploy-3080.spec.ts (the root fix).** Both fixtures' `run()` go through one `runOrchestrator` helper built on async `spawn`. The `{ status, output, calls }` result shape is unchanged, and every test awaits the call. The worker's event loop stays live while the orchestrator runs.
- **An honest per-run budget.** The first gate run after the async change failed differently: one orchestrator run was SIGTERMed by the old 15s budget at +13s mid-flow (`status` null). That budget was always too tight for a loaded machine. One test also ran the orchestrator twice under a 15s test timeout. The budget only has to catch a hang, so it is now `RUN_BUDGET_MS = 60_000`. The file sets `testTimeout` to 150s through `vi.setConfig` (enough for two runs), and the two tighter per-test overrides are gone. Async runs make long tests safe for the worker's RPC; vitest still enforces test timeouts on synchronous bodies after they finish, so no timeout semantics changed.
- **A repo-wide yield safety net.** `build/vitest-yield.ts` registers `beforeEach(() => new Promise(r => setImmediate(r)))`. `setImmediate` resumes in the check phase, after poll, so replies queued since the previous test are drained. It is wired into both test configs: `vitest.scripts.config.ts` (`setupFiles`) and the package preset `build/vitest.ts` (`dshTestConfig`). The unyielded window shrinks from "a whole file" to "one test".
- **The convention.** A single test body must not block its worker for 60s. Long subprocesses in tests are spawned asynchronously. The yield cannot rescue one test that blocks on its own.

## Alternatives considered

- **Gate auto-retry on this error signature.** Hides the defect. On a loaded machine the retry hits the same block and fails again, which is exactly the repeated-attempt cost this change removes.
- **Patching vitest/birpc to raise the 60s timeout.** Treats the symptom: the block remains and only the threshold moves. It also adds a patched dependency to maintain across vitest upgrades.
- **Lowering `maxWorkers` / gate concurrency.** Does nothing. The single-file reproduction had no concurrent spec files.
- **`describe.concurrent` for the deploy spec.** Would cut wall time, but it runs up to five orchestrators at once inside one test file. On a loaded machine that pushes individual runs toward the 15s process budget, so it is deferred.

## Consequences

- The `onTaskUpdate` timeout no longer depends on load for any file whose individual tests each stay under 60s. That covers every current spec.
- Each test pays one extra event-loop tick, which is negligible.
- `packages/taskpilot` uses its own vitest config, not the preset, and does not get the yield. It has no synchronous subprocess tests.
- Package specs still call `execFileSync` for short git/tar/pnpm-pack steps (ankh-guard, datasets, eval, inline-html-render). The yield covers them; they need converting only if a single test approaches 60s.
- Follow-up signal: track how often gate fails at script tests after this lands. A reappearance of the error points to one test body blocking 60s by itself.

## Testing

- In the worktree: `pnpm run test:scripts` passed with 298 tests passed and 2 skipped (the skill-bundle smoke is skipped because the untracked `skills/` content exists only in the main checkout). `deploy-3080.spec.ts` alone passed 26/26.
- The synthetic 3×25s busy-wait spec was run side by side: without the setup file it reported the `onTaskUpdate` timeout, with it all three tests passed and there was no error. The probe files were removed afterwards.
