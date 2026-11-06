/**
 * The kimi live driver: resident `kimi acp` lifecycle (spawn, initialize
 * handshake with the loadSession capability gate, session/new and
 * session/load, idle reclaim, crash re-spawn), the round settlement contract
 * (ACP stopReason mapping, turn-spanning prompt), graceful session/cancel,
 * prompt serialization (the stop-then-rephrase gesture), unattended
 * permission auto-answers, push-triggered file-fold mirroring with the
 * exec path's offset bookkeeping, and the provider's exec fallback.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { LocalAgentStreams } from '@khorsheed/dsh-local-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KimiCliProvider } from '../src/kimi-cli-provider.ts'
import { AcpRequestError, acpStopReasonToHarness, DEFAULT_TIMEOUTS, KimiAcpLiveDriver, KimiSessionOccupiedError, textSegmentSeparator } from '../src/live-driver.ts'
import { readKimiDefaultModel } from '../src/provision.ts'
import { expectValidReleasedLog } from './expect-valid-log.ts'
import { mirrorSnapshot, snapshotExecution, SNAPSHOT_NOW, until } from './mirror-snapshot.ts'
import { KIMI_UNRECORDED } from '../src/index.ts'

/** One scripted turn: streamed chunks, the terminal stop reason, or a hang. */
interface FakeTurn {
  chunks?: string[]
  /** Raw session updates sent after the chunks (`usage_update`, say). */
  updates?: Record<string, unknown>[]
  stopReason?: string
  /** Never resolve the prompt (cancel-path tests drive it by hand). */
  hang?: boolean
}

interface FakeAcpScript {
  loadChunks?: string[]
  turn?: (params: Record<string, unknown>) => FakeTurn
  silent?: readonly string[]
  crashAfterPrompt?: boolean
  /** Fail session/new with an error response. */
  failSessionNew?: string
  /** Answer session/load with this JSON-RPC error when it returns one (kimi's lock refusal, say). */
  failSessionLoad?: (params: Record<string, unknown>) => Record<string, unknown> | undefined
  /** Keep running after stdin EOF (only terminate() ends it). */
  ignoreEof?: boolean
  /** Omit the loadSession capability (breaker-path test). */
  noLoadSession?: boolean
  configOptions?: unknown[]
  setConfiguration?: (params: Record<string, unknown>) => unknown
}

/** A fake `kimi acp` process speaking ACP over its stdio. */
class FakeAcpServer {
  readonly stdin = new PassThrough()
  readonly stdout = new Readable({ read() {} })
  readonly stderr = new Readable({ read() {} })
  readonly handle: SubprocessHandle
  readonly requests: { method: string; params: Record<string, unknown> }[] = []
  readonly notifications: Record<string, unknown>[] = []
  readonly serverAnswers: Record<string, unknown>[] = []
  terminated = false
  stdinEnded = false
  private buffer = ''
  private readonly resolveDone: (outcome: { exitCode: number; signal: null }) => void
  readonly done: Promise<{ exitCode: number; signal: null }>
  private sessionSeq = 0
  /** Hand-resolvable pending prompt responses (hang tests). */
  readonly pendingPrompts: ((result: unknown) => void)[] = []

  constructor(private readonly script: FakeAcpScript = {}) {
    let resolveDone!: (outcome: { exitCode: number; signal: null }) => void
    this.done = new Promise((resolve) => { resolveDone = resolve })
    this.resolveDone = resolveDone
    this.stderr.push(null)
    this.stdin.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      let index = this.buffer.indexOf('\n')
      while (index >= 0) {
        const line = this.buffer.slice(0, index)
        this.buffer = this.buffer.slice(index + 1)
        index = this.buffer.indexOf('\n')
        if (line.trim() !== '') this.dispatch(JSON.parse(line) as { id?: string; method?: string; params?: Record<string, unknown>; result?: unknown })
      }
    })
    this.stdin.on('end', () => {
      this.stdinEnded = true
      if (this.script.ignoreEof !== true) this.resolveDone({ exitCode: 0, signal: null })
    })
    this.handle = {
      pid: 8242,
      stdin: this.stdin,
      stdout: this.stdout,
      stderr: this.stderr,
      collected: {
        stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done: this.done,
      terminate: () => {
        this.terminated = true
        this.resolveDone({ exitCode: 0, signal: null })
      },
      waitForExit: async () => true,
    }
  }

  private send(message: Record<string, unknown>): void {
    this.stdout.push(JSON.stringify(message) + '\n')
  }

  /** Push a session/update notification. */
  update(sessionId: string, update: Record<string, unknown>): void {
    this.send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } })
  }

  /** Push a session/request_permission server request and record the answer. */
  askPermission(sessionId: string, options: { kind: string; optionId: string }[]): void {
    this.send({
      jsonrpc: '2.0',
      id: `srv_${this.serverAnswers.length}`,
      method: 'session/request_permission',
      params: { sessionId, options },
    })
  }

  /** Resolve a hung prompt by hand (cancel convergence). */
  resolvePrompt(result: unknown): void {
    this.pendingPrompts.shift()?.(result)
  }

  crash(): void {
    this.resolveDone({ exitCode: 1, signal: null })
  }

  private dispatch(message: { id?: string; method?: string; params?: Record<string, unknown>; result?: unknown }): void {
    // A driver RESPONSE to one of our server requests.
    if (message.id !== undefined && message.method === undefined) {
      this.serverAnswers.push(message.result as Record<string, unknown>)
      return
    }
    if (message.method === undefined) return
    const params = message.params ?? {}
    if (message.id === undefined) {
      // A driver notification (session/cancel).
      this.notifications.push({ method: message.method, params })
      return
    }
    this.requests.push({ method: message.method, params })
    if (this.script.silent?.includes(message.method) === true) return
    const respond = (result: unknown) => this.send({ jsonrpc: '2.0', id: message.id, result })
    const respondError = (messageText: string) =>
      this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: messageText } })
    switch (message.method) {
      case 'initialize':
        respond({
          protocolVersion: 1,
          agentCapabilities: this.script.noLoadSession === true ? {} : { loadSession: true },
          authMethods: [],
        })
        return
      case 'session/new':
        if (this.script.failSessionNew !== undefined) {
          respondError(this.script.failSessionNew)
          return
        }
        this.sessionSeq += 1
        // Real kimi ACP session ids are directory names (`session_<uuid>`).
        respond({ sessionId: `session_acp-session-${this.sessionSeq}`, ...this.script.configOptions === undefined ? {} : { configOptions: this.script.configOptions } })
        return
      case 'session/load': {
        const refusal = this.script.failSessionLoad?.(params)
        if (refusal !== undefined) {
          this.send({ jsonrpc: '2.0', id: message.id, error: refusal })
          return
        }
      }
        for (const text of this.script.loadChunks ?? []) this.update(String(params['sessionId']), { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
        respond({ ...this.script.configOptions === undefined ? {} : { configOptions: this.script.configOptions } })
        return
      case 'session/set_config_option':
        respond(this.script.setConfiguration?.(params) ?? {})
        return
      case 'session/prompt': {
        const turn = this.script.turn?.(params) ?? {}
        if (this.script.crashAfterPrompt === true) {
          queueMicrotask(() => { this.crash() })
          return
        }
        if (turn.hang === true) {
          // A hung prompt: the test resolves it by hand (cancel convergence).
          this.pendingPrompts.push((result) => respond(result))
          return
        }
        queueMicrotask(() => {
          const sessionId = String(params['sessionId'])
          for (const chunk of turn.chunks ?? []) {
            this.update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } })
          }
          for (const update of turn.updates ?? []) this.update(sessionId, update)
          respond({ stopReason: turn.stopReason ?? 'end_turn' })
        })
        return
      }
      default:
        respond({})
    }
  }
}

/** Write one wire.jsonl for the ACP session so the file mirror has content. */
function writeKimiWire(homeDir: string, sessionId: string, task: string, answer: string, model?: string): void {
  const dir = join(homeDir, 'sessions', 'wd_test', `session_${sessionId}`, 'agents', 'main')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'wire.jsonl'), [
    JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: task }] }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, part: { type: 'text', text: answer } } }),
    JSON.stringify({ type: 'usage.record', usage: { inputOther: 10, output: 4 }, ...model === undefined ? {} : { model } }),
  ].join('\n') + '\n')
}

interface Mount {
  ctx: Context
  homeDir: string
  spawns: { spec: SubprocessSpawnSpec; fake?: FakeAcpServer; execHandle?: SubprocessHandle }[]
  reports: { id: string; progress: { kind: string; text?: string; mirroredLines?: number } }[]
  records: ReturnType<typeof vi.fn>
  settles: { id: string; round: Record<string, unknown> }[]
  mirrorOffsets: Map<string, number>
  queueChild(child: FakeAcpServer): void
  driver: KimiAcpLiveDriver
}

