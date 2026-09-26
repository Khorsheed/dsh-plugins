/**
 * context-guard plugin halves: the browser entry's dictionary, composer-tool-
 * row and settings-card registrations against the real SlotRegistry (with
 * fiber teardown proving removal — HMR safety), the injected compact verb's
 * three paths against a stubbed command Remote, the shared settings-scope
 * channel, the host half's dual-face settings registration, and the
 * invariant companion's ownership reservation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject, NS } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import { CONTEXT_GUARD_NS } from '../src/namespace.ts'
import * as ContextGuardInvariant from '../src/invariant.ts'
import { en, zh } from '../src/client/locales.ts'
import type { ContextGuardConfig } from '../src/client/config.ts'
import type { GuardScope } from '../src/client/scope.ts'
import type { ContextGuardInjected, ContextGuardSettingsCardInjected } from '../src/client/slots.ts'

/** A session id the slot system may materialize the inject face for. */
const KNOWN = 's1' as SessionId

/** This bundle's package name — the key the alpha.2 plugins.bundle.config entry registers under. */
const PACKAGE_NAME = '@khorsheed/dsh-context-guard'

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

/** Boot the browser half over a real slot tree that declares the input.right list and the given settings slot. */
async function bench(
  config?: Parameters<typeof apply>[1],
  settingsSlot: 'settings.plugin.item' | 'plugins.bundle.config' | 'plugins.row.config' = 'settings.plugin.item',
): Promise<Bench> {
  const execute = vi.fn()
  const { scope } = stubScope()
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.input.right': { kind: 'list', scope: 'session' },
      [settingsSlot]: { kind: 'keyed', scope: 'root' },
    },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('remote', { commands: { execute } } as never)
  // The plugin injects the exact 'remote.commands' service key (how the
  // generated commands namespace is mounted in the real client assembly).
  ctx.provide('remote.commands', { execute } as never)
  // The 0.1.5 settings face: the scope channel's legacy probe arms from this
  // (the rc.1 `configForms` probe never fires here — by design).
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

/** Read the registered settings-card entry's inject factory (0.1.5 slot). */
function cardInjectedFor(ctx: Context): ContextGuardSettingsCardInjected {
  const entry = ctx.slots
    .entries('settings.plugin.item')
    .find(e => e.options.key === CONTEXT_GUARD_NS)
  if (entry === undefined) throw new Error('context-guard settings card missing')
  return (entry.inject as unknown as () => ContextGuardSettingsCardInjected)()
}

/** Read the registered bundle-config entry's inject factory (alpha.2 slot). */
function bundleConfigInjectedFor(ctx: Context): ContextGuardSettingsCardInjected {
  const entry = ctx.slots
    .entries('plugins.bundle.config')
    .find(e => e.options.key === PACKAGE_NAME)
  if (entry === undefined) throw new Error('context-guard bundle config missing')
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

  it('registers the settings card keyed on the namespace on the 0.1.5 slot, removed with the fiber', async () => {
    const { ctx, fiber } = await bench()
    expect(ctx.slots.entries('settings.plugin.item').map(e => e.options.key)).toContain(CONTEXT_GUARD_NS)
    // The alpha.2 registration never fires without the bundle-config declaration.
    expect(ctx.slots.entries('plugins.bundle.config').map(e => e.options.key)).not.toContain(PACKAGE_NAME)
    await fiber.dispose()
    expect(ctx.slots.entries('settings.plugin.item').map(e => e.options.key)).not.toContain(CONTEXT_GUARD_NS)
  })

  it('registers the bundle configuration keyed by package name on the alpha.2 slot, removed with the fiber', async () => {
    const { ctx, fiber } = await bench(undefined, 'plugins.bundle.config')
    expect(ctx.slots.entries('plugins.bundle.config').map(e => e.options.key)).toContain(PACKAGE_NAME)
    // The legacy registration never fires without the 0.1.5 declaration.
    expect(ctx.slots.entries('settings.plugin.item').map(e => e.options.key)).not.toContain(CONTEXT_GUARD_NS)
    await fiber.dispose()
    expect(ctx.slots.entries('plugins.bundle.config').map(e => e.options.key)).not.toContain(PACKAGE_NAME)
  })

  it('registers the row-level configuration keyed by the family bundle row id, removed with the fiber', async () => {
    const ROW_KEY = '@khorsheed/dsh-bundle-conversation-toolbox#context-guard'
    const { ctx, fiber } = await bench(undefined, 'plugins.row.config')
    expect(ctx.slots.entries('plugins.row.config').map(e => e.options.key)).toContain(ROW_KEY)
    await fiber.dispose()
    expect(ctx.slots.entries('plugins.row.config').map(e => e.options.key)).not.toContain(ROW_KEY)
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

  it('arms one shared scope channel from the 0.1.5 face for the button and the card', async () => {
    const { ctx, scope } = await bench()
    const buttonConfig = buttonInjectedFor(ctx, KNOWN).hooks.config
    const cardConfig = cardInjectedFor(ctx).hooks.config
    // Both faces bind the SAME channel, and the armed channel mirrors the
    // stubbed legacy scope's snapshot.
    expect(buttonConfig).toBe(cardConfig)
    expect(buttonConfig.getSnapshot()).toEqual(scope.getSnapshot())
  })

  it('shares the same live settings scope on the alpha.2 bundle-config face', async () => {
    const { ctx, scope } = await bench(undefined, 'plugins.bundle.config')
    expect(bundleConfigInjectedFor(ctx).hooks.config.getSnapshot()).toEqual(scope.getSnapshot())
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
