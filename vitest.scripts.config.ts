import { defineConfig } from 'vitest/config'

// The checkers' own specs are repo-root scripts only. The positional
// `vitest run scripts` filter is a substring match, so a nested harness
// checkout (CI clones deepseek-harness/ into the workspace as the type/test
// seed) would drag deepseek-harness/scripts/*.spec.ts into the run.
export default defineConfig({
  test: {
    include: ['scripts/*.spec.ts'],
    // These are integration specs, not unit tests: deploy-3080.spec.ts
    // spawnSyncs the real orchestrator with an inner 15s process timeout, and
    // the tree-scanning checkers walk the installed .pnpm store. The 5s
    // default made both flap red on any loaded machine while passing
    // standalone; 30s covers the inner spawn timeout with headroom.
    testTimeout: 30_000,
    // Known flake signature under heavy multi-agent load (2026-09-28):
    // `[vitest-worker]: Timeout calling "onTaskUpdate"` with every assertion
    // green. deploy-3080.spec.ts blocks its worker's event loop with
    // spawnSync; birpc's RPC timeout is a hardcoded 60s with no vitest config
    // knob, so a process starved past that (swap pressure, several builds at
    // once) fails the run after the assertions already passed. A red run with
    // that message means "rerun on a quieter machine", not a regression.
    maxWorkers: 4,
  },
})
