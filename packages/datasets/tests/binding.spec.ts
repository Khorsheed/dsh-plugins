/** Legacy session-binding records: validation and path normalization (the registry import's input). */
import { mkdtempSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeSegment, validateBinding } from '../src/binding.ts'
import { normalizeRepoPath } from '../src/repo-path.ts'
import { DatasetsError } from '../src/dataset.ts'
import { cleanup } from './helpers.ts'

let dir: string | undefined

afterEach(() => {
  if (dir !== undefined) cleanup(dir)
  dir = undefined
})

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

  it('normalizes a legacy record\u2019s path as the import reads it', () => {
    expect(validateBinding({ repoPath: '~/repo/' }).repoPath).toBe(join(realpathSync(homedir()), 'repo'))
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

describe('legacy record file names', () => {
  it('encodes session ids path-safely', () => {
    expect(encodeSegment('plain-1_x.z')).toBe('plain-1_x.z')
    expect(encodeSegment('a/b')).toBe('a~002Fb')
    expect(encodeSegment('..')).toBe('~002E~002E')
  })
})
