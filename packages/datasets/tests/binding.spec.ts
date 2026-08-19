/** Session binding: fold semantics, tombstone, validation, offline log round-trip. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { constants, zstdCompressSync } from 'node:zlib'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendBinding, bindingFromEvents, decodeBindingChange, validateBinding, type BindingSession,
} from '../src/binding.ts'
import { DatasetsError } from '../src/dataset.ts'
import { appendOfflineBinding, encodeSegment, locateSessionLog, readOfflineBinding } from '../src/session-log.ts'
import { cleanup } from './helpers.ts'

/** Minimal structural session: an in-memory event log with append. */
function fakeSession(): BindingSession & { events: SessionEvent[] } {
  const events: SessionEvent[] = []
  return {
    events,
    append(type, data) {
      events.push({ type, seq: events.length, time: Date.now(), data } as SessionEvent)
    },
  }
}

let dir: string | undefined

afterEach(() => {
  if (dir !== undefined) cleanup(dir)
  dir = undefined
})

describe('binding validation and fold', () => {
  it('validates the binding shape', () => {
    expect(validateBinding({ repoPath: '/r' })).toEqual({ repoPath: '/r' })
    expect(validateBinding({ repoPath: '/r', layers: ['a'], datasets: ['d'] }))
      .toEqual({ repoPath: '/r', layers: ['a'], datasets: ['d'] })
    expect(() => validateBinding({})).toThrowError(DatasetsError)
    expect(() => validateBinding({ repoPath: '  ' })).toThrowError(DatasetsError)
    expect(() => validateBinding({ repoPath: '/r', layers: 'x' })).toThrowError(DatasetsError)
  })

  it('folds last-write-wins and the unbind tombstone', () => {
    const session = fakeSession()
    appendBinding(session, { repoPath: '/one', layers: ['visible'] })
    appendBinding(session, { repoPath: '/two' })
    expect(bindingFromEvents(session.events)).toEqual({ repoPath: '/two' })
    appendBinding(session, null)
    expect(bindingFromEvents(session.events)).toBeUndefined()
  })

  it('survives a simulated restart: re-fold from the persisted events alone', () => {
    const session = fakeSession()
    appendBinding(session, { repoPath: '/repo', datasets: ['alpha'], layers: ['visible'] })
    // A restarted process re-reads the same log; no in-memory state carries over.
    const restored = bindingFromEvents([...session.events])
    expect(restored).toEqual({ repoPath: '/repo', datasets: ['alpha'], layers: ['visible'] })
  })

  it('rejects malformed persisted payloads loud instead of dropping them', () => {
    expect(() => decodeBindingChange({ kind: 'other', version: 1, binding: null })).toThrowError(DatasetsError)
    expect(() => decodeBindingChange({ kind: 'datasets/binding', version: 2, binding: null })).toThrowError(DatasetsError)
  })
})

describe('offline session-log append (CLI path)', () => {
  const headerLine = (id: string): string => JSON.stringify({ type: 'session', version: 1, id, createdAt: 1, delegationDepth: 0 })

  const makeLog = (compressed: boolean): { root: string; path: string } => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-datasets-log-'))
    dir = root
    const lines = `${headerLine('s1')}\n${JSON.stringify({ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } })}\n`
    const path = join(root, 'project', encodeSegment('s1'), compressed ? 'session.jsonl.zstd' : 'session.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    if (compressed) {
      writeFileSync(path, zstdCompressSync(Buffer.from(lines, 'utf8'), {
        params: { [constants.ZSTD_c_checksumFlag]: 1 },
      }))
    } else {
      writeFileSync(path, lines, 'utf8')
    }
    return { root, path }
  }

  for (const compressed of [false, true]) {
    it(`binds and reads back through a ${compressed ? 'zstd' : 'plain'} log`, async () => {
      const { root, path } = makeLog(compressed)
      expect(locateSessionLog(root, 's1')?.path).toBe(path)
      const seq = await appendOfflineBinding(root, 's1', { repoPath: '/repo', layers: ['visible'] })
      expect(seq).toBe(1)
      await expect(readOfflineBinding(root, 's1')).resolves.toEqual({ repoPath: '/repo', layers: ['visible'] })
      // A second append continues the sequence, and unbind folds to undefined.
      await expect(appendOfflineBinding(root, 's1', null)).resolves.toBe(2)
      await expect(readOfflineBinding(root, 's1')).resolves.toBeUndefined()
      if (compressed) {
        // The file holds real compressed frames (no plaintext leaks through).
        expect(readFileSync(path).includes(Buffer.from('datasets/binding'))).toBe(false)
      }
    })
  }

  it('fails loud for an unknown session', async () => {
    const { root } = makeLog(false)
    await expect(appendOfflineBinding(root, 'ghost', { repoPath: '/r' })).rejects.toThrowError(DatasetsError)
    await expect(readOfflineBinding(root, 'ghost')).resolves.toBeUndefined()
  })
})
