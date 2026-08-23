/**
 * The codex live driver: resident app-server lifecycle (spawn, initialize
 * handshake, thread start/resume, idle reclaim, crash re-spawn), the round
 * settlement contract, push-mode item mirroring with the exec fold's line
 * shape, turn-id-tagged round isolation (the stop-then-rephrase gesture),
 * graceful turn/interrupt, unattended approval auto-answers, and the
 * provider's exec fallback.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { CodexCliProvider } from '../src/codex-cli-provider.ts'
import { CodexLiveDriver, codexAppServerItemToLine } from '../src/live-driver.ts'

/** One scripted turn: items to complete, optional deltas, terminal status. */
interface FakeTurn {
  items?: Record<string, unknown>[]
  /** [itemId, delta] pairs pushed as item/agentMessage/delta. */
  deltas?: [string, string][]
  usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number }
  status?: 'completed' | 'interrupted' | 'failed'
  errorMessage?: string
  /** Never close the turn (cancel-path tests drive it by hand). */
  hang?: boolean
}

interface FakeAppServerScript {
  turn?: (params: Record<string, unknown>) => FakeTurn
  silent?: readonly string[]
  crashAfterTurnStart?: boolean
  /** Send one command-approval server request mid-turn and record the answer. */
  askApproval?: boolean
  /** Emit turn/started BEFORE the turn/start response (accept-window cancel tests). */
  startedBeforeAck?: boolean
}

/** A fake `codex app-server --stdio` process speaking the vendor wire. */
class FakeAppServer {
  readonly stdin = new PassThrough()
  readonly stdout = new Readable({ read() {} })
  readonly stderr = new Readable({ read() {} })
  readonly handle: SubprocessHandle
  readonly requests: { method: string; params: Record<string, unknown> }[] = []
  readonly serverAnswers: Record<string, unknown>[] = []
  terminated = false
  stdinEnded = false
  private buffer = ''
  private readonly resolveDone: (outcome: { exitCode: number; signal: null }) => void
  readonly done: Promise<{ exitCode: number; signal: null }>
  private threadSeq = 0
  private turnSeq = 0

