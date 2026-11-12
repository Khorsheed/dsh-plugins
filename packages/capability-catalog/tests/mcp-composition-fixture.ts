import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { onTestFinished } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { initProfile, mountRootInclude, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import McpServerManager from '@deepseek-ai/dsh-mcp-manager'
import CapabilityCatalogService from '../src/index.ts'
import type { PersistedMcpState } from '../src/mcpStore.ts'

/** Mount the real manager and catalog through the same Settings and Loader as production. */
export async function catalogMcpProfile(ctx: Context, mcp: PersistedMcpState) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-catalog-mcp-')))
  const contexts: Context[] = []
  onTestFinished(async () => {
    for (const context of contexts) await context.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  const dir = join(home, 'profile')
  initProfile(dir, ['test-mcp-bundle'])
  const bundle = join(dir, 'node_modules', 'test-mcp-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-mcp-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'mcp-manager', name: 'cordis:mcp-manager', config: { servers: {} } },
    { id: 'capability-catalog', name: 'cordis:capability-catalog', config: { mcp } },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-mcp-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const start = async (context: Context) => {
    contexts.push(context)
    context.baseUrl = pathToFileURL(home).href + '/'
    context.provide('profileContext', profile)
    await context.plugin(Loader)
    context.loader.builtins['mcp-manager'] = McpServerManager
    context.loader.builtins['capability-catalog'] = CapabilityCatalogService
    await context.plugin(ConfigEditor)
    await context.plugin(Settings)
    await mountRootInclude(context, join(dir, 'cordis.yml'), readProfilePatches('test', profile))
    await context.loader.await()
    return context.capabilityCatalog
  }
  return { profile, catalog: await start(ctx), start }
}
