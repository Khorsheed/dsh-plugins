import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { parseClaudeJsonResult, startClaudeCliRun, ClaudeCliProvider } from '../src/claude-cli-provider.ts'

/** The single JSON line a real `claude -p --output-format json` emits. */
const jsonResult = JSON.stringify({
  type: 'result',
  subtype: 'success',
  result: 'Task complete.',
  usage: { input_tokens: 2, output_tokens: 5, cache_read_input_tokens: 6, cache_creation_input_tokens: 7 },
  session_id: 's1',
})

/** A stub child that emits the JSON result then exits 0. */
function stubChild(): { handle: SubprocessHandle; done: Promise<unknown> } {
  const stdout = new Readable({ read() {} })
  stdout.push(jsonResult + '\n')
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

describe('claude json result parsing', () => {
  it('extracts the final answer and the usage buckets', () => {
    const parsed = parseClaudeJsonResult(jsonResult)
    expect(parsed.text).toBe('Task complete.')
    // claude's input_tokens is uncached; cache read/creation map to their
    // own buckets with no subtraction.
    expect(parsed.usage).toEqual({ inputTokens: 2, outputTokens: 5, cacheReadTokens: 6, cacheWriteTokens: 7 })
  })

  it('tolerates malformed output and reports is_error', () => {
    expect(parseClaudeJsonResult('not-json')).toEqual({})
    expect(parseClaudeJsonResult(JSON.stringify({ is_error: true, error: 'boom' }))).toEqual({ error: 'boom' })
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
    const assistant = child.events.filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(1)
    expect(assistant[0]!.data.message.content).toEqual([{ type: 'text', text: 'Task complete.' }])
    expect(assistant[0]!.data.usage).toEqual({ inputTokens: 2, outputTokens: 5, cacheReadTokens: 6, cacheWriteTokens: 7 })
    const turns = child.events.filter(event => event.type === 'turn/start' || event.type === 'turn/end')
    expect(turns.map(event => event.type)).toEqual(['turn/start', 'turn/end'])
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
    expect(spawned[0]).toEqual(['claude', '-p', '--dangerously-skip-permissions', '--resume', 's1', '--output-format', 'json', '接着做'])
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
        stdout.push(jsonResult + '\n')
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
