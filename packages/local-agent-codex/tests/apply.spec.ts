import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { LocalAgentHarness, LocalAgentRegistry } from '@khorsheed/dsh-local-agent'
import { apply } from '../src/index.ts'
import { CodexLiveDriver } from '../src/live-driver.ts'
import type { CodexLiveSettings } from '../src/live-switch.ts'

/** A fake settings service: register captures the scope; set() drives watch. */
function fakeSettings(initial: CodexLiveSettings) {
  let value = initial
  const watchers: ((next: CodexLiveSettings, prev: CodexLiveSettings) => void)[] = []
  const registrations: unknown[] = []
  return {
    registrations,
    service: {
      register: (ns: unknown, schema: unknown, options?: unknown) => {
        registrations.push({ ns, schema, options })
        return {
          get: () => value,
          watch: (cb: (next: CodexLiveSettings, prev: CodexLiveSettings) => void) => {
            watchers.push(cb)
            return () => {}
          },
          update: async () => {},
          replace: async () => {},
        }
      },
    },
    set(next: CodexLiveSettings): void {
      const prev = value
      value = next
      for (const watch of watchers) watch(next, prev)
    },
  }
}

interface Mount {
  ctx: Context
  home: string
  registered: LocalAgentHarness[]
  settings: ReturnType<typeof fakeSettings>
  /** The resolver the provider was constructed with (private face). */
  resolveLive: (childSessionId: string) => CodexLiveDriver | undefined
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
  const settings = fakeSettings({ live: false, liveMirrorGranularity: 'event', ...initial })
  let resolveLive: Mount['resolveLive'] = () => undefined
  ctx.provide('localAgent', registry)
  ctx.provide('logger', { warn: () => {} })
  ctx.provide('subagents', {
    registerProvider: (provider: unknown) => {
      resolveLive = (provider as { live: Mount['resolveLive'] }).live
    },
  })
  ctx.provide('subprocess', { spawn: () => { throw new Error('not spawned in apply test') } })
  ctx.provide('settings', settings.service)
  apply(ctx, config as never)
  return { ctx, home, registered, settings, resolveLive: id => resolveLive(id) }
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
      login: { pty: { command: 'codex', args: ['login'] } },
    })
    // The records adapter is exercised end-to-end by the records spec.
    expect(registered[0]?.records).toBeDefined()
    // The scoped home is provisioned with the file-credential config.
    await new Promise(resolve => setTimeout(resolve, 10))
    const { readFile } = await import('node:fs/promises')
    await expect(readFile(join(home, 'config.toml'), 'utf8')).resolves.toContain('cli_auth_credentials_store = "file"')
  })

  it('registers the settings namespace with the YAML config as the composition base', () => {
    const { settings } = mount()
    expect(settings.registrations).toHaveLength(1)
    const registration = settings.registrations[0] as { ns: unknown; options?: { base?: object } }
    expect(String(registration.ns)).toBe('local-agent-codex')
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
    const { registered } = mount()
    const harness = registered[0]!
    expect(harness.effectiveSettings).toBeTypeOf('function')
    // The snapshot reads the scoped config only for keys the minimal one
    // never writes, so its answer is independent of provisioning timing.
    await expect(harness.effectiveSettings!()).resolves.toEqual({
      drive: 'exec',
      sandbox: 'workspace-write',
      baseUrlSet: false,
    })
  })

  it('reports the configured sandbox policy and the live drive', async () => {
    const { registered } = mount({ live: true }, { sandbox: 'danger-full-access' })
    const harness = registered[0]!
    await expect(harness.effectiveSettings!()).resolves.toMatchObject({
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
    await expect(harness.effectiveSettings!()).resolves.toEqual({
      drive: 'exec',
      sandbox: 'workspace-write',
      reasoningEffort: 'high',
      baseUrlSet: true,
      baseUrlHost: 'proxy.example.com',
    })
  })
})