function mount(options: {
  config?: ConstructorParameters<typeof KimiAcpLiveDriver>[1]
  timeouts?: ConstructorParameters<typeof KimiAcpLiveDriver>[2]
  intent?: unknown
  /**
   * Emulate the production wiring: every session reads as live, so the mirror
   * persists through the core's syncChildSession (never the one-shot handle
   * flow), and the strict persistence double rejects any append that does
   * fire — the redundant full-list append that violates the real
   * coordinator's contiguous-seq contract.
   */
  strictPersistence?: boolean
} = {}): Mount {
  const homeDir = mkdtempSync(join(tmpdir(), 'kimi-live-'))
  const reports: Mount['reports'] = []
  const spawns: Mount['spawns'] = []
  const queue: FakeAcpServer[] = []
  const records = vi.fn()
  const settles: Mount['settles'] = []
  const mirrorOffsets = new Map<string, number>()
  const ctx = new Context()
  ctx.provide('localAgent', {
    homeDir: () => homeDir,
    takeDelegationIntent: () => options.intent,
    recordDelegation: records,
    getDelegation: () => undefined,
    recordRoundSettled: (id: string, round: Record<string, unknown>) => { settles.push({ id, round }) },
    get: () => undefined,
    acquireResumeLock: () => true,
    releaseResumeLock: () => {},
    // The core's live-session durability entry: the mirror delegates to it
    // instead of touching sessionPersistence itself.
    syncChildSession: () => Promise.resolve(),
    kimiMirroredLines: (id: string) => mirrorOffsets.get(id) ?? 0,
    setKimiMirroredLines: (id: string, n: number) => { mirrorOffsets.set(id, n) },
    reportRunProgress: (id: string, progress: { kind: string; text?: string; mirroredLines?: number }) => {
      reports.push({ id, progress })
    },
  })
  ctx.provide('subprocess', {
    spawn: (spec: SubprocessSpawnSpec) => {
      const fake = queue.shift()
      if (fake !== undefined) {
        spawns.push({ spec, fake })
        return fake.handle
      }
      // The exec fallback: print the answer and exit 0.
      const stdout = new Readable({ read() {} })
      const stderr = new Readable({ read() {} })
      stderr.push(null)
      setImmediate(() => { stdout.push('exec 答案\n'); stdout.push(null) })
      const execHandle: SubprocessHandle = {
        pid: 8251,
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
      spawns.push({ spec, execHandle })
      return execHandle
    },
  })
  ctx.provide('sessions', {
    create: (id: string) => Session.create(SessionId(id)),
    // strictPersistence: any session reads as live, like the production
    // wiring — the mirror must persist through the core sync, never the
    // one-shot handle flow below.
    get: options.strictPersistence === true ? () => ({}) : () => undefined,
  })
  if (options.strictPersistence === true) {
    // The production coordinator's contiguous-seq contract: a redundant
    // full-list append always fails. With the child live, the mirror must
    // reach persistence ONLY through the core's syncChildSession — the
    // one-shot fallback firing here would throw on the missing stat/open.
    ctx.provide('sessionPersistence', {
      append: () => Promise.reject(new Error('append seq mismatch (strict test double)')),
      create: async () => {},
    })
  }
  ctx.provide('logger', { warn: () => {}, info: () => {} })
  // Rounds here stream text with no wire behind it unless a test writes one:
  // the settle's wait for wire steps is off unless a test asks for it.
  // Self-turn waits poll fast and an answerless end_turn's collision grace is
  // short, so the empty-answer paths stay quick.
  const driver = new KimiAcpLiveDriver(ctx, options.config ?? {}, options.timeouts ?? { ...DEFAULT_TIMEOUTS, settleFoldWaitMs: 0, selfTurnPollMs: 20, collisionGraceMs: 100 })
  return {
    ctx,
    homeDir,
    spawns,
    reports,
    records,
    settles,
    mirrorOffsets,
    queueChild: child => { queue.push(child) },
    driver,
  }
}

function request(over: { prompt?: string; signal?: AbortSignal } = {}): unknown {
  return {
    prompt: [{ type: 'text', text: over.prompt ?? '建个文件' }],
    parent: { session: { id: 'parent-1', header: { cwd: '/tmp' } } },
    signal: over.signal ?? new AbortController().signal,
  }
}

function roundSpec(m: Mount, child: Session, over: { resume?: { cliSessionId: string; turn: number }; onCliSessionId?: (id: string) => void } = {}): Parameters<KimiAcpLiveDriver['startRound']>[1] {
  return {
    cwd: '/tmp',
    homeDir: m.homeDir,
    childSession: child,
    parentSessionId: 'parent-1',
    ...(over.resume === undefined ? {} : { resume: over.resume }),
    ...(over.onCliSessionId === undefined ? {} : { onCliSessionId: over.onCliSessionId }),
  }
}

/**
 * Every mirrored content event sits inside a step/start–step/end pair at its
 * own (turn, step) — the boundary the live conversation assembler needs to
 * materialize the step (without it the real-time view renders nothing). The
 * checks are existential (some start before, some end after) so a backfilled
 * late result's second pair at the same coordinates also passes.
 */
function expectStepBoundaries(child: Session): void {
  const events = child.snapshotEvents()
  const boundaries = events.filter(event => event.type === 'step/start' || event.type === 'step/end')
  const content = events.filter(event =>
    event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result')
  expect(content.length).toBeGreaterThan(0)
  for (const event of content) {
    const { turn, step } = event.data as { turn: number; step: number }
    const at = boundaries.filter(boundary => {
      const data = boundary.data as { turn: number; step: number }
      return data.turn === turn && data.step === step
    })
    expect(
      at.some(boundary => boundary.type === 'step/start' && boundary.seq < event.seq),
      `step/start for ${event.type} at ${turn}:${step}`,
    ).toBe(true)
    expect(
      at.some(boundary => boundary.type === 'step/end' && boundary.seq > event.seq),
      `step/end for ${event.type} at ${turn}:${step}`,
    ).toBe(true)
  }
}

describe('acpStopReasonToHarness', () => {
  it('maps the ACP stop reasons and never silently completes', () => {
    expect(acpStopReasonToHarness('end_turn')).toBe('completed')
    expect(acpStopReasonToHarness('max_tokens')).toBe('max-tokens')
    expect(acpStopReasonToHarness('refusal')).toBe('refusal')
    expect(acpStopReasonToHarness('cancelled')).toBe('aborted')
    expect(acpStopReasonToHarness('max_turn_requests')).toBe('error')
    expect(acpStopReasonToHarness('something-future')).toBe('error')
  })
})

describe('kimi live driver rounds', () => {
  it('flushes the final turn boundary before reporting a settled result', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-final-durability'))
    let durable: ReturnType<Session['snapshotEvents']> = []
    Object.assign(m.ctx.sessions, { get: () => child })
    Object.assign(m.ctx.localAgent, {
      syncChildSession: async () => {
        const captured = structuredClone(child.snapshotEvents())
        await new Promise(resolve => setTimeout(resolve, 5))
        durable = captured
      },
    })
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['durable answer'] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    expect(durable.at(-1)?.type).toBe('turn/end')
    expect(durable).toEqual(child.snapshotEvents())
    await m.driver.disposeAll()
  })

  it('configures a resumed native session before prompting and leaves shared default_model untouched', async () => {
    const m = mount()
    writeFileSync(join(m.homeDir, 'config.toml'), 'default_model = "a"\n')
    const options = (model: string, effort: string) => [
      { id: 'model', category: 'model', type: 'select', currentValue: model, options: ['a', 'b'].map(value => ({ value, name: value })) },
      { id: 'thinking', category: 'thought_level', type: 'select', currentValue: effort, options: ['low', 'high'].map(value => ({ value, name: value })) },
    ]
    const fake = new FakeAcpServer({
      configOptions: options('a', 'high'),
      setConfiguration: params => ({ configOptions: options('b', params['configId'] === 'thinking' ? String(params['value']) : 'high') }),
    })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, {
      ...roundSpec(m, Session.create(SessionId('configured-resume')), { resume: { cliSessionId: 'prior', turn: 2 } }),
      configuration: { model: 'b', effort: 'low' },
    })
    await run.result
    expect(m.spawns[0]!.spec.argv).toEqual(['kimi', '--model', 'b', 'acp'])
    expect(fake.requests.map(request => request.method)).toEqual(['initialize', 'session/load', 'session/set_config_option', 'session/set_config_option', 'session/prompt'])
    expect(await readKimiDefaultModel(m.homeDir)).toBe('a')
    expect(m.driver.runtimeConfiguration('configured-resume')).toMatchObject({ currentModel: 'b', currentEffort: 'low' })
    await m.driver.disposeAll()
  })

  it('never sends a prompt if the session cannot confirm the requested configuration', async () => {
    const m = mount()
    const fake = new FakeAcpServer()
    m.queueChild(fake)
    await expect(m.driver.startRound(request() as never, {
      ...roundSpec(m, Session.create(SessionId('unverified-configuration'))), configuration: { model: 'b', effort: 'high' },
    })).rejects.toThrow('no verified model selection')
    expect(fake.requests.some(request => request.method === 'session/prompt')).toBe(false)
    expect(m.spawns).toHaveLength(1)
    await m.driver.disposeAll()
  })
  it('keeps native model configuration current between rounds and ignores another session', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-catalog'))
    const configOptions = (value: string) => [{ id: 'route', category: 'model', type: 'select', currentValue: value, options: [{ value, name: value }] }]
    const fake = new FakeAcpServer({ configOptions: configOptions('one') })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.driver.runtimeConfiguration(String(child.id))?.currentModel).toBe('one')
    fake.update('other-session', { sessionUpdate: 'config_option_update', configOptions: configOptions('wrong') })
    fake.update('session_acp-session-1', { sessionUpdate: 'config_option_update', configOptions: configOptions('two') })
    await vi.waitFor(() => { expect(m.driver.runtimeConfiguration(String(child.id))?.currentModel).toBe('two') })
    await m.driver.disposeAll()
  })

  it('separates same-kind output around a tool before delayed wire reconciliation', async () => {
    const m = mount({ config: { snapshotMinIntervalMs: 0 } })
    const liveStreams = new LocalAgentStreams()
    Object.assign(m.ctx.localAgent, { liveStreams })
    const child = Session.create(SessionId('child-kimi-generations'))
    const fake = new FakeAcpServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    const text = (value: string) => fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } })
    text('before')
    fake.update('session_acp-session-1', { sessionUpdate: 'tool_call', toolCallId: 'tool-one', title: 'Read', status: 'in_progress' })
    text('after')
    const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    writeFileSync(join(wireDir, 'wire.jsonl'), [
      { type: 'turn.prompt', input: [{ type: 'text', text: 'task' }] },
      { type: 'usage.record', usage: { inputOther: 10, output: 4 } },
      { type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, part: { type: 'text', text: 'before' } } },
      { type: 'context.append_loop_event', event: { type: 'tool.call', turnId: 0, toolCallId: 'tool-one', name: 'Read', args: {} } },
      { type: 'context.append_loop_event', event: { type: 'tool.result', turnId: 0, toolCallId: 'tool-one', result: { output: 'contents' } } },
      { type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, part: { type: 'text', text: 'after' } } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n')
    fake.resolvePrompt({ stopReason: 'end_turn' })
    expect((await run.result).stopReason).toBe('completed')
    const events = child.snapshotEvents()
    // The text messages fold at their reserved steps; the tool's native
    // lifecycle (advertisement, call, result) folds between them at its own
    // reserved step.
    const messages = events.filter(event => event.type === 'assistant/message')
    expect(messages.map(event => event.data.message.content)).toEqual([
      [{ type: 'text', text: 'before' }],
      [{ type: 'tool-call', id: 'tool-one', name: 'Read', arguments: '' }],
      [{ type: 'text', text: 'after' }],
    ])
    expect(messages.map(event => event.data.step)).toEqual([1, 2, 3])
    expect(events.find(event => event.type === 'tool/call')?.data).toMatchObject({ step: 2, callId: 'tool-one' })
    expect(events.filter(event => event.type === 'step/start').map(event => event.data.step)).toEqual([1, 2, 3])
    expectStepBoundaries(child)
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
    liveStreams.dispose()
  })

  it('a completed round waits for a late wire flush, so its final reply keeps its usage', async () => {
    // kimi flushed the final step after the prompt resolved and past the old
    // quiet window: the reply was finalized from its live text without usage,
    // and the step's usage.record, read next round, was dropped.
    const m = mount({ config: { snapshotMinIntervalMs: 0 }, timeouts: { ...DEFAULT_TIMEOUTS, settleFoldWaitMs: 10_000 } })
    const liveStreams = new LocalAgentStreams()
    const settled = vi.fn()
    Object.assign(m.ctx.localAgent, { liveStreams, recordRoundSettled: settled })
    const child = Session.create(SessionId('child-late-flush-kimi'))
    m.queueChild(new FakeAcpServer({ turn: () => {
      setTimeout(() => { writeKimiWire(m.homeDir, 'acp-session-1', '建个文件', 'hello') }, 1_500)
      return { chunks: ['hello'] }
    } }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    const answers = child.snapshotEvents().filter(event => event.type === 'assistant/message' && JSON.stringify(event.data.message.content).includes('hello'))
    expect(answers).toHaveLength(1)
    expect(answers[0]!.data).toMatchObject({ usage: { inputTokens: 10, outputTokens: 4 } })
    await m.driver.disposeAll()
    liveStreams.dispose()
  }, 15_000)

  it('a usage record flushed ahead of its step\'s content still lands on that reply (75844e33 turn 15)', async () => {
    // The settle polls caught the wire between the final step's usage.record
    // and its content: a settle-mode read took the record as the round's rest,
    // and the reply folded on the next poll without usage.
    const m = mount({ config: { snapshotMinIntervalMs: 0 }, timeouts: { ...DEFAULT_TIMEOUTS, settleFoldWaitMs: 10_000 } })
    const liveStreams = new LocalAgentStreams()
    Object.assign(m.ctx.localAgent, { liveStreams, recordRoundSettled: vi.fn() })
    const child = Session.create(SessionId('child-record-ahead-kimi'))
    const dir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    const head = [
      { type: 'turn.prompt', input: [{ type: 'text', text: '继续' }] },
      { type: 'context.append_loop_event', event: { type: 'step.begin', turnId: 0, step: 1 } },
      { type: 'usage.record', usage: { inputOther: 3304, output: 1973, inputCacheRead: 66048 } },
    ]
    const tail = [
      { type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, step: 1, part: { type: 'text', text: 'hello' } } },
      { type: 'context.append_loop_event', event: { type: 'step.end', turnId: 0, step: 1 } },
    ]
    m.queueChild(new FakeAcpServer({ turn: () => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'wire.jsonl'), head.map(row => JSON.stringify(row)).join('\n') + '\n')
      setTimeout(() => { writeFileSync(join(dir, 'wire.jsonl'), [...head, ...tail].map(row => JSON.stringify(row)).join('\n') + '\n') }, 1_500)
      return { chunks: ['hello'] }
    } }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    const answers = child.snapshotEvents().filter(event => event.type === 'assistant/message' && JSON.stringify(event.data.message.content).includes('hello'))
    expect(answers).toHaveLength(1)
    expect(answers[0]!.data).toMatchObject({ usage: { inputTokens: 3304, outputTokens: 1973, cacheReadTokens: 66048 } })
    await m.driver.disposeAll()
    liveStreams.dispose()
  }, 15_000)

  it('a compaction round sends /compact, holds until kimi\'s background compaction ends, and records one event', async () => {
    const m = mount({ config: { snapshotMinIntervalMs: 0 } })
    const child = Session.create(SessionId('child-compact-kimi'))
    const dir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    const row = (value: object): string => JSON.stringify(value)
    const before = [
      row({ type: 'turn.prompt', input: [{ type: 'text', text: '记住 4271' }] }),
      row({ type: 'token_counting.turn_recorded', tokens: 19837 }),
    ]
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'wire.jsonl'), before.join('\n') + '\n')
    const prompts: string[] = []
    m.queueChild(new FakeAcpServer({ turn: (params) => {
      prompts.push(JSON.stringify(params))
      // kimi answers /compact at once and compacts in the background.
      const begun = [...before, row({ type: 'full_compaction.begin', source: 'manual' }),
        row({ type: 'usage.record', usage: { inputOther: 1103, output: 154, inputCacheRead: 19712 }, usageScope: 'session' }),
        row({ type: 'context.apply_compaction', summary: '用户要求记住数字 4271。' }),
        row({ type: 'token_counting.rebased', tokens: 22085 })]
      writeFileSync(join(dir, 'wire.jsonl'), begun.join('\n') + '\n')
      setTimeout(() => { writeFileSync(join(dir, 'wire.jsonl'), [...begun, row({ type: 'full_compaction.complete' })].join('\n') + '\n') }, 700)
      return { chunks: ['Context compaction started — it runs in the background.'] }
    } }))
    const run = await m.driver.startRound(request() as never, { ...roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }), operation: 'compact' })
    let settled = false
    void run.result.then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(settled).toBe(false)
    expect((await run.result).stopReason).toBe('completed')
    expect(prompts.join('')).toContain('/compact')
    const events = child.snapshotEvents()
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(0)
    expect(events.filter(event => event.type === 'local-agent/compaction').map(event => event.data)).toEqual([expect.objectContaining({
      source: 'manual', outcome: 'completed', provider: 'kimi-cli', summary: '用户要求记住数字 4271。',
      beforeTokens: 19837, afterTokens: 22085, usage: { inputTokens: 1103, outputTokens: 154, cacheReadTokens: 19712 },
    })])
    await m.driver.disposeAll()
  }, 15_000)

  it('a round records the occupancy kimi reports and a compaction kimi ran on its own', async () => {
    const m = mount({ config: { snapshotMinIntervalMs: 0 } })
    const child = Session.create(SessionId('child-context-kimi'))
    const dir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    const row = (value: object): string => JSON.stringify(value)
    m.queueChild(new FakeAcpServer({ turn: () => {
      writeKimiWire(m.homeDir, 'acp-session-1', '继续写', '好的')
      writeFileSync(join(dir, 'wire.jsonl'), [
        row({ type: 'turn.prompt', input: [{ type: 'text', text: '继续写' }] }),
        row({ type: 'token_counting.turn_recorded', tokens: 250_000 }),
        row({ type: 'full_compaction.begin', source: 'auto' }),
        row({ type: 'context.apply_compaction', summary: '前情提要' }),
        row({ type: 'token_counting.rebased', tokens: 30_000 }),
        row({ type: 'full_compaction.complete' }),
        row({ type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, part: { type: 'text', text: '好的' } } }),
        row({ type: 'usage.record', usage: { inputOther: 10, output: 4 } }),
      ].join('\n') + '\n')
      return { chunks: ['好的'], updates: [{ sessionUpdate: 'usage_update', used: 31_000, size: 262_144 }] }
    } }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    const events = child.snapshotEvents()
    expect(events.filter(event => event.type === 'local-agent/compaction').map(event => event.data)).toEqual([expect.objectContaining({
      source: 'auto', outcome: 'completed', provider: 'kimi-cli', summary: '前情提要', afterTokens: 30_000, contextWindow: 262_144,
    })])
    expect(events.filter(event => event.type === 'local-agent/context').map(event => event.data)).toEqual([
      { provider: 'kimi-cli', usedTokens: 31_000, contextWindow: 262_144 },
    ])
    expectStepBoundaries(child)
    await m.driver.disposeAll()
  }, 15_000)

  it('publishes transient output while keeping only authoritative assistant messages in history', async () => {
    const m = mount({ config: { snapshotMinIntervalMs: 0 } })
    const liveStreams = new LocalAgentStreams()
    const published = vi.spyOn(liveStreams, 'publish')
    const settled = vi.fn()
    Object.assign(m.ctx.localAgent, { liveStreams, recordRoundSettled: settled })
    const child = Session.create(SessionId('child-transient-kimi'))
    m.queueChild(new FakeAcpServer({ turn: () => { writeKimiWire(m.homeDir, 'acp-session-1', '建个文件', 'hello'); return { chunks: ['hello'] } } }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    const events = child.snapshotEvents()
    // Live output rides the browser channel only: a reserved step is not open
    // in the log yet, and a checkpoint there would precede its step/start (a
    // replay then orders that step first and folds the final answer away).
    expect(events.filter(event => event.type === 'local-agent/stream')).toEqual([])
    expect(published.mock.calls.some(([, item]) => item.text === 'hello')).toBe(true)
    const answers = events.filter(event => event.type === 'assistant/message' && JSON.stringify(event.data.message.content).includes('hello'))
    expect(answers).toHaveLength(1)
    expect(answers[0]!.data).toMatchObject({ usage: { inputTokens: 10, outputTokens: 4 } })
    // The settled observation carries the round's usage (the room's usage chip reads it).
    await vi.waitFor(() => expect(settled).toHaveBeenCalledWith(String(child.id), expect.objectContaining({ usage: expect.objectContaining({ inputTokens: 10, outputTokens: 4 }) })))
    expectStepBoundaries(child)
    await m.driver.disposeAll()
    liveStreams.dispose()
  })

  it('spawns the resident kimi acp, creates a session, streams the turn, and mirrors via the file fold at settle', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-1'))
    const sessionIds: string[] = []
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['第一', '条回复'] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child, { onCliSessionId: id => { sessionIds.push(id) } }))
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    // The run output accumulates from the streamed chunks.
    expect(result.output).toEqual([{ type: 'text', text: '第一条回复' }])
    expect(sessionIds).toEqual(['acp-session-1'])
    const spawn = m.spawns[0]!
    expect(spawn.spec.argv).toEqual(['kimi', 'acp'])
    // The inline ACP bridge has no timeout field: the process-wide MCP bound
    // is lifted so a question card outlives kimi's 60s default.
    expect(spawn.spec.env).toEqual({ KIMI_CODE_HOME: m.homeDir, KIMI_MCP_TOOL_TIMEOUT_MS: String(30 * 60_000) })
    expect(spawn.fake!.requests.map(r => r.method)).toEqual(['initialize', 'session/new', 'session/prompt'])
    expect(spawn.fake!.requests[1]?.params).toMatchObject({ cwd: '/tmp', mcpServers: [] })
    // Turn boundaries are the parent's own.
    expect(child.snapshotEvents().find(e => e.type === 'turn/end')?.data).toMatchObject({ turn: 1, reason: { kind: 'completed' } })
    // The settle mirror pass ran (no wire.jsonl yet → total 0) and reported.
    await vi.waitFor(() => { expect(m.reports.some(r => r.progress.kind === 'mirror')).toBe(true) })
    await m.driver.disposeAll()
    expect(m.driver.liveCount).toBe(0)
  })

  it('a round spoken in several segments between tool calls returns them as paragraphs', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-segments'))
    const say = (text: string) => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
    m.queueChild(new FakeAcpServer({ turn: () => ({ updates: [
      say('我先看一下'), say('目录。'),
      { sessionUpdate: 'tool_call', toolCallId: 'tool_a', title: 'ls' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'tool_a', status: 'completed' },
      say('找到了三个文件。'),
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '想一想' } },
      say('结论：\n'),
      { sessionUpdate: 'tool_call', toolCallId: 'tool_b', title: 'cat' },
      say('都没问题。'),
    ] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    const result = await run.result
    expect(result.output).toEqual([{ type: 'text', text: '我先看一下目录。\n\n找到了三个文件。\n\n结论：\n\n都没问题。' }])
    await m.driver.disposeAll()
  })

  it('the segment separator makes exactly one blank line and nothing at the start', () => {
    expect(textSegmentSeparator('', 'a')).toBe('')
    expect(textSegmentSeparator('a', 'b')).toBe('\n\n')
    expect(textSegmentSeparator('a\n', 'b')).toBe('\n')
    expect(textSegmentSeparator('a\n\n', 'b')).toBe('')
    expect(textSegmentSeparator('a', '\nb')).toBe('\n')
  })

  it('settle reconciliation mirrors the wire.jsonl fold and advances the shared offset', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-2'))
    const fake = new FakeAcpServer({
      turn: params => {
        // The ACP runtime wrote its wire.jsonl by turn end.
        writeKimiWire(m.homeDir, 'acp-session-1', String((params['prompt'] as { text: string }[])[0]!.text), '文件建好了')
        return { chunks: ['文件建好了'] }
      },
    })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => {
      expect(child.snapshotEvents().filter(e => e.type === 'user/message')).toHaveLength(1)
      expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1)
    })
    const assistant = child.snapshotEvents().find(e => e.type === 'assistant/message')
    expect(assistant?.data).toMatchObject({ usage: { inputTokens: 10, outputTokens: 4 } })
    expect(m.mirrorOffsets.get('child-kimi-2')).toBe(2)
    // Event granularity: the settle fold wraps each mirrored step in its
    // boundary pair, inside the turn window.
    expectStepBoundaries(child)
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
  })

  it('reports the settled round’s observed model from the wire (the registry’s observation channel)', async () => {
    // The live drive's half of the exec path's onRoundSettled: every settled
    // round reports the model its wire named, so the delegation record's
    // observedModel merge (and the `settled` event) fires on prod's live path
    // too — the gap that left delegations.jsonl without observedModel.
    const m = mount()
    const child = Session.create(SessionId('child-kimi-obs'))
    const fake = new FakeAcpServer({
      turn: (params) => {
        writeKimiWire(m.homeDir, 'acp-session-1', String((params['prompt'] as { text: string }[])[0]!.text), '文件建好了', 'kimi-k2-thinking')
        return { chunks: ['文件建好了'] }
      },
    })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(m.settles).toHaveLength(1) })
    expect(m.settles[0]).toMatchObject({ id: 'child-kimi-obs', round: { observedModel: 'kimi-k2-thinking' } })
    await m.driver.disposeAll()
  })

  it('a settled round whose wire named no model still reports, with the observation absent', async () => {
    // Absence is recorded, never guessed: the `settled` event fires (the
    // parked progress route closes on it) without an observedModel field.
    const m = mount()
    const child = Session.create(SessionId('child-kimi-no-obs'))
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['ok'] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(m.settles).toHaveLength(1) })
    expect(m.settles[0]?.id).toBe('child-kimi-no-obs')
    expect(m.settles[0]?.round).toEqual({})
    await m.driver.disposeAll()
  })

  it('reuses the resident runtime and session for the resume round', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-3'))
    child.append('turn/start', { turn: 1 })
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['ok'] }) }))
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await first.result).stopReason).toBe('completed')
    const second = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))
    expect((await second.result).stopReason).toBe('completed')
    expect(m.spawns).toHaveLength(1)
    // The session stays loaded: no session/load on reuse.
    expect(m.spawns[0]!.fake!.requests.map(r => r.method)).toEqual(['initialize', 'session/new', 'session/prompt', 'session/prompt'])
    expect(child.snapshotEvents().filter(e => e.type === 'turn/end').at(-1)?.data).toMatchObject({ turn: 2, reason: { kind: 'completed' } })
    await m.driver.disposeAll()
  })

  it('re-spawns and session/loads the recorded session after a crash', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-4'))
    child.append('turn/start', { turn: 1 })
    const first = new FakeAcpServer({ turn: () => ({ chunks: ['第一条'] }) })
    m.queueChild(first)
    const firstRun = await m.driver.startRound(request() as never, roundSpec(m, child, { onCliSessionId: () => {} }))
    await firstRun.result
    first.crash()
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    const second = new FakeAcpServer({ turn: () => ({ chunks: ['第二条'] }) })
    m.queueChild(second)
    const secondRun = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))
    expect((await secondRun.result).stopReason).toBe('completed')
    expect(m.spawns).toHaveLength(2)
    expect(second.requests.map(r => r.method)).toEqual(['initialize', 'session/load', 'session/prompt'])
    expect(second.requests[1]?.params).toMatchObject({ sessionId: 'session_acp-session-1' })
    await m.driver.disposeAll()
  })

  it('does not treat session/load replay as the resumed round answer or live output', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-replay'))
    m.queueChild(new FakeAcpServer({ loadChunks: ['OLD ANSWER'], turn: () => ({ chunks: ['NEW ANSWER'] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))
    expect((await run.result).output).toEqual([{ type: 'text', text: 'NEW ANSWER' }])
    expect(JSON.stringify(child.snapshotEvents())).not.toContain('OLD ANSWER')
    await m.driver.disposeAll()
  })

  it('a legacy prefixed record id loads idempotently (no double prefix)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-4p'))
    child.append('turn/start', { turn: 1 })
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['续上'] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child, { resume: { cliSessionId: 'session_acp-session-9', turn: 2 } }))
    expect((await run.result).stopReason).toBe('completed')
    expect(m.spawns[0]!.fake!.requests.map(r => r.method)).toEqual(['initialize', 'session/load', 'session/prompt'])
    expect(m.spawns[0]!.fake!.requests[1]?.params).toMatchObject({ sessionId: 'session_acp-session-9' })
    await m.driver.disposeAll()
  })

  it('cancels via session/cancel — the process survives and stays reusable', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-5'))
    const fake = new FakeAcpServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const controller = new AbortController()
    const run = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    controller.abort()
    expect((await run.result).stopReason).toBe('aborted')
    expect(fake.notifications.some(n => n['method'] === 'session/cancel')).toBe(true)
    expect(fake.terminated).toBe(false)
    expect(child.snapshotEvents().find(e => e.type === 'turn/end')?.data).toMatchObject({
      turn: 1,
      reason: { kind: 'aborted', reason: { kind: 'parent' } },
    })
    // The hung prompt converges (cancelled), unblocking the turn chain.
    fake.resolvePrompt({ stopReason: 'cancelled' })
    await m.driver.disposeAll()
  })

  it('stop-then-rephrase: the next prompt waits for the cancelled turn to converge', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-6'))
    child.append('turn/start', { turn: 1 })
    const fake = new FakeAcpServer({ turn: params => (params['prompt'] as { text: string }[])[0]!.text === '换个说法' ? { chunks: ['第二条'] } : { hang: true } })
    m.queueChild(fake)
    const controller = new AbortController()
    const first = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    controller.abort()
    expect((await first.result).stopReason).toBe('aborted')
    // Round 2 immediately: its prompt must NOT go out before round 1 converges.
    const secondPending = m.driver.startRound(request({ prompt: '换个说法' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fake.requests.filter(r => r.method === 'session/prompt')).toHaveLength(1)
    fake.resolvePrompt({ stopReason: 'cancelled' })
    const second = await secondPending
    expect((await second.result).stopReason).toBe('completed')
    expect((await second.result).output).toEqual([{ type: 'text', text: '第二条' }])
    expect(fake.requests.filter(r => r.method === 'session/prompt')).toHaveLength(2)
    await m.driver.disposeAll()
  })

  it('auto-answers permission requests: first allow option, cancelled when none', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-7'))
    const fake = new FakeAcpServer({ turn: () => ({ chunks: ['完成'] }) })
    m.queueChild(fake)
    const pending = m.driver.startRound(request() as never, roundSpec(m, child))
    await vi.waitFor(() => { expect(fake.requests.map(r => r.method)).toContain('session/prompt') })
    fake.askPermission('session_acp-session-1', [{ kind: 'allow_once', optionId: 'opt-1' }])
    fake.askPermission('session_acp-session-1', [{ kind: 'reject_once', optionId: 'opt-2' }])
    const run = await pending
    expect((await run.result).stopReason).toBe('completed')
    expect(fake.serverAnswers).toContainEqual({ outcome: { outcome: 'selected', optionId: 'opt-1' } })
    expect(fake.serverAnswers).toContainEqual({ outcome: { outcome: 'cancelled' } })
    await m.driver.disposeAll()
  })

  it('token granularity streams throttled snapshots live at the stream\'s step, never into the session log', async () => {
    // Zero thresholds: every delta lands a snapshot immediately.
    const on = mount({ config: { snapshotMinIntervalMs: 0, snapshotMinChars: 0 } })
    const onStreams = new LocalAgentStreams()
    const onPublished = vi.spyOn(onStreams, 'publish')
    Object.assign(on.ctx.localAgent, { liveStreams: onStreams })
    const onChild = Session.create(SessionId('child-kimi-8b'))
    const fake = new FakeAcpServer({ turn: () => ({ hang: true }) })
    on.queueChild(fake)
    const onRun = await on.driver.startRound(request() as never, roundSpec(on, onChild))
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hel' } })
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } })
    writeKimiWire(on.homeDir, 'acp-session-1', '建个文件', 'hello')
    fake.resolvePrompt({ stopReason: 'end_turn' })
    expect((await onRun.result).stopReason).toBe('completed')
    // The stream reserved step 1 (deltas arrived before any fold): live
    // updates rode the stream channel, and the completion fold landed ONE
    // atomic step triple at the same (turn, step) — durable steps never hold
    // open across snapshots (the released-log reader rejects that).
    const atStep = onChild.snapshotEvents().filter(e => (e.data as { turn?: number; step?: number }).turn === 1
      && (e.data as { turn?: number; step?: number }).step === 1)
    expect(atStep.filter(e => e.type !== 'local-agent/stream').map(e => e.type))
      .toEqual(['step/start', 'assistant/message', 'step/end'])
    expect(atStep.filter(e => e.type === 'local-agent/stream')).toEqual([])
    expect(onPublished.mock.calls.filter(([, item]) => item.turn === 1 && item.step === 1).length).toBeGreaterThanOrEqual(1)
    const final = atStep.find(e => e.type === 'assistant/message')!
    expect((final.data as { message: { content: unknown[] } }).message.content).toEqual([{ type: 'text', text: 'hello' }])
    expectValidReleasedLog(onChild)
    // The delta still rides the run-progress channel.
    const deltas = on.reports.filter(r => r.progress.kind === 'delta').map(r => r.progress.text)
    expect(deltas).toContain('hel')
    expect(deltas).toContain('lo')
    await on.driver.disposeAll()
    onStreams.dispose()
  })

  it('token granularity: each streamed item finalizes at its own reserved step (no duplicate fold)', async () => {
    const m = mount({ config: { snapshotMinIntervalMs: 0, snapshotMinChars: 0 } })
    const child = Session.create(SessionId('child-kimi-token-final'))
    const fake = new FakeAcpServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '想一下' } })
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '文件' } })
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '建好了' } })
    // The wire flushes the round's items by turn end (the usage record first,
    // in kimi's own order).
    const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    writeFileSync(join(wireDir, 'wire.jsonl'), [
      JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }] }),
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 10, output: 4 } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, part: { type: 'think', think: '想一下' } } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, part: { type: 'text', text: '文件建好了' } } }),
    ].join('\n') + '\n')
    fake.resolvePrompt({ stopReason: 'end_turn' })
    expect((await run.result).stopReason).toBe('completed')
    const events = child.snapshotEvents()
    const assistant = events.filter(e => e.type === 'assistant/message')
    // Each item's durable content is ONE atomic step triple at its reserved
    // step: the thought at step 1, the answer at step 2 (live updates rode
    // the stream channel meanwhile).
    const atThink = events.filter(e => (e.data as { turn?: number; step?: number }).turn === 1
      && (e.data as { turn?: number; step?: number }).step === 1)
    expect(atThink.filter(e => e.type !== 'local-agent/stream').map(e => e.type))
      .toEqual(['step/start', 'assistant/message', 'step/end'])
    expect((atThink.find(e => e.type === 'assistant/message')!.data as { message: { content: unknown[] } }).message.content)
      .toEqual([{ type: 'reasoning', text: '想一下' }])
    // The answer stream finalizes at its reserved step 2, the fold carrying
    // the usage and no dangling interrupted badge — inside the turn window.
    const final = assistant.at(-1)!
    expect(final.data).toMatchObject({ turn: 1, step: 2, usage: { inputTokens: 10, outputTokens: 4 } })
    expect((final.data as { interrupted?: boolean }).interrupted).toBeUndefined()
    expect((final.data as { message: { content: unknown[] } }).message.content).toEqual([
      { type: 'text', text: '文件建好了' },
    ])
    const turnEnd = events.find(e => e.type === 'turn/end')!
    expect(final.seq).toBeLessThan(turnEnd.seq)
    const atStep = events.filter(e => (e.data as { turn?: number; step?: number }).turn === 1
      && (e.data as { turn?: number; step?: number }).step === 2)
    expect(atStep.filter(e => e.type !== 'local-agent/stream').map(e => e.type))
      .toEqual(['step/start', 'assistant/message', 'step/end'])
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
  })

  it('token granularity: a step-tagged wire folds think + answer into ONE durable step', async () => {
    const m = mount({ config: { snapshotMinIntervalMs: 0, snapshotMinChars: 0 } })
    const liveStreams = new LocalAgentStreams()
    const published = vi.spyOn(liveStreams, 'publish')
    Object.assign(m.ctx.localAgent, { liveStreams })
    const child = Session.create(SessionId('child-kimi-token-grouped'))
    const fake = new FakeAcpServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '想一下' } })
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '文件建好了' } })
    const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    writeFileSync(join(wireDir, 'wire.jsonl'), [
      JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }] }),
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 10, output: 4 } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'step.begin', turnId: 0, step: 1 } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, step: 1, part: { type: 'think', think: '想一下' } } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, step: 1, part: { type: 'text', text: '文件建好了' } } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'step.end', turnId: 0, step: 1 } }),
    ].join('\n') + '\n')
    fake.resolvePrompt({ stopReason: 'end_turn' })
    expect((await run.result).stopReason).toBe('completed')
    const events = child.snapshotEvents()
    const assistant = events.filter(e => e.type === 'assistant/message')
    // ONE durable step carries the whole wire step: the reasoning and the
    // answer in one message, with the round's usage — the host session's own
    // shape. (The live channel rendered both streams meanwhile.)
    expect(assistant).toHaveLength(1)
    expect(assistant[0]!.data).toMatchObject({ turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 4 } })
    expect((assistant[0]!.data as { message: { content: unknown[] } }).message.content).toEqual([
      { type: 'reasoning', text: '想一下' },
      { type: 'text', text: '文件建好了' },
    ])
    // The generation's think and text streams share ONE reserved step: no
    // frame points at a step that never materializes (an empty trailing step
    // would break the host's answer detection and fold the reply away).
    expect(events.filter(e => e.type === 'local-agent/stream')).toEqual([])
    const streamItems = published.mock.calls.map(([, item]) => item)
    expect(streamItems.length).toBeGreaterThan(0)
    expect(streamItems.every(item => item.step === 1)).toBe(true)
    const atStep2 = events.filter(e => (e.data as { turn?: number; step?: number }).turn === 1
      && (e.data as { turn?: number; step?: number }).step === 2)
    expect(atStep2).toEqual([])
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
    liveStreams.dispose()
  })

  it('token granularity: a cancelled round completes the stream as interrupted (legitimate 已停止)', async () => {
    const m = mount({ config: {} })
    const child = Session.create(SessionId('child-kimi-token-abort'))
    m.queueChild(new FakeAcpServer({ turn: () => ({ hang: true }) }))
    const controller = new AbortController()
    const run = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    const fake = m.spawns[0]!.fake!
    // Stream one partial chunk, then cancel.
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '写到一半' } })
    controller.abort()
    expect((await run.result).stopReason).toBe('aborted')
    fake.resolvePrompt({ stopReason: 'cancelled' })
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1) }, { timeout: 5_000 })
    const final = child.snapshotEvents().find(e => e.type === 'assistant/message')!
    expect(final.data).toMatchObject({ turn: 1, step: 1, interrupted: true })
    expect((final.data as { message: { content: unknown[] } }).message.content).toEqual([{ type: 'text', text: '写到一半' }])
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
  })

  it('token granularity: a tool-first round renders the answer after its tool cards (lazy stream step)', async () => {
    const m = mount({
      config: {},
      timeouts: { initializeMs: 5_000, requestMs: 5_000, convergeMs: 50, channelRetryMs: 60_000, mirrorThrottleMs: 0, settleFoldWaitMs: 0 },
    })
    const child = Session.create(SessionId('child-kimi-token-toolfirst'))
    const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    const fake = new FakeAcpServer({
      turn: () => {
        // The wire already carries the tool call when the turn starts — but
        // no result yet: its fold HOLDS mid-round (the native lifecycle
        // writes call and result in one closed step).
        writeFileSync(join(wireDir, 'wire.jsonl'), [
          JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }], origin: { kind: 'user' } }),
          JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.call', turnId: 0, toolCallId: 'call-1', toolCall: { name: 'Bash', args: { command: 'ls' } } } }),
        ].join('\n') + '\n')
        return { hang: true }
      },
    })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    // The ACP notification reserves the tool's chronological step (nothing
    // durable yet — the reservation is what keeps the tool card above the
    // answer when the fold lands).
    fake.update('session_acp-session-1', { sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'Bash', status: 'in_progress' })
    // Text streams after the tool's reservation; the wire gains the completed
    // answer (and the round's usage) by turn end.
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '文件建好了' } })
    writeFileSync(join(wireDir, 'wire.jsonl'), [
      JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }], origin: { kind: 'user' } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.call', turnId: 0, toolCallId: 'call-1', toolCall: { name: 'Bash', args: { command: 'ls' } } } }),
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 5, output: 2 } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, part: { type: 'text', text: '文件建好了' } } }),
    ].join('\n') + '\n')
    fake.resolvePrompt({ stopReason: 'end_turn' })
    expect((await run.result).stopReason).toBe('completed')

    // The tool card folded at its reserved step 1 — its result never reached
    // the wire, so the settle fold synthesized the interrupted one; the
    // answer's completion fold landed at the stream's reserved step 2,
    // carrying the round's usage.
    expect((child.snapshotEvents().find(e => e.type === 'tool/call')!.data as { step: number }).step).toBe(1)
    expect((child.snapshotEvents().find(e => e.type === 'tool/result')!.data as { message: { isError?: boolean } }).message.isError).toBe(true)
    const final = child.snapshotEvents().filter(e => e.type === 'assistant/message')
      .find(e => JSON.stringify((e.data as { message: { content?: unknown[] } }).message.content).includes('文件建好了'))!
    expect(final.data).toMatchObject({ turn: 1, step: 2, usage: { inputTokens: 5, outputTokens: 2 } })
    // Both folds carry their boundary pairs, and the log passes cold reads.
    expectStepBoundaries(child)
    expectValidReleasedLog(child)
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
  })

  it('parallel tool calls in one wire step keep the log\'s steps dense and in write order', async () => {
    // In the wild (session 2e9c1ffb, turn 1): kimi's step 3 called three
    // tools at once; each ACP notification reserved a step, the fold wrote
    // the whole wire step at one of them, and later writes filled the rest —
    // the log read 1, 3, 7, 8, 2, 3, … and the released reader rejected it.
    const m = mount({ config: {} })
    const child = Session.create(SessionId('child-kimi-parallel-tools'))
    const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    const prompt = JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '看看场景' }], origin: { kind: 'user' } })
    const loop = (event: Record<string, unknown>) => JSON.stringify({ type: 'context.append_loop_event', event: { turnId: 0, ...event } })
    const call = (id: string) => loop({ type: 'tool.call', toolCallId: id, toolCall: { name: 'game_read', args: { id } } })
    const result = (id: string) => loop({ type: 'tool.result', toolCallId: id, result: { output: `ok ${id}` } })
    const fake = new FakeAcpServer({
      turn: () => {
        writeFileSync(join(wireDir, 'wire.jsonl'), prompt + '\n')
        return { hang: true }
      },
    })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    const session = 'session_acp-session-1'
    // Wire step 1 folds BEFORE its tool's ACP notification arrives (the wire
    // flush won the race); the late notification then reserves a step.
    fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '先读一下' } })
    writeFileSync(join(wireDir, 'wire.jsonl'), [
      prompt,
      loop({ type: 'content.part', part: { type: 'think', think: '先读一下' } }), call('t1'), result('t1'),
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 5, output: 2 } }),
    ].join('\n') + '\n')
    await vi.waitFor(() => { expect(child.snapshotEvents().some(e => e.type === 'tool/call')).toBe(true) })
    fake.update(session, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'game_read', status: 'in_progress' })
    // Wire step 2: three tools at once, their notifications late as well.
    fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '并行看三个' } })
    writeFileSync(join(wireDir, 'wire.jsonl'), [
      prompt,
      loop({ type: 'content.part', part: { type: 'think', think: '先读一下' } }), call('t1'), result('t1'),
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 5, output: 2 } }),
      loop({ type: 'content.part', part: { type: 'think', think: '并行看三个' } }), call('t2'), call('t3'), call('t4'), result('t2'), result('t3'), result('t4'),
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 6, output: 3 } }),
    ].join('\n') + '\n')
    await new Promise(resolve => setTimeout(resolve, 100))
    for (const id of ['t2', 't3', 't4']) fake.update(session, { sessionUpdate: 'tool_call', toolCallId: id, title: 'game_read', status: 'in_progress' })
    // Wire step 3: the answer.
    fake.update(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '看完了' } })
    writeFileSync(join(wireDir, 'wire.jsonl'), [
      prompt,
      loop({ type: 'content.part', part: { type: 'think', think: '先读一下' } }), call('t1'), result('t1'),
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 5, output: 2 } }),
      loop({ type: 'content.part', part: { type: 'think', think: '并行看三个' } }), call('t2'), call('t3'), call('t4'), result('t2'), result('t3'), result('t4'),
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 6, output: 3 } }),
      loop({ type: 'content.part', part: { type: 'text', text: '看完了' } }),
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 7, output: 4 } }),
    ].join('\n') + '\n')
    fake.resolvePrompt({ stopReason: 'end_turn' })
    expect((await run.result).stopReason).toBe('completed')

    const starts = child.snapshotEvents().filter(e => e.type === 'step/start').map(e => (e.data as { step: number }).step)
    expect(starts).toEqual(starts.map((_, i) => i + 1))
    // Every tool is written once, and the answer comes last.
    expect(child.snapshotEvents().filter(e => e.type === 'tool/call').map(e => (e.data as { callId: string }).callId).sort()).toEqual(['t1', 't2', 't3', 't4'])
    const messages = child.snapshotEvents().filter(e => e.type === 'assistant/message')
    expect(JSON.stringify((messages.at(-1)!.data as { message: unknown }).message)).toContain('看完了')
    expectStepBoundaries(child)
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
  })

  it('an ACP call id carrying kimi\'s turn prefix names the wire\'s bare call — no orphan after the answer', async () => {
    // In the wild (fbc8ba18 round 2): ACP reported "1:tool_x", the wire
    // "tool_x"; settle re-wrote both calls as interrupted orphans AFTER the
    // answer, and the chat folded the answer into the process.
    const m = mount({ config: {} })
    const child = Session.create(SessionId('child-kimi-prefixed-id'))
    const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    const prompt = JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '建项目' }], origin: { kind: 'user' } })
    const loop = (event: Record<string, unknown>) => JSON.stringify({ type: 'context.append_loop_event', event: { turnId: 0, ...event } })
    const fake = new FakeAcpServer({
      turn: () => {
        writeFileSync(join(wireDir, 'wire.jsonl'), prompt + '\n')
        return { hang: true }
      },
    })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    fake.update('session_acp-session-1', { sessionUpdate: 'tool_call', toolCallId: '1:tool_x', title: 'game_open', status: 'in_progress' })
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '项目建好了' } })
    writeFileSync(join(wireDir, 'wire.jsonl'), [
      prompt,
      loop({ type: 'tool.call', step: 1, toolCallId: 'tool_x', toolCall: { name: 'game_open', args: {} } }),
      loop({ type: 'tool.result', step: 1, toolCallId: 'tool_x', result: { output: 'ok' } }),
      loop({ type: 'step.end', step: 1 }),
      loop({ type: 'content.part', step: 2, part: { type: 'text', text: '项目建好了' } }),
      loop({ type: 'step.end', step: 2 }),
    ].join('\n') + '\n')
    fake.resolvePrompt({ stopReason: 'end_turn' })
    expect((await run.result).stopReason).toBe('completed')

    expect(child.snapshotEvents().filter(e => e.type === 'tool/call').map(e => (e.data as { callId: string }).callId)).toEqual(['tool_x'])
    const messages = child.snapshotEvents().filter(e => e.type === 'assistant/message')
    expect(JSON.stringify((messages.at(-1)!.data as { message: unknown }).message)).toContain('项目建好了')
    expectStepBoundaries(child)
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
  })

  it('token granularity: a round whose stream stayed under the throttle still folds every wire item 1:1', async () => {
    const m = mount({ config: {} })
    const child = Session.create(SessionId('child-kimi-token-nostream'))
    const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    const fake = new FakeAcpServer({
      turn: () => {
        writeFileSync(join(wireDir, 'wire.jsonl'), [
          JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }] }),
          JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, part: { type: 'think', think: '想一下' } } }),
          JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.call', turnId: 0, toolCallId: 'call-1', toolCall: { name: 'Bash', args: { command: 'ls' } } } }),
          JSON.stringify({ type: 'usage.record', usage: { inputOther: 7, output: 3 } }),
          JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, part: { type: 'text', text: '静默答案' } } }),
        ].join('\n') + '\n')
        return { chunks: ['静默答案'] }
      },
    })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')

    // Faithful per-item fold (an untagged wire: one step per line): exactly
    // one durable message per content item, nothing duplicated, in the
    // wire's order. The streamed answer is never written from its live text
    // ahead of the lines before it — its wire line carries it.
    const events = child.snapshotEvents()
    const assistant = events.filter(e => e.type === 'assistant/message')
    expect(assistant.map(e => (e.data as { message: { content: { type: string }[] } }).message.content[0]?.type))
      .toEqual(['reasoning', 'tool-call', 'text'])
    expect((assistant[0]!.data as { message: { content: unknown[] } }).message.content).toEqual([{ type: 'reasoning', text: '想一下' }])
    expect((assistant[2]!.data as { message: { content: unknown[] } }).message.content).toEqual([{ type: 'text', text: '静默答案' }])
    expect(events.filter(e => e.type === 'tool/call')).toHaveLength(1)
    expectStepBoundaries(child)
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
  })

  it('settles error when session/new fails (auth) and reclaims the runtime', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-9'))
    m.queueChild(new FakeAcpServer({ failSessionNew: 'Authentication required' }))
    await expect(m.driver.startRound(request() as never, roundSpec(m, child))).rejects.toThrow('Authentication required')
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    expect(child.snapshotEvents().filter(e => e.type === 'turn/start')).toHaveLength(0)
    // A round failure, not a broken channel.
    expect(m.driver.disabled).toBe(false)
  })
})

