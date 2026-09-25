/**
 * Client apply regression: the localAgentGateway Remote declares
 * `status(name, scope?)` and the api-gateway client enforces EXACT arity —
 * the card's status probe must pass the default scope explicitly or the call
 * throws and the auth dot reads unavailable (the 0.1.5 prod outage). Plus the
 * dual-arm settings-surface registration: one arm per host line (alpha.2
 * `plugins.bundle.config` keyed by package name, 0.1.5 `settings.plugin.item`
 * keyed by the settings namespace).
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'

/** One injected card face, captured from the fake slot registry. */
interface InjectedFace {
  auth: { status: (name: string) => Promise<unknown> }
}

/** Boot apply over a registry that fires every inject immediately and records registrations. */
function bench(status: ReturnType<typeof vi.fn>): {
  injectedFaces: InjectedFace[]
  registrations: Array<{ name: string; key: string }>
} {
  const injectedFaces: InjectedFace[] = []
  const registrations: Array<{ name: string; key: string }> = []
  const ctx = new Context()
  ctx.provide('locale', { bind: () => vi.fn(), register: vi.fn() } as never)
  ctx.provide('settingsScope', { bind: () => ({}) } as never)
  ctx.provide('slots', {
    inject: (_name: string, factory: () => void) => { factory() },
    register: (descriptor: { name: string; key: string; inject: () => InjectedFace }) => {
      registrations.push({ name: descriptor.name, key: descriptor.key })
      injectedFaces.push(descriptor.inject())
    },
  } as never)
  ctx.provide('remote.localAgentGateway' as never, { status } as never)
  apply(ctx)
  return { injectedFaces, registrations }
}

describe('client apply: gateway call arity', () => {
  it('status probes pass the default scope explicitly', async () => {
    const status = vi.fn(async () => ({ ok: true as const, value: { name: 'kimi', authenticated: true } }))
    const { injectedFaces } = bench(status)
    expect(injectedFaces.length).toBeGreaterThan(0)
    await injectedFaces[0]!.auth.status('kimi')
    expect(status).toHaveBeenCalledWith('kimi', undefined)
  })
})

describe('client apply: dual-arm settings surfaces', () => {
  it('registers the bundle configuration keyed by package name on the alpha.2 slot', () => {
    const { registrations } = bench(vi.fn())
    expect(registrations).toContainEqual({ name: 'plugins.bundle.config', key: '@khorsheed/dsh-local-agent-kimi' })
  })

  it('registers the settings card keyed by the settings namespace on the 0.1.5 slot', () => {
    const { registrations } = bench(vi.fn())
    expect(registrations).toContainEqual({ name: 'settings.plugin.item', key: 'local-agent-kimi' })
  })
})
