/**
 * T29 — a kimi round against a NAMED scoped home. The scope selects which
 * `KIMI_CODE_HOME` the round reads and writes; a resume may not change it, a
 * scoped round never goes to the resident `kimi acp` process, and it carries
 * no member channel (the bridge is declared in the DEFAULT scope's mcp.json).
 */
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { KimiCliProvider } from '../src/kimi-cli-provider.ts'

/** A stub child that prints the answer and exits 0. */
function stubChild(): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push('4\n')
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
const RECORD = { childSessionId: CHILD, provider: 'kimi-cli', parentSessionId: PARENT, cliSessionId: 'k1', cwd: '/tmp', scope: 'eval-b' }

function request(): SubagentStartRequest {
  return {
    label: '委派',
    prompt: [{ type: 'text', text: '回答 2+2' }],
    parent: { session: { id: SessionId(PARENT), header: { cwd: '/tmp', delegationDepth: 0 } } },
    signal: new AbortController().signal,
    descriptor: { version: 2, mode: 'one-shot', provider: 'kimi-cli', label: '委派' },
  } as unknown as SubagentStartRequest
}

function mount(intent: unknown, options: { record?: unknown; live?: unknown } = {}): {
  provider: KimiCliProvider
  specs: SubprocessSpawnSpec[]
  memberRuns: ReturnType<typeof vi.fn>
} {
  const ctx = new Context()
  const specs: SubprocessSpawnSpec[] = []
  const memberRuns = vi.fn(() => 'token-xyz-1234')
  const liveChild = Session.create(SessionId(CHILD))
  liveChild.append('turn/start', { turn: 1 })
  liveChild.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  ctx.provide('sessions', {
    create: (id: SessionId) => Session.create(id),
    get: (id: SessionId) => (id === SessionId(CHILD) ? liveChild : undefined),
  } as never)
  ctx.provide('localAgent', {
    homeDir: (name: string, scope?: string) => (scope === undefined ? `${HOMES}/${name}` : `${HOMES}/${name}@${scope}`),
    get: () => ({ displayName: 'Kimi' }),
    takeDelegationIntent: () => intent,
    recordDelegation: () => {},
    getDelegation: () => options.record,
    recordRoundSettled: () => {},
    reportRunProgress: () => {},
    acquireResumeLock: () => true,
    releaseResumeLock: () => {},
    kimiMirroredLines: () => undefined,
    setKimiMirroredLines: () => {},
    registerMemberRun: memberRuns,
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
  return { provider: new KimiCliProvider(ctx, options.live as never), specs, memberRuns }
}

describe('kimi scoped home', () => {
  it('runs a scoped round in that scope\'s directory, without the member channel', async () => {
    const { provider, specs, memberRuns } = mount({ kind: 'fresh', scope: 'eval-b' })
    const run = await provider.start(request())
    await run.result
    expect(specs[0]?.env?.['KIMI_CODE_HOME']).toBe(`${HOMES}/kimi@eval-b`)
    // The bridge declaration is written INTO a scoped home's mcp.json and the
    // socket is the homes root's single one — a scoped round declines the
    // channel rather than half-wiring it.
    expect(memberRuns).not.toHaveBeenCalled()
    await run.dispose()
  })

  it('leaves an unscoped round on the default directory, member channel included', async () => {
    const { provider, specs, memberRuns } = mount({ kind: 'fresh' })
    const run = await provider.start(request())
    await run.result
    expect(specs[0]?.env?.['KIMI_CODE_HOME']).toBe(`${HOMES}/kimi`)
    expect(memberRuns).toHaveBeenCalled()
    await run.dispose()
  })

  it('refuses a resume that changes the recorded scope', async () => {
    const wrong = mount({ kind: 'resume', childSessionId: CHILD, cliSessionId: 'k1', scope: 'other' }, { record: RECORD })
    await expect(wrong.provider.start(request())).rejects.toThrow(/resume scope other differs/)
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
