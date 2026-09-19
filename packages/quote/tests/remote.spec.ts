/**
 * The quote Remote service: the `addRef` verb is a thin adapter over the
 * PROBED side-chat seam (`ctx.get('sideChat')` → `openWith`, the canvas
 * structural-mirror precedent). The degrade matrix: no side-chat service →
 * `unavailable`; a blank contextKey or quoted text → `empty`; a throwing
 * seam → `io`. The verb takes no calling agent — `openWith` owns no
 * session-scoped write.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { QuoteRemoteService, type SideChatMirror } from '../src/remote.ts'
import type { QuoteRef } from '../src/types.ts'

/** One openWith call the recording mirror saw. */
interface Seen {
  contextKey: string
  label: string
  refs?: readonly QuoteRef[]
}

/** Mount the Remote in a bare context, optionally over a recording side-chat mirror. */
async function bench(opts: { withSideChat?: boolean; throwing?: boolean } = {}): Promise<{
  seen: Seen[]
  remote: QuoteRemoteService
  dispose: () => Promise<void>
}> {
  const seen: Seen[] = []
  const ctx = new Context()
  if (opts.withSideChat === true) {
    const mirror: SideChatMirror = {
      openWith: async (input) => {
        if (opts.throwing === true) throw new Error('state write failed')
        seen.push(input)
      },
    }
    ctx.provide('sideChat', mirror)
  }
  const fiber = ctx.plugin(QuoteRemoteService, {})
  await fiber.await()
  return {
    seen,
    remote: ctx.get('quoteRemote') as QuoteRemoteService,
    dispose: async () => { await fiber.dispose() },
  }
}

describe('QuoteRemoteService.addRef', () => {
  it('queues the ref through the probed side-chat seam, label defaulting to the contextKey', async () => {
    const { seen, remote, dispose } = await bench({ withSideChat: true })
    expect(await remote.addRef({ contextKey: 's-1', label: '主会话', ref: { label: '主会话', text: '选中的话' } }))
      .toEqual({ ok: true })
    expect(seen).toEqual([{ contextKey: 's-1', label: '主会话', refs: [{ label: '主会话', text: '选中的话' }] }])
    await dispose()
  })

  it('defaults the context label to the contextKey when the request omits it', async () => {
    const { seen, remote, dispose } = await bench({ withSideChat: true })
    await remote.addRef({ contextKey: 's-1', ref: { label: '选区', text: '话' } })
    expect(seen[0]?.label).toBe('s-1')
    await dispose()
  })

  it('refuses unavailable when no side-chat service is mounted (and never throws)', async () => {
    const { remote, dispose } = await bench()
    expect(await remote.addRef({ contextKey: 's-1', ref: { label: 'l', text: '话' } }))
      .toEqual({ ok: false, error: 'unavailable' })
    await dispose()
  })

  it('refuses empty on a blank contextKey or blank quoted text', async () => {
    const { seen, remote, dispose } = await bench({ withSideChat: true })
    expect(await remote.addRef({ contextKey: '  ', ref: { label: 'l', text: '话' } }))
      .toEqual({ ok: false, error: 'empty' })
    expect(await remote.addRef({ contextKey: 's-1', ref: { label: 'l', text: '   ' } }))
      .toEqual({ ok: false, error: 'empty' })
    expect(seen).toEqual([])
    await dispose()
  })

  it('refuses io when the seam throws', async () => {
    const { remote, dispose } = await bench({ withSideChat: true, throwing: true })
    expect(await remote.addRef({ contextKey: 's-1', ref: { label: 'l', text: '话' } }))
      .toEqual({ ok: false, error: 'io' })
    await dispose()
  })
})
