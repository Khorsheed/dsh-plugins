import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { catalogMcpProfile } from './mcp-composition-fixture.ts'
import { officialCredentialRef } from '../src/mcp-official.ts'
import type { PersistedMcpState } from '../src/mcpStore.ts'

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

async function call(ctx: Context, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return ctx.tools.get(name)!.execute(args, { signal: AbortSignal.timeout(5_000) } as ToolRunContext)
}

async function persistedCatalog(path: string): Promise<PersistedMcpState> {
  const patch = load(await readFile(path, 'utf8')) as { id: string; config?: { mcp?: PersistedMcpState } }[]
  return patch.find(row => row.id === 'capability-catalog')!.config!.mcp!
}

describe('capability catalog in a real MCP manager composition', () => {
  it('uses official execution, rotates credentials, preserves tool filters, and removes its own entry', async () => {
    const ctx = await registry()
    const { profile, catalog, start } = await catalogMcpProfile(ctx, {
      servers: [{
        config: {
          serverName: 'fixture', transport: 'stdio', command: process.execPath,
          args: [fileURLToPath(new URL('fixture-mcp-server.ts', import.meta.url))],
          env: [['FIXTURE_TOKEN', 'secretRef:FIXTURE_TOKEN']], enabled: true,
        },
        tools: [],
      }],
      credentials: { 'mcp.fixture.env.FIXTURE_TOKEN': 'fixture-token-value' },
    })
    await ctx.plugin(CredentialsLocal, { dshHome: profile.home, watch: false })
    expect(catalog).toHaveProperty('mcpOfficial')
    await vi.waitFor(async () => {
      expect((await catalog.mcpSnapshot()).tools.fixture?.find(tool => tool.name === 'add')?.description, JSON.stringify({ snapshot: await catalog.mcpSnapshot(), manager: ctx.mcpManager.list(), logs: ctx.logger.buffer.map(message => message.args) })).toBe('Add two numbers')
    }, { timeout: 10_000 })
    expect((await catalog.mcpSnapshot()).tools.fixture?.find(tool => tool.name === 'add')?.parameters).toMatchObject({
      type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'],
    })
    expect(JSON.stringify(await call(ctx, 'mcp__fixture__credential'))).toContain('fixture-token-value')
    expect(ctx.mcpManager.config.servers.get().fixture?.enabled).toBe(true)
    expect(ctx.mcpManager.config.servers.get().fixture?.env.FIXTURE_TOKEN).toContain('${credential:')
    expect(ctx.mcpManager.config.servers.get().fixture?.env.FIXTURE_TOKEN).not.toContain('fixture-token-value')
    await catalog.mcpSetCredential('mcp.fixture.env.FIXTURE_TOKEN', 'rotated-token-value')
    await vi.waitFor(async () => { expect(JSON.stringify(await call(ctx, 'mcp__fixture__credential'))).toContain('rotated-token-value') })
    await vi.waitFor(async () => { expect((await persistedCatalog(profile.patchPath)).migration?.official).toEqual(['fixture']) })
    const persisted = await persistedCatalog(profile.patchPath)
    await ctx.fiber.dispose()

    const reopened = await registry()
    await start(reopened)
    await reopened.plugin(CredentialsLocal, { dshHome: profile.home, watch: false })
    await vi.waitFor(async () => { expect(JSON.stringify(await call(reopened, 'mcp__fixture__credential'))).toContain('rotated-token-value') }, { timeout: 10_000 })
    expect(persisted.migration?.official).toEqual(['fixture'])
    await reopened.capabilityCatalog.mcpSetToolEnabled('fixture', 'credential', false)
    expect(reopened.mcpManager.config.servers.get().fixture?.enabled).toBe(false)
    expect(reopened.tools.get('mcp__fixture__credential')).toBeUndefined()
    expect(JSON.stringify(await call(reopened, 'mcp__fixture__add', { a: 2, b: 4 }))).toContain('6')
    await reopened.capabilityCatalog.mcpSetToolEnabled('fixture', 'credential', true)
    await vi.waitFor(async () => { expect(JSON.stringify(await call(reopened, 'mcp__fixture__credential'))).toContain('rotated-token-value') }, { timeout: 10_000 })
    await reopened.capabilityCatalog.mcpDiscover('fixture')
    await vi.waitFor(async () => { expect((await reopened.capabilityCatalog.mcpSnapshot()).tools.fixture?.find(tool => tool.name === 'add')?.description).toBe('Add two numbers') })
    expect(await reopened.capabilityCatalog.mcpRemove('fixture')).toBe(true)
    await vi.waitFor(() => { expect(reopened.tools.get('mcp__fixture__add')).toBeUndefined() })
    expect(reopened.mcpManager.config.servers.get().fixture).toBeUndefined()
    expect(await reopened.credentials.resolve(credentialRef(officialCredentialRef('env', 'mcp.fixture.env.FIXTURE_TOKEN')))).toBeUndefined()
    expect((await reopened.capabilityCatalog.mcpSnapshot()).servers).toEqual([])
  }, 60_000)
})
