import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { parseCodexJsonStream, CodexCliProvider, startCodexCliRun } from '../src/codex-cli-provider.ts'

/** The NDJSON event stream a real `codex exec --json` emits for one run. */
const jsonStream = [
  { type: 'thread.started', thread_id: 't1' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Task complete.' } },
  { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 6, output_tokens: 4 } },
].map(event => JSON.stringify(event)).join('\n')

/** A stub child that emits the NDJSON stream then exits 0. */
function stubChild(): { handle: SubprocessHandle; done: Promise<unknown> } {
  const stdout = new Readable({ read() {} })
  stdout.push(jsonStream + '\n')
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
      stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done,
    terminate: () => undefined,
    waitForExit: async () => true,
  }
  return { handle, done }
}

describe('codex json stream parsing', () => {
  it('extracts the final agent message and the turn usage with uncached input', () => {
    const parsed = parseCodexJsonStream(jsonStream)
    expect(parsed.text).toBe('Task complete.')
    // codex's input_tokens includes cache hits, so the uncached bucket is the
    // remainder (10 - 6) and the cache-read bucket carries the subset.
    expect(parsed.usage).toEqual({ inputTokens: 4, outputTokens: 4, cacheReadTokens: 6 })
    expect(parsed.lines).toEqual([{ kind: 'text', text: 'Task complete.' }])
  })

  it('tolerates a stream with no usable events', () => {
    expect(parseCodexJsonStream('not-json\n{"type":"other"}')).toEqual({ lines: [] })
  })

  it('mirrors reasoning, agent text, and command execution from the real fixture', () => {
    const fixture = readFileSync(
      fileURLToPath(new URL('./fixtures/command-execution.sample.ndjson', import.meta.url)),
      'utf8',
    )
    const parsed = parseCodexJsonStream(fixture)
    expect(parsed.threadId).toBeTruthy()
    // agent_message (plan), command_execution (Bash), agent_message (final).
    const kinds = parsed.lines.map(line => line.kind)
    expect(kinds).toEqual(['text', 'tool', 'text'])
    expect(parsed.lines[0]).toMatchObject({ kind: 'text' })
    const command = parsed.lines[1]
    expect(command).toMatchObject({ kind: 'tool', name: 'Bash' })
    if (command.kind === 'tool' && command.detail !== undefined) {
      expect(command.detail).toContain('hello.txt')
    }
    // the final agent_message is the run output
    expect(parsed.text).toContain('hello.txt')
  })

  it('parses an agent-message-only fixture without tool events', () => {
    const fixture = readFileSync(
      fileURLToPath(new URL('./fixtures/agent-message.sample.ndjson', import.meta.url)),
      'utf8',
    )
    const parsed = parseCodexJsonStream(fixture)
    expect(parsed.lines).toEqual([{ kind: 'text', text: '1597' }])
    expect(parsed.text).toBe('1597')
  })
})

