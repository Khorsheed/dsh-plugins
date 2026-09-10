/**
 * T29 — a claude round against a NAMED scoped home. The scope selects which
 * `CLAUDE_CONFIG_DIR` the round reads and writes (and, on macOS, which keychain
 * item, since claude keys that by the config directory's path); a resume may
 * not change it, and a scoped round never goes to the resident process.
 */
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { ClaudeCliProvider } from '../src/claude-cli-provider.ts'

/** A stub child that emits a minimal stream-json run and exits 0. */
function stubChild(): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-scoped' })}\n`)
  stdout.push(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '4' }] } })}\n`)
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
const RECORD = { childSessionId: CHILD, provider: 'claude-local', parentSessionId: PARENT, cliSessionId: 's1', cwd: '/tmp', scope: 'eval-b' }

function request(): SubagentStartRequest {
  return {
    label: '委派',
    prompt: [{ type: 'text', text: '回答 2+2' }],
    parent: { session: { id: SessionId(PARENT), header: { cwd: '/tmp', delegationDepth: 0 } } },
    signal: new AbortController().signal,
    descriptor: { version: 2, mode: 'one-shot', provider: 'claude-local', label: '委派' },
  } as unknown as SubagentStartRequest
}

function mount(intent: unknown, options: { record?: unknown; live?: unknown } = {}): {
  provider: ClaudeCliProvider
  specs: SubprocessSpawnSpec[]
  recorded: Array<Record<string, unknown>>
} {
  const ctx = new Context()
  const specs: SubprocessSpawnSpec[] = []
  const recorded: Array<Record<string, unknown>> = []
  const liveChild = Session.create(SessionId(CHILD))
  liveChild.append('turn/start', { turn: 1 })
  liveChild.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  ctx.provide('sessions', {
    create: (id: SessionId) => Session.create(id),
    get: (id: SessionId) => (id === SessionId(CHILD) ? liveChild : undefined),
  } as never)
  ctx.provide('localAgent', {
    homeDir: (name: string, scope?: string) => (scope === undefined ? `${HOMES}/${name}` : `${HOMES}/${name}@${scope}`),
    get: () => ({ displayName: 'Claude Code' }),
    takeDelegationIntent: () => intent,
    recordDelegation: (record: Record<string, unknown>) => { recorded.push(record) },
    getDelegation: () => options.record,
    recordRoundSettled: () => {},
    reportRunProgress: () => {},
    acquireResumeLock: () => true,
    releaseResumeLock: () => {},
    registerMemberRun: vi.fn(() => 'token-xyz-1234'),
    bindMemberRunPid: vi.fn(),
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
  return { provider: new ClaudeCliProvider(ctx, undefined, undefined, options.live as never), specs, recorded }
}

describe('claude scoped home', () => {
  it('runs a scoped round in that scope\'s config directory and records the scope', async () => {
    const { provider, specs, recorded } = mount({ kind: 'fresh', scope: 'eval-b' })
    const run = await provider.start(request())
    await run.result
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(specs[0]?.env?.['CLAUDE_CONFIG_DIR']).toBe(`${HOMES}/claude-code@eval-b`)
    expect(recorded[0]).toMatchObject({ cliSessionId: 's-scoped', scope: 'eval-b' })
    await run.dispose()
  })

  it('leaves an unscoped round on the default config directory', async () => {
    const { provider, specs, recorded } = mount({ kind: 'fresh' })
    const run = await provider.start(request())
    await run.result
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(specs[0]?.env?.['CLAUDE_CONFIG_DIR']).toBe(`${HOMES}/claude-code`)
    expect('scope' in (recorded[0] ?? {})).toBe(false)
    await run.dispose()
  })

  it('refuses a resume that changes the recorded scope', async () => {
    const wrong = mount({ kind: 'resume', childSessionId: CHILD, cliSessionId: 's1' }, { record: RECORD })
    await expect(wrong.provider.start(request())).rejects.toThrow(/resume scope \(default\) differs/)
    expect(wrong.specs).toHaveLength(0)
  })

  it('refuses a scoped round that the live driver would serve', async () => {
    const live = { disabled: false, startRound: vi.fn() }
    const { provider, specs } = mount({ kind: 'fresh', scope: 'eval-b' }, { live })
    await expect(provider.start(request())).rejects.toThrow(/exec-only/)
    expect(live.startRound).not.toHaveBeenCalled()
    expect(specs).toHaveLength(0)
  })
})
