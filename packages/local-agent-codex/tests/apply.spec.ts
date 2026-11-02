import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { LocalAgentHarness, LocalAgentRegistry } from '@khorsheed/dsh-local-agent'
import { apply, CATALOG_WARMUP_DELAY_MS } from '../src/index.ts'
import { CodexLiveDriver } from '../src/live-driver.ts'
import type { CodexLiveSettings } from '../src/live-switch.ts'

/** The settings fields the row config carries as volatile references. */
const SETTINGS_KEYS = ['live', 'liveMirrorGranularity', 'model', 'recentModels'] as const

/**
 * A fake of the host's row-config settings: each settings field is a
 * volatile `{ get() }` reference over one mutable document; set() replaces
 * the document and emits `settings/document-updated` for the row id.
 */
function fakeSettings(ctx: Context, initial: CodexLiveSettings) {
  let value: Record<string, unknown> = { ...initial }
  const refs: Record<string, { get(): unknown }> = {}
  for (const key of SETTINGS_KEYS) refs[key] = { get: () => value[key] }
  return {
    refs,
    service: {},
    set(next: CodexLiveSettings): void {
      value = { ...next }
      ;(ctx.emit as (name: string, ...args: unknown[]) => void)('settings/document-updated', 'local-agent-codex', 1)
    },
  }
}

interface Mount {
  ctx: Context
  home: string
  registered: LocalAgentHarness[]
  settings: ReturnType<typeof fakeSettings>
  /** The managed-spawn specs the catalog warmup attempted (spawn itself fails here). */
  spawns: SubprocessSpawnSpec[]
  /** The resolver the provider was constructed with (private face). */
  resolveLive: (childSessionId: string) => CodexLiveDriver | undefined
  /** The model resolver the provider was constructed with (private face). */
  resolveModel: () => string | undefined
}

function mount(initial: Partial<CodexLiveSettings> = {}, config: Record<string, unknown> = {}): Mount {
  const ctx = new Context()
  const registered: LocalAgentHarness[] = []
  const home = mkdtempSync(join(tmpdir(), 'codex-apply-home-'))
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
  const settings = fakeSettings(ctx, { live: false, liveMirrorGranularity: 'event', ...fromConfig, ...initial } as CodexLiveSettings)
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
  const spawns: SubprocessSpawnSpec[] = []
  ctx.provide('subprocess', {
    spawn: (spec: SubprocessSpawnSpec) => {
      spawns.push(spec)
      throw new Error('not spawned in apply test')
    },
  })
  ctx.provide('settings', settings.service)
  apply(ctx, { ...config, ...settings.refs } as never)
  return {
    ctx,
    home,
    registered,
    settings,
    spawns,
    resolveLive: id => resolveLive(id),
    resolveModel: () => resolveModel(),
  }
}

