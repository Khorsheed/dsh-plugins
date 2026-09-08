import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { LocalAgentHarness, LocalAgentRegistry } from '@khorsheed/dsh-local-agent'
import { apply } from '../src/index.ts'
import { ClaudeLiveDriver } from '../src/live-driver.ts'
import type { ClaudeLiveSettings } from '../src/live-switch.ts'

/** A fake settings service: register captures the scope; set() drives watch. */
function fakeSettings(initial: ClaudeLiveSettings) {
  let value = initial
  const watchers: ((next: ClaudeLiveSettings, prev: ClaudeLiveSettings) => void)[] = []
  const registrations: unknown[] = []
  return {
    registrations,
    service: {
      register: (ns: unknown, schema: unknown, options?: unknown) => {
        registrations.push({ ns, schema, options })
        return {
          get: () => value,
          watch: (cb: (next: ClaudeLiveSettings, prev: ClaudeLiveSettings) => void) => {
            watchers.push(cb)
            return () => {}
          },
          update: async () => {},
          replace: async () => {},
        }
      },
    },
    set(next: ClaudeLiveSettings): void {
      const prev = value
      value = next
      for (const watch of watchers) watch(next, prev)
    },
  }
}

interface Mount {
  ctx: Context
  registered: LocalAgentHarness[]
  home: string
  settings: ReturnType<typeof fakeSettings>
  /** The resolver the provider was constructed with (private face). */
  resolveLive: (childSessionId: string) => ClaudeLiveDriver | undefined
  /** The model resolver the provider was constructed with (private face). */
  resolveModel: () => string | undefined
}

function mount(initial: Partial<ClaudeLiveSettings> = {}, config: Record<string, unknown> = {}): Mount {
  const ctx = new Context()
  const registered: LocalAgentHarness[] = []
  const home = mkdtempSync(join(tmpdir(), 'claude-apply-home-'))
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
    home,
    settings,
    resolveLive: id => resolveLive(id),
    resolveModel: () => resolveModel(),
  }
}

