/**
 * Client apply regression: the localAgentGateway Remote declares
 * `status(name, scope?)` and the api-gateway client enforces EXACT arity —
 * the card's status probe must pass the default scope explicitly or the call
 * throws and the auth dot reads unavailable (the 0.1.5 prod outage).
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'

/** One injected card face, captured from the fake slot registry. */
interface InjectedFace {
  auth: { status: (name: string) => Promise<unknown> }
}

describe('client apply: gateway call arity', () => {
  it('status probes pass the default scope explicitly', async () => {
    const status = vi.fn(async () => ({ ok: true as const, value: { name: 'codex', authenticated: true } }))
    const ctx = new Context()
    ctx.provide('locale', { bind: () => vi.fn(), register: vi.fn() } as never)
    ctx.provide('settingsScope', { bind: () => ({}) } as never)
    let injected: InjectedFace | undefined
    ctx.provide('slots', {
      inject: (_name: string, factory: () => void) => { factory() },
      register: (descriptor: { inject: () => InjectedFace }) => { injected = descriptor.inject() },
    } as never)
    ctx.provide('remote.localAgentGateway' as never, { status } as never)
    apply(ctx)
    expect(injected).toBeDefined()
    await injected!.auth.status('codex')
    expect(status).toHaveBeenCalledWith('codex', undefined)
  })
})
