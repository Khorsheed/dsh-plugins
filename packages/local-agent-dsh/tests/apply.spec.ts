/**
 * The dsh harness toggle controller: `enabled` OFF (default) mounts nothing
 * model-visible; ON registers the harness, provider, and the delegation tool.
 * The live preferences ride the same namespace: the YAML config feeds the
 * composition base, and the LiveDriverSwitch hot-swaps driver generations on
 * a settings change — the provider registration stays stable across a live
 * flip, while an enabled flip tears the whole composition down.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { LocalAgentHarness } from '@khorsheed/dsh-local-agent'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'
import { DshLiveDriver } from '../src/live-driver.ts'
import type { DshLiveSettings } from '../src/live-switch.ts'

/** A fake settings service: register captures the scope; set() drives watch. */
function fakeSettings(initial: DshLiveSettings) {
  let value = initial
  const watchers: ((next: DshLiveSettings, prev: DshLiveSettings) => void)[] = []
  const registrations: unknown[] = []
  return {
    registrations,
    service: {
      register: (ns: unknown, schema: unknown, options?: unknown) => {
        registrations.push({ ns, schema, options })
        return {
          get: () => value,
          watch: (cb: (next: DshLiveSettings, prev: DshLiveSettings) => void) => {
            watchers.push(cb)
            return () => {}
          },
          update: async () => {},
          replace: async () => {},
        }
      },
    },
    set(next: Partial<DshLiveSettings>): void {
      const prev = value
      value = { ...value, ...next }
      for (const watch of watchers) watch(value, prev)
    },
  }
}

interface Mount {
  ctx: Context
  registered: LocalAgentHarness[]
  providers: unknown[]
  mountedTools: unknown[]
  settings: ReturnType<typeof fakeSettings>
  /** The resolver the latest provider generation was constructed with (private face). */
  resolveLive: (childSessionId: string) => DshLiveDriver | undefined
}

function mount(
  initial: Partial<DshLiveSettings> = {},
  config: Record<string, unknown> = {},
  extraProvides: Record<string, unknown> = {},
): Mount {
  const ctx = new Context()
  const registered: LocalAgentHarness[] = []
  const providers: unknown[] = []
  const mountedTools: unknown[] = []
  const home = mkdtempSync(join(tmpdir(), 'dsh-apply-home-'))
  const settings = fakeSettings({ enabled: false, live: false, liveMirrorGranularity: 'event', ...initial })
  let resolveLive: Mount['resolveLive'] = () => undefined
  ctx.provide('localAgent', {
    homeDir: () => home,
    register: (harness: LocalAgentHarness) => {
      registered.push(harness)
      return () => { registered.splice(registered.indexOf(harness), 1) }
    },
  })
  ctx.provide('subagents', {
    registerProvider: (provider: unknown) => {
      providers.push(provider)
      resolveLive = (provider as { live: Mount['resolveLive'] }).live
      return () => { providers.splice(providers.indexOf(provider), 1) }
    },
  })
  ctx.provide('credentials', { resolve: async () => undefined })
  ctx.provide('subprocess', { spawn: () => { throw new Error('not spawned in apply test') } })
  ctx.provide('logger', { warn: () => {}, info: () => {} })
  for (const [name, service] of Object.entries(extraProvides)) ctx.provide(name, service)
  ctx.provide('settings', settings.service)
  ctx.plugin = ((plugin: unknown, pluginConfig: unknown) => {
    mountedTools.push({ plugin, config: pluginConfig })
    return { then: (onFulfilled: (fiber: { dispose: () => Promise<void> }) => void) => {
      onFulfilled({ dispose: () => Promise.resolve() })
    } }
  }) as never
  apply(ctx, config as never)
  return { ctx, registered, providers, mountedTools, settings, resolveLive: id => resolveLive(id) }
}

