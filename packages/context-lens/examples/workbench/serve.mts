// Reuse the workspace test runner's Vite dependency; no production bundle or host.
import { dshTestConfig } from '../../../../build/vitest.ts'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const testRequire = createRequire(require.resolve('vitest/package.json'))
const { createServer } = await import(pathToFileURL(testRequire.resolve('vite')).href)
const root = fileURLToPath(new URL('.', import.meta.url))
const server = await createServer({
  ...dshTestConfig(),
  root, configFile: false,
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: Number(process.env.CONTEXT_LENS_PREVIEW_PORT ?? 4177), strictPort: true },
})
await server.listen()
server.printUrls()