  constructor(private readonly script: FakeAppServerScript = {}) {
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
      pid: 7242,
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

  /** Push a server→client request and record what the driver answers. */
  ask(method: string, params: Record<string, unknown>): void {
    const id = `srv_${this.requests.length}`
    this.requests.push({ method, params })
    this.send({ jsonrpc: '2.0', id, method, params })
    // The driver's response is read back through stdin in dispatch().
    void id
  }

  /** Push a notification on the wire. */
  notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  get threadId(): string {
    return `thread-${this.threadSeq}`
  }

  private dispatch(message: { id?: string; method?: string; params?: Record<string, unknown>; result?: unknown }): void {
    // A driver RESPONSE to one of our server requests.
    if (message.id !== undefined && message.method === undefined) {
      this.serverAnswers.push(message.result as Record<string, unknown>)
      return
    }
    if (message.method === undefined || message.id === undefined) return
    const params = message.params ?? {}
    if (message.method !== 'turn/interrupt') {
      this.requests.push({ method: message.method, params })
    } else {
      this.requests.push({ method: message.method, params })
    }
    if (this.script.silent?.includes(message.method) === true) return
    const respond = (result: unknown) => this.send({ jsonrpc: '2.0', id: message.id, result })
    switch (message.method) {
      case 'initialize':
        respond({ serverInfo: { name: 'codex-app-server', version: '0.144.0' } })
        return
      case 'thread/start':
        this.threadSeq += 1
        respond({ thread: { id: `thread-${this.threadSeq}`, ephemeral: params['ephemeral'] ?? false } })
        return
      case 'thread/resume':
        respond({ thread: { id: params['threadId'] } })
        return
      case 'turn/start': {
        this.turnSeq += 1
        const turnId = `turn-${this.turnSeq}`
        const threadId = String(params['threadId'])
        if (this.script.startedBeforeAck === true) {
          // The notification races the response: the driver's pendingTurnId
          // adoption is what makes the accept window cancellable.
          this.notify('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } })
        }
        respond({ turn: { id: turnId, status: 'inProgress' } })
        const turn = this.script.turn?.(params) ?? {}
        queueMicrotask(() => {
          if (this.script.crashAfterTurnStart === true) {
            this.crash()
            return
          }
          if (turn.hang === true) return
          this.runTurn(threadId, turnId, turn)
        })
        return
      }
      case 'turn/interrupt':
        respond({})
        return
      default:
        respond({})
    }
  }

  /** Play out one scripted turn's notifications. */
  runTurn(threadId: string, turnId: string, turn: FakeTurn): void {
    this.notify('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } })
    if (this.script.askApproval === true) {
      this.notify('__never__', {}) // placeholder ordering marker (unused)
    }
    for (const [itemId, delta] of turn.deltas ?? []) {
      this.notify('item/agentMessage/delta', { threadId, turnId, itemId, delta })
    }
    for (const item of turn.items ?? []) {
      this.notify('item/completed', { threadId, turnId, item: { id: `item-${turnId}-${Math.random()}`, ...item } })
    }
    if (turn.usage !== undefined) {
      this.notify('thread/tokenUsage/updated', {
        threadId,
        turnId,
        tokenUsage: { last: { ...turn.usage, reasoningOutputTokens: 0, totalTokens: 0 }, total: {} },
      })
    }
    this.notify('turn/completed', {
      threadId,
      turn: {
        id: turnId,
        status: turn.status ?? 'completed',
        ...(turn.errorMessage === undefined ? {} : { error: { message: turn.errorMessage } }),
      },
    })
  }

  crash(): void {
    this.resolveDone({ exitCode: 1, signal: null })
  }
}

/** The app-server items for one answer, as the vendor emits them. */
function answerItems(answer: string): Record<string, unknown>[] {
  return [
    { type: 'reasoning', summary: ['想一下'], content: [] },
    { type: 'commandExecution', command: 'ls', aggregatedOutput: 'a.txt', status: 'completed' },
    { type: 'agentMessage', text: answer, phase: 'final_answer' },
  ]
}

interface Mount {
  ctx: Context
  homeDir: string
  spawns: { spec: SubprocessSpawnSpec; fake?: FakeAppServer; execHandle?: SubprocessHandle }[]
  reports: { id: string; progress: { kind: string; text?: string; mirroredLines?: number } }[]
  records: ReturnType<typeof vi.fn>
  queueChild(child: FakeAppServer): void
  driver: CodexLiveDriver
}

function mount(options: {
  config?: ConstructorParameters<typeof CodexLiveDriver>[1]
  timeouts?: ConstructorParameters<typeof CodexLiveDriver>[2]
  intent?: unknown
} = {}): Mount {
  const homeDir = mkdtempSync(join(tmpdir(), 'codex-live-'))
  const reports: Mount['reports'] = []
  const spawns: Mount['spawns'] = []
  const queue: FakeAppServer[] = []
  const records = vi.fn()
  const ctx = new Context()
  ctx.provide('localAgent', {
    homeDir: () => homeDir,
    takeDelegationIntent: () => options.intent,
    recordDelegation: records,
    get: () => undefined,
    acquireResumeLock: () => true,
    releaseResumeLock: () => {},
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
      // The exec fallback: emit the NDJSON stream and exit 0.
      const stdout = new Readable({ read() {} })
      const stderr = new Readable({ read() {} })
      stderr.push(null)
      const stream = [
        { type: 'thread.started', thread_id: 'exec-thread' },
        { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'exec 答案' } },
        { type: 'turn.completed', usage: { input_tokens: 3, cached_input_tokens: 1, output_tokens: 2 } },
      ].map(event => JSON.stringify(event)).join('\n')
      setImmediate(() => { stdout.push(stream + '\n'); stdout.push(null) })
      const execHandle: SubprocessHandle = {
        pid: 7251,
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
  const driver = new CodexLiveDriver(ctx, options.config ?? { sandbox: 'workspace-write' }, options.timeouts)
  return {
    ctx,
    homeDir,
    spawns,
    reports,
    records,
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

function roundSpec(m: Mount, child: Session, over: { resume?: { cliSessionId: string; turn: number }; onThreadId?: (id: string) => void } = {}): Parameters<CodexLiveDriver['startRound']>[1] {
  return {
    cwd: '/tmp',
    homeDir: m.homeDir,
    childSession: child,
    parentSessionId: 'parent-1',
    ...(over.resume === undefined ? {} : { resume: over.resume }),
    ...(over.onThreadId === undefined ? {} : { onThreadId: over.onThreadId }),
  }
}

describe('codex app-server item fold (transport → shared line shape)', () => {
  it('maps the app-server item vocabulary onto CodexTranscriptLine', () => {
    expect(codexAppServerItemToLine({ type: 'reasoning', summary: ['想了', '想'], content: ['内容'] }))
      .toEqual({ kind: 'think', text: '想了\n想\n内容' })
    expect(codexAppServerItemToLine({ type: 'agentMessage', text: '答案', phase: 'final_answer' }))
      .toEqual({ kind: 'text', text: '答案' })
    expect(codexAppServerItemToLine({ type: 'commandExecution', command: 'ls', aggregatedOutput: 'a.txt' }))
      .toMatchObject({ kind: 'tool', name: 'Bash', args: 'ls', result: 'a.txt' })
    expect(codexAppServerItemToLine({ type: 'webSearch' })).toMatchObject({ kind: 'tool', name: 'WebSearch' })
    expect(codexAppServerItemToLine({ type: 'mcpToolCall', server: 'dsh-member', tool: 'member_message' }))
      .toMatchObject({ kind: 'tool', name: 'dsh-member/member_message' })
    expect(codexAppServerItemToLine({ type: 'plan', text: '计划' })).toEqual({ kind: 'think', text: '计划' })
    expect(codexAppServerItemToLine({ type: 'userMessage' })).toBeUndefined()
    expect(codexAppServerItemToLine({ type: 'reasoning', summary: [], content: [] })).toBeUndefined()
  })
})

describe('codex live driver rounds', () => {
  it('spawns the resident app-server, creates a persisted thread, drives a turn, and mirrors items live', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-1'))
    const threadIds: string[] = []
    m.queueChild(new FakeAppServer({
      turn: () => ({ items: answerItems('第一条回复'), usage: { inputTokens: 10, cachedInputTokens: 6, outputTokens: 4 } }),
    }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child, { onThreadId: id => { threadIds.push(id) } }))
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: '第一条回复' }])
    expect(threadIds).toEqual(['thread-1'])
    const spawn = m.spawns[0]!
    expect(spawn.spec.argv).toEqual(['codex', 'app-server', '--stdio'])
    expect(spawn.spec.env).toEqual({ CODEX_HOME: m.homeDir })
    expect(spawn.spec.stdio).toEqual({ stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    const methods = spawn.fake!.requests.map(r => r.method)
    expect(methods).toEqual(['initialize', 'thread/start', 'turn/start'])
    expect(spawn.fake!.requests[1]?.params).toMatchObject({
      cwd: '/tmp', ephemeral: false, approvalPolicy: 'never', sandbox: 'workspace-write',
    })
    // Mirroring: the prompt plus the items, with the round's usage on the
    // final assistant line (the hold-back rule); the commandExecution item
    // mirrors as a native tool/call + tool/result pair.
    expect(child.events.filter(e => e.type === 'user/message')).toHaveLength(1)
    const assistant = child.events.filter(e => e.type === 'assistant/message')
    expect(assistant).toHaveLength(2)
    expect(assistant[0]?.data).toMatchObject({ message: { content: [{ type: 'reasoning' }] } })
    expect(assistant[1]?.data).toMatchObject({ usage: { inputTokens: 4, outputTokens: 4, cacheReadTokens: 6 } })
    const calls = child.events.filter(e => e.type === 'tool/call')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.data).toMatchObject({ name: 'Bash', arguments: 'ls' })
    const toolResults = child.events.filter(e => e.type === 'tool/result')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]?.data.message.content[0]).toMatchObject({ content: [{ type: 'text', text: 'a.txt' }] })
    expect(child.events.find(e => e.type === 'turn/end')?.data).toMatchObject({ turn: 1, reason: { kind: 'completed' } })
    expect(m.reports.some(r => r.progress.kind === 'delta' && r.progress.text === '第一条回复')).toBe(true)
    await vi.waitFor(() => { expect(m.reports.some(r => r.progress.kind === 'mirror')).toBe(true) })
    await m.driver.disposeAll()
    expect(m.driver.liveCount).toBe(0)
  })

  it('reuses the resident runtime and thread for the resume round', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-2'))
    child.append('turn/start', { turn: 1 })
    m.queueChild(new FakeAppServer({
      turn: params => ({
        items: [{ type: 'agentMessage', text: `第${String((params['input'] as unknown[]).length)}条`, phase: 'final_answer' }],
      }),
    }))
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await first.result).stopReason).toBe('completed')
    const second = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'thread-1', turn: 2 } }))
    expect((await second.result).stopReason).toBe('completed')
    expect(m.spawns).toHaveLength(1)
    const methods = m.spawns[0]!.fake!.requests.map(r => r.method)
    // thread is already loaded: no second thread/start, no thread/resume.
    expect(methods).toEqual(['initialize', 'thread/start', 'turn/start', 'turn/start'])
    expect(child.events.filter(e => e.type === 'assistant/message')).toHaveLength(2)
    expect(child.events.filter(e => e.type === 'turn/end').at(-1)?.data).toMatchObject({ turn: 2, reason: { kind: 'completed' } })
    await m.driver.disposeAll()
  })

  it('re-spawns and thread/resumes the recorded thread after a crash', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-3'))
    child.append('turn/start', { turn: 1 })
    const first = new FakeAppServer({ turn: () => ({ items: answerItems('第一条') }) })
    m.queueChild(first)
    const firstRun = await m.driver.startRound(request() as never, roundSpec(m, child, { onThreadId: () => {} }))
    await firstRun.result
    first.crash()
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    const second = new FakeAppServer({ turn: () => ({ items: answerItems('第二条') }) })
    m.queueChild(second)
    const secondRun = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'thread-1', turn: 2 } }))
    expect((await secondRun.result).stopReason).toBe('completed')
    expect(m.spawns).toHaveLength(2)
    expect(second.requests.map(r => r.method)).toEqual(['initialize', 'thread/resume', 'turn/start'])
    expect(second.requests[1]?.params).toMatchObject({ threadId: 'thread-1' })
    await m.driver.disposeAll()
  })

  it('cancels via turn/interrupt with the thread/turn id — the process survives', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-4'))
    const fake = new FakeAppServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const controller = new AbortController()
    const run = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    controller.abort()
    expect((await run.result).stopReason).toBe('aborted')
    const interrupt = fake.requests.find(r => r.method === 'turn/interrupt')
    expect(interrupt?.params).toEqual({ threadId: 'thread-1', turnId: 'turn-1' })
    expect(fake.terminated).toBe(false)
    expect(child.events.find(e => e.type === 'turn/end')?.data).toMatchObject({
      turn: 1,
      reason: { kind: 'aborted', reason: { kind: 'parent' } },
    })
    await m.driver.disposeAll()
  })

  it('settles error on a failed turn and aborted on an interrupted turn', async () => {
    const m = mount()
    const failed = Session.create(SessionId('child-codex-5a'))
    m.queueChild(new FakeAppServer({ turn: () => ({ status: 'failed', errorMessage: 'model exploded', items: [] }) }))
    const failedRun = await m.driver.startRound(request() as never, roundSpec(m, failed))
    expect((await failedRun.result).stopReason).toBe('error')

    const m2 = mount()
    const interrupted = Session.create(SessionId('child-codex-5b'))
    m2.queueChild(new FakeAppServer({ turn: () => ({ status: 'interrupted', items: [] }) }))
    const interruptedRun = await m2.driver.startRound(request() as never, roundSpec(m2, interrupted))
    expect((await interruptedRun.result).stopReason).toBe('aborted')
    await m.driver.disposeAll()
    await m2.driver.disposeAll()
  })

  it('stop-then-rephrase: the cancelled turn’s late completion never settles the resumed round', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-6'))
    child.append('turn/start', { turn: 1 })
    const fake = new FakeAppServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const controller = new AbortController()
    const first = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    controller.abort()
    expect((await first.result).stopReason).toBe('aborted')
    // Round 2 starts on the same runtime immediately (the rephrase gesture).
    const second = await m.driver.startRound(request({ prompt: '换个说法' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'thread-1', turn: 2 } }))
    // Turn 1's unwind lands late — tagged with its own turn id, it is ignored.
    fake.notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } })
    fake.notify('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'late', type: 'agentMessage', text: '残尾' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    // Round 2's own close.
    fake.notify('item/completed', { threadId: 'thread-1', turnId: 'turn-2', item: { id: 'r2', type: 'agentMessage', text: '第二条', phase: 'final_answer' } })
    fake.notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-2', status: 'completed' } })
    expect((await second.result).stopReason).toBe('completed')
    expect((await second.result).output).toEqual([{ type: 'text', text: '第二条' }])
    expect(child.events.filter(e => e.type === 'assistant/message')).toHaveLength(1)
    await m.driver.disposeAll()
  })

  it('auto-answers approval requests unattended (decline/cancel), never granting', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-7'))
    const fake = new FakeAppServer({
      turn: () => ({ items: answerItems('完成') }),
    })
    m.queueChild(fake)
    const pending = m.driver.startRound(request() as never, roundSpec(m, child))
    await vi.waitFor(() => { expect(fake.requests.map(r => r.method)).toContain('turn/start') })
    fake.ask('item/commandExecution/requestApproval', { threadId: 'thread-1', turnId: 'turn-1', availableDecisions: ['cancel', 'decline'] })
    fake.ask('item/permissions/requestApproval', { threadId: 'thread-1', turnId: 'turn-1' })
    const run = await pending
    expect((await run.result).stopReason).toBe('completed')
    expect(fake.serverAnswers).toContainEqual({ decision: 'cancel' })
    expect(fake.serverAnswers).toContainEqual({ permissions: {}, scope: 'turn' })
    await m.driver.disposeAll()
  })

  it('appends assistant/chunk deltas only under the token granularity', async () => {
    const deltas: [string, string][] = [['item-x', 'hel'], ['item-x', 'lo']]
    const off = mount()
    const offChild = Session.create(SessionId('child-codex-8a'))
    off.queueChild(new FakeAppServer({ turn: () => ({ deltas, items: answerItems('hello') }) }))
    const offRun = await off.driver.startRound(request() as never, roundSpec(off, offChild))
    await offRun.result
    expect(offChild.events.filter(e => e.type === 'assistant/chunk')).toHaveLength(0)
    await off.driver.disposeAll()

    const on = mount({ config: { sandbox: 'workspace-write', liveMirrorGranularity: 'token' } })
    const onChild = Session.create(SessionId('child-codex-8b'))
    on.queueChild(new FakeAppServer({ turn: () => ({ deltas, items: answerItems('hello') }) }))
    const onRun = await on.driver.startRound(request() as never, roundSpec(on, onChild))
    await onRun.result
    const chunks = onChild.events.filter(e => e.type === 'assistant/chunk')
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.data).toMatchObject({ chunk: { type: 'text-delta', text: 'hel' } })
    await on.driver.disposeAll()
  })
})

