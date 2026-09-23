/**
 * T29 — a codex round against a NAMED scoped home: the same round, reading its
 * credentials (and writing its rollout) in `<homesRoot>/codex@<scope>` instead
 * of the default directory. What is pinned here is that the scope reaches the
 * spawn env and the delegation record, that a resume may not change it, and
 * that live rounds receive the same scoped home.
 */
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { CodexCliProvider } from '../src/codex-cli-provider.ts'

/** A stub child that emits a minimal `--json` run and exits 0. */
function stubChild(): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push([
    JSON.stringify({ type: 'thread.started', thread_id: 't-scoped' }),
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
const HOMES = '/host/scoped'

function request(): SubagentStartRequest {
  return {
    label: '委派',
    prompt: [{ type: 'text', text: '回答 2+2' }],
    parent: { session: { id: SessionId(PARENT), header: { cwd: '/tmp', delegationDepth: 0 } } },
    signal: new AbortController().signal,
    descriptor: { version: 2, mode: 'one-shot', provider: 'codex-local', label: '委派' },
  } as unknown as SubagentStartRequest
}

function mount(intent: unknown, options: { record?: Record<string, unknown>; live?: unknown } = {}): {
  provider: CodexCliProvider
  specs: SubprocessSpawnSpec[]
  recorded: Array<Record<string, unknown>>
  homes: string[]
} {
  const ctx = new Context()
  const specs: SubprocessSpawnSpec[] = []
  const recorded: Array<Record<string, unknown>> = []
  const homes: string[] = []
  const liveChild = Session.create(SessionId(CHILD))
  liveChild.append('turn/start', { turn: 1 })
  liveChild.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  ctx.provide('sessions', {
    create: (id: SessionId) => Session.create(id),
    get: (id: SessionId) => (id === SessionId(CHILD) ? liveChild : undefined),
  } as never)
  ctx.provide('localAgent', {
    homeDir: (name: string, scope?: string) => {
      const dir = scope === undefined ? `${HOMES}/${name}` : `${HOMES}/${name}@${scope}`
      homes.push(dir)
      return dir
    },
    get: () => ({ displayName: 'Codex' }),
    takeDelegationIntent: () => intent,
    recordDelegation: (record: Record<string, unknown>) => { recorded.push(record) },
    getDelegation: () => options.record,
    recordRoundSettled: () => {},
    reportRunProgress: () => {},
    acquireResumeLock: () => true,
    releaseResumeLock: () => {},
    registerMemberRun: vi.fn(() => 'token-xyz-1234'),
    unregisterMemberRun: vi.fn(),
    memberBridgeSocketPath: () => '/host/member.sock',
    memberBridgeCommand: () => ({ command: 'node', args: ['/host/bridge.js'] }),
  } as never)
  ctx.provide('subprocess', {
    spawn: (spec: SubprocessSpawnSpec) => {
      specs.push(spec)
      return stubChild()
    },
  } as never)
  ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
  const provider = new CodexCliProvider(ctx, 'read-only', options.live as never)
  return { provider, specs, recorded, homes }
}

describe('codex scoped home', () => {
  it('runs a scoped round in that scope\'s directory and records the scope', async () => {
    const { provider, specs, recorded } = mount({ kind: 'fresh', scope: 'eval-b' })
    const run = await provider.start(request())
    await run.result
    // The thread id is parsed out of the settled stream, so the record lands
    // one tick after the result.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(specs[0]?.env?.['CODEX_HOME']).toBe(`${HOMES}/codex@eval-b`)
    expect(recorded[0]).toMatchObject({ cliSessionId: 't-scoped', cwd: '/tmp', scope: 'eval-b' })
    await run.dispose()
  })

  it('leaves an unscoped round on the default directory, with no scope in the record', async () => {
    const { provider, specs, recorded } = mount({ kind: 'fresh' })
    const run = await provider.start(request())
    await run.result
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(specs[0]?.env?.['CODEX_HOME']).toBe(`${HOMES}/codex`)
    expect(recorded[0]).toBeDefined()
    expect('scope' in (recorded[0] as object)).toBe(false)
    await run.dispose()
  })

  it('resumes in the recorded scope and refuses a round that names another', async () => {
    const record = { childSessionId: CHILD, provider: 'codex-local', parentSessionId: PARENT, cliSessionId: 't1', cwd: '/tmp', scope: 'eval-b' }
    const ok = mount({ kind: 'resume', childSessionId: CHILD, cliSessionId: 't1', scope: 'eval-b' }, { record })
    const run = await ok.provider.start(request())
    await run.result
    expect(ok.specs[0]?.env?.['CODEX_HOME']).toBe(`${HOMES}/codex@eval-b`)
    await run.dispose()

    // Another scope — and, just as much, no scope at all — would continue the
    // thread under another account's credentials.
    const wrong = mount({ kind: 'resume', childSessionId: CHILD, cliSessionId: 't1', scope: 'other' }, { record })
    await expect(wrong.provider.start(request())).rejects.toThrow(/resume scope other differs/)
    expect(wrong.specs).toHaveLength(0)

    const none = mount({ kind: 'resume', childSessionId: CHILD, cliSessionId: 't1' }, { record })
    await expect(none.provider.start(request())).rejects.toThrow(/resume scope \(default\) differs/)
    expect(none.specs).toHaveLength(0)
  })

  it('passes the recorded scoped home to the live driver without an exec fallback', async () => {
    const liveRun = { result: Promise.resolve({ status: 'done' }), dispose: vi.fn() }
    const live = { disabled: false, startRound: vi.fn(async () => liveRun) }
    const { provider, specs } = mount({ kind: 'fresh', scope: 'eval-b' }, { live })
    expect(await provider.start(request())).toBe(liveRun)
    expect(live.startRound).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ homeDir: `${HOMES}/codex@eval-b` }))
    expect(specs).toHaveLength(0)
  })
})
