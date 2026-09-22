import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import * as localAgent from '@khorsheed/dsh-local-agent'
import { LOCAL_AGENT_SERVICE, type LocalAgentHarness } from '@khorsheed/dsh-local-agent'
import LocalAgentGateway from '../src/gateway.ts'

function tempHome(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** A harness with overridable surface, defaulting to inert login and records. */
function harness(over: Partial<LocalAgentHarness> = {}): LocalAgentHarness {
  return {
    name: 'fake',
    displayName: 'Fake Agent',
    homeEnvVar: 'FAKE_HOME',
    login: { command: 'fake-login', args: [] },
    records: { listSessions: async () => [] },
    ...over,
  }
}

/** Mount the real registry stack plus the core plugin (which registers the gateway). */
async function mount(config: localAgent.Config): Promise<{ ctx: Context; gateway: LocalAgentGateway }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(localAgent, config)
  const gateway = ctx.get('localAgentGateway') as LocalAgentGateway
  return { ctx, gateway }
}

describe('LocalAgentGateway', () => {
  it('routes directory refresh and subscriptions without reading an unrelated member context', async () => {
    const { ctx, gateway } = await mount({ homesRoot: tempHome('gw-directory-') })
    let calls = 0
    const directory = new localAgent.ModelDirectoryCache({ load: async () => {
      calls++
      return { entries: [{ value: 'alias', label: 'Native label', source: 'native' }], complete: true, customInput: true }
    } })
    ctx.localAgent.register(harness({
      delegationProvider: 'fake-cli',
      modelBroker: {
        modelInfo: () => ({ source: 'cli-builtin', choices: [], live: true, switchable: true }),
        setMemberModel: async () => {},
        modelDirectory: (_child, refresh) => refresh ? directory.refresh('fake') : directory.read('fake'),
        followModelDirectory: (_child, signal) => directory.follow('fake', signal),
      },
    }))
    expect(await gateway.memberDirectory('unknown-child', true)).toBeNull()
    expect(await gateway.modelDirectory('fake', 'unknown-child', true)).toBeNull()
    expect(calls).toBe(0)
    expect(await gateway.modelDirectory('fake', undefined, true)).toMatchObject({ status: 'ready', entries: [{ label: 'Native label' }] })
    expect(calls).toBe(1)
    const abort = new AbortController()
    const reader = gateway.followModelDirectory('fake', undefined, abort.signal)[Symbol.asyncIterator]()
    expect((await reader.next()).value?.entries[0]?.value).toBe('alias')
    abort.abort()
    expect((await reader.next()).done).toBe(true)
    directory.dispose()
  })

  it('lists the registered harnesses as roster rows', async () => {
    const { ctx, gateway } = await mount({ homesRoot: tempHome('gw-roster-') })
    ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    ;(ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry).register(harness())
    expect(gateway.roster()).toEqual([{ name: 'fake', displayName: 'Fake Agent' }])
  })

  it('exposes the in-flight delegation ids for one-shot row running state', async () => {
    const { gateway, ctx } = await mount({ homesRoot: tempHome('gw-active-') })
    expect(gateway.activeDelegations()).toEqual([])
    const registry = ctx.localAgent as unknown as {
      trackDelegationRun: (id: string, run: unknown, cancel: () => void) => void
    }
    let settled!: (value: unknown) => void
    const run = { result: new Promise(resolve => { settled = resolve }) }
    registry.trackDelegationRun('child-active-1', run, () => {})
    expect(gateway.activeDelegations()).toEqual(['child-active-1'])
    settled({ stopReason: 'completed' })
    await run.result
    await new Promise(resolve => { setImmediate(resolve) })
    expect(gateway.activeDelegations()).toEqual([])
  })

  it('reports auth status through the harness probe', async () => {
    const { ctx, gateway } = await mount({ homesRoot: tempHome('gw-status-') })
    ;(ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry).register(harness({ isAuthenticated: async () => true }))
    const status = await gateway.status('fake')
    expect(status).toMatchObject({ name: 'fake', authenticated: true })
    expect(status?.homeDir).toContain('gw-status-')
  })

  it('lists all sessions when no dsh session narrows them', async () => {
    const { ctx, gateway } = await mount({ homesRoot: tempHome('gw-sessions-all-') })
    ;(ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry).register(harness({
      records: { listSessions: async () => [
        { id: 's1', workDir: '/project-a' },
        { id: 's2', workDir: '/project-b' },
      ] },
    }))
    const records = await gateway.sessions('fake')
    expect(records).toHaveLength(2)
  })

  it('narrows sessions to the dsh session cwd when one is given', async () => {
    const { ctx, gateway } = await mount({ homesRoot: tempHome('gw-sessions-filter-') })
    ;(ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry).register(harness({
      records: { listSessions: async () => [
        { id: 's1', workDir: '/project-a' },
        { id: 's2', workDir: '/project-b' },
      ] },
    }))
    const session = ctx.sessions.create(SessionId('gw-session'), { meta: { cwd: '/project-a' } })
    const records = await gateway.sessions('fake', session.id)
    expect(records).toEqual([{ id: 's1', workDir: '/project-a' }])
  })

  it('fails loud for an unknown harness', async () => {
    const { ctx, gateway } = await mount({ homesRoot: tempHome('gw-missing-') })
    void ctx
    await expect(gateway.status('nope')).rejects.toThrow(/unknown harness/)
  })
})

