import { mkdtempSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkKimiEndpoint,
  clearEndpointAuth,
  ENDPOINT_AUTH_FILE,
  ENDPOINT_ENV_KEY,
  endpointAuthEnv,
  endpointAuthFileExists,
  endpointAuthStamp,
  fetchEndpointModels,
  hasEndpointCredential,
  KIMI_MANAGED_BASE_URL,
  readEndpointAuthFile,
  resolveEndpointAuth,
  writeEndpointAuth,
} from '../src/endpoint-auth.ts'
import { migrateManagedProviderConfig, KIMI_MANAGED_BASE_URL as PROVISION_MANAGED_BASE_URL } from '../src/provision.ts'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'kimi-endpoint-'))
}

describe('endpoint-auth file', () => {
  it('round-trips a written credential with mode 0600', async () => {
    const home = tempHome()
    await writeEndpointAuth(home, { baseUrl: 'https://relay.example.com/coding/v1', apiKey: 'sk-test' })
    expect(await readEndpointAuthFile(home)).toEqual({ baseUrl: 'https://relay.example.com/coding/v1', apiKey: 'sk-test' })
    expect(statSync(join(home, ENDPOINT_AUTH_FILE)).mode & 0o777).toBe(0o600)
  })

  it('trims fields and drops blank or non-string values', async () => {
    const home = tempHome()
    writeFileSync(join(home, ENDPOINT_AUTH_FILE), JSON.stringify({ baseUrl: '  https://relay.example.com  ', apiKey: 42 }))
    expect(await readEndpointAuthFile(home)).toEqual({ baseUrl: 'https://relay.example.com' })
  })

  it('reads absent, malformed, and non-object files as undefined', async () => {
    const home = tempHome()
    expect(await readEndpointAuthFile(home)).toBeUndefined()
    writeFileSync(join(home, ENDPOINT_AUTH_FILE), 'not json')
    expect(await readEndpointAuthFile(home)).toBeUndefined()
    writeFileSync(join(home, ENDPOINT_AUTH_FILE), '[1,2]')
    expect(await readEndpointAuthFile(home)).toBeUndefined()
  })
})

describe('resolveEndpointAuth', () => {
  it('answers the plugin config pair when the scope carries no file', async () => {
    const home = tempHome()
    const resolved = await resolveEndpointAuth(home, { baseUrl: 'https://relay.example.com', apiKey: 'sk-deploy' })
    expect(resolved).toEqual({ baseUrl: 'https://relay.example.com', apiKey: 'sk-deploy' })
    expect(hasEndpointCredential(resolved)).toBe(true)
  })

  it('merges the scope file field by field over the config', async () => {
    const home = tempHome()
    await writeEndpointAuth(home, { apiKey: 'sk-scope' })
    const resolved = await resolveEndpointAuth(home, { baseUrl: 'https://relay.example.com', apiKey: 'sk-deploy' })
    expect(resolved).toEqual({ baseUrl: 'https://relay.example.com', apiKey: 'sk-scope' })
  })

  it('stays credentialless when neither layer names a key', async () => {
    const home = tempHome()
    const resolved = await resolveEndpointAuth(home, { baseUrl: 'https://relay.example.com' })
    expect(hasEndpointCredential(resolved)).toBe(false)
  })
})

describe('endpointAuthEnv', () => {
  it('emits only the api_key_env-named entry for a keyed resolution', () => {
    expect(endpointAuthEnv(undefined)).toEqual({})
    expect(endpointAuthEnv({})).toEqual({})
    expect(endpointAuthEnv({ baseUrl: 'https://relay.example.com' })).toEqual({})
    expect(endpointAuthEnv({ apiKey: 'sk-test' })).toEqual({ [ENDPOINT_ENV_KEY]: 'sk-test' })
  })
})

