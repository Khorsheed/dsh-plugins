/**
 * The dsh records adapter: lists the sub-dsh's own sessions by reading the
 * zstd JSONL headers in the scoped-home store.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { listDshSessions, parseDshSessionHeader, readDshSessionHeaderLine } from '../src/records.ts'

/**
 * A store root with one session under a project dir, header first frame.
 * `basename` is the generation filename the store wrote: the original
 * unversioned log by default, `session.v3.jsonl.zstd` on host 0.1.5.
 */
function wireStore(basename = 'session.jsonl.zstd'): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-records-'))
  const dir = join(home, 'sessions', '--tmp-abc--', 'session-6ba7b810-9dad-11d1-80b4-00c04fd430c8')
  mkdirSync(dir, { recursive: true })
  const header = JSON.stringify({
    type: 'session',
    version: 0,
    id: 'session-6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    createdAt: 1786978986032,
    cwd: '/tmp/abc',
  })
  const bytes = basename.endsWith('.zstd') ? zstdCompressSync(header) : Buffer.from(`${header}\n`)
  writeFileSync(join(dir, basename), bytes)
  // The real 0.1.5 directory keeps a lock file beside the log; it is not a
  // session log and must not be mistaken for one.
  writeFileSync(join(dir, 'session.lock'), '')
  return home
}

describe('dsh records adapter', () => {
  it('lists sessions from the scoped-home store with id, workDir, and startedAt', async () => {
    const home = wireStore()
    const records = await listDshSessions(home)
    expect(records).toEqual([{
      id: 'session-6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      workDir: '/tmp/abc',
      startedAt: 1786978986032,
    }])
  })

  it('returns an empty list for an absent store', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-records-empty-'))
    expect(await listDshSessions(home)).toEqual([])
  })

  it('skips non-session files and torn logs without failing the listing', async () => {
    const home = wireStore()
    const dir = join(home, 'sessions', '--tmp-abc--', 'not-a-session')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.from([0x01, 0x02, 0x03]))
    const records = await listDshSessions(home)
    expect(records).toHaveLength(1)
  })

  it('parses only real session header lines', () => {
    expect(parseDshSessionHeader('{"type":"session","id":"s-1"}')).toEqual({ id: 's-1' })
    expect(parseDshSessionHeader('{"type":"user/message"}')).toBeUndefined()
    expect(parseDshSessionHeader('not json')).toBeUndefined()
  })

  it('returns undefined for a missing log file', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-records-missing-'))
    expect(await readDshSessionHeaderLine(join(home, 'nope.jsonl.zstd'))).toBeUndefined()
  })
})

describe('dsh records adapter — log generations (T30d)', () => {
  const EXPECTED = [{
    id: 'session-6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    workDir: '/tmp/abc',
    startedAt: 1786978986032,
  }]

  it('lists a session whose log is host 0.1.5\u2019s session.v3.jsonl.zstd', async () => {
    // The name `/dsh sessions` used to miss entirely, listing nothing at all.
    await expect(listDshSessions(wireStore('session.v3.jsonl.zstd'))).resolves.toEqual(EXPECTED)
  })

  it('still lists the original unversioned log (the old host line)', async () => {
    await expect(listDshSessions(wireStore('session.jsonl.zstd'))).resolves.toEqual(EXPECTED)
  })

  it('lists a RAW log too (compression: none)', async () => {
    await expect(listDshSessions(wireStore('session.v3.jsonl'))).resolves.toEqual(EXPECTED)
  })

  it('reads the highest generation when a migrated store keeps several', async () => {
    const home = wireStore('session.jsonl.zstd')
    const dir = join(home, 'sessions', '--tmp-abc--', 'session-6ba7b810-9dad-11d1-80b4-00c04fd430c8')
    writeFileSync(join(dir, 'session.v3.jsonl.zstd'), zstdCompressSync(JSON.stringify({
      type: 'session',
      version: 0,
      id: 'session-6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      createdAt: 1786978986032,
      cwd: '/tmp/migrated',
    })))
    // The v3 header is the current history, so its cwd is what the listing shows.
    await expect(listDshSessions(home)).resolves.toEqual([{ ...EXPECTED[0]!, workDir: '/tmp/migrated' }])
  })

  it('a session directory holding only a lock file is skipped', async () => {
    const home = wireStore('session.v3.jsonl.zstd')
    const dir = join(home, 'sessions', '--tmp-abc--', 'lock-only')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.lock'), '')
    await expect(listDshSessions(home)).resolves.toHaveLength(1)
  })
})