describe('codex live driver lifecycle', () => {
  it('reclaims the idle runtime (stdin EOF, no SIGTERM when it cooperates)', async () => {
    const m = mount({ config: { sandbox: 'workspace-write', liveIdleMs: 30 } })
    const child = Session.create(SessionId('child-codex-9'))
    const fake = new FakeAppServer({ turn: () => ({ items: answerItems('done') }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    expect(fake.stdinEnded).toBe(true)
    expect(fake.terminated).toBe(false)
  })

  it('cancel during the handshake window settles aborted and reclaims without tripping the breaker', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-10'))
    const fake = new FakeAppServer({ silent: ['initialize'] })
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

  it('disposeAll reclaims every runtime (no zombies on profile restart)', async () => {
    const m = mount()
    const first = Session.create(SessionId('child-codex-11a'))
    const second = Session.create(SessionId('child-codex-11b'))
    m.queueChild(new FakeAppServer({ turn: () => ({ items: answerItems('a') }) }))
    m.queueChild(new FakeAppServer({ turn: () => ({ items: answerItems('b') }) }))
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

describe('codex provider live dispatch', () => {
  it('routes rounds to the live driver and records the delegation with the wire thread id', async () => {
    const m = mount()
    m.queueChild(new FakeAppServer({ turn: () => ({ items: answerItems('完成') }) }))
    const provider = new CodexCliProvider(m.ctx, 'workspace-write', m.driver)
    const run = await provider.start(request() as never)
    expect((await run.result).stopReason).toBe('completed')
    expect(m.spawns[0]!.spec.argv).toEqual(['codex', 'app-server', '--stdio'])
    expect(m.records).toHaveBeenCalledTimes(1)
    const record = m.records.mock.calls[0]![0] as { childSessionId: string; cliSessionId: string; provider: string }
    expect(record.provider).toBe('codex-local')
    expect(record.cliSessionId).toBe('thread-1')
    await m.driver.disposeAll()
  })

  it('falls back to the exec one-shot when the app-server handshake fails', async () => {
    const m = mount()
    m.queueChild(new FakeAppServer({ silent: ['initialize'] }))
    const driver = new CodexLiveDriver(m.ctx, { sandbox: 'workspace-write' }, { initializeMs: 50, requestMs: 50, convergeMs: 50, channelRetryMs: 60_000 })
    const provider = new CodexCliProvider(m.ctx, 'workspace-write', driver)
    const run = await provider.start(request() as never)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'exec 答案' }])
    expect(m.spawns).toHaveLength(2)
    expect(m.spawns[1]!.spec.argv).toContain('exec')
    expect(driver.disabled).toBe(true)
    await run.dispose()
  })
})

describe('codex live driver review fixes', () => {
  it('cancel inside the accept window still interrupts — the turn id came from the early turn/started', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-fix1'))
    // turn/started lands BEFORE the turn/start response; turn never closes.
    const fake = new FakeAppServer({ startedBeforeAck: true, turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const controller = new AbortController()
    const run = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    controller.abort()
    expect((await run.result).stopReason).toBe('aborted')
    const interrupt = fake.requests.find(r => r.method === 'turn/interrupt')
    expect(interrupt?.params).toMatchObject({ threadId: 'thread-1', turnId: 'turn-1' })
    await m.driver.disposeAll()
  })

  it('an aborted round still mirrors the held-back lines and observed usage (partial-work contract)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-fix2'))
    // Items stream, usage lands, but turn/completed never comes (cancelled).
    const fake = new FakeAppServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const controller = new AbortController()
    const run = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    await vi.waitFor(() => { expect(fake.requests.map(r => r.method)).toContain('turn/start') })
    fake.notify('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'i1', type: 'reasoning', summary: ['在想了'], content: [] } })
    fake.notify('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'i2', type: 'agentMessage', text: '半截回复', phase: 'final_answer' } })
    fake.notify('thread/tokenUsage/updated', {
      threadId: 'thread-1', turnId: 'turn-1',
      tokenUsage: { last: { inputTokens: 8, cachedInputTokens: 2, outputTokens: 3, reasoningOutputTokens: 0, totalTokens: 0 }, total: {} },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    controller.abort()
    expect((await run.result).stopReason).toBe('aborted')
    // The volatile last line survived settlement, with the observed usage.
    const assistant = child.events.filter(e => e.type === 'assistant/message')
    expect(assistant).toHaveLength(2)
    expect(assistant[1]?.data).toMatchObject({
      message: { content: [{ type: 'text', text: '半截回复' }] },
      usage: { inputTokens: 6, outputTokens: 3, cacheReadTokens: 2 },
    })
    await m.driver.disposeAll()
  })

  it('reports auth-shaped turn failures to the registry mark', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-fix3'))
    const authMarks: string[][] = []
    const registry = m.ctx.localAgent as unknown as { reportAuthFailure?: (h: string, d: string) => void }
    registry.reportAuthFailure = (h, d) => { authMarks.push([h, d]) }
    m.queueChild(new FakeAppServer({
      turn: () => ({ status: 'failed', errorMessage: '401 Unauthorized: invalid access token', items: [] }),
    }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('error')
    expect(authMarks).toHaveLength(1)
    expect(authMarks[0]![0]).toBe('codex')
    await m.driver.disposeAll()
  })

  it('serializes a resume round behind the in-flight fresh round (single spawn)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-fix4'))
    const fake = new FakeAppServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    const secondPending = m.driver.startRound(request({ prompt: '换个说法' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'thread-1', turn: 2 } }))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(m.spawns).toHaveLength(1)
    expect(fake.requests.filter(r => r.method === 'turn/start')).toHaveLength(1)
    // Round 1 closes (error — no output); round 2 then proceeds.
    fake.runTurn('thread-1', 'turn-1', { items: [], status: 'failed', errorMessage: 'boom' })
    await first.result
    const second = await secondPending
    expect(fake.requests.filter(r => r.method === 'turn/start')).toHaveLength(2)
    await m.driver.disposeAll()
    void second
  })
})
