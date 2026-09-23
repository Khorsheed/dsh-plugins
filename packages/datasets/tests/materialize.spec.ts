/**
 * Whole-layer materialization by `git archive` (T73): content-addressed,
 * read-only, a cache hit on repeat, and it never writes the repository's
 * shared `.git` — no worktree entry, no HEAD move.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkMaterializedRootIntegrity, layerPaths, layersKeyOf, materializePaths, repoKeyOf,
} from '../src/materialize.ts'
import { cleanup, commitAll, git, makeFixtureRepo, writeFiles, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo
let root: string

beforeEach(() => {
  repo = makeFixtureRepo()
  root = mkdtempSync(join(tmpdir(), 'dsh-materialized-'))
})

afterEach(() => {
  cleanup(repo.dir)
  cleanup(root)
})

/** The shared state a materialization must not touch. */
function sharedState(dir: string): { head: string; worktrees: number } {
  return {
    head: git(dir, ['rev-parse', 'HEAD']).trim(),
    worktrees: git(dir, ['worktree', 'list']).trim().split('\n').length,
  }
}

describe('materializePaths', () => {
  it('extracts exactly the pathspecs into <repoKey>/<sha>/<set>/<layers-key>, read-only', async () => {
    const before = sharedState(repo.dir)
    const view = await materializePaths(
      repo.dir, repo.commit, 'alpha', ['visible'], ['datasets/alpha/items/i1/visible', 'datasets/alpha/visible'], root,
    )
    const commonDir = realpathSync(join(repo.dir, '.git'))
    expect(view).toEqual({
      path: join(root, repoKeyOf(commonDir), repo.commit, 'alpha', 'visible'),
      commit: repo.commit,
      layers: ['visible'],
      reused: false,
    })
    expect(existsSync(join(view.path, 'datasets/alpha/items/i1/visible'))).toBe(true)
    expect(existsSync(join(view.path, 'datasets/alpha/visible/guide.md'))).toBe(true)
    // A layer that was not asked for is physically absent.
    expect(existsSync(join(view.path, 'datasets/alpha/items/i1/hidden'))).toBe(false)
    expect(existsSync(join(view.path, 'datasets/alpha/hidden'))).toBe(false)
    // Read-only all the way down.
    expect(statSync(view.path).mode & 0o222).toBe(0)
    expect(statSync(join(view.path, 'datasets/alpha/visible/guide.md')).mode & 0o222).toBe(0)
    // No staging left behind, and the repository's shared state is untouched.
    expect(checkMaterializedRootIntegrity(root)).toBeUndefined()
    expect(sharedState(repo.dir)).toEqual(before)
  })

  it('a repeat call is a cache hit; another layer set or commit is another directory', async () => {
    const paths = ['datasets/alpha/items/i1/visible']
    const first = await materializePaths(repo.dir, repo.commit, 'alpha', ['visible'], paths, root)
    const again = await materializePaths(repo.dir, repo.commit, 'alpha', ['visible'], paths, root)
    expect(again).toEqual({ ...first, reused: true })

    const both = await materializePaths(
      repo.dir, repo.commit, 'alpha', ['visible', 'hidden'], [...paths, 'datasets/alpha/items/i1/hidden'], root,
    )
    expect(both.path.endsWith(join('alpha', 'hidden+visible'))).toBe(true)
    expect(both.layers).toEqual(['hidden', 'visible'])

    writeFiles(repo.dir, { 'datasets/alpha/items/i1/visible/task.md': 'v2\n' })
    const next = commitAll(repo.dir, 'v2')
    const moved = await materializePaths(repo.dir, next, 'alpha', ['visible'], paths, root)
    expect(moved.path).not.toBe(first.path)
    expect(readFileSync(join(moved.path, 'datasets/alpha/items/i1/visible/task.md'), 'utf8')).toBe('v2\n')
    // The earlier commit's bytes are still what its key says.
    expect(readFileSync(join(first.path, 'datasets/alpha/items/i1/visible/task.md'), 'utf8')).not.toBe('v2\n')
  })

  it('a linked worktree shares its repository\'s cache', async () => {
    const linked = mkdtempSync(join(tmpdir(), 'dsh-materialized-linked-'))
    cleanup(linked)
    git(repo.dir, ['worktree', 'add', '-q', '--detach', linked])
    try {
      const paths = ['datasets/alpha/items/i1/visible']
      const first = await materializePaths(repo.dir, repo.commit, 'alpha', ['visible'], paths, root)
      const viaLinked = await materializePaths(linked, repo.commit, 'alpha', ['visible'], paths, root)
      expect(viaLinked).toEqual({ ...first, reused: true })
    } finally {
      git(repo.dir, ['worktree', 'remove', '--force', linked])
    }
  })

  it('refuses a sha that is abbreviated, a branch name, or unknown to the repository', async () => {
    const paths = ['datasets/alpha/items/i1/visible']
    for (const sha of [repo.commit.slice(0, 7), 'main', 'f'.repeat(40)]) {
      await expect(materializePaths(repo.dir, sha, 'alpha', ['visible'], paths, root))
        .rejects.toMatchObject({ code: 'GIT_ERROR' })
    }
    expect(checkMaterializedRootIntegrity(root)).toBeUndefined()
  })

  it('refuses absolute paths and paths outside the dataset', async () => {
    for (const path of ['/etc/passwd', 'datasets/beta/items/b1/visible', '../outside', 'datasets/alpha/../beta']) {
      await expect(materializePaths(repo.dir, repo.commit, 'alpha', ['visible'], [path], root))
        .rejects.toMatchObject({ code: 'INVALID_NAME' })
    }
  })

  it('refuses a dataset id or layer name that is not a valid name', async () => {
    await expect(materializePaths(repo.dir, repo.commit, '../x', ['visible'], [], root)).rejects.toThrow()
    await expect(materializePaths(repo.dir, repo.commit, 'alpha', ['a/b'], [], root)).rejects.toThrow()
  })
})

describe('layerPaths and keys', () => {
  it('covers dataset-level and item-level layer directories of the asked layers only', () => {
    const files = [
      'datasets/alpha/dataset.json',
      'datasets/alpha/visible/guide.md',
      'datasets/alpha/hidden/answers.md',
      'datasets/alpha/items/i1/item.json',
      'datasets/alpha/items/i1/visible/task.md',
      'datasets/alpha/items/i1/hidden/key.md',
      'datasets/beta/items/b1/visible/task.md',
    ]
    expect(layerPaths('alpha', ['visible'], files)).toEqual([
      'datasets/alpha/items/i1/visible',
      'datasets/alpha/visible',
    ])
  })

  it('the layers key is sorted and deduplicated; the repo key is 16 hex', () => {
    expect(layersKeyOf(['visible', 'hidden', 'visible'])).toBe('hidden+visible')
    expect(repoKeyOf('/x/.git')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('checkMaterializedRootIntegrity', () => {
  it('flags a foreign entry at any level', async () => {
    expect(checkMaterializedRootIntegrity(join(root, 'absent'))).toBeUndefined()
    writeFileSync(join(root, 'stray.txt'), 'x')
    expect(checkMaterializedRootIntegrity(root)).toMatch(/unexpected entry/)
    cleanup(join(root, 'stray.txt'))
    mkdirSync(join(root, repoKeyOf('/x'), 'not-a-sha'), { recursive: true })
    expect(checkMaterializedRootIntegrity(root)).toMatch(/unexpected entry/)
  })
})
