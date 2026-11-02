/**
 * The dsh harness controller: registers the harness and provider at startup
 * (the delegation tool is the ./tool entry a preset grants). The live
 * preferences ride the row config, and the LiveDriverSwitch hot-swaps driver
 * generations on a settings change — the provider registration stays stable
 * across a live flip. A leftover `enabled` key from the retired switch is
 * ignored.
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

/** The settings fields the row config carries as volatile references. */
const SETTINGS_KEYS = ['live', 'liveMirrorGranularity', 'model', 'recentModels'] as const

/**
 * A fake of the host's row-config settings: each settings field is a
 * volatile `{ get() }` reference over one mutable document; set() merges
 * into the document and emits `settings/document-updated` for the row id.
 */
function fakeSettings(ctx: Context, initial: DshLiveSettings) {
  let value: Record<string, unknown> = { ...initial }
  const refs: Record<string, { get(): unknown }> = {}
  for (const key of SETTINGS_KEYS) refs[key] = { get: () => value[key] }
  return {
    refs,
    service: {},
    set(next: Partial<DshLiveSettings>): void {
      value = { ...value, ...next }
      ;(ctx.emit as (name: string, ...args: unknown[]) => void)('settings/document-updated', 'local-agent-dsh', 1)
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
  // The row config IS the settings document: settings keys handed in through
  // `config` seed it, `initial` layers on top (a test's direct settings).
  const fromConfig = Object.fromEntries(SETTINGS_KEYS.filter(key => config[key] !== undefined).map(key => [key, config[key]]))
  const settings = fakeSettings(ctx, { live: false, liveMirrorGranularity: 'event', ...fromConfig, ...initial } as DshLiveSettings)
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
  apply(ctx, { ...config, ...settings.refs } as never)
  return { ctx, registered, providers, mountedTools, settings, resolveLive: id => resolveLive(id) }
}

describe('local-agent-dsh controller', () => {
  it('reports authentication for the selected Kimi route without a DeepSeek credential', async () => {
    const m = mount({ model: 'kimi-coding/k3' })
    Object.assign(m.ctx.settings, { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { 'kimi-coding': { apiKeyEnv: 'KIMI_KEY' } } } }] })
    Object.assign(m.ctx.credentials, { resolve: async (ref: string) => ref === 'KIMI_KEY' ? { value: 'test-kimi' } : undefined })
    expect(await m.registered[0]!.isAuthenticated?.('ignored-home')).toBe(true)
  })

  it('registers the harness and provider even when a profile still says enabled: false (the switch is gone), and mounts no root tool', () => {
    const { registered, providers, mountedTools } = mount({}, { enabled: false })
    expect(registered).toHaveLength(1)
    expect(providers).toHaveLength(1)
    // The delegation tool is the package's ./tool entry, granted by a preset.
    expect(mountedTools).toHaveLength(0)
  })

  it('the harness snapshot reports the drive and no pinned endpoint', async () => {
    const { home, registered, settings } = mount({ live: false })
    const harness = registered[0]!
    expect(harness.effectiveSettings).toBeTypeOf('function')
    // Synchronous on purpose: nothing to read from disk.
    // `containerNodeOptions` is unconditional: the provider always injects
    // `--use-env-proxy` on a container target, so the snapshot always names it.
    expect(await harness.effectiveSettings!(home)).toEqual({
      drive: 'exec',
      baseUrlSet: false,
      containerNodeOptions: '--use-env-proxy',
    })
    // The live preference rides the same namespace; flipping it flips the
    // snapshot's drive on the next read.
    settings.set({ live: true })
    expect(await harness.effectiveSettings!(home)).toEqual({
      drive: 'live',
      baseUrlSet: false,
      containerNodeOptions: '--use-env-proxy',
    })
  })

  it('reports the inherited host model selection as provider/model', async () => {
    // The sub-dsh agent loader reads the same agentDefaultModel service, so
    // this selection is what a delegation round actually runs with.
    const { home, registered } = mount({}, {}, {
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
    })
    const harness = registered[0]!
    expect(await harness.effectiveSettings!(home)).toEqual({
      drive: 'exec',
      baseUrlSet: false,
      containerNodeOptions: '--use-env-proxy',
      model: 'deepseek/deepseek-chat',
    })
  })

  it('omits the model field when no selection is readable', async () => {
    // Service present but empty-handed, and the service absent entirely: both
    // must leave the field out rather than guessing an identifier.
    const { home, registered } = mount({}, {}, {
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: '' }) },
    })
    const harness = registered[0]!
    expect('model' in (await harness.effectiveSettings!(home))).toBe(false)

    const bare = mount({})
    const bareHarness = bare.registered[0]!
    expect('model' in (await bareHarness.effectiveSettings!(home))).toBe(false)
  })

  it('registers the harness and provider, and ignores a leftover enabled flip', () => {
    const { registered, providers, mountedTools, settings } = mount({})

    // ON: harness + provider registered, tool mounted for dsh-cli.
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      name: 'dsh',
      displayName: 'dsh',
      homeEnvVar: 'DSH_HOME',
      delegationProvider: 'dsh-cli',
    })
    expect(providers).toHaveLength(1)
    expect(mountedTools).toHaveLength(0)

    // A leftover enabled flip changes nothing: there is no off any more.
    settings.set({ enabled: false } as never)
    expect(registered).toHaveLength(1)
    expect(providers).toHaveLength(1)
  })

  it('serves the settings from the row config (the YAML value rules)', () => {
    const { providers, resolveLive } = mount({}, { live: true, liveMirrorGranularity: 'token' })
    expect(providers).toHaveLength(1)
    expect(resolveLive('child-x')).toBeInstanceOf(DshLiveDriver)
  })

  it('ignores a document update for another row', () => {
    const { ctx, resolveLive } = mount({ live: false })
    ;(ctx.emit as (name: string, ...args: unknown[]) => void)('settings/document-updated', 'local-agent-kimi', 1)
    expect(resolveLive('child-x')).toBeUndefined()
  })

  it('builds the live driver whatever a leftover enabled field says', () => {
    const { resolveLive } = mount({ live: true }, { enabled: false })
    expect(resolveLive('child-x')).toBeInstanceOf(DshLiveDriver)
  })

  it('keeps live off when the settings say off; the resolver gates to exec', () => {
    const { resolveLive } = mount({ live: false })
    expect(resolveLive('child-x')).toBeUndefined()
  })

  it('builds the driver generation when live is on', () => {
    const { resolveLive } = mount({ live: true })
    const driver = resolveLive('child-x')
    expect(driver).toBeInstanceOf(DshLiveDriver)
    expect(driver!.liveCount).toBe(0)
  })

  it('hot-switches live without re-registering the provider: on → driver; off → gate to exec + drain', async () => {
    const { settings, providers, resolveLive } = mount({ live: false })
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
    const { settings, resolveLive } = mount({ live: true })
    const driver = resolveLive('child-x')
    settings.set({ liveMirrorGranularity: 'token' })
    expect(resolveLive('child-x')).toBe(driver)
  })

})
