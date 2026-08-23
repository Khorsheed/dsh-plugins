import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { parseClaudeStreamJson, startClaudeCliRun, ClaudeCliProvider } from '../src/claude-cli-provider.ts'

/** The stream a real `claude -p --verbose --output-format stream-json` emits. */
const streamJson = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'echo hi' } }] } }),
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'hi' }] } }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Task complete.' }] } }),
  JSON.stringify({ type: 'result', is_error: false, session_id: 's1', usage: { input_tokens: 2, output_tokens: 5, cache_read_input_tokens: 6, cache_creation_input_tokens: 7 } }),
].join('\n')

/** A stub child that emits the stream-json events then exits 0. */
function stubChild(): { handle: SubprocessHandle; done: Promise<unknown> } {
  const stdout = new Readable({ read() {} })
  stdout.push(streamJson + '\n')
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push('')
  stderr.push(null)
  const done = new Promise<{ exitCode: number; signal: null }>((resolve) => {
    setImmediate(() => { resolve({ exitCode: 0, signal: null }) })
  })
  const handle: SubprocessHandle = {
    pid: 4242,
    stdin: undefined,
    stdout,
    stderr,
    collected: {
      // The settle path reads the collected buffer first (post-exit
      // authoritative); the stream keeps it for live-mirror consumers.
      stdout: { readFrom: () => ({ text: streamJson + '\n', nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done,
    terminate: () => undefined,
    waitForExit: async () => true,
  }
  return { handle, done }
}

describe('claude stream-json parsing', () => {
  it('extracts the ordered transcript, final answer, usage, and session id', () => {
    const parsed = parseClaudeStreamJson(streamJson)
    expect(parsed.lines).toEqual([
      { kind: 'tool', name: 'Bash', detail: 'echo hi', result: 'hi' },
      { kind: 'text', text: 'Task complete.' },
    ])
    expect(parsed.text).toBe('Task complete.')
    // claude's input_tokens is uncached; cache read/creation map to their
    // own buckets with no subtraction.
    expect(parsed.usage).toEqual({ inputTokens: 2, outputTokens: 5, cacheReadTokens: 6, cacheWriteTokens: 7 })
    expect(parsed.sessionId).toBe('s1')
  })

  it('tolerates malformed output and reports is_error', () => {
    expect(parseClaudeStreamJson('not-json')).toEqual({ lines: [] })
    expect(parseClaudeStreamJson(JSON.stringify({ type: 'result', is_error: true, error: 'boom' })))
      .toEqual({ lines: [], error: 'boom' })
  })

  it('mirrors the real stream-json fixture (system, tool_use, tool_result, text, result)', () => {
    const fixture = readFileSync(
      fileURLToPath(new URL('./fixtures/stream-json.sample.jsonl', import.meta.url)),
      'utf8',
    )
    const parsed = parseClaudeStreamJson(fixture)
    expect(parsed.sessionId).toBeTruthy()
    const kinds = parsed.lines.map(line => line.kind)
    expect(kinds).toEqual(['tool', 'text'])
    expect(parsed.lines[0]).toMatchObject({ kind: 'tool', name: 'Bash' })
    if (parsed.lines[0]?.kind === 'tool') {
      expect(parsed.lines[0].result).toContain('hi')
    }
    expect(parsed.text).toBe('done')
    expect(parsed.usage?.inputTokens).toBeGreaterThan(0)
  })
})

describe('claude-cli-provider run settlement', () => {
  it('settles completed, closes the turn, and appends the response with usage', async () => {
    const child = Session.create(SessionId('child-run-1'))
    const ctx = new Context()
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    const { handle, done } = stubChild()

    const request = {
      prompt: [{ type: 'text', text: 'do the task' }],
      parent: { session: { header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
    } as unknown as SubagentStartRequest

    const run = await startClaudeCliRun(request, {
      cwd: '/tmp',
      env: { CLAUDE_CONFIG_DIR: '/tmp/claude-home' },
      permissionMode: 'skip',
      disposeGraceMs: 3_000,
      spawn: () => handle,
      childSession: child,
      ctx,
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'Task complete.' }])
    // The mirror runs after the child exits (fire-and-forget), so let it
    // finish before asserting the transcript was appended.
    await vi.waitFor(() => {
      expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(2)
    })
    const assistant = child.events.filter(event => event.type === 'assistant/message')
    // The stream transcript mirrors the tool call and the final text as
    // separate assistant steps; usage rides the last one.
    expect(assistant[0]!.data.message.content).toEqual([{ type: 'text', text: '[工具 Bash] echo hi → hi' }])
    expect(assistant[1]!.data.message.content).toEqual([{ type: 'text', text: 'Task complete.' }])
    expect(assistant[0]!.data.usage).toBeUndefined()
    expect(assistant[1]!.data.usage).toEqual({ inputTokens: 2, outputTokens: 5, cacheReadTokens: 6, cacheWriteTokens: 7 })
    const turns = child.events.filter(event => event.type === 'turn/start' || event.type === 'turn/end')
    expect(turns.map(event => event.type)).toEqual(['turn/start', 'turn/end'])
    // The live mirror persists during the run; the settle mirror persists the
    // final event set (with turn/end) after exit — wait for that last write.
    await vi.waitFor(() => {
      expect(append).toHaveBeenCalledWith(child.id, child.events)
    })
    await done
  })

  it('mirrors the stream-json live during the run and settles without duplicates', async () => {
    const child = Session.create(SessionId('child-live-claude'))
    const ctx = new Context()
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    const reports: { id: string; progress: { kind: string; text?: string; mirroredLines?: number } }[] = []
    ctx.provide('localAgent', {
      reportRunProgress: (id: string, progress: { kind: string; text?: string; mirroredLines?: number }) => {
        reports.push({ id, progress })
      },
    } as never)

    // A controllable child: stdout stays open, done resolves when the test
    // finishes the process.
    const stdout = new Readable({ read() {} })
    const stderr = new Readable({ read() {} })
    let finish!: (outcome: { exitCode: number; signal: null }) => void
    const done = new Promise<{ exitCode: number; signal: null }>((resolve) => { finish = resolve })
    const handle: SubprocessHandle = {
      pid: 4246,
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

    const request = {
      prompt: [{ type: 'text', text: 'do the task' }],
      parent: { session: { header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
    } as unknown as SubagentStartRequest

    const run = await startClaudeCliRun(request, {
      cwd: '/tmp',
      env: {},
      permissionMode: 'normal',
      disposeGraceMs: 3_000,
      spawn: () => handle,
      childSession: child,
      ctx,
    })

    const emit = (...events: unknown[]): void => {
      stdout.push(events.map(event => JSON.stringify(event)).join('\n') + '\n')
    }
    // The tool_use line is held back as the volatile last line; its
    // tool_result merges into it before anything mirrors.
    emit(
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'echo hi' } }] } },
    )
    emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'hi' }] } })

    // The next line un-holds the merged tool line: the user prompt and the
    // tool step mirror while the process is STILL running.
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Task complete.' }] } })
    await vi.waitFor(() => {
      expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
    })
    const firstAssistant = child.events.filter(event => event.type === 'assistant/message')
    expect((firstAssistant[0]!.data as { message: { content: unknown } }).message.content)
      .toEqual([{ type: 'text', text: '[工具 Bash] echo hi → hi' }])
    expect(child.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(reports.some(report => report.progress.kind === 'delta')).toBe(true)

    // The terminal result flushes the held text line with the round's usage.
    emit({ type: 'result', is_error: false, session_id: 's1', usage: { input_tokens: 2, output_tokens: 5 } })
    await vi.waitFor(() => {
      expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(2)
    })

    // Settle: the live mirror already covered the stream — no duplicates.
    finish({ exitCode: 0, signal: null })
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => {
      expect(reports.some(report => report.progress.kind === 'mirror' && report.progress.mirroredLines === 2)).toBe(true)
    })
    const assistant = child.events.filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(2)
    expect(child.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect((assistant[1]!.data as { usage?: unknown }).usage).toEqual({ inputTokens: 2, outputTokens: 5 })
    await done
  })

  it('settles error and closes the turn with an error reason', async () => {
    const done = Promise.resolve({ exitCode: 1, signal: null })
    const child = Session.create(SessionId('child-run-error'))
    const handle: SubprocessHandle = {
      pid: 4243,
      stdin: undefined,
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      collected: {
        stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done,
      terminate: () => undefined,
      waitForExit: async () => true,
    }
    const run = await startClaudeCliRun(
      { prompt: [{ type: 'text', text: 'x' }], parent: { session: { header: { cwd: '/tmp' } } }, signal: new AbortController().signal } as unknown as SubagentStartRequest,
      { cwd: '/tmp', env: {}, permissionMode: 'skip', disposeGraceMs: 3_000, spawn: () => handle, childSession: child },
    )
    const result = await run.result
    expect(result.stopReason).toBe('error')
    const turnEnd = child.events.find(event => event.type === 'turn/end')
    const endData = turnEnd?.data as { turn?: number; reason?: { kind?: string; error?: { message?: string; code?: string } } } | undefined
    expect(endData?.turn).toBe(1)
    expect(endData?.reason?.kind).toBe('error')
    expect(endData?.reason?.error?.message).toContain('exited with code 1')
    await done
  })

  it('reports auth-shaped failures through onAuthFailure (is_error result)', async () => {
    const done = Promise.resolve({ exitCode: 0, signal: null })
    const authFailures: string[] = []
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
      JSON.stringify({ type: 'result', is_error: true, result: 'Failed to authenticate. API Error: 401 OAuth access token has been revoked', usage: {} }),
      '',
    ].join('\n')
    const handle: SubprocessHandle = {
      pid: 4247,
      stdin: undefined,
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      collected: {
        stdout: { readFrom: () => ({ text: stream, nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done,
      terminate: () => undefined,
      waitForExit: async () => true,
    }
    const run = await startClaudeCliRun(
      { prompt: [{ type: 'text', text: 'x' }], parent: { session: { header: { cwd: '/tmp' } } }, signal: new AbortController().signal } as unknown as SubagentStartRequest,
      { cwd: '/tmp', env: {}, permissionMode: 'skip', disposeGraceMs: 3_000, spawn: () => handle, onAuthFailure: detail => authFailures.push(detail) },
    )
    expect((await run.result).stopReason).toBe('error')
    // Auth detection runs on the post-exit chain (after streams drain).
    await vi.waitFor(() => { expect(authFailures).toHaveLength(1) })
    expect(authFailures[0]).toContain('401')
    await done
  })

  it('settles error when the CLI exits 0 with no parsed answer (silent failure, not success)', async () => {
    const done = Promise.resolve({ exitCode: 0, signal: null })
    const child = Session.create(SessionId('child-empty-claude'))
    const ctx = new Context()
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    const handle: SubprocessHandle = {
      pid: 4243,
      stdin: undefined,
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      collected: {
        stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done,
      terminate: () => undefined,
      waitForExit: async () => true,
    }
    const run = await startClaudeCliRun(
      { prompt: [{ type: 'text', text: 'x' }], parent: { session: { header: { cwd: '/tmp' } } }, signal: new AbortController().signal } as unknown as SubagentStartRequest,
      { cwd: '/tmp', env: {}, permissionMode: 'skip', disposeGraceMs: 3_000, spawn: () => handle, childSession: child },
    )
    const result = await run.result
    // A zero exit with no parsed answer is an ERROR, never an empty success.
    expect(result.stopReason).toBe('error')
    expect(result.output).toEqual([])
    const turnEnd = child.events.find(event => event.type === 'turn/end')
    const endData = turnEnd?.data as { reason?: { kind?: string; error?: { message?: string } } } | undefined
    expect(endData?.reason?.kind).toBe('error')
    await done
  })
})

describe('claude-cli-provider resume round', () => {
  it('spawns claude -p --resume <session_id> into the existing child session with the next turn', async () => {
    const ctx = new Context()
    const child = Session.create(SessionId('child-run-1'))
    child.append('subagent/descriptor', {
      version: 2, mode: 'one-shot', provider: 'claude-local', label: 'Claude Code: 建个文件',
    })
    child.append('turn/start', { turn: 1 })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ctx.provide('sessions', { get: (id: SessionId) => (id === SessionId('child-run-1') ? child : undefined) } as never)
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/claude-home',
      get: () => ({ displayName: 'Claude Code' }),
      takeDelegationIntent: () => ({
        kind: 'resume',
        childSessionId: 'child-run-1',
        cliSessionId: 's1',
      }),
      recordDelegation: () => {},
      acquireResumeLock: () => true,
      releaseResumeLock: () => {},
    } as never)

    const spawned: string[][] = []
    ctx.provide('subprocess', {
      spawn: (spec: { argv: string[] }) => {
        spawned.push(spec.argv)
        return stubChild().handle
      },
    } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)

    const provider = new ClaudeCliProvider(ctx, 'skip')
    const request = {
      label: '继续',
      prompt: [{ type: 'text', text: '接着做' }],
      parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
      descriptor: { version: 2, mode: 'one-shot', provider: 'claude-local', label: '继续' },
    } as unknown as Parameters<ClaudeCliProvider['start']>[0]

    const run = await provider.start(request)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(spawned[0]).toEqual(['claude', '-p', '--dangerously-skip-permissions', '--verbose', '--resume', 's1', '--output-format', 'stream-json', '接着做'])
    expect(run.id).toBe(SessionId('child-run-1'))
    const turnStarts = child.events.filter(event => event.type === 'turn/start')
    const turnEnds = child.events.filter(event => event.type === 'turn/end')
    expect(turnStarts).toHaveLength(2)
    expect(turnEnds).toHaveLength(2)
    expect((turnStarts[1]?.data as { turn?: number }).turn).toBe(2)
    expect((turnEnds[1]?.data as { turn?: number }).turn).toBe(2)
    await run.dispose()
  })

  it('fails loud when the resume target child session is not live', async () => {
    const ctx = new Context()
    ctx.provide('sessions', { get: () => undefined } as never)
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/claude-home',
      takeDelegationIntent: () => ({
        kind: 'resume',
        childSessionId: 'child-gone',
        cliSessionId: 's1',
      }),
      recordDelegation: () => {},
      acquireResumeLock: () => true,
      releaseResumeLock: () => {},
    } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)

    const provider = new ClaudeCliProvider(ctx)
    const request = {
      label: '继续',
      prompt: [{ type: 'text', text: '接着做' }],
      parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
    } as unknown as Parameters<ClaudeCliProvider['start']>[0]

    await expect(provider.start(request)).rejects.toThrow(/is not live/)
  })
})

