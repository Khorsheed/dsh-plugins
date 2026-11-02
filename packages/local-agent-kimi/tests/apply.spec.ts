import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { LocalAgentHarness, LocalAgentRegistry } from '@khorsheed/dsh-local-agent'
import { apply } from '../src/index.ts'
import { KimiAcpLiveDriver } from '../src/live-driver.ts'
import type { KimiLiveSettings } from '../src/live-switch.ts'

// The user's real ~/.kimi-code/config.toml must never leak into these tests:
// the provision mirror path copies it (redacted) whenever it exists, which
// would make every fresh-home assertion machine-dependent. Pin homedir to a
// location with no kimi config so the minimal-config path is deterministic.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => '/nonexistent-kimi-provision-test' }
})

/** The settings fields the row config carries as volatile references. */
const SETTINGS_KEYS = ['live', 'liveMirrorGranularity', 'model', 'recentModels'] as const

/**
 * A fake of the host's row-config settings: each settings field is a
 * volatile `{ get() }` reference over one mutable document; set() replaces
 * the document and emits `settings/document-updated` for the row id.
 */
function fakeSettings(ctx: Context, initial: KimiLiveSettings) {
  let value: Record<string, unknown> = { ...initial }
  const refs: Record<string, { get(): unknown }> = {}
  for (const key of SETTINGS_KEYS) refs[key] = { get: () => value[key] }
  return {
    refs,
    service: {},
    set(next: KimiLiveSettings): void {
      value = { ...next }
      ;(ctx.emit as (name: string, ...args: unknown[]) => void)('settings/document-updated', 'local-agent-kimi', 1)
    },
  }
}

interface Mount {
  ctx: Context
  registered: LocalAgentHarness[]
  settings: ReturnType<typeof fakeSettings>
  /** The scoped home the fake registry hands out (the provision target). */
  home: string
  /** The resolver the provider was constructed with (private face). */
  resolveLive: (childSessionId: string) => KimiAcpLiveDriver | undefined
  /** The model resolver the provider was constructed with (private face). */
  resolveModel: () => string | undefined
}

function mount(initial: Partial<KimiLiveSettings> = {}, config: Record<string, unknown> = {}): Mount {
  const ctx = new Context()
  const registered: LocalAgentHarness[] = []
  const home = mkdtempSync(join(tmpdir(), 'kimi-apply-home-'))
  const registry = {
    homeDir: () => home,
    register: (harness: LocalAgentHarness) => {
      registered.push(harness)
      return () => {}
    },
  } as unknown as LocalAgentRegistry
  // The row config IS the settings document: settings keys handed in through
  // `config` seed it, `initial` layers on top (a test's direct settings).
  const fromConfig = Object.fromEntries(SETTINGS_KEYS.filter(key => config[key] !== undefined).map(key => [key, config[key]]))
  const settings = fakeSettings(ctx, { live: false, liveMirrorGranularity: 'event', ...fromConfig, ...initial } as KimiLiveSettings)
  let resolveLive: Mount['resolveLive'] = () => undefined
  let resolveModel: Mount['resolveModel'] = () => undefined
  ctx.provide('localAgent', registry)
  ctx.provide('logger', { warn: () => {} })
  ctx.provide('subagents', {
    registerProvider: (provider: unknown) => {
      resolveLive = (provider as { live: Mount['resolveLive'] }).live
      resolveModel = (provider as { model?: Mount['resolveModel'] }).model ?? (() => undefined)
    },
  })
  ctx.provide('subprocess', { spawn: () => { throw new Error('not spawned in apply test') } })
  ctx.provide('settings', settings.service)
  apply(ctx, { ...config, ...settings.refs } as never)
  return {
    ctx,
    registered,
    settings,
    home,
    resolveLive: id => resolveLive(id),
    resolveModel: () => resolveModel(),
  }
}