describe('codex-cli-provider run settlement', () => {
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

    const run = await startCodexCliRun(request, {
      cwd: '/tmp',
      env: { CODEX_HOME: '/tmp/codex-home' },
      sandbox: 'workspace-write',
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
      expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
    })
    // the response was appended as one assistant message carrying the usage
    const assistant = child.events.filter(event => event.type === 'assistant/message')
    expect(assistant[0]!.data.message.content).toEqual([{ type: 'text', text: 'Task complete.' }])
    expect(assistant[0]!.data.usage).toEqual({ inputTokens: 4, outputTokens: 4, cacheReadTokens: 6 })
    // the turn opened at spawn and closed at settle, bracketing the run
    const turns = child.events.filter(event => event.type === 'turn/start' || event.type === 'turn/end')
    expect(turns.map(event => event.type)).toEqual(['turn/start', 'turn/end'])
    expect(turns[1]!.data).toEqual({ turn: 1, reason: { kind: 'completed' } })
    // The live mirror persists during the run; the settle mirror persists the
    // final event set (with turn/end) after exit — wait for that last write.
    await vi.waitFor(() => {
      expect(append).toHaveBeenCalledWith(child.id, child.events)
    })
    await done
  })

  it('mirrors the NDJSON stream live during the run and settles without duplicates', async () => {
    const child = Session.create(SessionId('child-live-codex'))
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
      pid: 4245,
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

    const run = await startCodexCliRun(request, {
      cwd: '/tmp',
      env: { CODEX_HOME: '/tmp/codex-home' },
      sandbox: 'workspace-write',
      disposeGraceMs: 3_000,
      spawn: () => handle,
      childSession: child,
      ctx,
    })

    const emit = (...events: unknown[]): void => {
      stdout.push(events.map(event => JSON.stringify(event)).join('\n') + '\n')
    }
    // First item only: the last line is held back until the terminal event
    // (it is the usage carrier), so nothing is mirrored yet.
    emit(
      { type: 'thread.started', thread_id: 't1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: '调查一下' } },
    )

    // A second item un-holds the first: the user prompt and the first reply
    // mirror while the process is STILL running.
    emit({ type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'ls', aggregated_output: 'a.txt' } })
    await vi.waitFor(() => {
      expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
    })
    expect(child.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(reports.some(report => report.progress.kind === 'delta' && report.progress.text === '调查一下')).toBe(true)

    // The terminal event flushes the held lines, usage riding the final one.
    emit(
      { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Task complete.' } },
      { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 6, output_tokens: 4 } },
    )
    await vi.waitFor(() => {
      expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(2)
    })
    // The command_execution item mirrors as a native tool/call + tool/result
    // pair, paired by the stream item id.
    const calls = child.events.filter(event => event.type === 'tool/call')
    expect(calls).toHaveLength(1)
    expect((calls[0]!.data as { callId: string; name: string; arguments: string }))
      .toMatchObject({ callId: 'item_1', name: 'Bash', arguments: 'ls' })
    const results = child.events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect((results[0]!.data as { message: { content: { toolCallId: string; content: unknown }[] } }).message.content[0])
      .toMatchObject({ toolCallId: 'item_1', content: [{ type: 'text', text: 'a.txt' }] })

    // Settle: the live mirror already covered the stream — no duplicates.
    finish({ exitCode: 0, signal: null })
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => {
      expect(reports.some(report => report.progress.kind === 'mirror' && report.progress.mirroredLines === 3)).toBe(true)
    })
    const assistant = child.events.filter(event => event.type === 'assistant/message')
    const texts = assistant.map(event => JSON.stringify((event.data as { message: { content: unknown } }).message.content))
    expect(new Set(texts).size).toBe(texts.length)
    expect(child.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(child.events.filter(event => event.type === 'tool/call')).toHaveLength(1)
    expect((assistant[1]!.data as { usage?: unknown }).usage).toEqual({ inputTokens: 4, outputTokens: 4, cacheReadTokens: 6 })
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
    const run = await startCodexCliRun(
      { prompt: [{ type: 'text', text: 'x' }], parent: { session: { header: { cwd: '/tmp' } } }, signal: new AbortController().signal } as unknown as SubagentStartRequest,
      { cwd: '/tmp', env: {}, sandbox: 'workspace-write', disposeGraceMs: 3_000, spawn: () => handle, childSession: child },
    )
    const result = await run.result
    expect(result.stopReason).toBe('error')
    // The timing window must close even on failure, with an error reason.
    const turnEnd = child.events.find(event => event.type === 'turn/end')
    const endData = turnEnd?.data as { turn?: number; reason?: { kind?: string; error?: { message?: string; code?: string } } } | undefined
    expect(endData?.turn).toBe(1)
    expect(endData?.reason?.kind).toBe('error')
    expect(endData?.reason?.error?.message).toContain('exited with code 1')
    expect(endData?.reason?.error?.code).toBe('UNKNOWN')
    await done
  })

  it('reports auth-shaped failures through onAuthFailure', async () => {
    const done = Promise.resolve({ exitCode: 1, signal: null })
    const authFailures: string[] = []
    const handle: SubprocessHandle = {
      pid: 4244,
      stdin: undefined,
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      collected: {
        stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: 'Error: 401 Unauthorized — access token expired\n', nextOffset: 0, lossy: false }) },
      },
      done,
      terminate: () => undefined,
      waitForExit: async () => true,
    }
    const run = await startCodexCliRun(
      { prompt: [{ type: 'text', text: 'x' }], parent: { session: { header: { cwd: '/tmp' } } }, signal: new AbortController().signal } as unknown as SubagentStartRequest,
      { cwd: '/tmp', env: {}, sandbox: 'workspace-write', disposeGraceMs: 3_000, spawn: () => handle, onAuthFailure: detail => authFailures.push(detail) },
    )
    expect((await run.result).stopReason).toBe('error')
    // Auth detection runs on the post-exit chain (after streams drain).
    await vi.waitFor(() => { expect(authFailures).toHaveLength(1) })
    expect(authFailures[0]).toContain('401')
    await done
  })

  it('does not report non-auth failures through onAuthFailure', async () => {
    const done = Promise.resolve({ exitCode: 1, signal: null })
    const authFailures: string[] = []
    const handle: SubprocessHandle = {
      pid: 4245,
      stdin: undefined,
      stdout: Readable.from([]),
      stderr: Readable.from(['Error: sandbox denied the write\n']),
      collected: {
        stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done,
      terminate: () => undefined,
      waitForExit: async () => true,
    }
    const run = await startCodexCliRun(
      { prompt: [{ type: 'text', text: 'x' }], parent: { session: { header: { cwd: '/tmp' } } }, signal: new AbortController().signal } as unknown as SubagentStartRequest,
      { cwd: '/tmp', env: {}, sandbox: 'workspace-write', disposeGraceMs: 3_000, spawn: () => handle, onAuthFailure: detail => authFailures.push(detail) },
    )
    expect((await run.result).stopReason).toBe('error')
    expect(authFailures).toHaveLength(0)
    await done
  })

  it('settles error when the CLI exits 0 with an empty stream (silent failure, not success)', async () => {
    const done = Promise.resolve({ exitCode: 0, signal: null })
    const child = Session.create(SessionId('child-empty-codex'))
    const ctx = new Context()
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    const errors: string[] = []
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
    const run = await startCodexCliRun(
      { prompt: [{ type: 'text', text: 'x' }], parent: { session: { header: { cwd: '/tmp' } } }, signal: new AbortController().signal } as unknown as SubagentStartRequest,
      {
        cwd: '/tmp', env: {}, sandbox: 'workspace-write', disposeGraceMs: 3_000,
        spawn: () => handle, childSession: child, ctx,
        onError: (error: Error) => { errors.push(error.message) },
      },
    )
    const result = await run.result
    // A zero exit with no parsed answer is an ERROR, never an empty success.
    expect(result.stopReason).toBe('error')
    expect(result.output).toEqual([])
    const turnEnd = child.events.find(event => event.type === 'turn/end')
    const endData = turnEnd?.data as { reason?: { kind?: string; error?: { message?: string } } } | undefined
    expect(endData?.reason?.kind).toBe('error')
    // The format-drift warning fired exactly once for the whole run, and the
    // empty-answer throw separately flattened through onError.
    expect(errors.filter(message => message.includes('parsed no codex events'))).toHaveLength(1)
    expect(errors.filter(message => message.includes('produced no answer'))).toHaveLength(1)
    await done
  })
})

