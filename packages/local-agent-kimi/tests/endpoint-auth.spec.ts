import { mkdtempSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  clearEndpointAuth,
  ENDPOINT_AUTH_FILE,
  ENDPOINT_ENV_KEY,
  endpointAuthEnv,
  endpointAuthFileExists,
  endpointAuthStamp,
  hasEndpointCredential,
  readEndpointAuthFile,
  resolveEndpointAuth,
  writeEndpointAuth,
} from '../src/endpoint-auth.ts'
import { migrateManagedProviderConfig, KIMI_MANAGED_BASE_URL } from '../src/provision.ts'

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
