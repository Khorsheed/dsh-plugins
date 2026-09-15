/**
 * The dsh live driver: resident serve-process lifecycle (spawn, handshake,
 * idle reclaim, crash re-spawn, disposeAll), the round settlement contract
 * (completed/aborted/error parity with the exec path), push-mode mirroring,
 * graceful runtime interrupt, and the provider's exec fallback when the serve
 * channel cannot come up.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { DshCliProvider } from '../src/dsh-cli-provider.ts'
import { DshLiveDriver } from '../src/live-driver.ts'

/** One scripted turn: the events to push and the closing idle reason. */
interface FakeTurn {
  events?: Partial<SessionEvent>[]
  /** undefined closes completed; null means the turn never closes on its own. */
  reason?: unknown
}

interface FakeServeScript {
  /** Script the next turn by its params; absent closes completed with no events. */
  turn?: (params: Record<string, unknown>) => FakeTurn
  /** Wire methods the fake never answers (hang simulations). */
  silent?: readonly string[]
  /** Crash right after acknowledging turn/start. */
  crashAfterTurnStart?: boolean
  /** Push the accept ack, the events, and idle as ONE chunk (worst-case batching). */
  batchWithAck?: boolean
}

/** A fake resident serve process speaking the family wire over its stdio. */
class FakeServeChild {
  readonly stdin = new PassThrough()
  readonly stdout = new Readable({ read() {} })
  readonly stderr = new Readable({ read() {} })
  readonly handle: SubprocessHandle
  readonly requests: { method: string; params: Record<string, unknown> }[] = []
  terminated = false
  private buffer = ''
  private readonly resolveDone: (outcome: { exitCode: number; signal: null }) => void
  readonly done: Promise<{ exitCode: number; signal: null }>

  constructor(private readonly script: FakeServeScript = {}) {
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
        if (line.trim() !== '') this.dispatch(JSON.parse(line) as { id: number; method: string; params?: Record<string, unknown> })
      }
    })
    this.handle = {
      pid: 5150,
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

  /** Push one session/event notification (turn-tagged like the real serve). */
  pushEvent(sessionId: string, turn: number | null, event: Partial<SessionEvent>): void {
    this.send({ jsonrpc: '2.0', method: 'session/event', params: { sessionId, turn, event: { seq: 1, time: 1, ...event } } })
  }

  /** Push one session/idle notification (the round's close). */
  pushIdle(sessionId: string, turn: number, reason: unknown): void {
    this.send({ jsonrpc: '2.0', method: 'session/idle', params: { sessionId, turn, reason } })
  }

  /** Push raw bytes (UTF-8 split-chunk tests). */
  pushRaw(bytes: Buffer): void {
    this.stdout.push(bytes)
  }

  private dispatch(message: { id: number; method: string; params?: Record<string, unknown> }): void {
    const params = message.params ?? {}
    this.requests.push({ method: message.method, params })
    if (this.script.silent?.includes(message.method) === true) return
    switch (message.method) {
      case 'initialize':
        this.send({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            serverInfo: { name: '@khorsheed/dsh-local-agent-dsh-headless/serve' },
            protocolVersion: 1,
          },
        })
        return
      case 'turn/start': {
        const turn = this.script.turn?.(params) ?? {}
        const sessionId = String(params['sessionId'])
        const round = params['turn'] as number
        if (this.script.batchWithAck === true) {
          // One chunk: the ack, every event, and idle arrive together.
          const lines: Record<string, unknown>[] = [
            { jsonrpc: '2.0', id: message.id, result: { accepted: true } },
            ...(turn.events ?? []).map((event, i) => ({
              jsonrpc: '2.0', method: 'session/event',
              params: { sessionId, turn: round, event: { seq: i + 1, time: i + 1, ...event } },
            })),
            { jsonrpc: '2.0', method: 'session/idle', params: { sessionId, turn: round, reason: turn.reason ?? { kind: 'completed' } } },
          ]
          this.stdout.push(lines.map(line => JSON.stringify(line)).join('\n') + '\n')
          return
        }
        this.send({ jsonrpc: '2.0', id: message.id, result: { accepted: true } })
        queueMicrotask(() => {
          if (this.script.crashAfterTurnStart === true) {
            this.crash()
            return
          }
          for (const event of turn.events ?? []) {
            this.pushEvent(sessionId, round, event)
          }
          if (turn.reason !== null) {
            this.pushIdle(sessionId, round, turn.reason ?? { kind: 'completed' })
          }
        })
        return
      }
      case 'turn/interrupt':
        this.send({ jsonrpc: '2.0', id: message.id, result: { interrupted: true } })
        return
      case 'shutdown':
        this.send({ jsonrpc: '2.0', id: message.id, result: {} })
        queueMicrotask(() => { this.resolveDone({ exitCode: 0, signal: null }) })
        return
      default:
        this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown method' } })
    }
  }

  /** Simulate a mid-life crash: the process dies without a wire goodbye. */
  crash(): void {
    this.resolveDone({ exitCode: 1, signal: null })
  }
}

/** A one-shot exec child: prints the final answer and exits 0. */
function oneShotChild(answer: string): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  const stderr = new Readable({ read() {} })
  stderr.push(null)
  setImmediate(() => {
    stdout.push(answer + '\n')
    stdout.push(null)
  })
  const done = new Promise<{ exitCode: number; signal: null }>((resolve) => {
    setImmediate(() => { resolve({ exitCode: 0, signal: null }) })
  })
  return {
    pid: 6160,
    stdin: undefined,
    stdout,
    stderr,
    collected: {
      stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done,
    terminate: () => undefined,
    waitForExit: async () => true,
  }
}

