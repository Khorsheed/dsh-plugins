/**
 * The kimi live driver: resident `kimi acp` lifecycle (spawn, initialize
 * handshake with the loadSession capability gate, session/new and
 * session/load, idle reclaim, crash re-spawn), the round settlement contract
 * (ACP stopReason mapping, turn-spanning prompt), graceful session/cancel,
 * prompt serialization (the stop-then-rephrase gesture), unattended
 * permission auto-answers, push-triggered file-fold mirroring with the
 * exec path's offset bookkeeping, and the provider's exec fallback.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { KimiCliProvider } from '../src/kimi-cli-provider.ts'
import { acpStopReasonToHarness, KimiAcpLiveDriver } from '../src/live-driver.ts'
import { readKimiDefaultModel } from '../src/provision.ts'

/** One scripted turn: streamed chunks, the terminal stop reason, or a hang. */
interface FakeTurn {
  chunks?: string[]
  stopReason?: string
  /** Never resolve the prompt (cancel-path tests drive it by hand). */
  hang?: boolean
}

interface FakeAcpScript {
  turn?: (params: Record<string, unknown>) => FakeTurn
  silent?: readonly string[]
  crashAfterPrompt?: boolean
  /** Fail session/new with an error response. */
  failSessionNew?: string
  /** Omit the loadSession capability (breaker-path test). */
  noLoadSession?: boolean
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
      this.resolveDone({ exitCode: 0, signal: null })
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
        respond({ sessionId: `session_acp-session-${this.sessionSeq}` })
        return
      case 'session/load':
        respond({})
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
function writeKimiWire(homeDir: string, sessionId: string, task: string, answer: string): void {
  const dir = join(homeDir, 'sessions', 'wd_test', `session_${sessionId}`, 'agents', 'main')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'wire.jsonl'), [
    JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: task }] }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, part: { type: 'text', text: answer } } }),
    JSON.stringify({ type: 'usage.record', usage: { inputOther: 10, output: 4 } }),
  ].join('\n') + '\n')
}

