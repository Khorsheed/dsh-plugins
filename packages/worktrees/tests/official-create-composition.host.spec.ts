import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { WorktreesService } from '../src/service.ts'

const harnessHome = process.env.DSH_HARNESS

describe.skipIf(harnessHome === undefined)('official worktree composition', () => {
  it('creates through the real service and keeps its record, cwd, binding and result together', async () => {
    const { harness, repository, testAgent } = await import(pathToFileURL(join(harnessHome!, 'packages/experimental/worktree/tests/harness.ts')).href) as {
      harness(root: string): Promise<Context>
      repository(): Promise<string>
      testAgent(ctx: Context, cwd: string, name?: string): Agent
    }
    const root = await repository()
    const ctx = await harness(root)
    try {
      const agent = testAgent(ctx, root, 'official-create-composition')
      const service = new WorktreesService('main', { official: () => ctx.worktrees })
      const created = await service.createWorktree(agent.id, root, join(root, '.agents/worktrees', 'community'), 'community', agent)
      expect(created.path).toBe(join(root, '.agents/worktrees', 'community'))
      expect(created.branch).toBe('community')
      expect(created.baseCommit).toMatch(/^[a-f\d]{40}$/)
      expect(created.repositoryRoot).toBe(root)
      expect(service.activeWorktreeOf(agent.id)).toBe(created.path)
      expect(ctx.workingDirectory.get(agent.session)).toBe(created.path)
      expect(agent.session.snapshotEvents().some(event => event.type === 'plugin:worktree/created')).toBe(true)
      expect(created.dirty).toBe(0)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