describe('kimi live driver final-step usage (room 75844e33 turn 12)', () => {
  it('a multi-step round\'s final reply carries its own step\'s usage when the wire lands with the prompt', async () => {
    // In the wild (room 75844e33, turn 12, 17:14): think+tool, think+text+tools,
    // think+text. kimi wrote the final step's usage.record, its content and
    // step.end within 8 ms, as the prompt resolved; the reply landed with no
    // usage and the record became the round's unattached rest.
    const m = mount({ config: { snapshotMinIntervalMs: 0 }, timeouts: { ...DEFAULT_TIMEOUTS, settleFoldWaitMs: 10_000 } })
    const child = Session.create(SessionId('child-kimi-final-usage'))
    const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    const loop = (event: Record<string, unknown>) => JSON.stringify({ type: 'context.append_loop_event', event: { turnId: 0, ...event } })
    const usage = (input: number, output: number) => JSON.stringify({ type: 'usage.record', usage: { inputOther: input, output } })
    const call = (id: string, step: number) => loop({ type: 'tool.call', step, toolCallId: id, toolCall: { name: 'canvas_write', args: { id } } })
    const result = (id: string) => loop({ type: 'tool.result', toolCallId: id, result: { output: `ok ${id}` } })
    const lines: string[] = [JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '建画布' }], origin: { kind: 'user' } })]
    const flush = (...more: string[]): void => { lines.push(...more); writeFileSync(join(wireDir, 'wire.jsonl'), lines.join('\n') + '\n') }
    const fake = new FakeAcpServer({ turn: () => { flush(); return { hang: true } } })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    const session = 'session_acp-session-1'
    // Step 1: think, one tool.
    fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '先建画布' } })
    flush(loop({ type: 'step.begin', step: 1 }), usage(1, 1), loop({ type: 'content.part', step: 1, part: { type: 'think', think: '先建画布' } }), call('a', 1))
    fake.update(session, { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'canvas_open', status: 'in_progress' })
    flush(result('a'), loop({ type: 'step.end', step: 1 }))
    await new Promise(resolve => setTimeout(resolve, 150))
    // Step 2: think, text, four parallel tools — their ACP notifications
    // arrive, and step 3's thinking starts streaming, BEFORE the wire flushes
    // step 2 (the real fold of step 3 landed 5 s after its step.end).
    fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '落四张卡' } })
    fake.update(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '我先落卡' } })
    for (const id of ['b', 'c', 'd', 'e']) fake.update(session, { sessionUpdate: 'tool_call', toolCallId: id, title: 'canvas_write', status: 'in_progress' })
    await new Promise(resolve => setTimeout(resolve, 150))
    fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '收尾' } })
    await new Promise(resolve => setTimeout(resolve, 150))
    flush(loop({ type: 'step.begin', step: 2 }), usage(2, 2), loop({ type: 'content.part', step: 2, part: { type: 'think', think: '落四张卡' } }),
      loop({ type: 'content.part', step: 2, part: { type: 'text', text: '我先落卡' } }),
      call('b', 2), call('c', 2), call('d', 2), call('e', 2), result('b'), result('c'), result('d'), result('e'),
      loop({ type: 'step.end', step: 2 }), loop({ type: 'step.begin', step: 3 }))
    await new Promise(resolve => setTimeout(resolve, 300))
    // Step 3's answer streams live; the wire gets its record, content and
    // step.end in one burst, and the prompt resolves with it.
    fake.update(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '画布已建好' } })
    await new Promise(resolve => setTimeout(resolve, 150))
    const burst = (): void => flush(usage(3, 3), loop({ type: 'content.part', step: 3, part: { type: 'think', think: '收尾' } }),
      loop({ type: 'content.part', step: 3, part: { type: 'text', text: '画布已建好' } }), loop({ type: 'step.end', step: 3 }))
    // The wire's event times say the burst came with the prompt's end; its
    // disk write can trail that a little.
    setTimeout(burst, 50)
    fake.resolvePrompt({ stopReason: 'end_turn' })
    expect((await run.result).stopReason).toBe('completed')
    const messages = child.snapshotEvents().filter(e => e.type === 'assistant/message')
    const final = messages.at(-1)!
    expect(JSON.stringify((final.data as { message: unknown }).message)).toContain('画布已建好')
    expect(messages.map(e => (e.data as { usage?: { inputTokens: number } }).usage?.inputTokens)).toEqual([1, 2, 3])
    // Nothing was written from live text and no usage went unattached: the
    // diagnostics file stays empty.
    expect(existsSync(join(m.homeDir, 'usage-diag.jsonl'))).toBe(false)
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
  }, 20_000)

  it('a call\'s reasoning that streams before the previous call folds rides its own call\'s step (one step per model call)', async () => {
    // In the wild (member c937f309, turn 6 steps 166/167): call B was a lone
    // Edit; call C's reasoning streamed before B's wire step folded, and B's
    // fold sealed that reasoning as its own usage-less step ahead of B's —
    // Context Lens then read it as a request of its own.
    const m = mount({ config: { snapshotMinIntervalMs: 0 }, timeouts: { ...DEFAULT_TIMEOUTS, mirrorThrottleMs: 0, settleFoldWaitMs: 10_000 } })
    const liveStreams = new LocalAgentStreams()
    const published = vi.spyOn(liveStreams, 'publish')
    Object.assign(m.ctx.localAgent, { liveStreams })
    const child = Session.create(SessionId('child-kimi-split-call'))
    const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    const loop = (event: Record<string, unknown>) => JSON.stringify({ type: 'context.append_loop_event', event: { turnId: 0, ...event } })
    const usage = (input: number, output: number) => JSON.stringify({ type: 'usage.record', usage: { inputOther: input, output } })
    const call = (id: string, name: string, step: number) => loop({ type: 'tool.call', step, toolCallId: id, toolCall: { name, args: { id } } })
    const result = (id: string) => loop({ type: 'tool.result', toolCallId: id, result: { output: `ok ${id}` } })
    const lines: string[] = [JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '修过滤' }], origin: { kind: 'user' } })]
    const flush = (...more: string[]): void => { lines.push(...more); writeFileSync(join(wireDir, 'wire.jsonl'), lines.join('\n') + '\n') }
    const fake = new FakeAcpServer({ turn: () => { flush(); return { hang: true } } })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    const session = 'session_acp-session-1'
    const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    // Call A: reasoning + Read, folded.
    fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '先读文件' } })
    flush(loop({ type: 'step.begin', step: 1 }), usage(1, 1), loop({ type: 'content.part', step: 1, part: { type: 'think', think: '先读文件' } }), call('a', 'Read', 1))
    fake.update(session, { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'Read', status: 'in_progress' })
    flush(result('a'), loop({ type: 'step.end', step: 1 }))
    fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '' } }) // an empty chunk: only a mirror pass
    await pause(150)
    // Call C's reasoning streams first (B's notification raced behind the
    // wire), then call B — a lone Edit — lands on the wire and folds.
    fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '再跑' } })
    await pause(100)
    flush(loop({ type: 'step.begin', step: 2 }), usage(2, 2), call('b', 'Edit', 2), result('b'), loop({ type: 'step.end', step: 2 }), loop({ type: 'step.begin', step: 3 }))
    fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '测试' } })
    await pause(150)
    const afterB = child.snapshotEvents().filter(e => e.type === 'assistant/message')
    expect(afterB.map(e => (e.data as { message: { content: { type: string }[] } }).message.content.map(block => block.type)))
      .toEqual([['reasoning', 'tool-call'], ['tool-call']])
    // C's preview moved off the step the log gave B, and kept streaming.
    const bStep = (afterB[1]!.data as { step: number }).step
    const cPreview = published.mock.calls.map(([, item]) => item).filter(item => item.kind === 'think' && item.text.startsWith('再跑'))
    expect(cPreview.at(-1)).toMatchObject({ text: '再跑测试' })
    expect(cPreview.at(-1)!.step).toBeGreaterThan(bStep)
    // Call C: its reasoning and Bash in one step; then the answer.
    fake.update(session, { sessionUpdate: 'tool_call', toolCallId: 'c', title: 'Bash', status: 'in_progress' })
    flush(usage(3, 3), loop({ type: 'content.part', step: 3, part: { type: 'think', think: '再跑测试' } }), call('c', 'Bash', 3), result('c'), loop({ type: 'step.end', step: 3 }))
    fake.update(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '修好了' } })
    flush(loop({ type: 'step.begin', step: 4 }), usage(4, 4), loop({ type: 'content.part', step: 4, part: { type: 'text', text: '修好了' } }), loop({ type: 'step.end', step: 4 }))
    fake.resolvePrompt({ stopReason: 'end_turn' })
    expect((await run.result).stopReason).toBe('completed')
    const messages = child.snapshotEvents().filter(e => e.type === 'assistant/message')
    expect(messages.map(e => (e.data as { message: { content: { type: string }[] } }).message.content.map(block => block.type)))
      .toEqual([['reasoning', 'tool-call'], ['tool-call'], ['reasoning', 'tool-call'], ['text']])
    expect(messages.map(e => (e.data as { usage?: { inputTokens: number } }).usage?.inputTokens)).toEqual([1, 2, 3, 4])
    // Nothing was written from live text.
    expect(existsSync(join(m.homeDir, 'usage-diag.jsonl'))).toBe(false)
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
    liveStreams.dispose()
  }, 20_000)

  it('a reply written from live text leaves a diagnostics line naming the path', async () => {
    // No wire behind the stream: settle finalizes the answer from its live
    // text, without usage of its own — exactly the event the next lost usage
    // must be traceable to.
    const m = mount({ config: { snapshotMinIntervalMs: 0 } })
    const child = Session.create(SessionId('child-kimi-usage-diag'))
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['只有实时文本'] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    const lines = readFileSync(join(m.homeDir, 'usage-diag.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toContainEqual(expect.objectContaining({ at: 'finalize-from-live', via: 'settle', child: 'child-kimi-usage-diag', turn: 1, withUsage: true, roundUsage: null }))
    await m.driver.disposeAll()
  })
})

