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
  /** Partial-message stream_event deltas (token granularity). */
  deltas?: string[]
}

interface FakeClaudeScript {
  turn?: (params: { text: string }) => FakeTurn
  /** Exit immediately on spawn (channel-broken simulation). */
  silentInit?: boolean
}

/** A fake resident `claude --input-format stream-json` process. */
class FakeClaude {
  readonly stdin = new PassThrough()
  readonly stdout = new Readable({ read() {} })
  readonly stderr = new Readable({ read() {} })
  readonly handle: SubprocessHandle
  readonly userMessages: string[] = []
  readonly controlRequests: Record<string, unknown>[] = []
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
    if (message['type'] !== 'user') return
    const content = (message['message'] as { content: { text: string }[] }).content
    const text = content[0]!.text
    this.userMessages.push(text)
    if (this.script.silentInit === true) return
    const turn = this.script.turn?.({ text }) ?? {}
    queueMicrotask(() => {
      this.emit({ type: 'system', subtype: 'init', session_id: this.sessionId })
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

describe('claude live driver rounds', () => {
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
      '--dangerously-skip-permissions',
    ])
    // The auth discipline: exactly the scoped config dir, nothing else.
    expect(spawn.spec.env).toEqual({ CLAUDE_CONFIG_DIR: m.homeDir })
    // Mirroring: prompt + folded lines, usage on the final line.
    expect(child.events.filter(e => e.type === 'user/message')).toHaveLength(1)
    const assistant = child.events.filter(e => e.type === 'assistant/message')
    expect(assistant).toHaveLength(3)
    expect(assistant[0]?.data).toMatchObject({ message: { content: [{ type: 'reasoning' }] } })
    expect(assistant[2]?.data).toMatchObject({ message: { content: [{ type: 'text', text: '第一条回复' }] } })
    expect(child.events.find(e => e.type === 'turn/end')?.data).toMatchObject({ turn: 1, reason: { kind: 'completed' } })
    expect(m.reports.some(r => r.progress.kind === 'delta' && r.progress.text === '第一条回复')).toBe(true)
    await vi.waitFor(() => { expect(m.reports.some(r => r.progress.kind === 'mirror')).toBe(true) })
    await m.driver.disposeAll()
    expect(m.driver.liveCount).toBe(0)
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
    expect(child.events.filter(e => e.type === 'turn/end').at(-1)?.data).toMatchObject({ turn: 2, reason: { kind: 'completed' } })
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
    expect(child.events.find(e => e.type === 'turn/end')?.data).toMatchObject({
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
    expect(child.events.find(e => e.type === 'turn/end')?.data).toMatchObject({ reason: { kind: 'error' } })
    // The folded partial work is still mirrored.
    expect(child.events.filter(e => e.type === 'assistant/message').length).toBeGreaterThan(0)
    await m.driver.disposeAll()
  })

  it('appends assistant/chunk deltas only under the token granularity', async () => {
    const deltas = ['hel', 'lo']
    const off = mount()
    const offChild = Session.create(SessionId('child-claude-7a'))
    off.queueChild(new FakeClaude({ turn: () => ({ deltas, events: answerEvents('hello') }) }))
    const offRun = await off.driver.startRound(request() as never, roundSpec(off, offChild))
    await offRun.result
    expect(offChild.events.filter(e => e.type === 'assistant/chunk')).toHaveLength(0)
    expect(off.spawns[0]!.spec.argv).not.toContain('--include-partial-messages')
    await off.driver.disposeAll()

    const on = mount({ config: { permissionMode: 'skip', liveMirrorGranularity: 'token' } })
    const onChild = Session.create(SessionId('child-claude-7b'))
    on.queueChild(new FakeClaude({ turn: () => ({ deltas, events: answerEvents('hello') }) }))
    const onRun = await on.driver.startRound(request() as never, roundSpec(on, onChild))
    await onRun.result
    expect(on.spawns[0]!.spec.argv).toContain('--include-partial-messages')
    expect(onChild.events.filter(e => e.type === 'assistant/chunk')).toHaveLength(2)
    await on.driver.disposeAll()
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