describe('local-agent-kimi apply', () => {
  it('registers the kimi harness and provisions a config into the scoped home', () => {
    const { registered } = mount()

    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      name: 'kimi',
      displayName: 'Kimi Code',
      homeEnvVar: 'KIMI_CODE_HOME',
      delegationProvider: 'kimi-cli',
    })
    // No login declaration: the harness is endpoint-key only.
    expect(registered[0]?.login).toBeUndefined()
    // The records adapter is exercised end-to-end by the kimi-records spec.
    expect(registered[0]?.records).toBeDefined()
  })

  it('declares the endpoint check the card’s verify button rides (session-less via the gateway)', async () => {
    const { home, registered } = mount()
    const checkEndpoint = registered[0]?.checkEndpoint
    expect(checkEndpoint).toBeTypeOf('function')
    // No credential anywhere: the verdict says save a key first, and no
    // network is touched (a fetch would throw in this test's sandbox anyway).
    await expect(checkEndpoint!(home)).resolves.toContain('No endpoint credential configured')
  })

  it('serves the settings from the row config (the YAML value rules)', () => {
    const { resolveLive } = mount({}, { live: true, liveMirrorGranularity: 'token' })
    expect(resolveLive('child-x')).toBeInstanceOf(KimiAcpLiveDriver)
  })

  it('ignores a document update for another row', () => {
    const { ctx, resolveLive } = mount({ live: false })
    ;(ctx.emit as (name: string, ...args: unknown[]) => void)('settings/document-updated', 'local-agent-codex', 1)
    expect(resolveLive('child-x')).toBeUndefined()
  })

  it('keeps live off when the settings say off; no driver is built', () => {
    const { resolveLive } = mount({ live: false })
    expect(resolveLive('child-x')).toBeUndefined()
  })

  it('builds the driver generation when the settings say on', () => {
    const { resolveLive } = mount({ live: true })
    const driver = resolveLive('child-x')
    expect(driver).toBeInstanceOf(KimiAcpLiveDriver)
    expect(driver!.liveCount).toBe(0)
  })

  it('hot-switches: on → driver; off → resolver gates to exec and drains the generation', async () => {
    const { settings, resolveLive } = mount({ live: false })
    expect(resolveLive('child-x')).toBeUndefined()
    settings.set({ live: true, liveMirrorGranularity: 'event' })
    const driver = resolveLive('child-x')
    expect(driver).toBeInstanceOf(KimiAcpLiveDriver)
    settings.set({ live: false, liveMirrorGranularity: 'event' })
    expect(resolveLive('child-x')).toBeUndefined()
    // The retired generation drains (empty here → immediate) and is disposed.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(driver!.liveCount).toBe(0)
  })

  it('a granularity change rides the same generation (no rebuild, no drain)', () => {
    const { settings, resolveLive } = mount({ live: true })
    const driver = resolveLive('child-x')
    settings.set({ live: true, liveMirrorGranularity: 'token' })
    expect(resolveLive('child-x')).toBe(driver)
  })

  it('snapshots a fresh home: exec drive, effort high, auto-approve, managed endpoint, configured model', async () => {
    const { registered, home } = mount()
    const harness = registered[0]!
    expect(harness.effectiveSettings).toBeTypeOf('function')
    // Provisioning and permission bootstrap are fire-and-forget at apply;
    // the snapshot is a live read, so wait for them to land.
    await vi.waitFor(() => {
      expect(existsSync(join(home, 'config.toml'))).toBe(true)
      expect(readFileSync(join(home, 'config.toml'), 'utf8')).toContain('effort = "high"')
      expect(readFileSync(join(home, 'config.toml'), 'utf8')).toContain('pattern = "Bash(*)')
    })
    await expect(harness.effectiveSettings!(home)).resolves.toEqual({
      drive: 'exec',
      autoApprove: true,
      reasoningEffort: 'high',
      baseUrlSet: false,
      model: 'kimi-code/k3',
    })
  })

  it('pins the configured thinkingEffort into a fresh home and reports it', async () => {
    const { registered, home } = mount({}, { thinkingEffort: 'max' })
    const harness = registered[0]!
    await vi.waitFor(() => {
      expect(readFileSync(join(home, 'config.toml'), 'utf8')).toContain('effort = "max"')
    })
    await expect(harness.effectiveSettings!(home)).resolves.toMatchObject({ reasoningEffort: 'max' })
  })

  it('reports the live driver preference as the drive', async () => {
    const { home, registered } = mount({ live: true })
    const harness = registered[0]!
    await expect(harness.effectiveSettings!(home)).resolves.toMatchObject({ drive: 'live' })
  })

  it('a pre-existing scoped config is authoritative over the config item', async () => {
    const { registered, home } = mount({}, { thinkingEffort: 'max' })
    // A home provisioned earlier (or mirrored from the user's config): the
    // config item must not leak into the snapshot — the scoped file governs.
    writeFileSync(join(home, 'config.toml'), [
      '[thinking]',
      'enabled = true',
      'effort = "low"',
      '',
      '[providers."managed:kimi-code"]',
      'base_url = "https://proxy.example.com/anthropic"',
      'type = "kimi"',
      'api_key = ""',
      '',
    ].join('\n'))
    const harness = registered[0]!
    await expect(harness.effectiveSettings!(home)).resolves.toEqual({
      drive: 'exec',
      autoApprove: false,
      reasoningEffort: 'low',
      baseUrlSet: true,
      baseUrlHost: 'proxy.example.com',
    })
  })

  it('omits the model field when the scoped config names no default_model', async () => {
    const { registered, home } = mount()
    // A mirrored config without a top-level default_model: nothing is
    // configured, so the snapshot must not invent an identifier. Only the
    // model-absence is under test — the permission bootstrap may or may not
    // have appended its rule around this write, so autoApprove is not asserted.
    writeFileSync(join(home, 'config.toml'), [
      '[thinking]',
      'enabled = true',
      'effort = "high"',
      '',
    ].join('\n'))
    const harness = registered[0]!
    const snapshot = await harness.effectiveSettings!(home)
    expect(snapshot).toMatchObject({
      drive: 'exec',
      reasoningEffort: 'high',
      baseUrlSet: false,
    })
    expect('model' in snapshot).toBe(false)
  })
})