describe('endpointAuthStamp / clearEndpointAuth', () => {
  it('stamps the file mtime; clear removes it and a missing file is not an error', async () => {
    const home = tempHome()
    expect(await endpointAuthStamp(home)).toBeUndefined()
    expect(await endpointAuthFileExists(home)).toBe(false)
    await writeEndpointAuth(home, { apiKey: 'sk-one' })
    expect(await endpointAuthStamp(home)).toBeTypeOf('number')
    await clearEndpointAuth(home)
    expect(await endpointAuthFileExists(home)).toBe(false)
    await clearEndpointAuth(home)
  })
})

const OAUTH_ERA_CONFIG = `default_model = "kimi-code/k3"

[providers."managed:kimi-code"]
base_url = "${KIMI_MANAGED_BASE_URL}"
type = "kimi"
api_key = ""

[providers."managed:kimi-code".oauth]
storage = "file"
key = "oauth/kimi-code"

[providers.anthropic]
type = "anthropic"
api_key = ""
base_url = "https://relay.example.com"

[models."kimi-code/k3"]
provider = "managed:kimi-code"
model = "k3"
`

describe('migrateManagedProviderConfig', () => {
  it('migrates the OAuth-era managed section onto api_key_env and drops the oauth table', () => {
    const out = migrateManagedProviderConfig(OAUTH_ERA_CONFIG)
    // The managed section (up to the next provider) carries the env-key
    // indirection and no inline key, and no oauth sub-table survives.
    const managed = out.slice(out.indexOf('[providers."managed:kimi-code"]'), out.indexOf('[providers.anthropic]'))
    expect(managed).toContain(`api_key_env = "${ENDPOINT_ENV_KEY}"`)
    expect(managed).not.toMatch(/^api_key\s*=/m)
    expect(managed).not.toContain('oauth')
    // The managed provider keeps its own base_url when no endpoint pins one.
    expect(managed).toContain(`base_url = "${KIMI_MANAGED_BASE_URL}"`)
    expect(managed).toContain('type = "kimi"')
    // The user's own provider and the model tables are byte-preserved.
    expect(out).toContain('[providers.anthropic]')
    expect(out).toContain('[models."kimi-code/k3"]')
    expect(out).toContain('provider = "managed:kimi-code"')
  })

  it('pins the base_url when an endpoint names one, and re-points a later edit', () => {
    const managedSection = (config: string): string =>
      config.slice(config.indexOf('[providers."managed:kimi-code"]'), config.indexOf('[providers.anthropic]'))
    const once = migrateManagedProviderConfig(OAUTH_ERA_CONFIG, 'https://relay.example.com/coding/v1')
    expect(managedSection(once)).toContain('base_url = "https://relay.example.com/coding/v1"')
    expect(managedSection(once)).not.toContain(KIMI_MANAGED_BASE_URL)
    const twice = migrateManagedProviderConfig(once, 'https://other.example.com/v1')
    expect(managedSection(twice)).toContain('base_url = "https://other.example.com/v1"')
    expect(managedSection(twice)).not.toContain('relay.example.com')
    // The user's own provider keeps its relay.
    expect(twice).toContain('[providers.anthropic]\ntype = "anthropic"\napi_key = ""\nbase_url = "https://relay.example.com"')
  })

  it('is idempotent on an in-sync config', () => {
    const once = migrateManagedProviderConfig(OAUTH_ERA_CONFIG, 'https://relay.example.com/coding/v1')
    expect(migrateManagedProviderConfig(once, 'https://relay.example.com/coding/v1')).toBe(once)
  })

  it('leaves a config without the managed provider byte-identical', () => {
    const foreign = '[providers.anthropic]\ntype = "anthropic"\napi_key = ""\n'
    expect(migrateManagedProviderConfig(foreign, 'https://relay.example.com')).toBe(foreign)
  })

  it('keeps an existing api_key_env line single', () => {
    const already = OAUTH_ERA_CONFIG.replace('api_key = ""', 'api_key_env = "SOME_OTHER"')
    const out = migrateManagedProviderConfig(already)
    expect(out.match(/api_key_env/g)).toHaveLength(1)
    expect(out).toContain(`api_key_env = "${ENDPOINT_ENV_KEY}"`)
  })
})

