import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
  it('lists the registered harnesses as roster rows', async () => {
    const { ctx, gateway } = await mount({ homesRoot: tempHome('gw-roster-') })
    ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    ;(ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry).register(harness())
    expect(gateway.roster()).toEqual([{ name: 'fake', displayName: 'Fake Agent' }])
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
  async function mountMember(): Promise<MemberHarness> {
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
        requests.push(request)
        h.registry.takeDelegationIntent(request.parent.session.id, PROVIDER)
        return Promise.resolve(makeRun(CHILD, request.signal).run)
      },
    })
    await ctx.plugin(localAgent, { homesRoot: tempHome('gw-member-') })
    h.gateway = ctx.get('localAgentGateway') as LocalAgentGateway
    h.registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    h.registry.register(harness({ name: 'fake', delegationProvider: PROVIDER }))
    h.registry.recordDelegation({ childSessionId: CHILD, provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-42' })
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

    expect(result).toEqual({ ok: true })
    expect(h.requests).toHaveLength(1)
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

  it('promptMember returns a structured error while a resume is in flight', async () => {
    const h = await mountMember()
    h.enterParent(PARENT)
    expect(h.registry.acquireResumeLock(CHILD)).toBe(true)

    const result = await h.gateway.promptMember(CHILD, 'hello member')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/in-flight resume/)
    expect(h.requests).toHaveLength(0)
    h.registry.releaseResumeLock(CHILD)
  })

  it('stopMember aborts the tracked run and reports false on a miss', async () => {
    const h = await mountMember()
    h.enterParent(PARENT)
    expect(h.gateway.stopMember(CHILD)).toBe(false)

    await h.gateway.promptMember(CHILD, 'hello member')
    expect(h.gateway.stopMember(CHILD)).toBe(true)
    expect(h.requests[0]?.signal.aborted).toBe(true)

    expect(h.gateway.stopMember('child-unknown')).toBe(false)
  })
})
