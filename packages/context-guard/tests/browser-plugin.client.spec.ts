/**
 * context-guard plugin halves: the browser entry's dictionary, composer-tool-
 * row and settings-card registrations against the real SlotRegistry (with
 * fiber teardown proving removal — HMR safety), the injected compact verb's
 * three paths against a stubbed command Remote, the shared settings-scope
 * hooks source, the host half's settings-namespace registration, and the
 * invariant companion's ownership reservation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply, inject, NS } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import { CONTEXT_GUARD_NS } from '../src/namespace.ts'
import * as ContextGuardInvariant from '../src/invariant.ts'
import { en, zh } from '../src/client/locales.ts'
import type { ContextGuardConfig } from '../src/client/config.ts'
import type { ContextGuardInjected, ContextGuardSettingsCardInjected } from '../src/client/slots.ts'

/** A session id the slot system may materialize the inject face for. */
const KNOWN = 's1' as SessionId

/** In-memory settings provider for the host-half registration test. */
class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

/** A controllable settings-scope stub over the context-guard section. */
function stubScope(initial?: Partial<ContextGuardConfig>) {
  const set = vi.fn(async () => {})
  const unset = vi.fn(async () => {})
  let value: ContextGuardConfig | undefined = initial === undefined
    ? undefined
    : { thresholdRatio: 0.8, ...initial }
  let user: Record<string, unknown> | undefined = initial === undefined ? undefined : {}
  let revision = 1
  const listeners = new Set<() => void>()
  const publish = (): void => { for (const listener of listeners) listener() }
  const scope: SettingsScope<ContextGuardConfig> = {
    getSnapshot: () => ({
      status: 'ready',
      value,
      base: undefined,
      user,
      revision,
      writable: true,
      mode: 'host',
    }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async (field, next) => {
      value = { ...(value ?? { thresholdRatio: 0.8 }), [field]: next } as ContextGuardConfig
      user = { ...(user ?? {}), [field]: next }
      revision += 1
      publish()
    },
    unset: async (field) => {
      value = { ...(value ?? { thresholdRatio: 0.8 }) } as ContextGuardConfig
      delete (value as Record<string, unknown>)[field]
      user = { ...(user ?? {}) }
      delete user[field]
      revision += 1
      publish()
    },
  }
  return { scope, set, unset }
}

interface Bench {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  execute: ReturnType<typeof vi.fn>
  scope: SettingsScope<ContextGuardConfig>
}

/** Boot the browser half over a real slot tree that declares the input.right list and the plugin-item slot. */
async function bench(config?: Parameters<typeof apply>[1]): Promise<Bench> {
  const execute = vi.fn()
  const { scope } = stubScope()
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.input.right': { kind: 'list', scope: 'session' },
      'settings.plugin.item': { kind: 'keyed', scope: 'root' },
    },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('remote', { commands: { execute } } as never)
  // The plugin injects the exact 'remote.commands' service key (how the
  // generated commands namespace is mounted in the real client assembly).
  ctx.provide('remote.commands', { execute } as never)
  ctx.provide('settingsScope', { bind: () => scope } as never)
  // ctx.plugin(meta, config) hands `config` to apply as its second argument.
  const fiber = ctx.plugin({ inject: [...inject], apply }, config)
  await fiber.await()
  return { ctx, fiber, execute, scope }
}

/** Read the registered button entry's inject factory, materialized per session. */
function buttonInjectedFor(ctx: Context, sessionId: SessionId): ContextGuardInjected {
  const entry = ctx.slots
    .entries('conversation.input.right')
    .find(e => e.options.id === 'context-guard')
  if (entry === undefined) throw new Error('context-guard entry missing')
  return (entry.inject as unknown as (id: SessionId) => ContextGuardInjected)(sessionId)
}

