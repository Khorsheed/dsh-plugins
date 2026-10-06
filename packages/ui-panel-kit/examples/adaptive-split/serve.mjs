// Reuse the workspace test runner's Vite dependency; no production bundle or host.
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const testRequire = createRequire(require.resolve('vitest/package.json'))
const { createServer } = await import(pathToFileURL(testRequire.resolve('vite')).href)
const root = fileURLToPath(new URL('.', import.meta.url))
const server = await createServer({
  root, configFile: false,
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: Number(process.env.MOBILE_PREVIEW_PORT ?? 8873), strictPort: true },
})
await server.listen()
server.printUrls()
