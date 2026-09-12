/**
 * T30b — the DELEGATION's own model on a dsh round. What is pinned
 * here is the layered order (session override → delegation → plugin config →
 * host default selection), that the delegation's value is RECORDED so every
 * resume round re-requests it, and that a live-mode round naming a model binds
 * it as the member's start model at the serve spawn instead of being refused.
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

function mount(intent: unknown, options: { record?: unknown; live?: unknown; configModel?: () => string | undefined; overrides?: (childSessionId: string) => string | undefined } = {}): {
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
  return { provider: new DshCliProvider(ctx, { cliLaunch: ['dsh'] } as never, options.live as never, options.configModel, options.overrides), specs, recorded, homes }
}

/** The provider name and CLI-session id the recorded fixtures carry. */
const RECORD_PROVIDER = 'dsh-cli'
const CLI_SESSION = CHILD

const MODEL_RECORD = {
  childSessionId: CHILD,
  provider: RECORD_PROVIDER,
  parentSessionId: PARENT,
  cliSessionId: CLI_SESSION,
  cwd: '/tmp',
}

/** The value following `--model` on the spawned argv, or undefined when absent. */
function modelFlag(argv: readonly string[]): string | undefined {
  const at = argv.indexOf('--model')
  return at < 0 ? undefined : argv[at + 1]
}

describe('dsh delegation model', () => {
  it('a fresh round runs the model the DELEGATION named, and records it', async () => {
    const { provider, specs, recorded } = mount({ kind: 'fresh', model: 'model-a' })
    const run = await provider.start(request())
    await run.result
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(modelFlag(specs[0]?.argv ?? [])).toBe('model-a')
    // Recorded, so the resume rounds need no caller to restate it.
    expect(recorded[0]).toMatchObject({ model: 'model-a' })
    await run.dispose()
  })

  it('the delegation outranks the plugin-config key', async () => {
    const { provider, specs } = mount(
      { kind: 'fresh', model: 'model-a' },
      { configModel: () => 'config-model' },
    )
    const run = await provider.start(request())
    await run.result
    expect(modelFlag(specs[0]?.argv ?? [])).toBe('model-a')
    await run.dispose()
  })

  it('the session-level override outranks the delegation model on the exec path', async () => {
    // The composer picker's override is the FIRST layer of the family's fixed
    // order: a member switched mid-conversation runs the next round — exec or
    // live — on the override, not on what its first round recorded.
    const { provider, specs } = mount(
      { kind: 'resume', childSessionId: CHILD, cliSessionId: CLI_SESSION },
      { record: { ...MODEL_RECORD, model: 'model-a' }, overrides: () => 'override-model' },
    )
    const run = await provider.start(request())
    await run.result
    expect(modelFlag(specs[0]?.argv ?? [])).toBe('override-model')
    await run.dispose()
  })

  it('with no delegation model, the plugin-config key decides', async () => {
    const { provider, specs } = mount({ kind: 'fresh' }, { configModel: () => 'config-model' })
    const run = await provider.start(request())
    await run.result
    expect(modelFlag(specs[0]?.argv ?? [])).toBe('config-model')
    await run.dispose()
  })

  it('with neither, no model flag rides the argv at all', async () => {
    // The scoped configuration file — and, with none, the CLI's own default —
    // decides exactly as it did before either layer existed.
    const { provider, specs, recorded } = mount({ kind: 'fresh' })
    const run = await provider.start(request())
    await run.result
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(specs[0]?.argv ?? []).not.toContain('--model')
    expect(recorded[0]).toBeDefined()
    expect('model' in (recorded[0] as object)).toBe(false)
    await run.dispose()
  })

  it('a blank delegation model reads as unset, never an empty flag value', async () => {
    const { provider, specs } = mount({ kind: 'fresh', model: '   ' })
    const run = await provider.start(request())
    await run.result
    expect(specs[0]?.argv ?? []).not.toContain('--model')
    await run.dispose()
  })

  it('a resume re-requests the model its first round recorded', async () => {
    const { provider, specs } = mount(
      { kind: 'resume', childSessionId: CHILD, cliSessionId: CLI_SESSION },
      { record: { ...MODEL_RECORD, model: 'model-a' } },
    )
    const run = await provider.start(request())
    await run.result
    expect(modelFlag(specs[0]?.argv ?? [])).toBe('model-a')
    await run.dispose()
  })

  it('a resume of a delegation that named none still names none', async () => {
    const { provider, specs } = mount(
      { kind: 'resume', childSessionId: CHILD, cliSessionId: CLI_SESSION },
      { record: MODEL_RECORD },
    )
    const run = await provider.start(request())
    await run.result
    expect(specs[0]?.argv ?? []).not.toContain('--model')
    await run.dispose()
  })

  it('the recorded model outranks the plugin-config key on a resume too', async () => {
    // A delegation keeps the model it started with even after the harness's
    // own key changes underneath it — the conversation does not switch models
    // half way through.
    const { provider, specs } = mount(
      { kind: 'resume', childSessionId: CHILD, cliSessionId: CLI_SESSION },
      { record: { ...MODEL_RECORD, model: 'model-a' }, configModel: () => 'config-model' },
    )
    const run = await provider.start(request())
    await run.result
    expect(modelFlag(specs[0]?.argv ?? [])).toBe('model-a')
    await run.dispose()
  })

  it('a live-mode round naming a model binds it as the member start model, not refused', async () => {
    const live = { disabled: false, startRound: vi.fn(async () => ({ result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} })) }
    const { provider, specs } = mount({ kind: 'fresh', model: 'model-a' }, { live })
    await expect(provider.start(request())).resolves.toBeDefined()
    expect(live.startRound).toHaveBeenCalled()
    expect(live.startRound.mock.calls[0]?.[1]).toMatchObject({ startModel: 'model-a' })
    // The exec fallback never spawned: the live driver owns the round.
    expect(specs).toHaveLength(0)
  })

  it('the session-level override outranks even the delegation model on the live path', async () => {
    const live = { disabled: false, startRound: vi.fn(async () => ({ result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} })) }
    const { provider } = mount(
      { kind: 'fresh', model: 'model-a' },
      { live, overrides: () => 'override-model' },
    )
    await expect(provider.start(request())).resolves.toBeDefined()
    expect(live.startRound.mock.calls[0]?.[1]).toMatchObject({ startModel: 'override-model' })
  })

  it('the plugin-config key is NOT exec-only — only a delegation model is', async () => {
    // The key is harness-wide, so a resident runtime bound to it is running
    // what the instance asked for; only a per-delegation model conflicts with
    // one runtime serving many rounds.
    const live = { disabled: false, startRound: vi.fn(async () => ({ result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} })) }
    const { provider } = mount({ kind: 'fresh' }, { live, configModel: () => 'config-model' })
    await expect(provider.start(request())).resolves.toBeDefined()
    expect(live.startRound).toHaveBeenCalled()
  })
})
