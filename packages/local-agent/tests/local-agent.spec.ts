import { chmodSync, existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as localAgent from '@khorsheed/dsh-local-agent'
import { LOCAL_AGENT_SERVICE, type LocalAgentHarness } from '@khorsheed/dsh-local-agent'
import type { CommandExecution } from '@deepseek-ai/dsh-commands'

/** One temporary directory removed by the OS temp cleaner; tests own its files. */
function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** A fake CLI: a shell script that runs `body` then exits. */
function fakeCli(body: string): string {
  const dir = tempDir('fake-cli-bin-')
  const bin = join(dir, 'fake-cli')
  writeFileSync(bin, `#!/bin/sh\n${body}\n`)
  chmodSync(bin, 0o755)
  return bin
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

/** Mount the real registry stack plus the local-agent core, with one idle agent. */
async function harnessMount(config: localAgent.Config): Promise<{ ctx: Context; agent: Agent; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(localAgent, config)
  const session = ctx.sessions.create(SessionId('local-agent'))
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: undefined as never,
    ctx: new Context(),
    get status() { return 'idle' as const },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return { ctx, agent, session }
}


/** Assert a success execution whose result text contains a fragment. */
function expectSuccess(execution: CommandExecution | undefined, contains: string): void {
  expect(execution?.result).toMatchObject({ kind: 'success' })
  const result = execution?.result
  if (result?.kind === 'success' && result.text !== undefined) expect(result.text).toContain(contains)
}

/** Assert an error execution whose result text contains a fragment. */
function expectError(execution: CommandExecution | undefined, contains: string): void {
  expect(execution?.result).toMatchObject({ kind: 'error' })
  const result = execution?.result
  if (result?.kind === 'error') expect(result.text).toContain(contains)
}

describe('LocalAgentRegistry', () => {
  it('provisions the scoped home, registers the command family, and reports through list/get', async () => {
    const homesRoot = tempDir('local-agent-homes-')
    const { ctx, agent } = await harnessMount({ homesRoot })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness())

    expect(existsSync(join(homesRoot, 'fake'))).toBe(true)
    // Credentials and sessions live in the scoped home: 0700, umask-proof.
    expect(statSync(join(homesRoot, 'fake')).mode & 0o777).toBe(0o700)
    expect(registry.homeDir('fake')).toBe(join(homesRoot, 'fake'))
    expect(registry.list()).toEqual(['fake'])
    expect(registry.get('fake')?.displayName).toBe('Fake Agent')
    expect(ctx.commands.find(agent, 'fake')?.name).toBe('fake')
  })

  it('refuses a duplicate harness name', async () => {
    const { ctx } = await harnessMount({ homesRoot: tempDir('dup-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness())
    expect(() => registry.register(harness())).toThrow(/already registered/)
  })

  it('unregisters the command and harness through the disposer', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('disp-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    const disposer = registry.register(harness())
    disposer()
    expect(registry.list()).toEqual([])
    expect(ctx.commands.find(agent, 'fake')).toBeUndefined()
  })

  it('executes /fake sessions with records from the adapter', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('sess-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({
      records: { listSessions: async () => [
        { id: 's1', workDir: '/w1', title: 'first' },
        { id: 's2', workDir: '/w2' },
      ] },
    }))
    const execution = await ctx.commands.execute(agent, '/fake sessions', new AbortController().signal)
    expectSuccess(execution, 's1 (workDir: /w1)')
  })

  it('renders the empty state when the adapter lists nothing', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('empty-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness())
    const execution = await ctx.commands.execute(agent, '/fake sessions', new AbortController().signal)
    expectSuccess(execution, 'No Fake Agent sessions')
  })

  it('lists the registered harnesses through the family command', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('roster-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({ displayName: 'Fake Agent' }))
    const execution = await ctx.commands.execute(agent, '/local-agent list', new AbortController().signal)
    expectSuccess(execution, 'fake: Fake Agent')
  })

  it('reports authenticated status from the harness probe', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('status-yes-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({ isAuthenticated: async () => true }))
    const execution = await ctx.commands.execute(agent, '/fake status', new AbortController().signal)
    expectSuccess(execution, 'authenticated: yes')
    expectSuccess(execution, 'homeDir:')
  })

  it('reports not authenticated when the harness has no probe', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('status-no-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness())
    const execution = await ctx.commands.execute(agent, '/fake status', new AbortController().signal)
    expectSuccess(execution, 'authenticated: no')
  })

  it('reports the harness login/logout capabilities in the status', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('status-cap-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    // A harness with login and logout (kimi-shaped) reports both.
    registry.register(harness({ logout: async () => {} }))
    let status = await registry.statusOf('fake')
    expect(status).toMatchObject({ loginable: true, logoutable: true })
    // A harness without either (dsh-shaped) reports neither, so surfaces
    // never offer the actions its command family would answer with an error.
    registry.register(harness({ name: 'dshlike', login: undefined, logout: undefined }))
    status = await registry.statusOf('dshlike')
    expect(status).toMatchObject({ loginable: false, logoutable: false })
    void ctx.commands.execute(agent, '/fake status', new AbortController().signal)
  })

  it('rejects an unknown subcommand', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('bogus-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness())
    const execution = await ctx.commands.execute(agent, '/fake bogus', new AbortController().signal)
    expectError(execution, 'Unknown /fake subcommand')
  })

  it('signs out through the harness logout path', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('logout-ok-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    const loggedOut: string[] = []
    registry.register(harness({ logout: async (homeDir: string) => { loggedOut.push(homeDir) } }))
    const execution = await ctx.commands.execute(agent, '/fake logout', new AbortController().signal)
    expectSuccess(execution, 'signed out')
    expect(loggedOut).toHaveLength(1)
    expect(loggedOut[0]).toContain('logout-ok-')
  })

  it('reports a missing logout path instead of guessing', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('logout-none-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness())
    const execution = await ctx.commands.execute(agent, '/fake logout', new AbortController().signal)
    expectError(execution, 'no logout path')
  })

  it('surfaces the device-code prompt and clears the login guard on exit', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-ok-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({
      login: { command: fakeCli('echo "device URL=TEST-URL code=TEST-CODE" >&2\nexit 0'), args: [] },
    }))
    const first = await ctx.commands.execute(agent, '/fake login', new AbortController().signal)
    expectSuccess(first, 'TEST-URL')
    // The guard clears once the polling child exits; a later login starts fresh.
    await new Promise((resolve) => { setTimeout(resolve, 300) })
    const again = await ctx.commands.execute(agent, '/fake login', new AbortController().signal)
    expectSuccess(again, 'TEST-URL')
  })

  it('captures the device-code prompt from stdout when the harness declares it', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-stdout-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({
      login: {
        command: fakeCli('echo "device URL=STDOUT-URL code=STDOUT-CODE"\nexit 0'),
        args: [],
        capture: 'stdout',
      },
    }))
    const result = await ctx.commands.execute(agent, '/fake login', new AbortController().signal)
    expectSuccess(result, 'STDOUT-URL')
  })

  it('replaces a pending login instead of refusing it, and the timeout reaps the silent child', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-pending-'), loginPromptTimeoutMs: 400 })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({ login: { command: fakeCli('sleep 30'), args: [] } }))
    const pending = ctx.commands.execute(agent, '/fake login', new AbortController().signal)
    await new Promise((resolve) => { setTimeout(resolve, 150) })
    // A second login terminates the stale child and starts a fresh one — the
    // user's retry gets a new code instead of being locked out by an
    // abandoned login. The replaced first attempt reports its child was
    // terminated; the replacement itself times out like any silent child.
    const second = await ctx.commands.execute(agent, '/fake login', new AbortController().signal)
    expectError(second, 'printed no device-code prompt')
    const first = await pending
    expectError(first, 'exited with code unknown')
  })

  it('SIGKILLs a replaced login child that ignores SIGTERM', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-sigkill-'), loginPromptTimeoutMs: 400 })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    // A shell that traps TERM and execs sleep (single process): the
    // replacement must fall back to SIGKILL so no zombie polling process
    // survives the grace period.
    registry.register(harness({ login: { command: fakeCli("trap '' TERM\nexec sleep 30"), args: [] } }))
    const pending = ctx.commands.execute(agent, '/fake login', new AbortController().signal)
    await new Promise((resolve) => { setTimeout(resolve, 150) })
    const second = await ctx.commands.execute(agent, '/fake login', new AbortController().signal)
    expectError(second, 'printed no device-code prompt')
    const first = await pending
    expectError(first, 'exited with code unknown')
    // The SIGKILL grace is 5s; wait it out so the hard kill lands before the
    // test ends (the child would otherwise linger as a zombie).
    await new Promise((resolve) => { setTimeout(resolve, 5_200) })
  }, 12_000)

  it('reports a login spawn failure as an error', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-spawn-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({ login: { command: join(tempDir('missing-'), 'no-such-cli'), args: [] } }))
    const execution = await ctx.commands.execute(agent, '/fake login', new AbortController().signal)
    expectError(execution, 'failed to start')
  })

  it('answers a harness without a login flow instead of spawning a CLI', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-none-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    // The dsh harness has no device-code login: it authenticates through the
    // host instance's credentials. /login must answer, never spawn anything.
    registry.register(harness({ login: undefined }))
    const execution = await ctx.commands.execute(agent, '/fake login', new AbortController().signal)
    expectError(execution, 'has no device-code login')
  })

  it('reports a child that exits before printing the prompt', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-exit-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({ login: { command: fakeCli('exit 1'), args: [] } }))
    const execution = await ctx.commands.execute(agent, '/fake login', new AbortController().signal)
    expectError(execution, 'exited with')
  })

  it('fails a silent CLI after the configured prompt timeout', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-timeout-'), loginPromptTimeoutMs: 200 })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({ login: { command: fakeCli('sleep 30'), args: [] } }))
    const execution = await ctx.commands.execute(agent, '/fake login', new AbortController().signal)
    expectError(execution, 'printed no device-code prompt')
  })

  describe('subagentDelegationLabel', () => {
    it('prefixes the description with the harness display name', () => {
      expect(localAgent.subagentDelegationLabel('Kimi Code', '建个文件')).toBe('Kimi Code: 建个文件')
    })

    it('falls back to the display name alone without a description', () => {
      expect(localAgent.subagentDelegationLabel('Kimi Code', undefined)).toBe('Kimi Code')
    })
  })
})
