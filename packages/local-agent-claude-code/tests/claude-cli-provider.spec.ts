import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { fakeSessionPersistence } from './fake-persistence.ts'
import { claudeVersionFromInit, parseClaudeStreamJson, startClaudeCliRun, ClaudeCliProvider } from '../src/claude-cli-provider.ts'

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

describe('claudeVersionFromInit', () => {
  it('reads VERSION out of the build-info object claude 2.1.x sends', () => {
    expect(claudeVersionFromInit({ VERSION: '2.1.263', GIT_SHA: '37ae3f3' })).toBe('2.1.263')
  })

  it('accepts a bare string, in case a later release simplifies the field', () => {
    expect(claudeVersionFromInit('2.2.0')).toBe('2.2.0')
  })

  it('reports nothing for a missing or shape-skewed field', () => {
    expect(claudeVersionFromInit(undefined)).toBeUndefined()
    expect(claudeVersionFromInit({})).toBeUndefined()
    expect(claudeVersionFromInit({ VERSION: 7 })).toBeUndefined()
  })
})

describe('claude stream-json parsing', () => {
  it('extracts the ordered transcript, final answer, usage, and session id', () => {
    const parsed = parseClaudeStreamJson(streamJson)
    expect(parsed.lines).toEqual([
      { kind: 'tool', id: 'tu1', name: 'Bash', args: 'echo hi', result: 'hi' },
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
    const persistence = fakeSessionPersistence()
    const append = persistence.append
    ctx.provide('sessionPersistence', persistence)
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
      expect(child.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(1)
    })
    const assistant = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    // The stream transcript mirrors the tool call as a native
    // tool/call + tool/result pair; usage rides the final text message.
    expect(assistant[0]!.data.message.content).toEqual([{ type: 'text', text: 'Task complete.' }])
    expect(assistant[0]!.data.usage).toEqual({ inputTokens: 2, outputTokens: 5, cacheReadTokens: 6, cacheWriteTokens: 7 })
    const calls = child.snapshotEvents().filter(event => event.type === 'tool/call')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.data).toMatchObject({ callId: 'tu1', name: 'Bash', arguments: 'echo hi' })
    const toolResults = child.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]!.data.message.content[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'tu1',
      content: [{ type: 'text', text: 'hi' }],
      isError: false,
    })
    const turns = child.snapshotEvents().filter(event => event.type === 'turn/start' || event.type === 'turn/end')
    expect(turns.map(event => event.type)).toEqual(['turn/start', 'turn/end'])
    // Every mirrored step is wrapped in its step/start–step/end pair.
    expectStepBoundaries(child)
    // The live mirror persists during the run; the settle mirror persists the
    // final event set (with turn/end) after exit — wait for that last write.
    await vi.waitFor(() => {
      expect(append).toHaveBeenCalledWith(child.id, child.snapshotEvents())
    })
    await done
  })

  it('mirrors the stream-json live during the run and settles without duplicates', async () => {
    const child = Session.create(SessionId('child-live-claude'))
    const ctx = new Context()
    const persistence = fakeSessionPersistence()
    const append = persistence.append
    ctx.provide('sessionPersistence', persistence)
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
      expect(child.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
    })
    const liveCalls = child.snapshotEvents().filter(event => event.type === 'tool/call')
    expect(liveCalls).toHaveLength(1)
    expect(liveCalls[0]!.data).toMatchObject({ callId: 'tu1', name: 'Bash', arguments: 'echo hi' })
    expect(child.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(0)
    expect(child.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(reports.some(report => report.progress.kind === 'delta')).toBe(true)

    // The terminal result flushes the held text line with the round's usage.
    emit({ type: 'result', is_error: false, session_id: 's1', usage: { input_tokens: 2, output_tokens: 5 } })
    await vi.waitFor(() => {
      expect(child.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(1)
    })

    // Settle: the live mirror already covered the stream — no duplicates.
    finish({ exitCode: 0, signal: null })
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => {
      expect(reports.some(report => report.progress.kind === 'mirror' && report.progress.mirroredLines === 2)).toBe(true)
    })
    const assistant = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(1)
    expect(child.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(child.snapshotEvents().filter(event => event.type === 'tool/call')).toHaveLength(1)
    expect((assistant[0]!.data as { usage?: unknown }).usage).toEqual({ inputTokens: 2, outputTokens: 5 })
    expectStepBoundaries(child)
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
    const turnEnd = child.snapshotEvents().find(event => event.type === 'turn/end')
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
    const persistence = fakeSessionPersistence()
    const append = persistence.append
    ctx.provide('sessionPersistence', persistence)
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
    const turnEnd = child.snapshotEvents().find(event => event.type === 'turn/end')
    const endData = turnEnd?.data as { reason?: { kind?: string; error?: { message?: string } } } | undefined
    expect(endData?.reason?.kind).toBe('error')
    await done
  })
})

