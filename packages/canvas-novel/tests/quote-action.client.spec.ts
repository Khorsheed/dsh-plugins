import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import type { NovelFace } from '../src/client/contract.ts'

interface QuoteAction {
  readonly id: string
  readonly label: () => string
  readonly available?: (target: { ref?: string; sessionId?: SessionId }) => boolean
  readonly run: (target: { ref?: string; sessionId?: SessionId }) => void
}

async function bench() {
  const faces: NovelFace[] = []
  const ctx = new Context()
  ctx.provide('remote', { $mount: async () => async () => {} } as never)
  ctx.provide('locale', {
    register: () => () => {},
    bind: () => (key: string) => key,
  } as never)
  ctx.provide('slots', {
    entries: () => [],
    inject: (_key: string, callback: () => () => void) => callback(),
    register: (options: { inject?: () => unknown }) => {
      if (typeof options.inject === 'function') faces.push(options.inject() as NovelFace)
      return () => {}
    },
  } as never)
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  return { ctx, fiber, faces }
}

describe('chapter comment quote action', () => {
  it('registers when quote arrives late, uses the host session and disappears with the service', async () => {
    const { ctx, fiber, faces } = await bench()
    const actions = new Map<string, QuoteAction>()
    const registerAction = vi.fn((action: QuoteAction) => {
      actions.set(action.id, action)
      return () => { actions.delete(action.id) }
    })
    try {
      expect(faces.length).toBeGreaterThan(0)
      expect(registerAction).not.toHaveBeenCalled()
      const removeQuote = ctx.provide('quoteActions', { registerAction } as never)
      expect(registerAction).toHaveBeenCalledOnce()
      const open = vi.fn()
      faces[0]!.registerChapterComment!('canvas-1', 1, open)
      const action = actions.get('canvas-novel.comment')!
      const target = { ref: 'novel:canvas-1:1', sessionId: 's-quote' as SessionId }
      expect(action.available!(target)).toBe(true)
      expect(action.available!({ ...target, ref: 'novel:canvas-1:2' })).toBe(false)
      action.run(target)
      expect(open).toHaveBeenCalledWith('s-quote')
      await removeQuote()
      await vi.waitFor(() => { expect(actions.size).toBe(0) })
    } finally {
      await fiber.dispose()
    }
  })
})
