import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as localAgent from '@khorsheed/dsh-local-agent'
import { LOCAL_AGENT_SERVICE, type LocalAgentHarness } from '@khorsheed/dsh-local-agent'
import type { CommandExecution } from '@deepseek-ai/dsh-commands'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'

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
    const execution = await ctx.commands.execute(agent, '/fake sessions', [], new AbortController().signal)
    expectSuccess(execution, 's1 (workDir: /w1)')
  })

  it('renders the empty state when the adapter lists nothing', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('empty-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness())
    const execution = await ctx.commands.execute(agent, '/fake sessions', [], new AbortController().signal)
    expectSuccess(execution, 'No Fake Agent sessions')
  })

  it('lists the registered harnesses through the family command', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('roster-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({ displayName: 'Fake Agent' }))
    const execution = await ctx.commands.execute(agent, '/local-agent list', [], new AbortController().signal)
    expectSuccess(execution, 'fake: Fake Agent')
  })

  it('the /local-agent stop command cancels an in-flight delegation by child session id', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('stop-hit-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    let cancelled = 0
    let settle!: (result: SubagentResult) => void
    const run: SubagentRun = {
      id: SessionId('child-1'),
      localAgent: undefined,
      result: new Promise((resolve) => { settle = resolve }),
      dispose: () => Promise.resolve(),
    }
    registry.trackDelegationRun('child-1', run, () => { cancelled += 1 })
    expect(registry.isDelegationActive('child-1')).toBe(true)

    const execution = await ctx.commands.execute(agent, '/local-agent stop child-1', [], new AbortController().signal)
    expectSuccess(execution, 'stop requested for child session child-1')
    expect(cancelled).toBe(1)
    // The run settles afterwards (any stop reason) and clears the registry.
    settle({ stopReason: 'aborted', output: [] })
    await run.result
    await Promise.resolve()
    expect(registry.isDelegationActive('child-1')).toBe(false)
  })

  it('the /local-agent stop command accepts an absent target as an explicit no-op', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('stop-miss-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    const execution = await ctx.commands.execute(agent, '/local-agent stop ghost', [], new AbortController().signal)
    expectSuccess(execution, 'child session ghost has no in-flight local-agent run to stop')
    const usage = await ctx.commands.execute(agent, '/local-agent stop', [], new AbortController().signal)
    expectError(usage, 'usage: /local-agent stop <childSessionId>')
    const unknown = await ctx.commands.execute(agent, '/local-agent bogus', [], new AbortController().signal)
    expectError(unknown, 'Unknown /local-agent subcommand')
  })

  it('reports authenticated status from the harness probe', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('status-yes-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({ isAuthenticated: async () => true }))
    const execution = await ctx.commands.execute(agent, '/fake status', [], new AbortController().signal)
    expectSuccess(execution, 'authenticated: yes')
    expectSuccess(execution, 'homeDir:')
  })

  it('reports not authenticated when the harness has no probe', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('status-no-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness())
    const execution = await ctx.commands.execute(agent, '/fake status', [], new AbortController().signal)
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
    void ctx.commands.execute(agent, '/fake status', [], new AbortController().signal)
  })

  it('rejects an unknown subcommand', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('bogus-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness())
    const execution = await ctx.commands.execute(agent, '/fake bogus', [], new AbortController().signal)
    expectError(execution, 'Unknown /fake subcommand')
  })

  it('signs out through the harness logout path', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('logout-ok-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    const loggedOut: string[] = []
    registry.register(harness({ logout: async (homeDir: string) => { loggedOut.push(homeDir) } }))
    const execution = await ctx.commands.execute(agent, '/fake logout', [], new AbortController().signal)
    expectSuccess(execution, 'signed out')
    expect(loggedOut).toHaveLength(1)
    expect(loggedOut[0]).toContain('logout-ok-')
  })

  it('reports a missing logout path instead of guessing', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('logout-none-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness())
    const execution = await ctx.commands.execute(agent, '/fake logout', [], new AbortController().signal)
    expectError(execution, 'no logout path')
  })

  it('surfaces the device-code prompt and clears the login guard on exit', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-ok-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({
      login: { command: fakeCli('echo "device URL=TEST-URL code=TEST-CODE" >&2\nexit 0'), args: [] },
    }))
    const first = await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
    expectSuccess(first, 'TEST-URL')
    // The guard clears once the polling child exits; a later login starts fresh.
    await new Promise((resolve) => { setTimeout(resolve, 300) })
    const again = await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
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
    const result = await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
    expectSuccess(result, 'STDOUT-URL')
  })

  it('replaces a pending login instead of refusing it, and the timeout reaps the silent child', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-pending-'), loginPromptTimeoutMs: 400 })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({ login: { command: fakeCli('sleep 30'), args: [] } }))
    const pending = ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
    await new Promise((resolve) => { setTimeout(resolve, 150) })
    // A second login terminates the stale child and starts a fresh one — the
    // user's retry gets a new code instead of being locked out by an
    // abandoned login. The replaced first attempt reports its child was
    // terminated; the replacement itself times out like any silent child.
    const second = await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
    expectError(second, 'printed no device-code prompt')
    const first = await pending
    // The replaced login's error text is platform-timing dependent: where
    // /bin/sh is dash (Linux), a sh waiting on a foreground child defers
    // SIGTERM until the child exits, so the replaced login's own prompt
    // timeout fires first ('printed no device-code prompt'); where sh is
    // bash (macOS), the SIGTERM kills it immediately ('exited with code
    // unknown'). Both prove the replacement happened.
    expect(first?.result).toMatchObject({ kind: 'error' })
    const firstResult = first?.result
    const firstText = firstResult?.kind === 'error' ? firstResult.text : ''
    expect(
      ['exited with code unknown', 'printed no device-code prompt'].some((fragment) => firstText.includes(fragment)),
    ).toBe(true)
  })

  it('SIGKILLs a replaced login child that ignores SIGTERM', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-sigkill-'), loginPromptTimeoutMs: 400 })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    // A shell that traps TERM and execs sleep (single process): the
    // replacement must fall back to SIGKILL so no zombie polling process
    // survives the grace period.
    registry.register(harness({ login: { command: fakeCli("trap '' TERM\nexec sleep 30"), args: [] } }))
    const pending = ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
    await new Promise((resolve) => { setTimeout(resolve, 150) })
    const second = await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
    expectError(second, 'printed no device-code prompt')
    const first = await pending
    // Which error the replaced login reports is platform-timing dependent:
    // once the child has installed its TERM trap it outlives the
    // replacement's SIGTERM and only dies to the SIGKILL after the 5s grace —
    // far past its own 400ms prompt timeout, so it reports the timeout; a
    // child still starting up dies to the SIGTERM itself. Both prove the
    // replacement happened; the zombie reaping is what this test guards.
    expect(first?.result).toMatchObject({ kind: 'error' })
    const firstResult = first?.result
    const firstText = firstResult?.kind === 'error' ? firstResult.text : ''
    expect(
      ['exited with code unknown', 'printed no device-code prompt'].some((fragment) => firstText.includes(fragment)),
    ).toBe(true)
    // The SIGKILL grace is 5s; wait it out so the hard kill lands before the
    // test ends (the child would otherwise linger as a zombie).
    await new Promise((resolve) => { setTimeout(resolve, 5_200) })
  }, 12_000)

  it('reports a login spawn failure as an error', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-spawn-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({ login: { command: join(tempDir('missing-'), 'no-such-cli'), args: [] } }))
    const execution = await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
    expectError(execution, 'failed to start')
  })

  it('answers a harness without a login flow instead of spawning a CLI', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-none-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    // The dsh harness has no device-code login: it authenticates through the
    // host instance's credentials. /login must answer, never spawn anything.
    registry.register(harness({ login: undefined }))
    const execution = await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
    expectError(execution, 'has no device-code login')
  })

  it('reports a child that exits before printing the prompt', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-exit-') })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({ login: { command: fakeCli('exit 1'), args: [] } }))
    const execution = await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
    expectError(execution, 'exited with')
  })

  it('fails a silent CLI after the configured prompt timeout', async () => {
    const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-timeout-'), loginPromptTimeoutMs: 200 })
    const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
    registry.register(harness({ login: { command: fakeCli('sleep 30'), args: [] } }))
    const execution = await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
    expectError(execution, 'printed no device-code prompt')
  })

  describe('manual login variant', () => {
    /** A harness on the manual flow with a controllable credential probe. */
    function manualHarness(probe: (homeDir: string) => Promise<boolean>): LocalAgentHarness {
      return harness({
        login: { manual: { commandDisplay: 'env -u X CLAUDE_CONFIG_DIR=<home> claude auth login' } },
        isAuthenticated: probe,
      })
    }

    it('replies with the terminal instructions and spawns nothing', async () => {
      const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-manual-') })
      const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
      const probe = vi.fn(async () => true)
      registry.register(manualHarness(probe))

      const execution = await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)

      expectSuccess(execution, 'claude auth login')
      expectSuccess(execution, 'interactive terminal')
      // The manual declaration carries no spawnable command at all — a
      // success reply (not a spawn failure) proves nothing was spawned.
    })

    it('watches the probe and stops when the credential lands', async () => {
      vi.useFakeTimers()
      try {
        const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-manual-ok-') })
        const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
        let authenticated = false
        const probe = vi.fn(async () => authenticated)
        registry.register(manualHarness(probe))
        await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)

        await vi.advanceTimersByTimeAsync(localAgent.MANUAL_LOGIN_POLL_MS)
        const before = probe.mock.calls.length
        expect(before).toBeGreaterThan(0)
        // The credential lands; the watch sees it and stops polling.
        authenticated = true
        await vi.advanceTimersByTimeAsync(localAgent.MANUAL_LOGIN_POLL_MS * 2)
        const atSuccess = probe.mock.calls.length
        expect(atSuccess).toBeGreaterThan(before)
        await vi.advanceTimersByTimeAsync(localAgent.MANUAL_LOGIN_POLL_MS * 3)
        expect(probe.mock.calls.length).toBe(atSuccess)
      } finally {
        vi.useRealTimers()
      }
    })

    it('stops watching when the login window expires without a credential', async () => {
      vi.useFakeTimers()
      try {
        const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-manual-timeout-') })
        const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
        const probe = vi.fn(async () => false)
        registry.register(manualHarness(probe))
        await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)

        await vi.advanceTimersByTimeAsync(localAgent.MANUAL_LOGIN_LIMIT_MS + localAgent.MANUAL_LOGIN_POLL_MS * 2)
        const atTimeout = probe.mock.calls.length
        expect(atTimeout).toBeGreaterThan(0)
        await vi.advanceTimersByTimeAsync(localAgent.MANUAL_LOGIN_POLL_MS * 3)
        expect(probe.mock.calls.length).toBe(atTimeout)
      } finally {
        vi.useRealTimers()
      }
    })

    it('a second login replaces the first watch (single-watch poll rate)', async () => {
      vi.useFakeTimers()
      try {
        const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-manual-replace-') })
        const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
        const probe = vi.fn(async () => false)
        registry.register(manualHarness(probe))

        await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
        await vi.advanceTimersByTimeAsync(localAgent.MANUAL_LOGIN_POLL_MS * 4)
        const firstWatchCalls = probe.mock.calls.length
        expect(firstWatchCalls).toBeGreaterThan(0)

        // The retry replaces the watch: polling continues at ONE watch's
        // rate — two stacked watches would double the calls per window.
        await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
        await vi.advanceTimersByTimeAsync(localAgent.MANUAL_LOGIN_POLL_MS * 4)
        const secondWindow = probe.mock.calls.length - firstWatchCalls
        expect(secondWindow).toBe(firstWatchCalls)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not conclude success from a stale credential marker', async () => {
      vi.useFakeTimers()
      try {
        const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-manual-stale-') })
        const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
        const watchStart = Date.now()
        // A revoked token's leftover marker: presence says true, but the
        // stamp predates this watch — no fresh login happened.
        let stamp: number | undefined = watchStart - 60_000
        const probe = vi.fn(async () => true)
        registry.register({
          ...manualHarness(probe),
          credentialStamp: async () => stamp,
        })
        await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)

        await vi.advanceTimersByTimeAsync(localAgent.MANUAL_LOGIN_POLL_MS * 3)
        const polling = probe.mock.calls.length
        expect(polling).toBeGreaterThan(0)
        // Still polling after several ticks: the stale marker did not finish
        // the watch. (A concluded watch stops the interval.)
        await vi.advanceTimersByTimeAsync(localAgent.MANUAL_LOGIN_POLL_MS * 3)
        expect(probe.mock.calls.length).toBeGreaterThan(polling)

        // A real re-login rewrites the marker; the watch now concludes.
        stamp = Date.now()
        const before = probe.mock.calls.length
        await vi.advanceTimersByTimeAsync(localAgent.MANUAL_LOGIN_POLL_MS * 2)
        const atSuccess = probe.mock.calls.length
        expect(atSuccess).toBeGreaterThan(before)
        await vi.advanceTimersByTimeAsync(localAgent.MANUAL_LOGIN_POLL_MS * 3)
        expect(probe.mock.calls.length).toBe(atSuccess)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('pty login variant', () => {
    /** A fake subprocess seam whose spawnTerminal returns a controllable terminal. */
    function fakeTerminal(output: string, written: string[]): {
      spawnTerminal: (spec: { argv: readonly string[] }) => unknown
      finish: () => void
    } {
      let finish!: () => void
      const done = new Promise<{ exitCode: number }>((resolve) => { finish = () => { resolve({ exitCode: 0 }) } })
      return {
        finish,
        spawnTerminal: () => ({
          pid: 7777,
          output: Readable.from([output]),
          done,
          write: async (data: string) => { written.push(data) },
          terminate: async () => {},
        }),
      }
    }

    it('spawns the CLI on a pty, surfaces the OAuth URL, and delivers the pasted code', async () => {
      const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-pty-'), loginPromptTimeoutMs: 5_000 })
      const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
      const written: string[] = []
      ctx.provide('subprocess', fakeTerminal('Opening browser to sign in https://example.com/oauth?x=1\r\n', written) as never)
      registry.register(harness({
        login: { pty: { command: 'fake-cli', args: ['auth', 'login'] } },
        records: { listSessions: async () => [] },
      }))

      const execution = await ctx.commands.execute(agent, '/fake login', [], new AbortController().signal)
      expectSuccess(execution, 'https://example.com/oauth?x=1')
      expectSuccess(execution, '/fake code')
      expect((await registry.statusOf('fake')).loginAwaitingCode).toBe(true)

      const codeResult = await ctx.commands.execute(agent, '/fake code abc123', [], new AbortController().signal)
      expectSuccess(codeResult, 'code')
      expect(written).toEqual(['abc123\r'])
    })

    it('rejects a code submission with no pending pty login', async () => {
      const { ctx, agent } = await harnessMount({ homesRoot: tempDir('login-pty-none-') })
      const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
      registry.register(harness({ records: { listSessions: async () => [] } }))
      const result = await ctx.commands.execute(agent, '/fake code abc123', [], new AbortController().signal)
      expectError(result, '没有等待授权 code')
    })
  })

  describe('auth failure marks', () => {    /** A harness whose probe and stamp the test controls directly. */
    function stampedHarness(state: { authenticated: boolean; stamp: number | undefined }): LocalAgentHarness {
      return harness({
        isAuthenticated: async () => state.authenticated,
        credentialStamp: async () => state.stamp,
      })
    }

    it('downgrades a present-but-rejected credential until the marker is rewritten', async () => {
      const { ctx } = await harnessMount({ homesRoot: tempDir('auth-mark-') })
      const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
      const state = { authenticated: true, stamp: Date.now() - 60_000 }
      registry.register(stampedHarness(state))

      expect((await registry.statusOf('fake')).authenticated).toBe(true)

      // A delegation hits a 401 the presence probe cannot see: the status
      // downgrades even though the credential marker still exists.
      registry.reportAuthFailure('fake', '401 OAuth access token has been revoked')
      expect((await registry.statusOf('fake')).authenticated).toBe(false)

      // A real re-login rewrites the marker (stamp newer than the mark): the
      // status recovers without any explicit clearing.
      state.stamp = Date.now() + 1_000
      expect((await registry.statusOf('fake')).authenticated).toBe(true)
    })
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