/** Read the registered settings-card entry's inject factory. */
function cardInjectedFor(ctx: Context): ContextGuardSettingsCardInjected {
  const entry = ctx.slots
    .entries('settings.plugin.item')
    .find(e => e.options.key === CONTEXT_GUARD_NS)
  if (entry === undefined) throw new Error('context-guard settings card missing')
  return (entry.inject as unknown as () => ContextGuardSettingsCardInjected)()
}

describe('context-guard browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale', 'settingsScope'])
  })

  it('registers the compact entry, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(ctx.slots.entries('conversation.input.right').map(e => e.options.id)).toContain('context-guard')
    // Leads the right-side tool row so the danger stays visible before the send button.
    const entry = ctx.slots.entries('conversation.input.right')
      .find(e => e.options.id === 'context-guard')
    expect(entry?.options.order).toBe(-10)
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.input.right').map(e => e.options.id)).not.toContain('context-guard')
  })

  it('registers the settings card keyed on the namespace, removed with the fiber', async () => {
    const { ctx, fiber } = await bench()
    expect(ctx.slots.entries('settings.plugin.item').map(e => e.options.key)).toContain(CONTEXT_GUARD_NS)
    await fiber.dispose()
    expect(ctx.slots.entries('settings.plugin.item').map(e => e.options.key)).not.toContain(CONTEXT_GUARD_NS)
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('settings.title')).toBe(zh['settings.title'])
    ctx.locale.setLocale('en')
    expect(translate('settings.title')).toBe(en['settings.title'])

    // Released dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('settings.title')).not.toBe(en['settings.title'])
  })

  it('shares one live settings scope between the button and the card', async () => {
    const { ctx, scope } = await bench()
    expect(buttonInjectedFor(ctx, KNOWN).hooks.config).toBe(scope)
    expect(cardInjectedFor(ctx).hooks.config).toBe(scope)
  })

  it('carries the resolved fallback config on the button inject face', async () => {
    const { ctx } = await bench({ thresholdRatio: 0.6 })
    const face = buttonInjectedFor(ctx, KNOWN)
    expect(face.thresholdRatio).toBe(0.6)
  })

  it('executes the official /compact command, returning null when admitted', async () => {
    const { ctx, execute } = await bench()
    execute.mockResolvedValue({ ok: true, value: { matched: true } })
    await expect(buttonInjectedFor(ctx, KNOWN).compactNow()).resolves.toBeNull()
    expect(execute).toHaveBeenCalledWith(KNOWN, '/compact')
  })

  it('surfaces a host rejection as a failure line', async () => {
    const { ctx, execute } = await bench()
    execute.mockResolvedValue({ ok: false, error: { code: 'BUSY', message: 'agent is busy' } })
    await expect(buttonInjectedFor(ctx, KNOWN).compactNow())
      .resolves.toBe('agent is busy (BUSY)')
  })

  it('reports an unmatched command', async () => {
    const { ctx, execute } = await bench()
    execute.mockResolvedValue({ ok: true, value: undefined })
    await expect(buttonInjectedFor(ctx, KNOWN).compactNow())
      .resolves.toBe('unknown command: /compact')
  })
})

describe('context-guard node half', () => {
  it('registers the settings namespace, validates the section, and disposes it', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply: applyNode }, { thresholdRatio: 0.7 })
    await fiber.await()
    const ns = settingsNamespace(CONTEXT_GUARD_NS)
    expect(ctx.settings.describe().map(row => row.ns)).toContain(ns)
    // The composition entry becomes the section's base layer: the resolved
    // section carries the composed threshold over the schema default.
    await ctx.settings.update(ns, { thresholdRatio: 0.6 })
    expect(ctx.settings.get(ns)).toEqual({ thresholdRatio: 0.6 })
    // Out-of-schema values are rejected.
    await expect(ctx.settings.update(ns, { thresholdRatio: 2 })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('contributes nothing when no settings provider exists', () => {
    expect(() => applyNode(new Context())).not.toThrow()
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
