import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // .module.css imports resolve to a class-map proxy instead of being parsed.
    css: true,
    // testing-library's auto-cleanup hooks the global afterEach.
    globals: true,
  },
  resolve: {
    alias: {
      // The browser platform module table lives in the host; tests resolve the
      // two runtime-value imports to local stubs (types still come from the
      // product libs through tsconfig paths).
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./tests/stubs/primitives.ts', import.meta.url)),
      '@deepseek-ai/dsh-client-runtime/client': fileURLToPath(new URL('./tests/stubs/runtime-client.ts', import.meta.url)),
    },
  },
})
