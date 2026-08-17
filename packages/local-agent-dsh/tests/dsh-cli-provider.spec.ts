/**
 * The dsh CLI provider: fresh `--session-id` spawns, credential/DSH_HOME env
 * injection through the explicit env layer, resume `--resume` spawns, silent
 * failure and abort settlement.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { LocalAgentDelegationIntent } from '@khorsheed/dsh-local-agent'
import { describe, expect, it, vi } from 'vitest'
import { DshCliProvider } from '../src/dsh-cli-provider.ts'

/** A stub child that prints the final answer, then exits 0. */
function stubChild(): { handle: SubprocessHandle; done: Promise<unknown> } {
  const stdout = new Readable({ read() {} })
  stdout.push('final answer\n')
  stdout.push(null)
  const stderr = new Readable({ read() {} })
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

interface Capture {
  argv?: readonly string[]
  env?: Readonly<Record<string, string>>
  cwd?: string
}

/** Mount a fake ctx carrying the services the provider reads. */
function mount(options: {
  key?: string
  spawn?: (spec: { argv: readonly string[]; env: Readonly<Record<string, string>>; cwd: string }) => SubprocessHandle
  intent?: LocalAgentDelegationIntent
  liveChild?: Session
  lockAcquired?: boolean
}): {
  ctx: Context
  homeDir: string
  capture: Capture
  records: ReturnType<typeof vi.fn>
  locks: { acquired: string[]; released: string[] }
} {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-provider-'))
  const capture: Capture = {}
  const records = vi.fn()
  const locks = { acquired: [] as string[], released: [] as string[] }
  const ctx = new Context()
  ctx.provide('localAgent', {
    homeDir: () => homeDir,
    takeDelegationIntent: () => options.intent,
    recordDelegation: records,
    get: () => undefined,
    acquireResumeLock: (id: string) => {
      locks.acquired.push(id)
      return options.lockAcquired ?? true
    },
    releaseResumeLock: (id: string) => { locks.released.push(id) },
  })
  ctx.provide('subprocess', {
    spawn: (spec: { argv: readonly string[]; env: Readonly<Record<string, string>>; cwd: string }) => {
      capture.argv = spec.argv
      capture.env = spec.env
      capture.cwd = spec.cwd
      return (options.spawn ?? (() => stubChild().handle))(spec)
    },
  })
  ctx.provide('credentials', {
    resolve: async () => (options.key === undefined ? undefined : { value: options.key, source: 'env' }),
  })
  ctx.provide('sessions', {
    create: (id: string) => options.liveChild ?? Session.create(SessionId(id)),
    get: () => options.liveChild,
  })
  ctx.provide('logger', { warn: () => {}, info: () => {} })
  return { ctx, homeDir, capture, records, locks }
}

/** The resolved request shape the provider consumes. */
function request(over: Partial<{ prompt: string; cwd: string; signal: AbortSignal }> = {}): unknown {
  return {
    prompt: [{ type: 'text', text: over.prompt ?? '建个文件' }],
    parent: {
      session: {
        id: 'parent-1',
        header: over.cwd === undefined ? { cwd: '/tmp' } : (over.cwd === null ? {} : { cwd: over.cwd }),
      },
    },
    descriptor: { description: '测试委派' },
    signal: over.signal ?? new AbortController().signal,
  }
}

describe('dsh-cli-provider fresh run', () => {
  it('spawns the sub-dsh with the caller session id, scoped DSH_HOME and injected key, and records the identity mapping', async () => {
    const { ctx, capture, records, homeDir } = mount({ key: 'sk-test' })
    const provider = new DshCliProvider(ctx, {})
    const run = await provider.start(request() as never)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'final answer' }])
    // The sub-dsh session id IS the child session id, passed as --session-id.
    expect(capture.argv).toBeDefined()
    const argv = capture.argv as readonly string[]
    const sessionIndex = argv.indexOf('--session-id')
    expect(sessionIndex).toBeGreaterThan(-1)
    const sessionId = argv[sessionIndex + 1]!
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/)
    // Both the credential-shaped key and the DSH_* fact ride the explicit env
    // layer (the scrub would otherwise drop them).
    expect(capture.env).toEqual({ DSH_HOME: homeDir, DEEPSEEK_API_KEY: 'sk-test' })
    expect(capture.cwd).toBe('/tmp')
    expect(argv).toContain('--profile')
    expect(argv).toContain('headless-local-agent-dsh')
    expect(argv[argv.length - 1]).toBe('建个文件')
    // The delegation record maps the child session to the SAME sub-dsh id.
    expect(records).toHaveBeenCalledWith({
      childSessionId: sessionId,
      provider: 'dsh-cli',
      parentSessionId: 'parent-1',
      cliSessionId: sessionId,
    })
    await run.dispose()
  })

  it('rejects a parent session with no working directory', async () => {
    const { ctx } = mount({ key: 'sk-test' })
    const provider = new DshCliProvider(ctx, {})
    await expect(provider.start(request({ cwd: null }) as never)).rejects.toThrow('no working directory')
  })

  it('fails loud before spawning when the credential is unconfigured', async () => {
    const { ctx, capture } = mount({ key: undefined })
    const provider = new DshCliProvider(ctx, {})
    await expect(provider.start(request() as never)).rejects.toThrow('DEEPSEEK_API_KEY is not configured')
    expect(capture.argv).toBeUndefined()
  })

  it('settles error when the sub-dsh exits 0 with no printed answer (silent failure, not success)', async () => {
    const empty = new Readable({ read() {} })
    empty.push(null)
    const done = Promise.resolve({ exitCode: 0, signal: null })
    const handle: SubprocessHandle = {
      pid: 4243,
      stdin: undefined,
      stdout: empty,
      stderr: empty,
      collected: {
        stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done,
      terminate: () => undefined,
      waitForExit: async () => true,
    }
    const { ctx } = mount({ key: 'sk-test', spawn: () => handle })
    const provider = new DshCliProvider(ctx, {})
    const run = await provider.start(request() as never)
    const result = await run.result
    expect(result.stopReason).toBe('error')
    await run.dispose()
  })

  it('settles error when the sub-dsh exits non-zero', async () => {
    const empty = new Readable({ read() {} })
    empty.push(null)
    const done = Promise.resolve({ exitCode: 1, signal: null })
    const handle: SubprocessHandle = {
      pid: 4243,
      stdin: undefined,
      stdout: empty,
      stderr: empty,
      collected: {
        stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done,
      terminate: () => undefined,
      waitForExit: async () => true,
    }
    const { ctx } = mount({ key: 'sk-test', spawn: () => handle })
    const provider = new DshCliProvider(ctx, {})
    const run = await provider.start(request() as never)
    const result = await run.result
    expect(result.stopReason).toBe('error')
    await run.dispose()
  })
})

