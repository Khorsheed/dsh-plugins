/**
 * Companion-row spec for `@khorsheed/dsh-room-tool`: the row must mount
 * cleanly in every composition (no hard injects), skip registration when the
 * global room service is absent (degrade, never explode), and register all
 * three room tools with THIS package as their origin owner when the service
 * is present.
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
    get: (key: string) => (key === 'room' ? over.service : undefined),
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

describe('room-tool companion row', () => {
  it('registers nothing and does not throw when the room service is absent', () => {
    const { ctx, tools, logger } = makeCtx({ service: undefined })
    expect(() => { apply(ctx) }).not.toThrow()
    expect(tools.register).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledOnce()
  })

  it('registers all three room tools with this package as origin owner when the service is present', () => {
    const { ctx, tools } = makeCtx({ service: {} })
    apply(ctx)
    expect(tools.register).toHaveBeenCalledTimes(3)
    const names = tools.register.mock.calls.map(call => (call[0] as { name: string }).name)
    expect(names).toEqual(['room_invite', 'room_task', 'room_message'])
    for (const call of tools.register.mock.calls) {
      const definition = call[0] as Record<symbol, unknown>
      expect(definition[TOOL_ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-room-tool' })
    }
  })

  it('adds the shared context reader on a capable core and tags its origin', () => {
    const { ctx, tools } = makeCtx({ service: { readRoomContext: vi.fn() } })
    apply(ctx)
    expect(tools.register.mock.calls.map(call => call[0].name)).toEqual(['room_read', 'room_invite', 'room_task', 'room_message'])
    expect(tools.register.mock.calls[0]![0][TOOL_ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-room-tool' })
  })

  it('registers nothing (and still does not throw) when the tools registry never appears', () => {
    const { ctx, tools } = makeCtx({ service: {}, withTools: false })
    expect(() => { apply(ctx) }).not.toThrow()
    expect(tools.register).not.toHaveBeenCalled()
  })
})
