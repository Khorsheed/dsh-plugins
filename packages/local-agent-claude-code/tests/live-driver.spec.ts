/**
 * The claude live driver: resident stream-json lifecycle (spawn, per-turn
 * system/init, idle reclaim, crash re-spawn with --resume), the round
 * settlement contract (result-event mapping, shared ClaudeStreamParser fold
 * with hold-back + usage), graceful control interrupt, turn serialization
 * (the stop-then-rephrase gesture), token-granularity partials, and the
 * provider's exec fallback. Auth discipline: the driver only ever injects the
 * scoped CLAUDE_CONFIG_DIR (+ an optional configured base URL) — never the
 * user's global home.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { LocalAgentStreams } from '@khorsheed/dsh-local-agent'
import { describe, expect, it, vi } from 'vitest'
import { ClaudeCliProvider } from '../src/claude-cli-provider.ts'
import { ClaudeLiveDriver } from '../src/live-driver.ts'

/** One scripted turn: assistant events, the terminal result, or a hang. */
interface FakeTurn {
  events?: Record<string, unknown>[]
  isError?: boolean
  errorText?: string
  usage?: { input_tokens: number; cache_read_input_tokens: number; output_tokens: number }
  /** Never emit the turn's result (cancel-path tests drive it by hand). */
  hang?: boolean
  /** Partial-message stream_event text deltas (token granularity). */
  deltas?: string[]
  /** Partial-message stream_event thinking deltas (token granularity). */
  thinkingDeltas?: string[]
}

interface FakeClaudeScript {
  turn?: (params: { text: string }) => FakeTurn
  /** Exit immediately on spawn (channel-broken simulation). */
  silentInit?: boolean
  /** Extra fields on the per-turn system/init (the model/build the CLI names). */
  init?: Record<string, unknown>
}

/** A fake resident `claude --input-format stream-json` process. */
class FakeClaude {
  readonly stdin = new PassThrough()
  readonly stdout = new Readable({ read() {} })
  readonly stderr = new Readable({ read() {} })
  readonly handle: SubprocessHandle
  readonly userMessages: string[] = []
  readonly controlRequests: Record<string, unknown>[] = []
  /** control_response frames the DRIVER wrote to stdin (its request answers). */
  readonly controlResponses: Record<string, unknown>[] = []
  terminated = false
  stdinEnded = false
  private buffer = ''
  private readonly resolveDone: (outcome: { exitCode: number; signal: null }) => void
  readonly done: Promise<{ exitCode: number; signal: null }>
  readonly sessionId = 'claude-session-1'

  constructor(private readonly script: FakeClaudeScript = {}) {
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
        if (line.trim() !== '') this.dispatch(JSON.parse(line) as Record<string, unknown>)
      }
    })
    this.stdin.on('end', () => {
      this.stdinEnded = true
      this.resolveDone({ exitCode: 0, signal: null })
    })
    this.handle = {
      pid: 9242,
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

  /** Push one stream-json event. */
  emit(event: Record<string, unknown>): void {
    this.stdout.push(JSON.stringify(event) + '\n')
  }

  crash(): void {
    this.resolveDone({ exitCode: 1, signal: null })
  }

  private dispatch(message: Record<string, unknown>): void {
    if (message['type'] === 'control_request') {
      this.controlRequests.push(message)
      const requestId = message['request_id']
      this.emit({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { still_queued: [] } } })
      return
    }
    if (message['type'] === 'control_response') {
      this.controlResponses.push(message)
      return
    }
    if (message['type'] !== 'user') return
    const content = (message['message'] as { content: { text: string }[] }).content
    const text = content[0]!.text
    this.userMessages.push(text)
    if (this.script.silentInit === true) return
    const turn = this.script.turn?.({ text }) ?? {}
    queueMicrotask(() => {
      this.emit({ type: 'system', subtype: 'init', session_id: this.sessionId, ...this.script.init })
      for (const delta of turn.thinkingDeltas ?? []) {
        this.emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: delta } } })
      }
      for (const delta of turn.deltas ?? []) {
        this.emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: delta } } })
      }
      for (const event of turn.events ?? []) this.emit(event)
      if (turn.hang === true) return
      this.emit({
        type: 'result',
        is_error: turn.isError ?? false,
        ...(turn.errorText === undefined ? {} : { error: turn.errorText }),
        session_id: this.sessionId,
        ...(turn.usage === undefined ? {} : { usage: turn.usage }),
      })
    })
  }
}

/** The assistant/result events for one answer, as claude stream-json emits them. */
function answerEvents(answer: string): Record<string, unknown>[] {
  return [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '想一下' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'a.txt' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: answer }] } },
  ]
}

interface Mount {
  ctx: Context
  homeDir: string
  spawns: { spec: SubprocessSpawnSpec; fake?: FakeClaude; execHandle?: SubprocessHandle }[]
  reports: { id: string; progress: { kind: string; text?: string; mirroredLines?: number } }[]
  records: ReturnType<typeof vi.fn>
  settles: { id: string; round: Record<string, unknown> }[]
  queueChild(child: FakeClaude): void
  driver: ClaudeLiveDriver
}