/** A user message + assistant answer pair as the sub-dsh would log them. */
function answerEvents(turn: number, task: string, answer: string): Partial<SessionEvent>[] {
  return [
    { type: 'turn/start', data: { turn } },
    { type: 'user/message', data: { content: [{ type: 'text', text: task }], source: { kind: 'user' }, role: 'user' } },
    { type: 'step/start', data: { turn, step: 1 } },
    { type: 'assistant/message', data: { turn, step: 1, message: { content: [{ type: 'text', text: answer }], source: { provider: 'deepseek-official', model: 'm' } } } },
    { type: 'step/end', data: { turn, step: 1 } },
    { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } },
  ]
}

/**
 * Assert every mirrored content event sits inside its `step/start`–`step/end`
 * pair: the real-time subsession view only materializes an assistant message
 * whose step is opened by a step/start boundary — the live push mirror must
 * copy the sub-dsh's pairs verbatim, or the live view drops the message.
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
    const start = at.find(boundary => boundary.type === 'step/start')
    const end = at.find(boundary => boundary.type === 'step/end')
    expect(start, `step/start for ${event.type} at ${turn}:${step}`).toBeDefined()
    expect(end, `step/end for ${event.type} at ${turn}:${step}`).toBeDefined()
    expect(start!.seq).toBeLessThan(event.seq)
    expect(end!.seq).toBeGreaterThan(event.seq)
  }
}

interface Mount {
  ctx: Context
  homeDir: string
  spawns: { spec: SubprocessSpawnSpec; handle: SubprocessHandle; fake?: FakeServeChild }[]
  reports: { id: string; progress: { kind: string; text?: string; mirroredLines?: number } }[]
  records: ReturnType<typeof vi.fn>
  settles: { id: string; round: Record<string, unknown> }[]
  /** Queue a fake serve process for the next spawn. */
  queueChild(child: FakeServeChild): void
  driver: DshLiveDriver
}

function mount(options: {
  config?: ConstructorParameters<typeof DshLiveDriver>[1]
  timeouts?: ConstructorParameters<typeof DshLiveDriver>[2]
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
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-live-driver-'))
  const reports: Mount['reports'] = []
  const spawns: Mount['spawns'] = []
  const queue: FakeServeChild[] = []
  const records = vi.fn()
  const settles: Mount['settles'] = []
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
    reportRunProgress: (id: string, progress: { kind: string; text?: string; mirroredLines?: number }) => {
      reports.push({ id, progress })
    },
  })
  ctx.provide('subprocess', {
    spawn: (spec: SubprocessSpawnSpec) => {
      const fake = queue.shift()
      const handle = fake?.handle ?? oneShotChild('exec 答案')
      spawns.push({ spec, handle, ...(fake === undefined ? {} : { fake }) })
      return handle
    },
  })
  ctx.provide('credentials', { resolve: async () => ({ value: 'sk-test', source: 'env' }) })
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
  const driver = new DshLiveDriver(ctx, options.config ?? {}, options.timeouts)
  return {
    ctx,
    homeDir,
    spawns,
    reports,
    records,
    settles,
    queueChild: child => { queue.push(child) },
    driver,
  }
}

/** The resolved request shape the driver consumes. */
function request(over: { prompt?: string; signal?: AbortSignal } = {}): unknown {
  return {
    prompt: [{ type: 'text', text: over.prompt ?? '建个文件' }],
    parent: { session: { id: 'parent-1', header: { cwd: '/tmp' } } },
    descriptor: { description: '测试委派' },
    signal: over.signal ?? new AbortController().signal,
  }
}

function roundSpec(m: Mount, child: Session, over: { resume?: { turn: number } } = {}): Parameters<DshLiveDriver['startRound']>[1] {
  return {
    cwd: '/tmp',
    homeDir: m.homeDir,
    childSession: child,
    sessionId: String(child.id),
    parentSessionId: 'parent-1',
    ...(over.resume === undefined ? {} : { resume: over.resume }),
  }
}

