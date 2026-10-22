/**
 * The codex model catalog, endpoint-primary: the served id list of `GET
 * <baseUrl>/v1/models` is the vocabulary (a local registry cannot prove what
 * the endpoint serves), folded CONCURRENTLY with the native app-server
 * `model/list` probe's metadata (labels, hidden flags, reasoning options, the
 * `isDefault` slug). The native side is driven against a fake app-server (a
 * real node child speaking NDJSON JSON-RPC over stdio); the endpoint side is
 * an injected fetch. Also pinned: the failure folds (401/403/http/malformed
 * unsupported, unreachable keeps last good), the per-home TTL cache with one
 * shared in-flight probe, and native-failure demotion to a warn.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it } from 'vitest'
import type { CodexEndpointAuth, EndpointCheckFetch } from '../src/endpoint-auth.ts'
import { CodexModelCatalog } from '../src/model-catalog.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-codex-app-server.mjs', import.meta.url))

/** A fetch answering the OpenAI-list shape with the given served ids. */
const serving = (ids: readonly string[]): EndpointCheckFetch => async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ object: 'list', data: ids.map(id => ({ id, object: 'model' })) }),
})

/** A catalog over a tmp scoped home, native probe on the fake app-server, endpoint probe on an injected fetch. */
function mount(options: {
  mode?: string
  timeoutMs?: number
  ttlMs?: number
  credential?: CodexEndpointAuth
  fetch?: EndpointCheckFetch
} = {}): {
  catalog: CodexModelCatalog
  homeDir: string
  spawns: SubprocessSpawnSpec[]
  warnings: string[]
  fetches: string[]
} {
  const homeDir = mkdtempSync(join(tmpdir(), 'codex-catalog-'))
  const spawns: SubprocessSpawnSpec[] = []
  const warnings: string[] = []
  const fetches: string[] = []
  const catalog = new CodexModelCatalog({
    spawn: spec => {
      spawns.push(spec)
      const child = spawn(process.execPath, [FIXTURE, ...spec.argv.slice(1)], {
        cwd: spec.cwd,
        env: {
          PATH: process.env.PATH,
          CODEX_HOME: String(spec.env?.['CODEX_HOME'] ?? homeDir),
          ...options.mode === undefined ? {} : { FAKE_CODEX_MODE: options.mode },
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.on('error', reject)
        child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))
      })
      // The specs never read it; keep the buffer draining so the child never blocks.
      child.stderr?.resume()
      const handle: SubprocessHandle = {
        stdin: child.stdin ?? undefined,
        stdout: child.stdout ?? undefined,
        stderr: child.stderr ?? undefined,
        collected: undefined as never,
        done,
        terminate: () => { child.kill('SIGTERM') },
        waitForExit: async () => { await done.catch(() => {}); return true },
      }
      return handle
    },
    warn: message => { warnings.push(message) },
    endpoint: async () => options.credential ?? {},
    // Always injected: a test that fetches without meaning to fails loudly
    // here instead of touching the network.
    fetchImpl: (async (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => {
      fetches.push(url)
      if (options.fetch === undefined) throw new Error('unexpected endpoint fetch')
      return options.fetch(url, init)
    }),
    ...options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
    ...options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs },
  })
  return { catalog, homeDir, spawns, warnings, fetches }
}

/** The fixture's served set: every id the fake app-server knows, served. */
const ALL_SERVED = ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5-legacy', 'only-model-field']

