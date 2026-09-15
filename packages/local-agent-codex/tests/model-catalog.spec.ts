/**
 * The codex account model catalog: the one-shot `model/list` probe against a
 * fake app-server (a real node child speaking NDJSON JSON-RPC over stdio),
 * the hidden-entry filter and slug extraction, the `isDefault` built-in
 * default capture, the per-home TTL cache with one shared in-flight probe,
 * and the degrade-on-any-failure contract.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it } from 'vitest'
import { CodexModelCatalog } from '../src/model-catalog.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-codex-app-server.mjs', import.meta.url))

/** A catalog over a tmp scoped home, probing the fake app-server as a real child. */
function mount(options: { mode?: string; timeoutMs?: number; ttlMs?: number } = {}): {
  catalog: CodexModelCatalog
  homeDir: string
  spawns: SubprocessSpawnSpec[]
  warnings: string[]
} {
  const homeDir = mkdtempSync(join(tmpdir(), 'codex-catalog-'))
  const spawns: SubprocessSpawnSpec[] = []
  const warnings: string[] = []
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
    ...options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
    ...options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs },
  })
  return { catalog, homeDir, spawns, warnings }
}

describe('codex model catalog probe', () => {
  it('spawns the app-server with the live driver’s argv and scoped-home pinning', async () => {
    const m = mount()
    await m.catalog.refresh(m.homeDir)
    expect(m.spawns).toHaveLength(1)
    expect(m.spawns[0]!.argv).toEqual(['codex', 'app-server', '--stdio'])
    expect(m.spawns[0]!.env?.['CODEX_HOME']).toBe(m.homeDir)
    expect(m.spawns[0]!.stdio).toEqual({ stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  })

  it('parses model/list, filters hidden entries, dedupes, and falls back to the model field', async () => {
    const m = mount()
    const models = await m.catalog.refresh(m.homeDir)
    expect(models).toEqual(['gpt-5.6-sol', 'gpt-5.5', 'only-model-field'])
  })

  it('retains native labels, hidden candidates and reasoning options across pagination', async () => {
    const m = mount({ mode: 'paged' })
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

  it('rejects repeated cursors instead of presenting a partial directory as complete', async () => {
    const m = mount({ mode: 'cursor-loop' })
    await m.catalog.refresh(m.homeDir)
    expect(m.catalog.directory(m.homeDir)).toMatchObject({ status: 'error', complete: false })
    expect(m.warnings.some(warning => warning.includes('repeated a pagination cursor'))).toBe(true)
  })

  it('captures the account’s built-in default from the first isDefault marker', async () => {
    const m = mount()
    // Cold cache: no default is known yet.
    expect(m.catalog.readDefault(m.homeDir)).toBeUndefined()
    await m.catalog.refresh(m.homeDir)
    // The visible gpt-5.6-sol carries the first marker; the hidden legacy
    // entry's later marker never wins.
    expect(m.catalog.readDefault(m.homeDir)).toBe('gpt-5.6-sol')
  })

  it('readDefault shares the cached probe with read — one process serves both', async () => {
    const m = mount()
    // Both cold reads kick the same background probe.
    expect(m.catalog.read(m.homeDir)).toEqual([])
    expect(m.catalog.readDefault(m.homeDir)).toBeUndefined()
    await m.catalog.refresh(m.homeDir)
    expect(m.spawns).toHaveLength(1)
    expect(m.catalog.read(m.homeDir)).toEqual(['gpt-5.6-sol', 'gpt-5.5', 'only-model-field'])
    expect(m.catalog.readDefault(m.homeDir)).toBe('gpt-5.6-sol')
    expect(m.spawns).toHaveLength(1)
  })

  it('degrades to no default on a malformed answer', async () => {
    const m = mount({ mode: 'garbage' })
    await m.catalog.refresh(m.homeDir)
    expect(m.catalog.readDefault(m.homeDir)).toBeUndefined()
  })

  it('serves read() from the cache and spawns no second process within the TTL', async () => {
    const m = mount({ ttlMs: 60_000 })
    // Cold cache: read() answers empty synchronously and probes in the background.
    expect(m.catalog.read(m.homeDir)).toEqual([])
    const probed = await m.catalog.refresh(m.homeDir)
    expect(probed).toEqual(['gpt-5.6-sol', 'gpt-5.5', 'only-model-field'])
    expect(m.spawns).toHaveLength(1)
    // Warm cache: read() answers the probed slugs; further reads spawn nothing.
    expect(m.catalog.read(m.homeDir)).toEqual(probed)
    expect(m.catalog.read(m.homeDir)).toEqual(probed)
    expect(m.spawns).toHaveLength(1)
  })

  it('re-probes once the TTL expires', async () => {
    const m = mount({ ttlMs: 50 })
    await m.catalog.refresh(m.homeDir)
    expect(m.spawns).toHaveLength(1)
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(m.catalog.read(m.homeDir)).toEqual(['gpt-5.6-sol', 'gpt-5.5', 'only-model-field'])
    await m.catalog.refresh(m.homeDir)
    expect(m.spawns).toHaveLength(2)
  })

  it('shares one in-flight probe between concurrent refreshes of the same home', async () => {
    const m = mount()
    const [a, b] = await Promise.all([m.catalog.refresh(m.homeDir), m.catalog.refresh(m.homeDir)])
    expect(a).toEqual(b)
    expect(m.spawns).toHaveLength(1)
  })

  it('degrades to an empty list on a malformed answer', async () => {
    const m = mount({ mode: 'garbage' })
    await expect(m.catalog.refresh(m.homeDir)).resolves.toEqual([])
  })

  it('degrades to an empty list when the answer never comes, and kills the process', async () => {
    const m = mount({ mode: 'silent', timeoutMs: 300 })
    await expect(m.catalog.refresh(m.homeDir)).resolves.toEqual([])
    expect(m.warnings.some(w => w.includes('catalog probe degraded'))).toBe(true)
  })

  it('degrades to an empty list when the spawn itself fails, never throwing', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'codex-catalog-'))
    const catalog = new CodexModelCatalog({
      spawn: () => { throw new Error('codex: command not found') },
    })
    await expect(catalog.refresh(homeDir)).resolves.toEqual([])
    expect(catalog.read(homeDir)).toEqual([])
  })
})
