import { defineConfig } from 'vitest/config'

// The checkers' own specs are repo-root scripts only. The positional
// `vitest run scripts` filter is a substring match, so a nested harness
// checkout (CI clones deepseek-harness/ into the workspace as the type/test
// seed) would drag deepseek-harness/scripts/*.spec.ts into the run.
export default defineConfig({
  test: {
    include: ['scripts/*.spec.ts'],
  },
})
