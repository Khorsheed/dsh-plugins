import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { LocalAgentHarness, LocalAgentRegistry } from '@khorsheed/dsh-local-agent'
import { apply } from '../src/index.ts'
import { KimiAcpLiveDriver } from '../src/live-driver.ts'
import type { KimiLiveSettings } from '../src/live-switch.ts'

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
  /** The resolver the provider was constructed with (private face). */
  resolveLive: (childSessionId: string) => KimiAcpLiveDriver | undefined
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
  return { ctx, registered, settings, resolveLive: id => resolveLive(id) }
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
})
