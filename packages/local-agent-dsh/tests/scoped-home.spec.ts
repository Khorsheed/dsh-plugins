/**
 * T29 — a sub-dsh round against a NAMED scoped home. The scope selects which
 * `DSH_HOME` (and therefore which sub-profile) the round launches from; a
 * resume may not change it, and a scoped round never goes to the resident
 * `serve` process.
 */
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { DshCliProvider } from '../src/dsh-cli-provider.ts'

/** A stub child that prints the final answer, then exits 0. */
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
const RECORD = { childSessionId: CHILD, provider: 'dsh-cli', parentSessionId: PARENT, cliSessionId: CHILD, cwd: '/tmp', scope: 'eval-b' }

function request(): never {
  return {
    prompt: [{ type: 'text', text: '回答 2+2' }],
    parent: { session: { id: 'parent-1', header: { cwd: '/tmp' } } },
    descriptor: { description: '测试委派' },
    signal: new AbortController().signal,
  } as never
}

function mount(intent: unknown, options: { record?: unknown; live?: unknown } = {}): {
  provider: DshCliProvider
  specs: Array<{ argv: readonly string[]; env: Readonly<Record<string, string>> }>
  recorded: Array<Record<string, unknown>>
  homes: string
} {
  // Real directories: the round provisions its sub-profile INSIDE the scoped
  // home it was handed, which is the very thing a scope has its own copy of.
  const homes = mkdtempSync(join(tmpdir(), 'dsh-scope-homes-'))
  const ctx = new Context()
  const specs: Array<{ argv: readonly string[]; env: Readonly<Record<string, string>> }> = []
  const recorded: Array<Record<string, unknown>> = []
  const liveChild = Session.create(SessionId(CHILD))
  liveChild.append('turn/start', { turn: 1 })
  liveChild.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  ctx.provide('localAgent', {
    homeDir: (name: string, scope?: string) => {
      const dir = join(homes, scope === undefined ? name : `${name}@${scope}`)
      mkdirSync(dir, { recursive: true })
      return dir
    },
    takeDelegationIntent: () => intent,
    recordDelegation: (record: Record<string, unknown>) => { recorded.push(record) },
    getDelegation: () => options.record,
    recordRoundSettled: () => {},
    get: () => undefined,
    acquireResumeLock: () => true,
    releaseResumeLock: () => {},
    reportRunProgress: () => {},
    registerMemberRun: vi.fn(() => 'token-xyz-1234'),
    unregisterMemberRun: vi.fn(),
    memberBridgeSocketPath: () => '/host/member.sock',
    memberBridgeCommand: () => ({ command: 'node', args: ['/host/bridge.js'] }),
  })
  ctx.provide('subprocess', {
    spawn: (spec: { argv: readonly string[]; env: Readonly<Record<string, string>> }) => {
      specs.push(spec)
      return stubChild()
    },
  })
  ctx.provide('credentials', { resolve: async () => ({ value: 'sk-test', source: 'env' }) })
  ctx.provide('sessions', {
    create: (id: string) => Session.create(SessionId(id)),
    get: (id: string) => (id === CHILD ? liveChild : undefined),
  })
  ctx.provide('logger', { warn: () => {}, info: () => {} })
  // `cliLaunch` keeps the round from replicating the test process.
  return { provider: new DshCliProvider(ctx, { cliLaunch: ['dsh'] } as never, options.live as never), specs, recorded, homes }
}

describe('dsh scoped home', () => {
  it('runs a scoped round with that scope\'s DSH_HOME and records the scope', async () => {
    const { provider, specs, recorded, homes } = mount({ kind: 'fresh', scope: 'eval-b' })
    const run = await provider.start(request())
    await run.result
    expect(specs[0]?.env?.['DSH_HOME']).toBe(join(homes, 'dsh@eval-b'))
    expect(recorded[0]).toMatchObject({ cwd: '/tmp', scope: 'eval-b' })
    await run.dispose()
  })

  it('leaves an unscoped round on the default directory, with no scope in the record', async () => {
    const { provider, specs, recorded, homes } = mount({ kind: 'fresh' })
    const run = await provider.start(request())
    await run.result
    expect(specs[0]?.env?.['DSH_HOME']).toBe(join(homes, 'dsh'))
    expect('scope' in (recorded[0] ?? {})).toBe(false)
    await run.dispose()
  })

  it('refuses a resume that changes the recorded scope', async () => {
    const wrong = mount({ kind: 'resume', childSessionId: CHILD, cliSessionId: CHILD, scope: 'other' }, { record: RECORD })
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
