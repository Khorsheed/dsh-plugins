import { describe, expect, it } from 'vitest'
import { parseServerEntry, detectTransport, maskSecret, credentialStoredRefs, SECRET_REF_PREFIX } from '../src/mcps.ts'

describe('detectTransport', () => {
  it('stdlib via command', () => expect(detectTransport({ command: 'npx' })).toBe('stdio'))
  it('http via url', () => expect(detectTransport({ url: 'https://x/mcp' })).toBe('streamable-http'))
})

describe('parseServerEntry', () => {
  it('parses a stdio npx entry and extracts the env key as a credential ref', () => {
    const r = parseServerEntry('amap-maps', {
      command: 'npx', args: ['-y', '@amap/amap-maps-mcp-server'], env: { AMAP_MAPS_API_KEY: 'sk-123' },
    })
    expect(r.serverName).toBe('amap-maps')
    expect(r.config.transport).toBe('stdio')
    expect(r.config.command).toBe('npx')
    expect(r.config.args).toEqual(['-y', '@amap/amap-maps-mcp-server'])
    // The key value is replaced by a secretRef; the credential is declared.
    expect(r.config.env?.[0]?.[1]).toBe(`${SECRET_REF_PREFIX}AMAP_MAPS_API_KEY`)
    expect(r.credentials.map(c => c.label)).toEqual(['AMAP_MAPS_API_KEY'])
    expect(r.config.enabled).toBe(false)
  })

  it('parses a streamable-http entry (url + headers) and detects an auth header', () => {
    const r = parseServerEntry('amap-http', {
      url: 'https://mcp.amap.com/mcp?key=', headers: { Authorization: 'Bearer xyz' },
    })
    expect(r.config.transport).toBe('streamable-http')
    expect(r.config.url).toBe('https://mcp.amap.com/mcp?key=')
    expect(r.credentials.map(c => c.label)).toEqual(['Authorization'])
  })

  it('does not declare non-credential-ish env as credentials', () => {
    const r = parseServerEntry('s', { command: 'node', env: { LOG_LEVEL: 'debug' } })
    expect(r.credentials.length).toBe(0)
    expect(r.config.env?.[0]).toEqual(['LOG_LEVEL', 'debug'])
  })
})

describe('maskSecret', () => {
  it('masks secretRef values for display', () => {
    expect(maskSecret(`${SECRET_REF_PREFIX}x`)).toBe('·secretRef·')
    expect(maskSecret('plain')).toBe('plain')
  })
})

describe('credentialStoredRefs', () => {
  it('namespaces env, header, and query secret refs by server + kind', () => {
    const config = parseServerEntry('amap', {
      command: 'npx',
      env: { AMAP_KEY: 'sk' },
      headers: { Authorization: 'Bearer x' },
    }).config
    // Inject a header + URL secret, since the sample stdio entry has only env.
    const withHeader = {
      ...config,
      headers: [['Authorization', `${SECRET_REF_PREFIX}Authorization`]],
      url: 'https://mcp.amap.com?key=secretRef:amap-key',
    } as typeof config
    const refs = credentialStoredRefs('amap', withHeader)
    expect(refs['AMAP_KEY']).toBe('mcp.amap.env.AMAP_KEY')
    expect(refs['Authorization']).toBe('mcp.amap.header.Authorization')
    expect(refs['amap-key']).toBe('mcp.amap.query.amap-key')
  })

  it('ignores non-secret config values', () => {
    const config = parseServerEntry('s', { command: 'node', env: { LOG_LEVEL: 'debug' } }).config
    expect(credentialStoredRefs('s', config)).toEqual({})
  })
})
