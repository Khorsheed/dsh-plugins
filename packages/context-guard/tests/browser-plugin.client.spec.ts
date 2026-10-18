/**
 * context-guard plugin halves: the browser entry's dictionary, composer-tool-
 * row and settings-card registrations against the real SlotRegistry (with
 * fiber teardown proving removal — HMR safety), the whileServed gate on the
 * Plugins-page `plugins.item` card, the injected compact verb's three paths
 * against a stubbed command Remote, the shared settings-scope channel, and the
 * host half's dual-face settings registration.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject, NS } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import { CONTEXT_GUARD_NS } from '../src/namespace.ts'
import { en, zh } from '../src/client/locales.ts'
import type { ContextGuardConfig } from '../src/client/config.ts'
import type { GuardScope } from '../src/client/scope.ts'
import type { ContextGuardInjected, ContextGuardSettingsCardInjected } from '../src/client/slots.ts'

/** A session id the slot system may materialize the inject face for. */
const KNOWN = 's1' as SessionId

/**
 * In-memory fake of the 0.1.5 settings face: the explicit `register` face the
 * host half's legacy arm probes for, plus describe/get/update for the
 * assertions. The schema is invoked directly (schemastery schemas are
 * callable), and volatile-marked fields are unwrapped on read — the same
 * plain projection the provider served on 0.1.5.
 */
class MemorySettings {
  private readonly sections = new Map<string, {
    schema: (value: unknown) => unknown
    base: Record<string, unknown>
    section: Record<string, unknown>
  }>()

  register(ns: string, schema: unknown, options?: { base?: Record<string, unknown> }): {
    get(): unknown
    update(patch: Record<string, unknown>): Promise<void>
    watch(): () => void
  } {
    if (this.sections.has(ns)) throw new Error(`settings namespace "${ns}" is already registered`)
    this.sections.set(ns, {
      schema: schema as (value: unknown) => unknown,
      base: options?.base ?? {},
      section: {},
    })
    return {
      get: () => this.get(ns),
      update: (patch) => this.update(ns, patch),
      watch: () => () => {},
    }
  }

  describe(): { ns: string }[] {
    return [...this.sections.keys()].map(ns => ({ ns }))
  }

  get(ns: string): unknown {
    const entry = this.sections.get(ns)
    if (entry === undefined) return undefined
    const resolved = entry.schema({ ...entry.base, ...entry.section }) as Record<string, unknown>
    return Object.fromEntries(Object.entries(resolved).map(([key, value]) => [
      key,
      value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function'
        ? (value as { get(): unknown }).get()
        : value,
    ]))
  }

  async update(ns: string, patch: Record<string, unknown>): Promise<void> {
    const entry = this.sections.get(ns)
    if (entry === undefined) throw new Error(`no settings namespace "${ns}"`)
    // Validation rejects the write exactly where the 0.1.5 provider did.
    entry.schema({ ...entry.base, ...entry.section, ...patch })
    entry.section = { ...entry.section, ...patch }
  }

  remove(ns: string): void {
    this.sections.delete(ns)
  }
}