describe('dsh live driver rounds', () => {
  it('spawns the resident serve process, drives a fresh turn, and mirrors events live', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-live-1'))
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, '建个文件', '第一条回复') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: '第一条回复' }])
    const spawn = m.spawns[0]!
    expect(spawn.spec.argv.slice(-3)).toEqual(['--profile', 'headless-local-agent-dsh', '--serve'])
    expect(spawn.spec.stdio).toEqual({ stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    expect(spawn.spec.env).toEqual({ DSH_HOME: m.homeDir, DEEPSEEK_API_KEY: 'sk-test' })
    expect(spawn.fake!.requests.map(r => r.method)).toEqual(['initialize', 'turn/start'])
    expect(spawn.fake!.requests[1]?.params).toMatchObject({ sessionId: 'child-live-1', text: '建个文件', resume: false })
    // Push mirror: the exchange landed in the child session event-by-event.
    expect(child.snapshotEvents().filter(e => e.type === 'user/message')).toHaveLength(1)
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1)
    // The sub-dsh's step boundary pair crossed verbatim around the reply —
    // without it the real-time subsession view would not render the message.
    expectStepBoundaries(child)
    // Turn boundaries are the parent's own (opened after the accept ack, closed at settle).
    expect(child.snapshotEvents().filter(e => e.type === 'turn/start')).toHaveLength(1)
    expect(child.snapshotEvents().find(e => e.type === 'turn/end')?.data).toMatchObject({ turn: 1, reason: { kind: 'completed' } })
    // Progress: deltas for each mirrored event, then the authoritative mirror report.
    expect(m.reports.some(r => r.progress.kind === 'delta' && r.progress.text === '第一条回复')).toBe(true)
    await vi.waitFor(() => {
      expect(m.reports.some(r => r.progress.kind === 'mirror')).toBe(true)
    })
    await run.dispose()
    await m.driver.disposeAll()
    expect(m.driver.liveCount).toBe(0)
  })

  it('reports the settled round’s observation read off the sub-dsh session log', async () => {
    // The live drive's half of the exec path's settle-mirror report: the
    // settle pass's mirrorDshSession delta carries the round's model
    // attribution and usage, and the round reports them through the
    // registry's observation channel — the gap that left prod's live-driven
    // delegations without observedModel.
    const m = mount()
    const child = Session.create(SessionId('child-live-obs'))
    m.queueChild(new FakeServeChild({
      turn: () => {
        // The serve side flushed its session log before the idle
        // notification; the settle mirror reads it back.
        const dir = join(m.homeDir, 'sessions', 'wd_test', 'child-live-obs')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'session.jsonl'), [
          JSON.stringify({ type: 'session', version: 0, id: 'child-live-obs' }),
          JSON.stringify({ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }),
          JSON.stringify({
            type: 'user/message', seq: 0, time: 1,
            data: { content: [{ type: 'text', text: '建个文件' }], source: { kind: 'user' }, role: 'user' },
          }),
          JSON.stringify({ type: 'step/start', seq: 0, time: 1, data: { turn: 1, step: 1 } }),
          JSON.stringify({
            type: 'assistant/message', seq: 0, time: 1,
            data: {
              turn: 1, step: 1,
              message: { content: [{ type: 'text', text: '第一条回复' }], source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
              usage: { inputTokens: 100, outputTokens: 10 },
            },
          }),
          JSON.stringify({ type: 'step/end', seq: 0, time: 1, data: { turn: 1, step: 1 } }),
          JSON.stringify({ type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } }),
        ].join('\n') + '\n')
        return { events: answerEvents(1, '建个文件', '第一条回复') }
      },
    }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(m.settles).toHaveLength(1) })
    expect(m.settles[0]?.id).toBe('child-live-obs')
    expect(m.settles[0]?.round).toMatchObject({
      observedModel: 'deepseek-official/deepseek-v4-flash',
      usage: { inputTokens: 100, outputTokens: 10 },
    })
    await m.driver.disposeAll()
  })

  it('a settled round whose session log named no model still reports, with the observation absent', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-live-no-obs'))
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, '建个文件', '第一条回复') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(m.settles).toHaveLength(1) })
    expect(m.settles[0]?.id).toBe('child-live-no-obs')
    expect(m.settles[0]?.round['observedModel']).toBeUndefined()
    await m.driver.disposeAll()
  })

  it('keeps the parent turn/start ahead of events even when the ack and events arrive in one chunk', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-live-1b'))
    m.queueChild(new FakeServeChild({
      batchWithAck: true,
      turn: () => ({ events: answerEvents(1, '建个文件', '同块回复') }),
    }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    const types = child.snapshotEvents().map(e => e.type)
    // The parent's own boundary opens the round; mirrored events follow it.
    expect(types[0]).toBe('turn/start')
    expect(types.indexOf('user/message')).toBeGreaterThan(types.indexOf('turn/start'))
    expect(types.at(-1)).toBe('turn/end')
    await m.driver.disposeAll()
  })

  it('reuses the resident runtime for the resume round (one process, two turns)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-live-2'))
    m.queueChild(new FakeServeChild({
      turn: params => ({
        events: answerEvents(params['resume'] === true ? 2 : 1, 'task', params['resume'] === true ? '第二条' : '第一条'),
      }),
    }))
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await first.result).stopReason).toBe('completed')
    const second = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { turn: 2 } }))
    expect((await second.result).stopReason).toBe('completed')
    expect(m.spawns).toHaveLength(1)
    const starts = m.spawns[0]!.fake!.requests.filter(r => r.method === 'turn/start')
    expect(starts[1]?.params).toMatchObject({ sessionId: 'child-live-2', text: '继续', resume: true })
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(2)
    expect(child.snapshotEvents().filter(e => e.type === 'turn/end').at(-1)?.data).toMatchObject({ turn: 2, reason: { kind: 'completed' } })
    await m.driver.disposeAll()
  })

  it('cancels via a runtime interrupt — the process survives and stays reusable', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-live-3'))
    // The turn never closes on its own; the interrupt is what settles the wait.
    const fake = new FakeServeChild({ turn: () => ({ events: [{ type: 'turn/start', data: { turn: 1 } }], reason: null }) })
    m.queueChild(fake)
    const controller = new AbortController()
    const run = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    controller.abort()
    const result = await run.result
    expect(result.stopReason).toBe('aborted')
    expect(fake.requests.map(r => r.method)).toContain('turn/interrupt')
    expect(fake.terminated).toBe(false)
    await run.dispose()
    expect(fake.terminated).toBe(false)
    // Turn/end mirrors the exec path's parent-abort shape.
    expect(child.snapshotEvents().find(e => e.type === 'turn/end')?.data).toMatchObject({
      turn: 1,
      reason: { kind: 'aborted', reason: { kind: 'parent' } },
    })
    await m.driver.disposeAll()
  })

  it('settles error when the turn closes with an error reason', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-live-4'))
    m.queueChild(new FakeServeChild({
      turn: () => ({ events: answerEvents(1, 't', ''), reason: { kind: 'error', error: { code: 'SERVER', message: 'provider down' } } }),
    }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('error')
    expect(child.snapshotEvents().find(e => e.type === 'turn/end')?.data).toMatchObject({ reason: { kind: 'error' } })
    await m.driver.disposeAll()
  })

  it('ignores retired chunk-shaped events in both granularities (host 0.1.5)', async () => {
    // The 0.1.5 sub-dsh never emits per-chunk events (the type is retired); a
    // chunk-shaped row pushed by an older wire crosses in NEITHER granularity.
    const events: Partial<SessionEvent>[] = [
      { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hel' } } },
      { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'lo' } } },
      ...answerEvents(1, 't', 'hello'),
    ] as Partial<SessionEvent>[]
    const off = mount()
    const offChild = Session.create(SessionId('child-live-5a'))
    off.queueChild(new FakeServeChild({ turn: () => ({ events }) }))
    const offRun = await off.driver.startRound(request() as never, roundSpec(off, offChild))
    await offRun.result
    expect(offChild.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1)
    await off.driver.disposeAll()

    const on = mount({ config: { liveMirrorGranularity: 'token' } })
    const onChild = Session.create(SessionId('child-live-5b'))
    on.queueChild(new FakeServeChild({ turn: () => ({ events }) }))
    const onRun = await on.driver.startRound(request() as never, roundSpec(on, onChild))
    await onRun.result
    expect(onChild.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1)
    // Identical logs: granularity no longer changes what crosses.
    expect(onChild.snapshotEvents().map(e => e.type)).toEqual(offChild.snapshotEvents().map(e => e.type))
    await on.driver.disposeAll()
  })
})