describe('kimi live driver lifecycle', () => {
  it('reclaims the idle runtime (stdin EOF, no SIGTERM when it cooperates)', async () => {
    const m = mount({ config: { liveIdleMs: 30 } })
    const child = Session.create(SessionId('child-kimi-10'))
    const fake = new FakeAcpServer({ turn: () => ({ chunks: ['done'] }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    expect(fake.stdinEnded).toBe(true)
    expect(fake.terminated).toBe(false)
  })

  it('cancel during the handshake window settles aborted and reclaims without tripping the breaker', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-11'))
    const fake = new FakeAcpServer({ silent: ['initialize'] })
    m.queueChild(fake)
    const controller = new AbortController()
    const start = Date.now()
    const pending = m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    setTimeout(() => { controller.abort() }, 20)
    const run = await pending
    expect(Date.now() - start).toBeLessThan(5_000)
    expect((await run.result).stopReason).toBe('aborted')
    expect(child.snapshotEvents()).toHaveLength(0)
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    expect(m.driver.disabled).toBe(false)
  })

  it('trips the breaker when kimi acp lacks loadSession (crash recovery impossible)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-12'))
    m.queueChild(new FakeAcpServer({ noLoadSession: true }))
    await expect(m.driver.startRound(request() as never, roundSpec(m, child))).rejects.toThrow('loadSession')
    expect(m.driver.disabled).toBe(true)
  })

  it('disposeAll reclaims every runtime (no zombies on profile restart)', async () => {
    const m = mount()
    const first = Session.create(SessionId('child-kimi-13a'))
    const second = Session.create(SessionId('child-kimi-13b'))
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['a'] }) }))
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['b'] }) }))
    const runA = await m.driver.startRound(request() as never, roundSpec(m, first))
    const runB = await m.driver.startRound(request() as never, roundSpec(m, second))
    await Promise.all([runA.result, runB.result])
    expect(m.driver.liveCount).toBe(2)
    await m.driver.disposeAll()
    expect(m.driver.liveCount).toBe(0)
    for (const spawn of m.spawns) {
      expect(spawn.fake!.stdinEnded).toBe(true)
    }
  })
})

