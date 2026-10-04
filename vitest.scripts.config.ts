import { defineConfig } from 'vitest/config'

// The checkers' own specs are repo-root scripts only. The positional
// `vitest run scripts` filter is a substring match, so a nested harness
// checkout (CI clones deepseek-harness/ into the workspace as the type/test
// seed) would drag deepseek-harness/scripts/*.spec.ts into the run.
export default defineConfig({
  test: {
    include: ['scripts/*.spec.ts'],
    // These are integration specs, not unit tests: deploy-3080.spec.ts
    // spawns the real orchestrator (its own budget is set in that file), and
    // the tree-scanning checkers walk the installed .pnpm store. The 5s
    // default made both flap red on any loaded machine while passing
    // standalone.
    testTimeout: 30_000,
    // `[vitest-worker]: Timeout calling "onTaskUpdate"` with every assertion
    // green is not machine load starving vitest: it is a worker whose event
    // loop stayed blocked by synchronous test bodies past birpc's hardcoded
    // 60s, so the reply was never read (2026-10-04: reproduced with
    // deploy-3080.spec.ts alone, 98s of spawnSync). The setup file yields once
    // per test; a single test body must still not block 60s on its own — use
    // async subprocesses, as deploy-3080.spec.ts does. See build/vitest-yield.ts.
    setupFiles: ['./build/vitest-yield.ts'],
    maxWorkers: 4,
  },
})
