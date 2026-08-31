import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installSkillEnvInjection } from '../src/shellEnv.ts'

interface Registration {
  name: string
  variables: Record<string, { description: string }>
  resolve: (execution: unknown) => Record<string, string>
}

function makeFakeCtx(initial?: Record<string, unknown>) {
  const services: Record<string, unknown> = { ...(initial ?? {}) }
  const ctx = {
    get: (name: string): unknown => services[name],
    on: (): (() => void) => () => {},
  }
  return { ctx: ctx as unknown as Context, services }
}

const credentials = {
  resolve: async () => ({ value: 'secret', source: 'store' }),
}

const skills = {
  snapshot: async () => ({
    skills: [{ name: 'demo', invocation: { modelInvocable: true } }],
    complete: true,
  }),
  get: async () => ({ content: 'use $WEREED_API_KEY', metadata: {} }),
}

function makeShellEnv(registrations: Registration[], throwInactive: () => boolean = () => false) {
  return {
    register: (c: Registration): (() => void) => {
      if (throwInactive()) {
        const err = new Error('cannot create effect on inactive context') as Error & { code: string }
        err.code = 'INACTIVE_EFFECT'
        throw err
      }
      registrations.push(c)
      return () => {}
    },
    list: () => [],
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('installSkillEnvInjection', () => {
  it('registers the contributor with the resolved DSH_ key set', async () => {
    const registrations: Registration[] = []
    const { ctx } = makeFakeCtx({
      shellEnv: makeShellEnv(registrations),
      credentials,
      skills,
    })
    installSkillEnvInjection(ctx, async () => undefined)
    // Flush the async snapshot/get/resolve chain (all immediate promises).
    for (let i = 0; i < 12; i++) await Promise.resolve()

    expect(registrations).toHaveLength(1)
    expect(registrations[0].name).toBe('capability-catalog')
    expect(Object.keys(registrations[0].variables)).toEqual(['DSH_WEREED_API_KEY'])
    expect(registrations[0].resolve(undefined)).toEqual({ DSH_WEREED_API_KEY: 'secret' })
  })

  it('self-recovers when shellEnv is momentarily inactive (boot window) and only registers once it is active', async () => {
    vi.useFakeTimers()
    const registrations: Registration[] = []
    const { ctx, services } = makeFakeCtx() // no services yet -> inactive
    installSkillEnvInjection(ctx, async () => undefined)
    // The initial synchronous pass sees no shellEnv -> schedules a retry.
    expect(registrations).toHaveLength(0)

    services.shellEnv = makeShellEnv(registrations)
    services.credentials = credentials
    services.skills = skills

    await vi.advanceTimersByTimeAsync(300)

    expect(registrations).toHaveLength(1)
    expect(registrations[0].name).toBe('capability-catalog')
  })

  it('re-fetches the active registry right before register and self-retries on INACTIVE_EFFECT', async () => {
    vi.useFakeTimers()
    const registrations: Registration[] = []
    let inactive = true
    const { ctx } = makeFakeCtx({
      shellEnv: makeShellEnv(registrations, () => inactive),
      credentials,
      skills,
    })
    installSkillEnvInjection(ctx, async () => undefined)
    // Flush the async chain up to register; it throws INACTIVE_EFFECT once.
    for (let i = 0; i < 12; i++) await Promise.resolve()
    expect(registrations).toHaveLength(0)

    inactive = false
    await vi.advanceTimersByTimeAsync(300)

    expect(registrations).toHaveLength(1)
    expect(registrations[0].name).toBe('capability-catalog')
  })
})