describe('local-agent-dsh toggle controller', () => {
  it('registers nothing while the DeepSeek toggle is off (default)', () => {
    const { registered, providers, mountedTools } = mount()
    expect(registered).toHaveLength(0)
    expect(providers).toHaveLength(0)
    expect(mountedTools).toHaveLength(0)
  })

  it('the harness snapshot reports the drive and no pinned endpoint', async () => {
    const { registered, settings } = mount({ enabled: true, live: false })
    const harness = registered[0]!
    expect(harness.effectiveSettings).toBeTypeOf('function')
    // Synchronous on purpose: nothing to read from disk.
    // `containerNodeOptions` is unconditional: the provider always injects
    // `--use-env-proxy` on a container target, so the snapshot always names it.
    expect(await harness.effectiveSettings!()).toEqual({
      drive: 'exec',
      baseUrlSet: false,
      containerNodeOptions: '--use-env-proxy',
    })
    // The live preference rides the same namespace; flipping it flips the
    // snapshot's drive on the next read.
    settings.set({ live: true })
    expect(await harness.effectiveSettings!()).toEqual({
      drive: 'live',
      baseUrlSet: false,
      containerNodeOptions: '--use-env-proxy',
    })
  })

  it('reports the inherited host model selection as provider/model', async () => {
    // The sub-dsh agent loader reads the same agentDefaultModel service, so
    // this selection is what a delegation round actually runs with.
    const { registered } = mount({ enabled: true }, {}, {
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
    })
    const harness = registered[0]!
    expect(await harness.effectiveSettings!()).toEqual({
      drive: 'exec',
      baseUrlSet: false,
      containerNodeOptions: '--use-env-proxy',
      model: 'deepseek/deepseek-chat',
    })
  })

  it('omits the model field when no selection is readable', async () => {
    // Service present but empty-handed, and the service absent entirely: both
    // must leave the field out rather than guessing an identifier.
    const { registered } = mount({ enabled: true }, {}, {
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: '' }) },
    })
    const harness = registered[0]!
    expect('model' in (await harness.effectiveSettings!())).toBe(false)

    const bare = mount({ enabled: true })
    const bareHarness = bare.registered[0]!
    expect('model' in (await bareHarness.effectiveSettings!())).toBe(false)
  })

  it('registers the harness, provider, and tool while on, and the watch toggles them live', () => {
    const { registered, providers, mountedTools, settings } = mount({ enabled: true })

    // ON: harness + provider registered, tool mounted for dsh-cli.
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      name: 'dsh',
      displayName: 'dsh',
      homeEnvVar: 'DSH_HOME',
      delegationProvider: 'dsh-cli',
    })
    expect(providers).toHaveLength(1)
    expect(mountedTools).toHaveLength(1)
    const tool = mountedTools[0] as { config: { provider: string; toolName: string } }
    expect(tool.config).toEqual({ provider: 'dsh-cli', toolName: 'subagent_dsh' })

    // Flip OFF through the settings watch: everything model-visible disposes.
    settings.set({ enabled: false })
    expect(registered).toHaveLength(0)
    expect(providers).toHaveLength(0)
  })

  it('registers the settings namespace with an empty base for a bare config', () => {
    const { settings } = mount()
    expect(settings.registrations).toHaveLength(1)
    const registration = settings.registrations[0] as { ns: unknown; options?: { base?: object } }
    expect(String(registration.ns)).toBe('local-agent-dsh')
    // A bare config leaves the base empty: the schema defaults rule.
    expect(registration.options?.base).toEqual({})
  })

  it('carries the YAML config into the composition base (settings unset → YAML rules)', () => {
    const { settings, providers } = mount({ enabled: true }, { live: true, liveMirrorGranularity: 'token' })
    const registration = settings.registrations[0] as { options?: { base?: object } }
    expect(registration.options?.base).toEqual({ live: true, liveMirrorGranularity: 'token' })
    // The fake settings service starts at live:false, so no driver is built —
    // on the real host the scope resolves base ← user, and this base would
    // turn live on. What we pin here is the base payload itself.
    expect(providers).toHaveLength(1)
  })

  it('builds no driver while enabled is off, even with live on (the live value is inert)', () => {
    const { providers, registered } = mount({ enabled: false, live: true })
    // The provider never registers, so the resolver is unreachable — live
    // applies when the toggle turns on again.
    expect(providers).toHaveLength(0)
    expect(registered).toHaveLength(0)
  })

  it('keeps live off when the settings say off; the resolver gates to exec', () => {
    const { resolveLive } = mount({ enabled: true, live: false })
    expect(resolveLive('child-x')).toBeUndefined()
  })

  it('builds the driver generation when enabled and live are both on', () => {
    const { resolveLive } = mount({ enabled: true, live: true })
    const driver = resolveLive('child-x')
    expect(driver).toBeInstanceOf(DshLiveDriver)
    expect(driver!.liveCount).toBe(0)
  })

  it('applies a persisted live value when enabled flips on', () => {
    const { settings, providers, resolveLive } = mount({ enabled: false, live: true })
    expect(providers).toHaveLength(0)
    settings.set({ enabled: true })
    expect(providers).toHaveLength(1)
    expect(resolveLive('child-x')).toBeInstanceOf(DshLiveDriver)
  })

  it('hot-switches live without re-registering the provider: on → driver; off → gate to exec + drain', async () => {
    const { settings, providers, resolveLive } = mount({ enabled: true, live: false })
    expect(providers).toHaveLength(1)
    expect(resolveLive('child-x')).toBeUndefined()
    settings.set({ live: true })
    const driver = resolveLive('child-x')
    expect(driver).toBeInstanceOf(DshLiveDriver)
    // The live flip did NOT re-register the provider (generation swap only).
    expect(providers).toHaveLength(1)
    settings.set({ live: false })
    expect(resolveLive('child-x')).toBeUndefined()
    expect(providers).toHaveLength(1)
    // The retired generation drains (empty here → immediate) and is disposed.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(driver!.liveCount).toBe(0)
  })

  it('a granularity change rides the same generation (no rebuild, no drain)', () => {
    const { settings, resolveLive } = mount({ enabled: true, live: true })
    const driver = resolveLive('child-x')
    settings.set({ liveMirrorGranularity: 'token' })
    expect(resolveLive('child-x')).toBe(driver)
  })

  it('an enabled flip off disposes the live generation; flipping back on rebuilds it', async () => {
    const { settings, providers, resolveLive } = mount({ enabled: true, live: true })
    const driver = resolveLive('child-x')
    expect(driver).toBeInstanceOf(DshLiveDriver)
    settings.set({ enabled: false })
    expect(providers).toHaveLength(0)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(driver!.liveCount).toBe(0)
    // Back on: a fresh provider generation with a fresh driver (live persisted).
    settings.set({ enabled: true })
    expect(providers).toHaveLength(1)
    const rebuilt = resolveLive('child-x')
    expect(rebuilt).toBeInstanceOf(DshLiveDriver)
    expect(rebuilt).not.toBe(driver)
  })

  it('enabled back on with live off stays on exec (independent toggles)', () => {
    const { settings, providers, resolveLive } = mount({ enabled: true, live: true })
    expect(resolveLive('child-x')).toBeInstanceOf(DshLiveDriver)
    settings.set({ live: false })
    settings.set({ enabled: false })
    expect(providers).toHaveLength(0)
    settings.set({ enabled: true })
    expect(providers).toHaveLength(1)
    expect(resolveLive('child-x')).toBeUndefined()
  })
})
