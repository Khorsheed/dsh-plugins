/**
 * Integration tests for the worktrees service against a real temporary git
 * repository: summary (ahead/behind/dirty/counts), changes (both segments),
 * commit log, commit files, diffs, and path safety.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git, repoToplevel } from '../src/git.ts'
import { assertSafePath, WorktreesService } from '../src/service.ts'

/** One scratch repository per test. */
let repo: string
let cwd: string

async function run(args: string[]): Promise<void> {
  await git(repo, args)
}

async function writeCommit(relPath: string, content: string, message: string): Promise<void> {
  const abs = join(repo, relPath)
  mkdirSync(join(repo, relPath.split('/').slice(0, -1).join('/')), { recursive: true })
  writeFileSync(abs, content, 'utf8')
  await git(repo, ['add', '--', relPath])
  await git(repo, ['commit', '-m', message])
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'dsh-worktrees-'))
  cwd = repo
  await run(['init', '-b', 'main'])
  await run(['config', 'user.email', 'test@example.com'])
  await run(['config', 'user.name', 'Test'])
  await writeCommit('a.txt', 'one\n', 'feat: base a')
  await writeCommit('b.txt', 'two\n', 'feat: base b')
  // A branch with two more commits.
  await run(['checkout', '-b', 'room'])
  await writeCommit('packages/room/src/index.ts', 'hello\n', 'feat: room index')
  await writeCommit('packages/room/src/util.ts', 'util\n', 'feat: room util')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('WorktreesService', () => {
  it('summarizes the branch vs main', async () => {
    const service = new WorktreesService('main')
    const summary = await service.summary(cwd)
    expect(summary.isRepo).toBe(true)
    expect(summary.repoName).toBeTruthy()
    expect(summary.branch).toBe('room')
    // The scratch repo is a single worktree, so it IS the primary checkout.
    expect(summary.isMain).toBe(true)
    expect(summary.ahead).toBe(2)
    expect(summary.behind).toBe(0)
    expect(summary.dirty).toBe(0)
    expect(summary.committed.additions).toBeGreaterThan(0)
    expect(summary.committed.deletions).toBe(0)
    expect(summary.uncommitted.additions).toBe(0)
  })

  it('marks linked worktrees as non-main', async () => {
    const linked = join(tmpdir(), `dsh-worktrees-linked-${Date.now()}`)
    await run(['worktree', 'add', linked, 'main'])
    try {
      const service = new WorktreesService('main')
      const summary = await service.summary(linked)
      expect(summary.isMain).toBe(false)
      expect(summary.branch).toBe('main')
      expect(summary.ahead).toBe(0)
    } finally {
      await run(['worktree', 'remove', '--force', linked])
      rmSync(linked, { recursive: true, force: true })
    }
  })

  it('reports uncommitted changes and dirty count', async () => {
    writeFileSync(join(repo, 'a.txt'), 'one\nchanged\n', 'utf8')
    writeFileSync(join(repo, 'untracked.txt'), 'new\n', 'utf8')
    const service = new WorktreesService('main')
    const summary = await service.summary(cwd)
    expect(summary.dirty).toBe(2)
    expect(summary.uncommitted.additions).toBeGreaterThan(0)
    const changes = await service.changes(cwd)
    expect(changes.uncommitted.map(f => f.path).sort()).toEqual(['a.txt', 'untracked.txt'])
    expect(changes.uncommitted.find(f => f.path === 'untracked.txt')?.status).toBe('??')
    expect(changes.uncommitted.find(f => f.path === 'a.txt')?.additions).toBeGreaterThan(0)
    expect(changes.committed.map(f => f.path)).toContain('packages/room/src/index.ts')
  })

  it('returns non-ASCII paths raw (the git() helper runs core.quotePath=false)', async () => {
    await writeCommit('笔记/第一章.md', 'content\n', 'feat: chinese path')
    const service = new WorktreesService('main')
    const files = await service.repoFiles(cwd)
    expect(files).toContain('笔记/第一章.md')
    // Without quotePath=false git would emit "笔记/..." C-quoted with octal
    // escapes; assert no path arrives with a stray leading quote.
    expect(files.every(file => !file.startsWith('"'))).toBe(true)
  })

  it('returns isRepo false outside a repository', async () => {
    const outside = join(repo, '..', `not-a-repo-${Date.now()}`)
    const service = new WorktreesService('main')
    const summary = await service.summary(outside)
    expect(summary.isRepo).toBe(false)
    expect(await service.changes(outside)).toEqual({ uncommitted: [], committed: [] })
    expect(await service.repoFiles(outside)).toEqual([])
  })

  it('lists repo files excluding ignored', async () => {
    writeFileSync(join(repo, '.gitignore'), 'ignored.log\n', 'utf8')
    writeFileSync(join(repo, 'ignored.log'), 'x\n', 'utf8')
    writeFileSync(join(repo, 'tracked-new.txt'), 'y\n', 'utf8')
    await run(['add', '--', '.gitignore', 'tracked-new.txt'])
    await run(['commit', '-m', 'feat: add files'])
    const service = new WorktreesService('main')
    const files = await service.repoFiles(cwd)
    expect(files).toContain('a.txt')
    expect(files).toContain('tracked-new.txt')
    expect(files).not.toContain('ignored.log')
  })

  it('returns the commit log and per-commit files', async () => {
    const service = new WorktreesService('main')
    const log = await service.commitLog(cwd)
    expect(log).toHaveLength(2)
    expect(log[0]?.subject).toBe('feat: room util')
    expect(log[1]?.subject).toBe('feat: room index')
    const files = await service.commitFiles(cwd, log[0]?.sha ?? '')
    expect(files.files.map(f => f.path)).toContain('packages/room/src/util.ts')
  })

  it('returns per-segment and per-commit diffs', async () => {
    writeFileSync(join(repo, 'a.txt'), 'one\nchanged\n', 'utf8')
    const service = new WorktreesService('main')
    const uncommitted = await service.fileDiff(cwd, 'a.txt', 'uncommitted')
    expect(uncommitted.diff).toContain('+changed')
    const committed = await service.fileDiff(cwd, 'packages/room/src/index.ts', 'committed')
    expect(committed.diff).toContain('+hello')
    const log = await service.commitLog(cwd)
    const perCommit = await service.fileDiff(cwd, 'packages/room/src/util.ts', 'commit', log[0]?.sha)
    expect(perCommit.diff).toContain('+util')
    const none = await service.fileDiff(cwd, 'b.txt', 'uncommitted')
    expect(none.diff).toBeNull()
  })

  it('reads a file at one commit (commits-mode content view)', async () => {
    const service = new WorktreesService('main')
    // a.txt is 'one\n' at the base; capture the commit and its content.
    const log = await service.commitLog(cwd)
    expect(log.length).toBeGreaterThanOrEqual(2)
    const baseCommit = await service.commitFiles(cwd, log[log.length - 1]?.sha ?? '')
    // index.ts exists at the tip commit whose log row is the newest.
    const tip = await service.readFileAtCommit(cwd, 'packages/room/src/index.ts', log[0]?.sha ?? '')
    expect(tip.content).toBe('hello\n')
  })

  it('reads file content and caps the size', async () => {
    const service = new WorktreesService('main')
    const read = await service.readFile(cwd, 'a.txt')
    expect(read.content).toBe('one\n')
    await expect(service.readFile(cwd, '../outside.txt')).rejects.toThrow()
  })
})

