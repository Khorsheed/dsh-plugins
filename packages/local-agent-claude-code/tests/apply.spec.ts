import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs'
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
  resolveModel: (childSessionId?: string, delegationModel?: string) => string | undefined
}

function mount(initial: Partial<ClaudeLiveSettings> = {}, config: Record<string, unknown> = {}): Mount {
  const ctx = new Context()
  const registered: LocalAgentHarness[] = []
  const home = mkdtempSync(join(tmpdir(), 'claude-apply-home-'))
  const registry = {
    homeDir: () => home,
    isDelegationActive: () => false,
    getDelegation: () => undefined,
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
    resolveModel: (child, delegation) => resolveModel(child, delegation),
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
    // No login flow: the harness authenticates by endpoint key
    // (the scope's endpoint-auth.json over the plugin config triple), so the
    // core reports the harness as not loginable and `/claude-code login`
    // answers that there is no login flow.
    expect(registered[0]?.login).toBeUndefined()
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
    const { home, registered } = mount()
    const harness = registered[0]!
    expect(harness.effectiveSettings).toBeTypeOf('function')
    await expect(harness.effectiveSettings!(home)).resolves.toEqual({
      drive: 'exec',
      permissionMode: 'skip',
      baseUrlSet: false,
    })
  })

  it('reports the configured permission mode, live drive, and pinned endpoint', async () => {
    const { home, registered } = mount({ live: true }, { permissionMode: 'normal', baseUrl: 'https://proxy.example.com/anthropic' })
    const harness = registered[0]!
    await expect(harness.effectiveSettings!(home)).resolves.toEqual({
      drive: 'live',
      permissionMode: 'normal',
      baseUrlSet: true,
      baseUrlHost: 'proxy.example.com',
    })
  })

  it('reports the model configured in the scoped settings.json', async () => {
    // Hermetic: the model reader must only consult the SCOPED home handed out
    // by the registry — the host's CLAUDE_CONFIG_DIR is stubbed to a sentinel
    // that nothing in the code path may read.
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/nonexistent-claude-host-config')
    const { registered, home } = mount()
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: 'claude-opus-5' }, undefined, 2))
    const harness = registered[0]!
    await expect(harness.effectiveSettings!(home)).resolves.toEqual({
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
    const { registered, home } = mount()
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ env: {} }, undefined, 2))
    const harness = registered[0]!
    const snapshot = await harness.effectiveSettings!(home)
    expect(snapshot).toEqual({ drive: 'exec', permissionMode: 'skip', baseUrlSet: false })
    expect('model' in snapshot).toBe(false)
  })

  it('never consults the host environment: a shell-exported ANTHROPIC_BASE_URL changes nothing', async () => {
    // The endpoint comes from the scope's endpoint-auth.json over the plugin
    // config, full stop — a supervisor-spawned instance does not inherit the
    // user's shell, and one that does must not route delegations through it
    // by accident.
    const { home, registered } = mount()
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://relay.example.com/v1')
    const harness = registered[0]!
    await expect(harness.effectiveSettings!(home)).resolves.toMatchObject({
      baseUrlSet: false,
    })
  })

  it('the config endpoint supplies the snapshot endpoint', async () => {
    const { home, registered } = mount({}, { baseUrl: 'https://config.example.com/v1' })
    const harness = registered[0]!
    await expect(harness.effectiveSettings!(home)).resolves.toMatchObject({
      baseUrlSet: true,
      baseUrlHost: 'config.example.com',
    })
  })

  it('the scope endpoint file overrides the config endpoint in the snapshot', async () => {
    const { home, registered } = mount({}, { baseUrl: 'https://config.example.com/v1', apiKey: 'sk-deploy' })
    writeFileSync(join(home, 'endpoint-auth.json'), JSON.stringify({ baseUrl: 'https://scope.example.com/v1', apiKey: 'sk-scope' }))
    const harness = registered[0]!
    await expect(harness.effectiveSettings!(home)).resolves.toMatchObject({
      baseUrlSet: true,
      baseUrlHost: 'scope.example.com',
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
    await expect(registered[0]!.effectiveSettings!(home)).resolves.toMatchObject({ model: 'claude-opus-5' })
  })

  it('snapshot order: with no key, the scoped settings.json still decides', async () => {
    const { home, registered } = mount()
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: 'scoped-model' }, undefined, 2))
    await expect(registered[0]!.effectiveSettings!(home)).resolves.toMatchObject({ model: 'scoped-model' })
  })

  it('snapshot order: neither one names a model, so the field stays absent', async () => {
    const { home, registered } = mount()
    const snapshot = await registered[0]!.effectiveSettings!(home)
    expect('model' in snapshot).toBe(false)
  })
})

