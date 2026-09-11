/**
 * Core-apply spec for the tool-row split: applying `@khorsheed/dsh-worktrees`
 * provides the service core and mounts the Remote data face, but registers NO
 * model-facing tool — the tool moved to the companion
 * `@khorsheed/dsh-worktrees-tool` (session-granted through preset
 * compositions). The assertion that pins the split: apply never touches
 * `ctx.inject`, the deferred path the old in-core registration used.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

describe('worktrees core apply (post tool split)', () => {
  it('provides the service and mounts the Remote, but registers no tool', () => {
    const ctx = {
      provide: vi.fn(),
      plugin: vi.fn(),
      inject: vi.fn(),
    } as unknown as Context
    apply(ctx, {})
    expect(ctx.provide).toHaveBeenCalledWith('worktrees', expect.anything())
    expect(ctx.plugin).toHaveBeenCalledOnce()
    expect(ctx.inject).not.toHaveBeenCalled()
  })
})