describe('dsh live driver lifecycle', () => {
  it('reclaims the runtime after the idle timeout (wire shutdown, no SIGTERM when it cooperates)', async () => {
    const m = mount({ config: { liveIdleMs: 30 } })
    const child = Session.create(SessionId('child-live-6'))
    const fake = new FakeServeChild({ turn: () => ({ events: answerEvents(1, 't', 'done') }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    expect(fake.requests.map(r => r.method)).toContain('shutdown')
    expect(fake.terminated).toBe(false)
  })

  it('terminates a runtime that ignores the shutdown request', async () => {
    const m = mount({ config: { liveIdleMs: 30 } })
    const child = Session.create(SessionId('child-live-7'))
    const fake = new FakeServeChild({ turn: () => ({ events: answerEvents(1, 't', 'done') }), silent: ['shutdown'] })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    await vi.waitFor(() => { expect(fake.terminated).toBe(true) }, { timeout: 5_000 })
    expect(m.driver.liveCount).toBe(0)
  })

  it('re-spawns and resumes after a mid-life crash (the session id survives on disk)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-live-8'))
    const first = new FakeServeChild({ turn: () => ({ events: answerEvents(1, 't', '第一条') }) })
    m.queueChild(first)
    const firstRun = await m.driver.startRound(request() as never, roundSpec(m, child))
    await firstRun.result
    first.crash()
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    const second = new FakeServeChild({ turn: () => ({ events: answerEvents(2, '继续', '第二条') }) })
    m.queueChild(second)
    const secondRun = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { turn: 2 } }))
    expect((await secondRun.result).stopReason).toBe('completed')
    expect(m.spawns).toHaveLength(2)
    expect(second.requests.map(r => r.method)).toEqual(['initialize', 'turn/start'])
    expect(second.requests[1]?.params).toMatchObject({ resume: true })
    await m.driver.disposeAll()
  })

  it('settles the round error when the runtime dies mid-turn', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-live-9'))
    m.queueChild(new FakeServeChild({ crashAfterTurnStart: true }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('error')
    await m.driver.disposeAll()
  })

  it('reclaims the runtime when the turn accept fails', async () => {
    const m = mount({ timeouts: { initializeMs: 1_000, requestMs: 30, convergeMs: 30 } })
    const child = Session.create(SessionId('child-live-10'))
    const fake = new FakeServeChild({ silent: ['turn/start'] })
    m.queueChild(fake)
    await expect(m.driver.startRound(request() as never, roundSpec(m, child))).rejects.toThrow('timed out')
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    // The reclaim ladder went out over the wire; the cooperative fake exited
    // on shutdown, so SIGTERM was never needed.
    expect(fake.requests.map(r => r.method)).toContain('shutdown')
    expect(fake.terminated).toBe(false)
  })

  it('disposeAll reclaims every runtime (no zombies on profile restart)', async () => {
    const m = mount()
    const first = Session.create(SessionId('child-live-11a'))
    const second = Session.create(SessionId('child-live-11b'))
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, 't', 'a') }) }))
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, 't', 'b') }) }))
    const runA = await m.driver.startRound(request() as never, roundSpec(m, first))
    const runB = await m.driver.startRound(request() as never, roundSpec(m, second))
    await Promise.all([runA.result, runB.result])
    expect(m.driver.liveCount).toBe(2)
    await m.driver.disposeAll()
    expect(m.driver.liveCount).toBe(0)
    for (const spawn of m.spawns) {
      expect(spawn.fake!.requests.map(r => r.method)).toContain('shutdown')
    }
  })
})

