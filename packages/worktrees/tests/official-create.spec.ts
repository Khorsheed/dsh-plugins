import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createInOfficialPool, type OfficialWorktreeCreator } from '../src/official-create.ts'
import { WorktreesService } from '../src/service.ts'

const exec = promisify(execFile)
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function git(cwd: string, args: string[]): Promise<string> {
  return (await exec('git', args, { cwd })).stdout.trim()
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-worktrees-official-'))
  roots.push(root)
  await git(root, ['init', '-b', 'main'])
  await git(root, ['config', 'user.name', 'Test'])
  await git(root, ['config', 'user.email', 'test@example.invalid'])
  await writeFile(join(root, 'README.md'), 'initial\n')
  await git(root, ['add', 'README.md'])
  await git(root, ['commit', '-m', 'initial'])
  return realpath(root)
}

const agent = { id: 'agent', session: { id: 'session' } } as Agent

describe('official worktree creation', () => {
  it('returns official metadata and updates the existing session binding', async () => {
    const repo = await repository()
    const path = join(repo, '.agents/worktrees', 'feat/official')
    const create = vi.fn<OfficialWorktreeCreator['create']>(async (_agent, request) => {
      await git(repo, ['worktree', 'add', '-b', request.name, path])
      return { path: await realpath(path), branch: request.name, baseCommit: await git(repo, ['rev-parse', 'HEAD']), repositoryRoot: repo }
    })
    const service = new WorktreesService('main', { official: () => ({ create }) })
    const info = await service.createWorktree('session', repo, path, 'feat/official', agent)
    expect(create).toHaveBeenCalledWith(agent, { name: 'feat/official' }, undefined)
    expect(info.branch).toBe('feat/official')
    expect(info.repositoryRoot).toBe(repo)
    expect(info.baseCommit).toMatch(/^[a-f\d]{40}$/)
    expect(service.activeWorktreeOf('session')).toBe(await realpath(path))
    expect((await service.listWorktrees(repo)).some(worktree => worktree.path === info.path)).toBe(true)
  })

  it('keeps arbitrary paths and missing Agent contexts on the legacy path', async () => {
    const create = vi.fn<OfficialWorktreeCreator['create']>()
    expect(await createInOfficialPool({ repo: '/repo', path: '/other', branch: 'feat/test', agent, official: { create } })).toBeUndefined()
    expect(await createInOfficialPool({ repo: '/repo', path: '/repo/.agents/worktrees/feat/test', branch: 'feat/test', official: { create } })).toBeUndefined()
    expect(create).not.toHaveBeenCalled()
  })

  it('does not fall back to a second create after an official failure', async () => {
    const create = vi.fn<OfficialWorktreeCreator['create']>(async () => { throw new Error('partial official creation') })
    await expect(createInOfficialPool({ repo: '/repo', path: '/repo/.agents/worktrees/feat/test', branch: 'feat/test', agent, official: { create } })).rejects.toThrow('partial official creation')
    expect(create).toHaveBeenCalledOnce()
  })
})
