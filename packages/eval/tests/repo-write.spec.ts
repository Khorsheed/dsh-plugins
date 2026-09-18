/**
 * I5·T60 — the narrow write into the bound dataset repository (I5·T39 · G16).
 *
 * The gap was not that the agent could not write; it was the SIZE of the grant
 * it took. The session's workspace is not the dataset repository, so `write`
 * reaching the analysis draft's home asked a person to escalate the sandbox to
 * `danger-full-access` — the whole machine, once per markdown file. This verb
 * is the act at its own size, so what the tests below pin is the door: the
 * pass-through areas are writable, the item material is not, at any depth or
 * spelling, and every refusal names the path and the door.
 */
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { REPO_WRITE_PREFIXES, resolveRepoWrite } from '../src/repo-write.ts'
import { EvalService } from '../src/service.ts'
import { cleanupTmp, tmpTree } from './helpers.ts'

afterEach(cleanupTmp)

/** A repository with one dataset set, as the binding would name it. */
function repoWithSet(set = 'harness-comparison'): string {
  const repo = tmpTree()
  mkdirSync(join(repo, 'datasets', set, 'items', 'P0', 'answers'), { recursive: true })
  mkdirSync(join(repo, 'datasets', set, 'plans'), { recursive: true })
  return repo
}

/** The service with a datasets binding for session `s1`. */
function service(repo: string, datasets?: string[]) {
  const binding = { repoPath: repo, ...(datasets === undefined ? {} : { datasets }) }
  return new EvalService({
    get: (name: string) => (name === 'datasets' ? { binding: () => binding } : undefined),
  })
}

