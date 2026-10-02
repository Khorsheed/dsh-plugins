// Component fixture only: no production server, credentials or host writes.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dshTestConfig } from '../../../../build/vitest.ts'
const require = createRequire(import.meta.url)
const testRequire = createRequire(require.resolve('vitest/package.json'))
const { createServer } = await import(pathToFileURL(testRequire.resolve('vite')).href)
const config = dshTestConfig()
const server = await createServer({
  root: fileURLToPath(new URL('.', import.meta.url)), configFile: false,
  esbuild: config.esbuild, resolve: { ...config.resolve, alias: [
    { find: 'preview-host-frame', replacement: join(process.env.DSH_HARNESS ?? join(homedir(), 'code/deepseek-harness'), 'packages/client/ui-layout/src/client/AppFrame.module.css') },
    { find: 'preview-host-panel', replacement: join(process.env.DSH_HARNESS ?? join(homedir(), 'code/deepseek-harness'), 'packages/client/ui-sidebar-right/src/client/shell/SidebarRight.module.css') },
    ...Object.entries(config.resolve.alias).map(([find, replacement]) => ({ find, replacement })),
  ] }, plugins: config.plugins,
  server: { host: '127.0.0.1', port: 8875, strictPort: true, fs: { allow: [fileURLToPath(new URL('../../../../', import.meta.url)), process.env.DSH_HARNESS ?? join(homedir(), 'code/deepseek-harness')] } },
})
await server.listen()
server.printUrls()
