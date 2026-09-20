/**
 * The per-site allow-record store: empty/corrupt reads, atomic persistence,
 * the prototype-key guard, and the record cap. Every test gets a throwaway
 * state root under the OS temp dir.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CaptureStore,
  isRecordableHost,
  MAX_SITE_RECORDS,
  parseCaptureStateDoc,
  resolveCaptureStateRoot,
  serializeCaptureStateDoc,
} from '../src/index.ts'

const roots: string[] = []

function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-capture-store-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('resolveCaptureStateRoot', () => {
  it('prefers the config, then $DSH_HOME/state, then the cwd fallback', () => {
    expect(resolveCaptureStateRoot('/tmp/explicit')).toBe('/tmp/explicit')
    const home = process.env.DSH_HOME
    process.env.DSH_HOME = '/tmp/dsh-home-probe'
    try {
      expect(resolveCaptureStateRoot(undefined)).toBe('/tmp/dsh-home-probe/state/dsh-capture')
    } finally {
      if (home === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = home
    }
  })
})

describe('CaptureStore', () => {
  it('reads a missing document as empty and persists records atomically', () => {
    const root = stateRoot()
    const store = new CaptureStore(root)
    expect(store.site('example.com')).toBeUndefined()
    store.recordRender('example.com', '2026-09-21T00:00:00.000Z')
    expect(store.site('example.com')).toEqual({
      firstAllowedAt: '2026-09-21T00:00:00.000Z',
      lastRenderAt: '2026-09-21T00:00:00.000Z',
      renders: 1,
    })
    // The document landed on disk, and no temporary file is left behind.
    expect(existsSync(store.file)).toBe(true)
    expect(existsSync(`${store.file}.${process.pid}.tmp`)).toBe(false)
  })

  it('a fresh instance reads what another persisted', () => {
    const root = stateRoot()
    new CaptureStore(root).recordRender('example.com', '2026-09-21T00:00:00.000Z')
    const reloaded = new CaptureStore(root)
    expect(reloaded.site('example.com')?.renders).toBe(1)
  })

  it('later renders refresh the record without touching the first-allow instant', () => {
    const root = stateRoot()
    const store = new CaptureStore(root)
    store.recordRender('example.com', '2026-09-21T00:00:00.000Z')
    store.recordRender('example.com', '2026-09-21T01:00:00.000Z')
    expect(store.site('example.com')).toEqual({
      firstAllowedAt: '2026-09-21T00:00:00.000Z',
      lastRenderAt: '2026-09-21T01:00:00.000Z',
      renders: 2,
    })
  })

  it('a corrupt document reads as empty in memory and is NEVER overwritten', () => {
    const root = stateRoot()
    const file = join(root, 'state.json')
    writeFileSync(file, '{ this is not json')
    const warnings: string[] = []
    const store = new CaptureStore(root, { warn: (m) => warnings.push(m) })
    expect(store.site('example.com')).toBeUndefined()
    store.recordRender('example.com', '2026-09-21T00:00:00.000Z')
    expect(readFileSync(file, 'utf8')).toBe('{ this is not json')
    expect(warnings.some((m) => m.includes('not a readable state document'))).toBe(true)
  })

  it('rejects a document from an unknown format version', () => {
    expect(parseCaptureStateDoc(JSON.stringify({ version: 99, sites: {} }))).toBeUndefined()
    expect(parseCaptureStateDoc('[]')).toBeUndefined()
    expect(parseCaptureStateDoc(JSON.stringify({
      version: 1,
      sites: { 'example.com': { firstAllowedAt: 'x', lastRenderAt: 'y', renders: 'NaN' } },
    }))).toBeUndefined()
  })

  it('serialization is deterministic (hosts sorted)', () => {
    const a = serializeCaptureStateDoc({
      version: 1,
      sites: {
        'b.example.com': { firstAllowedAt: 't', lastRenderAt: 't', renders: 1 },
        'a.example.com': { firstAllowedAt: 't', lastRenderAt: 't', renders: 1 },
      },
    })
    expect(a.indexOf('a.example.com')).toBeLessThan(a.indexOf('b.example.com'))
  })

  it('never records prototype-polluting host keys', () => {
    const root = stateRoot()
    const store = new CaptureStore(root)
    store.recordRender('__proto__', '2026-09-21T00:00:00.000Z')
    store.recordRender('constructor', '2026-09-21T00:00:00.000Z')
    expect(store.site('__proto__')).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('renders')
    expect(isRecordableHost('example.com')).toBe(true)
    expect(isRecordableHost('')).toBe(false)
  })

  it('caps the record table, evicting the least-recently-rendered hosts', () => {
    const root = stateRoot()
    const store = new CaptureStore(root)
    for (let i = 0; i < MAX_SITE_RECORDS + 10; i += 1) {
      store.recordRender(`host-${String(i).padStart(4, '0')}.example.com`, `2026-09-21T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`)
    }
    const reloaded = new CaptureStore(root)
    expect(reloaded.site('host-0000.example.com')).toBeUndefined() // oldest evicted
    expect(reloaded.site(`host-${String(MAX_SITE_RECORDS + 9).padStart(4, '0')}.example.com`)).toBeDefined()
    const doc = parseCaptureStateDoc(readFileSync(join(root, 'state.json'), 'utf8'))
    expect(Object.keys(doc!.sites).length).toBe(MAX_SITE_RECORDS)
  })
})
