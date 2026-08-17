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

/** A store root with one session under a project dir, header first frame. */
function wireStore(): string {
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
  writeFileSync(join(dir, 'session.jsonl.zstd'), zstdCompressSync(header))
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