describe('dsh-cli-provider live dispatch', () => {
  it('routes rounds to the live driver when configured, recording the same delegation identity', async () => {
    const m = mount()
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, '建个文件', '完成') }) }))
    const provider = new DshCliProvider(m.ctx, { live: true }, m.driver)
    const run = await provider.start(request() as never)
    expect((await run.result).stopReason).toBe('completed')
    const argv = m.spawns[0]!.spec.argv
    expect(argv[argv.length - 1]).toBe('--serve')
    // The delegation record is identical to the exec path: cliSessionId == childSessionId.
    expect(m.records).toHaveBeenCalledTimes(1)
    const record = m.records.mock.calls[0]![0] as { childSessionId: string; cliSessionId: string; provider: string }
    expect(record.provider).toBe('dsh-cli')
    expect(record.cliSessionId).toBe(record.childSessionId)
    await m.driver.disposeAll()
  })

  it('falls back to the exec one-shot when the serve channel fails its handshake, and stays there', async () => {
    const m = mount()
    // The serve process never answers initialize; the driver breaks the
    // channel and the provider retries the round on the exec one-shot (the
    // default oneShotChild, which prints the answer and exits 0).
    m.queueChild(new FakeServeChild({ silent: ['initialize'] }))
    const driver = new DshLiveDriver(m.ctx, {}, { initializeMs: 50, requestMs: 50, convergeMs: 50, channelRetryMs: 60_000 })
    const provider = new DshCliProvider(m.ctx, { live: true }, driver)
    const run = await provider.start(request() as never)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'exec 答案' }])
    expect(m.spawns).toHaveLength(2)
    expect(m.spawns[0]!.spec.argv[m.spawns[0]!.spec.argv.length - 1]).toBe('--serve')
    expect(m.spawns[1]!.spec.argv).toContain('--session-id')
    expect(driver.disabled).toBe(true)
    await run.dispose()
  })
})

describe('B1: cancel in the slow spawn/handshake/accept windows', () => {
  it('cancel during the handshake window settles aborted fast, reclaims the half-spawn, and does not trip the breaker', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-b1-1'))
    // The serve process boots but never answers initialize (slow cold boot).
    const fake = new FakeServeChild({ silent: ['initialize'] })
    m.queueChild(fake)
    const controller = new AbortController()
    const start = Date.now()
    const run = await (async () => {
      const pending = m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
      setTimeout(() => { controller.abort() }, 20)
      return pending
    })()
    // The cancel returned the run immediately instead of hanging for the
    // 60s handshake timeout.
    expect(Date.now() - start).toBeLessThan(5_000)
    expect((await run.result).stopReason).toBe('aborted')
    // No turn ever existed: no boundary, no interrupt, and the half-spawned
    // runtime was reclaimed.
    expect(child.snapshotEvents()).toHaveLength(0)
    expect(fake.requests.map(r => r.method)).not.toContain('turn/interrupt')
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    expect(fake.requests.map(r => r.method)).toContain('shutdown')
    // A caller cancel says nothing about channel health: the breaker stays off.
    expect(m.driver.disabled).toBe(false)
  })

  it('cancel during the accept window interrupts (the turn may exist sub-side) and settles aborted', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-b1-2'))
    // Handshake answers; turn/start never does (a wedged accept).
    const fake = new FakeServeChild({ silent: ['turn/start'] })
    m.queueChild(fake)
    const controller = new AbortController()
    const driver = new DshLiveDriver(m.ctx, {}, { initializeMs: 1_000, requestMs: 200, convergeMs: 50, channelRetryMs: 1_000 })
    const pending = driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    await vi.waitFor(() => { expect(fake.requests.map(r => r.method)).toContain('turn/start') })
    controller.abort()
    const run = await pending
    expect((await run.result).stopReason).toBe('aborted')
    // The interrupt went out (the accept was in flight), the process survived
    // to unwind gracefully, and no parent-side turn boundary was opened.
    expect(fake.requests.map(r => r.method)).toContain('turn/interrupt')
    expect(child.snapshotEvents().filter(e => e.type === 'turn/start')).toHaveLength(0)
    await driver.disposeAll()
  })
})

describe('B2: stop-then-rephrase never mis-settles the next round', () => {
  it('a cancelled round’s late unwind idle (and events) are tagged out of the resumed round', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-b2'))
    child.append('turn/start', { turn: 1 })
    // Round 1's turn never closes on its own; the test drives the unwind by hand.
    const fake = new FakeServeChild({ turn: () => ({ events: [], reason: null }) })
    m.queueChild(fake)
    const controller = new AbortController()
    const first = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    controller.abort()
    expect((await first.result).stopReason).toBe('aborted')

    // The user immediately rephrases: round 2 starts on the SAME runtime.
    const second = await m.driver.startRound(request({ prompt: '换个说法' }) as never, roundSpec(m, child, { resume: { turn: 2 } }))
    // Round 1's unwind lands late — tagged turn 1, it must not touch round 2.
    fake.pushEvent('child-b2', 1, { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'round1 残尾' }], source: { provider: 'p', model: 'm' } } } })
    fake.pushIdle('child-b2', 1, { kind: 'aborted', reason: { kind: 'parent' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    // Round 2's real events and close arrive; only they settle it.
    fake.pushEvent('child-b2', 2, { type: 'user/message', data: { content: [{ type: 'text', text: '换个说法' }], source: { kind: 'user' }, role: 'user' } })
    fake.pushEvent('child-b2', 2, { type: 'assistant/message', data: { turn: 2, step: 1, message: { content: [{ type: 'text', text: '第二条回复' }], source: { provider: 'p', model: 'm' } } } })
    fake.pushIdle('child-b2', 2, { kind: 'completed' })
    expect((await second.result).stopReason).toBe('completed')
    expect((await second.result).output).toEqual([{ type: 'text', text: '第二条回复' }])
    // The stale round-1 event never entered the child session.
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')
      .map(e => JSON.stringify(e.data))).toEqual([expect.stringContaining('第二条回复')] as unknown as string[])
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1)
    await m.driver.disposeAll()
  })
})

