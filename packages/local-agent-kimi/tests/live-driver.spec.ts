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
        respond({ sessionId: `acp-session-${this.sessionSeq}` })
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
    get: () => undefined,
    acquireResumeLock: () => true,
    releaseResumeLock: () => {},
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
    get: () => undefined,
  })
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
    expect(child.events.find(e => e.type === 'turn/end')?.data).toMatchObject({ turn: 1, reason: { kind: 'completed' } })
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
      expect(child.events.filter(e => e.type === 'user/message')).toHaveLength(1)
      expect(child.events.filter(e => e.type === 'assistant/message')).toHaveLength(1)
    })
    const assistant = child.events.find(e => e.type === 'assistant/message')
    expect(assistant?.data).toMatchObject({ usage: { inputTokens: 10, outputTokens: 4 } })
    expect(m.mirrorOffsets.get('child-kimi-2')).toBe(2)
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
    expect(child.events.filter(e => e.type === 'turn/end').at(-1)?.data).toMatchObject({ turn: 2, reason: { kind: 'completed' } })
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
    expect(second.requests[1]?.params).toMatchObject({ sessionId: 'acp-session-1' })
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
    expect(child.events.find(e => e.type === 'turn/end')?.data).toMatchObject({
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
    fake.askPermission('acp-session-1', [{ kind: 'allow_once', optionId: 'opt-1' }])
    fake.askPermission('acp-session-1', [{ kind: 'reject_once', optionId: 'opt-2' }])
    const run = await pending
    expect((await run.result).stopReason).toBe('completed')
    expect(fake.serverAnswers).toContainEqual({ outcome: { outcome: 'selected', optionId: 'opt-1' } })
    expect(fake.serverAnswers).toContainEqual({ outcome: { outcome: 'cancelled' } })
    await m.driver.disposeAll()
  })

  it('appends assistant/chunk deltas only under the token granularity', async () => {
    const off = mount()
    const offChild = Session.create(SessionId('child-kimi-8a'))
    off.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['hel', 'lo'] }) }))
    const offRun = await off.driver.startRound(request() as never, roundSpec(off, offChild))
    await offRun.result
    expect(offChild.events.filter(e => e.type === 'assistant/chunk')).toHaveLength(0)
    await off.driver.disposeAll()

    const on = mount({ config: { liveMirrorGranularity: 'token' } })
    const onChild = Session.create(SessionId('child-kimi-8b'))
    on.queueChild(new FakeAcpServer({ turn: () => ({ chunks: ['hel', 'lo'] }) }))
    const onRun = await on.driver.startRound(request() as never, roundSpec(on, onChild))
    await onRun.result
    expect(onChild.events.filter(e => e.type === 'assistant/chunk')).toHaveLength(2)
    await on.driver.disposeAll()
  })

  it('settles error when session/new fails (auth) and reclaims the runtime', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-kimi-9'))
    m.queueChild(new FakeAcpServer({ failSessionNew: 'Authentication required' }))
    await expect(m.driver.startRound(request() as never, roundSpec(m, child))).rejects.toThrow('Authentication required')
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    expect(child.events.filter(e => e.type === 'turn/start')).toHaveLength(0)
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
    expect(child.events).toHaveLength(0)
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
    expect(child.events.find(e => e.type === 'turn/end')?.data).toMatchObject({ reason: { kind: 'error' } })
    await m.driver.disposeAll()
  })
})
