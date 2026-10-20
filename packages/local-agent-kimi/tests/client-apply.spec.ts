/**
 * Client apply regression: the localAgentGateway Remote declares
 * `status(name, scope?)` and the api-gateway client enforces EXACT arity —
 * the card's status probe must pass the default scope explicitly or the call
 * throws and the auth dot reads unavailable (the 0.1.5 prod outage). Plus the
 * settings-card registration: a section of the family core's「本机 Agent
 * 委派」card through `localAgentUi.registerHarnessCard` when the core's
 * client provides it, else this package's own `plugins.item` entry — both
 * gated by `configForms.whileServed` on the served `local-agent-kimi`
 * namespace.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'

/** One injected card face, captured from the fake slot registry. */
interface InjectedFace {
  auth: { status: (name: string) => Promise<unknown> }
}

/** One harness-card registration captured from the core's family-card service. */
interface HarnessCardCall {
  name: string
  order: number
  locale: string
  label: () => string
  render: (props: { active: boolean; useSessions: unknown }) => unknown
}

/** A scope stub the dual-line settings-scope probe can arm without throwing. */
function stubScope() {
  return {
    getSnapshot: () => ({ status: 'ready' }),
    subscribe: () => () => {},
    set: vi.fn(),
    unset: vi.fn(),
  }
}

/**
 * Boot apply over a registry that fires every inject immediately and records
 * registrations. `{ served }` boots a configForms host line whose whileServed
 * gate sees exactly that namespace set; 'legacy' boots the 0.1.5 line
 * (settingsScope only, no configForms — the card track must stay silent).
 * `core: 'family'` provides a localAgentUi with registerHarnessCard (the
 * family card exists); `core: 'old'` provides one without it (the pre-family
 * core — the standalone card must register); absent provides no core client.
 */
async function bench(
  status: ReturnType<typeof vi.fn>,
  line: { served: readonly string[]; core?: 'family' | 'old' } | 'legacy',
): Promise<{
  injectedFaces: InjectedFace[]
  registrations: Array<{ name: string; id: string }>
  harnessCards: HarnessCardCall[]
}> {
  const injectedFaces: InjectedFace[] = []
  const registrations: Array<{ name: string; id: string }> = []
  const harnessCards: HarnessCardCall[] = []
  const ctx = new Context()
  ctx.provide('locale', { bind: () => vi.fn(), register: vi.fn() } as never)
  ctx.provide('slots', {
    inject: (_name: string, factory: () => void) => { factory() },
    register: (descriptor: { name: string; id: string; inject: () => InjectedFace }) => {
      registrations.push({ name: descriptor.name, id: descriptor.id })
      injectedFaces.push(descriptor.inject())
    },
  } as never)
  if (line === 'legacy') {
    ctx.provide('settingsScope', { bind: () => stubScope() } as never)
  } else {
    const served = new Set(line.served)
    ctx.provide('configForms', {
      get: () => stubScope(),
      whileServed: (namespaces: readonly string[], register: () => () => void) =>
        namespaces.some(ns => served.has(ns)) ? register() : () => {},
    } as never)
    if (line.core === 'family') {
      ctx.provide('localAgentUi' as never, {
        registerHarnessCard: (entry: HarnessCardCall) => {
          harnessCards.push(entry)
          return () => {}
        },
      } as never)
    } else if (line.core === 'old') {
      ctx.provide('localAgentUi' as never, {} as never)
    }
  }
  ctx.provide('remote.localAgentGateway' as never, { status } as never)
  apply(ctx)
  // The card track and the scope probe ride deferred ctx.inject fibers, which
  // load past a microtask boundary; give them a macrotask to land.
  await new Promise(resolve => setTimeout(resolve, 0))
  return { injectedFaces, registrations, harnessCards }
}

describe('client apply: gateway call arity', () => {
  it('status probes pass the default scope explicitly', async () => {
    const status = vi.fn(async () => ({ ok: true as const, value: { name: 'kimi', authenticated: true } }))
    const { injectedFaces } = await bench(status, { served: ['local-agent-kimi'] })
    expect(injectedFaces.length).toBeGreaterThan(0)
    await injectedFaces[0]!.auth.status('kimi')
    expect(status).toHaveBeenCalledWith('kimi', undefined)
  })
})

describe('client apply: the family-card section', () => {
  it('registers the harness section with the core while the host serves the namespace', async () => {
    const { registrations, harnessCards } = await bench(vi.fn(), { served: ['local-agent-kimi'], core: 'family' })
    expect(registrations).toEqual([])
    expect(harnessCards.map(entry => ({ name: entry.name, order: entry.order, locale: entry.locale })))
      .toEqual([{ name: 'kimi', order: 110, locale: 'local-agent-kimi' }])
  })

  it('the section render builds the card body element from the render props', async () => {
    const { harnessCards } = await bench(vi.fn(), { served: ['local-agent-kimi'], core: 'family' })
    const element = harnessCards[0]!.render({ active: true, useSessions: () => ({}) })
    expect(typeof element).toBe('object')
    expect(element).toBeTruthy()
  })

  it('registers no section when the host serves no such namespace (the row is not composed)', async () => {
    const { registrations, harnessCards } = await bench(vi.fn(), { served: [], core: 'family' })
    expect(registrations).toEqual([])
    expect(harnessCards).toEqual([])
  })
})

describe('client apply: the plugins.item settings card (the pre-family fallback)', () => {
  it('registers the standalone card on an absent core', async () => {
    const { registrations } = await bench(vi.fn(), { served: ['local-agent-kimi'] })
    expect(registrations).toEqual([{ name: 'plugins.item', id: 'local-agent-kimi' }])
  })

  it('registers the standalone card on a core predating the family card (no registerHarnessCard)', async () => {
    const { registrations } = await bench(vi.fn(), { served: ['local-agent-kimi'], core: 'old' })
    expect(registrations).toEqual([{ name: 'plugins.item', id: 'local-agent-kimi' }])
  })

  it('registers no card when the host serves no such namespace (the row is not composed)', async () => {
    const { registrations } = await bench(vi.fn(), { served: [] })
    expect(registrations).toEqual([])
  })

  it('registers no card on the 0.1.5 line (no configForms service)', async () => {
    const { registrations } = await bench(vi.fn(), 'legacy')
    expect(registrations).toEqual([])
  })
})
