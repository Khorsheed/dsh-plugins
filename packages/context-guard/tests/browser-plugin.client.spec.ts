/**
 * context-guard plugin halves: the browser entry's dictionary and
 * composer-tool-row registrations against the real SlotRegistry (with fiber
 * teardown proving removal — HMR safety), the injected compact verb's three
 * paths against a stubbed command Remote, the inert node entry, and the
 * invariant companion's ownership reservation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject, NS } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as ContextGuardInvariant from '../src/invariant.ts'
import { en, zh } from '../src/client/locales.ts'
import type { ContextGuardInjected } from '../src/client/slots.ts'

/** A session id the slot system may materialize the inject face for. */
const KNOWN = 's1' as SessionId

interface Bench {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  execute: ReturnType<typeof vi.fn>
}

/** Boot the browser half over a real slot tree that declares the input.right list. */
async function bench(config?: Parameters<typeof apply>[1]): Promise<Bench> {
  const execute = vi.fn()
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.input.right': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('remote', { commands: { execute } } as never)
  // The plugin injects the exact 'remote.commands' service key (how the
  // generated commands namespace is mounted in the real client assembly).
  ctx.provide('remote.commands', { execute } as never)
  // ctx.plugin(meta, config) hands `config` to apply as its second argument.
  const fiber = ctx.plugin({ inject: [...inject], apply }, config)
  await fiber.await()
  return { ctx, fiber, execute }
}

/** Read the registered entry's inject factory, materialized per session. */
function injectedFor(ctx: Context, sessionId: SessionId): ContextGuardInjected {
  const entry = ctx.slots
    .entries('conversation.input.right')
    .find(e => e.options.id === 'context-guard')
  if (entry === undefined) throw new Error('context-guard entry missing')
  return (entry.inject as unknown as (id: SessionId) => ContextGuardInjected)(sessionId)
}

/** Slot ledger reader: entry ids currently registered in the tool row. */
function entryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.input.right')
    .map(entry => entry.options.id)
}

describe('context-guard browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])
  })

  it('registers the compact entry, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(entryIds(ctx)).toContain('context-guard')
    // Leads the right-side tool row so the danger stays visible before the send button.
    const entry = ctx.slots.entries('conversation.input.right')
      .find(e => e.options.id === 'context-guard')
    expect(entry?.options.order).toBe(-10)
    await fiber.dispose()
    expect(entryIds(ctx)).not.toContain('context-guard')
  })

  it('skips registration when the master switch is off', async () => {
    const { ctx } = await bench({ enabled: false })
    expect(entryIds(ctx)).not.toContain('context-guard')
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('button.label')).toBe(zh['button.label'])
    ctx.locale.setLocale('en')
    expect(translate('button.label')).toBe(en['button.label'])

    // Released dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('button.label')).not.toBe(en['button.label'])
  })

  it('carries the resolved guard config on the inject face', async () => {
    const { ctx } = await bench({ thresholdRatio: 0.6, maxTokens: 16_000 })
    const face = injectedFor(ctx, KNOWN)
    expect(face.thresholdRatio).toBe(0.6)
    expect(face.maxTokens).toBe(16_000)
  })

  it('executes the official /compact command, returning null when admitted', async () => {
    const { ctx, execute } = await bench()
    execute.mockResolvedValue({ ok: true, value: { matched: true } })
    await expect(injectedFor(ctx, KNOWN).compactNow()).resolves.toBeNull()
    expect(execute).toHaveBeenCalledWith(KNOWN, '/compact')
  })

  it('surfaces a host rejection as a failure line', async () => {
    const { ctx, execute } = await bench()
    execute.mockResolvedValue({ ok: false, error: { code: 'BUSY', message: 'agent is busy' } })
    await expect(injectedFor(ctx, KNOWN).compactNow())
      .resolves.toBe('agent is busy (BUSY)')
  })

  it('reports an unmatched command', async () => {
    const { ctx, execute } = await bench()
    execute.mockResolvedValue({ ok: true, value: undefined })
    await expect(injectedFor(ctx, KNOWN).compactNow())
      .resolves.toBe('unknown command: /compact')
  })
})

describe('context-guard node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})

describe('context-guard invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(ContextGuardInvariant)
    await fiber.await()
    expect(ContextGuardInvariant.name).toBe('context-guard-invariant')
    expect(ContextGuardInvariant.inject).toEqual(['invariants'])
    // Emitting an unrelated event proves the companion installed no audit.
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