describe('local-agent-codex apply', () => {
  it('registers the codex harness and provisions a scoped config', async () => {
    const { home, registered } = mount()

    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      name: 'codex',
      displayName: 'Codex',
      homeEnvVar: 'CODEX_HOME',
      delegationProvider: 'codex-local',
    })
    // No login declaration: the harness is endpoint-key only.
    expect(registered[0]?.login).toBeUndefined()
    // The records adapter is exercised end-to-end by the records spec.
    expect(registered[0]?.records).toBeDefined()
    // The scoped home is provisioned with the file-credential config.
    await new Promise(resolve => setTimeout(resolve, 10))
    const { readFile } = await import('node:fs/promises')
    await expect(readFile(join(home, 'config.toml'), 'utf8')).resolves.toContain('cli_auth_credentials_store = "file"')
  })

  it('serves the settings from the row config (the YAML value rules)', () => {
    const { resolveLive } = mount({}, { live: true, liveMirrorGranularity: 'token' })
    expect(resolveLive('child-x')).toBeInstanceOf(CodexLiveDriver)
  })

  it('ignores a document update for another row', () => {
    const { ctx, resolveLive } = mount({ live: false })
    ;(ctx.emit as (name: string, ...args: unknown[]) => void)('settings/document-updated', 'local-agent-kimi', 1)
    expect(resolveLive('child-x')).toBeUndefined()
  })

  it('keeps live off when the settings say off; no driver is built', () => {
    const { resolveLive } = mount({ live: false })
    expect(resolveLive('child-x')).toBeUndefined()
  })

  it('builds the driver generation when the settings say on', () => {
    const { resolveLive } = mount({ live: true })
    const driver = resolveLive('child-x')
    expect(driver).toBeInstanceOf(CodexLiveDriver)
    expect(driver!.liveCount).toBe(0)
  })

  it('hot-switches: on → driver; off → resolver gates to exec and drains the generation', async () => {
    const { settings, resolveLive } = mount({ live: false })
    expect(resolveLive('child-x')).toBeUndefined()
    settings.set({ live: true, liveMirrorGranularity: 'event' })
    const driver = resolveLive('child-x')
    expect(driver).toBeInstanceOf(CodexLiveDriver)
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

  it('snapshots the defaults: exec drive, workspace-write sandbox, no pinned endpoint', async () => {
    const { home, registered } = mount()
    const harness = registered[0]!
    expect(harness.effectiveSettings).toBeTypeOf('function')
    // The snapshot reads the scoped config only for keys the minimal one
    // never writes, so its answer is independent of provisioning timing.
    await expect(harness.effectiveSettings!(home)).resolves.toEqual({
      drive: 'exec',
      sandbox: 'workspace-write',
      baseUrlSet: false,
    })
  })

  it('reports the configured sandbox policy and the live drive', async () => {
    const { home, registered } = mount({ live: true }, { sandbox: 'danger-full-access' })
    const harness = registered[0]!
    await expect(harness.effectiveSettings!(home)).resolves.toMatchObject({
      drive: 'live',
      sandbox: 'danger-full-access',
    })
  })

  it('reads reasoning effort and endpoint live from the scoped config', async () => {
    const { home, registered } = mount()
    // A person-edited scoped config: codex itself reads these keys, so the
    // snapshot must report them as-is (provision never touches them).
    writeFileSync(join(home, 'config.toml'), [
      'model_reasoning_effort = "high"',
      'cli_auth_credentials_store = "file"',
      '',
      '[model_providers.router]',
      'base_url = "https://proxy.example.com/v1"',
      '',
      'model_provider = "router"',
    ].join('\n'))
    const harness = registered[0]!
    await expect(harness.effectiveSettings!(home)).resolves.toEqual({
      drive: 'exec',
      sandbox: 'workspace-write',
      reasoningEffort: 'high',
      baseUrlSet: true,
      baseUrlHost: 'proxy.example.com',
    })
  })

  it('reports the scoped config model when one is configured', async () => {
    const { home, registered } = mount()
    writeFileSync(join(home, 'config.toml'), [
      'model = "gpt-5.2"',
      'model_reasoning_effort = "high"',
      'cli_auth_credentials_store = "file"',
      '',
    ].join('\n'))
    const harness = registered[0]!
    await expect(harness.effectiveSettings!(home)).resolves.toMatchObject({ model: 'gpt-5.2' })
  })

  it('omits the model field when the scoped config names no model', async () => {
    const { home, registered } = mount()
    // The provisioned minimal config carries no model key; a person-mirrored
    // config without one must not grow a guessed identifier either.
    writeFileSync(join(home, 'config.toml'), [
      'model_reasoning_effort = "high"',
      'cli_auth_credentials_store = "file"',
      '',
    ].join('\n'))
    const harness = registered[0]!
    const snapshot = await harness.effectiveSettings!(home)
    expect(snapshot).toMatchObject({ drive: 'exec', sandbox: 'workspace-write', reasoningEffort: 'high' })
    expect('model' in snapshot).toBe(false)
  })
})

