import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { ClaudeCliProvider } from '../src/claude-cli-provider.ts'

/** A stub child that emits a minimal stream-json run and exits 0. */
function stubChild(pid: number): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } })}\n`)
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push(null)
  return {
    pid,
    stdin: undefined,
    stdout,
    stderr,
    collected: {
      stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: new Promise<{ exitCode: number; signal: null }>((resolve) => {
      setImmediate(() => { resolve({ exitCode: 0, signal: null }) })
    }),
    terminate: () => undefined,
    waitForExit: async () => true,
  }
}

describe('claude-cli-provider member bridge injection', () => {
  const PARENT = 'parent-1'
  const SOCKET = '/tmp/claude-home/member-bridge.sock'

  function memberRegistry() {
    return {
      homeDir: () => '/tmp/claude-home',
      get: () => ({ displayName: 'Claude Code' }),
      takeDelegationIntent: () => undefined,
      recordDelegation: () => {},
      reportRunProgress: () => {},
      registerMemberRun: vi.fn(() => 'token-xyz-1234'),
      bindMemberRunPid: vi.fn(),
      unregisterMemberRun: vi.fn(),
      memberBridgeSocketPath: () => SOCKET,
      memberBridgeCommand: () => ({ command: 'node', args: ['/bridge.js'] }),
    }
  }

  function request(): SubagentStartRequest {
    return {
      label: '委派',
      prompt: [{ type: 'text', text: 'do the task' }],
      parent: { session: { id: SessionId(PARENT), header: { cwd: '/tmp', delegationDepth: 0 } } },
      signal: new AbortController().signal,
      descriptor: { version: 2, mode: 'one-shot', provider: 'claude-local', label: '委派' },
    } as unknown as SubagentStartRequest
  }

  function mount(registry: Record<string, unknown>): { ctx: Context; spawned: string[][] } {
    const ctx = new Context()
    ctx.provide('localAgent', registry as never)
    const spawned: string[][] = []
    ctx.provide('subprocess', {
      spawn: (spec: { argv: string[] }) => {
        spawned.push(spec.argv)
        return stubChild(4242)
      },
    } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
    return { ctx, spawned }
  }

  /** Assert the injected tail of a spawned argv. */
  function expectMemberArgv(argv: string[]): void {
    const configIndex = argv.indexOf('--mcp-config')
    expect(configIndex).toBeGreaterThan(-1)
    const config = JSON.parse(argv[configIndex + 1]!) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
    }
    expect(config.mcpServers['dsh-member-token-xy']).toEqual({
      command: 'node',
      args: ['/bridge.js'],
      env: { DSH_MEMBER_SOCKET: SOCKET, DSH_MEMBER_TOKEN: 'token-xyz-1234' },
    })
    const toolsIndex = argv.indexOf('--allowedTools')
    expect(toolsIndex).toBeGreaterThan(-1)
    expect(argv[toolsIndex + 1]).toBe('mcp__dsh-member-token-xy__member_message')
  }

  it('appends --mcp-config and --allowedTools to the fresh argv, binds the pid, cleans up at settle', async () => {
    const registry = memberRegistry()
    const { ctx, spawned } = mount(registry)
    const provider = new ClaudeCliProvider(ctx, 'skip')

    const run = await provider.start(request())

    expect(registry.registerMemberRun).toHaveBeenCalledWith({
      childSessionId: expect.any(String),
      parentSessionId: PARENT,
      provider: 'claude-local',
    })
    expect(spawned[0]![0]).toBe('claude')
    expectMemberArgv(spawned[0]!)
    // The flags precede the positional task.
    expect(spawned[0]![spawned[0]!.length - 1]).toBe('do the task')
    expect(registry.bindMemberRunPid).toHaveBeenCalledWith('token-xyz-1234', 4242)

    await run.result
    await vi.waitFor(() => {
      expect(registry.unregisterMemberRun).toHaveBeenCalledWith('token-xyz-1234')
    })
  })

  it('injects the bridge into the resume argv too', async () => {
    const registry = {
      ...memberRegistry(),
      takeDelegationIntent: () => ({ kind: 'resume', childSessionId: 'child-run-1', cliSessionId: 's1' }),
      acquireResumeLock: () => true,
      releaseResumeLock: () => {},
    }
    const { ctx, spawned } = mount(registry)
    const child = Session.create(SessionId('child-run-1'))
    ctx.provide('sessions', { get: (id: SessionId) => (id === SessionId('child-run-1') ? child : undefined) } as never)
    ctx.provide('sessionPersistence', { create: async () => {}, append: async () => {} } as never)
    const provider = new ClaudeCliProvider(ctx, 'skip')

    const run = await provider.start(request())

    expect(registry.registerMemberRun).toHaveBeenCalledWith({
      childSessionId: 'child-run-1',
      parentSessionId: PARENT,
      provider: 'claude-local',
    })
    expect(spawned[0]).toContain('--resume')
    expectMemberArgv(spawned[0]!)

    await run.result
    await vi.waitFor(() => {
      expect(registry.unregisterMemberRun).toHaveBeenCalledWith('token-xyz-1234')
    })
  })

  it('keeps the pre-channel argv when the core predates the member channel', async () => {
    const { ctx, spawned } = mount({
      homeDir: () => '/tmp/claude-home',
      takeDelegationIntent: () => undefined,
      recordDelegation: () => {},
      reportRunProgress: () => {},
    })
    const provider = new ClaudeCliProvider(ctx, 'skip')

    const run = await provider.start(request())

    expect((await run.result).stopReason).toBe('completed')
    expect(spawned[0]).toEqual([
      'claude', '-p', '--dangerously-skip-permissions', '--verbose', '--output-format', 'stream-json', 'do the task',
    ])
  })
})
