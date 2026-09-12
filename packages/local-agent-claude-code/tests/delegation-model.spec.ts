/**
 * T30b — the DELEGATION's own model on a claude round. What is pinned
 * here is the four-layer order (delegation → plugin config → scoped file → CLI
 * default), that the delegation's value is RECORDED so every resume round
 * re-requests it, and that a round naming a model goes LIVE with it bound as
 * the member's start model at the runtime's spawn — a resident runtime bound
 * to a different model retires and the same CLI session resumes.
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

function mount(intent: unknown, options: { record?: unknown; live?: unknown; configModel?: (childSessionId: string, delegationModel?: string) => string | undefined } = {}): {
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
  return { provider: new ClaudeCliProvider(ctx, undefined, undefined, options.live as never, options.configModel), specs, recorded }
}

/** The provider name and CLI-session id the recorded fixtures carry. */
const RECORD_PROVIDER = 'claude-local'
const CLI_SESSION = 's1'

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

describe('claude delegation model', () => {
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
      // The member-aware resolver answers in the family order: with no
      // session-level override, the delegation model it is handed wins.
      { configModel: (_child: string, delegation?: string) => delegation ?? 'config-model' },
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
    // half way through (no session-level override set here).
    const { provider, specs } = mount(
      { kind: 'resume', childSessionId: CHILD, cliSessionId: CLI_SESSION },
      { record: { ...MODEL_RECORD, model: 'model-a' }, configModel: (_child: string, delegation?: string) => delegation ?? 'config-model' },
    )
    const run = await provider.start(request())
    await run.result
    expect(modelFlag(specs[0]?.argv ?? [])).toBe('model-a')
    await run.dispose()
  })

  it('the session-level override outranks the delegation model', async () => {
    // The composer picker's switch is the family's top layer: a member whose
    // delegation recorded one model runs the override on the next round.
    const { provider, specs } = mount(
      { kind: 'resume', childSessionId: CHILD, cliSessionId: CLI_SESSION },
      {
        record: { ...MODEL_RECORD, model: 'model-a' },
        configModel: (child: string, delegation?: string) => child === CHILD ? 'override-model' : delegation,
      },
    )
    const run = await provider.start(request())
    await run.result
    expect(modelFlag(specs[0]?.argv ?? [])).toBe('override-model')
    await run.dispose()
  })

  it('a fresh round naming a model goes LIVE with it bound as the member start model', async () => {
    // No longer exec-only: the delegation's model rides the round spec and
    // binds at the resident runtime's spawn; a runtime bound to a different
    // model retires first (the driver's ensureRuntime).
    const live = { disabled: false, startRound: vi.fn(async () => ({ result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} })) }
    const { provider, specs } = mount({ kind: 'fresh', model: 'model-a' }, { live })
    await expect(provider.start(request())).resolves.toBeDefined()
    expect(live.startRound).toHaveBeenCalledTimes(1)
    expect(live.startRound.mock.calls[0]?.[1]).toMatchObject({ model: 'model-a' })
    expect(specs).toHaveLength(0)
  })

  it('a resume round hands the recorded model to the live runtime too', async () => {
    const live = { disabled: false, startRound: vi.fn(async () => ({ result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} })) }
    const { provider } = mount(
      { kind: 'resume', childSessionId: CHILD, cliSessionId: CLI_SESSION },
      { record: { ...MODEL_RECORD, model: 'model-a' }, live },
    )
    await expect(provider.start(request())).resolves.toBeDefined()
    expect(live.startRound).toHaveBeenCalledTimes(1)
    expect(live.startRound.mock.calls[0]?.[1]).toMatchObject({ model: 'model-a' })
  })

  it('the plugin-config key is NOT exec-only — only a scoped round is', async () => {
    // The key is harness-wide, so a resident runtime bound to it is running
    // what the instance asked for; a scoped round still never goes live (the
    // runtime binds the default scoped home).
    const live = { disabled: false, startRound: vi.fn(async () => ({ result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} })) }
    const { provider } = mount({ kind: 'fresh' }, { live, configModel: () => 'config-model' })
    await expect(provider.start(request())).resolves.toBeDefined()
    expect(live.startRound).toHaveBeenCalled()
  })
})