describe('claude-cli-provider child session record', () => {
  it('appends the parent-side subagent/catalog row where the child descriptor lands', async () => {
    const ctx = new Context()
    const created: Session[] = []
    ctx.provide('sessions', {
      create: (id: SessionId) => {
        const session = Session.create(id)
        created.push(session)
        return session
      },
    } as never)
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/claude-home',
      get: () => ({ displayName: 'Claude Code' }),
      takeDelegationIntent: () => undefined,
      recordDelegation: () => {},
      getDelegation: () => undefined,
      recordRoundSettled: () => {},
      setKimiMirroredLines: () => {},
      kimiMirroredLines: () => undefined,
    } as never)
    ctx.provide('subprocess', { spawn: () => { throw new Error('not spawned in record test') } } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)

    const provider = new ClaudeCliProvider(ctx)
    // A real parent Session: the provider appends the parent-side
    // subagent/catalog discovery row to it — the row the official runtime
    // only appends for in-process children (run.localAgent).
    const parent = Session.create(SessionId('parent-1'), [], {
      id: SessionId('parent-1'),
      version: SESSION_FORMAT_VERSION,
      createdAt: 1,
      isSeeded: false,
      cwd: '/tmp',
      delegationDepth: 0,
    })
    const request = {
      label: '任务',
      prompt: [{ type: 'text', text: '建个文件' }],
      parent: { session: parent },
      signal: new AbortController().signal,
      descriptor: { version: 2, mode: 'one-shot', provider: 'claude-local', label: '任务' },
    } as unknown as Parameters<ClaudeCliProvider['start']>[0]

    await expect(provider.start(request)).rejects.toThrow(/not spawned/)
    expect(created).toHaveLength(1)
    // The row lands once per child, carrying the descriptor's composed label.
    const catalog = parent.snapshotEvents().filter(event => event.type === 'subagent/catalog')
    expect(catalog).toHaveLength(1)
    expect(catalog[0]?.data).toEqual({
      version: 0,
      childId: created[0]!.id,
      childCreatedAt: created[0]!.header.createdAt,
      mode: 'one-shot',
      label: 'Claude Code: 任务',
    })
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
    const persistence = fakeSessionPersistence()
    const append = persistence.append
    ctx.provide('sessionPersistence', persistence)
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/claude-home',
      get: () => ({ displayName: 'Claude Code' }),
      takeDelegationIntent: () => ({
        kind: 'resume',
        childSessionId: 'child-run-1',
        cliSessionId: 's1',
      }),
      recordDelegation: () => {},
      getDelegation: () => undefined,
      recordRoundSettled: () => {},
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
    const turnStarts = child.snapshotEvents().filter(event => event.type === 'turn/start')
    const turnEnds = child.snapshotEvents().filter(event => event.type === 'turn/end')
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
      getDelegation: () => undefined,
      recordRoundSettled: () => {},
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
    const persistence = fakeSessionPersistence()
    const append = persistence.append
    ctx.provide('sessionPersistence', persistence)
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
      getDelegation: () => undefined,
      recordRoundSettled: () => {},
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
    const persistence = fakeSessionPersistence()
    const append = persistence.append
    ctx.provide('sessionPersistence', persistence)
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

    const turnEnd = child.snapshotEvents().find(event => event.type === 'turn/end')
    expect(turnEnd?.data).toEqual({ turn: 1, reason: { kind: 'aborted', reason: { kind: 'parent' } } })

    // The partial stream (thinking + tool call) is mirrored after the kill.
    await vi.waitFor(() => {
      expect(child.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(1)
      expect(child.snapshotEvents().filter(event => event.type === 'tool/call')).toHaveLength(1)
    })
    const assistant = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(assistant[0]!.data.message.content).toEqual([{ type: 'reasoning', text: '先想想怎么做。' }])
    // The killed stream's tool_use mirrors as a native call (no result — the
    // kill landed first).
    expect(child.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(0)
    const calls = child.snapshotEvents().filter(event => event.type === 'tool/call')
    expect(calls[0]!.data).toMatchObject({ name: 'Bash', arguments: 'echo hi' })
    // The preserved partial work carries its step boundaries too.
    expectStepBoundaries(child)
    await hanging.done
  })
})