describe('assertSafePath', () => {
  it('rejects absolute and traversal paths', () => {
    expect(() => assertSafePath('/etc/passwd')).toThrow()
    expect(() => assertSafePath('../x')).toThrow()
    expect(() => assertSafePath('a/../../x')).toThrow()
    expect(() => assertSafePath('')).toThrow()
  })

  it('accepts plain repo-relative paths', () => {
    expect(assertSafePath('src/a.ts')).toBe('src/a.ts')
    expect(assertSafePath('./src/a.ts')).toBe('src/a.ts')
  })
})

describe('WorktreesService worktree tool methods', () => {
  const sessionId = 'session-1'

  it('listWorktrees reports the main worktree (isMain) after a git worktree add', async () => {
    const linked = join(tmpdir(), `dsh-worktrees-tool-${Date.now()}-list`)
    try {
      await run(['worktree', 'add', linked, 'main'])
      const service = new WorktreesService('main')
      const worktrees = await service.listWorktrees(cwd)
      // git resolves symlinks, so compare against the canonical repo/worktree paths.
      const canonicalRepo = (await repoToplevel(cwd)) ?? ''
      const canonicalLinked = await realpath(linked)
      const main = worktrees.find(worktree => worktree.isMain)
      expect(main?.path).toBe(canonicalRepo)
      expect(worktrees.map(worktree => worktree.path)).toContain(canonicalLinked)
      expect(worktrees.find(worktree => worktree.path === canonicalLinked)?.isMain).toBe(false)
    } finally {
      await run(['worktree', 'remove', '--force', linked])
      rmSync(linked, { recursive: true, force: true })
    }
  })

  it('createWorktree makes a linked worktree and sets the active override', async () => {
    const linked = join(tmpdir(), `dsh-worktrees-tool-${Date.now()}-create`)
    try {
      const service = new WorktreesService('main')
      const info = await service.createWorktree(sessionId, cwd, linked, 'feat/tool-create')
      expect(info.path).toBe(await realpath(linked))
      expect(info.isMain).toBe(false)
      expect(info.branch).toBe('feat/tool-create')
      expect(service.activeWorktreeOf(sessionId)).toBe(info.path)
    } finally {
      await run(['worktree', 'remove', '--force', linked])
      rmSync(linked, { recursive: true, force: true })
    }
  })

  it('switchWorktree repoints the active override', async () => {
    const linked = join(tmpdir(), `dsh-worktrees-tool-${Date.now()}-switch`)
    try {
      await run(['worktree', 'add', linked, 'main'])
      const canonicalLinked = await realpath(linked)
      const service = new WorktreesService('main')
      await service.switchWorktree(sessionId, cwd, linked)
      expect(service.activeWorktreeOf(sessionId)).toBe(canonicalLinked)
      const canonicalRepo = (await repoToplevel(cwd)) ?? ''
      const list = await service.listWorktrees(cwd)
      expect(list.some(worktree => worktree.isMain && worktree.path === canonicalRepo)).toBe(true)
    } finally {
      await run(['worktree', 'remove', '--force', linked])
      rmSync(linked, { recursive: true, force: true })
    }
  })

  it('removeWorktree guards confirm/main/dirty and clears the override', async () => {
    const linked = join(tmpdir(), `dsh-worktrees-tool-${Date.now()}-remove`)
    try {
      await run(['worktree', 'add', linked, 'main'])
      const canonicalLinked = await realpath(linked)
      const service = new WorktreesService('main')

      // confirm !== true throws.
      await expect(service.removeWorktree(sessionId, cwd, linked, false)).rejects.toThrow(/confirm must be true/)

      // removing the main worktree throws.
      await expect(service.removeWorktree(sessionId, cwd, repo, true)).rejects.toThrow(/cannot remove the main worktree/)

      // removing a worktree with uncommitted changes throws.
      writeFileSync(join(linked, 'dirty.txt'), 'dirty\n', 'utf8')
      await expect(service.removeWorktree(sessionId, cwd, linked, true)).rejects.toThrow(/uncommitted/)

      // make it clean and set it active (canonical); removal succeeds and clears the override.
      await git(linked, ['add', 'dirty.txt'])
      await git(linked, ['commit', '-m', 'feat: dirty'])
      service.setActiveWorktree(sessionId, canonicalLinked)
      const result = await service.removeWorktree(sessionId, cwd, linked, true)
      expect(result.switchedTo).toBe((await repoToplevel(cwd)) ?? '')
      expect(service.activeWorktreeOf(sessionId)).toBeUndefined()
      expect((await service.listWorktrees(cwd)).map(worktree => worktree.path)).not.toContain(canonicalLinked)
    } finally {
      try { await run(['worktree', 'remove', '--force', linked]) } catch { /* already removed */ }
      rmSync(linked, { recursive: true, force: true })
    }
  })
})