describe('kimi provider live dispatch', () => {
  it('routes rounds to the live driver and records the delegation with the ACP session id', async () => {
    const m = mount()
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['完成'] }) }))
    const provider = new KimiCliProvider(m.ctx, m.driver)
    const run = await provider.start(request() as never)
    expect((await run.result).stopReason).toBe('completed')
    expect(m.spawns[0]!.spec.argv).toEqual(['kimi', 'acp'])
    expect(m.records).toHaveBeenCalledTimes(1)
    const record = m.records.mock.calls[0]![0] as { childSessionId: string; cliSessionId: string; provider: string }
    expect(record.provider).toBe('kimi-cli')
    expect(record.cliSessionId).toBe('acp-session-1')
    await m.driver.disposeAll()
  })

  it('falls back to the exec one-shot when the ACP handshake fails', async () => {
    const m = mount()
    m.queueChild(new FakeAcpServer({ silent: ['initialize'] }))
    const driver = new KimiAcpLiveDriver(m.ctx, {}, { initializeMs: 50, requestMs: 50, convergeMs: 50, channelRetryMs: 60_000, mirrorThrottleMs: 10 })
    const provider = new KimiCliProvider(m.ctx, driver)
    const run = await provider.start(request() as never)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'exec 答案' }])
    expect(m.spawns).toHaveLength(2)
    expect(m.spawns[1]!.spec.argv).toEqual(['kimi', '-p', '建个文件'])
    expect(driver.disabled).toBe(true)
    await run.dispose()
  })
})

describe('kimi live driver review fixes', () => {
  it('reports auth-shaped session failures to the registry mark', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-fix1'))
    const authMarks: string[][] = []
    const registry = m.ctx.localAgent as unknown as { reportAuthFailure?: (h: string, d: string) => void }
    registry.reportAuthFailure = (h, d) => { authMarks.push([h, d]) }
    m.queueChild(new FakeAcpServer({ failSessionNew: 'Authentication required' }))
    await expect(m.driver.startRound(request() as never, roundSpec(m, child))).rejects.toThrow('Authentication required')
    expect(authMarks).toHaveLength(1)
    expect(authMarks[0]![0]).toBe('kimi')
  })

  it('an end_turn with no answer is an error, never a silent success', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-fix2'))
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: [], stopReason: 'end_turn' }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('error')
    expect(child.snapshotEvents().find(e => e.type === 'turn/end')?.data).toMatchObject({ reason: { kind: 'error' } })
    await m.driver.disposeAll()
  })

  it('a live-backed child folds each line once, persisting only through the core sync (never the redundant full-list append)', async () => {
    const m = mount({
      strictPersistence: true,
      timeouts: { initializeMs: 5_000, requestMs: 5_000, convergeMs: 50, channelRetryMs: 60_000, mirrorThrottleMs: 0, settleFoldWaitMs: 0 },
    })
    const child = Session.create(SessionId('child-kimi-livepersist'))
    // The ACP runtime flushes the wire incrementally: the prompt line first.
    const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    const fake = new FakeAcpServer({
      turn: () => {
        writeFileSync(join(wireDir, 'wire.jsonl'), `${JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }], origin: { kind: 'user' } })}\n`)
        return { hang: true }
      },
    })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    // A mid-run update triggers a throttled pass over the prompt-only wire.
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '文件建好了' } })
    // The round-start user/message is already there (the driver appends it at
    // turn start); the wire's copy folds to a dedupe skip, so the offset has
    // nothing new to advance yet.
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'user/message')).toHaveLength(1) })
    expect(m.mirrorOffsets.get('child-kimi-livepersist')).toBeUndefined()
    // The full wire lands by turn end — in the real kimi order, where the
    // request's usage.record sits BEFORE the content parts it accounts for
    // (record.line == the pass's fromLines boundary).
    writeFileSync(join(wireDir, 'wire.jsonl'), [
      JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }], origin: { kind: 'user' } }),
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 10, output: 4 } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, part: { type: 'text', text: '文件建好了' } } }),
    ].join('\n') + '\n')
    fake.resolvePrompt({ stopReason: 'end_turn' })
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1) })
    // The offset advanced with persistence flowing only through the core sync
    // (the strict double never fired), so the settle pass did NOT re-fold the
    // user line; the usage record on the delta boundary still attached to the
    // answer it accounts for.
    expect(child.snapshotEvents().filter(e => e.type === 'user/message')).toHaveLength(1)
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')[0]?.data).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 4 },
    })
    expect(m.mirrorOffsets.get('child-kimi-livepersist')).toBe(2)
    // The question precedes everything else in the turn (round-start append),
    // so streamed chunks can never render above it.
    const userSeq = child.snapshotEvents().find(e => e.type === 'user/message')!.seq
    const turnStartSeq = child.snapshotEvents().find(e => e.type === 'turn/start')!.seq
    expect(userSeq).toBeGreaterThan(turnStartSeq)
    expect(userSeq).toBeLessThan(child.snapshotEvents().filter(e => e.type === 'assistant/message')[0]!.seq)
    await m.driver.disposeAll()
  })

  it('the settle fold waits out a wire flush that lands after the prompt response', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-flushrace'))
    const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    const fake = new FakeAcpServer({
      turn: () => {
        // Only the prompt line is on disk when the prompt resolves.
        writeFileSync(join(wireDir, 'wire.jsonl'), `${JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }], origin: { kind: 'user' } })}\n`)
        return { chunks: ['文件建好了'] }
      },
    })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    // The answer lands in the wire 500ms after the prompt response — inside
    // the quiescence window (3 stable reads at 300ms).
    setTimeout(() => { writeKimiWire(m.homeDir, 'acp-session-1', '建个文件', '文件建好了') }, 500)
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1) }, { timeout: 5_000 })
    expect(child.snapshotEvents().filter(e => e.type === 'user/message')).toHaveLength(1)
    expect(m.mirrorOffsets.get('child-kimi-flushrace')).toBe(2)
    await m.driver.disposeAll()
  })
})

describe('kimi live driver drain (settings handoff)', () => {
  it('refuses new rounds immediately once draining (no queueing behind in-flight work)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-drain1'))
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['done'] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.driver.hasRuntime('child-kimi-drain1')).toBe(true)
    const drained = m.driver.drain()
    await expect(m.driver.startRound(request() as never, roundSpec(m, child))).rejects.toThrow('draining')
    await drained
    expect(m.driver.liveCount).toBe(0)
    expect(m.driver.hasRuntime('child-kimi-drain1')).toBe(false)
  })

  it('lets the in-flight round finish undisturbed, then reclaims the runtime', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-drain2'))
    const fake = new FakeAcpServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    let drainedFlag = false
    const drained = m.driver.drain().then(() => { drainedFlag = true })
    // The hung round is still in flight: drain waits, the process lives.
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(drainedFlag).toBe(false)
    expect(fake.stdinEnded).toBe(false)
    fake.resolvePrompt({ stopReason: 'end_turn' })
    // The in-flight turn settles normally (its chunks accumulated).
    expect((await run.result).stopReason === 'error' || (await run.result).stopReason === 'completed').toBe(true)
    await drained
    expect(m.driver.liveCount).toBe(0)
    expect(fake.stdinEnded).toBe(true)
  })

  it('a round queued before the drain dequeues into the refusal (provider falls back to exec)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-drain3'))
    const fake = new FakeAcpServer({
      turn: params => (params['prompt'] as { text: string }[])[0]!.text === '第二轮' ? { chunks: ['不该发生'] } : { hang: true },
    })
    m.queueChild(fake)
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    // Chain round 2 BEFORE draining, then drain while round 1 hangs.
    const second = m.driver.startRound(request({ prompt: '第二轮' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))
    const drained = m.driver.drain()
    fake.resolvePrompt({ stopReason: 'end_turn' })
    await first.result.catch(() => {})
    await expect(second).rejects.toThrow('draining')
    await drained
    // Round 2 never reached the wire.
    expect(fake.requests.filter(r => r.method === 'session/prompt')).toHaveLength(1)
    expect(m.driver.liveCount).toBe(0)
  })

  it('a resume round rides the same generation and folds incrementally', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-drain4'))
    child.append('turn/start', { turn: 1 })
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['一', '二'] }) }))
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    await first.result
    // Without a wire file the live stream still finalizes in the transcript.
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1)
    const second = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))
    await second.result
    // Token granularity: no wire lines folded, so the unfinished stream
    // finalizes at settle with one forced snapshot at its reserved step.
    await vi.waitFor(() => {
      expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(2)
    }, { timeout: 5_000 })
    const final = child.snapshotEvents().find(e => e.type === 'assistant/message' && (e.data as { turn: number }).turn === 2)!
    expect(final.data).toMatchObject({ turn: 2 })
    expect((final.data as { message: { content: unknown[] } }).message.content).toEqual([{ type: 'text', text: '一二' }])
    // Same runtime, same process: granularity rides the existing generation.
    expect(m.spawns).toHaveLength(1)
    await m.driver.disposeAll()
  })
})

describe('kimi provider live resolver', () => {
  it('a resolver returning undefined routes the round to exec (retiring-generation gate)', async () => {
    const m = mount()
    // No ACP child queued: the exec fallback spawn answers.
    const provider = new KimiCliProvider(m.ctx, () => undefined)
    const run = await provider.start(request() as never)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'exec 答案' }])
    expect(m.spawns[0]!.spec.argv).toEqual(['kimi', '-p', '建个文件'])
    await run.dispose()
  })

  it('a resolver returning the driver per member routes to live (backward compatible)', async () => {
    const m = mount()
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['完成'] }) }))
    const provider = new KimiCliProvider(m.ctx, () => m.driver)
    const run = await provider.start(request() as never)
    expect((await run.result).stopReason).toBe('completed')
    expect(m.spawns[0]!.spec.argv).toEqual(['kimi', 'acp'])
    await m.driver.disposeAll()
  })
})

describe('kimi live driver model key', () => {
  it('set: the scoped default_model is pinned before the runtime spawns (kimi acp takes no -m)', async () => {
    const m = mount({ config: { model: () => 'card-model' } })
    writeFileSync(join(m.homeDir, 'config.toml'), 'default_model = "scoped-model"\n')
    const child = Session.create(SessionId('child-kimi-model'))
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['ok'] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    // The argv is untouched — the CLI has no flag for this — and the config
    // the spawned process reads now names the configured model.
    expect(m.spawns[0]!.spec.argv).toEqual(['kimi', 'acp'])
    await expect(readKimiDefaultModel(m.homeDir)).resolves.toBe('card-model')
  })

  it('unset: the scoped config is left exactly as it was', async () => {
    const m = mount()
    writeFileSync(join(m.homeDir, 'config.toml'), 'default_model = "scoped-model"\n')
    const child = Session.create(SessionId('child-kimi-model-off'))
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['ok'] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    await expect(readKimiDefaultModel(m.homeDir)).resolves.toBe('scoped-model')
  })

  it('a home whose config cannot be written still gets its runtime', async () => {
    // No config.toml at all: the write reports false and the round proceeds
    // on whatever the CLI resolves for itself.
    const m = mount({ config: { model: () => 'card-model' } })
    const child = Session.create(SessionId('child-kimi-model-noconfig'))
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['ok'] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
  })
})

describe('kimi live driver member model', () => {
  it('a model switch retires the member runtime; the next round respawns onto the new model', async () => {
    let current: string | undefined = 'model-a'
    const m = mount({ config: { model: () => current } })
    writeFileSync(join(m.homeDir, 'config.toml'), 'default_model = "scoped-model"\n')
    const child = Session.create(SessionId('child-kimi-switch'))
    const first = new FakeAcpServer({ turn: () => ({ chunks: ['一'] }) })
    m.queueChild(first)
    const run1 = await m.driver.startRound(request() as never, roundSpec(m, child, { onCliSessionId: () => {} }))
    await run1.result
    await expect(readKimiDefaultModel(m.homeDir)).resolves.toBe('model-a')
    expect(m.driver.runtimeModel('child-kimi-switch')).toBe('model-a')
    // The switch: the member's next round finds the runtime bound to the old
    // model, retires it, and respawns bound to the new one — session/load-ing
    // the SAME CLI session (the conversation carries over).
    current = 'model-b'
    const second = new FakeAcpServer({ turn: () => ({ chunks: ['二'] }) })
    m.queueChild(second)
    const run2 = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))
    expect((await run2.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(first.stdinEnded || first.terminated).toBe(true) })
    expect(m.spawns).toHaveLength(2)
    await expect(readKimiDefaultModel(m.homeDir)).resolves.toBe('model-b')
    expect(second.requests.map(r => r.method)).toEqual(['initialize', 'session/load', 'session/prompt'])
    expect(m.driver.runtimeModel('child-kimi-switch')).toBe('model-b')
    await m.driver.disposeAll()
  })

  it('a runtime bound to the resolved model is reused untouched', async () => {
    const m = mount({ config: { model: () => 'model-a' } })
    writeFileSync(join(m.homeDir, 'config.toml'), 'default_model = "scoped-model"\n')
    const child = Session.create(SessionId('child-kimi-same-model'))
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['ok'] }) }))
    const run1 = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run1.result
    const run2 = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))
    expect((await run2.result).stopReason).toBe('completed')
    // Same model → same runtime: one spawn, and no session/load on reuse.
    expect(m.spawns).toHaveLength(1)
    expect(m.spawns[0]!.fake!.requests.map(r => r.method)).toEqual(['initialize', 'session/new', 'session/prompt', 'session/prompt'])
    await m.driver.disposeAll()
  })

  it('retireRuntime reclaims only that member\'s runtime; the next round respawns lazily', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-retire'))
    const first = new FakeAcpServer({ turn: () => ({ chunks: ['ok'] }) })
    m.queueChild(first)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.driver.liveCount).toBe(1)
    await m.driver.retireRuntime('child-kimi-retire')
    expect(m.driver.liveCount).toBe(0)
    await vi.waitFor(() => { expect(first.stdinEnded || first.terminated).toBe(true) })
    // Nothing respawned yet (lazy): the member's NEXT round spawns fresh and
    // session/loads the recorded session.
    expect(m.spawns).toHaveLength(1)
    const second = new FakeAcpServer({ turn: () => ({ chunks: ['back'] }) })
    m.queueChild(second)
    const run2 = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))
    expect((await run2.result).stopReason).toBe('completed')
    expect(second.requests.map(r => r.method)).toEqual(['initialize', 'session/load', 'session/prompt'])
    await m.driver.disposeAll()
  })

  it('respawns a member process whose mode tools went missing at its next round start, never mid-round', async () => {
    const m = mount()
    const tokens: string[] = []
    const stale = vi.fn(async (_token: string): Promise<string | undefined> => undefined)
    const released: string[] = []
    const warn = vi.fn()
    Object.assign(m.ctx.logger, { warn })
    Object.assign(m.ctx.localAgent, {
      registerMemberRun: () => { tokens.push(`token-${tokens.length + 1}`); return tokens.at(-1)! },
      unregisterMemberRun: (token: string) => { released.push(token) },
      memberBridgeSocketPath: () => '/home/user/member.sock',
      memberBridgeCommand: () => ({ command: 'node', args: ['member-bridge.js'] }),
      memberToolsStale: stale,
    })
    const child = Session.create(SessionId('child-kimi-tools'))
    const first = new FakeAcpServer({ turn: (params) => {
      const text = JSON.stringify(params['prompt'])
      return text.includes('慢') ? { hang: true } : { chunks: ['ok'] }
    } })
    m.queueChild(first)
    // The first round spawns: nothing to check yet.
    await (await m.driver.startRound(request() as never, roundSpec(m, child))).result
    expect(stale).not.toHaveBeenCalled()
    // A healthy process is kept: one check, no respawn.
    await (await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))).result
    expect(stale).toHaveBeenCalledTimes(1)
    expect(stale).toHaveBeenLastCalledWith('token-1')
    expect(m.spawns).toHaveLength(1)

    // A round in flight is never interrupted: the next round's check waits for it.
    const slow = await m.driver.startRound(request({ prompt: '慢' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 3 } }))
    await vi.waitFor(() => { expect(first.pendingPrompts).toHaveLength(1) })
    stale.mockResolvedValue('it was served the mode-tools placeholder (socket refused)')
    const second = new FakeAcpServer({ turn: () => ({ chunks: ['back'] }) })
    m.queueChild(second)
    const next = m.driver.startRound(request({ prompt: '发布' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 4 } }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(stale).toHaveBeenCalledTimes(2)
    expect(first.terminated || first.stdinEnded).toBe(false)
    first.resolvePrompt({ stopReason: 'end_turn' })
    await (await slow).result

    // Between rounds: the stale process is retired and the round runs on a fresh one.
    expect((await (await next).result).stopReason).toBe('completed')
    expect(stale).toHaveBeenCalledTimes(3)
    expect(m.spawns).toHaveLength(2)
    await vi.waitFor(() => { expect(first.stdinEnded || first.terminated).toBe(true) })
    expect(second.requests.map(r => r.method)).toEqual(['initialize', 'session/load', 'session/prompt'])
    expect(released).toContain('token-1')
    expect(tokens).toEqual(['token-1', 'token-2'])
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/respawning member child-kimi-tools's kimi process before its round: it was served the mode-tools placeholder/))
    await m.driver.disposeAll()
  })
})