describe('follow-up hardening (S1–S6)', () => {
  it('S3: malformed and shapeless notifications degrade to warns, the round still completes', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-s3'))
    const fake = new FakeServeChild({
      turn: params => ({ events: answerEvents(params['turn'] as number, 't', '扛住') }),
    })
    m.queueChild(fake)
    const pending = m.driver.startRound(request() as never, roundSpec(m, child))
    await vi.waitFor(() => { expect(fake.requests.map(r => r.method)).toContain('turn/start') })
    fake.pushRaw(Buffer.from('{"jsonrpc":"2.0","method":"session/event","params":null}\n'))
    fake.pushRaw(Buffer.from('{"jsonrpc":"2.0","method":"session/event","params":{"sessionId":123}}\n'))
    fake.pushRaw(Buffer.from('{"jsonrpc":"2.0","method":"session/idle","params":{"sessionId":"child-s3"}}\n')) // no turn
    fake.pushRaw(Buffer.from('not json at all\n'))
    const run = await pending
    expect((await run.result).stopReason).toBe('completed')
    expect(m.driver.liveCount).toBe(1)
    await m.driver.disposeAll()
  })

  it('S4: a multi-byte UTF-8 sequence split across chunks survives intact', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-s4'))
    const fake = new FakeServeChild({ turn: () => ({ events: [], reason: null }) })
    m.queueChild(fake)
    const pending = m.driver.startRound(request() as never, roundSpec(m, child))
    await vi.waitFor(() => { expect(fake.requests.map(r => r.method)).toContain('turn/start') })
    const line = JSON.stringify({
      jsonrpc: '2.0', method: 'session/event',
      params: {
        sessionId: 'child-s4', turn: 1,
        event: { seq: 1, time: 1, type: 'user/message', data: { content: [{ type: 'text', text: '建个文件' }], source: { kind: 'user' }, role: 'user' } },
      },
    }) + '\n'
    const bytes = Buffer.from(line, 'utf8')
    // Split inside the 3-byte sequence of 建 (E5 BB BA).
    const splitAt = bytes.indexOf(0xe5) + 1
    fake.pushRaw(bytes.subarray(0, splitAt))
    await new Promise(resolve => setTimeout(resolve, 10))
    fake.pushRaw(bytes.subarray(splitAt))
    fake.pushIdle('child-s4', 1, { kind: 'completed' })
    const run = await pending
    expect((await run.result).stopReason).toBe('error') // no assistant answer — but the event survived
    const mirrored = child.snapshotEvents().find(e => e.type === 'user/message')
    expect(JSON.stringify(mirrored?.data)).toContain('建个文件')
    await m.driver.disposeAll()
  })

  it('S1: disposeAll during an in-flight handshake reclaims the half-spawned runtime', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-s1'))
    const fake = new FakeServeChild({ silent: ['initialize'] })
    m.queueChild(fake)
    const pending = m.driver.startRound(request() as never, roundSpec(m, child))
    await vi.waitFor(() => { expect(m.spawns).toHaveLength(1) })
    await m.driver.disposeAll()
    await expect(pending).rejects.toThrow()
    // The reclaim ladder went out over the wire; the cooperative fake exited
    // on shutdown, so SIGTERM was never needed.
    expect(fake.requests.map(r => r.method)).toContain('shutdown')
    expect(m.driver.liveCount).toBe(0)
  })

  it('S2: concurrent rounds for one member are serialized (single spawn, sink never overwritten)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-s2'))
    // Round 1's turn never closes on its own; the test closes it by hand.
    const fake = new FakeServeChild({ turn: () => ({ events: [], reason: null }) })
    m.queueChild(fake)
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    // Round 2 enters while round 1 is in flight: it must WAIT, and it must
    // not spawn a second process.
    const secondPending = m.driver.startRound(request({ prompt: '换个说法' }) as never, roundSpec(m, child, { resume: { turn: 2 } }))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(m.spawns).toHaveLength(1)
    expect(fake.requests.filter(r => r.method === 'turn/start')).toHaveLength(1)
    // Round 1 closes; round 2's turn goes out only after that.
    fake.pushIdle('child-s2', 1, { kind: 'completed' })
    // Round 1 had no assistant output, so it settles error — fine; the point
    // is round 2 proceeds afterwards and settles cleanly.
    await first.result
    const second = await secondPending
    expect(fake.requests.filter(r => r.method === 'turn/start')).toHaveLength(2)
    await m.driver.disposeAll()
    void second
  })

  it('S5: a tripped breaker retries live after the cooldown instead of sticking to exec', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-s5'))
    m.queueChild(new FakeServeChild({ silent: ['initialize'] }))
    const driver = new DshLiveDriver(m.ctx, {}, { initializeMs: 30, requestMs: 30, convergeMs: 30, channelRetryMs: 60 })
    await expect(driver.startRound(request() as never, roundSpec(m, child))).rejects.toThrow()
    expect(driver.disabled).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(driver.disabled).toBe(false)
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, 't', '回来了') }) }))
    const run = await driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await driver.disposeAll()
  })

  it('S6: an accept failure leaves no dangling turn/start and reclaims the runtime', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-s6'))
    const fake = new FakeServeChild({ silent: ['turn/start'] })
    m.queueChild(fake)
    const driver = new DshLiveDriver(m.ctx, {}, { initializeMs: 1_000, requestMs: 40, convergeMs: 40, channelRetryMs: 1_000 })
    await expect(driver.startRound(request() as never, roundSpec(m, child))).rejects.toThrow('timed out')
    expect(child.snapshotEvents().filter(e => e.type === 'turn/start')).toHaveLength(0)
    await vi.waitFor(() => { expect(driver.liveCount).toBe(0) })
    expect(fake.requests.map(r => r.method)).toContain('shutdown')
    // An accept failure is a round failure, not a broken channel.
    expect(driver.disabled).toBe(false)
    await driver.disposeAll()
  })
})

