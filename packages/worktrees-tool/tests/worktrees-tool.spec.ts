/**
 * Companion-row spec for `@khorsheed/dsh-worktrees-tool`: the row must mount
 * cleanly in every composition (no hard injects), skip registration when the
 * global worktrees service is absent (degrade, never explode), register the
 * model-facing `worktrees` tool with THIS package as its origin owner when
 * the service is present, and wire the probed service into the tool's
 * execute path.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

const TOOL_ORIGIN = Symbol.for('dsh.tool.origin')

interface FakeTools {
  register: ReturnType<typeof vi.fn>
}

function makeCtx(over: { service?: unknown; withTools?: boolean } = {}) {
  const tools: FakeTools = { register: vi.fn() }
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  const ctx = {
    get: (key: string) => (key === 'worktrees' ? over.service : undefined),
    inject: (_names: string[], cb: (ctx: unknown) => void) => {
      if (over.withTools !== false) {
        cb({ effect: (fn: () => void) => fn(), tools })
      }
      return () => {}
    },
    logger,
  } as unknown as Context
  return { ctx, tools, logger }
}

describe('worktrees-tool companion row', () => {
  it('registers nothing and does not throw when the worktrees service is absent', () => {
    const { ctx, tools, logger } = makeCtx({ service: undefined })
    expect(() => { apply(ctx) }).not.toThrow()
    expect(tools.register).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledOnce()
  })

  it('registers the worktrees tool with this package as origin owner when the service is present', () => {
    const { ctx, tools } = makeCtx({ service: {} })
    apply(ctx)
    expect(tools.register).toHaveBeenCalledOnce()
    const definition = tools.register.mock.calls[0][0] as { name: string; [TOOL_ORIGIN]?: { channel: string; owner: string } }
    expect(definition.name).toBe('worktrees')
    expect(definition[TOOL_ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-worktrees-tool' })
  })

  it('registers nothing (and still does not throw) when the tools registry never appears', () => {
    const { ctx, tools } = makeCtx({ service: {}, withTools: false })
    expect(() => { apply(ctx) }).not.toThrow()
    expect(tools.register).not.toHaveBeenCalled()
  })

  it('delegates execute to the probed service core', async () => {
    const service = { listWorktrees: vi.fn(async () => [{ path: '/repo', branch: 'main', isMain: true }]) }
    const { ctx, tools } = makeCtx({ service })
    apply(ctx)
    const definition = tools.register.mock.calls[0][0] as {
      execute: (args: unknown, exec: unknown) => Promise<string>
    }
    const exec = { agent: { id: 'sess-1', session: { header: { cwd: '/repo' } } } }
    const out = JSON.parse(await definition.execute({ action: 'list' }, exec)) as { ok: boolean; worktrees: unknown[] }
    expect(out.ok).toBe(true)
    expect(service.listWorktrees).toHaveBeenCalledWith('/repo')
    expect(out.worktrees).toHaveLength(1)
  })
})
