import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { CodexCliProvider } from '../src/codex-cli-provider.ts'

/** A stub child that emits a minimal `--json` run and exits 0. */
function stubChild(pid: number): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push([
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 1 } }),
  ].join('\n') + '\n')
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

describe('codex-cli-provider member bridge injection', () => {
  const PARENT = 'parent-1'
  const SOCKET = '/tmp/codex-home/member-bridge.sock'
  const EXPECTED_OVERRIDE = 'mcp_servers.dsh-member-token-xy={'
    + 'command="node",args=["/bridge.js"],'
    + `env={DSH_MEMBER_SOCKET="${SOCKET}",DSH_MEMBER_TOKEN="token-xyz-1234"},`
    + 'default_tools_approval_mode="approve"'
    + '}'

  function memberRegistry() {
    return {
      homeDir: () => '/tmp/codex-home',
      get: () => ({ displayName: 'Codex' }),
      takeDelegationIntent: () => undefined,
      recordDelegation: () => {},
      getDelegation: () => undefined,
      recordRoundSettled: () => {},
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
      descriptor: { version: 2, mode: 'one-shot', provider: 'codex-local', label: '委派' },
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

  it('appends the -c bridge override to the fresh argv, binds the pid, cleans up at settle', async () => {
    const registry = memberRegistry()
    const { ctx, spawned } = mount(registry)
    const provider = new CodexCliProvider(ctx)

    const run = await provider.start(request())

    expect(registry.registerMemberRun).toHaveBeenCalledWith({
      childSessionId: expect.any(String),
      parentSessionId: PARENT,
      provider: 'codex-local',
    })
    expect(spawned[0]).toEqual([
      'codex', 'exec', '-c', EXPECTED_OVERRIDE, '--sandbox', 'workspace-write', '--json', 'do the task',
    ])
    expect(registry.bindMemberRunPid).toHaveBeenCalledWith('token-xyz-1234', 4242)

    await run.result
    await vi.waitFor(() => {
      expect(registry.unregisterMemberRun).toHaveBeenCalledWith('token-xyz-1234')
    })
  })

  it('injects the bridge into the resume argv too (codex exec resume accepts -c)', async () => {
    const registry = {
      ...memberRegistry(),
      takeDelegationIntent: () => ({ kind: 'resume', childSessionId: 'child-run-1', cliSessionId: 'thread-1' }),
      acquireResumeLock: () => true,
      releaseResumeLock: () => {},
    }
    const { ctx, spawned } = mount(registry)
    const child = Session.create(SessionId('child-run-1'))
    ctx.provide('sessions', { get: (id: SessionId) => (id === SessionId('child-run-1') ? child : undefined) } as never)
    ctx.provide('sessionPersistence', { create: async () => {}, append: async () => {} } as never)
    const provider = new CodexCliProvider(ctx)

    const run = await provider.start(request())

    expect(registry.registerMemberRun).toHaveBeenCalledWith({
      childSessionId: 'child-run-1',
      parentSessionId: PARENT,
      provider: 'codex-local',
    })
    expect(spawned[0]).toEqual([
      'codex', 'exec', '-c', EXPECTED_OVERRIDE, '--sandbox', 'workspace-write', '--json', 'resume', 'thread-1', 'do the task',
    ])

    await run.result
    await vi.waitFor(() => {
      expect(registry.unregisterMemberRun).toHaveBeenCalledWith('token-xyz-1234')
    })
  })

  it('keeps the pre-channel argv when the core predates the member channel', async () => {
    const { ctx, spawned } = mount({
      homeDir: () => '/tmp/codex-home',
      takeDelegationIntent: () => undefined,
      recordDelegation: () => {},
      reportRunProgress: () => {},
    })
    const provider = new CodexCliProvider(ctx)

    const run = await provider.start(request())

    expect((await run.result).stopReason).toBe('completed')
    expect(spawned[0]).toEqual(['codex', 'exec', '--sandbox', 'workspace-write', '--json', 'do the task'])
  })
})
