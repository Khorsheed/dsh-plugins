import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkClaudeEndpoint,
  clearEndpointAuth,
  ENDPOINT_AUTH_FILE,
  endpointAuthEnv,
  endpointAuthFileExists,
  endpointAuthStamp,
  hasEndpointCredential,
  readEndpointAuthFile,
  resolveEndpointAuth,
  writeEndpointAuth,
} from '../src/endpoint-auth.ts'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'claude-endpoint-'))
}

describe('endpoint-auth file', () => {
  it('round-trips a written credential with mode 0600', async () => {
    const home = tempHome()
    await writeEndpointAuth(home, { baseUrl: 'https://relay.example.com/claude', apiKey: 'sk-test' })
    expect(await readEndpointAuthFile(home)).toEqual({ baseUrl: 'https://relay.example.com/claude', apiKey: 'sk-test' })
    expect(statSync(join(home, ENDPOINT_AUTH_FILE)).mode & 0o777).toBe(0o600)
  })

  it('trims fields and drops blank or non-string values', async () => {
    const home = tempHome()
    writeFileSync(join(home, ENDPOINT_AUTH_FILE), JSON.stringify({ baseUrl: '  https://relay.example.com  ', apiKey: '', authToken: 42 }))
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
  it('answers the plugin config triple when the scope carries no file', async () => {
    const home = tempHome()
    const resolved = await resolveEndpointAuth(home, { baseUrl: 'https://relay.example.com', apiKey: 'sk-deploy' })
    expect(resolved).toEqual({ baseUrl: 'https://relay.example.com', apiKey: 'sk-deploy' })
    expect(hasEndpointCredential(resolved)).toBe(true)
  })

  it('merges the scope file field by field over the config', async () => {
    const home = tempHome()
    // A file that names only a key rotates the key while keeping the deployment's relay URL.
    await writeEndpointAuth(home, { authToken: 'tok-scope' })
    const resolved = await resolveEndpointAuth(home, { baseUrl: 'https://relay.example.com', apiKey: 'sk-deploy' })
    expect(resolved).toEqual({
      baseUrl: 'https://relay.example.com',
      apiKey: 'sk-deploy',
      authToken: 'tok-scope',
    })
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
    expect(hasEndpointCredential({ authToken: 'tok' })).toBe(true)
  })

  it('emits one env entry per defined field, nothing else', () => {
    expect(endpointAuthEnv(undefined)).toEqual({})
    expect(endpointAuthEnv({})).toEqual({})
    expect(endpointAuthEnv({ baseUrl: 'https://relay.example.com', apiKey: 'sk-test' })).toEqual({
      ANTHROPIC_BASE_URL: 'https://relay.example.com',
      ANTHROPIC_API_KEY: 'sk-test',
    })
    expect(endpointAuthEnv({ authToken: 'tok' })).toEqual({ ANTHROPIC_AUTH_TOKEN: 'tok' })
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

describe('checkClaudeEndpoint', () => {
  const okFetch = (ids: string[]) => async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: ids.map(id => ({ id, display_name: id })) }),
  })

  it('needs no network when no credential is configured', async () => {
    let called = false
    const text = await checkClaudeEndpoint({}, (() => { called = true; return okFetch([])() }) as never)
    expect(called).toBe(false)
    expect(text).toContain('No endpoint credential')
  })

  it('GETs <baseUrl>/v1/models with the x-api-key header and lists the served models', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined
    const text = await checkClaudeEndpoint(
      { baseUrl: 'https://relay.example.com/claude/', apiKey: 'sk-test' },
      (async (url: string, init: { headers: Record<string, string> }) => {
        seen = { url, headers: init.headers }
        return okFetch(['claude-a', 'claude-b'])()
      }) as never,
    )
    expect(seen?.url).toBe('https://relay.example.com/claude/v1/models')
    expect(seen?.headers['x-api-key']).toBe('sk-test')
    expect(seen?.headers['anthropic-version']).toBe('2023-06-01')
    expect(text).toBe('Endpoint reachable (https://relay.example.com/claude): 2 model(s) served — claude-a, claude-b')
  })

  it('sends the Bearer header for an authToken credential and defaults to the official endpoint', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined
    await checkClaudeEndpoint(
      { authToken: 'tok' },
      (async (url: string, init: { headers: Record<string, string> }) => {
        seen = { url, headers: init.headers }
        return okFetch(['m'])()
      }) as never,
    )
    expect(seen?.url).toBe('https://api.anthropic.com/v1/models')
    expect(seen?.headers['authorization']).toBe('Bearer tok')
  })

  it('reports the HTTP status and a bounded body excerpt on a non-OK reply', async () => {
    const text = await checkClaudeEndpoint(
      { apiKey: 'sk-dead' },
      (async () => ({ ok: false, status: 401, text: async () => 'x'.repeat(500) })) as never,
    )
    expect(text).toContain('HTTP 401')
    expect(text?.length).toBeLessThan(400)
  })

  it('folds network failures into the reply instead of throwing', async () => {
    const text = await checkClaudeEndpoint(
      { baseUrl: 'https://down.example.com', apiKey: 'sk' },
      (async () => { throw new Error('ECONNREFUSED') }) as never,
    )
    expect(text).toBe('Endpoint unreachable (https://down.example.com): ECONNREFUSED')
  })
})