describe('LocalAgentGateway member channel', () => {
  const PROVIDER = 'fake-cli'
  const PARENT = 'parent-1'
  const CHILD = 'child-1'

  /** A controllable fake run: settle() resolves run.result; the start signal aborts it. */
  function makeRun(id: string, signal?: AbortSignal): { run: SubagentRun; settle(result: SubagentResult): void } {
    let settle!: (result: SubagentResult) => void
    const result = new Promise<SubagentResult>((resolve) => {
      settle = resolve
      signal?.addEventListener('abort', () => { resolve({ stopReason: 'aborted', output: [] }) })
    })
    return {
      settle,
      run: { id: SessionId(id), localAgent: undefined, result, dispose: () => Promise.resolve() },
    }
  }

  interface MemberHarness {
    ctx: Context
    gateway: LocalAgentGateway
    registry: localAgent.LocalAgentRegistry
    /** Requests the fake subagents provider received. */
    requests: SubagentStartRequest[]
    /** Enter a minimal live parent agent into the real AgentRegistry. */
    enterParent(id: string): void
  }

  /**
   * Mount the gateway stack plus a fake `subagents` service whose provider
   * consumes the staged intent (like the real family providers) and returns a
   * controllable run, and one recorded delegation for CHILD.
   */
  async function mountMember(options: {
    broker?: NonNullable<LocalAgentHarness['modelBroker']>
    observedModel?: string
  } = {}): Promise<MemberHarness> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(AgentRegistry)
    const requests: SubagentStartRequest[] = []
    const h: MemberHarness = {
      ctx,
      gateway: undefined as unknown as LocalAgentGateway,
      registry: undefined as unknown as localAgent.LocalAgentRegistry,
      requests,
      enterParent(id) {
        const sessionId = SessionId(id)
        const agent = { id: sessionId, session: { id: sessionId, header: { id: sessionId } } } as unknown as Agent
        ctx.agents.enter(agent, undefined)
      },
    }
    ctx.provide('subagents', {
      getProvider: (name: string) => name === PROVIDER ? { name } : undefined,
      start: (_name: string, request: SubagentStartRequest) => {
        const intent = h.registry.takeDelegationIntent(request.parent.session.id, PROVIDER)
        return h.registry.withMemberConfigurationRound({ childSessionId: CHILD, parentSessionId: PARENT, provider: PROVIDER, cwd: '/home/user/work' }, async () => {
          requests.push(request)
          return makeRun(CHILD, request.signal).run
        }, request.signal, intent?.onAdmitted)
      },
    })
    await ctx.plugin(localAgent, { homesRoot: tempHome('gw-member-') })
    h.gateway = ctx.get('localAgentGateway') as LocalAgentGateway
    h.registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    h.registry.register(harness({
      name: 'fake',
      delegationProvider: PROVIDER,
      modelBroker: options.broker ?? { modelInfo: () => ({ choices: [], switchable: true }), configurationAdapter: () => ({
        validate: async () => {}, prepare: async () => ({ model: 'fake-model' }), apply: async () => ({ model: 'fake-model' }),
        reconcile: async () => ({ active: false, matches: 'current', resolved: { model: 'fake-model' } }),
      }) },
    }))
    h.registry.recordDelegation({
      childSessionId: CHILD,
      provider: PROVIDER,
      parentSessionId: PARENT,
      cliSessionId: 'cli-42',
      cwd: '/home/user/work',
      ...options.observedModel === undefined ? {} : { observedModel: options.observedModel },
    })
    // A live child session keeps resume off the reattach path (no persistence fake needed).
    ctx.sessions.create(SessionId(CHILD))
    return h
  }

  it('memberOf returns the delegation view for a recorded member', async () => {
    const h = await mountMember()
    expect(h.gateway.memberOf(CHILD)).toEqual({
      childSessionId: CHILD,
      provider: PROVIDER,
      parentSessionId: PARENT,
      harnessDisplayName: 'Fake Agent',
    })
  })

  it('memberOf returns null for an unknown child session', async () => {
    const h = await mountMember()
    expect(h.gateway.memberOf('child-unknown')).toBeNull()
  })

  it('promptMember resumes through the facade with the record\u2019s parent and provider', async () => {
    const h = await mountMember()
    h.enterParent(PARENT)

    const result = await h.gateway.promptMember(CHILD, 'hello member')

    expect(result).toMatchObject({ ok: true, requestId: expect.any(String) })
    await vi.waitFor(() => expect(h.requests).toHaveLength(1))
    // The facade resolved the parent/provider from the record, and the prompt
    // carries only the human text — never the CLI-session resume handle.
    expect(h.requests[0]?.parent.session.id).toBe(PARENT)
    expect(h.requests[0]?.prompt).toEqual([{ type: 'text', text: 'hello member' }])
    expect(JSON.stringify(h.requests[0]?.prompt)).not.toContain('cli-42')
    expect(h.requests[0]?.signal.aborted).toBe(false)
    // The run is tracked, so stopMember finds it.
    expect(h.gateway.stopMember(CHILD)).toBe(true)
  })

  it('promptMember returns a structured error for an unknown child session', async () => {
    const h = await mountMember()
    h.enterParent(PARENT)

    const result = await h.gateway.promptMember('child-unknown', 'hello')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/no delegation recorded/)
    expect(h.requests).toHaveLength(0)
  })

  it('promptMember returns a structured error when the parent agent is not live', async () => {
    const h = await mountMember()

    const result = await h.gateway.promptMember(CHILD, 'hello member')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/no live agent/)
    expect(h.requests).toHaveLength(0)
  })

  it('accepts another input while a round runs and hands it to the same provider FIFO', async () => {
    const h = await mountMember()
    h.enterParent(PARENT)
    expect(await h.gateway.promptMember(CHILD, 'first', 'one')).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(h.requests).toHaveLength(1))
    expect(await h.gateway.promptMember(CHILD, 'second', 'two')).toEqual({ ok: true, requestId: 'two' })
    expect(h.gateway.memberInbox(CHILD).messages.map(row => row.status)).toEqual(['running', 'queued'])
    expect(h.gateway.stopMember(CHILD)).toBe(true)
    await vi.waitFor(() => expect(h.requests).toHaveLength(2))
    expect(h.requests[1]!.prompt).toEqual([{ type: 'text', text: 'second' }])
    h.gateway.stopMember(CHILD)
    await h.ctx.fiber.dispose()
  })

  it('does not accept extra human input into a frozen evaluation member', async () => {
    const h = await mountMember()
    h.enterParent(PARENT)
    h.registry.recordDelegation({ ...h.registry.getDelegation(CHILD)!, configurationLock: 'frozen-condition' })
    expect(await h.gateway.promptMember(CHILD, 'extra input', 'frozen-extra')).toMatchObject({ ok: false, error: expect.stringContaining('Frozen evaluation') })
    expect(h.requests).toHaveLength(0)
    await h.ctx.fiber.dispose()
  })

  it('stopMember aborts the tracked run and reports false on a miss', async () => {
    const h = await mountMember()
    h.enterParent(PARENT)
    expect(h.gateway.stopMember(CHILD)).toBe(false)

    await h.gateway.promptMember(CHILD, 'hello member')
    await vi.waitFor(() => expect(h.requests).toHaveLength(1))
    expect(h.gateway.stopMember(CHILD)).toBe(true)
    expect(h.requests[0]?.signal.aborted).toBe(true)

    expect(h.gateway.stopMember('child-unknown')).toBe(false)
  })

  describe('model surface lastObserved merge', () => {
    /** A broker answer with no lastObserved of its own, overridable. */
    function broker(over: Record<string, unknown> = {}): NonNullable<LocalAgentHarness['modelBroker']> {
      return {
        modelInfo: () => ({
          source: 'cli-builtin' as const,
          choices: [],
          live: false,
          switchable: true,
          ...over,
        }),
        setMemberModel: () => Promise.resolve(),
      }
    }

    it('memberModel fills lastObserved from the delegation record when the broker names none', async () => {
      const h = await mountMember({ broker: broker(), observedModel: 'gpt-5.6-sol' })

      const info = await h.gateway.memberModel(CHILD)

      expect(info).toMatchObject({ source: 'cli-builtin', lastObserved: 'gpt-5.6-sol' })
    })

    it('memberModel never overrides a broker-provided lastObserved', async () => {
      const h = await mountMember({ broker: broker({ lastObserved: 'broker-model' }), observedModel: 'record-model' })

      const info = await h.gateway.memberModel(CHILD)

      expect(info?.lastObserved).toBe('broker-model')
    })

    it('memberModel carries no lastObserved when neither the broker nor the record observed one', async () => {
      const h = await mountMember({ broker: broker() })

      const info = await h.gateway.memberModel(CHILD)

      expect(info?.lastObserved).toBeUndefined()
    })

    it('harnessModel fills lastObserved with the provider’s latest observed model', async () => {
      const h = await mountMember({ broker: broker(), observedModel: 'model-old' })
      h.registry.recordDelegation({
        childSessionId: 'child-2',
        provider: PROVIDER,
        parentSessionId: PARENT,
        cliSessionId: 'cli-43',
        observedModel: 'model-new',
      })

      const info = await h.gateway.harnessModel('fake')

      expect(info).toMatchObject({ source: 'cli-builtin', lastObserved: 'model-new' })
    })

    it('harnessModel skips the fill for a harness without a delegation provider', async () => {
      const h = await mountMember({ broker: broker(), observedModel: 'model-old' })
      h.registry.register(harness({ name: 'plain', modelBroker: broker() }))

      const info = await h.gateway.harnessModel('plain')

      expect(info?.lastObserved).toBeUndefined()
    })

    it('memberModel appends lastObserved to an empty pick list (a member that ran once has a one-item menu)', async () => {
      const h = await mountMember({ broker: broker(), observedModel: 'gpt-5.6-sol' })

      const info = await h.gateway.memberModel(CHILD)

      expect(info?.choices).toEqual(['gpt-5.6-sol'])
    })

    it('memberModel appends lastObserved LAST, after the broker’s own choices', async () => {
      const h = await mountMember({ broker: broker({ choices: ['model-a', 'model-b'] }), observedModel: 'gpt-5.6-sol' })

      const info = await h.gateway.memberModel(CHILD)

      expect(info?.choices).toEqual(['model-a', 'model-b', 'gpt-5.6-sol'])
    })

    it('memberModel never duplicates a lastObserved the broker already lists', async () => {
      const h = await mountMember({ broker: broker({ choices: ['model-a', 'gpt-5.6-sol'] }), observedModel: 'gpt-5.6-sol' })

      const info = await h.gateway.memberModel(CHILD)

      expect(info?.choices).toEqual(['model-a', 'gpt-5.6-sol'])
    })

    it('memberModel appends a broker-provided lastObserved too', async () => {
      const h = await mountMember({ broker: broker({ lastObserved: 'broker-model' }) })

      const info = await h.gateway.memberModel(CHILD)

      expect(info?.choices).toEqual(['broker-model'])
    })

    it('harnessModel appends lastObserved to the pick list as well', async () => {
      const h = await mountMember({ broker: broker(), observedModel: 'model-old' })

      const info = await h.gateway.harnessModel('fake')

      expect(info?.choices).toEqual(['model-old'])
    })

    it('the pick list stays empty when nothing observed a model', async () => {
      const h = await mountMember({ broker: broker() })

      const info = await h.gateway.memberModel(CHILD)

      expect(info?.choices).toEqual([])
    })
  })
})