interface Mount {
  ctx: Context
  homeDir: string
  spawns: { spec: SubprocessSpawnSpec; fake?: FakeAcpServer; execHandle?: SubprocessHandle }[]
  reports: { id: string; progress: { kind: string; text?: string; mirroredLines?: number } }[]
  records: ReturnType<typeof vi.fn>
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
  const mirrorOffsets = new Map<string, number>()
  const ctx = new Context()
  ctx.provide('localAgent', {
    homeDir: () => homeDir,
    takeDelegationIntent: () => options.intent,
    recordDelegation: records,
    getDelegation: () => undefined,
    recordRoundSettled: () => {},
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
  const driver = new KimiAcpLiveDriver(ctx, options.config ?? {}, options.timeouts)
  return {
    ctx,
    homeDir,
    spawns,
    reports,
    records,
    mirrorOffsets,
    queueChild: child => { queue.push(child) },
    driver,
  }
}

function request(over: { prompt?: string; signal?: AbortSignal } = {}): unknown {
  return {
    prompt: [{ type: 'text', text: over.prompt ?? '建个文件' }],
    parent: { session: { id: 'parent-1', header: { cwd: '/tmp' } } },
    descriptor: { description: '测试委派' },
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
    expect(spawn.spec.env).toEqual({ KIMI_CODE_HOME: m.homeDir })
    expect(spawn.fake!.requests.map(r => r.method)).toEqual(['initialize', 'session/new', 'session/prompt'])
    expect(spawn.fake!.requests[1]?.params).toMatchObject({ cwd: '/tmp', mcpServers: [] })
    // Turn boundaries are the parent's own.
    expect(child.snapshotEvents().find(e => e.type === 'turn/end')?.data).toMatchObject({ turn: 1, reason: { kind: 'completed' } })
    // The settle mirror pass ran (no wire.jsonl yet → total 0) and reported.
    await vi.waitFor(() => { expect(m.reports.some(r => r.progress.kind === 'mirror')).toBe(true) })
    await m.driver.disposeAll()
    expect(m.driver.liveCount).toBe(0)
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
    // boundary pair, even landing after turn/end.
    expectStepBoundaries(child)
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

  it('token granularity streams throttled snapshots into the session log at the stream\'s step', async () => {
    // Zero thresholds: every delta lands a snapshot immediately.
    const on = mount({ config: { liveMirrorGranularity: 'token', snapshotMinIntervalMs: 0, snapshotMinChars: 0 } })
    const onChild = Session.create(SessionId('child-kimi-8b'))
    const fake = new FakeAcpServer({ turn: () => ({ hang: true }) })
    on.queueChild(fake)
    const onRun = await on.driver.startRound(request() as never, roundSpec(on, onChild))
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hel' } })
    fake.update('session_acp-session-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } })
    writeKimiWire(on.homeDir, 'acp-session-1', '建个文件', 'hello')
    fake.resolvePrompt({ stopReason: 'end_turn' })
    expect((await onRun.result).stopReason).toBe('completed')
    await vi.waitFor(() => {
      expect(onChild.snapshotEvents().filter(e => e.type === 'assistant/message').length).toBeGreaterThanOrEqual(3)
    }, { timeout: 5_000 })
    // The stream reserved step 1 (deltas arrived before any fold): snapshots
    // grew the message live, and the completion fold landed last at the same
    // (turn, step) — the host's repeated-settle merge keeps the newest.
    const atStep = onChild.snapshotEvents().filter(e => (e.data as { turn?: number; step?: number }).turn === 1
      && (e.data as { turn?: number; step?: number }).step === 1)
    expect(atStep.map(e => e.type)).toEqual(['step/start', 'assistant/message', 'assistant/message', 'assistant/message', 'step/end'])
    const texts = atStep.filter(e => e.type === 'assistant/message')
      .map(e => (e.data as { message: { content: { text: string }[] } }).message.content[0]?.text)
    expect(texts).toEqual(['hel', 'hello', 'hello'])
    // The delta still rides the run-progress channel.
    const deltas = on.reports.filter(r => r.progress.kind === 'delta').map(r => r.progress.text)
    expect(deltas).toContain('hel')
    expect(deltas).toContain('lo')
    await on.driver.disposeAll()
  })

  it('token granularity: each streamed item finalizes at its own reserved step (no duplicate fold)', async () => {
    const m = mount({ config: { liveMirrorGranularity: 'token', snapshotMinIntervalMs: 0, snapshotMinChars: 0 } })
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
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message').length).toBeGreaterThanOrEqual(5) }, { timeout: 5_000 })
    const events = child.snapshotEvents()
    const assistant = events.filter(e => e.type === 'assistant/message')
    // The thought stream finalizes at its reserved step 1 (one snapshot + the
    // completion fold; no duplicated content).
    const atThink = events.filter(e => (e.data as { turn?: number; step?: number }).turn === 1
      && (e.data as { turn?: number; step?: number }).step === 1)
    expect(atThink.map(e => e.type)).toEqual(['step/start', 'assistant/message', 'assistant/message', 'step/end'])
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
    expect(atStep.map(e => e.type)).toEqual(['step/start', 'assistant/message', 'assistant/message', 'assistant/message', 'step/end'])
    await m.driver.disposeAll()
  })

  it('token granularity: a cancelled round completes the stream as interrupted (legitimate 已停止)', async () => {
    const m = mount({ config: { liveMirrorGranularity: 'token' } })
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
    await m.driver.disposeAll()
  })

  it('token granularity: a tool-first round renders the answer after its tool cards (lazy stream step)', async () => {
    const m = mount({
      config: { liveMirrorGranularity: 'token' },
      timeouts: { initializeMs: 5_000, requestMs: 5_000, convergeMs: 50, channelRetryMs: 60_000, mirrorThrottleMs: 0 },
    })
    const child = Session.create(SessionId('child-kimi-token-toolfirst'))
    const wireDir = join(m.homeDir, 'sessions', 'wd_test', 'session_acp-session-1', 'agents', 'main')
    mkdirSync(wireDir, { recursive: true })
    const fake = new FakeAcpServer({
      turn: () => {
        // The wire already carries a completed tool call when the turn starts.
        writeFileSync(join(wireDir, 'wire.jsonl'), [
          JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }], origin: { kind: 'user' } }),
          JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.call', turnId: 0, toolCallId: 'call-1', toolCall: { name: 'Bash', args: { command: 'ls' } } } }),
        ].join('\n') + '\n')
        return { hang: true }
      },
    })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    // A mid-run update triggers a mirror pass that folds the tool card FIRST.
    fake.update('session_acp-session-1', { sessionUpdate: 'tool_call', content: {} })
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'tool/call')).toHaveLength(1) })
    // Text streams after the tool card folded; the wire gains the completed
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
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1) }, { timeout: 5_000 })

    // The tool card folded at step 1; the stream reserved the step after it,
    // and the answer's completion fold landed at that same step, carrying the
    // round's usage (the chunk stayed under the default throttle, so no
    // snapshot ever landed).
    expect((child.snapshotEvents().find(e => e.type === 'tool/call')!.data as { step: number }).step).toBe(1)
    const final = child.snapshotEvents().find(e => e.type === 'assistant/message')!
    expect(final.data).toMatchObject({ turn: 1, step: 2, usage: { inputTokens: 5, outputTokens: 2 } })
    // Both the mid-run tool fold and the stream's completion fold carry their
    // boundary pairs.
    expectStepBoundaries(child)
    await m.driver.disposeAll()
  })

  it('token granularity: a round whose stream stayed under the throttle still folds every wire item 1:1', async () => {
    const m = mount({ config: { liveMirrorGranularity: 'token' } })
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
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(2) }, { timeout: 5_000 })

    // Faithful per-item fold: exactly one message per content item, nothing
    // withheld for a combined message — the think line folds sequentially
    // (no thought chunks streamed), the answer completes its stream at the
    // reserved step (no snapshot ever landed under the default throttle).
    const events = child.snapshotEvents()
    const assistant = events.filter(e => e.type === 'assistant/message')
    expect(assistant.map(e => (e.data as { message: { content: { type: string }[] } }).message.content[0]?.type))
      .toEqual(['reasoning', 'text'])
    expect(assistant[1]!.data).toMatchObject({ usage: { inputTokens: 7, outputTokens: 3 } })
    expect((assistant[1]!.data as { message: { content: unknown[] } }).message.content).toEqual([{ type: 'text', text: '静默答案' }])
    expect(events.filter(e => e.type === 'tool/call')).toHaveLength(1)
    expectStepBoundaries(child)
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
      timeouts: { initializeMs: 5_000, requestMs: 5_000, convergeMs: 50, channelRetryMs: 60_000, mirrorThrottleMs: 0 },
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
    expect((await run.result).stopReason).toBe('completed')
    // The answer lands in the wire 500ms after the prompt response — inside
    // the quiescence window (3 stable reads at 300ms).
    setTimeout(() => { writeKimiWire(m.homeDir, 'acp-session-1', '建个文件', '文件建好了') }, 500)
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

  it('setLiveMirrorGranularity flips subsequent rounds without a new generation', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-drain4'))
    child.append('turn/start', { turn: 1 })
    m.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['一', '二'] }) }))
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    await first.result
    // Event granularity: no wire to fold, nothing lands in the log.
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(0)
    m.driver.setLiveMirrorGranularity('token')
    const second = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'acp-session-1', turn: 2 } }))
    await second.result
    // Token granularity: no wire lines folded, so the unfinished stream
    // finalizes at settle with one forced snapshot at its reserved step.
    await vi.waitFor(() => {
      expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1)
    }, { timeout: 5_000 })
    const final = child.snapshotEvents().find(e => e.type === 'assistant/message')!
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

  it('token granularity folds ACP plan updates as a think-style snapshot stream', async () => {
    const m = mount({ config: { liveMirrorGranularity: 'token', snapshotMinIntervalMs: 0, snapshotMinChars: 0 } })
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
    await vi.waitFor(() => {
      expect(reasoningTexts(child).some(text => text.includes('☑ 第一步') && text.includes('▶ 第二步'))).toBe(true)
    }, { timeout: 5_000 })
    await m.driver.disposeAll()
  })

  it('event granularity folds the round\'s plan once at settle (the wire carries none)', async () => {
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
      expect(reasoningTexts(child).filter(text => text.includes('▶ 唯一步骤'))).toHaveLength(1)
    }, { timeout: 5_000 })
    await m.driver.disposeAll()
  })
})