describe('codex-cli-provider child session record', () => {
  it('creates an origin-subagent child carrying the resolved descriptor', async () => {
    const ctx = new Context()
    interface CreatedRecord {
      id: SessionId
      meta: { cwd?: string; parentSession?: SessionId; origin?: string; delegationDepth?: number }
      session: Session
    }
    const created: CreatedRecord[] = []
    ctx.provide('sessions', {
      create: (id: SessionId, options: { meta?: CreatedRecord['meta'] }) => {
        const session = Session.create(id)
        created.push({ id, meta: options.meta ?? {}, session })
        return session
      },
    } as never)
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/codex-home',
      get: () => ({ displayName: 'Codex' }),
      takeDelegationIntent: () => undefined,
      recordDelegation: () => {},
      getDelegation: () => undefined,
      recordRoundSettled: () => {},
      setKimiMirroredLines: () => {},
      kimiMirroredLines: () => undefined,
    } as never)
    ctx.provide('subprocess', { spawn: () => { throw new Error('not spawned in record test') } } as never)
    ctx.provide('logger', { warn: () => {} } as never)

    const provider = new CodexCliProvider(ctx)
    const request = {
      label: 'Codex 建文件',
      prompt: [{ type: 'text', text: '建个文件' }],
      parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp', delegationDepth: 0 } } },
      signal: new AbortController().signal,
      descriptor: { version: 2, mode: 'one-shot', provider: 'codex-local', label: 'Codex 建文件' },
    } as unknown as Parameters<CodexCliProvider['start']>[0]

    await expect(provider.start(request)).rejects.toThrow(/not spawned/)
    expect(created).toHaveLength(1)
    expect(created[0]!.meta).toEqual({
      cwd: '/tmp',
      parentSession: SessionId('parent-1'),
      origin: 'subagent',
      delegationDepth: 1,
    })
    const descriptor = created[0]!.session.events.find(event => event.type === 'subagent/descriptor')
    expect(descriptor?.data).toEqual({ version: 2, mode: 'one-shot', provider: 'codex-local', label: 'Codex: Codex 建文件' })
  })
})

