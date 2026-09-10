/**
 * Container exec target: the same codex round, spawned through `docker exec`
 * inside a unit the caller acquired. The transport is the only thing that
 * changes — these assertions pin the argv shape on both drives, the NAME-only
 * env forwarding, and the two things a containerized round deliberately gives
 * up (the member channel, and any chance of guessing the scoped home).
 */
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { CodexCliProvider } from '../src/codex-cli-provider.ts'

/** A stub child that emits a minimal `--json` run and exits 0. */
function stubChild(): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push([
    JSON.stringify({ type: 'thread.started', thread_id: 't-container' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '4' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 1 } }),
  ].join('\n') + '\n')
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push(null)
  return {
    pid: 4242,
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

const PARENT = 'parent-1'
const CHILD = 'child-1'
const HOME = '/host/scoped/codex'
const TARGET = { container: 'dsh-lab-unit', workdir: '/workspace', env: { CODEX_HOME: '/creds/codex' } }

function request(): SubagentStartRequest {
  return {
    label: '委派',
    prompt: [{ type: 'text', text: '回答 2+2' }],
    parent: { session: { id: SessionId(PARENT), header: { cwd: '/tmp', delegationDepth: 0 } } },
    signal: new AbortController().signal,
    descriptor: { version: 2, mode: 'one-shot', provider: 'codex-local', label: '委派' },
  } as unknown as SubagentStartRequest
}

function mount(intent: unknown, extra?: Record<string, unknown>): {
  provider: CodexCliProvider
  specs: SubprocessSpawnSpec[]
} {
  const ctx = new Context()
  const specs: SubprocessSpawnSpec[] = []
  const liveChild = Session.create(SessionId(CHILD))
  liveChild.append('turn/start', { turn: 1 })
  liveChild.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  ctx.provide('sessions', {
    create: (id: SessionId) => Session.create(id),
    get: (id: SessionId) => (id === SessionId(CHILD) ? liveChild : undefined),
  } as never)
  ctx.provide('localAgent', {
    homeDir: () => HOME,
    get: () => ({ displayName: 'Codex' }),
    takeDelegationIntent: () => intent,
    recordDelegation: () => {},
    getDelegation: () => undefined,
    recordRoundSettled: () => {},
    reportRunProgress: () => {},
    acquireResumeLock: () => true,
    releaseResumeLock: () => {},
    // A member channel IS available on this core — the container path must
    // decline it on purpose, not because the core lacks one.
    registerMemberRun: vi.fn(() => 'token-xyz-1234'),
    unregisterMemberRun: vi.fn(),
    memberBridgeSocketPath: () => '/host/member.sock',
    memberBridgeCommand: () => ({ command: 'node', args: ['/host/bridge.js'] }),
    ...extra,
  } as never)
  ctx.provide('subprocess', {
    spawn: (spec: SubprocessSpawnSpec) => {
      specs.push(spec)
      return stubChild()
    },
  } as never)
  ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
  return { provider: new CodexCliProvider(ctx, 'read-only'), specs }
}

describe('codex container exec target', () => {
  it('wraps the fresh argv in docker exec and forwards the scoped home by name', async () => {
    const { provider, specs } = mount({ kind: 'fresh', exec: TARGET })
    const run = await provider.start(request())
    await run.result
    expect(specs[0]?.argv).toEqual([
      'docker', 'exec', '-w', '/workspace', '-e', 'CODEX_HOME', 'dsh-lab-unit',
      'codex', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', '回答 2+2',
    ])
    // The value travels in the docker CLIENT's env, and it is the caller's
    // in-container path — never the host scoped home it would otherwise be.
    expect(specs[0]?.env?.['CODEX_HOME']).toBe('/creds/codex')
    expect(specs[0]?.argv).not.toContain(HOME)
    // The host cwd is now the docker client's working directory.
    expect(specs[0]?.cwd).toBe('/tmp')
    // No member bridge across the boundary: the socket is a host unix socket
    // and the MCP declaration names a host node path.
    expect(specs[0]?.argv).not.toContain('-c')
    await run.dispose()
  })

  it('leaves the host argv byte-for-byte unchanged without a target', async () => {
    const { provider, specs } = mount({ kind: 'fresh' })
    const run = await provider.start(request())
    await run.result
    expect(specs[0]?.argv?.[0]).toBe('codex')
    expect(specs[0]?.env?.['CODEX_HOME']).toBe(HOME)
    await run.dispose()
  })

  it('wraps the resume argv the same way', async () => {
    const { provider, specs } = mount({
      kind: 'resume', childSessionId: CHILD, cliSessionId: 't1', exec: TARGET,
    })
    const run = await provider.start(request())
    await run.result
    expect(specs[0]?.argv).toEqual([
      'docker', 'exec', '-w', '/workspace', '-e', 'CODEX_HOME', 'dsh-lab-unit',
      'codex', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', 'resume', 't1', '回答 2+2',
    ])
    await run.dispose()
  })

  it('refuses a target that does not name the in-container scoped home', async () => {
    const { provider, specs } = mount({
      kind: 'fresh', exec: { container: 'dsh-lab-unit', workdir: '/workspace' },
    })
    await expect(provider.start(request())).rejects.toThrow(/must declare CODEX_HOME/)
    // Nothing spawned, and no child session was recorded for a round that
    // could only have failed inside the unit.
    expect(specs).toHaveLength(0)
  })
})