describe('codex model catalog: the endpoint is the vocabulary', () => {
  it('needs a credential: without one the directory is unsupported and nothing probes', async () => {
    const m = mount({ fetch: serving(['gpt-a']) })
    await m.catalog.refresh(m.homeDir)
    const directory = m.catalog.directory(m.homeDir)
    expect(directory).toMatchObject({ status: 'unsupported', unsupported: true, entries: [], customInput: true })
    expect(directory.reason).toContain('once an API Key is saved')
    // Neither side probed: the endpoint fetch is gated on the credential, and
    // the native spawn would only enrich an answer there is nothing to fold into.
    expect(m.fetches).toEqual([])
    expect(m.spawns).toEqual([])
  })

  it('served ids win; the native registry only enriches the matches (labels, reasoning, default)', async () => {
    const m = mount({ credential: { apiKey: 'sk-test' }, fetch: serving(['gpt-5.6-sol', 'gpt-5.5', 'gpt-9-nova']) })
    expect(await m.catalog.refresh(m.homeDir)).toEqual(['gpt-5.6-sol', 'gpt-5.5', 'gpt-9-nova'])
    const directory = m.catalog.directory(m.homeDir)
    expect(directory).toMatchObject({ status: 'ready', complete: true, customInput: true, defaultModel: 'gpt-5.6-sol' })
    expect(directory.entries).toEqual([
      {
        value: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', source: 'native', hidden: false, description: 'fixture',
        reasoning: { default: 'high', options: [{ value: 'high', label: 'high', description: 'More reasoning' }] },
      },
      { value: 'gpt-5.5', label: 'GPT-5.5', source: 'native', hidden: false },
      // Served but unknown to the CLI's registry: a plain entry.
      { value: 'gpt-9-nova', label: 'gpt-9-nova', source: 'native' },
    ])
    // The registry's other candidates (gpt-5-legacy, only-model-field) are
    // NOT served, so they are not listed.
  })

  it('a served id keeps its native hidden flag (read filters it; the directory carries it)', async () => {
    const m = mount({ credential: { apiKey: 'sk-test' }, fetch: serving(['gpt-5.6-sol', 'gpt-5-legacy']) })
    expect(await m.catalog.refresh(m.homeDir)).toEqual(['gpt-5.6-sol'])
    expect(m.catalog.directory(m.homeDir).entries.find(entry => entry.value === 'gpt-5-legacy')).toMatchObject({ hidden: true, label: 'legacy' })
  })

  it('the native probe spawns with the live driver’s argv, scoped-home pinning, and the endpoint env', async () => {
    const m = mount({ credential: { apiKey: 'sk-test' }, fetch: serving(['gpt-a']) })
    await m.catalog.refresh(m.homeDir)
    expect(m.spawns).toHaveLength(1)
    expect(m.spawns[0]!.argv).toEqual(['codex', 'app-server', '--stdio'])
    expect(m.spawns[0]!.env?.['CODEX_HOME']).toBe(m.homeDir)
    expect(m.spawns[0]!.env?.['OPENAI_API_KEY']).toBe('sk-test')
    expect(m.spawns[0]!.stdio).toEqual({ stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  })

  it('reads the endpoint probe URL and Bearer header off the resolved credential', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined
    const m = mount({
      credential: { baseUrl: 'https://relay.example.com/openai/v1/', apiKey: 'sk-test' },
      fetch: (async (url: string, init: { headers: Record<string, string> }) => {
        seen = { url, headers: init.headers }
        return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'gpt-a' }] }) }
      }),
    })
    await m.catalog.refresh(m.homeDir)
    expect(seen?.url).toBe('https://relay.example.com/openai/v1/models')
    expect(seen?.headers['authorization']).toBe('Bearer sk-test')
  })

  it('native failure never fails the load: the endpoint list stands, one warn', async () => {
    const m = mount({ mode: 'garbage', credential: { apiKey: 'sk-test' }, fetch: serving(['gpt-a', 'gpt-b']) })
    expect(await m.catalog.refresh(m.homeDir)).toEqual(['gpt-a', 'gpt-b'])
    const directory = m.catalog.directory(m.homeDir)
    expect(directory).toMatchObject({ status: 'ready', complete: true })
    expect(directory.defaultModel).toBeUndefined()
    expect(m.warnings.some(warning => warning.includes('native model/list probe failed'))).toBe(true)
  })

  it('a spawn failure degrades the same way — never throwing', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'codex-catalog-'))
    const warnings: string[] = []
    const catalog = new CodexModelCatalog({
      spawn: () => { throw new Error('codex: command not found') },
      warn: message => { warnings.push(message) },
      endpoint: async () => ({ apiKey: 'sk-test' }),
      fetchImpl: serving(['gpt-a']),
    })
    await expect(catalog.refresh(homeDir)).resolves.toEqual(['gpt-a'])
    expect(warnings.some(warning => warning.includes('command not found'))).toBe(true)
  })

  it('a native probe that never answers still yields the endpoint entries after its own bound', async () => {
    const m = mount({ mode: 'silent', timeoutMs: 300, credential: { apiKey: 'sk-test' }, fetch: serving(['gpt-a']) })
    await expect(m.catalog.refresh(m.homeDir)).resolves.toEqual(['gpt-a'])
    expect(m.warnings.some(warning => warning.includes('native model/list probe failed'))).toBe(true)
  })

  it('a repeated native cursor demotes to the same warn (never a partial directory)', async () => {
    const m = mount({ mode: 'cursor-loop', credential: { apiKey: 'sk-test' }, fetch: serving(['gpt-5.6-sol']) })
    await m.catalog.refresh(m.homeDir)
    expect(m.catalog.directory(m.homeDir)).toMatchObject({ status: 'ready', entries: [{ value: 'gpt-5.6-sol' }] })
    expect(m.warnings.some(warning => warning.includes('repeated a pagination cursor'))).toBe(true)
  })

  it('retains native metadata across pagination, including the hidden candidate', async () => {
    const m = mount({ mode: 'paged', credential: { apiKey: 'sk-test' }, fetch: serving(ALL_SERVED) })
    expect(await m.catalog.refresh(m.homeDir)).toEqual(['gpt-5.6-sol', 'gpt-5.5', 'only-model-field'])
    const directory = m.catalog.directory(m.homeDir)
    expect(directory).toMatchObject({ status: 'ready', complete: true, defaultModel: 'gpt-5.6-sol' })
    expect(directory.entries).toHaveLength(4)
    expect(directory.entries[0]).toMatchObject({
      value: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', source: 'native',
      reasoning: { default: 'high', options: [{ value: 'high', description: 'More reasoning' }] },
    })
    expect(directory.entries.find(entry => entry.value === 'gpt-5-legacy')?.hidden).toBe(true)
  })

  it('401/403 read as a rejected credential (definitive — cached as data)', async () => {
    const m = mount({
      credential: { apiKey: 'sk-dead' },
      fetch: (async () => ({ ok: false, status: 401, text: async () => 'invalid' })),
    })
    await m.catalog.refresh(m.homeDir)
    const directory = m.catalog.directory(m.homeDir)
    expect(directory).toMatchObject({ status: 'unsupported', entries: [] })
    expect(directory.reason).toContain('rejected the credential (HTTP 401)')
  })

  it('another HTTP status reads as "serves no model list"; a foreign shape as unparseable; zero as empty', async () => {
    const http = mount({
      credential: { apiKey: 'sk-test' },
      fetch: (async () => ({ ok: false, status: 500, text: async () => 'oops' })),
    })
    expect((await http.catalog.refresh(http.homeDir)).length).toBe(0)
    expect(http.catalog.directory(http.homeDir).reason).toContain('does not serve a model list (HTTP 500)')
    const malformed = mount({
      credential: { apiKey: 'sk-test' },
      fetch: (async () => ({ ok: true, status: 200, text: async () => '<html>' })),
    })
    expect((await malformed.catalog.refresh(malformed.homeDir)).length).toBe(0)
    expect(malformed.catalog.directory(malformed.homeDir).reason).toContain('did not parse')
    const empty = mount({ credential: { apiKey: 'sk-test' }, fetch: serving([]) })
    expect((await empty.catalog.refresh(empty.homeDir)).length).toBe(0)
    expect(empty.catalog.directory(empty.homeDir).reason).toContain('serves no models')
  })

  it('an unreachable endpoint keeps the last good list (the throw is not a verdict)', async () => {
    let down = false
    const m = mount({
      credential: { apiKey: 'sk-test' },
      fetch: (async () => {
        if (down) throw new Error('ECONNREFUSED')
        return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'gpt-a' }] }) }
      }),
    })
    expect(await m.catalog.refresh(m.homeDir)).toEqual(['gpt-a'])
    down = true
    expect(await m.catalog.refresh(m.homeDir)).toEqual(['gpt-a'])
    const directory = m.catalog.directory(m.homeDir)
    expect(directory.status).toBe('stale')
    expect(directory.entries.map(entry => entry.value)).toEqual(['gpt-a'])
    expect(m.warnings.some(warning => warning.includes('endpoint unreachable'))).toBe(true)
  })
})