describe('dsh live driver persistence (live sessions sync through the core)', () => {
  it('a live-backed child folds each event once, persisting only through the core sync (never the redundant full-list append)', async () => {
    const m = mount({ strictPersistence: true })
    const child = Session.create(SessionId('child-dsh-livepersist'))
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, '建个文件', '文件建好了') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    // The strict double's rejection would have killed the settle pass BEFORE
    // the mirror report; with the live session persisting through the core's
    // syncChildSession, the redundant full-list append never fires and the
    // authoritative report lands.
    await vi.waitFor(() => {
      expect(m.reports.some(r => r.progress.kind === 'mirror')).toBe(true)
    })
    expect(child.snapshotEvents().filter(e => e.type === 'user/message')).toHaveLength(1)
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1)
    await m.driver.disposeAll()
  })
})

describe('dsh live driver drain (settings handoff)', () => {
  it('refuses new rounds immediately once draining (no queueing behind in-flight work)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-dsh-drain1'))
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, 't', 'done') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.driver.hasRuntime('child-dsh-drain1')).toBe(true)
    const drained = m.driver.drain()
    await expect(m.driver.startRound(request() as never, roundSpec(m, child))).rejects.toThrow('draining')
    await drained
    expect(m.driver.liveCount).toBe(0)
    expect(m.driver.hasRuntime('child-dsh-drain1')).toBe(false)
  })

  it('lets the in-flight round finish undisturbed, then reclaims the runtime', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-dsh-drain2'))
    // The turn never closes on its own; the test closes it by hand.
    const fake = new FakeServeChild({ turn: () => ({ events: answerEvents(1, 't', '慢慢做'), reason: null }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    let drainedFlag = false
    const drained = m.driver.drain().then(() => { drainedFlag = true })
    // The hung round is still in flight: drain waits, the process lives.
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(drainedFlag).toBe(false)
    expect(fake.requests.map(r => r.method)).not.toContain('shutdown')
    fake.pushIdle('child-dsh-drain2', 1, { kind: 'completed' })
    // The in-flight turn settles normally (its events already mirrored).
    expect((await run.result).stopReason).toBe('completed')
    await drained
    expect(m.driver.liveCount).toBe(0)
    expect(fake.requests.map(r => r.method)).toContain('shutdown')
  })

  it('a round queued before the drain dequeues into the refusal (provider falls back to exec)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-dsh-drain3'))
    const fake = new FakeServeChild({ turn: () => ({ events: [], reason: null }) })
    m.queueChild(fake)
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    // Chain round 2 BEFORE draining, then drain while round 1 hangs.
    const second = m.driver.startRound(request({ prompt: '第二轮' }) as never, roundSpec(m, child, { resume: { turn: 2 } }))
    const drained = m.driver.drain()
    fake.pushIdle('child-dsh-drain3', 1, { kind: 'completed' })
    await first.result.catch(() => {})
    await expect(second).rejects.toThrow('draining')
    await drained
    // Round 2 never reached the wire.
    expect(fake.requests.filter(r => r.method === 'turn/start')).toHaveLength(1)
    expect(m.driver.liveCount).toBe(0)
  })

  it('legacy granularity changes leave incremental rounds on the same generation', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-dsh-drain4'))
    m.queueChild(new FakeServeChild({
      turn: params => params['resume'] === true
        ? {
          events: [
            { type: 'assistant/chunk', data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: '逐' } } },
            { type: 'assistant/chunk', data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: '字' } } },
            ...answerEvents(2, '继续', '第二条'),
          ],
        }
        : {
          events: [
            { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '不' } } },
            ...answerEvents(1, 't', '第一条'),
          ],
        },
    }))
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    await first.result
    // Retired chunk-shaped rows stay behind in BOTH granularities (host 0.1.5
    // has no per-chunk event); the message rows cross.
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1)
    m.driver.setLiveMirrorGranularity('event')
    const second = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { turn: 2 } }))
    await second.result
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(2)
    // Same runtime, same process: granularity rides the existing generation.
    expect(m.spawns).toHaveLength(1)
    await m.driver.disposeAll()
  })
})