describe('kimi live driver member reload (the room\'s 重新载入)', () => {
  it('an idle member reloads now: a fresh process session/loads the same session, with no prompt', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-reload'))
    const first = new FakeAcpServer({ turn: () => ({ chunks: ['ok'] }) })
    m.queueChild(first)
    await (await m.driver.startRound(request() as never, roundSpec(m, child, { onCliSessionId: () => {} }))).result
    // The round's queue entry settles right after its result.
    await new Promise(resolve => setTimeout(resolve, 0))
    const second = new FakeAcpServer({ turn: () => ({ chunks: ['back'] }) })
    m.queueChild(second)
    const onStart = vi.fn()
    const reload = m.driver.reloadMember('child-kimi-reload', { onStart })
    expect(reload?.when).toBe('now')
    await expect(reload!.done).resolves.toBe('respawned')
    expect(onStart).toHaveBeenCalledOnce()
    await vi.waitFor(() => { expect(first.stdinEnded || first.terminated).toBe(true) })
    // No round, no model call: the new process only loads the session (kimi lists the bridge there).
    expect(second.requests.map(r => r.method)).toEqual(['initialize', 'session/load'])
    // The same kimi session, in its ACP form (as every resume sends it).
    expect(second.requests[1]!.params).toMatchObject({ sessionId: 'session_acp-session-1' })
    // The next round runs on the reloaded process.
    await (await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))).result
    expect(m.spawns).toHaveLength(2)
    expect(second.requests.map(r => r.method)).toEqual(['initialize', 'session/load', 'session/prompt'])
    await m.driver.disposeAll()
  })

  it('a running member reloads after its round ends, never during it', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-reload-run'))
    const first = new FakeAcpServer({ turn: (params) => JSON.stringify(params['prompt']).includes('慢') ? { hang: true } : { chunks: ['ok'] } })
    m.queueChild(first)
    await (await m.driver.startRound(request() as never, roundSpec(m, child))).result
    const slow = await m.driver.startRound(request({ prompt: '慢' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))
    await vi.waitFor(() => { expect(first.pendingPrompts).toHaveLength(1) })
    const second = new FakeAcpServer({ turn: () => ({ chunks: ['back'] }) })
    m.queueChild(second)
    const onStart = vi.fn()
    const reload = m.driver.reloadMember('child-kimi-reload-run', { onStart })
    expect(reload?.when).toBe('after-round')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onStart).not.toHaveBeenCalled()
    expect(first.terminated || first.stdinEnded).toBe(false)
    expect(m.spawns).toHaveLength(1)
    first.resolvePrompt({ stopReason: 'end_turn' })
    await slow.result
    await expect(reload!.done).resolves.toBe('respawned')
    expect(onStart).toHaveBeenCalledOnce()
    expect(second.requests.map(r => r.method)).toEqual(['initialize', 'session/load'])
    await m.driver.disposeAll()
  })

  it('no resident process, nothing to reload', async () => {
    const m = mount()
    expect(m.driver.reloadMember('child-kimi-none', { onStart: () => {} })).toBeUndefined()
    await m.driver.disposeAll()
  })

  it('立即载入: a member with no process gets one that session/loads its recorded session, with no prompt', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-start'))
    expect(m.driver.canStartMember('child-kimi-start')).toBe(true)
    const server = new FakeAcpServer({ turn: () => ({ chunks: ['back'] }) })
    m.queueChild(server)
    // The spec the core builds from the durable record after a host restart.
    await expect(m.driver.startMember(roundSpec(m, child, { resume: { cliSessionId: 'acp-session-9', turn: 3 } }))).resolves.toBe('respawned')
    expect(server.requests.map(r => r.method)).toEqual(['initialize', 'session/load'])
    expect(server.requests[1]!.params).toMatchObject({ sessionId: 'session_acp-session-9' })
    // It holds a process now: no second start, and the next round reuses it.
    expect(m.driver.canStartMember('child-kimi-start')).toBe(false)
    await expect(m.driver.startMember(roundSpec(m, child, { resume: { cliSessionId: 'acp-session-9', turn: 3 } }))).resolves.toBe('no-process')
    await (await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-9', turn: 3 } }))).result
    expect(m.spawns).toHaveLength(1)
    expect(server.requests.map(r => r.method)).toEqual(['initialize', 'session/load', 'session/prompt'])
    await m.driver.disposeAll()
  })

  it('立即载入 never starts a member that is running a round', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-start-run'))
    const server = new FakeAcpServer({ turn: () => ({ hang: true }) })
    m.queueChild(server)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect(m.driver.canStartMember('child-kimi-start-run')).toBe(false)
    await expect(m.driver.startMember(roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))).resolves.toBe('no-process')
    expect(m.spawns).toHaveLength(1)
    void run.result.catch(() => {})
    await m.driver.disposeAll()
  })

  it('a round-start respawn is reported to the core with the replaced process\'s token', async () => {
    const m = mount()
    const tokens: string[] = []
    const noteMemberToolsRespawn = vi.fn()
    Object.assign(m.ctx.logger, { warn: vi.fn() })
    Object.assign(m.ctx.localAgent, {
      registerMemberRun: () => { tokens.push(`token-${tokens.length + 1}`); return tokens.at(-1)! },
      unregisterMemberRun: () => {},
      memberBridgeSocketPath: () => '/home/user/member.sock',
      memberBridgeCommand: () => ({ command: 'node', args: ['member-bridge.js'] }),
      memberToolsStale: async () => 'it was served the mode-tools placeholder (socket refused)',
      noteMemberToolsRespawn,
    })
    const child = Session.create(SessionId('child-kimi-note'))
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['ok'] }) }))
    await (await m.driver.startRound(request() as never, roundSpec(m, child))).result
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['back'] }) }))
    await (await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))).result
    expect(noteMemberToolsRespawn).toHaveBeenCalledExactlyOnceWith('child-kimi-note', 'token-1')
    await m.driver.disposeAll()
  })
})

describe('kimi live driver transcript completeness', () => {
  /** Every reasoning block the child session carries. */
  function reasoningTexts(child: Session): string[] {
    return child.snapshotEvents()
      .filter(e => e.type === 'assistant/message')
      .flatMap(e => ((e.data as { message?: { content?: { type: string; text?: string }[] } }).message?.content ?? []))
      .filter(block => block.type === 'reasoning')
      .map(block => block.text ?? '')
  }

  it('a non-text agent_message_chunk folds a visible placeholder instead of vanishing', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-nontext'))
    const fake = new FakeAcpServer({
      turn: () => {
        queueMicrotask(() => {
          fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'iVBOR…' } })
          fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '见图' } })
        })
        return { chunks: [] }
      },
    })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: '[未支持的内容类型 image]见图' }])
    await m.driver.disposeAll()
  })

  it('folds ACP plan updates as the host todo list, never as a step after the answer', async () => {
    const m = mount({ config: { snapshotMinIntervalMs: 0, snapshotMinChars: 0 } })
    const child = Session.create(SessionId('child-kimi-plan-token'))
    const fake = new FakeAcpServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    fake.update('session_acp-session-1', {
      sessionUpdate: 'plan',
      entries: [
        { content: '第一步', status: 'completed' },
        { content: '第二步', status: 'in_progress' },
      ],
    })
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '建好了' } })
    writeKimiWire(m.homeDir, 'acp-session-1', '建个文件', '建好了')
    fake.resolvePrompt({ stopReason: 'end_turn' })
    expect((await run.result).stopReason).toBe('completed')
    const todos = child.snapshotEvents().filter(e => e.type === ('todo/write' as never)).map(e => e.data)
    expect(todos.at(-1)).toEqual({ todos: [{ content: '第一步', status: 'completed' }, { content: '第二步', status: 'in_progress' }] })
    // The answer is the round's last step: the chat shows it, not the plan.
    const messages = child.snapshotEvents().filter(e => e.type === 'assistant/message')
    expect(JSON.stringify((messages.at(-1)!.data as { message: unknown }).message)).toContain('建好了')
    expect(reasoningTexts(child).some(text => text.includes('第一步'))).toBe(false)
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
  })

  it('default live output retains ACP plans that have no wire copy', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-plan-event'))
    const fake = new FakeAcpServer({
      turn: (params) => {
        queueMicrotask(() => {
          fake.update('session_acp-session-1', { sessionUpdate: 'plan', entries: [{ content: '唯一步骤', status: 'in_progress' }] })
        })
        writeKimiWire(m.homeDir, 'acp-session-1', String((params['prompt'] as { text: string }[])[0]!.text), 'done')
        return { chunks: ['done'] }
      },
    })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => {
      expect(child.snapshotEvents().filter(e => e.type === ('todo/write' as never)).map(e => e.data))
        .toEqual([{ todos: [{ content: '唯一步骤', status: 'in_progress' }] }])
    }, { timeout: 5_000 })
    await m.driver.disposeAll()
  })
})


it('prepares native protocol without a prompt, then reuses it for the first real turn', async () => {
  const m = mount()
  const child = Session.create(SessionId('prepared-member'))
  const fake = new FakeAcpServer()
  m.queueChild(fake)
  const spec = roundSpec(m, child)
  await m.driver.prepare(spec, new AbortController().signal)
  expect(fake.requests.some(request => request.method === 'session/prompt')).toBe(false)
  expect(child.snapshotEvents().some(event => event.type === 'turn/start' || event.type === 'user/message')).toBe(false)
  const run = await m.driver.startRound(request() as never, spec)
  await run.result
  expect(fake.requests.filter(request => request.method === 'session/prompt')).toHaveLength(1)
  expect(m.spawns).toHaveLength(1)
  await m.driver.disposeAll()
})

describe('kimi mirror snapshot (live)', () => {
  it('a cancelled round: streamed think + text finalize from live text, an ACP-only tool folds as an orphan → the exact child-session event sequence', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: SNAPSHOT_NOW })
    const m = mount({ config: {} })
    try {
      const child = Session.create(SessionId('child-kimi-live-snapshot'))
      const execution = snapshotExecution(child, KIMI_UNRECORDED)
      m.queueChild(new FakeAcpServer({ turn: () => ({ hang: true }) }))
      const controller = new AbortController()
      const run = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
      const fake = m.spawns[0]!.fake!
      const session = 'session_acp-session-1'
      fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '先跑一下' } })
      fake.update(session, { sessionUpdate: 'tool_call', toolCallId: 'orphan_1', title: 'Bash', status: 'in_progress' })
      fake.update(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '写到一半' } })
      await until(() => m.reports.some(report => report.progress.text === '写到一半'))
      controller.abort()
      const result = await run.result
      expect(result.stopReason).toBe('aborted')
      fake.resolvePrompt({ stopReason: 'cancelled' })
      await until(() => child.snapshotEvents().some(event => event.type === 'turn/end'))
      execution.settle(result)
      expectValidReleasedLog(child)
      expect(mirrorSnapshot(child)).toMatchSnapshot()
    } finally {
      await m.driver.disposeAll()
      vi.useRealTimers()
    }
  })

  it('a completed round whose next call streams its reasoning before the previous call folds → the exact child-session event sequence', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: SNAPSHOT_NOW })
    const m = mount({ config: {}, timeouts: { ...DEFAULT_TIMEOUTS, mirrorThrottleMs: 0, settleFoldWaitMs: 5_000 } })
    try {
      const child = Session.create(SessionId('child-kimi-live-split-snapshot'))
      const execution = snapshotExecution(child, KIMI_UNRECORDED)
      const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
      mkdirSync(wireDir, { recursive: true })
      const loop = (event: Record<string, unknown>) => JSON.stringify({ type: 'context.append_loop_event', event: { turnId: 0, ...event } })
      const usage = (input: number, output: number) => JSON.stringify({ type: 'usage.record', usage: { inputOther: input, output } })
      const call = (id: string, name: string, step: number) => loop({ type: 'tool.call', step, toolCallId: id, toolCall: { name, args: { id } } })
      const result = (id: string) => loop({ type: 'tool.result', toolCallId: id, result: { output: `ok ${id}` } })
      const lines: string[] = [JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '修过滤' }], origin: { kind: 'user' } })]
      const flush = (...more: string[]): void => { lines.push(...more); writeFileSync(join(wireDir, 'wire.jsonl'), lines.join('\n') + '\n') }
      m.queueChild(new FakeAcpServer({ turn: () => { flush(); return { hang: true } } }))
      const run = await m.driver.startRound(request() as never, roundSpec(m, child))
      const fake = m.spawns[0]!.fake!
      const session = 'session_acp-session-1'
      const logged = (id: string) => () => child.snapshotEvents().some(event => event.type === 'tool/call' && (event.data as { callId?: string }).callId === id)
      // Call A: reasoning + Read.
      fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '先读文件' } })
      flush(loop({ type: 'step.begin', step: 1 }), usage(1, 1), loop({ type: 'content.part', step: 1, part: { type: 'think', think: '先读文件' } }), call('a', 'Read', 1), result('a'), loop({ type: 'step.end', step: 1 }))
      fake.update(session, { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'Read', status: 'in_progress' })
      await until(logged('a'))
      // Call C's reasoning streams before call B (a lone Edit) folds.
      fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '再跑测试' } })
      // (A thought chunk reports nothing to wait on: give the update its turn.)
      await new Promise(resolve => setTimeout(resolve, 100))
      flush(loop({ type: 'step.begin', step: 2 }), usage(2, 2), call('b', 'Edit', 2), result('b'), loop({ type: 'step.end', step: 2 }), loop({ type: 'step.begin', step: 3 }))
      fake.update(session, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '' } }) // an empty chunk: only a mirror pass
      await until(logged('b'))
      // Call C lands; then the answer.
      fake.update(session, { sessionUpdate: 'tool_call', toolCallId: 'c', title: 'Bash', status: 'in_progress' })
      flush(usage(3, 3), loop({ type: 'content.part', step: 3, part: { type: 'think', think: '再跑测试' } }), call('c', 'Bash', 3), result('c'), loop({ type: 'step.end', step: 3 }))
      await until(logged('c'))
      fake.update(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '修好了' } })
      flush(loop({ type: 'step.begin', step: 4 }), usage(4, 4), loop({ type: 'content.part', step: 4, part: { type: 'text', text: '修好了' } }), loop({ type: 'step.end', step: 4 }))
      fake.resolvePrompt({ stopReason: 'end_turn' })
      const settled = await run.result
      expect(settled.stopReason).toBe('completed')
      execution.settle(settled)
      expectValidReleasedLog(child)
      expect(mirrorSnapshot(child)).toMatchSnapshot()
    } finally {
      await m.driver.disposeAll()
      vi.useRealTimers()
    }
  })
})

