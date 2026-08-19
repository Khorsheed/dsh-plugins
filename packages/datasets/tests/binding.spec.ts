/** Session binding: validation, the plugin-owned durable store, restart persistence. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeSegment, readBinding, validateBinding, writeBinding } from '../src/binding.ts'
import { DatasetsError } from '../src/dataset.ts'
import { cleanup } from './helpers.ts'

let dir: string | undefined

afterEach(() => {
  if (dir !== undefined) cleanup(dir)
  dir = undefined
})

/** A fresh bindings root under the runtime temp directory. */
function storeRoot(): string {
  dir = mkdtempSync(join(tmpdir(), 'dsh-datasets-bind-'))
  return dir
}

describe('binding validation', () => {
  it('validates the binding shape', () => {
    expect(validateBinding({ repoPath: '/r' })).toEqual({ repoPath: '/r' })
    expect(validateBinding({ repoPath: '/r', layers: ['a'], datasets: ['d'] }))
      .toEqual({ repoPath: '/r', layers: ['a'], datasets: ['d'] })
    expect(() => validateBinding({})).toThrowError(DatasetsError)
    expect(() => validateBinding({ repoPath: '  ' })).toThrowError(DatasetsError)
    expect(() => validateBinding({ repoPath: '/r', layers: 'x' })).toThrowError(DatasetsError)
  })
})

describe('binding store', () => {
  it('write/read round-trips, last write wins, unbind removes the record', () => {
    const root = storeRoot()
    expect(readBinding(root, 's1')).toBeUndefined()
    writeBinding(root, 's1', { repoPath: '/one', layers: ['visible'] })
    writeBinding(root, 's1', { repoPath: '/two' })
    expect(readBinding(root, 's1')).toEqual({ repoPath: '/two' })
    writeBinding(root, 's1', null)
    expect(readBinding(root, 's1')).toBeUndefined()
  })

  it('persists across a simulated restart: the store is stateless, every read hits the file', () => {
    const root = storeRoot()
    writeBinding(root, 's1', { repoPath: '/repo', datasets: ['alpha'], layers: ['visible'] })
    // A restarted process re-reads the same file; no in-memory state carries over.
    expect(readBinding(root, 's1')).toEqual({ repoPath: '/repo', datasets: ['alpha'], layers: ['visible'] })
    // The on-disk record is versioned JSON under the encoded session id.
    const record = JSON.parse(readFileSync(join(root, `${encodeSegment('s1')}.json`), 'utf8')) as unknown
    expect(record).toEqual({ version: 1, binding: { repoPath: '/repo', datasets: ['alpha'], layers: ['visible'] } })
  })

  it('fails loud on a corrupt or shape-invalid record instead of dropping the binding', () => {
    const root = storeRoot()
    writeBinding(root, 's1', { repoPath: '/repo' })
    writeFileSync(join(root, `${encodeSegment('s1')}.json`), '{not json', 'utf8')
    expect(() => readBinding(root, 's1')).toThrowError(DatasetsError)
    writeFileSync(join(root, `${encodeSegment('s1')}.json`), '{"version":2,"binding":null}', 'utf8')
    expect(() => readBinding(root, 's1')).toThrowError(DatasetsError)
  })

  it('encodes session ids path-safely', () => {
    expect(encodeSegment('plain-1_x.z')).toBe('plain-1_x.z')
    expect(encodeSegment('a/b')).toBe('a~002Fb')
    expect(encodeSegment('..')).toBe('~002E~002E')
  })
})