describe('local-agent-claude-code model broker', () => {
  it('registers a broker whose memberless surface answers the settings layer', async () => {
    const { registered } = mount({ model: 'claude-opus-5' })
    const broker = registered[0]!.modelBroker
    expect(broker).toBeDefined()
    await expect(broker!.modelInfo()).resolves.toMatchObject({
      effective: 'claude-opus-5',
      source: 'settings',
      settings: 'claude-opus-5',
      live: false,
      switchable: true,
      choices: ['claude-opus-5'],
    })
  })

  it('reads the scoped settings.json model as the cli-config layer', async () => {
    const { home, registered } = mount()
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: 'scoped-model' }))
    await expect(registered[0]!.modelBroker!.modelInfo()).resolves.toMatchObject({
      effective: 'scoped-model',
      source: 'cli-config',
    })
  })

  it('a member switch stores the override, and the round resolver answers it first', async () => {
    const { registered, resolveModel } = mount({ model: 'settings-model' })
    const broker = registered[0]!.modelBroker!
    await broker.setMemberModel('child-x', 'model-b')
    // The same override map feeds the provider/live resolvers: the next
    // round of this member runs the override, ahead of the delegation model.
    expect(resolveModel('child-x', 'delegation-model')).toBe('model-b')
    expect(resolveModel('child-y', 'delegation-model')).toBe('delegation-model')
    expect(resolveModel('child-y')).toBe('settings-model')
    await expect(broker.modelInfo('child-x', 'delegation-model')).resolves.toMatchObject({
      effective: 'model-b',
      source: 'override',
    })
  })
})

describe('local-agent-claude-code endpoint auth', () => {
  it('reports unauthenticated with neither a scope file nor a config key', async () => {
    const { home, registered } = mount()
    await expect(registered[0]!.isAuthenticated!(home)).resolves.toBe(false)
    await expect(registered[0]!.credentialStamp!(home)).resolves.toBeUndefined()
  })

  it('never carries the credential into the settings composition base', () => {
    // A secret must not land in the volatile row-config channel at all: the
    // card writes the scope file through the endpointAuth face, and the
    // profile row stays the only config-layer home of the deployment triple.
    const { settings } = mount({}, { baseUrl: 'https://relay.example.com', apiKey: 'sk-deploy' })
    const registration = settings.registrations[0] as { options?: { base?: object } }
    expect(registration.options?.base ?? {}).not.toMatchObject({ apiKey: expect.anything(), baseUrl: expect.anything() })
  })

  it('the config apiKey authenticates every scope (the deployment default)', async () => {
    const { home, registered } = mount({}, { baseUrl: 'https://relay.example.com', apiKey: 'sk-deploy' })
    await expect(registered[0]!.isAuthenticated!(home)).resolves.toBe(true)
  })

  it('the config authToken authenticates too (the Bearer relay shape)', async () => {
    const { home, registered } = mount({}, { authToken: 'tok-deploy' })
    await expect(registered[0]!.isAuthenticated!(home)).resolves.toBe(true)
  })

  it('the scope endpoint file authenticates the scope and moves the stamp', async () => {
    const { home, registered } = mount()
    writeFileSync(join(home, 'endpoint-auth.json'), JSON.stringify({ apiKey: 'sk-scope' }))
    await expect(registered[0]!.isAuthenticated!(home)).resolves.toBe(true)
    await expect(registered[0]!.credentialStamp!(home)).resolves.toBeTypeOf('number')
  })

  it('the scope file outranks the config triple field by field', async () => {
    const { home, registered } = mount({}, { baseUrl: 'https://config.example.com/v1', apiKey: 'sk-deploy' })
    writeFileSync(join(home, 'endpoint-auth.json'), JSON.stringify({ apiKey: 'sk-scope' }))
    // Authenticated by the file; the snapshot still routes the fileless
    // baseUrl field through the config triple.
    await expect(registered[0]!.isAuthenticated!(home)).resolves.toBe(true)
    await expect(registered[0]!.effectiveSettings!(home)).resolves.toMatchObject({ baseUrlHost: 'config.example.com' })
  })

  it('a baseUrl alone is not a credential', async () => {
    const { home, registered } = mount({}, { baseUrl: 'https://relay.example.com' })
    await expect(registered[0]!.isAuthenticated!(home)).resolves.toBe(false)
  })

  it('logout clears the scope file and refuses when only the config carries the credential', async () => {
    const { home, registered } = mount({}, { apiKey: 'sk-deploy' })
    writeFileSync(join(home, 'endpoint-auth.json'), JSON.stringify({ apiKey: 'sk-scope' }))
    await registered[0]!.logout!(home)
    // The file is gone; the config credential still answers the probe.
    await expect(registered[0]!.credentialStamp!(home)).resolves.toBeUndefined()
    await expect(registered[0]!.isAuthenticated!(home)).resolves.toBe(true)
    await expect(registered[0]!.logout!(home)).rejects.toThrow('settings card')
  })
})