describe('claude-cli-provider resume lock', () => {
  it('rejects a concurrent second resume of the same child with no CLI spawn', async () => {
    const ctx = new Context()
    const child = Session.create(SessionId('child-run-1'))
    child.append('subagent/descriptor', {
      version: 2, mode: 'one-shot', provider: 'claude-local', label: 'Claude Code: 建个文件',
    })
    child.append('turn/start', { turn: 1 })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ctx.provide('sessions', { get: (id: SessionId) => (id === SessionId('child-run-1') ? child : undefined) } as never)
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    let locked: string | undefined
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/claude-home',
      get: () => ({ displayName: 'Claude Code' }),
      takeDelegationIntent: () => ({
        kind: 'resume',
        childSessionId: 'child-run-1',
        cliSessionId: 's1',
      }),
      recordDelegation: () => {},
      acquireResumeLock: (childSessionId: string) => {
        if (locked !== undefined) return false
        locked = childSessionId
        return true
      },
      releaseResumeLock: () => { locked = undefined },
    } as never)

    let spawned = 0
    ctx.provide('subprocess', {
      spawn: () => {
        spawned += 1
        const stdout = new Readable({ read() {} })
        stdout.push(streamJson + '\n')
        stdout.push(null)
        const stderr = new Readable({ read() {} })
        stderr.push('')
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
          done: new Promise(() => {}),
          terminate: () => undefined,
          waitForExit: async () => true,
        }
      },
    } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)

    const provider = new ClaudeCliProvider(ctx, 'skip')
    const request = {
      label: '继续',
      prompt: [{ type: 'text', text: '接着做' }],
      parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
    } as unknown as Parameters<ClaudeCliProvider['start']>[0]

    const first = await provider.start(request)
    await expect(provider.start(request)).rejects.toThrow(/有进行中的委派/)
    expect(spawned).toBe(1)
    ctx.localAgent.releaseResumeLock('child-run-1')
    expect(locked).toBeUndefined()
  })
})