describe('fetchEndpointModels', () => {
  /** A 200 reply carrying the given payload. */
  const okFetch = (payload: unknown) => (async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  })) as never

  it('GETs <baseUrl>/models with the Bearer header (the managed base already ends in /v1)', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined
    await fetchEndpointModels(
      { baseUrl: 'https://relay.example.com/coding/v1/', apiKey: 'sk-test' },
      (async (url: string, init: { headers: Record<string, string> }) => {
        seen = { url, headers: init.headers }
        return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) }
      }) as never,
    )
    expect(seen?.url).toBe('https://relay.example.com/coding/v1/models')
    expect(seen?.headers['authorization']).toBe('Bearer sk-test')
    expect(seen?.headers['x-api-key']).toBeUndefined()
  })

  it('appends /v1 for a relay base that omits it', async () => {
    let seen: { url: string } | undefined
    await fetchEndpointModels(
      { baseUrl: 'https://relay.example.com/coding', apiKey: 'sk-test' },
      (async (url: string) => {
        seen = { url }
        return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) }
      }) as never,
    )
    expect(seen?.url).toBe('https://relay.example.com/coding/v1/models')
  })

  it('parses the kimi shape: display_name, think_efforts, context_length', async () => {
    // The verified 2026-10-22 answer of https://api.kimi.com/coding/v1/models.
    const result = await fetchEndpointModels({ baseUrl: KIMI_MANAGED_BASE_URL, apiKey: 'sk-test' }, okFetch({
      data: [
        { id: 'kimi-for-coding', display_name: 'K2.8 Preview', context_length: 1048576, think_efforts: { support: true, valid_efforts: ['low', 'high', 'max'], default_effort: 'max' } },
        // A served model without think_efforts (kimi-for-coding-highspeed carries none).
        { id: 'kimi-for-coding-highspeed' },
        // Non-string ids and non-object entries are dropped, never carried.
        { id: 42 },
        'k3',
      ],
    }))
    expect(result).toEqual({
      kind: 'models',
      models: [
        { id: 'kimi-for-coding', displayName: 'K2.8 Preview', contextSize: 1048576, efforts: ['low', 'high', 'max'], defaultEffort: 'max' },
        { id: 'kimi-for-coding-highspeed' },
      ],
    })
  })

  it('tolerates a generic OpenAI-shaped relay (ids only)', async () => {
    const result = await fetchEndpointModels({ baseUrl: 'https://relay.example.com/v1', apiKey: 'sk-test' }, okFetch({
      object: 'list',
      data: [{ id: 'k3', object: 'model', created: 0, owned_by: 'relay' }],
    }))
    expect(result).toEqual({ kind: 'models', models: [{ id: 'k3' }] })
  })

  it('folds a non-OK reply into the http outcome with a bounded body', async () => {
    const result = await fetchEndpointModels(
      { baseUrl: 'https://relay.example.com/v1', apiKey: 'sk-dead' },
      (async () => ({ ok: false, status: 401, text: async () => 'x'.repeat(500) })) as never,
    )
    expect(result).toMatchObject({ kind: 'http', status: 401 })
    if (result.kind === 'http') expect(result.body).toHaveLength(200)
  })

  it('folds a transport failure into unreachable instead of throwing', async () => {
    const result = await fetchEndpointModels(
      { baseUrl: 'https://down.example.com/v1', apiKey: 'sk' },
      (async () => { throw new Error('ECONNREFUSED') }) as never,
    )
    expect(result).toEqual({ kind: 'unreachable', message: 'ECONNREFUSED' })
  })

  it('folds a non-JSON body and a non-array data into malformed', async () => {
    const notJson = await fetchEndpointModels(
      { baseUrl: 'https://relay.example.com/v1', apiKey: 'sk' },
      (async () => ({ ok: true, status: 200, text: async () => '<html>not json</html>' })) as never,
    )
    expect(notJson).toEqual({ kind: 'malformed' })
    const notList = await fetchEndpointModels({ baseUrl: 'https://relay.example.com/v1', apiKey: 'sk' }, okFetch({ data: { id: 'k3' } }))
    expect(notList).toEqual({ kind: 'malformed' })
  })
})

