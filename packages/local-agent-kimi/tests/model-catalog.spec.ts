import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EndpointServedModel, KimiEndpointAuth } from '../src/endpoint-auth.ts'
import { KimiModelCatalog, kimiNativeConfiguration, type KimiNativeConfiguration } from '../src/model-catalog.ts'

const configuration = { configOptions: [
  { id: 'route', category: 'model', type: 'select', currentValue: 'one', options: [{ value: 'one', name: 'Model One' }, { value: 'two', name: 'Model Two' }] },
  { id: 'thinking', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
] }

/** A fetch answering the given served models (the kimi `/v1/models` shape). */
function serving(models: readonly EndpointServedModel[]) {
  return (async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      data: models.map(model => ({
        id: model.id,
        ...model.displayName === undefined ? {} : { display_name: model.displayName },
        ...model.contextSize === undefined ? {} : { context_length: model.contextSize },
        ...model.efforts === undefined && model.defaultEffort === undefined ? {} : { think_efforts: {
          support: true,
          ...model.efforts === undefined ? {} : { valid_efforts: model.efforts },
          ...model.defaultEffort === undefined ? {} : { default_effort: model.defaultEffort },
        } },
      })),
    }),
  })) as never
}

/** A catalog over a tmp scoped home, with the endpoint probe fully injected. */
function mount(options: {
  config?: string
  credential?: KimiEndpointAuth
  fetch?: (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>
  native?: KimiNativeConfiguration
}): { catalog: KimiModelCatalog; homeDir: string; warnings: string[]; fetches: string[] } {
  const homeDir = mkdtempSync(join(tmpdir(), 'kimi-directory-'))
  if (options.config !== undefined) writeFileSync(join(homeDir, 'config.toml'), options.config)
  const warnings: string[] = []
  const fetches: string[] = []
  const catalog = new KimiModelCatalog(
    () => ({ homeDir, ...options.native === undefined ? {} : { native: options.native } }),
    {
      endpoint: async () => options.credential ?? {},
      // Always injected: a test that fetches without meaning to fails loudly
      // here instead of touching the network.
      fetchImpl: (async (url: string, init: { headers: Record<string, string> }) => {
        fetches.push(url)
        if (options.fetch === undefined) throw new Error('unexpected endpoint fetch')
        return options.fetch(url, init)
      }) as never,
      warn: message => { warnings.push(message) },
    },
  )
  return { catalog, homeDir, warnings, fetches }
}

describe('Kimi model directory', () => {
  it('preserves ACP controls and binds dependent effort choices to the current model only', () => {
    const native = kimiNativeConfiguration(configuration)
    expect(native).toMatchObject({ modelConfigId: 'route', effortConfigId: 'thinking', currentModel: 'one', currentEffort: 'high' })
    expect(native?.directory.entries[0]).toMatchObject({ label: 'Model One', source: 'native', reasoning: { options: [{ value: 'low' }, { value: 'high' }] } })
    expect(native?.directory.entries[1]?.reasoning).toBeUndefined()
    expect(native?.directory.defaultModel).toBeUndefined()
    expect(kimiNativeConfiguration({})).toBeUndefined()
  })

  it('reads legacy ACP model metadata without inventing a config control ID', () => {
    expect(kimiNativeConfiguration({ models: { currentModelId: 'old', availableModels: [{ modelId: 'old', name: 'Legacy model' }] } })).toEqual({
      currentModel: 'old', directory: { entries: [{ value: 'old', label: 'Legacy model', source: 'native' }], complete: true, customInput: false },
    })
  })

  it('a member’s native ACP configuration short-circuits the endpoint probe', async () => {
    const m = mount({ credential: { apiKey: 'sk-test' }, fetch: serving([{ id: 'k3' }]), native: kimiNativeConfiguration(configuration) })
    expect(await m.catalog.refresh('member')).toMatchObject({ complete: true, entries: [{ value: 'one', source: 'native' }, { value: 'two' }] })
    expect(m.fetches).toEqual([])
    m.catalog.dispose()
  })

  it('answers unsupported with the save-a-key reason when no credential resolves, never fetching', async () => {
    const m = mount({ fetch: serving([{ id: 'k3' }]) })
    const directory = await m.catalog.refresh('member')
    expect(directory).toMatchObject({ status: 'unsupported', unsupported: true, entries: [], customInput: false })
    expect(directory.reason).toContain('once an API Key is saved')
    expect(m.fetches).toEqual([])
    m.catalog.dispose()
  })

  it('maps the endpoint’s served list through the config’s managed tables', async () => {
    const m = mount({
      credential: { apiKey: 'sk-test' },
      config: [
        'default_model = "kimi-code/k3"',
        '',
        // The managed table whose upstream `model` matches a served id: the
        // table KEY (the runnable name `-m` resolves against) is the value.
        '[models."kimi-code/k3"]',
        'provider = "managed:kimi-code"',
        'model = "k3"',
        'display_name = "K3 (config)"',
        'support_efforts = [ "low", "high", "max" ]',
        'default_effort = "max"',
        '',
        // Metadata the endpoint does not advertise falls back to the table.
        '[models."custom/k3-256k"]',
        'provider = "managed:kimi-code"',
        'model = "k3-256k"',
        'display_name = "K3 256K"',
        'support_efforts = [ "low" ]',
        'default_effort = "low"',
        '',
        // A non-managed table never claims a served id, even on an upstream match.
        '[models.foreign]',
        'provider = "someone-else"',
        'model = "kimi-for-coding-highspeed"',
        '',
      ].join('\n'),
      fetch: serving([
        { id: 'k3', displayName: 'K3', efforts: ['low', 'high'], defaultEffort: 'high', contextSize: 262144 },
        { id: 'kimi-for-coding-highspeed' },
        { id: 'k3-256k' },
      ]),
    })
    const directory = await m.catalog.refresh('member')
    expect(directory).toMatchObject({ status: 'ready', complete: true, customInput: false })
    expect(directory.entries).toEqual([
      // Endpoint label and efforts win over the table's.
      { value: 'kimi-code/k3', label: 'K3', source: 'native', reasoning: { options: [{ value: 'low', label: 'low' }, { value: 'high', label: 'high' }], default: 'high' } },
      // No managed table points at this id: the bare served id stands.
      { value: 'kimi-for-coding-highspeed', label: 'kimi-for-coding-highspeed', source: 'native' },
      // The endpoint advertised nothing: the table's metadata fills in.
      { value: 'custom/k3-256k', label: 'K3 256K', source: 'native', reasoning: { options: [{ value: 'low', label: 'low' }], default: 'low' } },
    ])
    m.catalog.dispose()
  })

  it('reads a credential rejection as unsupported with the rejection reason (cached as data)', async () => {
    const m = mount({
      credential: { apiKey: 'sk-dead' },
      fetch: (async () => ({ ok: false, status: 401, text: async () => 'invalid key' })) as never,
    })
    const directory = await m.catalog.refresh('member')
    expect(directory).toMatchObject({ status: 'unsupported', entries: [] })
    expect(directory.reason).toContain('rejected the credential (HTTP 401)')
    m.catalog.dispose()
  })

  it('reads another HTTP status as "serves no model list", and a foreign shape as unparseable', async () => {
    const http = mount({
      credential: { apiKey: 'sk-test' },
      fetch: (async () => ({ ok: false, status: 500, text: async () => 'oops' })) as never,
    })
    expect((await http.catalog.refresh('member')).reason).toContain('does not serve a model list (HTTP 500)')
    http.catalog.dispose()
    const malformed = mount({
      credential: { apiKey: 'sk-test' },
      fetch: (async () => ({ ok: true, status: 200, text: async () => '<html>' })) as never,
    })
    expect((await malformed.catalog.refresh('member')).reason).toContain('did not parse')
    malformed.catalog.dispose()
    const empty = mount({ credential: { apiKey: 'sk-test' }, fetch: serving([]) })
    expect((await empty.catalog.refresh('member')).reason).toContain('serves no models')
    empty.catalog.dispose()
  })

  it('an unreachable endpoint keeps the last good list (the throw is not a verdict)', async () => {
    let down = false
    const m = mount({
      credential: { apiKey: 'sk-test' },
      fetch: (async () => {
        if (down) throw new Error('ECONNREFUSED')
        return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'k3' }] }) }
      }) as never,
    })
    expect((await m.catalog.refresh('member')).entries.map(entry => entry.value)).toEqual(['k3'])
    down = true
    const directory = await m.catalog.refresh('member')
    expect(directory.status).toBe('stale')
    expect(directory.entries.map(entry => entry.value)).toEqual(['k3'])
    expect(m.warnings.some(warning => warning.includes('endpoint unreachable'))).toBe(true)
    m.catalog.dispose()
  })

  it('readHome/refreshHome key the cache by the scoped home alone (the write face’s read)', async () => {
    const m = mount({ credential: { apiKey: 'sk-test' }, fetch: serving([{ id: 'k3', displayName: 'K3' }]) })
    await m.catalog.refreshHome(m.homeDir)
    expect(m.catalog.readHome(m.homeDir).entries).toEqual([{ value: 'k3', label: 'K3', source: 'native' }])
    m.catalog.dispose()
  })
})
