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

/** A fake settings service: register captures the scope; set() drives watch. */
function fakeSettings(initial: KimiLiveSettings) {
  let value = initial
  const watchers: ((next: KimiLiveSettings, prev: KimiLiveSettings) => void)[] = []
  const registrations: unknown[] = []
  return {
    registrations,
    service: {
      register: (ns: unknown, schema: unknown, options?: unknown) => {
        registrations.push({ ns, schema, options })
        return {
          get: () => value,
          watch: (cb: (next: KimiLiveSettings, prev: KimiLiveSettings) => void) => {
            watchers.push(cb)
            return () => {}
          },
          update: async () => {},
          replace: async () => {},
        }
      },
    },
    set(next: KimiLiveSettings): void {
      const prev = value
      value = next
      for (const watch of watchers) watch(next, prev)
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
  const settings = fakeSettings({ live: false, liveMirrorGranularity: 'event', ...initial })
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
  apply(ctx, config as never)
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
      login: { command: 'kimi', args: ['login'] },
    })
    // The records adapter is exercised end-to-end by the kimi-records spec.
    expect(registered[0]?.records).toBeDefined()
  })

  it('registers the settings namespace with the YAML config as the composition base', () => {
    const { settings } = mount()
    expect(settings.registrations).toHaveLength(1)
    const registration = settings.registrations[0] as { ns: unknown; options?: { base?: object } }
    expect(String(registration.ns)).toBe('local-agent-kimi')
    // A bare config leaves the base empty: the schema defaults rule.
    expect(registration.options?.base).toEqual({})
  })

  it('carries the YAML config into the composition base (settings unset → YAML rules)', () => {
    const { settings, resolveLive } = mount({}, { live: true, liveMirrorGranularity: 'token' })
    const registration = settings.registrations[0] as { options?: { base?: object } }
    expect(registration.options?.base).toEqual({ live: true, liveMirrorGranularity: 'token' })
    // The fake settings service starts at live:false, so the resolver stays
    // gated — on the real host the scope resolves base ← user, and this base
    // would turn live on. What we pin here is the base payload itself.
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
    await expect(harness.effectiveSettings!()).resolves.toEqual({
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
    await expect(harness.effectiveSettings!()).resolves.toMatchObject({ reasoningEffort: 'max' })
  })

  it('reports the live driver preference as the drive', async () => {
    const { registered } = mount({ live: true })
    const harness = registered[0]!
    await expect(harness.effectiveSettings!()).resolves.toMatchObject({ drive: 'live' })
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
    await expect(harness.effectiveSettings!()).resolves.toEqual({
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
    const snapshot = await harness.effectiveSettings!()
    expect(snapshot).toMatchObject({
      drive: 'exec',
      reasoningEffort: 'high',
      baseUrlSet: false,
    })
    expect('model' in snapshot).toBe(false)
  })
})

describe('local-agent-kimi model key', () => {
  it('carries the YAML model into the composition base', () => {
    const { settings } = mount({}, { model: 'kimi-code/k3' })
    const registration = settings.registrations[0] as { options?: { base?: object } }
    expect(registration.options?.base).toEqual({ model: 'kimi-code/k3' })
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
    await expect(registered[0]!.effectiveSettings!()).resolves.toMatchObject({ model: 'card-model' })
  })

  it('snapshot order: with no key, the scoped default_model still decides', async () => {
    const { home, registered } = mount()
    writeFileSync(join(home, 'config.toml'), 'default_model = "scoped-model"\n')
    await expect(registered[0]!.effectiveSettings!()).resolves.toMatchObject({ model: 'scoped-model' })
  })
})
