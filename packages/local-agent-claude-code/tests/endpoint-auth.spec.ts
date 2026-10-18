import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
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
