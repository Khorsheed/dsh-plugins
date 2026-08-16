/** What the browser half registers, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry, createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@khorsheed/dsh-message-timeline/client'
import type { TimelineRailInjected } from '../src/client/slots.ts'

async function bench(scopeBehavior: 'ok' | 'no-scope' | 'no-conversation' = 'ok') {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const conversation = { loadOlder: vi.fn(() => Promise.resolve()) }
  const list = createSnapshotStore<{ current?: string | undefined }>({ current: undefined })
  const provideInfo = createSnapshotStore({})
  ctx.provide('sessions', {
    list,
    currentProvideInfo: provideInfo,
    scope: (_sessionId: string) => {
      if (scopeBehavior === 'no-scope') return undefined
      return {
        get: (name: string) => {
          if (scopeBehavior === 'no-conversation') return undefined
          return name === 'conversation' ? conversation : undefined
        },
      }
    },
  } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, conversation }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'conversation.session.header.utilities': { kind: 'list', scope: 'session' } },
  } as never, () => null)
}

describe('message-timeline apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'sessions', 'locale'])
  })

  it('registers one header-utilities entry with a stable id and order', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const entry = slots.entries('conversation.session.header.utilities')[0]!
    expect(entry.options).toMatchObject({ id: 'message-timeline', order: 100 })
  })

  it('injects the rail face: config, jump, paging, and the rail observable', async () => {
    const { ctx, slots, conversation } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entry = slots.entries('conversation.session.header.utilities')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => TimelineRailInjected)('s1')
    expect(face.includeSteering).toBe(true)
    expect(face.panelWidth).toBe(360)
    expect(face.initialPages).toBe(5)

    const railState = face.hooks.rail.getSnapshot()
    expect(railState).toMatchObject({ sessionId: undefined, ready: false })
    const listener = vi.fn()
    const unsubscribe = face.hooks.rail.subscribe(listener)
    expect(face.hooks.rail.getSnapshot()).toBe(railState)
    unsubscribe()

    void face.loadOlder()
    expect(conversation.loadOlder).toHaveBeenCalledTimes(1)

    // The jump verb is a bound tracker call; with no bound scrollport it is a
    // safe no-op.
    face.jumpTo('k1')
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    declareRoot(slots)

    await vi.waitFor(() => { expect(slots.entries('conversation.session.header.utilities')).toHaveLength(1) })
  })

  it('collapses every contribution on teardown', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('conversation.session.header.utilities')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('conversation.session.header.utilities')).toHaveLength(0)
  })

  it('fails loud when the session scope or conversation service is missing', async () => {
    const noScope = await bench('no-scope')
    declareRoot(noScope.slots)
    await noScope.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = noScope.slots.entries('conversation.session.header.utilities')[0]!
    expect(() => (entry.inject as unknown as (id: string) => unknown)('s1'))
      .toThrow('session resolved no scope')

    const noConversation = await bench('no-conversation')
    declareRoot(noConversation.slots)
    await noConversation.ctx.plugin({ inject: [...inject], apply }).await()
    const entry2 = noConversation.slots.entries('conversation.session.header.utilities')[0]!
    expect(() => (entry2.inject as unknown as (id: string) => unknown)('s1'))
      .toThrow('conversation service unavailable')
  })

  it('registers nothing when disabled by config', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply: (c: Context) => { apply(c, { enabled: false }) } }).await()

    expect(slots.entries('conversation.session.header.utilities')).toHaveLength(0)
  })
})
