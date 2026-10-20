import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkCodexEndpoint,
  clearEndpointAuth,
  ENDPOINT_AUTH_FILE,
  endpointAuthEnv,
  endpointAuthFileExists,
  endpointAuthStamp,
  endpointConfigOverrides,
  hasEndpointCredential,
  readEndpointAuthFile,
  resolveEndpointAuth,
  writeEndpointAuth,
} from '../src/endpoint-auth.ts'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'codex-endpoint-'))
}

describe('endpoint-auth file', () => {
  it('round-trips a written credential with mode 0600, wireApi included', async () => {
    const home = tempHome()
    await writeEndpointAuth(home, { baseUrl: 'https://relay.example.com/openai/v1', apiKey: 'sk-test', wireApi: 'chat' })
    expect(await readEndpointAuthFile(home)).toEqual({ baseUrl: 'https://relay.example.com/openai/v1', apiKey: 'sk-test', wireApi: 'chat' })
    expect(statSync(join(home, ENDPOINT_AUTH_FILE)).mode & 0o777).toBe(0o600)
  })

  it('trims fields and drops blank or non-string values', async () => {
    const home = tempHome()
    writeFileSync(join(home, ENDPOINT_AUTH_FILE), JSON.stringify({ baseUrl: '  https://relay.example.com  ', apiKey: '', wireApi: 42 }))
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
    // A file that names only a key rotates the key while keeping the deployment's relay URL.
    await writeEndpointAuth(home, { apiKey: 'sk-scope' })
    const resolved = await resolveEndpointAuth(home, { baseUrl: 'https://relay.example.com', apiKey: 'sk-deploy' })
    expect(resolved).toEqual({ baseUrl: 'https://relay.example.com', apiKey: 'sk-scope' })
  })

  it('stays credentialless when neither layer names a key', async () => {
    const home = tempHome()
    const resolved = await resolveEndpointAuth(home, { baseUrl: 'https://relay.example.com' })
    expect(resolved).toEqual({ baseUrl: 'https://relay.example.com' })
    expect(hasEndpointCredential(resolved)).toBe(false)
  })
})

describe('hasEndpointCredential / endpointAuthEnv', () => {
  it('judges on a usable key, not on a baseUrl', () => {
    expect(hasEndpointCredential(undefined)).toBe(false)
    expect(hasEndpointCredential({})).toBe(false)
    expect(hasEndpointCredential({ baseUrl: 'https://relay.example.com' })).toBe(false)
    expect(hasEndpointCredential({ apiKey: 'sk-test' })).toBe(true)
  })

  it('emits only the OPENAI_API_KEY entry for a keyed resolution', () => {
    expect(endpointAuthEnv(undefined)).toEqual({})
    expect(endpointAuthEnv({})).toEqual({})
    expect(endpointAuthEnv({ baseUrl: 'https://relay.example.com' })).toEqual({})
    expect(endpointAuthEnv({ baseUrl: 'https://relay.example.com', apiKey: 'sk-test' })).toEqual({
      OPENAI_API_KEY: 'sk-test',
    })
  })
})

describe('endpointConfigOverrides', () => {
  it('is empty unless BOTH a key and a baseUrl are present', () => {
    expect(endpointConfigOverrides(undefined)).toEqual([])
    expect(endpointConfigOverrides({ apiKey: 'sk-test' })).toEqual([])
    expect(endpointConfigOverrides({ baseUrl: 'https://relay.example.com' })).toEqual([])
  })

  it('routes at the relay through a custom provider with the responses wire by default', () => {
    const overrides = endpointConfigOverrides({ baseUrl: 'https://relay.example.com/openai/v1', apiKey: 'sk-test' })
    expect(overrides).toEqual([
      '-c', 'model_provider="dsh-endpoint"',
      '-c', 'model_providers.dsh-endpoint={name="dsh-endpoint",base_url="https://relay.example.com/openai/v1",env_key="OPENAI_API_KEY",wire_api="responses"}',
    ])
  })

  it('honors the file-only wireApi escape hatch and quotes TOML strings', () => {
    const overrides = endpointConfigOverrides({ baseUrl: 'https://relay.example.com/"quoted"', apiKey: 'sk-test', wireApi: 'chat' })
    expect(overrides[3]).toContain('wire_api="chat"')
    expect(overrides[3]).toContain('base_url="https://relay.example.com/\\"quoted\\""')
  })
})

