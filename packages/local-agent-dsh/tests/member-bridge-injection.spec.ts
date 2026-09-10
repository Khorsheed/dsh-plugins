import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { DshCliProvider } from '../src/dsh-cli-provider.ts'

/** A stub child that prints the final answer, then exits 0. */
function stubChild(pid: number): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push('final answer\n')
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

describe('dsh-cli-provider member bridge injection', () => {
  const PARENT = 'parent-1'
  const SOCKET = '/tmp/dsh-home/member-bridge.sock'

  function memberRegistry(homeDir: string) {
    return {
      homeDir: () => homeDir,
      get: () => undefined,
      takeDelegationIntent: () => undefined,
      recordDelegation: () => {},
      getDelegation: () => undefined,
      recordRoundSettled: () => {},
      reportRunProgress: () => {},
      registerMemberRun: vi.fn(() => 'token-xyz-1234'),
      unregisterMemberRun: vi.fn(),
      memberBridgeSocketPath: () => SOCKET,
      memberBridgeCommand: () => ({ command: 'node', args: ['/bridge.js'] }),
      acquireResumeLock: () => true,
      releaseResumeLock: () => {},
    }
  }

  function request(): SubagentStartRequest {
    return {
      label: '委派',
      prompt: [{ type: 'text', text: 'do the task' }],
      parent: { session: { id: SessionId(PARENT), header: { cwd: '/tmp', delegationDepth: 0 } } },
      signal: new AbortController().signal,
      descriptor: { version: 2, mode: 'one-shot', provider: 'dsh-cli', label: '委派' },
    } as unknown as SubagentStartRequest
  }

  function mount(registry: Record<string, unknown>): {
    ctx: Context
    envs: Readonly<Record<string, string>>[]
  } {
    const ctx = new Context()
    ctx.provide('localAgent', registry as never)
    const envs: Readonly<Record<string, string>>[] = []
    ctx.provide('subprocess', {
      spawn: (spec: { env: Readonly<Record<string, string>> }) => {
        envs.push(spec.env)
        return stubChild(4242)
      },
    } as never)
    ctx.provide('credentials', { resolve: async () => ({ value: 'sk-test', source: 'env' }) } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
    return { ctx, envs }
  }

  it('hands the bridge socket/token/entry to the sub-dsh env, cleans up at settle', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'dsh-member-'))
    const registry = memberRegistry(homeDir)
    const { ctx, envs } = mount(registry)
    const provider = new DshCliProvider(ctx, {})

    const run = await provider.start(request())

    expect(registry.registerMemberRun).toHaveBeenCalledWith({
      childSessionId: expect.any(String),
      parentSessionId: PARENT,
      provider: 'dsh-cli',
    })
    expect(envs[0]).toMatchObject({
      DSH_MEMBER_SOCKET: SOCKET,
      DSH_MEMBER_TOKEN: 'token-xyz-1234',
      DSH_MEMBER_BRIDGE_ENTRY: '/bridge.js',
    })
    await run.result
    await vi.waitFor(() => {
      expect(registry.unregisterMemberRun).toHaveBeenCalledWith('token-xyz-1234')
    })
  })

  it('injects the bridge env on resume rounds too', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'dsh-member-'))
    const registry = {
      ...memberRegistry(homeDir),
      takeDelegationIntent: () => ({ kind: 'resume', childSessionId: 'child-run-1', cliSessionId: 'child-run-1' }),
    }
    const { ctx, envs } = mount(registry)
    const child = Session.create(SessionId('child-run-1'))
    ctx.provide('sessions', { get: (id: SessionId) => (id === SessionId('child-run-1') ? child : undefined) } as never)
    const provider = new DshCliProvider(ctx, {})

    const run = await provider.start(request())

    expect(registry.registerMemberRun).toHaveBeenCalledWith({
      childSessionId: 'child-run-1',
      parentSessionId: PARENT,
      provider: 'dsh-cli',
    })
    expect(envs[0]).toMatchObject({ DSH_MEMBER_TOKEN: 'token-xyz-1234' })

    await run.result
    await vi.waitFor(() => {
      expect(registry.unregisterMemberRun).toHaveBeenCalledWith('token-xyz-1234')
    })
  })

  it('keeps the pre-channel env when the core predates the member channel', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'dsh-member-'))
    const { ctx, envs } = mount({
      homeDir: () => homeDir,
      get: () => undefined,
      takeDelegationIntent: () => undefined,
      recordDelegation: () => {},
      getDelegation: () => undefined,
      recordRoundSettled: () => {},
      reportRunProgress: () => {},
    })
    const provider = new DshCliProvider(ctx, {})

    const run = await provider.start(request())

    expect((await run.result).stopReason).toBe('completed')
    expect(envs[0]).not.toHaveProperty('DSH_MEMBER_TOKEN')
  })
})

describe('headless bundle member-bridge row', () => {
  it('declares the mcp-client row reading the per-run env, fail-open on startup', () => {
    const patch = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../local-agent-dsh-headless/cordis.patch.yml'),
      'utf8',
    )
    expect(patch).toContain("name: '@deepseek-ai/dsh-mcp-client'")
    expect(patch).toContain('serverName: dsh-member')
    expect(patch).toContain('DSH_MEMBER_SOCKET')
    expect(patch).toContain('DSH_MEMBER_TOKEN')
    expect(patch).toContain('DSH_MEMBER_BRIDGE_ENTRY')
    expect(patch).toContain('failOnStartupError: false')
  })
})