describe('local-agent-kimi model key', () => {
  it('registers the model broker (settings card + member composer surface)', async () => {
    const { registered } = mount({ model: 'card-model' })
    const broker = registered[0]?.modelBroker
    expect(broker).toBeDefined()
    await expect(broker!.modelInfo()).resolves.toMatchObject({
      effective: 'card-model',
      source: 'settings',
      live: false,
      switchable: true,
    })
  })

  it('serves the YAML model from the row config', () => {
    const { resolveModel } = mount({}, { model: 'kimi-code/k3' })
    expect(resolveModel()).toBe('kimi-code/k3')
  })

  it('hands the provider a resolver that follows later settings writes (no reload)', () => {
    const { settings, resolveModel } = mount()
    expect(resolveModel()).toBeUndefined()
    settings.set({ live: false, liveMirrorGranularity: 'event', model: 'kimi-code/k3' })
    expect(resolveModel()).toBe('kimi-code/k3')
  })

  it('treats a blank value as unset — the pre-key argv, not an empty -m', () => {
    const { resolveModel } = mount({ model: '   ' })
    expect(resolveModel()).toBeUndefined()
  })

  it('snapshot order: the plugin key wins over the scoped default_model', async () => {
    const { home, registered } = mount({ model: 'card-model' })
    // The scoped config still names the mirrored default; every round now
    // spawns with -m, so the key is what actually runs.
    writeFileSync(join(home, 'config.toml'), 'default_model = "scoped-model"\n')
    await expect(registered[0]!.effectiveSettings!(home)).resolves.toMatchObject({ model: 'card-model' })
  })

  it('snapshot order: with no key, the scoped default_model still decides', async () => {
    const { home, registered } = mount()
    writeFileSync(join(home, 'config.toml'), 'default_model = "scoped-model"\n')
    await expect(registered[0]!.effectiveSettings!(home)).resolves.toMatchObject({ model: 'scoped-model' })
  })
})