describe('local-agent-claude-code endpointAuth face', () => {
  it('reads the resolved per-field state with secrets as booleans', async () => {
    const { home, registered } = mount({}, { baseUrl: 'https://relay.example.com', apiKey: 'sk-deploy' })
    await expect(registered[0]!.endpointAuth!.read(home)).resolves.toEqual({
      baseUrl: 'https://relay.example.com',
      apiKeySet: true,
      authTokenSet: false,
    })
  })

  it('writes edits into the scope file (set, leave, clear) and answers the post-write state', async () => {
    const { home, registered } = mount()
    const face = registered[0]!.endpointAuth!
    await face.write(home, { baseUrl: 'https://relay.example.com', apiKey: 'sk-scope' })
    await expect(face.read(home)).resolves.toEqual({ baseUrl: 'https://relay.example.com', apiKeySet: true, authTokenSet: false })
    // The file on disk carries the credential (0600), never the profile.
    const onDisk = JSON.parse(readFileSync(join(home, 'endpoint-auth.json'), 'utf8')) as Record<string, string>
    expect(onDisk).toEqual({ baseUrl: 'https://relay.example.com', apiKey: 'sk-scope' })
    expect(statSync(join(home, 'endpoint-auth.json')).mode & 0o777).toBe(0o600)
    // Leave apiKey, clear baseUrl.
    await face.write(home, { baseUrl: null })
    await expect(face.read(home)).resolves.toEqual({ apiKeySet: true, authTokenSet: false })
    // Clearing the last field removes the file.
    await face.write(home, { apiKey: null })
    expect(existsSync(join(home, 'endpoint-auth.json'))).toBe(false)
  })
})

describe('local-agent-claude-code /check subcommand', () => {
  function invocation(home: string): never {
    return { agent: { ctx: { localAgent: { homeDir: () => home } } } } as never
  }

  it('replies with the served model list when the saved credential verifies', async () => {
    const { home, registered } = mount({}, { baseUrl: 'https://relay.example.com', apiKey: 'sk-deploy' })
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'claude-a' }] }),
    }))
    const result = await registered[0]!.subcommand!('check', invocation(home)) as { text: string }
    expect(result.text).toBe('Endpoint reachable (https://relay.example.com): 1 model(s) served — claude-a')
    vi.unstubAllGlobals()
  })

  it('tells the user to configure a credential first when none is saved', async () => {
    const { home, registered } = mount()
    vi.stubGlobal('fetch', async () => { throw new Error('must not be called') })
    const result = await registered[0]!.subcommand!('check', invocation(home)) as { text: string }
    expect(result.text).toContain('No endpoint credential')
    vi.unstubAllGlobals()
  })
})

describe('local-agent-claude-code model list', () => {
  it('the harness face reads and writes the scope models.json', async () => {
    const { home, registered } = mount()
    const face = registered[0]!.modelList!
    await expect(face.read(home)).resolves.toEqual([])
    await expect(face.write(home, ['claude-opus-5-5', 'claude-haiku-5-5'])).resolves.toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
    await expect(face.read(home)).resolves.toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
    await expect(face.write(home, [])).resolves.toEqual([])
  })

  it('the list\'s first entry is the default model in the eval snapshot, ahead of the settings key', async () => {
    const { home, registered } = mount({ model: 'settings-model' })
    writeFileSync(join(home, 'models.json'), JSON.stringify({ models: ['claude-opus-5-5', 'claude-haiku-5-5'] }))
    await expect(registered[0]!.effectiveSettings!(home)).resolves.toMatchObject({ model: 'claude-opus-5-5' })
  })

  it('an empty list leaves the settings-key behavior untouched', async () => {
    const { home, registered } = mount({ model: 'settings-model' })
    await expect(registered[0]!.effectiveSettings!(home)).resolves.toMatchObject({ model: 'settings-model' })
  })

  it('the broker\'s memberless surface takes the list as effective and as the whole vocabulary', async () => {
    const { home, registered } = mount()
    writeFileSync(join(home, 'models.json'), JSON.stringify({ models: ['claude-opus-5-5', 'claude-haiku-5-5'] }))
    const info = await registered[0]!.modelBroker!.modelInfo()
    expect(info).toMatchObject({ effective: 'claude-opus-5-5', source: 'settings', choices: ['claude-opus-5-5', 'claude-haiku-5-5'] })
  })

  it('the broker\'s round resolver answers the list first for a member with no override', async () => {
    const { home, resolveModel } = mount()
    writeFileSync(join(home, 'models.json'), JSON.stringify({ models: ['claude-opus-5-5'] }))
    expect(resolveModel('child-x')).toBe('claude-opus-5-5')
    expect(resolveModel('child-x', 'delegation-model')).toBe('delegation-model')
  })
})