describe('dsh-cli-provider resume run', () => {
  it('spawns --resume with the recorded sub-dsh id, locks the child, and closes the next turn', async () => {
    const liveChild = Session.create(SessionId('child-1'))
    liveChild.append('turn/start', { turn: 1 })
    const { ctx, capture, locks, homeDir } = mount({
      key: 'sk-test',
      intent: { kind: 'resume', childSessionId: 'child-1', cliSessionId: 'child-1' },
      liveChild,
    })
    const provider = new DshCliProvider(ctx, {})
    const run = await provider.start(request({ prompt: '继续' }) as never)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    const argv = capture.argv as readonly string[]
    expect(argv).toContain('--resume')
    expect(argv[argv.indexOf('--resume') + 1]).toBe('child-1')
    expect(argv[argv.length - 1]).toBe('继续')
    expect(capture.env).toEqual({ DSH_HOME: homeDir, DEEPSEEK_API_KEY: 'sk-test' })
    expect(locks.acquired).toEqual(['child-1'])
    await run.result
    await vi.waitFor(() => {
      expect(locks.released).toEqual(['child-1'])
    })
    const turnEnd = liveChild.events.find(event => event.type === 'turn/end')
    const endData = turnEnd?.data as { turn?: number; reason?: { kind?: string } } | undefined
    expect(endData?.turn).toBe(2)
    expect(endData?.reason?.kind).toBe('completed')
    await run.dispose()
  })

  it('rejects a second concurrent resume of the same child', async () => {
    const liveChild = Session.create(SessionId('child-2'))
    liveChild.append('turn/start', { turn: 1 })
    const { ctx } = mount({
      key: 'sk-test',
      intent: { kind: 'resume', childSessionId: 'child-2', cliSessionId: 'child-2' },
      liveChild,
      lockAcquired: false,
    })
    const provider = new DshCliProvider(ctx, {})
    await expect(provider.start(request() as never)).rejects.toThrow('有进行中的委派')
  })

  it('rejects a resume whose child session is not live', async () => {
    const { ctx, locks } = mount({
      key: 'sk-test',
      intent: { kind: 'resume', childSessionId: 'child-3', cliSessionId: 'child-3' },
    })
    const provider = new DshCliProvider(ctx, {})
    await expect(provider.start(request() as never)).rejects.toThrow('is not live')
    expect(locks.released).toEqual(['child-3'])
  })
})

describe('dsh-cli-provider abort path', () => {
  /** A fake CLI that never exits on its own; terminate releases its `done`. */
  function hangingChild(): {
    handle: SubprocessHandle
    terminated: () => boolean
    done: Promise<{ exitCode: number; signal: null }>
  } {
    const stdout = new Readable({ read() {} })
    stdout.push('partial answer\n')
    stdout.push(null)
    const stderr = new Readable({ read() {} })
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
    return { handle, terminated: () => terminated, done }
  }

  it('settles the result immediately on abort; dispose owns the kill', async () => {
    const hanging = hangingChild()
    const controller = new AbortController()
    const { ctx } = mount({
      key: 'sk-test',
      spawn: () => hanging.handle,
    })
    const provider = new DshCliProvider(ctx, {})
    const run = await provider.start(request({ signal: controller.signal }) as never)
    const settledAt = Date.now()
    controller.abort()
    const result = await run.result
    const settleMs = Date.now() - settledAt
    expect(result.stopReason).toBe('aborted')
    expect(settleMs).toBeLessThan(1_000)
    // The abort must not have killed the child yet — dispose owns the kill.
    expect(hanging.terminated()).toBe(false)
    await run.dispose()
    expect(hanging.terminated()).toBe(true)
    await hanging.done
  })
})
