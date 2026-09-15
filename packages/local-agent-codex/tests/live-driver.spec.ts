/**
 * The codex live driver: resident app-server lifecycle (spawn, initialize
 * handshake, thread start/resume, idle reclaim, crash re-spawn), the round
 * settlement contract, push-mode item mirroring with the exec fold's line
 * shape, turn-id-tagged round isolation (the stop-then-rephrase gesture),
 * graceful turn/interrupt, unattended approval auto-answers, and the
 * provider's exec fallback.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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
  /** [itemId, delta] pairs pushed as item/reasoning/textDelta. */
  reasoningDeltas?: [string, string][]
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
    for (const [itemId, delta] of turn.reasoningDeltas ?? []) {
      this.notify('item/reasoning/textDelta', { threadId, turnId, itemId, delta })
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
  settles: { id: string; round: Record<string, unknown> }[]
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
  const settles: Mount['settles'] = []
  const ctx = new Context()
  ctx.provide('localAgent', {
    homeDir: () => homeDir,
    takeDelegationIntent: () => options.intent,
    recordDelegation: records,
    get: () => undefined,
    acquireResumeLock: () => true,
    releaseResumeLock: () => {},
    recordRoundSettled: (id: string, round: Record<string, unknown>) => { settles.push({ id, round }) },
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
    settles,
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
    // File edits and non-shell calls are mirrored, not dropped.
    expect(codexAppServerItemToLine({ type: 'fileChange', id: 'fc1', changes: [{ path: '/work/a.ts', kind: 'update', diff: '@@ -1 +1 @@' }], status: 'completed' }))
      .toEqual({ kind: 'tool', id: 'fc1', name: 'ApplyPatch', args: 'update: /work/a.ts', result: '@@ -1 +1 @@' })
    expect(codexAppServerItemToLine({ type: 'fileChange', id: 'fc2', changes: [{ path: '/work/b.ts', kind: 'add' }, { path: '/work/c.ts', kind: 'delete' }], status: 'completed' }))
      .toEqual({ kind: 'tool', id: 'fc2', name: 'ApplyPatch', args: 'add: /work/b.ts\ndelete: /work/c.ts' })
    expect(codexAppServerItemToLine({ type: 'dynamicToolCall', id: 'w1', tool: 'wait', arguments: { cell_id: '5' }, status: 'completed' }))
      .toEqual({ kind: 'tool', id: 'w1', name: 'wait', args: '{"cell_id":"5"}' })
    expect(codexAppServerItemToLine({ type: 'collabAgentToolCall', id: 'c1', tool: 'spawn', status: 'completed' }))
      .toEqual({ kind: 'tool', id: 'c1', name: 'collab/spawn' })
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
    expect(child.snapshotEvents().filter(e => e.type === 'user/message')).toHaveLength(1)
    const assistant = child.snapshotEvents().filter(e => e.type === 'assistant/message')
    expect(assistant).toHaveLength(2)
    expect(assistant[0]?.data).toMatchObject({ message: { content: [{ type: 'reasoning' }] } })
    expect(assistant[1]?.data).toMatchObject({ usage: { inputTokens: 4, outputTokens: 4, cacheReadTokens: 6 } })
    const calls = child.snapshotEvents().filter(e => e.type === 'tool/call')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.data).toMatchObject({ name: 'Bash', arguments: 'ls' })
    const toolResults = child.snapshotEvents().filter(e => e.type === 'tool/result')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]?.data.message.content[0]).toMatchObject({ content: [{ type: 'text', text: 'a.txt' }] })
    expect(child.snapshotEvents().find(e => e.type === 'turn/end')?.data).toMatchObject({ turn: 1, reason: { kind: 'completed' } })
    expect(m.reports.some(r => r.progress.kind === 'delta' && r.progress.text === '第一条回复')).toBe(true)
    await vi.waitFor(() => { expect(m.reports.some(r => r.progress.kind === 'mirror')).toBe(true) })
    await m.driver.disposeAll()
    expect(m.driver.liveCount).toBe(0)
  })

  it('reports the settled round’s observation read back from its rollout file', async () => {
    // The live drive's half of the exec path's onRoundSettled: the app-server
    // wire names no model, so the settle reads the round's own rollout file —
    // the same read-back the exec settle mirror does. The gap left prod's
    // live-driven delegations without observedModel.
    const m = mount()
    const child = Session.create(SessionId('child-codex-obs'))
    m.queueChild(new FakeAppServer({
      turn: () => {
        // The resident runtime wrote its rollout by turn end (codex writes
        // session_meta at thread start and turn_context when the turn starts).
        const now = new Date()
        const dir = join(
          m.homeDir, 'sessions',
          String(now.getFullYear()),
          String(now.getMonth() + 1).padStart(2, '0'),
          String(now.getDate()).padStart(2, '0'),
        )
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `rollout-${now.toISOString().replace(/[:.]/g, '-')}-thread-1.jsonl`), [
          JSON.stringify({
            type: 'session_meta',
            payload: { id: 'thread-1', timestamp: now.toISOString(), cwd: '/tmp', cli_version: '0.144.0' },
          }),
          JSON.stringify({ type: 'turn_context', timestamp: now.toISOString(), payload: { turn_id: 'turn-1', cwd: '/tmp', model: 'gpt-5.6-sol' } }),
          '',
        ].join('\n'))
        return { items: answerItems('第一条回复'), usage: { inputTokens: 10, cachedInputTokens: 6, outputTokens: 4 } }
      },
    }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(m.settles).toHaveLength(1) })
    expect(m.settles[0]?.id).toBe('child-codex-obs')
    expect(m.settles[0]?.round).toMatchObject({
      observedModel: 'gpt-5.6-sol',
      cliVersion: '0.144.0',
      usage: { inputTokens: 4, outputTokens: 4, cacheReadTokens: 6 },
    })
    await m.driver.disposeAll()
  })

  it('a settled round whose rollout named no model still reports, with the observation absent', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-no-obs'))
    m.queueChild(new FakeAppServer({ turn: () => ({ items: answerItems('第一条回复') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(m.settles).toHaveLength(1) })
    expect(m.settles[0]?.id).toBe('child-codex-no-obs')
    expect(m.settles[0]?.round['observedModel']).toBeUndefined()
    await m.driver.disposeAll()
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
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(2)
    expect(child.snapshotEvents().filter(e => e.type === 'turn/end').at(-1)?.data).toMatchObject({ turn: 2, reason: { kind: 'completed' } })
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
    expect(child.snapshotEvents().find(e => e.type === 'turn/end')?.data).toMatchObject({
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
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1)
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

  it('flushes a sparse delta before completion and never overwrites the final with a late timer', async () => {
    const m = mount({ config: { sandbox: 'workspace-write', liveMirrorGranularity: 'token' } })
    const child = Session.create(SessionId('child-sparse-live'))
    const fake = new FakeAppServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await vi.waitFor(() => { expect(fake.requests.some(r => r.method === 'turn/start')).toBe(true) })
    fake.notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'sparse', delta: 'hi' })
    await vi.waitFor(() => {
      expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1)
    }, { timeout: 1_000, interval: 10 })
    expect(child.snapshotEvents().some(e => e.type === 'turn/end')).toBe(false)
    fake.notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'sparse', delta: '!' })
    fake.notify('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', id: 'sparse', text: 'hi!', phase: 'final_answer' } })
    fake.notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } })
    expect((await run.result).stopReason).toBe('completed')
    const count = child.snapshotEvents().length
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(child.snapshotEvents()).toHaveLength(count)
    await m.driver.disposeAll()
  })

  it('token granularity streams throttled snapshots into the session log at the stream\'s step', async () => {
    const deltas: [string, string][] = [['item-x', 'hel'], ['item-x', 'lo']]
    // Zero thresholds: every delta lands a snapshot immediately.
    const on = mount({ config: { sandbox: 'workspace-write', liveMirrorGranularity: 'token', snapshotMinIntervalMs: 0, snapshotMinChars: 0 } })
    const onChild = Session.create(SessionId('child-codex-8b'))
    on.queueChild(new FakeAppServer({
      turn: () => ({
        deltas,
        items: [
          { type: 'reasoning', summary: ['想一下'], content: [] },
          { type: 'commandExecution', command: 'ls', aggregatedOutput: 'a.txt', status: 'completed' },
          { type: 'agentMessage', id: 'item-x', text: 'hello', phase: 'final_answer' },
        ],
      }),
    }))
    const onRun = await on.driver.startRound(request() as never, roundSpec(on, onChild))
    await onRun.result
    // The stream reserved step 1 (deltas arrived before any item): snapshots
    // grew the message live, and the completion fold landed last at the same
    // (turn, step) — the host's repeated-settle merge keeps the newest.
    const atStep = onChild.snapshotEvents().filter(e => (e.data as { turn?: number; step?: number }).turn === 1
      && (e.data as { turn?: number; step?: number }).step === 1)
    expect(atStep.map(e => e.type)).toEqual(['step/start', 'assistant/message', 'assistant/message', 'assistant/message', 'step/end'])
    const texts = atStep.filter(e => e.type === 'assistant/message')
      .map(e => (e.data as { message: { content: { text: string }[] } }).message.content[0]?.text)
    expect(texts).toEqual(['hel', 'hello', 'hello'])
    // The delta still rides the run-progress channel.
    const progress = on.reports.filter(r => r.progress.kind === 'delta').map(r => r.progress.text)
    expect(progress).toContain('hel')
    expect(progress).toContain('lo')
    await on.driver.disposeAll()
  })

  it('token granularity: each streamed item finalizes at its own reserved step (no duplicate fold)', async () => {
    const m = mount({ config: { sandbox: 'workspace-write', liveMirrorGranularity: 'token', snapshotMinIntervalMs: 0, snapshotMinChars: 0 } })
    const child = Session.create(SessionId('child-codex-token-final'))
    m.queueChild(new FakeAppServer({
      turn: () => ({
        reasoningDeltas: [['item-r', '想一下']],
        deltas: [['item-m', '文件'], ['item-m', '建好了']],
        items: [
          { type: 'reasoning', id: 'item-r', summary: ['想一下'], content: [] },
          { type: 'agentMessage', id: 'item-m', text: '文件建好了', phase: 'final_answer' },
        ],
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 4 },
      }),
    }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message').length).toBeGreaterThanOrEqual(2) }, { timeout: 5_000 })
    const events = child.snapshotEvents()
    const assistant = events.filter(e => e.type === 'assistant/message')
    // The reasoning stream finalizes at its reserved step 1 (one snapshot on
    // the item switch + the completion fold; no duplicated content).
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
    const m = mount({ config: { sandbox: 'workspace-write', liveMirrorGranularity: 'token' } })
    const child = Session.create(SessionId('child-codex-token-abort'))
    const fake = new FakeAppServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const controller = new AbortController()
    const run = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    // Stream one partial chunk, then cancel.
    fake.notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-m', delta: '写到一半' })
    controller.abort()
    expect((await run.result).stopReason).toBe('aborted')
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1) }, { timeout: 5_000 })
    const final = child.snapshotEvents().find(e => e.type === 'assistant/message')!
    expect(final.data).toMatchObject({ turn: 1, step: 1, interrupted: true })
    expect((final.data as { message: { content: unknown[] } }).message.content).toEqual([{ type: 'text', text: '写到一半' }])
    await m.driver.disposeAll()
  })

  it('token granularity: a tool-first round renders the answer after its tool cards (lazy stream step)', async () => {
    const m = mount({ config: { sandbox: 'workspace-write', liveMirrorGranularity: 'token' } })
    const child = Session.create(SessionId('child-codex-token-toolfirst'))
    const fake = new FakeAppServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    // Two tool items complete before any text streams.
    fake.notify('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: { id: 't1', type: 'commandExecution', command: 'ls', aggregatedOutput: 'a', status: 'completed' } })
    fake.notify('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: { id: 't2', type: 'commandExecution', command: 'pwd', aggregatedOutput: '/x', status: 'completed' } })
    // Text streams after the tools, then one more tool completes, then the
    // answer's completion item lands (the run's output source).
    fake.notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'm1', delta: '结论' })
    fake.notify('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: { id: 't3', type: 'commandExecution', command: 'cat a', aggregatedOutput: 'x', status: 'completed' } })
    fake.notify('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'm1', type: 'agentMessage', text: '结论', phase: 'final_answer' } })
    fake.notify('thread/tokenUsage/updated', {
      threadId: 'thread-1', turnId: 'turn-1',
      tokenUsage: { last: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 0 }, total: {} },
    })
    fake.notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } })
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1) }, { timeout: 5_000 })

    // Chronological steps: t1=1, t2=2, the stream=3, the late tool shifts to 4.
    const toolSteps = child.snapshotEvents().filter(e => e.type === 'tool/call').map(e => (e.data as { step: number }).step)
    expect(toolSteps).toEqual([1, 2, 4])
    const final = child.snapshotEvents().find(e => e.type === 'assistant/message')!
    expect(final.data).toMatchObject({ turn: 1, step: 3, usage: { inputTokens: 5, outputTokens: 2 } })
    await m.driver.disposeAll()
  })

  it('token granularity: a stream-less round folds every item (no reservation, no snapshots)', async () => {
    const m = mount({ config: { sandbox: 'workspace-write', liveMirrorGranularity: 'token' } })
    const child = Session.create(SessionId('child-codex-token-nostream'))
    // Items only, no deltas: reasoning + tool + final answer.
    m.queueChild(new FakeAppServer({ turn: () => ({ items: answerItems('静默答案') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(2) }, { timeout: 5_000 })

    // Faithful per-item fold: reasoning at step 1, the tool card at step 2,
    // the answer at step 3 — nothing withheld for a combined message.
    const toolSteps = child.snapshotEvents().filter(e => e.type === 'tool/call').map(e => (e.data as { step: number }).step)
    expect(toolSteps).toEqual([2])
    const assistant = child.snapshotEvents().filter(e => e.type === 'assistant/message')
    expect(assistant.map(e => (e.data as { step: number }).step)).toEqual([1, 3])
    expect((assistant[1]!.data as { message: { content: unknown[] } }).message.content).toEqual([{ type: 'text', text: '静默答案' }])
    await m.driver.disposeAll()
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
    expect(child.snapshotEvents()).toHaveLength(0)
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
    const assistant = child.snapshotEvents().filter(e => e.type === 'assistant/message')
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

describe('codex live driver drain (settings handoff)', () => {
  it('refuses new rounds immediately once draining (no queueing behind in-flight work)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-drain1'))
    m.queueChild(new FakeAppServer({ turn: () => ({ items: answerItems('done') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.driver.hasRuntime('child-codex-drain1')).toBe(true)
    const drained = m.driver.drain()
    await expect(m.driver.startRound(request() as never, roundSpec(m, child))).rejects.toThrow('draining')
    await drained
    expect(m.driver.liveCount).toBe(0)
    expect(m.driver.hasRuntime('child-codex-drain1')).toBe(false)
  })

  it('lets the in-flight round finish undisturbed, then reclaims the runtime', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-drain2'))
    const fake = new FakeAppServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    let drainedFlag = false
    const drained = m.driver.drain().then(() => { drainedFlag = true })
    // The hung round is still in flight: drain waits, the process lives.
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(drainedFlag).toBe(false)
    expect(fake.stdinEnded).toBe(false)
    fake.runTurn('thread-1', 'turn-1', { items: answerItems('done') })
    // The in-flight turn settles normally.
    expect((await run.result).stopReason).toBe('completed')
    await drained
    expect(m.driver.liveCount).toBe(0)
    expect(fake.stdinEnded).toBe(true)
  })

  it('a round queued before the drain dequeues into the refusal (provider falls back to exec)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-drain3'))
    const fake = new FakeAppServer({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    // Chain round 2 BEFORE draining, then drain while round 1 hangs.
    const second = m.driver.startRound(request({ prompt: '第二轮' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'thread-1', turn: 2 } }))
    const drained = m.driver.drain()
    fake.runTurn('thread-1', 'turn-1', { items: answerItems('done') })
    await first.result.catch(() => {})
    await expect(second).rejects.toThrow('draining')
    await drained
    // Round 2 never reached the wire.
    expect(fake.requests.filter(r => r.method === 'turn/start')).toHaveLength(1)
    expect(m.driver.liveCount).toBe(0)
  })

  it('setLiveMirrorGranularity flips subsequent rounds without a new generation', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-codex-drain4'))
    child.append('turn/start', { turn: 1 })
    const deltas: [string, string][] = [['item-x', 'hel'], ['item-x', 'lo']]
    m.queueChild(new FakeAppServer({ turn: () => ({ deltas, items: answerItems('hello') }) }))
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    await first.result
    // Event granularity folds the completed items into messages.
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message').length).toBeGreaterThan(0)
    m.driver.setLiveMirrorGranularity('token')
    const second = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'thread-1', turn: 2 } }))
    await second.result
    // Token granularity additionally streams the in-flight item: the round
    // folds every item AND carries the stream's snapshot — never one
    // combined message.
    await vi.waitFor(() => {
      expect(child.snapshotEvents().filter(e => e.type === 'assistant/message' && (e.data as { turn?: number }).turn === 2).length).toBeGreaterThanOrEqual(2)
    }, { timeout: 5_000 })
    const round2 = child.snapshotEvents().filter(e => e.type === 'assistant/message' && (e.data as { turn?: number }).turn === 2)
    expect(round2.some(e => JSON.stringify((e.data as { message: { content: unknown } }).message.content).includes('想一下'))).toBe(true)
    expect(round2.some(e => JSON.stringify((e.data as { message: { content: unknown } }).message.content).includes('hello'))).toBe(true)
    // Same runtime, same process: granularity rides the existing generation.
    expect(m.spawns).toHaveLength(1)
    await m.driver.disposeAll()
  })
})