function mount(options: {
  config?: ConstructorParameters<typeof ClaudeLiveDriver>[1]
  timeouts?: ConstructorParameters<typeof ClaudeLiveDriver>[2]
  intent?: unknown
} = {}): Mount {
  const homeDir = mkdtempSync(join(tmpdir(), 'claude-live-'))
  const reports: Mount['reports'] = []
  const spawns: Mount['spawns'] = []
  const queue: FakeClaude[] = []
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
      // The exec fallback: emit the stream-json output and exit 0.
      const stdout = new Readable({ read() {} })
      const stderr = new Readable({ read() {} })
      stderr.push(null)
      const stream = [
        { type: 'system', subtype: 'init', session_id: 'exec-session' },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'exec 答案' }] } },
        { type: 'result', is_error: false, session_id: 'exec-session', usage: { input_tokens: 2, output_tokens: 1 } },
      ].map(event => JSON.stringify(event)).join('\n')
      setImmediate(() => { stdout.push(stream + '\n'); stdout.push(null) })
      const execHandle: SubprocessHandle = {
        pid: 9251,
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
  const driver = new ClaudeLiveDriver(ctx, options.config ?? { permissionMode: 'skip' }, options.timeouts)
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

function roundSpec(m: Mount, child: Session, over: { resume?: { cliSessionId: string; turn: number }; onSessionId?: (id: string) => void } = {}): Parameters<ClaudeLiveDriver['startRound']>[1] {
  return {
    cwd: '/tmp',
    homeDir: m.homeDir,
    childSession: child,
    parentSessionId: 'parent-1',
    ...(over.resume === undefined ? {} : { resume: over.resume }),
    ...(over.onSessionId === undefined ? {} : { onSessionId: over.onSessionId }),
  }
}

/**
 * Every mirrored content event (assistant/message, tool/call, tool/result)
 * sits inside the step/start–step/end pair of its own (turn, step) — the
 * boundary contract the live conversation assembler needs to materialize the
 * step in real time (a boundary-less message resolves to a turn-level
 * location and renders nothing until a full rebuild).
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

describe('claude live driver rounds', () => {
  it('keeps multiple text blocks and successive assistant messages at distinct stream coordinates', async () => {
    const m = mount({ config: { permissionMode: 'skip', snapshotMinIntervalMs: 0 } })
    const liveStreams = new LocalAgentStreams()
    Object.assign(m.ctx.localAgent, { liveStreams })
    const child = Session.create(SessionId('child-claude-block-identities'))
    const fake = new FakeClaude({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    const partial = (event: Record<string, unknown>) => fake.emit({ type: 'stream_event', event })
    partial({ type: 'message_start', message: { id: 'message-one' } })
    partial({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'first' } })
    partial({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'second' } })
    fake.emit({ type: 'assistant', message: { id: 'message-one', role: 'assistant', content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] } })
    partial({ type: 'message_start', message: { id: 'message-two' } })
    partial({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'third' } })
    fake.emit({ type: 'assistant', message: { id: 'message-two', role: 'assistant', content: [{ type: 'text', text: 'third' }] } })
    fake.emit({ type: 'result', is_error: false, session_id: 'claude-session-1', usage: { input_tokens: 10, output_tokens: 4 } })
    expect((await run.result).stopReason).toBe('completed')
    const checkpoints = child.snapshotEvents().filter(event => event.type === 'local-agent/stream')
    expect(checkpoints.map(event => event.data.text)).toEqual(['first', 'second', 'third'])
    const messages = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(messages.map(event => event.data.message.content)).toEqual([
      [{ type: 'text', text: 'first' }], [{ type: 'text', text: 'second' }], [{ type: 'text', text: 'third' }],
    ])
    expect(new Set(messages.map(event => event.data.step)).size).toBe(3)
    expect(messages.at(-1)!.data).toMatchObject({ usage: { inputTokens: 10, outputTokens: 4 } })
    expectStepBoundaries(child)
    await m.driver.disposeAll()
    liveStreams.dispose()
  })

  it('publishes transient output while keeping only authoritative assistant messages in history', async () => {
    const m = mount({ config: { permissionMode: 'skip', snapshotMinIntervalMs: 0 } })
    const liveStreams = new LocalAgentStreams()
    Object.assign(m.ctx.localAgent, { liveStreams })
    const child = Session.create(SessionId('child-transient-claude-code'))
    m.queueChild(new FakeClaude({ turn: () => ({ deltas: ['hello'], events: answerEvents('hello'), usage: { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 4 } }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    const events = child.snapshotEvents()
    expect(events.filter(event => event.type === 'local-agent/stream')).toHaveLength(1)
    const answers = events.filter(event => event.type === 'assistant/message' && JSON.stringify(event.data.message.content).includes('hello'))
    expect(answers).toHaveLength(1)
    expect(answers[0]!.data).toMatchObject({ usage: { inputTokens: 10, outputTokens: 4 } })
    expectStepBoundaries(child)
    await m.driver.disposeAll()
    liveStreams.dispose()
  })

  it('spawns the resident stream-json process, drives a turn, and folds the shared stream live', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-1'))
    const sessionIds: string[] = []
    m.queueChild(new FakeClaude({
      turn: () => ({ events: answerEvents('第一条回复'), usage: { input_tokens: 10, cache_read_input_tokens: 6, output_tokens: 4 } }),
    }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child, { onSessionId: id => { sessionIds.push(id) } }))
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: '第一条回复' }])
    expect(sessionIds).toEqual(['claude-session-1'])
    const spawn = m.spawns[0]!
    expect(spawn.spec.argv).toEqual([
      'claude', '-p', '--verbose',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
    ])
    // The auth discipline: exactly the scoped config dir, nothing else.
    expect(spawn.spec.env).toEqual({ CLAUDE_CONFIG_DIR: m.homeDir })
    // Mirroring: prompt + folded lines, usage on the final line; the
    // tool_use folds to a native tool/call (+ tool/result) pair.
    expect(child.snapshotEvents().filter(e => e.type === 'user/message')).toHaveLength(1)
    const assistant = child.snapshotEvents().filter(e => e.type === 'assistant/message')
    expect(assistant).toHaveLength(2)
    expect(assistant[0]?.data).toMatchObject({ message: { content: [{ type: 'reasoning' }] } })
    expect(assistant[1]?.data).toMatchObject({ message: { content: [{ type: 'text', text: '第一条回复' }] } })
    expect(child.snapshotEvents().filter(e => e.type === 'tool/call')).toHaveLength(1)
    expect(child.snapshotEvents().find(e => e.type === 'turn/end')?.data).toMatchObject({ turn: 1, reason: { kind: 'completed' } })
    expect(m.reports.some(r => r.progress.kind === 'delta' && r.progress.text === '第一条回复')).toBe(true)
    await vi.waitFor(() => { expect(m.reports.some(r => r.progress.kind === 'mirror')).toBe(true) })
    // Event granularity: every folded step is wrapped in its boundary pair.
    expectStepBoundaries(child)
    await m.driver.disposeAll()
    expect(m.driver.liveCount).toBe(0)
  })

  it('reports the settled round’s observation from the turn’s init and result (the registry’s channel)', async () => {
    // The live drive's half of the exec path's onRoundSettled: the init
    // event's model and build, the result's usage, and the round's tool-call
    // accounting ride the observation channel — the gap that left prod's
    // live-driven delegations without observedModel.
    const m = mount()
    const child = Session.create(SessionId('child-claude-obs'))
    m.queueChild(new FakeClaude({
      init: { model: 'claude-opus-4-6[1m]', claude_code_version: '2.1.236' },
      turn: () => ({ events: answerEvents('第一条回复'), usage: { input_tokens: 10, cache_read_input_tokens: 6, output_tokens: 4 } }),
    }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(m.settles).toHaveLength(1) })
    expect(m.settles[0]?.id).toBe('child-claude-obs')
    expect(m.settles[0]?.round).toMatchObject({
      observedModel: 'claude-opus-4-6[1m]',
      cliVersion: '2.1.236',
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 6 },
      toolCalls: { count: 1, byName: { Bash: 1 } },
    })
    await m.driver.disposeAll()
  })

  it('a settled round whose init named no model still reports, with the observation absent', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-no-obs'))
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('第一条回复') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(m.settles).toHaveLength(1) })
    expect(m.settles[0]?.id).toBe('child-claude-no-obs')
    expect(m.settles[0]?.round['observedModel']).toBeUndefined()
    await m.driver.disposeAll()
  })

  it('reuses the resident runtime and session for the resume round (no --resume respawn)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-2'))
    child.append('turn/start', { turn: 1 })
    m.queueChild(new FakeClaude({ turn: ({ text }) => ({ events: answerEvents(`${text}的答案`) }) }))
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await first.result).stopReason).toBe('completed')
    const second = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'claude-session-1', turn: 2 } }))
    expect((await second.result).stopReason).toBe('completed')
    expect(m.spawns).toHaveLength(1)
    expect(m.spawns[0]!.fake!.userMessages).toEqual(['建个文件', '继续'])
    expect(child.snapshotEvents().filter(e => e.type === 'turn/end').at(-1)?.data).toMatchObject({ turn: 2, reason: { kind: 'completed' } })
    await m.driver.disposeAll()
  })

  it('re-spawns with --resume after a crash (the session id survives on disk)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-3'))
    child.append('turn/start', { turn: 1 })
    const first = new FakeClaude({ turn: () => ({ events: answerEvents('第一条') }) })
    m.queueChild(first)
    const firstRun = await m.driver.startRound(request() as never, roundSpec(m, child, { onSessionId: () => {} }))
    await firstRun.result
    first.crash()
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    const second = new FakeClaude({ turn: () => ({ events: answerEvents('第二条') }) })
    m.queueChild(second)
    const secondRun = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'claude-session-1', turn: 2 } }))
    expect((await secondRun.result).stopReason).toBe('completed')
    expect(m.spawns).toHaveLength(2)
    expect(m.spawns[1]!.spec.argv).toContain('--resume')
    expect(m.spawns[1]!.spec.argv).toContain('claude-session-1')
    await m.driver.disposeAll()
  })

  it('cancels via the interrupt control request — the process survives', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-4'))
    const fake = new FakeClaude({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const controller = new AbortController()
    const run = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    controller.abort()
    expect((await run.result).stopReason).toBe('aborted')
    const interrupt = fake.controlRequests.find(r => (r['request'] as { subtype?: string }).subtype === 'interrupt')
    expect(interrupt).toBeDefined()
    expect(fake.terminated).toBe(false)
    expect(child.snapshotEvents().find(e => e.type === 'turn/end')?.data).toMatchObject({
      turn: 1,
      reason: { kind: 'aborted', reason: { kind: 'parent' } },
    })
    await m.driver.disposeAll()
  })

  it('stop-then-rephrase: the next message goes out only after the cancelled turn’s result lands', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-5'))
    child.append('turn/start', { turn: 1 })
    const fake = new FakeClaude({
      turn: ({ text }) => text === '换个说法' ? { events: answerEvents('第二条') } : { hang: true },
    })
    m.queueChild(fake)
    const controller = new AbortController()
    const first = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    controller.abort()
    expect((await first.result).stopReason).toBe('aborted')
    const secondPending = m.driver.startRound(request({ prompt: '换个说法' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'claude-session-1', turn: 2 } }))
    await new Promise(resolve => setTimeout(resolve, 30))
    // The cancelled turn's result has not landed: no second message yet.
    expect(fake.userMessages).toEqual(['建个文件'])
    // The interrupt unwinds turn 1; its result lands, releasing turn 2.
    fake.emit({ type: 'result', is_error: false, session_id: 'claude-session-1' })
    const second = await secondPending
    expect((await second.result).stopReason).toBe('completed')
    expect((await second.result).output).toEqual([{ type: 'text', text: '第二条' }])
    expect(fake.userMessages).toEqual(['建个文件', '换个说法'])
    await m.driver.disposeAll()
  })

  it('settles error on an is_error result and aborted otherwise keeps partial work', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-6'))
    m.queueChild(new FakeClaude({
      turn: () => ({ events: answerEvents('半截'), isError: true, errorText: 'authentication failed' }),
    }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('error')
    expect(child.snapshotEvents().find(e => e.type === 'turn/end')?.data).toMatchObject({ reason: { kind: 'error' } })
    // The folded partial work is still mirrored.
    expect(child.snapshotEvents().filter(e => e.type === 'assistant/message').length).toBeGreaterThan(0)
    await m.driver.disposeAll()
  })

  it('keeps partial-message flags before the variadic member tool terminator for legacy profiles', async () => {
    const m = mount({ config: { permissionMode: 'skip', liveMirrorGranularity: 'event' } })
    Object.assign(m.ctx.localAgent, {
      registerMemberRun: () => 'test-member',
      unregisterMemberRun: () => {},
      memberBridgeSocketPath: () => '/home/user/member.sock',
      memberBridgeCommand: () => ({ command: 'node', args: ['member-bridge.js'] }),
    })
    const child = Session.create(SessionId('child-claude-legacy-stream'))
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('done') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    const argv = m.spawns[0]!.spec.argv
    expect(argv).toContain('--')
    expect(argv.indexOf('--include-partial-messages')).toBeGreaterThan(0)
    expect(argv.indexOf('--include-partial-messages')).toBeLessThan(argv.indexOf('--allowedTools'))
    expect(argv.at(-1)).toBe('--')
    await m.driver.disposeAll()
  })

  it('token granularity streams throttled snapshots into the session log at the stream\'s step', async () => {
    const deltas = ['hel', 'lo']
    const off = mount()
    const offChild = Session.create(SessionId('child-claude-7a'))
    off.queueChild(new FakeClaude({ turn: () => ({ deltas, events: answerEvents('hello') }) }))
    const offRun = await off.driver.startRound(request() as never, roundSpec(off, offChild))
    await offRun.result
    expect(off.spawns[0]!.spec.argv).toContain('--include-partial-messages')
    await off.driver.disposeAll()

    // Zero thresholds: every delta lands a snapshot immediately. Token
    // granularity keeps the partial-message spawn flag, reports deltas over
    // the run-progress channel, AND mirrors them into the session log as
    // snapshots at the stream's reserved (turn, step).
    const on = mount({ config: { permissionMode: 'skip', liveMirrorGranularity: 'token', snapshotMinIntervalMs: 0, snapshotMinChars: 0 } })
    const onChild = Session.create(SessionId('child-claude-7b'))
    on.queueChild(new FakeClaude({ turn: () => ({ deltas, events: answerEvents('hello') }) }))
    const onRun = await on.driver.startRound(request() as never, roundSpec(on, onChild))
    await onRun.result
    expect(on.spawns[0]!.spec.argv).toContain('--include-partial-messages')
    // The stream reserved step 1 (deltas arrived before any event): snapshots
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

  it('token granularity: each streamed kind finalizes at its own reserved step (no duplicate fold)', async () => {
    const m = mount({ config: { permissionMode: 'skip', liveMirrorGranularity: 'token', snapshotMinIntervalMs: 0, snapshotMinChars: 0 } })
    const child = Session.create(SessionId('child-claude-token-final'))
    m.queueChild(new FakeClaude({
      turn: () => ({
        thinkingDeltas: ['想一下'],
        deltas: ['文件', '建好了'],
        events: [
          { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '想一下' }] } },
          { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '文件建好了' }] } },
        ],
        usage: { input_tokens: 10, cache_read_input_tokens: 6, output_tokens: 4 },
      }),
    }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message').length).toBeGreaterThanOrEqual(2) }, { timeout: 5_000 })
    const events = child.snapshotEvents()
    const assistant = events.filter(e => e.type === 'assistant/message')
    // The thinking stream finalizes at its reserved step 1 (one snapshot +
    // the completion fold; no duplicated content).
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
    expectStepBoundaries(child)
    await m.driver.disposeAll()
  })

  it('token granularity: a cancelled round completes the stream as interrupted (legitimate 已停止)', async () => {
    const m = mount({ config: { permissionMode: 'skip', liveMirrorGranularity: 'token' } })
    const child = Session.create(SessionId('child-claude-token-abort'))
    const fake = new FakeClaude({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const controller = new AbortController()
    const run = await m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    // Stream one partial chunk, then cancel.
    fake.emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '写到一半' } } })
    controller.abort()
    expect((await run.result).stopReason).toBe('aborted')
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1) }, { timeout: 5_000 })
    const final = child.snapshotEvents().find(e => e.type === 'assistant/message')!
    expect(final.data).toMatchObject({ turn: 1, step: 1, interrupted: true })
    expect((final.data as { message: { content: unknown[] } }).message.content).toEqual([{ type: 'text', text: '写到一半' }])
    // The interrupt unwinds the hung turn; its result lands so the chain converges.
    fake.emit({ type: 'result', is_error: false, session_id: 'claude-session-1' })
    await m.driver.disposeAll()
  })

  it('token granularity: a tool-first round renders the answer after its tool cards (lazy stream step)', async () => {
    const m = mount({ config: { permissionMode: 'skip', liveMirrorGranularity: 'token' } })
    const child = Session.create(SessionId('child-claude-token-toolfirst'))
    const fake = new FakeClaude({ turn: () => ({ hang: true }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    // Two tool uses land before any text streams.
    fake.emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } })
    fake.emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pwd' } }] } })
    // Text streams after the tools, then one more tool use, then the answer.
    fake.emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '结论' } } })
    fake.emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'cat a' } }] } })
    fake.emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '结论' }] } })
    fake.emit({ type: 'result', is_error: false, session_id: 'claude-session-1', usage: { input_tokens: 5, cache_read_input_tokens: 0, output_tokens: 2 } })
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(1) }, { timeout: 5_000 })

    // Chronological steps: tool=1, tool=2, the stream=3, the late tool shifts to 4.
    const toolSteps = child.snapshotEvents().filter(e => e.type === 'tool/call').map(e => (e.data as { step: number }).step)
    expect(toolSteps).toEqual([1, 2, 4])
    const final = child.snapshotEvents().find(e => e.type === 'assistant/message')!
    expect(final.data).toMatchObject({ turn: 1, step: 3, usage: { inputTokens: 5, outputTokens: 2 } })
    // The shifted tool steps carry their own boundary pairs too.
    expectStepBoundaries(child)
    await m.driver.disposeAll()
  })

  it('token granularity: a stream-less round folds every line (no reservation, no snapshots)', async () => {
    const m = mount({ config: { permissionMode: 'skip', liveMirrorGranularity: 'token' } })
    const child = Session.create(SessionId('child-claude-token-nostream'))
    // Events only, no deltas: thinking + tool + final answer.
    m.queueChild(new FakeClaude({
      turn: () => ({ events: answerEvents('静默答案'), usage: { input_tokens: 5, cache_read_input_tokens: 0, output_tokens: 2 } }),
    }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => { expect(child.snapshotEvents().filter(e => e.type === 'assistant/message')).toHaveLength(2) }, { timeout: 5_000 })

    // Faithful per-line fold: thinking at step 1, the tool card at step 2,
    // the answer at step 3 — nothing withheld for a combined message.
    const toolSteps = child.snapshotEvents().filter(e => e.type === 'tool/call').map(e => (e.data as { step: number }).step)
    expect(toolSteps).toEqual([2])
    const assistant = child.snapshotEvents().filter(e => e.type === 'assistant/message')
    expect(assistant.map(e => (e.data as { step: number }).step)).toEqual([1, 3])
    expect((assistant[1]!.data as { message: { content: unknown[] } }).message.content).toEqual([{ type: 'text', text: '静默答案' }])
    expect(assistant[1]?.data).toMatchObject({ usage: { inputTokens: 5, outputTokens: 2 } })
    expectStepBoundaries(child)
    await m.driver.disposeAll()
  })

  it('respects the configured base URL override and nothing more in env', async () => {
    const m = mount({ config: { permissionMode: 'normal', baseUrl: 'https://proxy.example.com/anthropic' } })
    const child = Session.create(SessionId('child-claude-8'))
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('ok') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.spawns[0]!.spec.env).toEqual({
      CLAUDE_CONFIG_DIR: m.homeDir,
      ANTHROPIC_BASE_URL: 'https://proxy.example.com/anthropic',
    })
    expect(m.spawns[0]!.spec.argv).not.toContain('--dangerously-skip-permissions')
    await m.driver.disposeAll()
  })
})

describe('claude live driver lifecycle', () => {
  it('reclaims the idle runtime (stdin EOF, no SIGTERM when it cooperates)', async () => {
    const m = mount({ config: { permissionMode: 'skip', liveIdleMs: 30 } })
    const child = Session.create(SessionId('child-claude-9'))
    const fake = new FakeClaude({ turn: () => ({ events: answerEvents('done') }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    expect(fake.stdinEnded).toBe(true)
    expect(fake.terminated).toBe(false)
  })

  it('cancel during the init wait settles aborted and reclaims without tripping the breaker', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-10'))
    m.queueChild(new FakeClaude({ silentInit: true }))
    const controller = new AbortController()
    const start = Date.now()
    const pending = m.driver.startRound(request({ signal: controller.signal }) as never, roundSpec(m, child))
    setTimeout(() => { controller.abort() }, 20)
    const run = await pending
    expect(Date.now() - start).toBeLessThan(5_000)
    expect((await run.result).stopReason).toBe('aborted')
    await vi.waitFor(() => { expect(m.driver.liveCount).toBe(0) })
    expect(m.driver.disabled).toBe(false)
  })

  it('disposeAll reclaims every runtime (no zombies on profile restart)', async () => {
    const m = mount()
    const first = Session.create(SessionId('child-claude-11a'))
    const second = Session.create(SessionId('child-claude-11b'))
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('a') }) }))
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('b') }) }))
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

describe('claude provider live dispatch', () => {
  it('routes rounds to the live driver and records the delegation with the stream session id', async () => {
    const m = mount()
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('完成') }) }))
    const provider = new ClaudeCliProvider(m.ctx, 'skip', undefined, m.driver)
    const run = await provider.start(request() as never)
    expect((await run.result).stopReason).toBe('completed')
    expect(m.spawns[0]!.spec.argv).toContain('stream-json')
    expect(m.records).toHaveBeenCalledTimes(1)
    const record = m.records.mock.calls[0]![0] as { childSessionId: string; cliSessionId: string; provider: string }
    expect(record.provider).toBe('claude-local')
    expect(record.cliSessionId).toBe('claude-session-1')
    await m.driver.disposeAll()
  })

  it('falls back to the exec one-shot when the stream-json init never arrives', async () => {
    const m = mount()
    m.queueChild(new FakeClaude({ silentInit: true }))
    const driver = new ClaudeLiveDriver(m.ctx, { permissionMode: 'skip' }, { initMs: 50, convergeMs: 50, channelRetryMs: 60_000 })
    const provider = new ClaudeCliProvider(m.ctx, 'skip', undefined, driver)
    const run = await provider.start(request() as never)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'exec 答案' }])
    expect(m.spawns).toHaveLength(2)
    expect(m.spawns[1]!.spec.argv).toContain('-p')
    expect(driver.disabled).toBe(true)
    await run.dispose()
  })
})

describe('claude live driver drain (settings handoff)', () => {
  it('refuses new rounds immediately once draining (no queueing behind in-flight work)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-drain1'))
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('done') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.driver.hasRuntime('child-claude-drain1')).toBe(true)
    const drained = m.driver.drain()
    await expect(m.driver.startRound(request() as never, roundSpec(m, child))).rejects.toThrow('draining')
    await drained
    expect(m.driver.liveCount).toBe(0)
    expect(m.driver.hasRuntime('child-claude-drain1')).toBe(false)
  })

  it('lets the in-flight round finish undisturbed, then reclaims the runtime', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-drain2'))
    const fake = new FakeClaude({ turn: () => ({ events: answerEvents('done'), hang: true }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    let drainedFlag = false
    const drained = m.driver.drain().then(() => { drainedFlag = true })
    // The hung round is still in flight: drain waits, the process lives.
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(drainedFlag).toBe(false)
    expect(fake.stdinEnded).toBe(false)
    // The turn's result lands; the in-flight round settles normally.
    fake.emit({ type: 'result', is_error: false, session_id: 'claude-session-1', usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } })
    expect((await run.result).stopReason).toBe('completed')
    await drained
    expect(m.driver.liveCount).toBe(0)
    expect(fake.stdinEnded).toBe(true)
  })

  it('a round queued before the drain dequeues into the refusal (provider falls back to exec)', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-drain3'))
    const fake = new FakeClaude({
      turn: ({ text }) => text === '第二轮' ? { events: answerEvents('不该发生') } : { events: answerEvents('done'), hang: true },
    })
    m.queueChild(fake)
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    // Chain round 2 BEFORE draining, then drain while round 1 hangs.
    const second = m.driver.startRound(request({ prompt: '第二轮' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'claude-session-1', turn: 2 } }))
    const drained = m.driver.drain()
    fake.emit({ type: 'result', is_error: false, session_id: 'claude-session-1', usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } })
    await first.result.catch(() => {})
    await expect(second).rejects.toThrow('draining')
    await drained
    // Round 2 never reached the wire.
    expect(fake.userMessages).toEqual(['建个文件'])
    expect(m.driver.liveCount).toBe(0)
  })

  it('legacy granularity changes leave incremental rounds on the same generation', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-drain4'))
    child.append('turn/start', { turn: 1 })
    m.queueChild(new FakeClaude({ turn: () => ({ deltas: ['do', 'ne'], events: answerEvents('done') }) }))
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    await first.result
    // Event granularity folds the stream lines into per-line messages.
    const eventModeMessages = child.snapshotEvents().filter(e => e.type === 'assistant/message').length
    expect(eventModeMessages).toBeGreaterThan(0)
    m.driver.setLiveMirrorGranularity('event')
    const second = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'claude-session-1', turn: 2 } }))
    await second.result
    // Token granularity folds every line too; the streamed answer finalizes
    // at its stream's reserved step 1 (its deltas arrived before any line).
    await vi.waitFor(() => {
      expect(child.snapshotEvents().filter(e => e.type === 'assistant/message' && (e.data as { turn?: number }).turn === 2)).toHaveLength(2)
    }, { timeout: 5_000 })
    const final = child.snapshotEvents().filter(e => e.type === 'assistant/message' && (e.data as { turn?: number }).turn === 2)
      .find(e => (e.data as { step?: number }).step === 1)!
    expect((final.data as { message: { content: unknown[] } }).message.content).toEqual([{ type: 'text', text: 'done' }])
    // Same runtime, same process: granularity rides the existing generation.
    expect(m.spawns).toHaveLength(1)
    await m.driver.disposeAll()
  })
})

describe('claude provider live resolver', () => {
  it('a resolver returning undefined routes the round to exec (retiring-generation gate)', async () => {
    const m = mount()
    // No live child queued: the exec fallback spawn answers.
    const provider = new ClaudeCliProvider(m.ctx, 'skip', undefined, () => undefined)
    const run = await provider.start(request() as never)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'exec 答案' }])
    expect(m.spawns[0]!.spec.argv).not.toContain('--input-format')
    await run.dispose()
  })

  it('a resolver returning the driver per member routes to live (backward compatible)', async () => {
    const m = mount()
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('完成') }) }))
    const provider = new ClaudeCliProvider(m.ctx, 'skip', undefined, () => m.driver)
    const run = await provider.start(request() as never)
    expect((await run.result).stopReason).toBe('completed')
    expect(m.spawns[0]!.spec.argv).toContain('--input-format')
    await m.driver.disposeAll()
  })
})

describe('claude live driver model key', () => {
  it('set: the resident process starts with --model, before the stream-format flags', async () => {
    const m = mount({ config: { model: () => 'claude-opus-5' } })
    const child = Session.create(SessionId('child-claude-model'))
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('好') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.spawns[0]!.spec.argv).toEqual([
      'claude', '-p', '--verbose',
      '--model', 'claude-opus-5',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
    ])
  })

  it('a blank resolver leaves the argv exactly as it was', async () => {
    const m = mount({ config: { model: () => '  ' } })
    const child = Session.create(SessionId('child-claude-model-blank'))
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('好') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.spawns[0]!.spec.argv).not.toContain('--model')
  })
})

describe('claude live driver member-aware model', () => {
  it('the round spec model (the delegation layer) binds at spawn through the resolver', async () => {
    const m = mount({ config: { permissionMode: 'skip', model: (_child, delegation) => delegation ?? 'settings-model' } })
    const child = Session.create(SessionId('child-claude-delegation-model'))
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('好') }) }))
    const run = await m.driver.startRound(request() as never, { ...roundSpec(m, child), model: 'delegation-model' })
    await run.result
    expect(m.spawns[0]!.spec.argv).toContain('--model')
    expect(m.spawns[0]!.spec.argv[m.spawns[0]!.spec.argv.indexOf('--model') + 1]).toBe('delegation-model')
    await m.driver.disposeAll()
  })

  it('the member-aware resolver receives the member (the override layer keys on it)', async () => {
    const seen: string[] = []
    const m = mount({
      config: {
        permissionMode: 'skip',
        model: (child: string) => {
          seen.push(child)
          return child === 'child-claude-member-key' ? 'override-model' : undefined
        },
      },
    })
    const child = Session.create(SessionId('child-claude-member-key'))
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('好') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(seen).toEqual(['child-claude-member-key'])
    expect(m.spawns[0]!.spec.argv).toContain('override-model')
    await m.driver.disposeAll()
  })

  it('scratches the effective model into the scoped settings.json before spawn', async () => {
    const provisionModel = vi.fn(async () => {})
    const m = mount({ config: { permissionMode: 'skip', model: () => 'claude-opus-5', provisionModel } })
    const child = Session.create(SessionId('child-claude-provision'))
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('好') }) }))
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(provisionModel).toHaveBeenCalledWith(m.homeDir, 'claude-opus-5')
    await m.driver.disposeAll()
  })

  it('retireRuntime reclaims the member runtime so the next round respawns', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-retire'))
    const first = new FakeClaude({ turn: () => ({ events: answerEvents('第一条') }) })
    m.queueChild(first)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    await run.result
    expect(m.driver.runtimeModel('child-claude-retire')).toBeUndefined()
    expect(m.driver.liveCount).toBe(1)
    await m.driver.retireRuntime('child-claude-retire')
    expect(m.driver.liveCount).toBe(0)
    expect(first.stdinEnded).toBe(true)
    const second = new FakeClaude({ turn: () => ({ events: answerEvents('第二条') }) })
    m.queueChild(second)
    const resumed = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'claude-session-1', turn: 2 } }))
    expect((await resumed.result).stopReason).toBe('completed')
    expect(m.spawns).toHaveLength(2)
    expect(m.spawns[1]!.spec.argv).toContain('--resume')
    await m.driver.disposeAll()
  })

  it('a round retires a runtime whose bound model no longer matches, then respawns', async () => {
    const config: { permissionMode: 'skip'; model: () => string } = { permissionMode: 'skip', model: () => 'model-a' }
    const m = mount({ config })
    const child = Session.create(SessionId('child-claude-stale-model'))
    m.queueChild(new FakeClaude({ turn: () => ({ events: answerEvents('第一条') }) }))
    const first = await m.driver.startRound(request() as never, roundSpec(m, child))
    await first.result
    expect(m.driver.runtimeModel('child-claude-stale-model')).toBe('model-a')
    expect(m.spawns[0]!.spec.argv).toContain('model-a')
    // The effective model changes underneath the resident runtime: the NEXT
    // round retires it (the broker's eager retire is the primary path; this
    // is the driver's own safety net) and respawns onto the new model.
    config.model = () => 'model-b'
    const second = new FakeClaude({ turn: () => ({ events: answerEvents('第二条') }) })
    m.queueChild(second)
    const resumed = await m.driver.startRound(request({ prompt: '继续' }) as never, roundSpec(m, child, { resume: { cliSessionId: 'claude-session-1', turn: 2 } }))
    expect((await resumed.result).stopReason).toBe('completed')
    expect(m.spawns).toHaveLength(2)
    expect(m.spawns[1]!.spec.argv).toContain('model-b')
    expect(m.spawns[1]!.spec.argv).toContain('--resume')
    expect(m.driver.runtimeModel('child-claude-stale-model')).toBe('model-b')
    await m.driver.disposeAll()
  })
})

describe('claude live driver control requests', () => {
  it('auto-allows can_use_tool — a permissionMode:normal spawn never hangs on its approval surface', async () => {
    const m = mount({ config: { permissionMode: 'normal' } })
    const child = Session.create(SessionId('child-claude-control'))
    const fake = new FakeClaude({ turn: () => ({ events: answerEvents('好') }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    // The server asks before its first tool call; the driver must answer.
    fake.emit({
      type: 'control_request',
      request_id: 'cr-1',
      request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } },
    })
    await vi.waitFor(() => { expect(fake.controlResponses).toHaveLength(1) })
    expect(fake.controlResponses[0]).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'cr-1',
        response: { behavior: 'allow', updatedInput: { command: 'ls' } },
      },
    })
    expect((await run.result).stopReason).toBe('completed')
    await m.driver.disposeAll()
  })

  it('answers an unknown control request subtype with an error instead of silence', async () => {
    const m = mount()
    const child = Session.create(SessionId('child-claude-control-unknown'))
    const fake = new FakeClaude({ turn: () => ({ events: answerEvents('好') }) })
    m.queueChild(fake)
    const run = await m.driver.startRound(request() as never, roundSpec(m, child))
    fake.emit({ type: 'control_request', request_id: 'cr-9', request: { subtype: 'mcp_message' } })
    await vi.waitFor(() => { expect(fake.controlResponses).toHaveLength(1) })
    expect(fake.controlResponses[0]).toMatchObject({
      type: 'control_response',
      response: { subtype: 'error', request_id: 'cr-9' },
    })
    expect((await run.result).stopReason).toBe('completed')
    await m.driver.disposeAll()
  })
})
