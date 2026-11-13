import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { McpStore } from '../src/mcpStore.ts'
import { McpManagerBridge } from '../src/mcp-manager-bridge.ts'
import { officialPublicToolName } from '../src/mcp-official.ts'
import { desiredMcpTools, reconcileRegisteredMcpTools } from '../src/mcpTools.ts'
import type { ToolSchemaLike } from '../src/tool-face.ts'

interface ProfileFixture {
  profile: { home: string; patchPath: string }
  start(ctx: Context): Promise<unknown>
}

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function registry(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function mountBridge(ctx: Context, store: McpStore): McpManagerBridge {
  const disposers = new Map<string, () => void>()
  const bridge = new McpManagerBridge(store, ctx.mcpManager, ctx.settings, {
    schemas: () => ctx.tools.schemas() as ToolSchemaLike[],
  }, {
    resolve: ref => ctx.credentials.resolve(credentialRef(ref)),
    set: (ref, value) => ctx.credentials.set(credentialRef(ref), value),
    unset: ref => ctx.credentials.unset(credentialRef(ref)),
  }, message => console.warn(message), () => {
    reconcileRegisteredMcpTools(desiredMcpTools(bridge.legacyServers(), store.toolsByServer()), {
      register: definition => ctx.tools.register(definition),
      onRegisterError: error => { throw error },
    }, disposers, (server, raw, args) => store.callTool(server, raw, args))
  })
  return bridge
}

async function call(ctx: Context, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = ctx.tools.get(name)
  expect(tool).toBeDefined()
  return tool!.execute(args, { signal: AbortSignal.timeout(5_000) } as ToolRunContext)
}

describe('official MCP manager over a real stdio server', () => {
  it('migrates, executes, survives restart, and switches a tool filter without duplicates', async () => {
    const harness = process.env.DSH_HARNESS ?? fileURLToPath(new URL('../../../../deepseek-harness', import.meta.url))
    const { managerProfile } = await import(pathToFileURL(join(harness, 'packages/mcp/mcp-manager/tests/profile-fixture.ts')).href) as {
      managerProfile(ctx: Context, options: { id: string; base: unknown }): Promise<ProfileFixture>
    }
    const ctx = await registry()
    const { profile, start } = await managerProfile(ctx, { id: 'mcp-manager', base: { servers: {} } })
    await ctx.plugin(CredentialsLocal, { dshHome: profile.home, watch: false })
    const store = new McpStore()
    store.add({
      serverName: 'fixture', transport: 'stdio', command: process.execPath,
      args: [fileURLToPath(new URL('fixture-mcp-server.ts', import.meta.url))],
      env: [['FIXTURE_TOKEN', 'secretRef:FIXTURE_TOKEN']], enabled: true,
    })
    store.setCredential('mcp.fixture.env.FIXTURE_TOKEN', 'fixture-token-value')
    const bridge = mountBridge(ctx, store)
    await bridge.reconcile()
    expect(store.isOfficial('fixture')).toBe(true)
    expect(store.toolsByServer().fixture?.find(tool => tool.name === 'add')?.parameters).toMatchObject({
      type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'],
    })
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__fixture__add')).toBeDefined() })
    await bridge.refresh('fixture')
    expect(store.toolsByServer().fixture?.find(tool => tool.name === 'add')?.description).toBe('Add two numbers')
    expect(ctx.tools.get(officialPublicToolName('fixture', 'admin.reset'))).toBeDefined()
    expect(ctx.tools.schemas().filter(tool => tool.name === 'mcp__fixture__add')).toHaveLength(1)
    expect(JSON.stringify(await call(ctx, 'mcp__fixture__add', { a: 1, b: 2 }))).toContain('3')
    expect(JSON.stringify(await call(ctx, 'mcp__fixture__credential', {}))).toContain('fixture-token-value')
    expect(await readFile(profile.patchPath, 'utf8')).not.toContain('fixture-token-value')
    const persisted = store.toPersisted()
    await ctx.fiber.dispose()

    const reopened = await registry()
    await start(reopened)
    await reopened.plugin(CredentialsLocal, { dshHome: profile.home, watch: false })
    const restored = new McpStore()
    restored.loadFrom(persisted)
    const reopenedBridge = mountBridge(reopened, restored)
    await reopenedBridge.reconcile()
    await vi.waitFor(() => { expect(reopened.tools.get('mcp__fixture__add'), JSON.stringify(reopened.mcpManager.list())).toBeDefined() }, { timeout: 5_000 })
    expect(JSON.stringify(await call(reopened, 'mcp__fixture__credential', {}))).toContain('fixture-token-value')
    expect(reopened.tools.schemas().filter(tool => tool.name === 'mcp__fixture__add')).toHaveLength(1)

    const official = reopened.tools.get('mcp__fixture__add')
    restored.setToolEnabled('fixture', 'credential', false)
    await reopenedBridge.reconcile()
    await vi.waitFor(() => { expect(reopened.tools.get('mcp__fixture__add')).not.toBe(official) })
    expect(restored.isOfficial('fixture')).toBe(false)
    expect(reopened.mcpManager.config.servers.get().fixture?.enabled).toBe(false)
    expect(reopened.tools.get('mcp__fixture__credential')).toBeUndefined()
    expect(JSON.stringify(await call(reopened, 'mcp__fixture__add', { a: 2, b: 3 }))).toContain('5')

    restored.setToolEnabled('fixture', 'credential', true)
    await reopenedBridge.reconcile()
    await vi.waitFor(() => { expect(reopened.tools.get('mcp__fixture__credential'), JSON.stringify(reopened.mcpManager.list())).toBeDefined() }, { timeout: 10_000 })
    expect(restored.isOfficial('fixture')).toBe(true)
    expect(reopened.tools.schemas().filter(tool => tool.name === 'mcp__fixture__add')).toHaveLength(1)
    expect(JSON.stringify(await call(reopened, 'mcp__fixture__credential', {}))).toContain('fixture-token-value')
    await reopenedBridge.discover('fixture')
    expect(reopened.mcpManager.config.servers.get().fixture?.enabled).toBe(true)
    expect(await reopenedBridge.remove('fixture')).toBe(true)
    await vi.waitFor(() => { expect(reopened.tools.get('mcp__fixture__add')).toBeUndefined() })
  }, 60_000)
})
