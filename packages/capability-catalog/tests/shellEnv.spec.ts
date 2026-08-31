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

/** Build a skills service that decodes env refs from each row's own content. */
function makeSkills(rows: Array<{ name: string; content?: string }>) {
  return {
    snapshot: async () => ({
      skills: rows.map((r) => ({ name: r.name, invocation: { modelInvocable: true } })),
      complete: true,
    }),
    get: async (name: string) => ({
      content: rows.find((r) => r.name === name)?.content ?? '',
      metadata: {},
    }),
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

  it('never lets a credential take over a reserved built-in DSH_* name', async () => {
    const registrations: Registration[] = []
    // Declaring HOME maps to the built-in DSH_HOME (dropped). Declaring DSH_HOME
    // maps to DSH_DSH_HOME (allowed, no collision). Raw SHELL / SESSION_ID map
    // onto the reserved DSH_SHELL / DSH_SESSION_ID built-ins (dropped).
    const { ctx } = makeFakeCtx({
      shellEnv: makeShellEnv(registrations),
      credentials,
      skills: makeSkills([
        { name: 'home', content: 'use $HOME' },
        { name: 'dshhome', content: 'use $DSH_HOME' },
        { name: 'shell', content: 'use $SHELL' },
        { name: 'sess', content: 'use $SESSION_ID' },
      ]),
    })
    installSkillEnvInjection(ctx, async () => undefined)
    for (let i = 0; i < 12; i++) await Promise.resolve()

    expect(registrations).toHaveLength(1)
    const keys = Object.keys(registrations[0].variables)
    expect(keys).toContain('DSH_DSH_HOME') // DSH_HOME decl allowed (double prefix)
    expect(keys).not.toContain('DSH_HOME') // HOME decl never shadows the built-in
    expect(keys).not.toContain('DSH_SHELL') // raw SHELL dropped
    expect(keys).not.toContain('DSH_SESSION_ID') // raw SESSION_ID dropped
  })
})