describe('claude-cli-provider abort path', () => {
  /**
   * A 10-minute fake CLI that never exits on its own: emits a partial
   * stream-json (a tool_use + a thinking block), then hangs until terminate()
   * releases its `done`.
   */
  function hangingChild(): {
    handle: SubprocessHandle
    done: Promise<{ exitCode: number; signal: null }>
    terminated: () => boolean
  } {
    const partialStream = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-abort' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '先想想怎么做。' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'echo hi' } }] } }),
    ].join('\n')
    const stdout = new Readable({ read() {} })
    const stderr = new Readable({ read() {} })
    stderr.push('')
    stderr.push(null)
    let resolveDone: (outcome: { exitCode: number; signal: null }) => void = () => {}
    let terminated = false
    const done = new Promise<{ exitCode: number; signal: null }>((resolve) => {
      resolveDone = resolve
    })
    const handle: SubprocessHandle = {
      pid: 4242,
      stdin: undefined,
      stdout,
      stderr,
      collected: {
        stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done,
      terminate: () => {
        terminated = true
        resolveDone({ exitCode: 0, signal: null })
      },
      waitForExit: async () => true,
    }
    // Emit the partial stream soon after spawn (a real process writes while
    // running), then hang.
    setTimeout(() => {
      stdout.push(partialStream + '\n')
      stdout.push(null)
    }, 10)
    return { handle, done, terminated: () => terminated }
  }

  it('settles the result immediately on abort and mirrors the partial stream-json after the kill', async () => {
    const child = Session.create(SessionId('child-abort-claude'))
    const ctx = new Context()
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    const hanging = hangingChild()

    const controller = new AbortController()
    const request = {
      prompt: [{ type: 'text', text: '建个文件' }],
      parent: { session: { header: { cwd: '/tmp' } } },
      signal: controller.signal,
    } as unknown as SubagentStartRequest

    const run = await startClaudeCliRun(request, {
      cwd: '/tmp',
      env: { CLAUDE_CONFIG_DIR: '/tmp/claude-home' },
      permissionMode: 'skip',
      disposeGraceMs: 3_000,
      spawn: () => hanging.handle,
      childSession: child,
      ctx,
    })
    // Let the fake's partial stream reach the provider's 'data' listener before
    // aborting, so the abort mirror has content to preserve.
    await new Promise(resolve => { setTimeout(resolve, 50) })

    const settledAt = Date.now()
    controller.abort()
    const result = await run.result
    expect(result.stopReason).toBe('aborted')
    expect(Date.now() - settledAt).toBeLessThan(1_000)
    expect(hanging.terminated()).toBe(false)

    await run.dispose()
    expect(hanging.terminated()).toBe(true)
    await expect(run.dispose()).resolves.toBeUndefined()

    const turnEnd = child.events.find(event => event.type === 'turn/end')
    expect(turnEnd?.data).toEqual({ turn: 1, reason: { kind: 'aborted', reason: { kind: 'parent' } } })

    // The partial stream (thinking + tool call) is mirrored after the kill.
    await vi.waitFor(() => {
      expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(2)
    })
    const assistant = child.events.filter(event => event.type === 'assistant/message')
    expect(assistant[0]!.data.message.content).toEqual([{ type: 'reasoning', text: '先想想怎么做。' }])
    expect(assistant[1]!.data.message.content).toEqual([{ type: 'text', text: '[工具 Bash] echo hi' }])
    await hanging.done
  })
})