describe('codex provider live resolver', () => {
  it('a resolver returning undefined routes the round to exec (retiring-generation gate)', async () => {
    const m = mount()
    // No app-server child queued: the exec fallback spawn answers.
    const provider = new CodexCliProvider(m.ctx, 'workspace-write', () => undefined)
    const run = await provider.start(request() as never)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'exec 答案' }])
    expect(m.spawns[0]!.spec.argv).toContain('exec')
    await run.dispose()
  })

  it('a resolver returning the driver per member routes to live (backward compatible)', async () => {
    const m = mount()
    m.queueChild(new FakeAppServer({ turn: () => ({ items: answerItems('完成') }) }))
    const provider = new CodexCliProvider(m.ctx, 'workspace-write', () => m.driver)
    const run = await provider.start(request() as never)
    expect((await run.result).stopReason).toBe('completed')
    expect(m.spawns[0]!.spec.argv).toEqual(['codex', 'app-server', '--stdio'])
    await m.driver.disposeAll()
  })
})

describe('codex live driver model key', () => {
  it('unset: the app-server argv is exactly the pre-key shape', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-model-off'))
    m.queueChild(new FakeAppServer({ turn: () => ({ items: [{ type: 'agentMessage', text: '好', phase: 'final_answer' }] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.spawns[0]!.spec.argv).toEqual(['codex', 'app-server', '--stdio'])
    await run.dispose()
  })

  it('set: the resident app-server starts with -c model=… (it has no -m)', async () => {
    const m = mount({ config: { sandbox: 'workspace-write', model: () => 'gpt-5.2' } })
    const child = Session.create(SessionId('child-model-on'))
    m.queueChild(new FakeAppServer({ turn: () => ({ items: [{ type: 'agentMessage', text: '好', phase: 'final_answer' }] }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.spawns[0]!.spec.argv).toEqual(['codex', 'app-server', '-c', 'model="gpt-5.2"', '--stdio'])
    await run.dispose()
  })
})

describe('codex live driver member-aware model', () => {
  it('a round start model binds the spawn argv, outranking the spawn resolver', async () => {
    const m = mount({ config: { sandbox: 'workspace-write', model: () => 'gpt-5.2' } })
    const child = Session.create(SessionId('child-start-model'))
    m.queueChild(new FakeAppServer({ turn: () => ({ items: [{ type: 'agentMessage', text: '好', phase: 'final_answer' }] }) }))
    const run = await m.driver.startRound(request() as never, {
      ...roundSpec(m, child),
      startModel: 'delegation-model',
    })
    await run.result
    expect(m.spawns[0]!.spec.argv).toEqual(['codex', 'app-server', '-c', 'model="delegation-model"', '--stdio'])
    expect(m.driver.boundModelOf(String(child.id))).toBe('delegation-model')
    await run.dispose()
  })

  it('a round naming the bound model keeps the resident runtime (no respawn)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-same-model'))
    for (const answer of ['一', '二']) {
      m.queueChild(new FakeAppServer({ turn: () => ({ items: [{ type: 'agentMessage', text: answer, phase: 'final_answer' }] }) }))
    }
    const first = await m.driver.startRound(request() as never, { ...roundSpec(m, child), startModel: 'model-a' })
    await first.result
    await first.dispose()
    const second = await m.driver.startRound(request() as never, { ...roundSpec(m, child), startModel: 'model-a' })
    await second.result
    await second.dispose()
    // One spawn served both rounds.
    expect(m.spawns).toHaveLength(1)
  })

  it('a round naming a DIFFERENT model retires the resident runtime and respawns onto it', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-switch-model'))
    for (const answer of ['一', '二']) {
      m.queueChild(new FakeAppServer({ turn: () => ({ items: [{ type: 'agentMessage', text: answer, phase: 'final_answer' }] }) }))
    }
    const first = await m.driver.startRound(request() as never, { ...roundSpec(m, child), startModel: 'model-a' })
    await first.result
    await first.dispose()
    const oldRuntime = m.spawns[0]!.fake!
    const second = await m.driver.startRound(request() as never, { ...roundSpec(m, child), startModel: 'model-b' })
    await second.result
    await second.dispose()
    // The old process is gone (EOF or terminate) and the respawn bound model-b.
    expect(oldRuntime.stdinEnded || oldRuntime.terminated).toBe(true)
    expect(m.spawns).toHaveLength(2)
    expect(m.spawns[1]!.spec.argv).toEqual(['codex', 'app-server', '-c', 'model="model-b"', '--stdio'])
    expect(m.driver.boundModelOf(String(child.id))).toBe('model-b')
  })

  it('retireRuntime reclaims the member runtime so the next round respawns', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-retire'))
    for (const answer of ['一', '二']) {
      m.queueChild(new FakeAppServer({ turn: () => ({ items: [{ type: 'agentMessage', text: answer, phase: 'final_answer' }] }) }))
    }
    const first = await m.driver.startRound(request() as never, { ...roundSpec(m, child), startModel: 'model-a' })
    await first.result
    await first.dispose()
    expect(m.driver.boundModelOf(String(child.id))).toBe('model-a')
    await m.driver.retireRuntime(String(child.id))
    expect(m.driver.boundModelOf(String(child.id))).toBeNull()
    const second = await m.driver.startRound(request() as never, { ...roundSpec(m, child), startModel: 'model-b' })
    await second.result
    await second.dispose()
    expect(m.spawns).toHaveLength(2)
    expect(m.spawns[1]!.spec.argv).toEqual(['codex', 'app-server', '-c', 'model="model-b"', '--stdio'])
  })
})
