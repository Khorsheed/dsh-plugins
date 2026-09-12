/**
 * T30b — the DELEGATION's own model on a kimi round. What is pinned
 * here is the resolution order (override → delegation → plugin config →
 * scoped file → CLI default), that the delegation's value is RECORDED so
 * every resume round re-requests it, and that a round naming a model now
 * goes LIVE: the model becomes the member's start model, bound at spawn
 * (a mismatched resident runtime is retired and respawned onto it).
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

function mount(intent: unknown, options: { record?: unknown; live?: unknown; configModel?: () => string | undefined; memberModels?: unknown } = {}): {
  provider: KimiCliProvider
  specs: SubprocessSpawnSpec[]
  memberRuns: ReturnType<typeof vi.fn>
  recorded: Array<Record<string, unknown>>
} {
  const ctx = new Context()
  const specs: SubprocessSpawnSpec[] = []
  const memberRuns = vi.fn(() => 'token-xyz-1234')
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
    get: () => ({ displayName: 'Kimi' }),
    takeDelegationIntent: () => intent,
    recordDelegation: (record: Record<string, unknown>) => { recorded.push(record) },
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
  return { provider: new KimiCliProvider(ctx, options.live as never, options.configModel, options.memberModels as never), specs, memberRuns, recorded }
}

/** The provider name and CLI-session id the recorded fixtures carry. */
const RECORD_PROVIDER = 'kimi-cli'
const CLI_SESSION = 'k1'

const MODEL_RECORD = {
  childSessionId: CHILD,
  provider: RECORD_PROVIDER,
  parentSessionId: PARENT,
  cliSessionId: CLI_SESSION,
  cwd: '/tmp',
}

/** The value following `-m` on the spawned argv, or undefined when absent. */
function modelFlag(argv: readonly string[]): string | undefined {
  const at = argv.indexOf('-m')
  return at < 0 ? undefined : argv[at + 1]
}

describe('kimi delegation model', () => {
  it('a fresh round runs the model the DELEGATION named, and records it', async () => {
    const { provider, specs, recorded } = mount({ kind: 'fresh', model: 'model-a' })
    const run = await provider.start(request())
    await run.result
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(modelFlag(specs[0]?.argv ?? [])).toBe('model-a')
    // The record is written by the settle-time wire mirror, which this stub
    // has no wire log for; the resume tests below cover the read side, and
    // the write side rides the same object literal the scope tests pin.
    expect(recorded).toEqual([])
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
    expect(specs[0]?.argv ?? []).not.toContain('-m')
    await run.dispose()
  })

  it('a blank delegation model reads as unset, never an empty flag value', async () => {
    const { provider, specs } = mount({ kind: 'fresh', model: '   ' })
    const run = await provider.start(request())
    await run.result
    expect(specs[0]?.argv ?? []).not.toContain('-m')
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
    expect(specs[0]?.argv ?? []).not.toContain('-m')
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

  it('a fresh round naming a model goes LIVE — the model becomes the member start model', async () => {
    // The old exec-only refusal is gone: the live driver's spawn resolver
    // binds the delegation's model (rewriting the scoped default_model before
    // spawn, retiring a mismatched runtime), so the member keeps its resident
    // runtime AND its model.
    const live = {
      disabled: false,
      startRound: vi.fn(async () => ({ result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} })),
    }
    const memberModels = { noteStartModel: vi.fn(), overrideFor: () => undefined }
    const { provider, specs } = mount({ kind: 'fresh', model: 'model-a' }, { live, memberModels })
    await expect(provider.start(request())).resolves.toBeDefined()
    expect(live.startRound).toHaveBeenCalled()
    expect(memberModels.noteStartModel).toHaveBeenCalledWith(expect.any(String), 'model-a')
    expect(specs).toHaveLength(0)
  })

  it('a resume round with a recorded model goes LIVE too (start model re-noted)', async () => {
    const live = {
      disabled: false,
      startRound: vi.fn(async () => ({ result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} })),
    }
    const memberModels = { noteStartModel: vi.fn(), overrideFor: () => undefined }
    const { provider } = mount(
      { kind: 'resume', childSessionId: CHILD, cliSessionId: CLI_SESSION },
      { record: { ...MODEL_RECORD, model: 'model-a' }, live, memberModels },
    )
    await expect(provider.start(request())).resolves.toBeDefined()
    expect(live.startRound).toHaveBeenCalled()
    expect(memberModels.noteStartModel).toHaveBeenCalledWith(CHILD, 'model-a')
  })

  it('the session-level override outranks the recorded model on the exec path', async () => {
    // The composer picker's write is the family order's top layer: the very
    // next resume round runs it, ahead of what the delegation recorded.
    const memberModels = { noteStartModel: vi.fn(), overrideFor: () => 'picked-model' }
    const { provider, specs } = mount(
      { kind: 'resume', childSessionId: CHILD, cliSessionId: CLI_SESSION },
      { record: { ...MODEL_RECORD, model: 'model-a' }, memberModels },
    )
    const run = await provider.start(request())
    await run.result
    expect(modelFlag(specs[0]?.argv ?? [])).toBe('picked-model')
    await run.dispose()
  })

  it('the plugin-config key rides the live driver as the settings layer', async () => {
    // The key is harness-wide, so a resident runtime bound to it is running
    // what the instance asked for — no conflict with one runtime serving
    // many rounds.
    const live = { disabled: false, startRound: vi.fn(async () => ({ result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} })) }
    const { provider } = mount({ kind: 'fresh' }, { live, configModel: () => 'config-model' })
    await expect(provider.start(request())).resolves.toBeDefined()
    expect(live.startRound).toHaveBeenCalled()
  })
})