/** A stub child that emits a CUSTOM stream-json stream then exits 0. */
function stubChildWith(stream: string): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push(stream + '\n')
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push('')
  stderr.push(null)
  return {
    pid: 4245,
    stdin: undefined,
    stdout,
    stderr,
    collected: {
      stdout: { readFrom: () => ({ text: stream + '\n', nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: new Promise((resolve) => { setImmediate(() => { resolve({ exitCode: 0, signal: null }) }) }),
    terminate: () => undefined,
    waitForExit: async () => true,
  }
}

describe('claude-cli-provider observed model and cwd', () => {
  const OBS_REQUEST = {
    label: '任务',
    prompt: [{ type: 'text', text: '建个文件' }],
    parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp', delegationDepth: 0 } } },
    signal: new AbortController().signal,
    descriptor: { version: 2, mode: 'one-shot', provider: 'claude-local', label: '任务' },
  } as unknown as Parameters<ClaudeCliProvider['start']>[0]

  /** The init event names the model on the real 2.x wire. */
  const INIT_STREAM = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-obs', model: 'claude-opus-5[1m]' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }),
    JSON.stringify({ type: 'result', is_error: false, session_id: 's-obs', usage: { input_tokens: 2, output_tokens: 5 } }),
  ].join('\n')

  /** The old fixture shape: init names no model. */
  const PLAIN_STREAM = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-obs' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }),
    JSON.stringify({ type: 'result', is_error: false, session_id: 's-obs', usage: { input_tokens: 2, output_tokens: 5 } }),
  ].join('\n')

  async function mountObserved(options: { stream: string; intent?: unknown; recorded?: Record<string, unknown> | undefined }) {
    const ctx = new Context()
    const records = vi.fn()
    const settled = vi.fn()
    const spawnSpecs: { argv: readonly string[]; cwd: string }[] = []
    const liveChild = Session.create(SessionId('child-1'))
    liveChild.append('subagent/descriptor', { version: 2, mode: 'one-shot', provider: 'claude-local', label: '任务' })
    liveChild.append('turn/start', { turn: 1 })
    liveChild.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ctx.provide('sessions', {
      create: (id: SessionId) => Session.create(id),
      get: (id: SessionId) => (id === SessionId('child-1') ? liveChild : undefined),
    } as never)
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/claude-home',
      get: () => ({ displayName: 'Claude Code' }),
      takeDelegationIntent: () => options.intent,
      recordDelegation: records,
      getDelegation: () => options.recorded,
      recordRoundSettled: settled,
      acquireResumeLock: () => true,
      releaseResumeLock: () => {},
      setKimiMirroredLines: () => {},
      kimiMirroredLines: () => undefined,
    } as never)
    ctx.provide('subprocess', {
      spawn: (spec: { argv: readonly string[]; cwd: string }) => {
        spawnSpecs.push(spec)
        return stubChildWith(options.stream)
      },
    } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
    return { provider: new ClaudeCliProvider(ctx), records, settled, spawnSpecs }
  }

  it('records the init-named model and the round usage on settle', async () => {
    const { provider, settled } = await mountObserved({ stream: INIT_STREAM })
    const run = await provider.start(OBS_REQUEST)
    await run.result
    await vi.waitFor(() => { expect(settled).toHaveBeenCalledTimes(1) })
    // The model comes verbatim from the stream's system/init event — the
    // context-variant suffix included.
    expect(settled).toHaveBeenCalledWith(expect.any(String), {
      observedModel: 'claude-opus-5[1m]',
      usage: { inputTokens: 2, outputTokens: 5 },
    })
  })

  it('records the CLI version the stream’s init event names, alongside the model', async () => {
    // claude 2.1.x serializes its whole build-info object into the init
    // event's claude_code_version; the version is a field of it.
    const stream = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 's-obs',
        model: 'claude-opus-5[1m]',
        claude_code_version: { PACKAGE_URL: '@anthropic-ai/claude-code', VERSION: '2.1.263', GIT_SHA: '37ae3f3' },
      }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }),
      JSON.stringify({ type: 'result', is_error: false, session_id: 's-obs', usage: { input_tokens: 2, output_tokens: 5 } }),
    ].join('\n')
    const { provider, settled } = await mountObserved({ stream })
    const run = await provider.start(OBS_REQUEST)
    await run.result
    await vi.waitFor(() => { expect(settled).toHaveBeenCalledTimes(1) })
    expect(settled).toHaveBeenCalledWith(expect.any(String), {
      observedModel: 'claude-opus-5[1m]',
      cliVersion: '2.1.263',
      usage: { inputTokens: 2, outputTokens: 5 },
    })
  })

  it('leaves observedModel absent when the stream names no model', async () => {
    const { provider, settled } = await mountObserved({ stream: PLAIN_STREAM })
    const run = await provider.start(OBS_REQUEST)
    await run.result
    await vi.waitFor(() => { expect(settled).toHaveBeenCalledTimes(1) })
    expect(settled).toHaveBeenCalledWith(expect.any(String), { usage: { inputTokens: 2, outputTokens: 5 } })
  })

  it('spawns the fresh round in the staged cwd override and records it', async () => {
    const { provider, records, spawnSpecs } = await mountObserved({
      stream: PLAIN_STREAM,
      intent: { kind: 'fresh', cwd: '/cell-a' },
    })
    const run = await provider.start(OBS_REQUEST)
    await run.result
    expect(spawnSpecs[0]?.cwd).toBe('/cell-a')
    await vi.waitFor(() => { expect(records).toHaveBeenCalled() })
    expect(records.mock.calls[0]?.[0]).toMatchObject({ cliSessionId: 's-obs', cwd: '/cell-a' })
  })

  it('rejects a resume whose cwd differs from the recorded first-round cwd', async () => {
    const { provider } = await mountObserved({
      stream: PLAIN_STREAM,
      intent: { kind: 'resume', childSessionId: 'child-1', cliSessionId: 's1', cwd: '/elsewhere' },
      recorded: { childSessionId: 'child-1', provider: 'claude-local', parentSessionId: 'parent-1', cliSessionId: 's1', cwd: '/tmp' },
    })
    await expect(provider.start(OBS_REQUEST)).rejects.toThrow(/differs from the first round's/)
  })

  it('accepts a resume repeating the recorded first-round cwd', async () => {
    const { provider, spawnSpecs } = await mountObserved({
      stream: PLAIN_STREAM,
      intent: { kind: 'resume', childSessionId: 'child-1', cliSessionId: 's1', cwd: '/tmp' },
      recorded: { childSessionId: 'child-1', provider: 'claude-local', parentSessionId: 'parent-1', cliSessionId: 's1', cwd: '/tmp' },
    })
    const run = await provider.start(OBS_REQUEST)
    await run.result
    expect(spawnSpecs[0]?.cwd).toBe('/tmp')
  })
})