describe('local-agent-codex model catalog warmup', () => {
  it('kicks exactly one background probe of the default scoped home after boot, with no modelInfo call', async () => {
    vi.useFakeTimers()
    // The probe is endpoint-primary: the endpoint side is an HTTP fetch (the
    // host's global fetch, stubbed here), the native side the app-server spawn
    // — both need a credential to run at all, so this mount carries one.
    const fetches: string[] = []
    vi.stubGlobal('fetch', async (url: string | URL | Request) => {
      fetches.push(String(url))
      return new Response(JSON.stringify({ object: 'list', data: [{ id: 'gpt-a', object: 'model' }] }), { status: 200 })
    })
    try {
      const { registered, spawns } = mount({}, { apiKey: 'sk-test' })
      // Apply itself probes nothing: the warmup is a post-boot timer, and the
      // broker's read path (the only other probe trigger) was never called.
      expect(registered[0]?.modelBroker).toBeDefined()
      expect(spawns).toHaveLength(0)

      await vi.advanceTimersByTimeAsync(CATALOG_WARMUP_DELAY_MS)
      // The spawn sits behind the endpoint-credential read (a real fs miss
      // resolves a tick after the timer flush), so wait the probe out instead
      // of asserting on the flush boundary.
      await vi.waitFor(() => { expect(spawns).toHaveLength(1) })
      expect(spawns[0]?.argv).toEqual(['codex', 'app-server', '--stdio'])
      expect(fetches).toEqual(['https://api.openai.com/v1/models'])

      // One warmup per boot: idling past further timers probes nothing again.
      await vi.advanceTimersByTimeAsync(CATALOG_WARMUP_DELAY_MS * 4)
      expect(spawns).toHaveLength(1)
      expect(fetches).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})

describe('local-agent-codex model key', () => {
  it('serves the YAML model from the row config', () => {
    const { resolveModel } = mount({}, { model: 'gpt-5.2' })
    expect(resolveModel()).toBe('gpt-5.2')
  })

  it('hands the provider a resolver that follows later settings writes (no reload)', () => {
    const { settings, resolveModel } = mount()
    expect(resolveModel()).toBeUndefined()
    settings.set({ live: false, liveMirrorGranularity: 'event', model: 'gpt-5.2' })
    expect(resolveModel()).toBe('gpt-5.2')
  })

  it('treats a blank value as unset — the pre-key argv, not an empty -m', () => {
    const { resolveModel } = mount({ model: '   ' })
    expect(resolveModel()).toBeUndefined()
  })

  it('trims the configured value before it reaches the argv', () => {
    const { resolveModel } = mount({ model: '  gpt-5.2  ' })
    expect(resolveModel()).toBe('gpt-5.2')
  })

  it('snapshot order: the plugin key wins over the scoped config it overrules', async () => {
    const { home, registered } = mount({ model: 'gpt-5.2' })
    // The scoped file names a different model, and codex would honour it —
    // but every round now spawns with -m, so the key is what actually runs.
    writeFileSync(join(home, 'config.toml'), [
      'model = "scoped-model"',
      'cli_auth_credentials_store = "file"',
      '',
    ].join('\n'))
    const harness = registered[0]!
    await expect(harness.effectiveSettings!(home)).resolves.toMatchObject({ model: 'gpt-5.2' })
  })

  it('snapshot order: with no key, the scoped config still decides', async () => {
    const { home, registered } = mount()
    writeFileSync(join(home, 'config.toml'), [
      'model = "scoped-model"',
      'cli_auth_credentials_store = "file"',
      '',
    ].join('\n'))
    const harness = registered[0]!
    await expect(harness.effectiveSettings!(home)).resolves.toMatchObject({ model: 'scoped-model' })
  })

  it('snapshot order: neither one names a model, so the field stays absent', async () => {
    const { home, registered } = mount()
    const snapshot = await registered[0]!.effectiveSettings!(home)
    expect('model' in snapshot).toBe(false)
  })
})
