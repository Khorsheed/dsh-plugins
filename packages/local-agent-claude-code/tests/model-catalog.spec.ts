import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ClaudeModelCatalog, claudeDirectory } from '../src/model-catalog.ts'
import type { ClaudeEndpointAuth, EndpointCheckFetch } from '../src/endpoint-auth.ts'

const native = { models: [
  { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-current', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
  { value: 'sonnet', displayName: 'Sonnet', resolvedModel: 'claude-sonnet-current' },
] }

describe('claudeDirectory (the live driver’s CLI-native fold)', () => {
  it('retains native aliases, resolved names and effort values without inventing model IDs', () => {
    expect(claudeDirectory(native)).toMatchObject({ complete: true, customInput: true, defaultModel: 'default', entries: [
      { value: 'default', label: 'Default (recommended)', resolvedModel: 'claude-current', reasoning: { options: [{ value: 'low' }, { value: 'high' }] } },
      { value: 'sonnet', source: 'native' },
    ] })
    expect(claudeDirectory(native).entries[1]?.reasoning).toBeUndefined()
    expect(claudeDirectory({})).toMatchObject({ unsupported: true, complete: false })
    expect(() => claudeDirectory({ models: 'invalid' })).toThrow('invalid model directory')
  })
})

interface Mount {
  home: string
  catalog: ClaudeModelCatalog
  calls: { url: string; headers: Record<string, string> }[]
  setEndpoint(endpoint: ClaudeEndpointAuth): void
  respond(status: number, body: string): void
  fail(message: string): void
}

/** A catalog over an endpoint resolver and a stubbed /v1/models fetch. */
function mount(endpoint: ClaudeEndpointAuth): Mount {
  const home = mkdtempSync(join(tmpdir(), 'claude-directory-'))
  const calls: Mount['calls'] = []
  let current = endpoint
  let status = 200
  let body = JSON.stringify({ data: [
    { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', effort: { supported: true, low: { supported: true }, high: { supported: true } } },
    { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' },
  ] })
  let failure: string | undefined
  const fetchImpl: EndpointCheckFetch = async (url, init) => {
    calls.push({ url, headers: init.headers })
    if (failure !== undefined) throw new Error(failure)
    return { ok: status >= 200 && status < 300, status, text: async () => body }
  }
  const catalog = new ClaudeModelCatalog({
    endpoint: async () => current,
    fetchImpl,
    ttlMs: 0,
  })
  return {
    home,
    catalog,
    calls,
    setEndpoint(next) { current = next },
    respond(nextStatus, nextBody) { status = nextStatus; body = nextBody; failure = undefined },
    fail(message) { failure = message },
  }
}

describe('ClaudeModelCatalog (the endpoint-served directory)', () => {
  it('lists the endpoint’s served models with display names and effort options', async () => {
    const m = mount({ baseUrl: 'https://relay.example.com/claude/', apiKey: 'sk-test' })
    const directory = await m.catalog.refresh(m.home)
    expect(m.calls[0]?.url).toBe('https://relay.example.com/claude/v1/models')
    expect(m.calls[0]?.headers['x-api-key']).toBe('sk-test')
    expect(directory.status).toBe('ready')
    expect(directory).toMatchObject({
      complete: true,
      customInput: true,
      entries: [
        { value: 'claude-opus-5-5', label: 'Claude Opus 5.5', source: 'native', reasoning: { options: [{ value: 'low' }, { value: 'high' }] } },
        { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
      ],
    })
    m.catalog.dispose()
  })

  it('reads the effort block from capabilities.effort when the endpoint nests it (the relayed shape)', async () => {
    const m = mount({ baseUrl: 'https://relay.example.com/claude', apiKey: 'sk-test' })
    // The shape openproxy actually proxies (verified 2026-10-22): no top-level
    // `effort`; the per-level map lives at capabilities.effort.
    m.respond(200, JSON.stringify({ data: [
      { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: true }, max: { supported: true } } } },
      { id: 'claude-fable-5-1', display_name: 'Claude Fable 5.1', capabilities: { thinking: { supported: true } } },
    ] }))
    const directory = await m.catalog.refresh(m.home)
    expect(directory.status).toBe('ready')
    expect(directory.entries).toMatchObject([
      { value: 'claude-sonnet-5-5', reasoning: { options: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }, { value: 'max' }] } },
      { value: 'claude-fable-5-1' },
    ])
    expect(directory.entries[1]?.reasoning).toBeUndefined()
    m.catalog.dispose()
  })

  it('answers unsupported with a configure-first reason when no credential resolves', async () => {
    const m = mount({ baseUrl: 'https://relay.example.com' })
    const directory = await m.catalog.refresh(m.home)
    expect(m.calls).toHaveLength(0)
    expect(directory).toMatchObject({ entries: [], unsupported: true })
    expect(directory.reason).toContain('No endpoint credential')
    m.catalog.dispose()
  })

  it('answers unsupported with the rejection on a 401 — an invalid key shows no list', async () => {
    const m = mount({ baseUrl: 'https://relay.example.com', apiKey: 'sk-dead' })
    m.respond(401, '{"error":"invalid x-api-key"}')
    const directory = await m.catalog.refresh(m.home)
    expect(directory).toMatchObject({ entries: [], unsupported: true })
    expect(directory.reason).toContain('401')
    m.catalog.dispose()
  })

  it('answers unsupported when the relay serves no model route', async () => {
    const m = mount({ baseUrl: 'https://relay.example.com', apiKey: 'sk-test' })
    m.respond(404, 'not found')
    const directory = await m.catalog.refresh(m.home)
    expect(directory).toMatchObject({ entries: [], unsupported: true })
    expect(directory.reason).toContain('404')
    m.catalog.dispose()
  })

  it('throws on a transport failure so the cache keeps the last good list and retries', async () => {
    const m = mount({ baseUrl: 'https://relay.example.com', apiKey: 'sk-test' })
    await m.catalog.refresh(m.home)
    m.fail('ECONNREFUSED')
    await m.catalog.refresh(m.home)
    // The failed refresh keeps the last good data and marks it stale.
    expect(m.catalog.read(m.home)).toMatchObject({ status: 'stale' })
    expect(m.catalog.read(m.home).entries).toHaveLength(2)
    m.catalog.dispose()
  })

  it('a credential appearing later re-keys the cache: the empty answer does not stick', async () => {
    const m = mount({})
    expect((await m.catalog.refresh(m.home)).entries).toHaveLength(0)
    m.setEndpoint({ apiKey: 'sk-now' })
    expect((await m.catalog.refresh(m.home)).entries).toHaveLength(2)
    m.catalog.dispose()
  })
})