describe('codex-cli-provider resume round', () => {
  it('spawns codex exec --json resume <thread_id> into the existing child session with the next turn', async () => {
    const ctx = new Context()
    const child = Session.create(SessionId('child-run-1'))
    child.append('subagent/descriptor', {
      version: 2, mode: 'one-shot', provider: 'codex-local', label: 'Codex: 建个文件',
    })
    child.append('turn/start', { turn: 1 })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ctx.provide('sessions', { get: (id: SessionId) => (id === SessionId('child-run-1') ? child : undefined) } as never)
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/codex-home',
      get: () => ({ displayName: 'Codex' }),
      takeDelegationIntent: () => ({
        kind: 'resume',
        childSessionId: 'child-run-1',
        cliSessionId: 't1',
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

    const provider = new CodexCliProvider(ctx, 'read-only')
    const request = {
      label: '继续',
      prompt: [{ type: 'text', text: '接着做' }],
      parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
      descriptor: { version: 2, mode: 'one-shot', provider: 'codex-local', label: '继续' },
    } as unknown as Parameters<CodexCliProvider['start']>[0]

    const run = await provider.start(request)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(spawned[0]).toEqual(['codex', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', 'resume', 't1', '接着做'])
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
      homeDir: () => '/tmp/codex-home',
      takeDelegationIntent: () => ({
        kind: 'resume',
        childSessionId: 'child-gone',
        cliSessionId: 't1',
      }),
      recordDelegation: () => {},
      getDelegation: () => undefined,
      acquireResumeLock: () => true,
      releaseResumeLock: () => {},
    } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)

    const provider = new CodexCliProvider(ctx)
    const request = {
      label: '继续',
      prompt: [{ type: 'text', text: '接着做' }],
      parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
    } as unknown as Parameters<CodexCliProvider['start']>[0]

    await expect(provider.start(request)).rejects.toThrow(/is not live/)
  })
})

describe('codex-cli-provider resume lock', () => {
  it('rejects a concurrent second resume of the same child with no CLI spawn', async () => {
    const ctx = new Context()
    const child = Session.create(SessionId('child-run-1'))
    child.append('subagent/descriptor', {
      version: 2, mode: 'one-shot', provider: 'codex-local', label: 'Codex: 建个文件',
    })
    child.append('turn/start', { turn: 1 })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ctx.provide('sessions', { get: (id: SessionId) => (id === SessionId('child-run-1') ? child : undefined) } as never)
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    let locked: string | undefined
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/codex-home',
      get: () => ({ displayName: 'Codex' }),
      takeDelegationIntent: () => ({
        kind: 'resume',
        childSessionId: 'child-run-1',
        cliSessionId: 't1',
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
        stdout.push(jsonStream + '\n')
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

    const provider = new CodexCliProvider(ctx, 'read-only')
    const request = {
      label: '继续',
      prompt: [{ type: 'text', text: '接着做' }],
      parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
    } as unknown as Parameters<CodexCliProvider['start']>[0]

    const first = await provider.start(request)
    await expect(provider.start(request)).rejects.toThrow(/有进行中的委派/)
    expect(spawned).toBe(1)
    ctx.localAgent.releaseResumeLock('child-run-1')
    expect(locked).toBeUndefined()
  })
})

describe('codex-cli-provider abort path', () => {
  /**
   * A 10-minute fake CLI that never exits on its own: emits a partial NDJSON
   * stream (a thread.started plus a command item), then hangs until
   * terminate() releases its `done`.
   */
  function hangingChild(): {
    handle: SubprocessHandle
    done: Promise<{ exitCode: number; signal: null }>
    terminated: () => boolean
  } {
    return hangingChildWith([
      { type: 'thread.started', thread_id: 't-abort' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: '我先创建一个文件。' } },
      { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'echo hi > hi.txt', aggregated_output: '' } },
    ])
  }

  /** The fake CLI, emitting a caller-chosen partial NDJSON stream. */
  function hangingChildWith(events: unknown[]): {
    handle: SubprocessHandle
    done: Promise<{ exitCode: number; signal: null }>
    terminated: () => boolean
  } {
    const partialStream = events.map(event => JSON.stringify(event)).join('\n')
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
    // Emit the partial stream right after the provider attaches its 'data'
    // listener (a real process writes soon after spawn), then hang. nextTick
    // fires before the test's abort path completes, so the collected output
    // already holds the partial stream when the abort mirror reads it.
    process.nextTick(() => {
      stdout.push(partialStream + '\n')
      stdout.push(null)
    })
    return { handle, done, terminated: () => terminated }
  }

  /**
   * A scoped home whose sessions tree holds one rollout file for the fake
   * run's thread, ending with the token_count codex writes at turn boundaries
   * (including interrupted turns). The recorded usage is the number the
   * fallback must attach to the aborted child session. The file is stamped
   * NOW (the test's spawn moment), so the time-window fallback matches too.
   */
  function homeWithRollout(threadId: string): string {
    const home = mkdtempSync(join(tmpdir(), 'codex-abort-rollout-'))
    const now = new Date()
    const dir = join(home, 'sessions', '2026', '08', '16')
    mkdirSync(dir, { recursive: true })
    const stamp = now.toISOString().replace(/[:.]/g, '-')
    writeFileSync(join(dir, `rollout-${stamp}-${threadId}.jsonl`), [
      JSON.stringify({ type: 'session_meta', payload: { id: threadId, timestamp: now.toISOString(), cwd: '/tmp' } }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 25, total_tokens: 125 },
            total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 25, total_tokens: 125 },
          },
        },
      }),
      '',
    ].join('\n'))
    return home
  }

  it('settles the result immediately on abort and mirrors the partial NDJSON after the kill', async () => {
    const child = Session.create(SessionId('child-abort-codex'))
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

    const run = await startCodexCliRun(request, {
      cwd: '/tmp',
      env: { CODEX_HOME: '/tmp/codex-home' },
      sandbox: 'workspace-write',
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

    // The partial stream (reply text + command) is mirrored after the kill.
    await vi.waitFor(() => {
      expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
      // The killed stream's trailing command mirrors as a native tool/call
      // (no result — the kill landed first).
      expect(child.events.filter(event => event.type === 'tool/call')).toHaveLength(1)
    })
    const assistant = child.events.filter(event => event.type === 'assistant/message')
    expect(assistant[0]!.data.message.content).toEqual([{ type: 'text', text: '我先创建一个文件。' }])
    const calls = child.events.filter(event => event.type === 'tool/call')
    expect((calls[0]!.data as { name: string; arguments: string }))
      .toMatchObject({ name: 'Bash', arguments: 'echo hi > hi.txt' })
    await hanging.done
  })

  it('attaches the rollout file last token_count usage to a killed run (thread-id locator)', async () => {
    const home = homeWithRollout('t-abort')
    const child = Session.create(SessionId('child-abort-rollout'))
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

    const run = await startCodexCliRun(request, {
      cwd: '/tmp',
      env: { CODEX_HOME: home },
      sandbox: 'workspace-write',
      disposeGraceMs: 3_000,
      spawn: () => hanging.handle,
      childSession: child,
      ctx,
    })
    await new Promise(resolve => { setTimeout(resolve, 50) })
    controller.abort()
    expect((await run.result).stopReason).toBe('aborted')
    await run.dispose()

    // The abort mirror preserves the partial stream AND recovers the usage
    // codex wrote to the rollout file's last token_count (input 100 − cached
    // 40 = 60 uncached). The killed stream ends with the command, so the
    // carrier assistant message went out through the live mirror before the
    // usage was knowable — the recovery books it as a usage chunk pinned to
    // the carrier's step (the token projection counts it identically).
    await vi.waitFor(() => {
      const assistant = child.events.filter(event => event.type === 'assistant/message')
      expect(assistant).toHaveLength(1)
      const usageChunk = child.events.find(event =>
        event.type === 'assistant/chunk' && event.data.chunk.type === 'usage')
      expect(usageChunk?.data.chunk.usage).toEqual({ inputTokens: 60, outputTokens: 25, cacheReadTokens: 40 })
    })
    await hanging.done
  })

  it('reaches the same usage via the time window when a kill truncated the stream before thread.started', async () => {
    const home = homeWithRollout('t-window')
    const child = Session.create(SessionId('child-abort-window'))
    const ctx = new Context()
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    // No thread.started in the stream: the locator falls back to the spawn
    // time window and still finds the run's rollout file.
    const hanging = hangingChildWith([
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: '部分结果' } },
    ])

    const controller = new AbortController()
    const request = {
      prompt: [{ type: 'text', text: '建个文件' }],
      parent: { session: { header: { cwd: '/tmp' } } },
      signal: controller.signal,
    } as unknown as SubagentStartRequest

    const run = await startCodexCliRun(request, {
      cwd: '/tmp',
      env: { CODEX_HOME: home },
      sandbox: 'workspace-write',
      disposeGraceMs: 3_000,
      spawn: () => hanging.handle,
      childSession: child,
      ctx,
    })
    await new Promise(resolve => { setTimeout(resolve, 50) })
    controller.abort()
    expect((await run.result).stopReason).toBe('aborted')
    await run.dispose()

    await vi.waitFor(() => {
      const assistant = child.events.filter(event => event.type === 'assistant/message')
      expect(assistant).toHaveLength(1)
      expect(assistant[0]!.data.usage).toEqual({ inputTokens: 60, outputTokens: 25, cacheReadTokens: 40 })
    })
    await hanging.done
  })
})

