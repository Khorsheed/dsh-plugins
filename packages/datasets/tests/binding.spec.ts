/** Session binding: validation, the plugin-owned durable store, restart persistence. */
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeSegment, normalizeRepoPath, readBinding, validateBinding, writeBinding } from '../src/binding.ts'
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

describe('repo path normalization (I5 walkthrough gap G5)', () => {
  it('expands a leading ~ — nothing downstream of the store does', () => {
    const home = realpathSync(homedir())
    expect(normalizeRepoPath('~')).toBe(home)
    expect(normalizeRepoPath('~/x/y')).toBe(join(home, 'x', 'y'))
    // Only the home shorthand: a directory whose name starts with ~ is a
    // directory, not a shorthand.
    expect(normalizeRepoPath('/tmp/~notme')).toBe('/tmp/~notme')
  })

  it('makes the path absolute, drops trailing slashes, and resolves symlinks', () => {
    // `dir` is the module-level fixture the afterEach hook removes.
    dir = mkdtempSync(join(tmpdir(), 'dsh-datasets-norm-'))
    expect(normalizeRepoPath(`  ${dir}/  `)).toBe(realpathSync(dir))
    expect(normalizeRepoPath(dir)).toBe(normalizeRepoPath(`${dir}//`))
  })

  it('keeps a path that is not there rather than failing — existence is assertRepository\u2019s job', () => {
    expect(normalizeRepoPath('/nonexistent-repo-path-for-this-test/')).toBe('/nonexistent-repo-path-for-this-test')
  })

  it('normalizes on the way into the store, so no consumer has to', () => {
    expect(validateBinding({ repoPath: '~/repo/' }).repoPath).toBe(join(realpathSync(homedir()), 'repo'))
  })

  it('migrates an old record IN PLACE on read: the ~ stops being a trap for the next reader', () => {
    const root = storeRoot()
    // A record as the pre-G5 store wrote it: the literal path the human typed.
    writeFileSync(
      join(root, `${encodeSegment('s1')}.json`),
      `${JSON.stringify({ version: 1, binding: { repoPath: '~/legacy-repo', layers: ['visible'] } })}\n`,
      'utf8',
    )
    const expected = join(realpathSync(homedir()), 'legacy-repo')
    expect(readBinding(root, 's1')).toEqual({ repoPath: expected, layers: ['visible'] })
    // Written back, not just answered: the next reader (git, readdir, the CLI)
    // sees the canonical path too.
    const record = JSON.parse(readFileSync(join(root, `${encodeSegment('s1')}.json`), 'utf8')) as {
      binding: { repoPath: string }
    }
    expect(record.binding.repoPath).toBe(expected)
  })
})

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
