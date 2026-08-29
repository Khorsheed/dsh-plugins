import { describe, expect, it } from 'vitest'
import { McpStore } from '../src/mcpStore.ts'
import { SECRET_REF_PREFIX } from '../src/mcps.ts'

describe('McpStore persistence', () => {
  it('round-trips servers, credentials, enabled flags, and tools', () => {
    const store = new McpStore()
    store.add({
      serverName: 'amap',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@amap/amap-maps-mcp-server'],
      env: [['AMAP_KEY', `${SECRET_REF_PREFIX}AMAP_KEY`]],
      enabled: false,
    })
    store.setEnabled('amap', true)
    store.setCredential('mcp.amap.env.AMAP_KEY', 'sk-secret')
    store.setToolEnabled('amap', 'geocode', false)

    const persisted = store.toPersisted()
    expect(persisted.servers).toHaveLength(1)
    expect(persisted.servers?.[0]?.config.enabled).toBe(true)
    expect(persisted.servers?.[0]?.config.env?.[0]?.[1]).toBe(`${SECRET_REF_PREFIX}AMAP_KEY`)
    expect(persisted.credentials).toEqual({ 'mcp.amap.env.AMAP_KEY': 'sk-secret' })

    // A fresh store seeded from the persisted state reconstructs everything.
    const restored = new McpStore()
    let persistedMapCount = 0
    restored.onPersist = () => { persistedMapCount += 1 }
    restored.loadFrom(persisted)
    expect(restored.list()).toEqual(store.list())
    expect(restored.credentials().map(c => c.ref)).toEqual(['mcp.amap.env.AMAP_KEY'])
    expect(restored.credentials()[0]?.configured).toBe(true)
    // loadFrom is not a mutation — it must not fire onPersist back to the document.
    expect(persistedMapCount).toBe(0)
  })

  it('survives an empty persisted state', () => {
    const store = new McpStore()
    store.loadFrom({ servers: [], credentials: {} })
    expect(store.list()).toEqual([])
    expect(store.credentials()).toEqual([])
  })
})
