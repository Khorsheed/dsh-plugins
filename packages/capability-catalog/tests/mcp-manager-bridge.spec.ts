import { describe, expect, it, vi } from 'vitest'
import { McpStore } from '../src/mcpStore.ts'
import { McpManagerBridge, type McpManagerSlice, type McpOfficialCredentials, type McpOfficialSettings } from '../src/mcp-manager-bridge.ts'
import { officialCredentialRef, officialMcpEntry, officialPublicToolName } from '../src/mcp-official.ts'
import { publicToolName as legacyPublicToolName } from '../src/mcpTools.ts'
import type { OfficialMcpEntry } from '../src/mcp-official.ts'

const config = { serverName: 'fixture', transport: 'stdio' as const, command: 'node', args: ['server.ts'], env: [['TOKEN', 'secretRef:TOKEN']], enabled: true }

function fixture(probeOk = true) {
  const entries: Record<string, OfficialMcpEntry> = {}
  const manager: McpManagerSlice = {
    config: { servers: { get: () => entries } },
    list: () => Object.keys(entries).map(name => ({ name, configured: true, status: { state: 'connected' } })),
    probe: vi.fn(async () => ({ ok: probeOk, toolNames: ['echo'], closeConfirmed: true })),
    restart: vi.fn(async () => {}),
    watch: async function* () {},
  }
  const settings: McpOfficialSettings = {
    update: async (_ns, patch) => { Object.assign(entries, (patch.servers ?? {}) as Record<string, OfficialMcpEntry>) },
    mutate: async (_ns, ops) => {
      for (const op of ops) if (op.op === 'unset' && op.path[0] === 'servers') delete entries[op.path[1]!]
    },
  }
  const secrets = new Map<string, string>()
  const credentials: McpOfficialCredentials = {
    resolve: async ref => secrets.has(ref) ? { value: secrets.get(ref)! } : undefined,
    set: async (ref, value) => { secrets.set(ref, value) },
    unset: async ref => { secrets.delete(ref) },
  }
  const store = new McpStore()
  const bridge = new McpManagerBridge(store, manager, settings, {
    schemas: () => [{ name: 'mcp__fixture__echo', description: 'Echo input', parameters: { type: 'object', properties: { text: { type: 'string' } } } }],
  }, credentials, () => {}, () => {})
  return { entries, manager, store, bridge, secrets }
}

describe('official MCP configuration projection', () => {
  it('preserves surrounding text and separates all three credential kinds', () => {
    const entry = officialMcpEntry({ serverName: 'remote', transport: 'streamable-http', url: 'https://example.invalid/mcp?key=secretRef:KEY', headers: [['Authorization', 'Bearer secretRef:TOKEN'], ['KEY', 'secretRef:KEY']], env: [['KEY', 'secretRef:KEY']], enabled: true })
    expect(entry.url).toBe(`https://example.invalid/mcp?key=\${credential:${officialCredentialRef('query', 'mcp.remote.query.KEY')}}`)
    expect(entry.headers['Authorization']).toBe(`Bearer \${credential:${officialCredentialRef('header', 'mcp.remote.header.TOKEN')}}`)
    expect(entry.headers.KEY).not.toBe(entry.env.KEY)
    expect(officialCredentialRef('env', 'mcp.remote.env.KEY')).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
  })

  it('does not reuse the legacy hash for normalized tool names', () => {
    expect(officialPublicToolName('server', 'admin.reset')).not.toBe(legacyPublicToolName('server', 'admin.reset'))
    expect(officialPublicToolName('server', 'plain')).toBe('mcp__server__plain')
    expect(officialPublicToolName('server', 'x'.repeat(100))).toHaveLength(64)
  })
})

describe('McpManagerBridge', () => {
  it('migrates credentials and tool metadata and restores official ownership', async () => {
    const { store, bridge, entries, secrets, manager } = fixture()
    store.add(config)
    store.setCredential('mcp.fixture.env.TOKEN', 'secret-value')
    await bridge.reconcile()
    expect(store.isOfficial('fixture')).toBe(true)
    expect(entries.fixture?.enabled).toBe(true)
    expect(entries.fixture?.env.TOKEN).toContain('${credential:MCP_ENV_')
    expect(JSON.stringify(entries)).not.toContain('secret-value')
    expect(secrets.get(officialCredentialRef('env', 'mcp.fixture.env.TOKEN'))).toBe('secret-value')
    expect(store.toolsByServer().fixture?.[0]).toMatchObject({ name: 'echo', description: 'Echo input' })
    expect(bridge.legacyServers()).toEqual([])
    const persisted = store.toPersisted()
    const restored = new McpStore()
    restored.loadFrom(persisted)
    expect(restored.isOfficial('fixture')).toBe(true)
    expect(restored.toPersisted()).toEqual(persisted)
    await bridge.reconcile()
    expect(manager.probe).toHaveBeenCalledWith('fixture')
  })

  it('restores the original credential and legacy server when probe fails', async () => {
    const { store, bridge, entries, secrets } = fixture(false)
    const ref = officialCredentialRef('env', 'mcp.fixture.env.TOKEN')
    secrets.set(ref, 'previous-value')
    store.add(config)
    store.setCredential('mcp.fixture.env.TOKEN', 'new-value')
    await bridge.reconcile()
    expect(store.isOfficial('fixture')).toBe(false)
    expect(entries.fixture?.enabled).toBe(false)
    expect(secrets.get(ref)).toBe('previous-value')
    expect(bridge.legacyServers().map(server => server.serverName)).toEqual(['fixture'])
  })

  it('uses the legacy bridge for a tool filter, then migrates back when all tools are enabled', async () => {
    const { store, bridge, entries } = fixture()
    store.add(config)
    store.setCredential('mcp.fixture.env.TOKEN', 'secret-value')
    await bridge.reconcile()
    expect(store.isOfficial('fixture')).toBe(true)
    store.setToolEnabled('fixture', 'echo', false)
    await bridge.reconcile()
    expect(store.isOfficial('fixture')).toBe(false)
    expect(entries.fixture?.enabled).toBe(false)
    expect(bridge.legacyServers()).toHaveLength(1)
    store.setToolEnabled('fixture', 'echo', true)
    await bridge.reconcile()
    expect(store.isOfficial('fixture')).toBe(true)
    expect(entries.fixture?.enabled).toBe(true)
    expect(bridge.legacyServers()).toEqual([])
  })

  it('never overwrites or double-registers a foreign server', async () => {
    const { store, bridge, entries } = fixture()
    entries.fixture = { ...officialMcpEntry(config), command: 'another-command' }
    store.add(config)
    await bridge.reconcile()
    expect(await bridge.prepareEdit(config)).toBe(false)
    expect(entries.fixture.command).toBe('another-command')
    expect(bridge.legacyServers()).toEqual([])
  })

  it('unsets only its own manager entry and credentials on removal', async () => {
    const { store, bridge, entries, secrets } = fixture()
    store.add(config)
    store.setCredential('mcp.fixture.env.TOKEN', 'secret-value')
    await bridge.reconcile()
    await bridge.remove('fixture')
    expect(entries.fixture).toBeUndefined()
    expect(secrets.size).toBe(0)
    expect(store.list()).toEqual([])
    expect(store.toPersisted().migration).toBeUndefined()
  })
})