describe('dsh-cli-provider live resolver', () => {
  it('a resolver returning undefined routes the round to exec (retiring-generation gate)', async () => {
    const m = mount()
    // No serve child queued: the exec fallback spawn answers.
    const provider = new DshCliProvider(m.ctx, {}, () => undefined)
    const run = await provider.start(request() as never)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'exec 答案' }])
    expect(m.spawns[0]!.spec.argv).toContain('--session-id')
    await run.dispose()
  })

  it('a resolver returning the driver per member routes to live (backward compatible)', async () => {
    const m = mount()
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, '建个文件', '完成') }) }))
    const provider = new DshCliProvider(m.ctx, {}, () => m.driver)
    const run = await provider.start(request() as never)
    expect((await run.result).stopReason).toBe('completed')
    const argv = m.spawns[0]!.spec.argv
    expect(argv[argv.length - 1]).toBe('--serve')
    await m.driver.disposeAll()
  })
})

describe('dsh live driver member-aware model', () => {
  /** The value following `--model` on the spawned argv, or undefined when absent. */
  function modelFlag(argv: readonly string[]): string | undefined {
    const at = argv.indexOf('--model')
    return at < 0 ? undefined : argv[at + 1]
  }

  it('unset: the serve argv carries no --model (the sub-dsh inherits the host default)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-dsh-model-off'))
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, '建个文件', '完成') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.spawns[0]!.spec.argv).not.toContain('--model')
    expect(m.driver.boundModelOf(String(child.id))).toBeUndefined()
    await run.dispose()
  })

  it('the spawn resolver binds --model for the member (override → settings)', async () => {
    const m = mount({ config: { modelFor: () => 'deepseek-official/deepseek-chat' } })
    const child = Session.create(SessionId('child-dsh-model-cfg'))
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, '建个文件', '完成') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(modelFlag(m.spawns[0]!.spec.argv)).toBe('deepseek-official/deepseek-chat')
    expect(m.driver.boundModelOf(String(child.id))).toBe('deepseek-official/deepseek-chat')
    await run.dispose()
  })

  it('a round start model binds the spawn argv, outranking the spawn resolver', async () => {
    const m = mount({ config: { modelFor: () => 'config/model' } })
    const child = Session.create(SessionId('child-dsh-start-model'))
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, '建个文件', '完成') }) }))
    const run = await m.driver.startRound(request() as never, {
      ...roundSpec(m, child),
      startModel: 'delegation/model',
    })
    await run.result
    expect(modelFlag(m.spawns[0]!.spec.argv)).toBe('delegation/model')
    expect(m.driver.boundModelOf(String(child.id))).toBe('delegation/model')
    await run.dispose()
  })

  it('a round naming the bound model keeps the resident runtime (no respawn)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-dsh-same-model'))
    m.queueChild(new FakeServeChild({
      turn: params => params['resume'] === true
        ? { events: answerEvents(2, '继续', '第二条') }
        : { events: answerEvents(1, '建个文件', '第一条') },
    }))
    const first = await m.driver.startRound(request() as never, { ...roundSpec(m, child), startModel: 'model-a' })
    await first.result
    await first.dispose()
    const second = await m.driver.startRound(request({ prompt: '继续' }) as never, {
      ...roundSpec(m, child, { resume: { turn: 2 } }),
      startModel: 'model-a',
    })
    await second.result
    await second.dispose()
    expect(m.spawns).toHaveLength(1)
    await m.driver.disposeAll()
  })

  it('a round naming a DIFFERENT model retires the resident runtime and respawns onto it', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-dsh-switch-model'))
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, '建个文件', '第一条') }) }))
    const first = await m.driver.startRound(request() as never, { ...roundSpec(m, child), startModel: 'model-a' })
    await first.result
    await first.dispose()
    const oldRuntime = m.spawns[0]!.fake!
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(2, '继续', '第二条') }) }))
    const second = await m.driver.startRound(request({ prompt: '继续' }) as never, {
      ...roundSpec(m, child, { resume: { turn: 2 } }),
      startModel: 'model-b',
    })
    await second.result
    await second.dispose()
    // The old process answered the wire shutdown and exited; the respawn
    // bound model-b.
    await oldRuntime.done
    expect(m.spawns).toHaveLength(2)
    expect(modelFlag(m.spawns[1]!.spec.argv)).toBe('model-b')
    expect(m.driver.boundModelOf(String(child.id))).toBe('model-b')
    await m.driver.disposeAll()
  })

  it('retireRuntime reclaims the member runtime so the next round respawns', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-dsh-retire'))
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(1, '建个文件', '第一条') }) }))
    const first = await m.driver.startRound(request() as never, { ...roundSpec(m, child), startModel: 'model-a' })
    await first.result
    await first.dispose()
    expect(m.driver.boundModelOf(String(child.id))).toBe('model-a')
    await m.driver.retireRuntime(String(child.id))
    expect(m.driver.boundModelOf(String(child.id))).toBeNull()
    m.queueChild(new FakeServeChild({ turn: () => ({ events: answerEvents(2, '继续', '第二条') }) }))
    const second = await m.driver.startRound(request({ prompt: '继续' }) as never, {
      ...roundSpec(m, child, { resume: { turn: 2 } }),
      startModel: 'model-b',
    })
    await second.result
    await second.dispose()
    expect(m.spawns).toHaveLength(2)
    expect(modelFlag(m.spawns[1]!.spec.argv)).toBe('model-b')
    await m.driver.disposeAll()
  })
})