describe('codex model catalog: cache mechanics', () => {
  it('captures the CLI’s built-in default from the native probe’s first isDefault marker', async () => {
    const m = mount({ credential: { apiKey: 'sk-test' }, fetch: serving(ALL_SERVED) })
    // Cold cache: no default is known yet.
    expect(m.catalog.readDefault(m.homeDir)).toBeUndefined()
    await m.catalog.refresh(m.homeDir)
    // The visible gpt-5.6-sol carries the first marker; the hidden legacy
    // entry's later marker never wins.
    expect(m.catalog.readDefault(m.homeDir)).toBe('gpt-5.6-sol')
  })

  it('readDefault shares the cached probe with read — one load serves both', async () => {
    const m = mount({ credential: { apiKey: 'sk-test' }, fetch: serving(ALL_SERVED) })
    // Both cold reads kick the same background probe.
    expect(m.catalog.read(m.homeDir)).toEqual([])
    expect(m.catalog.readDefault(m.homeDir)).toBeUndefined()
    await m.catalog.refresh(m.homeDir)
    expect(m.fetches).toHaveLength(1)
    expect(m.spawns).toHaveLength(1)
    expect(m.catalog.read(m.homeDir)).toEqual(['gpt-5.6-sol', 'gpt-5.5', 'only-model-field'])
    expect(m.catalog.readDefault(m.homeDir)).toBe('gpt-5.6-sol')
    expect(m.fetches).toHaveLength(1)
    expect(m.spawns).toHaveLength(1)
  })

  it('serves read() from the cache and probes nothing again within the TTL', async () => {
    const m = mount({ ttlMs: 60_000, credential: { apiKey: 'sk-test' }, fetch: serving(['gpt-5.6-sol', 'gpt-5.5']) })
    // Cold cache: read() answers empty synchronously and probes in the background.
    expect(m.catalog.read(m.homeDir)).toEqual([])
    const probed = await m.catalog.refresh(m.homeDir)
    expect(probed).toEqual(['gpt-5.6-sol', 'gpt-5.5'])
    expect(m.fetches).toHaveLength(1)
    expect(m.spawns).toHaveLength(1)
    // Warm cache: read() answers the probed slugs; further reads probe nothing.
    expect(m.catalog.read(m.homeDir)).toEqual(probed)
    expect(m.catalog.read(m.homeDir)).toEqual(probed)
    expect(m.fetches).toHaveLength(1)
    expect(m.spawns).toHaveLength(1)
  })

  it('re-probes once the TTL expires', async () => {
    const m = mount({ ttlMs: 50, credential: { apiKey: 'sk-test' }, fetch: serving(['gpt-a']) })
    await m.catalog.refresh(m.homeDir)
    expect(m.fetches).toHaveLength(1)
    expect(m.spawns).toHaveLength(1)
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(m.catalog.read(m.homeDir)).toEqual(['gpt-a'])
    await m.catalog.refresh(m.homeDir)
    expect(m.fetches).toHaveLength(2)
    expect(m.spawns).toHaveLength(2)
  })

  it('shares one in-flight probe between concurrent refreshes of the same home', async () => {
    const m = mount({ credential: { apiKey: 'sk-test' }, fetch: serving(['gpt-a']) })
    const [a, b] = await Promise.all([m.catalog.refresh(m.homeDir), m.catalog.refresh(m.homeDir)])
    expect(a).toEqual(b)
    expect(m.fetches).toHaveLength(1)
    expect(m.spawns).toHaveLength(1)
  })
})