describe('kimi session lock left by a dead process', () => {
  const OCCUPIED = 'This session is in use by another Kimi Code CLI instance. Stop the session in that instance or exit it, then try again.'
  const SESSION = 'session_acp-session-7'
  const KIMI_COMMAND = '/home/user/.kimi-code/bin/kimi acp'
  const RESUME = { cliSessionId: 'acp-session-7', turn: 2 }

  function lockDir(m: Mount): string {
    return join(m.homeDir, 'locks', 'sessions')
  }

  function writeLock(m: Mount, body: string): string {
    mkdirSync(lockDir(m), { recursive: true })
    const path = join(lockDir(m), `${SESSION}.lock`)
    writeFileSync(path, body)
    return path
  }

  function lockBody(pid: number, host: string): string {
    return JSON.stringify({ version: 1, token: `${pid}:test-token`, pid, hostname: host, startedAt: 1, clientIdentity: 'kimi_code_cli', clientDisplayName: 'Kimi Code CLI' })
  }

  /** kimi's refusal while the lock file exists (the fake judges every holder alive). */
  function kimiLockGate(m: Mount): FakeAcpScript['failSessionLoad'] {
    return params => existsSync(join(lockDir(m), `${String(params['sessionId'])}.lock`))
      ? { code: -32603, message: 'Internal error', data: { details: OCCUPIED } }
      : undefined
  }

  it('a lock whose process is gone on this machine is moved aside and the load succeeds', async () => {
    // A real dead pid: a child that already exited.
    const dead = spawnSync(process.execPath, ['-e', '']).pid as number
    const m = mount()
    const warns: string[] = []
    Object.assign(m.ctx.logger, { warn: (message: string) => { warns.push(message) } })
    const path = writeLock(m, lockBody(dead, hostname()))
    const server = new FakeAcpServer({ failSessionLoad: kimiLockGate(m), turn: () => ({ chunks: ['回来了'] }) })
    m.queueChild(server)
    const child = Session.create(SessionId('child-kimi-stale-lock'))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child, { resume: RESUME }))
    expect((await run.result).stopReason).toBe('completed')
    expect(existsSync(path)).toBe(false)
    const aside = readdirSync(lockDir(m)).filter(name => name.startsWith(`${SESSION}.lock.stale-`))
    expect(aside).toHaveLength(1)
    expect(readFileSync(join(lockDir(m), aside[0]!), 'utf8')).toBe(lockBody(dead, hostname()))
    expect(warns.some(warn => warn.includes('cleared a stale kimi session lock') && warn.includes(String(dead)))).toBe(true)
    expect(server.requests.map(r => r.method)).toEqual(['initialize', 'session/load', 'session/prompt'])
    await m.driver.disposeAll()
  })

  it('kimi\'s "in use" refusal re-checks the lock: a holder that died meanwhile is cleared and the load retried once', async () => {
    const m = mount({ config: { sessionLock: { pidAlive: vi.fn().mockReturnValueOnce(true).mockReturnValue(false), processCommand: async () => KIMI_COMMAND } } })
    writeLock(m, lockBody(4242, 'this-host'))
    const server = new FakeAcpServer({ failSessionLoad: kimiLockGate(m) })
    m.queueChild(server)
    await m.driver.prepare(roundSpec(m, Session.create(SessionId('child-kimi-lock-race')), { resume: RESUME }), new AbortController().signal)
    expect(server.requests.map(r => r.method)).toEqual(['initialize', 'session/load', 'session/load'])
    expect(existsSync(join(lockDir(m), `${SESSION}.lock`))).toBe(false)
    await m.driver.disposeAll()
  })

  it('a lock whose kimi process still runs is never touched; the error carries kimi\'s sentence and the holder', async () => {
    // This test process stands in for a live kimi: alive, and its command reads as kimi.
    const m = mount({ config: { sessionLock: { processCommand: async () => KIMI_COMMAND } } })
    const path = writeLock(m, lockBody(process.pid, hostname()))
    m.queueChild(new FakeAcpServer({ failSessionLoad: kimiLockGate(m) }))
    const child = Session.create(SessionId('child-kimi-live-lock'))
    const failure = await m.driver.startRound(request() as never, roundSpec(m, child, { resume: RESUME })).catch((error: unknown) => error as Error)
    expect(failure).toBeInstanceOf(KimiSessionOccupiedError)
    expect(failure.message).toContain(OCCUPIED)
    expect(failure.message).toContain(`Kimi process ${process.pid} is still running and holds it`)
    expect(failure.message).not.toContain('Internal error')
    expect(readFileSync(path, 'utf8')).toBe(lockBody(process.pid, hostname()))
    expect(readdirSync(lockDir(m))).toEqual([`${SESSION}.lock`])
    // The failed runtime is gone: nothing reuses a process whose load failed.
    expect(m.driver.liveCount).toBe(0)
    await m.driver.disposeAll()
  })

  it('a drifted hostname is no criterion: a dead pid under another hostname is cleared', async () => {
    // The prod incident: the lock read `Macmini` while os.hostname() read `<name>.local`.
    const dead = spawnSync(process.execPath, ['-e', '']).pid as number
    const m = mount()
    const path = writeLock(m, lockBody(dead, 'Macmini'))
    const server = new FakeAcpServer({ failSessionLoad: kimiLockGate(m) })
    m.queueChild(server)
    await m.driver.prepare(roundSpec(m, Session.create(SessionId('child-kimi-drifted-dead')), { resume: RESUME }), new AbortController().signal)
    expect(existsSync(path)).toBe(false)
    expect(server.requests.map(r => r.method)).toEqual(['initialize', 'session/load'])
    await m.driver.disposeAll()
  })

  it('a live kimi pid under another hostname is never touched', async () => {
    const m = mount({ config: { sessionLock: { pidAlive: () => true, processCommand: async () => KIMI_COMMAND } } })
    const path = writeLock(m, lockBody(4242, 'Macmini'))
    m.queueChild(new FakeAcpServer({ failSessionLoad: kimiLockGate(m) }))
    const failure = await m.driver.prepare(roundSpec(m, Session.create(SessionId('child-kimi-drifted-live')), { resume: RESUME }), new AbortController().signal)
      .catch((error: unknown) => error as Error)
    expect(failure).toBeInstanceOf(KimiSessionOccupiedError)
    expect((failure as KimiSessionOccupiedError).beforePrompt).toBe(true)
    expect(failure.message).toContain(OCCUPIED)
    expect(failure.message).toContain('Kimi process 4242 is still running and holds it; lock written on host Macmini')
    expect(readFileSync(path, 'utf8')).toBe(lockBody(4242, 'Macmini'))
    await m.driver.disposeAll()
  })

  it('a live pid that is not a kimi process (pid reuse) is cleared', async () => {
    // This test process, probed for real: alive, and `ps` names node, not kimi.
    const m = mount()
    const warns: string[] = []
    Object.assign(m.ctx.logger, { warn: (message: string) => { warns.push(message) } })
    const path = writeLock(m, lockBody(process.pid, 'Macmini'))
    const server = new FakeAcpServer({ failSessionLoad: kimiLockGate(m) })
    m.queueChild(server)
    await m.driver.prepare(roundSpec(m, Session.create(SessionId('child-kimi-pid-reuse')), { resume: RESUME }), new AbortController().signal)
    expect(existsSync(path)).toBe(false)
    expect(warns.some(warn => warn.includes('pid reused') && warn.includes('host Macmini'))).toBe(true)
    await m.driver.disposeAll()
  })

  it('an unreadable lock is never touched', async () => {
    const m = mount({ config: { sessionLock: { pidAlive: () => false } } })
    const path = writeLock(m, '{not json')
    m.queueChild(new FakeAcpServer({ failSessionLoad: kimiLockGate(m) }))
    const failure = await m.driver.prepare(roundSpec(m, Session.create(SessionId('child-kimi-garbled-lock')), { resume: RESUME }), new AbortController().signal)
      .catch((error: unknown) => error as Error)
    expect(failure.message).toContain(OCCUPIED)
    expect(failure.message).toContain('lock file could not be read')
    expect(readFileSync(path, 'utf8')).toBe('{not json')
    expect(readdirSync(lockDir(m))).toEqual([`${SESSION}.lock`])
    await m.driver.disposeAll()
  })

  it('any ACP error surfaces its data.details instead of the bare "Internal error"', async () => {
    const m = mount()
    m.queueChild(new FakeAcpServer({ failSessionLoad: () => ({ code: -32603, message: 'Internal error', data: { details: 'Session session_acp-session-7 was not found.' } }) }))
    const failure = await m.driver.prepare(roundSpec(m, Session.create(SessionId('child-kimi-details')), { resume: RESUME }), new AbortController().signal)
      .catch((error: unknown) => error as Error)
    expect(failure).toBeInstanceOf(AcpRequestError)
    expect(failure.message).toBe('subagent-kimi live: Session session_acp-session-7 was not found.')
    expect((failure as AcpRequestError).code).toBe(-32603)
    await m.driver.disposeAll()
  })

  it('a failed load does not poison the next attempt: it spawns afresh and loads again', async () => {
    const m = mount({ config: { sessionLock: { processCommand: async () => KIMI_COMMAND } } })
    const path = writeLock(m, lockBody(process.pid, hostname()))
    m.queueChild(new FakeAcpServer({ failSessionLoad: kimiLockGate(m) }))
    const child = Session.create(SessionId('child-kimi-after-failure'))
    await expect(m.driver.startRound(request() as never, roundSpec(m, child, { resume: RESUME }))).rejects.toBeInstanceOf(KimiSessionOccupiedError)
    expect(m.driver.disabled).toBe(false)
    expect(m.driver.canStartMember('child-kimi-after-failure')).toBe(true)
    // The holder exits and releases its lock; the next round goes through.
    rmSync(path)
    const second = new FakeAcpServer({ failSessionLoad: kimiLockGate(m), turn: () => ({ chunks: ['好了'] }) })
    m.queueChild(second)
    const run = await m.driver.startRound(request({ prompt: '再试' }) as never, roundSpec(m, child, { resume: RESUME }))
    expect((await run.result).stopReason).toBe('completed')
    expect(m.spawns).toHaveLength(2)
    expect(second.requests.map(r => r.method)).toEqual(['initialize', 'session/load', 'session/prompt'])
    await m.driver.disposeAll()
  })

  it('a process that ignores stdin EOF is terminated and the lock it left is cleared', async () => {
    const m = mount({ config: { sessionLock: { pidAlive: () => false } } })
    const server = new FakeAcpServer({ ignoreEof: true })
    m.queueChild(server)
    await m.driver.prepare(roundSpec(m, Session.create(SessionId('child-kimi-forced')), { resume: RESUME }), new AbortController().signal)
    // The signalled process skipped its exit handler: its lock stays behind.
    const path = writeLock(m, lockBody(4242, 'this-host'))
    await m.driver.disposeAll()
    expect(server.stdinEnded).toBe(true)
    expect(server.terminated).toBe(true)
    expect(existsSync(path)).toBe(false)
  })
})

describe('kimi live driver: turns kimi opens on its own (background task completion)', () => {
  const FAST = { ...DEFAULT_TIMEOUTS, settleFoldWaitMs: 0, selfTurnPollMs: 20, collisionGraceMs: 200 }
  const wireDirOf = (m: Mount): string => join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
  const rows = (...list: Record<string, unknown>[]): string => list.map(row => JSON.stringify(row)).join('\n') + '\n'
  const userPrompt = (text: string) => ({ type: 'turn.prompt', input: [{ type: 'text', text }], origin: { kind: 'user' } })
  const taskPrompt = (time?: number) => ({
    type: 'turn.prompt',
    input: [{ type: 'text', text: '<notification type="task.completed" source_id="bash-1">' }],
    origin: { kind: 'task', taskId: 'bash-1', status: 'completed', notificationId: 'task:bash-1:completed' },
    ...time === undefined ? {} : { time },
  })
  const ended = (turnId: number, reason = 'completed') => ({ type: 'turn.ended', turnId, reason })
  const text = (turnId: number, step: number, value: string) => ({
    type: 'context.append_loop_event',
    event: { type: 'content.part', turnId: String(turnId), step, stepUuid: `s-${turnId}-${step}`, part: { type: 'text', text: value } },
  })
  const prompts = (fake: FakeAcpServer) => fake.requests.filter(r => r.method === 'session/prompt')

  it('a prompt waits for a self-opened turn to end before it goes out', async () => {
    const m = mount({ timeouts: FAST })
    const dir = wireDirOf(m)
    mkdirSync(dir, { recursive: true })
    const head = rows(userPrompt('earlier'), ended(0), taskPrompt(), text(1, 1, 'task result read'))
    writeFileSync(join(dir, 'wire.jsonl'), head)
    const fake = new FakeAcpServer({ turn: () => ({ chunks: ['好的'] }) })
    m.queueChild(fake)
    const child = Session.create(SessionId('child-kimi-self-wait'))
    const run = await m.driver.startRound(request({ prompt: '下一步' }) as never, roundSpec(m, child))
    await new Promise(resolve => setTimeout(resolve, 200))
    // The round is open (the member reads busy) but nothing went to kimi.
    expect(child.snapshotEvents().some(e => e.type === 'turn/start')).toBe(true)
    expect(prompts(fake)).toHaveLength(0)
    writeFileSync(join(dir, 'wire.jsonl'), head + rows(ended(1)))
    const result = await run.result
    expect(result).toMatchObject({ stopReason: 'completed', output: [{ type: 'text', text: '好的' }] })
    expect(prompts(fake)).toHaveLength(1)
    await m.driver.disposeAll()
  })

  it('a cancel while waiting never sends the prompt', async () => {
    const m = mount({ timeouts: FAST })
    const dir = wireDirOf(m)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'wire.jsonl'), rows(taskPrompt()))
    const fake = new FakeAcpServer({ turn: () => ({ chunks: ['不该发出'] }) })
    m.queueChild(fake)
    const abort = new AbortController()
    const run = await m.driver.startRound(request({ signal: abort.signal }) as never, roundSpec(m, Session.create(SessionId('child-kimi-self-cancel'))))
    await new Promise(resolve => setTimeout(resolve, 100))
    abort.abort()
    expect((await run.result).stopReason).toBe('aborted')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(prompts(fake)).toHaveLength(0)
    await m.driver.disposeAll()
  })

  it('a self turn that outlasts the bound: the prompt goes out and is followed, not reported empty', async () => {
    const m = mount({ timeouts: { ...FAST, selfTurnWaitMs: 100 } })
    const dir = wireDirOf(m)
    mkdirSync(dir, { recursive: true })
    const head = rows(taskPrompt())
    writeFileSync(join(dir, 'wire.jsonl'), head)
    const fake = new FakeAcpServer({ turn: () => {
      setTimeout(() => { writeFileSync(join(dir, 'wire.jsonl'), head + rows(ended(0), userPrompt('建个文件'), text(1, 1, '建好了'), ended(1))) }, 30)
      return { chunks: [] }
    } })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, Session.create(SessionId('child-kimi-self-bound'))))
    expect(await run.result).toMatchObject({ stopReason: 'completed', output: [{ type: 'text', text: '建好了' }] })
    expect(prompts(fake)).toHaveLength(1)
    await m.driver.disposeAll()
  })

  it('a collision (kimi queued the prompt behind its own turn): no empty success, follows the wire to the queued turn\'s end, never re-sends', async () => {
    const m = mount({ timeouts: FAST })
    const dir = wireDirOf(m)
    mkdirSync(dir, { recursive: true })
    const head = rows(userPrompt('earlier'), ended(0))
    writeFileSync(join(dir, 'wire.jsonl'), head)
    // The self turn opened between the driver's check and its send: kimi's
    // engine queues the prompt, ACP answers end_turn at once with no chunks,
    // and the queued prompt runs as its own turn after the self turn — on the
    // wire only.
    const fake = new FakeAcpServer({ turn: () => {
      writeFileSync(join(dir, 'wire.jsonl'), head + rows(taskPrompt(), text(1, 1, 'task done')))
      setTimeout(() => {
        writeFileSync(join(dir, 'wire.jsonl'), head + rows(taskPrompt(), text(1, 1, 'task done'), ended(1), userPrompt('部署到3080吧'), text(2, 1, '部署')))
      }, 300)
      setTimeout(() => {
        writeFileSync(join(dir, 'wire.jsonl'), head + rows(taskPrompt(), text(1, 1, 'task done'), ended(1), userPrompt('部署到3080吧'), text(2, 1, '部署'), text(2, 1, '完成'), text(2, 2, '已重启'), ended(2)))
      }, 600)
      return { chunks: [] }
    } })
    m.queueChild(fake)
    const warnings: string[] = []
    Object.assign(m.ctx.logger, { warn: (message: string) => { warnings.push(message) } })
    const run = await m.driver.startRound(request({ prompt: '部署到3080吧' }) as never, roundSpec(m, Session.create(SessionId('child-kimi-collision'))))
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: '部署完成\n\n已重启' }])
    expect(prompts(fake)).toHaveLength(1)
    expect(warnings.some(w => w.includes('queued the prompt behind its own turn'))).toBe(true)
    await m.driver.disposeAll()
  })

  it('a queued turn that fails settles as an error, not an empty success', async () => {
    const m = mount({ timeouts: FAST })
    const dir = wireDirOf(m)
    mkdirSync(dir, { recursive: true })
    const fake = new FakeAcpServer({ turn: () => {
      writeFileSync(join(dir, 'wire.jsonl'), rows(taskPrompt(), ended(0), userPrompt('建个文件'), ended(1, 'failed')))
      return { chunks: [] }
    } })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, Session.create(SessionId('child-kimi-collision-failed'))))
    expect((await run.result).stopReason).toBe('error')
    expect(prompts(fake)).toHaveLength(1)
    await m.driver.disposeAll()
  })

  it('no self turn: the prompt goes out at once and an answerless end_turn stays an error', async () => {
    const m = mount({ timeouts: FAST })
    const dir = wireDirOf(m)
    mkdirSync(dir, { recursive: true })
    // A self turn a dead process left open (stamped before this spawn) is not running.
    writeFileSync(join(dir, 'wire.jsonl'), rows(taskPrompt(1)))
    let promptedAfter: number | undefined
    const started = Date.now()
    const fake = new FakeAcpServer({ turn: () => {
      promptedAfter = Date.now() - started
      // Our prompt ran directly and produced nothing.
      writeFileSync(join(dir, 'wire.jsonl'), rows(taskPrompt(1), userPrompt('建个文件'), ended(1)))
      return { chunks: [] }
    } })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, Session.create(SessionId('child-kimi-no-self'))))
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(promptedAfter).toBeLessThan(1_000)
    expect(prompts(fake)).toHaveLength(1)
    await m.driver.disposeAll()
  })
})

