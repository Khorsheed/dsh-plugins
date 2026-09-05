import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { kimiAuthenticated, listKimiSessions } from '../src/records.ts'
import { kimiLogout, provisionKimiConfig, redactApiKeys } from '../src/provision.ts'

// The user's real ~/.kimi-code/config.toml must never leak into these tests:
// the provision mirror path copies it (redacted) whenever it exists, which
// would make the fresh-minimal-config assertions machine-dependent. Pin
// homedir to a location with no kimi config so the minimal path is
// deterministic.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => '/nonexistent-kimi-provision-test' }
})

function tempHome(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('listKimiSessions', () => {
  it('returns [] when the scoped home has no index yet', async () => {
    await expect(listKimiSessions(tempHome('kimi-empty-'))).resolves.toEqual([])
  })

  it('maps index lines to records, keeping title and start time when present', async () => {
    const home = tempHome('kimi-index-')
    writeFileSync(join(home, 'session_index.jsonl'), [
      JSON.stringify({ sessionId: 's1', sessionDir: '/s1', workDir: '/w1', title: 'first', createdAt: '2026-06-20T18:30:18.442Z' }),
      JSON.stringify({ sessionId: 's2', sessionDir: '/s2', workDir: '/w2' }),
      '',
    ].join('\n'))
    await expect(listKimiSessions(home)).resolves.toEqual([
      { id: 's1', workDir: '/w1', title: 'first', startedAt: Date.parse('2026-06-20T18:30:18.442Z') },
      { id: 's2', workDir: '/w2' },
    ])
  })

  it('skips a torn tail line from an in-flight append', async () => {
    const home = tempHome('kimi-torn-')
    writeFileSync(join(home, 'session_index.jsonl'), '{"sessionId":"s1","sessionDir":"/s1","workDir":"/w1"}\n{"sessionId":"s2","sessionDir"')
    await expect(listKimiSessions(home)).resolves.toEqual([
      { id: 's1', workDir: '/w1' },
    ])
  })

  it('rethrows a non-ENOENT read failure', async () => {
    const home = tempHome('kimi-dir-')
    mkdirSync(join(home, 'session_index.jsonl'))
    await expect(listKimiSessions(home)).rejects.toBeInstanceOf(Error)
  })
})

describe('provisionKimiConfig', () => {
  it('redacts api key values', () => {
    const out = redactApiKeys('api_key = "secret1"\napi_key = "secret2"')
    expect(out).toBe('api_key = ""\napi_key = ""')
  })

  it('writes the minimal managed config into a fresh home, effort high by default', async () => {
    const home = tempHome('kimi-provision-min-')
    const written = await provisionKimiConfig(home, 'kimi-code/k3', 'high')
    expect(written).toBe(true)
    const text = await (await import('node:fs/promises')).readFile(join(home, 'config.toml'), 'utf8')
    expect(text).toContain('default_model = "kimi-code/k3"')
    expect(text).toContain('[providers."managed:kimi-code"]')
    // The historical default: effort "high" in both the thinking table and
    // the model's default_effort.
    expect(text).toContain('effort = "high"')
    expect(text).toContain('default_effort = "high"')
  })

  it('pins the configured thinking effort into a fresh minimal config', async () => {
    const home = tempHome('kimi-provision-effort-')
    const written = await provisionKimiConfig(home, 'kimi-code/k3', 'max')
    expect(written).toBe(true)
    const text = await (await import('node:fs/promises')).readFile(join(home, 'config.toml'), 'utf8')
    expect(text).toContain('effort = "max"')
    expect(text).toContain('default_effort = "max"')
  })

  it('does not overwrite an existing config', async () => {
    const home = tempHome('kimi-provision-exist-')
    writeFileSync(join(home, 'config.toml'), 'default_model = "mine"')
    const written = await provisionKimiConfig(home, 'kimi-code/k3', 'high')
    expect(written).toBe(false)
    expect(await (await import('node:fs/promises')).readFile(join(home, 'config.toml'), 'utf8')).toBe('default_model = "mine"')
  })
})

describe('kimiLogout', () => {
  it('removes the credentials and oauth cache so status flips to not authenticated', async () => {
    const home = tempHome('kimi-logout-')
    const credentials = join(home, 'credentials')
    const oauth = join(home, 'oauth', 'kimi-code')
    mkdirSync(credentials, { recursive: true })
    mkdirSync(oauth, { recursive: true })
    writeFileSync(join(credentials, 'kimi-code.json'), '{}')
    writeFileSync(join(oauth, 'token'), '{}')
    expect(await kimiAuthenticated(home)).toBe(true)

    await kimiLogout(home)

    expect(await kimiAuthenticated(home)).toBe(false)
    expect((await import('node:fs')).existsSync(credentials)).toBe(false)
    expect((await import('node:fs')).existsSync(join(home, 'oauth'))).toBe(false)
  })

  it('is a no-op on a home that never logged in', async () => {
    const home = tempHome('kimi-logout-empty-')
    await expect(kimiLogout(home)).resolves.toBeUndefined()
  })
})