describe('local-agent-claude-code apply', () => {
  it('registers the claude-code harness and provisions a scoped home', async () => {
    const { registered, home } = mount()

    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      name: 'claude-code',
      displayName: 'Claude Code',
      homeEnvVar: 'CLAUDE_CONFIG_DIR',
      delegationProvider: 'claude-local',
    })
    // The pty login: the CLI runs on a real terminal so it opens the browser
    // itself; the declaration scrubs the relay env and pins the scoped home.
    const login = registered[0]?.login
    expect(login !== undefined && 'pty' in login).toBe(true)
    if (login !== undefined && 'pty' in login) {
      expect(login.pty.command).toBe('env')
      expect(login.pty.args).toEqual([
        '-u', 'ANTHROPIC_API_KEY', '-u', 'ANTHROPIC_BASE_URL',
        `CLAUDE_CONFIG_DIR=${home}`, 'claude', 'auth', 'login',
      ])
    }
    expect(registered[0]?.records).toBeDefined()
    // The scoped home is provisioned eagerly.
    await new Promise(resolve => setTimeout(resolve, 10))
    const { access } = await import('node:fs/promises')
    await expect(access(home)).resolves.toBeUndefined()
  })

  it('registers the settings namespace with the YAML config as the composition base', () => {
    const { settings } = mount()
    expect(settings.registrations).toHaveLength(1)
    const registration = settings.registrations[0] as { ns: unknown; options?: { base?: object } }
    expect(String(registration.ns)).toBe('local-agent-claude-code')
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
    expect(driver).toBeInstanceOf(ClaudeLiveDriver)
    expect(driver!.liveCount).toBe(0)
  })

  it('hot-switches: on → driver; off → resolver gates to exec and drains the generation', async () => {
    const { settings, resolveLive } = mount({ live: false })
    expect(resolveLive('child-x')).toBeUndefined()
    settings.set({ live: true, liveMirrorGranularity: 'event' })
    const driver = resolveLive('child-x')
    expect(driver).toBeInstanceOf(ClaudeLiveDriver)
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

  it('snapshots the defaults: exec drive, skip permission mode, no pinned endpoint', async () => {
    // Hermetic: the snapshot's env fallback is real product behavior (the
    // child CLI genuinely routes through the host's ANTHROPIC_BASE_URL), so
    // a host shell that exports it changes the honest answer. The defaults
    // case pins the env empty; the env-set behavior has its own test below.
    vi.stubEnv('ANTHROPIC_BASE_URL', undefined)
    const { registered } = mount()
    const harness = registered[0]!
    expect(harness.effectiveSettings).toBeTypeOf('function')
    await expect(harness.effectiveSettings!()).resolves.toEqual({
      drive: 'exec',
      permissionMode: 'skip',
      baseUrlSet: false,
    })
  })

  it('reports the configured permission mode, live drive, and pinned endpoint', async () => {
    const { registered } = mount({ live: true }, { permissionMode: 'normal', baseUrl: 'https://proxy.example.com/anthropic' })
    const harness = registered[0]!
    await expect(harness.effectiveSettings!()).resolves.toEqual({
      drive: 'live',
      permissionMode: 'normal',
      baseUrlSet: true,
      baseUrlHost: 'proxy.example.com',
    })
  })

  it('reports the model configured in the scoped settings.json', async () => {
    // Hermetic: the model reader must only consult the SCOPED home handed out
    // by the registry — the host's CLAUDE_CONFIG_DIR is stubbed to a sentinel
    // that nothing in the code path may read, and the endpoint env is pinned
    // empty so the base fields stay deterministic on any host shell.
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/nonexistent-claude-host-config')
    vi.stubEnv('ANTHROPIC_BASE_URL', undefined)
    const { registered, home } = mount()
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: 'claude-opus-5' }, undefined, 2))
    const harness = registered[0]!
    await expect(harness.effectiveSettings!()).resolves.toEqual({
      drive: 'exec',
      permissionMode: 'skip',
      baseUrlSet: false,
      model: 'claude-opus-5',
    })
  })

  it('omits the model field when the scoped settings name none', async () => {
    // The CLI's own default model is CLI-decided and never guessed: no model
    // key in the scoped settings, no model field — even though a host
    // CLAUDE_CONFIG_DIR exists (stubbed here to prove it is never consulted).
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/nonexistent-claude-host-config')
    vi.stubEnv('ANTHROPIC_BASE_URL', undefined)
    const { registered, home } = mount()
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ env: {} }, undefined, 2))
    const harness = registered[0]!
    const snapshot = await harness.effectiveSettings!()
    expect(snapshot).toEqual({ drive: 'exec', permissionMode: 'skip', baseUrlSet: false })
    expect('model' in snapshot).toBe(false)
  })

  it('the host environment supplies the endpoint when the config item is absent', async () => {
    const { registered } = mount()
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://relay.example.com/v1')
    const harness = registered[0]!
    await expect(harness.effectiveSettings!()).resolves.toMatchObject({
      baseUrlSet: true,
      baseUrlHost: 'relay.example.com',
    })
  })

  it('the config endpoint wins over the host environment', async () => {
    const { registered } = mount({}, { baseUrl: 'https://config.example.com/v1' })
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://env.example.com/v1')
    const harness = registered[0]!
    await expect(harness.effectiveSettings!()).resolves.toMatchObject({
      baseUrlSet: true,
      baseUrlHost: 'config.example.com',
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })
})

describe('local-agent-claude-code model key', () => {
  it('carries the YAML model into the composition base', () => {
    const { settings } = mount({}, { model: 'claude-opus-5' })
    const registration = settings.registrations[0] as { options?: { base?: object } }
    expect(registration.options?.base).toEqual({ model: 'claude-opus-5' })
  })

  it('hands the provider a resolver that follows later settings writes (no reload)', () => {
    const { settings, resolveModel } = mount()
    expect(resolveModel()).toBeUndefined()
    settings.set({ live: false, liveMirrorGranularity: 'event', model: 'claude-opus-5' })
    expect(resolveModel()).toBe('claude-opus-5')
  })

  it('treats a blank value as unset — the pre-key argv, not an empty --model', () => {
    const { resolveModel } = mount({ model: '   ' })
    expect(resolveModel()).toBeUndefined()
  })

  it('snapshot order: the plugin key wins over the scoped settings.json', async () => {
    const { home, registered } = mount({ model: 'claude-opus-5' })
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: 'scoped-model' }, undefined, 2))
    await expect(registered[0]!.effectiveSettings!()).resolves.toMatchObject({ model: 'claude-opus-5' })
  })

  it('snapshot order: with no key, the scoped settings.json still decides', async () => {
    const { home, registered } = mount()
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: 'scoped-model' }, undefined, 2))
    await expect(registered[0]!.effectiveSettings!()).resolves.toMatchObject({ model: 'scoped-model' })
  })

  it('snapshot order: neither one names a model, so the field stays absent', async () => {
    const { registered } = mount()
    const snapshot = await registered[0]!.effectiveSettings!()
    expect('model' in snapshot).toBe(false)
  })
})
