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
  })

  it('tolerates a stream with no usable events', () => {
    expect(parseCodexJsonStream('not-json\n{"type":"other"}')).toEqual({})
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
    // the response was appended as one assistant message carrying the usage
    const assistant = child.events.filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(1)
    expect(assistant[0]!.data.message.content).toEqual([{ type: 'text', text: 'Task complete.' }])
    expect(assistant[0]!.data.usage).toEqual({ inputTokens: 4, outputTokens: 4, cacheReadTokens: 6 })
    // the turn opened at spawn and closed at settle, bracketing the run
    const turns = child.events.filter(event => event.type === 'turn/start' || event.type === 'turn/end')
    expect(turns.map(event => event.type)).toEqual(['turn/start', 'turn/end'])
    expect(turns[1]!.data).toEqual({ turn: 1, reason: { kind: 'completed' } })
    expect(append).toHaveBeenCalledWith(child.id, child.events)
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
    expect(spawned[0]).toEqual(['codex', 'exec', '--sandbox', 'read-only', '--json', 'resume', 't1', '接着做'])
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