describe('kimi live driver: background tasks keep the resident process (keep-alive)', () => {
  const IDLE = 1_000
  const CAP = 10_000

  /** A resident member whose background-work read the test controls, under a fake clock. */
  async function residentWithWork(id: string, work: { running: string[]; selfTurnOpen?: boolean }) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
    const reclaimed: { key: string; taskIds: readonly string[] }[] = []
    const m = mount({
      config: {
        liveIdleMs: IDLE,
        keepAliveCapMs: CAP,
        backgroundWork: async () => ({ runningTaskIds: [...work.running], selfTurnOpen: work.selfTurnOpen ?? false }),
        onReclaimedWithTasks: (key, taskIds) => { reclaimed.push({ key, taskIds }) },
      },
    })
    const child = Session.create(SessionId(id))
    const fake = new FakeAcpServer({ turn: () => ({ chunks: ['后台跑着'] }) })
    m.queueChild(fake)
    await (await m.driver.startRound(request() as never, roundSpec(m, child))).result
    expect(m.driver.liveCount).toBe(1)
    return { m, fake, reclaimed }
  }

  afterEach(() => { vi.useRealTimers() })

  it('tasks running: the idle lifetime passes and the process stays', async () => {
    const work = { running: ['bash-1'] }
    const { m, fake, reclaimed } = await residentWithWork('child-keep-1', work)
    await vi.advanceTimersByTimeAsync(IDLE * 3)
    expect(m.driver.liveCount).toBe(1)
    expect(fake.stdinEnded || fake.terminated).toBe(false)
    expect(reclaimed).toEqual([])
    // The tray's 「进程最晚保留到」: the last activity plus the cap.
    const until = m.driver.observeBackgroundTasks('child-keep-1', ['bash-1'])
    expect(until).toBeGreaterThan(Date.now())
    expect(until! - Date.now()).toBeLessThanOrEqual(CAP)
    expect(m.driver.observeBackgroundTasks('child-keep-none', ['bash-1'])).toBeUndefined()
    await m.driver.disposeAll()
  })

  it('the cap from the last activity reached: reclaimed as usual, the running tasks recorded process-reclaimed', async () => {
    const work = { running: ['bash-1'] }
    const { m, fake, reclaimed } = await residentWithWork('child-keep-2', work)
    await vi.advanceTimersByTimeAsync(CAP - IDLE)
    expect(m.driver.liveCount).toBe(1)
    await vi.advanceTimersByTimeAsync(IDLE * 2)
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    await vi.waitFor(() => { expect(fake.stdinEnded || fake.terminated).toBe(true) })
    expect(reclaimed).toEqual([{ key: 'child-keep-2', taskIds: ['bash-1'] }])
    await m.driver.disposeAll()
  })

  it('a change in the running tasks is activity: the cap counts again from it', async () => {
    const work = { running: ['bash-1'] }
    const { m } = await residentWithWork('child-keep-3', work)
    await vi.advanceTimersByTimeAsync(CAP - IDLE * 2)
    work.running = ['bash-1', 'bash-2']
    await vi.advanceTimersByTimeAsync(IDLE * 3)
    // Past the first deadline, still kept: bash-2 started (activity).
    expect(m.driver.liveCount).toBe(1)
    await vi.advanceTimersByTimeAsync(CAP)
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    await m.driver.disposeAll()
  })

  it('an open self turn keeps the process too', async () => {
    const work = { running: [] as string[], selfTurnOpen: true }
    const { m, reclaimed } = await residentWithWork('child-keep-4', work)
    await vi.advanceTimersByTimeAsync(IDLE * 3)
    expect(m.driver.liveCount).toBe(1)
    work.selfTurnOpen = false
    await vi.advanceTimersByTimeAsync(IDLE * 2)
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    expect(reclaimed).toEqual([])
    await m.driver.disposeAll()
  })

  it('tasks end: one normal idle lifetime from then, then reclaimed with nothing to record', async () => {
    const work = { running: ['bash-1'] }
    const { m, fake, reclaimed } = await residentWithWork('child-keep-5', work)
    await vi.advanceTimersByTimeAsync(IDLE * 2)
    expect(m.driver.liveCount).toBe(1)
    work.running = []
    // The look that sees them gone grants one idle lifetime…
    await vi.advanceTimersByTimeAsync(IDLE)
    expect(m.driver.liveCount).toBe(1)
    // …then the idle reclaim runs as it always did.
    await vi.advanceTimersByTimeAsync(IDLE)
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    expect(fake.stdinEnded).toBe(true)
    expect(reclaimed).toEqual([])
    await m.driver.disposeAll()
  })

  it('no background work: reclaimed at the idle lifetime, as before', async () => {
    const { m, reclaimed } = await residentWithWork('child-keep-6', { running: [] })
    await vi.advanceTimersByTimeAsync(IDLE)
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    expect(reclaimed).toEqual([])
    await m.driver.disposeAll()
  })

  it('a reload with tasks running records them process-reclaimed; plugin unload records nothing', async () => {
    const work = { running: ['bash-1'] }
    const { m, reclaimed } = await residentWithWork('child-keep-7', work)
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['ok'] }) }))
    await vi.advanceTimersByTimeAsync(0)
    const reload = m.driver.reloadMember('child-keep-7', { onStart: () => {} })
    await expect(reload!.done).resolves.toBe('respawned')
    expect(reclaimed).toEqual([{ key: 'child-keep-7', taskIds: ['bash-1'] }])
    await m.driver.disposeAll()
    expect(reclaimed).toHaveLength(1)
  })

  it('the default read: kimi\'s running task files keep the process', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
    const m = mount({ config: { liveIdleMs: IDLE, keepAliveCapMs: CAP } })
    const child = Session.create(SessionId('child-keep-8'))
    m.queueChild(new FakeAcpServer({ turn: () => { writeKimiWire(m.homeDir, 'acp-session-1', '部署', '完成后我会继续汇报'); return { chunks: ['完成后我会继续汇报'] } } }))
    await (await m.driver.startRound(request() as never, roundSpec(m, child))).result
    const tasks = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main', 'tasks')
    mkdirSync(tasks, { recursive: true })
    writeFileSync(join(tasks, 'bash-a.json'), JSON.stringify({ taskId: 'bash-a', kind: 'process', status: 'running', command: 'sleep 600', startedAt: Date.now() }))
    await expect(m.driver.hasRunningBackgroundTasks('child-keep-8')).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(IDLE * 2)
    expect(m.driver.liveCount).toBe(1)
    writeFileSync(join(tasks, 'bash-a.json'), JSON.stringify({ taskId: 'bash-a', kind: 'process', status: 'completed', command: 'sleep 600', startedAt: Date.now() - 1_000, endedAt: Date.now(), exitCode: 0 }))
    await vi.advanceTimersByTimeAsync(IDLE * 3)
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    await m.driver.disposeAll()
  })
})

describe('kimi live driver: a self-opened round becomes its own execution (member-self-started-rounds M4)', () => {
  const FAST = { ...DEFAULT_TIMEOUTS, settleFoldWaitMs: 0, selfTurnPollMs: 20, collisionGraceMs: 200, selfTurnObserveMs: 20 }
  const wireOf = (m: Mount): string => join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main', 'wire.jsonl')
  const rows = (...list: Record<string, unknown>[]): string => list.map(row => JSON.stringify(row)).join('\n') + '\n'
  const userPrompt = (text: string) => ({ type: 'turn.prompt', input: [{ type: 'text', text }], origin: { kind: 'user' }, time: Date.now() })
  const taskPrompt = (time = Date.now(), id = 'bash-1') => ({
    type: 'turn.prompt',
    input: [{ type: 'text', text: `<notification type="task.completed" source_id="${id}">` }],
    origin: { kind: 'task', taskId: id, status: 'completed', notificationId: `task:${id}:completed` },
    time,
  })
  const ended = (turnId: number, reason = 'completed') => ({ type: 'turn.ended', turnId, reason })
  const step = (turnId: number, n: number, value: string, usage?: { inputOther: number; output: number }) => [
    { type: 'context.append_loop_event', event: { type: 'step.begin', turnId: String(turnId), step: n } },
    ...usage === undefined ? [] : [{ type: 'usage.record', usage }],
    { type: 'context.append_loop_event', event: { type: 'content.part', turnId: String(turnId), step: n, stepUuid: `s-${turnId}-${n}`, part: { type: 'text', text: value } } },
    { type: 'context.append_loop_event', event: { type: 'step.end', turnId: String(turnId), step: n } },
  ]
  const prompts = (fake: FakeAcpServer) => fake.requests.filter(r => r.method === 'session/prompt')

  /**
   * The core's `admitSelf`, as the real one behaves for this driver: the
   * start record lands in the member's child session first, then the
   * harness follows. `accept` false refuses (the member's slot is taken).
   */
  function fakeAdmitSelf(m: Mount, child: Session, accept = true) {
    const admitted: { cause: Record<string, unknown>; taskCallId?: string; result?: Promise<unknown> }[] = []
    const admitSelf = vi.fn(async (request: { cause: Record<string, unknown>; taskCallId?: string; follow: (round: { executionId: string; session: Session; signal: AbortSignal }) => Promise<unknown> }) => {
      if (!accept) return undefined
      const executionId = `self-${admitted.length + 1}`
      child.append('local-agent/execution' as never, { phase: 'start', executionId, caller: 'cli', operation: 'prompt', parentSessionId: 'parent-1', admittedAt: Date.now(), cause: request.cause } as never)
      const result = request.follow({ executionId, session: child, signal: new AbortController().signal })
      admitted.push({ cause: request.cause, ...request.taskCallId === undefined ? {} : { taskCallId: request.taskCallId }, result })
      return { executionId, settled: result.then(() => ({ executionId, outcome: 'done', turns: [] })) }
    })
    Object.assign(m.ctx.get('localAgent') as object, { admitSelf })
    return { admitSelf, admitted }
  }

  /** One finished round that started a background task: the member is idle, its process resident. */
  async function idleWithTask(id: string, running = { ids: ['bash-1'] }) {
    const m = mount({ timeouts: FAST, config: { backgroundWork: async () => ({ runningTaskIds: [...running.ids], selfTurnOpen: false }) } })
    const child = Session.create(SessionId(id))
    const fake = new FakeAcpServer({ turn: () => {
      mkdirSync(join(wireOf(m), '..'), { recursive: true })
      writeFileSync(wireOf(m), rows(userPrompt('部署到3080吧'), { type: 'task.started', info: { taskId: 'bash-1', parentToolCallId: 'call-bg', status: 'running' } }, ...step(0, 1, '完成后我会继续汇报'), ended(0)))
      return { chunks: ['完成后我会继续汇报'] }
    } })
    m.queueChild(fake)
    const first = await m.driver.startRound(request({ prompt: '部署到3080吧' }) as never, roundSpec(m, child))
    expect((await first.result).stopReason).toBe('completed')
    return { m, child, fake, head: readFileSync(wireOf(m), 'utf8') }
  }

  it('the observer admits a turn kimi opened when a task ended, follows it on the wire to its end, and mirrors it as a turn of its own (no user message, its usage on its step)', async () => {
    const { m, child, fake, head } = await idleWithTask('child-self-own')
    const { admitSelf, admitted } = fakeAdmitSelf(m, child)
    writeFileSync(wireOf(m), head + rows(taskPrompt(), ...step(1, 1, '部署完成', { inputOther: 40, output: 6 })))
    await vi.waitFor(() => expect(admitSelf).toHaveBeenCalledOnce())
    expect(admitted[0]!.cause).toEqual({ kind: 'self', reason: 'background-task', taskId: 'bash-1', taskStatus: 'completed', notificationId: 'task:bash-1:completed' })
    // The task's tool call, from the wire's task.started line: the core follows the chain to startedBy.
    expect(admitted[0]!.taskCallId).toBe('call-bg')
    // Still running on the wire: the turn is open, nothing settled.
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(child.snapshotEvents().filter(event => event.type === 'turn/start').map(event => (event.data as { turn: number }).turn)).toEqual([1, 2])
    expect(child.snapshotEvents().some(event => event.type === 'turn/end' && (event.data as { turn: number }).turn === 2)).toBe(false)
    writeFileSync(wireOf(m), head + rows(taskPrompt(), ...step(1, 1, '部署完成', { inputOther: 40, output: 6 }), ...step(1, 2, '已重启'), ended(1)))
    const result = await admitted[0]!.result
    expect(result).toEqual({ stopReason: 'completed', output: [{ type: 'text', text: '部署完成\n\n已重启' }] })
    const turn2 = child.snapshotEvents().filter(event => (event.data as { turn?: number }).turn === 2)
    expect(child.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(1)
    const messages = turn2.filter(event => event.type === 'assistant/message').map(event => event.data as { usage?: { inputTokens: number }; message: { content: { type: string; text?: string }[] } })
    expect(messages.map(message => message.message.content.find(block => block.type === 'text')?.text)).toEqual(['部署完成', '已重启'])
    expect(messages[0]!.usage).toMatchObject({ inputTokens: 40, outputTokens: 6 })
    expect(turn2.at(-1)).toMatchObject({ type: 'turn/end' })
    // The round's spend is reported like any round's.
    expect(m.settles.at(-1)).toMatchObject({ id: 'child-self-own', round: { usage: { inputTokens: 40, outputTokens: 6 } } })
    // Offered once.
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(admitSelf).toHaveBeenCalledOnce()
    expect(prompts(fake)).toHaveLength(1)
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
  })

  it('a prompt asked for while the self round is followed waits for it, and goes out once (B③)', async () => {
    const { m, child, fake, head } = await idleWithTask('child-self-wait')
    const { admitSelf, admitted } = fakeAdmitSelf(m, child)
    const open = head + rows(taskPrompt(), ...step(1, 1, '部署完成'))
    writeFileSync(wireOf(m), open)
    await vi.waitFor(() => expect(admitSelf).toHaveBeenCalledOnce())
    // The ledger normally holds the next round back; the driver's own chain does too.
    let promptAt: number | undefined
    Object.assign(fake, { script: { turn: () => {
      promptAt = Date.now()
      writeFileSync(wireOf(m), open + rows(ended(1), userPrompt('下一步'), ...step(2, 1, '好的'), ended(2)))
      return { chunks: ['好的'] }
    } } })
    const next = m.driver.startRound(request({ prompt: '下一步' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 3 } }))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(prompts(fake)).toHaveLength(1)
    const endedAt = Date.now()
    writeFileSync(wireOf(m), open + rows(ended(1)))
    await admitted[0]!.result
    const run = await next
    expect(await run.result).toMatchObject({ stopReason: 'completed', output: [{ type: 'text', text: '好的' }] })
    expect(prompts(fake)).toHaveLength(2)
    expect(promptAt).toBeGreaterThanOrEqual(endedAt)
    expect(child.snapshotEvents().filter(event => event.type === 'turn/start').map(event => (event.data as { turn: number }).turn)).toEqual([1, 2, 3])
    expectValidReleasedLog(child)
    await m.driver.disposeAll()
  })

  it('refused by the core (the slot is taken), a cron turn, or a stale turn: nothing is followed, the 11-01 fold keeps it', async () => {
    const { m, child, head } = await idleWithTask('child-self-refused')
    const { admitSelf } = fakeAdmitSelf(m, child, false)
    const warnings: string[] = []
    Object.assign(m.ctx.logger, { warn: (message: string) => { warnings.push(message) } })
    // A turn stamped before this process spawned belongs to a process that is gone.
    writeFileSync(wireOf(m), head + rows(taskPrompt(1, 'bash-0'), ended(1)))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(admitSelf).not.toHaveBeenCalled()
    const cron = { type: 'turn.prompt', input: [{ type: 'text', text: 'cron' }], origin: { kind: 'cron_job' }, time: Date.now() }
    writeFileSync(wireOf(m), head + rows(taskPrompt(1, 'bash-0'), ended(1), cron, ended(2)))
    await vi.waitFor(() => expect(warnings.some(warning => warning.includes('origin cron_job'))).toBe(true))
    expect(admitSelf).not.toHaveBeenCalled()
    writeFileSync(wireOf(m), head + rows(taskPrompt(1, 'bash-0'), ended(1), cron, ended(2), taskPrompt(), ...step(3, 1, '结果'), ended(3)))
    await vi.waitFor(() => expect(admitSelf).toHaveBeenCalledOnce())
    await new Promise(resolve => setTimeout(resolve, 80))
    // Refused: offered once, no turn opened.
    expect(admitSelf).toHaveBeenCalledOnce()
    expect(child.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    await m.driver.disposeAll()
  })

  it('the observer stops when nothing runs, and never starts without background work', async () => {
    const running = { ids: ['bash-1'] }
    const { m, child, head } = await idleWithTask('child-self-stop', running)
    const { admitSelf } = fakeAdmitSelf(m, child)
    running.ids = []
    // The task ended (the wire grows with its terminated line): the next look stops.
    writeFileSync(wireOf(m), head + rows({ type: 'task.terminated', info: { taskId: 'bash-1', status: 'completed' } }))
    await new Promise(resolve => setTimeout(resolve, 100))
    // A turn kimi opens now is not seen until a round (or the tray) starts the observer again.
    writeFileSync(wireOf(m), head + rows({ type: 'task.terminated', info: { taskId: 'bash-1', status: 'completed' } }, taskPrompt(), ended(1)))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(admitSelf).not.toHaveBeenCalled()
    // The tray's read sees work again: the observer restarts and finds the turn.
    running.ids = ['bash-2']
    m.driver.observeBackgroundTasks('child-self-stop', ['bash-2'])
    await vi.waitFor(() => expect(admitSelf).toHaveBeenCalledOnce())
    await m.driver.disposeAll()
  })
})