/** A controllable settings-scope stub over the context-guard section. */
function stubScope(initial?: Partial<ContextGuardConfig>) {
  let value: ContextGuardConfig | undefined = initial === undefined
    ? undefined
    : { thresholdRatio: 0.8, ...initial }
  let user: Record<string, unknown> | undefined = initial === undefined ? undefined : {}
  let revision = 1
  const listeners = new Set<() => void>()
  const publish = (): void => { for (const listener of listeners) listener() }
  const scope: GuardScope = {
    getSnapshot: () => ({
      status: 'ready',
      value,
      base: undefined,
      user,
      revision,
      writable: true,
    }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (field, next) => {
      value = { ...(value ?? { thresholdRatio: 0.8 }), [field]: next } as ContextGuardConfig
      user = { ...(user ?? {}), [field]: next }
      revision += 1
      publish()
      return Promise.resolve(true)
    },
    unset: (field) => {
      value = { ...(value ?? { thresholdRatio: 0.8 }) } as ContextGuardConfig
      delete (value as Record<string, unknown>)[field]
      user = { ...(user ?? {}) }
      delete user[field]
      revision += 1
      publish()
      return Promise.resolve(true)
    },
  }
  return { scope }
}

interface Bench {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  execute: ReturnType<typeof vi.fn>
  scope: GuardScope
}

/**
 * Boot the browser half over a real slot tree that declares the input.right
 * list and (by default) the plugins.item list. `served` is the namespace set
 * the fake configForms reports to the whileServed gate; null means the host
 * line has no configForms service at all (0.1.5).
 */
async function bench(
  config?: Parameters<typeof apply>[1],
  options?: { served?: readonly string[] | null; declareItemSlot?: boolean },
): Promise<Bench> {
  const served = options?.served === undefined ? [CONTEXT_GUARD_NS] : options.served
  const declareItemSlot = options?.declareItemSlot ?? true
  const execute = vi.fn()
  const { scope } = stubScope()
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.input.right': { kind: 'list', scope: 'session' },
      ...(declareItemSlot ? { 'plugins.item': { kind: 'list', scope: 'root' } } : {}),
    },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('remote', { commands: { execute } } as never)
  // The plugin injects the exact 'remote.commands' service key (how the
  // generated commands namespace is mounted in the real client assembly).
  ctx.provide('remote.commands', { execute } as never)
  if (served !== null) {
    const servedSet = new Set(served)
    // The rc.1+ settings face: the scope channel's first probe arms from
    // `get`, and the card track's whileServed gate consults `servedSet`.
    ctx.provide('configForms', {
      get: () => scope,
      whileServed: (namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) =>
        namespaces.some(ns => servedSet.has(ns)) ? register(servedSet) : () => {},
    } as never)
  }
  // ctx.plugin(meta, config) hands `config` to apply as its second argument.
  const fiber = ctx.plugin({ inject: [...inject], apply }, config)
  await fiber.await()
  // The card track rides a deferred ctx.inject fiber, which loads past a
  // microtask boundary; give it a macrotask to land.
  await new Promise(resolve => setTimeout(resolve, 0))
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

/** Read the registered settings-card entry's inject factory (the plugins.item list entry). */
function cardInjectedFor(ctx: Context): ContextGuardSettingsCardInjected {
  const entry = ctx.slots
    .entries('plugins.item')
    .find(e => e.options.id === CONTEXT_GUARD_NS)
  if (entry === undefined) throw new Error('context-guard settings card missing')
  return (entry.inject as unknown as () => ContextGuardSettingsCardInjected)()
}

describe('context-guard browser half', () => {
  it('declares the services it binds (the settings scope is probed, never injected)', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])
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

  it('registers the settings card on plugins.item while the namespace is served, removed with the fiber', async () => {
    const { ctx, fiber } = await bench()
    expect(ctx.slots.entries('plugins.item').map(e => e.options.id)).toContain(CONTEXT_GUARD_NS)
    await fiber.dispose()
    expect(ctx.slots.entries('plugins.item').map(e => e.options.id)).not.toContain(CONTEXT_GUARD_NS)
  })

  it('registers no card when the host serves no such namespace (the row is not composed)', async () => {
    const { ctx } = await bench(undefined, { served: [] })
    expect(ctx.slots.entries('plugins.item').map(e => e.options.id)).not.toContain(CONTEXT_GUARD_NS)
  })

  it('registers no card on a host line without configForms (0.1.5)', async () => {
    const { ctx } = await bench(undefined, { served: null })
    expect(ctx.slots.entries('plugins.item').map(e => e.options.id)).not.toContain(CONTEXT_GUARD_NS)
  })

  it('waits for the plugins.item declaration when the Plugins page is absent', async () => {
    const { ctx } = await bench(undefined, { declareItemSlot: false })
    expect(ctx.slots.entries('plugins.item').map(e => e.options.id)).not.toContain(CONTEXT_GUARD_NS)
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    // Pin the locale explicitly: rc.8's browser-locale detection reads the jsdom
    // window (en-US), so the default locale is environment-dependent.
    ctx.locale.setLocale('zh')
    expect(translate('settings.title')).toBe(zh['settings.title'])
    ctx.locale.setLocale('en')
    expect(translate('settings.title')).toBe(en['settings.title'])

    // Released dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('settings.title')).not.toBe(en['settings.title'])
  })

  it('arms one shared scope channel from the configForms face for the button and the card', async () => {
    const { ctx, scope } = await bench()
    const buttonConfig = buttonInjectedFor(ctx, KNOWN).hooks.config
    const cardConfig = cardInjectedFor(ctx).hooks.config
    // Both faces bind the SAME channel, and the armed channel mirrors the
    // stubbed scope's snapshot.
    expect(buttonConfig).toBe(cardConfig)
    expect(buttonConfig.getSnapshot()).toEqual(scope.getSnapshot())
  })

  it('publishes `unavailable` while no settings provider serves the section', async () => {
    const execute = vi.fn()
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: { 'conversation.input.right': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('remote', { commands: { execute } } as never)
    ctx.provide('remote.commands', { execute } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const snapshot = buttonInjectedFor(ctx, KNOWN).hooks.config.getSnapshot()
    expect(snapshot.status).toBe('unavailable')
    expect(snapshot.writable).toBe(false)
    await fiber.dispose()
  })

  it('carries the resolved fallback config on the button inject face', async () => {
    const { ctx } = await bench({ thresholdRatio: 0.6 })
    const face = buttonInjectedFor(ctx, KNOWN)
    expect(face.thresholdRatio).toBe(0.6)
  })

  it('unwraps a rc.1 volatile-shaped entry config for the fallback', async () => {
    const { ctx } = await bench({ thresholdRatio: { get: () => 0.5 } } as never)
    expect(buttonInjectedFor(ctx, KNOWN).thresholdRatio).toBe(0.5)
  })

  it('executes the official /compact command, returning null when admitted', async () => {
    const { ctx, execute } = await bench()
    execute.mockResolvedValue({ ok: true, value: { matched: true } })
    await expect(buttonInjectedFor(ctx, KNOWN).compactNow()).resolves.toBeNull()
    expect(execute).toHaveBeenCalledWith(KNOWN, '/compact', [])
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
  it('registers the legacy namespace, validates the section, and disposes it', async () => {
    const ctx = new Context()
    const settings = new MemorySettings()
    ctx.provide('settings', settings as never)
    const fiber = ctx.plugin({
      apply: (pluginCtx, config: Record<string, unknown>) => {
        applyNode(pluginCtx, config)
        // Test-side emulation of the 0.1.5 provider's own fiber-effect: the
        // real service removed the namespace when the registrant fiber
        // disposed; the fake has no fiber of its own, so the removal rides
        // the plugin's.
        pluginCtx.effect(() => () => { settings.remove(CONTEXT_GUARD_NS) })
      },
    }, { thresholdRatio: 0.7 })
    await fiber.await()
    const ns = CONTEXT_GUARD_NS
    expect(settings.describe().map(row => row.ns)).toContain(ns)
    // The composition entry becomes the section's base layer: the resolved
    // section carries the composed threshold over the schema default.
    await settings.update(ns, { thresholdRatio: 0.6 })
    expect(settings.get(ns)).toEqual({ thresholdRatio: 0.6 })
    // Out-of-schema values are rejected.
    await expect(settings.update(ns, { thresholdRatio: 2 })).rejects.toThrow()
    await fiber.dispose()
    expect(settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('contributes nothing when no settings provider exists', () => {
    expect(() => applyNode(new Context())).not.toThrow()
  })
})
