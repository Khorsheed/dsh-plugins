/** Managed worktrees: dedup, pin stability, physical whitelist, prune, concurrency. */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { listWorktrees } from '../src/git.ts'
import {
  checkManagedRootIntegrity, ensureWorktree, layerSparsePatterns, pruneManagedWorktrees, worktreeDirFor,
} from '../src/worktree.ts'
import { cleanup, commitAll, git, makeFixtureRepo, writeFiles, type FixtureRepo } from './helpers.ts'

let repo: FixtureRepo | undefined
let root: string | undefined

afterEach(() => {
  if (repo !== undefined) cleanup(repo.dir)
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  repo = undefined
  root = undefined
})

const managedRoot = (): string => root ??= mkdtempSync(join(tmpdir(), 'dsh-datasets-wt-'))

describe('sparse patterns', () => {
  it('cover every item directory of exactly the allowed layers', () => {
    expect(layerSparsePatterns('alpha', ['hidden', 'visible'])).toEqual([
      '/datasets/alpha/items/*/hidden/',
      '/datasets/alpha/hidden/',
      '/datasets/alpha/items/*/visible/',
      '/datasets/alpha/visible/',
    ])
  })
})

describe('ensureWorktree', () => {
  it('physically contains only the allowed layers (sparse-checkout is the mechanism)', async () => {
    repo = makeFixtureRepo()
    const wt = await ensureWorktree(repo.dir, repo.commit, 'alpha', ['visible'], managedRoot())
    expect(wt.reused).toBe(false)
    expect(existsSync(join(wt.path, 'datasets/alpha/items/i1/visible/task.md'))).toBe(true)
    expect(existsSync(join(wt.path, 'datasets/alpha/items/i1/hidden'))).toBe(false)
    expect(existsSync(join(wt.path, 'datasets/alpha/dataset.json'))).toBe(false)
    // Dataset-level layers follow the same mechanism: the allowed one is
    // present, the disallowed one is physically absent.
    expect(existsSync(join(wt.path, 'datasets/alpha/visible/guide.md'))).toBe(true)
    expect(existsSync(join(wt.path, 'datasets/alpha/hidden'))).toBe(false)
    expect(readFileSync(join(wt.path, 'datasets/alpha/items/i1/visible/task.md'), 'utf8')).toBe('task one v1\n')
    // Registered with git, and locked against accidental pruning.
    const entries = await listWorktrees(repo.dir)
    const entry = entries.find(candidate => candidate.path === wt.path)
    expect(entry?.detached).toBe(true)
    expect(entry?.locked).toBe(true)
  })

  it('deduplicates by (repo, commit, sorted layers): same key, same path', async () => {
    repo = makeFixtureRepo()
    const first = await ensureWorktree(repo.dir, repo.commit, 'alpha', ['visible'], managedRoot())
    const second = await ensureWorktree(repo.dir, repo.commit, 'alpha', ['visible'], managedRoot())
    expect(second.path).toBe(first.path)
    expect(second.reused).toBe(true)
    // A different layer set is a different key.
    const both = await ensureWorktree(repo.dir, repo.commit, 'alpha', ['hidden', 'visible'], managedRoot())
    expect(both.path).not.toBe(first.path)
  })

  it('stays pinned while the repository evolves', async () => {
    repo = makeFixtureRepo()
    const wt = await ensureWorktree(repo.dir, repo.commit, 'alpha', ['visible'], managedRoot())
    writeFiles(repo.dir, { 'datasets/alpha/items/i1/visible/task.md': 'task one v2\n' })
    commitAll(repo.dir, 'evolve')
    expect(readFileSync(join(wt.path, 'datasets/alpha/items/i1/visible/task.md'), 'utf8')).toBe('task one v1\n')
  })

  it('serializes concurrent same-key creation: one directory, no error', async () => {
    repo = makeFixtureRepo()
    const [a, b] = await Promise.all([
      ensureWorktree(repo.dir, repo.commit, 'alpha', ['visible'], managedRoot()),
      ensureWorktree(repo.dir, repo.commit, 'alpha', ['visible'], managedRoot()),
    ])
    expect(a.path).toBe(b.path)
    expect(a.reused).not.toBe(b.reused)
  })

  it('serializes concurrent same-key creation ACROSS PROCESSES', async () => {
    repo = makeFixtureRepo()
    const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
    const tsx = fileURLToPath(new URL('../../../node_modules/tsx/dist/esm/index.mjs', import.meta.url))
    const run = (): Promise<{ code: number | null; out: string; err: string }> => new Promise((resolvePromise) => {
      // The child is judged by its stderr being EMPTY (no lock-contention
      // noise). Node's own process warnings are not the CLI's output: with
      // NODE_USE_ENV_PROXY set in the parent shell, Node prints an
      // "EnvHttpProxyAgent is experimental" warning at the start of every
      // process, which failed this assertion in that environment only.
      const child = spawn(process.execPath, ['--import', tsx, cli,
        'worktree', 'path', '--dataset', 'alpha', '--repo', repo?.dir ?? '', '--worktree-root', managedRoot()],
        { env: { ...process.env, NODE_NO_WARNINGS: '1' } })
      let out = ''
      let err = ''
      child.stdout.on('data', chunk => { out += String(chunk) })
      child.stderr.on('data', chunk => { err += String(chunk) })
      child.on('close', code => { resolvePromise({ code, out, err }) })
    })
    const [a, b] = await Promise.all([run(), run()])
    expect(a.err).toBe('')
    expect(b.err).toBe('')
    expect(a.code).toBe(0)
    expect(b.code).toBe(0)
    expect(a.out.trim()).toBe(b.out.trim())
    // Both sides of the cache key are realpath-canonicalized: /var vs
    // /private/var (macOS) must not fork the cache. No --layers given: the
    // CLI defaults to the modelFacing floor (only the dataset's
    // modelFacing:true layers — the fixture declares `hidden` sensitive).
    const expected = worktreeDirFor(realpathSync(managedRoot()), realpathSync(repo.dir), repo.commit, ['visible'], [])
    expect(a.out.trim()).toBe(expected)
  }, 60_000)
})