describe('checkKimiEndpoint', () => {
  const okFetch = (ids: string[]) => async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: ids.map(id => ({ id })) }),
  })

  it('needs no network when no credential is configured', async () => {
    let called = false
    const text = await checkKimiEndpoint({}, (() => { called = true; return okFetch([])() }) as never)
    expect(called).toBe(false)
    expect(text).toContain('No endpoint credential')
  })

  it('lists the served models, truncating past the list limit', async () => {
    const ids = Array.from({ length: 11 }, (_, index) => `model-${String(index)}`)
    const text = await checkKimiEndpoint(
      { baseUrl: 'https://relay.example.com/coding/v1/', apiKey: 'sk-test' },
      okFetch(ids) as never,
    )
    expect(text).toBe(`Endpoint reachable (https://relay.example.com/coding/v1): 11 model(s) served — ${ids.slice(0, 8).join(', ')}, … +3 more`)
  })

  it('defaults to the managed kimi endpoint when no baseUrl is set', async () => {
    let seen: { url: string } | undefined
    await checkKimiEndpoint(
      { apiKey: 'sk-test' },
      (async (url: string) => {
        seen = { url }
        return okFetch(['kimi-for-coding'])()
      }) as never,
    )
    expect(seen?.url).toBe('https://api.kimi.com/coding/v1/models')
  })

  it('reports the HTTP status and a bounded body excerpt on a non-OK reply', async () => {
    const text = await checkKimiEndpoint(
      { apiKey: 'sk-dead' },
      (async () => ({ ok: false, status: 401, text: async () => 'x'.repeat(500) })) as never,
    )
    expect(text).toContain('HTTP 401')
    expect(text?.length).toBeLessThan(400)
  })

  it('retries one transport failure before reporting unreachable', async () => {
    let attempts = 0
    const text = await checkKimiEndpoint(
      { baseUrl: 'https://flaky.example.com/v1', apiKey: 'sk' },
      (async () => {
        attempts += 1
        if (attempts === 1) throw new Error('ECONNRESET')
        return okFetch(['k3'])()
      }) as never,
    )
    expect(attempts).toBe(2)
    expect(text).toContain('1 model(s) served — k3')
  })

  it('reports unreachable after the retry also fails, instead of throwing', async () => {
    let attempts = 0
    const text = await checkKimiEndpoint(
      { baseUrl: 'https://down.example.com', apiKey: 'sk' },
      (async () => { attempts += 1; throw new Error('ECONNREFUSED') }) as never,
    )
    expect(attempts).toBe(2)
    expect(text).toBe('Endpoint unreachable (https://down.example.com): ECONNREFUSED')
  })

  it('reads a reachable-but-unparseable reply as a working credential with a foreign shape', async () => {
    const text = await checkKimiEndpoint(
      { apiKey: 'sk-test' },
      (async () => ({ ok: true, status: 200, text: async () => '<html>' })) as never,
    )
    expect(text).toContain('the credential worked, the reply was not /v1/models-shaped')
  })

  it('says so when the endpoint serves no models', async () => {
    const text = await checkKimiEndpoint({ apiKey: 'sk-test' }, okFetch([]) as never)
    expect(text).toContain('it serves no models')
  })

  it('the provision module re-exports the managed base URL the check defaults to', () => {
    expect(PROVISION_MANAGED_BASE_URL).toBe(KIMI_MANAGED_BASE_URL)
  })
})