/** A stub child that emits a CUSTOM NDJSON stream then exits 0. */
function stubChildWith(stream: string): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push(stream + '\n')
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push('')
  stderr.push(null)
  return {
    pid: 4243,
    stdin: undefined,
    stdout,
    stderr,
    collected: {
      stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: new Promise((resolve) => { setImmediate(() => { resolve({ exitCode: 0, signal: null }) }) }),
    terminate: () => undefined,
    waitForExit: async () => true,
  }
}

/** Write a rollout file naming `model` in its turn_context line, keyed by thread id. */
function writeRollout(homeDir: string, threadId: string, model: string): void {
  const dir = join(homeDir, 'sessions', '2026', '09', '06')
  mkdirSync(dir, { recursive: true })
  const lines = [
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: threadId, cwd: '/tmp' } },
    { timestamp: new Date().toISOString(), type: 'turn_context', payload: { turn_id: 'turn-1', cwd: '/tmp', model } },
  ]
  writeFileSync(join(dir, `rollout-2026-09-06T00-00-00-${threadId}.jsonl`), lines.map(line => JSON.stringify(line)).join('\n') + '\n')
}

describe('codex-cli-provider observed model and cwd', () => {
  const OBS_REQUEST = {
    label: '任务',
    prompt: [{ type: 'text', text: '建个文件' }],
    parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp', delegationDepth: 0 } } },
    signal: new AbortController().signal,
    descriptor: { version: 2, mode: 'one-shot', provider: 'codex-local', label: '任务' },
  } as unknown as Parameters<CodexCliProvider['start']>[0]

  /** The real 0.144.0 wire shape: thread.started and turn.completed carry no model. */
  const PLAIN_STREAM = [
    { type: 'thread.started', thread_id: 't-obs' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'done' } },
    { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 4 } },
  ].map(event => JSON.stringify(event)).join('\n')

  /**
   * Mount a provider whose CLI prints `stream`, whose scoped home is a temp
   * dir (optionally seeded with a rollout), and whose staged intent and
   * recorded delegation come from the options.
   */
  async function mountObserved(options: {
    stream: string
    rollout?: (homeDir: string) => void
    intent?: unknown
    recorded?: Record<string, unknown> | undefined
  }) {
    const homeDir = mkdtempSync(join(tmpdir(), 'codex-obs-'))
    options.rollout?.(homeDir)
    const ctx = new Context()
    const records = vi.fn()
    const settled = vi.fn()
    const spawnSpecs: { argv: readonly string[]; cwd: string }[] = []
    const liveChild = Session.create(SessionId('child-1'))
    liveChild.append('subagent/descriptor', { version: 2, mode: 'one-shot', provider: 'codex-local', label: '任务' })
    liveChild.append('turn/start', { turn: 1 })
    liveChild.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ctx.provide('sessions', {
      create: (id: SessionId) => Session.create(id),
      get: (id: SessionId) => (id === SessionId('child-1') ? liveChild : undefined),
    } as never)
    ctx.provide('localAgent', {
      homeDir: () => homeDir,
      get: () => ({ displayName: 'Codex' }),
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
    return { provider: new CodexCliProvider(ctx, 'read-only'), records, settled, spawnSpecs }
  }

  it('records the stream-named model and the round usage on settle', async () => {
    const stream = [
      { type: 'thread.started', thread_id: 't-obs', model: 'gpt-5.6-sol' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'done' } },
      { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 4 } },
    ].map(event => JSON.stringify(event)).join('\n')
    const { provider, settled } = await mountObserved({ stream })
    const run = await provider.start(OBS_REQUEST)
    await run.result
    await vi.waitFor(() => { expect(settled).toHaveBeenCalledTimes(1) })
    // The observation rides the registry channel: model from the stream,
    // usage from turn.completed (uncached = 10 − 0).
    expect(settled).toHaveBeenCalledWith(expect.any(String), {
      observedModel: 'gpt-5.6-sol',
      usage: { inputTokens: 10, outputTokens: 4 },
    })
  })

  it('falls back to the rollout turn_context model when the stream names none', async () => {
    const { provider, settled } = await mountObserved({
      stream: PLAIN_STREAM,
      rollout: homeDir => { writeRollout(homeDir, 't-obs', 'gpt-5.6-sol') },
    })
    const run = await provider.start(OBS_REQUEST)
    await run.result
    await vi.waitFor(() => { expect(settled).toHaveBeenCalledTimes(1) })
    expect(settled).toHaveBeenCalledWith(expect.any(String), {
      observedModel: 'gpt-5.6-sol',
      usage: { inputTokens: 10, outputTokens: 4 },
    })
  })

  it('leaves observedModel absent when neither the stream nor a rollout names one', async () => {
    const { provider, settled } = await mountObserved({ stream: PLAIN_STREAM })
    const run = await provider.start(OBS_REQUEST)
    await run.result
    await vi.waitFor(() => { expect(settled).toHaveBeenCalledTimes(1) })
    // Absence is the honest observation — no model key, never a guess.
    expect(settled).toHaveBeenCalledWith(expect.any(String), { usage: { inputTokens: 10, outputTokens: 4 } })
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
    expect(records.mock.calls[0]?.[0]).toMatchObject({ cliSessionId: 't-obs', cwd: '/cell-a' })
  })

  it('rejects a resume whose cwd differs from the recorded first-round cwd', async () => {
    const { provider } = await mountObserved({
      stream: PLAIN_STREAM,
      intent: { kind: 'resume', childSessionId: 'child-1', cliSessionId: 't1', cwd: '/elsewhere' },
      recorded: { childSessionId: 'child-1', provider: 'codex-local', parentSessionId: 'parent-1', cliSessionId: 't1', cwd: '/tmp' },
    })
    await expect(provider.start(OBS_REQUEST)).rejects.toThrow(/differs from the first round's/)
  })

  it('accepts a resume repeating the recorded first-round cwd', async () => {
    const { provider, spawnSpecs } = await mountObserved({
      stream: PLAIN_STREAM,
      intent: { kind: 'resume', childSessionId: 'child-1', cliSessionId: 't1', cwd: '/tmp' },
      recorded: { childSessionId: 'child-1', provider: 'codex-local', parentSessionId: 'parent-1', cliSessionId: 't1', cwd: '/tmp' },
    })
    const run = await provider.start(OBS_REQUEST)
    await run.result
    expect(spawnSpecs[0]?.cwd).toBe('/tmp')
  })
})
