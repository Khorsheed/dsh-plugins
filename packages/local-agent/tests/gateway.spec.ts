import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
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