describe('the write door', () => {
  it('takes the repository\'s pass-through areas', async () => {
    const repo = repoWithSet()
    for (const path of [
      'docs/i5-analysis.md',
      'docs/notes/deep/one.md',
      'datasets/harness-comparison/plans/p.json',
      'datasets/harness-comparison/conditions/c.json',
      'datasets/harness-comparison/analysis/run-1.md',
    ]) {
      await expect(resolveRepoWrite(repo, path)).resolves.toMatchObject({ relativePath: path })
    }
  })

  it('never takes an item\'s material, however it is spelled', async () => {
    const repo = repoWithSet()
    for (const path of [
      'datasets/harness-comparison/items/P0/task.md',
      'datasets/harness-comparison/items/P0/answers/oracle/a.md',
      'datasets/harness-comparison/items/P0/rubric.yml',
      'datasets/harness-comparison/schemas/stage1.json',
      'datasets/harness-comparison/dataset.json',
    ]) {
      await expect(resolveRepoWrite(repo, path)).rejects.toThrow(/is not a path this session may write/)
    }
  })

  it('refuses escapes before it touches the disk, and quotes the door back', async () => {
    const repo = repoWithSet()
    await expect(resolveRepoWrite(repo, '../elsewhere/x.md')).rejects.toThrow(/contains ".."/)
    await expect(resolveRepoWrite(repo, 'docs/../../x.md')).rejects.toThrow(/contains ".."/)
    await expect(resolveRepoWrite(repo, '/etc/passwd')).rejects.toThrow(/absolute path/)
    await expect(resolveRepoWrite(repo, '~/notes.md')).rejects.toThrow(/absolute path/)
    await expect(resolveRepoWrite(repo, '')).rejects.toThrow(/is empty/)
    await expect(resolveRepoWrite(repo, 'exports/x.md')).rejects.toThrow(/not one of the writable areas/)
    // The refusal is actionable: it names the path and every allowed prefix.
    await expect(resolveRepoWrite(repo, 'exports/x.md'))
      .rejects.toThrow(new RegExp(REPO_WRITE_PREFIXES[0] as string))
  })

  it('refuses a directory that leaves the repository through a symlink', async () => {
    const repo = repoWithSet()
    const outside = tmpTree()
    symlinkSync(outside, join(repo, 'docs'))
    await expect(resolveRepoWrite(repo, 'docs/escaped.md')).rejects.toThrow(/outside the repository/)
  })

  it('honours the binding\'s dataset whitelist', async () => {
    const repo = repoWithSet()
    await expect(resolveRepoWrite(repo, 'datasets/other-set/analysis/x.md', ['harness-comparison']))
      .rejects.toThrow(/outside this session's binding/)
    await expect(resolveRepoWrite(repo, 'datasets/harness-comparison/analysis/x.md', ['harness-comparison']))
      .resolves.toBeTruthy()
  })
})

describe('the service verb', () => {
  it('writes the analysis draft into the bound repository and creates its directory', async () => {
    const repo = repoWithSet()
    const result = await service(repo).writeRepoFile({
      path: 'docs/i5-analysis.md',
      content: '# 分析初稿\n',
      session: { id: 's1' },
      agent: true,
    })

    expect(result).toMatchObject({ repo, relativePath: 'docs/i5-analysis.md', created: true })
    expect(readFileSync(join(repo, 'docs', 'i5-analysis.md'), 'utf8')).toBe('# 分析初稿\n')
  })

  it('never silently replaces a file — a revision is said out loud', async () => {
    const repo = repoWithSet()
    const svc = service(repo)
    const args = { path: 'docs/a.md', content: 'first\n', session: { id: 's1' }, agent: true }
    await svc.writeRepoFile(args)

    await expect(svc.writeRepoFile({ ...args, content: 'second\n' })).rejects.toThrow(/already exists/)
    const replaced = await svc.writeRepoFile({ ...args, content: 'second\n', overwrite: true })
    expect(replaced.created).toBe(false)
    expect(readFileSync(join(repo, 'docs', 'a.md'), 'utf8')).toBe('second\n')
  })

  it('refuses an empty body rather than creating a file nobody notices', async () => {
    const repo = repoWithSet()
    await expect(service(repo).writeRepoFile({ path: 'docs/a.md', content: '', session: { id: 's1' }, agent: true }))
      .rejects.toThrow(/empty analysis is not an analysis/)
  })

  it('is the binding\'s repository or nothing: an unbound session is refused, a different repo is refused', async () => {
    const repo = repoWithSet()
    const unbound = new EvalService({ get: () => undefined })
    await expect(unbound.writeRepoFile({ path: 'docs/a.md', content: 'x', session: { id: 's1' }, agent: true }))
      .rejects.toThrow(/no dataset repository bound to this session/)
    // The T58 narrowing, on this verb too: `repo` may restate the binding and
    // nothing else — the parameter is not a way around the refusal.
    await expect(service(repo).writeRepoFile({
      path: 'docs/a.md', content: 'x', repo: tmpTree(), session: { id: 's1' }, agent: true,
    })).rejects.toThrow(/may only restate the binding/)
    await expect(service(repo).writeRepoFile({
      path: 'docs/a.md', content: 'x', repo, session: { id: 's1' }, agent: true,
    })).resolves.toBeTruthy()
  })

  it('carries the binding\'s dataset whitelist into the path check', async () => {
    const repo = repoWithSet()
    mkdirSync(join(repo, 'datasets', 'other-set'), { recursive: true })
    await expect(service(repo, ['harness-comparison']).writeRepoFile({
      path: 'datasets/other-set/analysis/x.md', content: 'x', session: { id: 's1' }, agent: true,
    })).rejects.toThrow(/outside this session's binding/)
  })

  it('writes nothing when it refuses', async () => {
    const repo = repoWithSet()
    writeFileSync(join(repo, 'datasets', 'harness-comparison', 'items', 'P0', 'task.md'), 'the question\n')
    await expect(service(repo).writeRepoFile({
      path: 'datasets/harness-comparison/items/P0/task.md', content: 'rewritten\n', session: { id: 's1' }, agent: true,
    })).rejects.toThrow(/is not a path this session may write/)
    expect(readFileSync(join(repo, 'datasets', 'harness-comparison', 'items', 'P0', 'task.md'), 'utf8')).toBe('the question\n')
  })
})