describe('pruneManagedWorktrees', () => {
  it('unlocks and removes only the managed worktrees of the repo', async () => {
    repo = makeFixtureRepo()
    const wt = await ensureWorktree(repo.dir, repo.commit, 'alpha', ['visible'], managedRoot())
    const other = await ensureWorktree(repo.dir, repo.commit, 'alpha', ['hidden'], managedRoot())
    const removed = await pruneManagedWorktrees(repo.dir, managedRoot())
    expect(removed.sort()).toEqual([other.path, wt.path].sort())
    expect(existsSync(wt.path)).toBe(false)
    const entries = await listWorktrees(repo.dir)
    expect(entries.filter(entry => entry.path.startsWith(managedRoot()))).toEqual([])
    // A second prune is a no-op.
    await expect(pruneManagedWorktrees(repo.dir, managedRoot())).resolves.toEqual([])
  })
})

describe('managed-root integrity (invariant companion check)', () => {
  it('accepts a sound root and flags foreign or partial entries', async () => {
    repo = makeFixtureRepo()
    expect(checkManagedRootIntegrity(managedRoot())).toBeUndefined()
    const wt = await ensureWorktree(repo.dir, repo.commit, 'alpha', ['visible'], managedRoot())
    expect(checkManagedRootIntegrity(managedRoot())).toBeUndefined()
    // A foreign directory under a hash dir fails the check.
    const foreign = join(dirname(wt.path), 'not-a-worktree')
    writeFiles(foreign, { 'x.txt': 'x' })
    expect(checkManagedRootIntegrity(managedRoot())).toMatch(/worktree shape/)
    rmSync(foreign, { recursive: true, force: true })
    // A partial worktree (no .git) fails too.
    rmSync(join(wt.path, '.git'), { force: true })
    expect(checkManagedRootIntegrity(managedRoot())).toMatch(/no \.git/)
  })
})