describe('endpointAuthStamp / clearEndpointAuth', () => {
  it('stamps the file mtime, and a rewrite recovers a newer stamp', async () => {
    const home = tempHome()
    expect(await endpointAuthStamp(home)).toBeUndefined()
    expect(await endpointAuthFileExists(home)).toBe(false)
    await writeEndpointAuth(home, { apiKey: 'sk-one' })
    const first = await endpointAuthStamp(home)
    expect(first).toBeTypeOf('number')
    await new Promise(resolve => setTimeout(resolve, 5))
    await writeEndpointAuth(home, { apiKey: 'sk-two' })
    const second = await endpointAuthStamp(home)
    expect(second!).toBeGreaterThanOrEqual(first!)
  })

  it('clear removes the scope credential; a missing file is not an error', async () => {
    const home = tempHome()
    await writeEndpointAuth(home, { apiKey: 'sk-one' })
    await clearEndpointAuth(home)
    expect(await endpointAuthFileExists(home)).toBe(false)
    await clearEndpointAuth(home)
  })
})

describe('checkCodexEndpoint', () => {
  const okFetch = (ids: string[]) => async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ object: 'list', data: ids.map(id => ({ id, object: 'model' })) }),
  })

  it('needs no network when no credential is configured', async () => {
    let called = false
    const text = await checkCodexEndpoint({}, (() => { called = true; return okFetch([])() }) as never)
    expect(called).toBe(false)
    expect(text).toContain('No endpoint credential')
  })

  it('GETs <baseUrl>/v1/models with the Bearer header and lists the served models', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined
    const text = await checkCodexEndpoint(
      { baseUrl: 'https://relay.example.com/openai/v1/', apiKey: 'sk-test' },
      (async (url: string, init: { headers: Record<string, string> }) => {
        seen = { url, headers: init.headers }
        return okFetch(['gpt-a', 'gpt-b'])()
      }) as never,
    )
    expect(seen?.url).toBe('https://relay.example.com/openai/v1/models')
    expect(seen?.headers['authorization']).toBe('Bearer sk-test')
    expect(text).toBe('Endpoint reachable (https://relay.example.com/openai/v1): 2 model(s) served — gpt-a, gpt-b')
  })

  it('defaults to the official OpenAI endpoint when no baseUrl is set', async () => {
    let seen: { url: string } | undefined
    await checkCodexEndpoint(
      { apiKey: 'sk-test' },
      (async (url: string) => {
        seen = { url }
        return okFetch(['m'])()
      }) as never,
    )
    expect(seen?.url).toBe('https://api.openai.com/v1/models')
  })

  it('reports the HTTP status and a bounded body excerpt on a non-OK reply', async () => {
    const text = await checkCodexEndpoint(
      { apiKey: 'sk-dead' },
      (async () => ({ ok: false, status: 401, text: async () => 'x'.repeat(500) })) as never,
    )
    expect(text).toContain('HTTP 401')
    expect(text?.length).toBeLessThan(400)
  })

  it('folds network failures into the reply instead of throwing', async () => {
    const text = await checkCodexEndpoint(
      { baseUrl: 'https://down.example.com', apiKey: 'sk' },
      (async () => { throw new Error('ECONNREFUSED') }) as never,
    )
    expect(text).toBe('Endpoint unreachable (https://down.example.com): ECONNREFUSED')
  })
})
