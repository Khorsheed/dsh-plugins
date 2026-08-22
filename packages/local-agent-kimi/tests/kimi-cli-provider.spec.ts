import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { KimiCliProvider, startKimiCliRun } from '../src/kimi-cli-provider.ts'

/** A stub child that prints the reply and its resume hint, then exits 0. */
function stubChild(sessionId: string): { handle: SubprocessHandle; done: Promise<unknown> } {
  // stdout/stderr bytes are pushed synchronously; `done` resolves on a later
  // tick so the data listeners run first, matching a real process's
  // data-before-exit order.
  const stdout = new Readable({ read() {} })
  stdout.push('• done\n')
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push(`kimi version 0.33.0\nTo resume this session: kimi -r session_${sessionId}\n`)
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

/** A kimi scoped home carrying one session's transcript. */
function wireHome(sessionId: string): string {
  const home = mkdtempSync(join(tmpdir(), 'kimi-provider-'))
  const dir = join(home, 'sessions', 'wd_tmp_abc', `session_${sessionId}`)
  mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
  writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), [
    JSON.stringify({ type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '建个文件' }] } }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '任务完成。' } } }),
  ].join('\n'))
  return home
}

describe('kimi-cli-provider run settlement', () => {
  it('settles completed and mirrors the transcript after the child exits', async () => {
    const homeDir = wireHome('run-1')
    const child = Session.create(SessionId('child-run-1'))
    const ctx = new Context()
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    const { handle, done } = stubChild('run-1')

    const request = {
      prompt: [{ type: 'text', text: '建个文件' }],
      parent: { session: { header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
    } as unknown as SubagentStartRequest

    const run = await startKimiCliRun(request, {
      cwd: '/tmp',
      env: { KIMI_CODE_HOME: homeDir },
      disposeGraceMs: 3_000,
      spawn: () => handle,
      childSession: child,
      homeDir,
      ctx,
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: '• done' }])
    // The mirror runs after the child exits (fire-and-forget), so let it
    // finish before asserting the transcript was appended.
    await vi.waitFor(() => {
      expect(child.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    })
    expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
    expect(append).toHaveBeenCalledWith(child.id, child.events)
    await done
  })

  it('reports the settle-time mirror as a mirror progress event', async () => {
    const homeDir = wireHome('run-progress-1')
    const child = Session.create(SessionId('child-run-progress-1'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', { create: async () => {}, append: async () => {} })
    const reportRunProgress = vi.fn()
    ctx.provide('localAgent', {
      setKimiMirroredLines: () => {},
      kimiMirroredLines: () => undefined,
      reportRunProgress,
    } as never)
    const { handle, done } = stubChild('run-progress-1')

    const request = {
      prompt: [{ type: 'text', text: '建个文件' }],
      parent: { session: { header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
    } as unknown as SubagentStartRequest

    const run = await startKimiCliRun(request, {
      cwd: '/tmp',
      env: { KIMI_CODE_HOME: homeDir },
      disposeGraceMs: 3_000,
      spawn: () => handle,
      childSession: child,
      homeDir,
      ctx,
    })
    expect((await run.result).stopReason).toBe('completed')
    // The report fires after the post-exit mirror; the fixture wire.jsonl has
    // two transcript lines.
    await vi.waitFor(() => {
      expect(reportRunProgress).toHaveBeenCalledWith(child.id, { kind: 'mirror', mirroredLines: 2 })
    })
    await done
  })

  it('mirrors transcript growth live during the run and settles without duplicates', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'kimi-live-'))
    const dir = join(homeDir, 'sessions', 'wd_tmp_abc', 'session_1ec0de')
    mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
    const wire = join(dir, 'agents', 'main', 'wire.jsonl')
    const userLine = JSON.stringify({ type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '建个文件' }] } })
    const thinkLine = JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'think', think: '先看看目录' } } })
    const textLine = JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '任务完成。' } } })
    writeFileSync(wire, `${userLine}\n${thinkLine}\n`)

    const child = Session.create(SessionId('child-live-1'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', { create: async () => {}, append: async () => {} })
    const offsets = new Map<string, number>()
    const reports: { id: string; progress: { kind: string; text?: string; mirroredLines?: number } }[] = []
    ctx.provide('localAgent', {
      kimiMirroredLines: (id: string) => offsets.get(id),
      setKimiMirroredLines: (id: string, lines: number) => { offsets.set(id, lines) },
      reportRunProgress: (id: string, progress: { kind: string; text?: string; mirroredLines?: number }) => {
        reports.push({ id, progress })
      },
    } as never)

    // A controllable child: streams stay open, done resolves when the test
    // finishes the process.
    const stdout = new Readable({ read() {} })
    const stderr = new Readable({ read() {} })
    let finish!: (outcome: { exitCode: number; signal: null }) => void
    const done = new Promise<{ exitCode: number; signal: null }>((resolve) => { finish = resolve })
    const handle: SubprocessHandle = {
      pid: 4244,
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
      prompt: [{ type: 'text', text: '建个文件' }],
      parent: { session: { header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
    } as unknown as SubagentStartRequest

    const run = await startKimiCliRun(request, {
      cwd: '/tmp',
      env: { KIMI_CODE_HOME: homeDir },
      disposeGraceMs: 3_000,
      spawn: () => handle,
      childSession: child,
      homeDir,
      ctx,
      liveMirrorIntervalMs: 20,
    })
    stderr.push('kimi version 0.33.0\nTo resume this session: kimi -r session_1ec0de\n')

    // A live poll mirrors the initial wire while the process is STILL running.
    await vi.waitFor(() => {
      expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
    })
    expect(reports.some(report => report.progress.kind === 'delta')).toBe(true)

    // The wire grows mid-run; the next poll mirrors only the new line.
    appendFileSync(wire, `${textLine}\n`)
    await vi.waitFor(() => {
      expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(2)
    })
    // Step numbering continues across live batches within the turn.
    const steps = child.events
      .filter(event => event.type === 'assistant/message')
      .map(event => (event.data as { step?: number }).step)
    expect(steps).toEqual([1, 2])

    // Settle: the live mirror already advanced the offset, so the final mirror
    // is a no-op — no duplicated messages.
    stdout.push('• done\n')
    stdout.push(null)
    finish({ exitCode: 0, signal: null })
    expect((await run.result).stopReason).toBe('completed')
    await vi.waitFor(() => {
      expect(reports.some(report => report.progress.kind === 'mirror' && report.progress.mirroredLines === 3)).toBe(true)
    })
    const texts = child.events
      .filter(event => event.type === 'assistant/message')
      .map(event => JSON.stringify((event.data as { message: { content: unknown } }).message.content))
    expect(new Set(texts).size).toBe(texts.length)
    expect(child.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(offsets.get(child.id)).toBe(3)
    await done
  })

  it('settles error and closes the turn with an error reason', async () => {
    const done = Promise.resolve({ exitCode: 1, signal: null })
    const child = Session.create(SessionId('child-kimi-error'))
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
    const run = await startKimiCliRun(
      { prompt: [{ type: 'text', text: 'x' }], parent: { session: { header: { cwd: '/tmp' } } }, signal: new AbortController().signal } as unknown as SubagentStartRequest,
      { cwd: '/tmp', env: {}, disposeGraceMs: 3_000, spawn: () => handle, childSession: child },
    )
    const result = await run.result
    expect(result.stopReason).toBe('error')
    // The timing window must close even on failure, with an error reason.
    const turnEnd = child.events.find(event => event.type === 'turn/end')
    const endData = turnEnd?.data as { turn?: number; reason?: { kind?: string; error?: { message?: string; code?: string } } } | undefined
    expect(endData?.turn).toBe(1)
    expect(endData?.reason?.kind).toBe('error')
    expect(endData?.reason?.error?.message).toBeTruthy()
    expect(endData?.reason?.error?.code).toBe('UNKNOWN')
    await done
  })

  it('reports auth-shaped failures through onAuthFailure', async () => {
    const done = Promise.resolve({ exitCode: 1, signal: null })
    const authFailures: string[] = []
    const handle: SubprocessHandle = {
      pid: 4246,
      stdin: undefined,
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      collected: {
        stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: 'Error: 401 Unauthorized\n', nextOffset: 0, lossy: false }) },
      },
      done,
      terminate: () => undefined,
      waitForExit: async () => true,
    }
    const run = await startKimiCliRun(
      { prompt: [{ type: 'text', text: 'x' }], parent: { session: { header: { cwd: '/tmp' } } }, signal: new AbortController().signal } as unknown as SubagentStartRequest,
      { cwd: '/tmp', env: {}, disposeGraceMs: 3_000, spawn: () => handle, onAuthFailure: detail => authFailures.push(detail) },
    )
    expect((await run.result).stopReason).toBe('error')
    // Auth detection runs on the post-exit chain (after streams drain).
    await vi.waitFor(() => { expect(authFailures).toHaveLength(1) })
    expect(authFailures[0]).toContain('401')
    await done
  })

  it('settles error when the CLI exits 0 with no printed answer (silent failure, not success)', async () => {
    const done = Promise.resolve({ exitCode: 0, signal: null })
    const child = Session.create(SessionId('child-empty-kimi'))
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
    const run = await startKimiCliRun(
      { prompt: [{ type: 'text', text: 'x' }], parent: { session: { header: { cwd: '/tmp' } } }, signal: new AbortController().signal } as unknown as SubagentStartRequest,
      { cwd: '/tmp', env: {}, disposeGraceMs: 3_000, spawn: () => handle, childSession: child },
    )
    const result = await run.result
    // A zero exit with no printed answer is an ERROR, never an empty success.
    expect(result.stopReason).toBe('error')
    expect(result.output).toEqual([])
    const turnEnd = child.events.find(event => event.type === 'turn/end')
    const endData = turnEnd?.data as { reason?: { kind?: string; error?: { message?: string } } } | undefined
    expect(endData?.reason?.kind).toBe('error')
    // The turn/end error message is a generic diagnostic; the real error text
    // (the empty-answer reason) settles through run.result instead.
    await done
  })
})

describe('kimi-cli-provider child session record', () => {
  it('creates an origin-subagent child carrying the resolved descriptor', async () => {
    const ctx = new Context()
    // The bundle does not inject `sessions`, so the provider must read the
    // service globally; the record degrades to a plain run when absent.
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
      homeDir: () => '/tmp/kimi-home',
      get: () => ({ displayName: 'Kimi Code' }),
      // No staged intent: the provider starts a fresh round.
      takeDelegationIntent: () => undefined,
      recordDelegation: () => {},
      setKimiMirroredLines: () => {},
      reportRunProgress: () => {},
      kimiMirroredLines: () => undefined,
    } as never)
    ctx.provide('subprocess', { spawn: () => { throw new Error('not spawned in record test') } } as never)
    ctx.provide('logger', { warn: () => {} } as never)

    const provider = new KimiCliProvider(ctx)
    const request = {
      label: 'Kimi 建文件',
      prompt: [{ type: 'text', text: '建个文件' }],
      parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp', delegationDepth: 0 } } },
      signal: new AbortController().signal,
      descriptor: { version: 2, mode: 'one-shot', provider: 'kimi-cli', label: 'Kimi 建文件' },
    } as unknown as Parameters<KimiCliProvider['start']>[0]

    await expect(provider.start(request)).rejects.toThrow(/not spawned/)
    expect(created).toHaveLength(1)
    // The meta the provider passes is what the real store folds into the
    // durable header that the 子代理 enumeration keys on.
    expect(created[0]!.meta).toEqual({
      cwd: '/tmp',
      parentSession: SessionId('parent-1'),
      origin: 'subagent',
      delegationDepth: 1,
    })
    const descriptor = created[0]!.session.events.find(event => event.type === 'subagent/descriptor')
    // The label carries the harness display name as the source marker.
    expect(descriptor?.data).toEqual({ version: 2, mode: 'one-shot', provider: 'kimi-cli', label: 'Kimi Code: Kimi 建文件' })
  })

  it('degrades to a plain run when the sessions service is absent', async () => {
    const ctx = new Context()
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/kimi-home',
      takeDelegationIntent: () => undefined,
      recordDelegation: () => {},
      setKimiMirroredLines: () => {},
      reportRunProgress: () => {},
      kimiMirroredLines: () => undefined,
    } as never)
    ctx.provide('subprocess', { spawn: () => { throw new Error('not spawned') } } as never)
    ctx.provide('logger', { warn: () => {} } as never)

    const provider = new KimiCliProvider(ctx)
    const request = {
      label: 'Kimi 建文件',
      prompt: [{ type: 'text', text: '建个文件' }],
      parent: { session: { id: SessionId('parent-2'), header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
      descriptor: { version: 2, mode: 'one-shot', provider: 'kimi-cli', label: 'Kimi 建文件' },
    } as unknown as Parameters<KimiCliProvider['start']>[0]

    await expect(provider.start(request)).rejects.toThrow(/not spawned/)
  })
})

describe('kimi-cli-provider resume round', () => {
  it('spawns kimi -S session_<id> -p into the existing child session with the next turn', async () => {
    const ctx = new Context()
    // Round 1 already created the child session with one completed turn.
    const child = Session.create(SessionId('child-run-1'))
    child.append('subagent/descriptor', {
      version: 2, mode: 'one-shot', provider: 'kimi-cli', label: 'Kimi Code: 建个文件',
    })
    child.append('turn/start', { turn: 1 })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const sessions = { get: (id: SessionId) => (id === SessionId('child-run-1') ? child : undefined) }
    ctx.provide('sessions', sessions as never)
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/kimi-home',
      get: () => ({ displayName: 'Kimi Code' }),
      takeDelegationIntent: () => ({
        kind: 'resume',
        childSessionId: 'child-run-1',
        cliSessionId: 'run-1',
      }),
      recordDelegation: () => {},
      setKimiMirroredLines: () => {},
      reportRunProgress: () => {},
      kimiMirroredLines: () => 2,
      acquireResumeLock: () => true,
      releaseResumeLock: () => {},
    } as never)

    const spawned: string[][] = []
    ctx.provide('subprocess', {
      spawn: (spec: { argv: string[] }) => {
        spawned.push(spec.argv)
        const { handle, done } = stubChild('run-1')
        return handle
      },
    } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)

    const provider = new KimiCliProvider(ctx)
    const request = {
      label: '继续',
      prompt: [{ type: 'text', text: '接着做' }],
      parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
      descriptor: { version: 2, mode: 'one-shot', provider: 'kimi-cli', label: '继续' },
    } as unknown as Parameters<KimiCliProvider['start']>[0]

    const run = await provider.start(request)
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    // The resume round continues the SAME kimi session with -S before -p.
    expect(spawned[0]).toEqual(['kimi', '-S', 'session_run-1', '-p', '接着做'])
    // The run id is the existing child session id, not a new one.
    expect(run.id).toBe(SessionId('child-run-1'))
    // Round 2 opens and closes its own turn (turn numbering increments).
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
      homeDir: () => '/tmp/kimi-home',
      takeDelegationIntent: () => ({
        kind: 'resume',
        childSessionId: 'child-gone',
        cliSessionId: 'run-1',
      }),
      recordDelegation: () => {},
      setKimiMirroredLines: () => {},
      reportRunProgress: () => {},
      kimiMirroredLines: () => undefined,
      acquireResumeLock: () => true,
      releaseResumeLock: () => {},
    } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)

    const provider = new KimiCliProvider(ctx)
    const request = {
      label: '继续',
      prompt: [{ type: 'text', text: '接着做' }],
      parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
    } as unknown as Parameters<KimiCliProvider['start']>[0]

    await expect(provider.start(request)).rejects.toThrow(/is not live/)
  })

  it('rejects a concurrent second resume of the same child with no CLI spawn', async () => {
    const ctx = new Context()
    const child = Session.create(SessionId('child-run-1'))
    child.append('subagent/descriptor', {
      version: 2, mode: 'one-shot', provider: 'kimi-cli', label: 'Kimi Code: 建个文件',
    })
    child.append('turn/start', { turn: 1 })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ctx.provide('sessions', { get: (id: SessionId) => (id === SessionId('child-run-1') ? child : undefined) } as never)
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    // A real registry holds the resume lock; the stub child never settles, so
    // the first resume keeps the lock while the second is attempted.
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/kimi-home',
      get: () => ({ displayName: 'Kimi Code' }),
      takeDelegationIntent: () => ({
        kind: 'resume',
        childSessionId: 'child-run-1',
        cliSessionId: 'run-1',
      }),
      recordDelegation: () => {},
      setKimiMirroredLines: () => {},
      reportRunProgress: () => {},
      kimiMirroredLines: () => 2,
      acquireResumeLock: (childSessionId: string) => {
        if (locked) return false
        locked = childSessionId
        return true
      },
      releaseResumeLock: () => { locked = undefined },
    } as never)
    let locked: string | undefined

    let spawned = 0
    ctx.provide('subprocess', {
      spawn: () => {
        spawned += 1
        // A child that never exits keeps the first resume's lock held.
        const stdout = new Readable({ read() {} })
        stdout.push('• done\n')
        stdout.push(null)
        const stderr = new Readable({ read() {} })
        stderr.push(`kimi version 0.33.0\nTo resume this session: kimi -r session_run-1\n`)
        stderr.push(null)
        const handle: SubprocessHandle = {
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
        return handle
      },
    } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)

    const provider = new KimiCliProvider(ctx)
    const request = {
      label: '继续',
      prompt: [{ type: 'text', text: '接着做' }],
      parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
    } as unknown as Parameters<KimiCliProvider['start']>[0]

    const first = await provider.start(request)
    // The first resume holds the lock; a second resume of the same child
    // fails loud with the in-flight message and spawns nothing.
    await expect(provider.start(request)).rejects.toThrow(/有进行中的委派/)
    expect(spawned).toBe(1)
    expect(locked).toBe('child-run-1')
    // Releasing the lock (as settle does) makes the child resumable again.
    ctx.localAgent.releaseResumeLock('child-run-1')
    expect(locked).toBeUndefined()
  })

  it('releases the resume lock on the settle path so a later resume succeeds', async () => {
    const ctx = new Context()
    const child = Session.create(SessionId('child-run-1'))
    child.append('subagent/descriptor', {
      version: 2, mode: 'one-shot', provider: 'kimi-cli', label: 'Kimi Code: 建个文件',
    })
    child.append('turn/start', { turn: 1 })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ctx.provide('sessions', { get: (id: SessionId) => (id === SessionId('child-run-1') ? child : undefined) } as never)
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    const releases: string[] = []
    ctx.provide('localAgent', {
      homeDir: () => '/tmp/kimi-home',
      get: () => ({ displayName: 'Kimi Code' }),
      takeDelegationIntent: () => ({
        kind: 'resume',
        childSessionId: 'child-run-1',
        cliSessionId: 'run-1',
      }),
      recordDelegation: () => {},
      setKimiMirroredLines: () => {},
      reportRunProgress: () => {},
      kimiMirroredLines: () => 2,
      acquireResumeLock: () => true,
      releaseResumeLock: (childSessionId: string) => { releases.push(childSessionId) },
    } as never)

    let spawned = 0
    ctx.provide('subprocess', {
      spawn: () => {
        spawned += 1
        const { handle, done } = stubChild('run-1')
        return handle
      },
    } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)

    const provider = new KimiCliProvider(ctx)
    const request = {
      label: '继续',
      prompt: [{ type: 'text', text: '接着做' }],
      parent: { session: { id: SessionId('parent-1'), header: { cwd: '/tmp' } } },
      signal: new AbortController().signal,
    } as unknown as Parameters<KimiCliProvider['start']>[0]

    const run = await provider.start(request)
    await run.result
    expect(spawned).toBe(1)
    // Settle released the lock exactly once for this child.
    expect(releases).toEqual(['child-run-1'])
    await run.dispose()
  })
})

describe('kimi-cli-provider abort path', () => {
  /**
   * A 10-minute fake CLI that never exits on its own: emits some stdout/stderr
   * (content kimi would have produced), then hangs until terminate() releases
   * its `done`. Mirrors a long-running LLM request the parent round aborts.
   */
  function hangingChild(sessionId: string): {
    handle: SubprocessHandle
    done: Promise<{ exitCode: number; signal: null }>
    resolveDone: (outcome: { exitCode: number; signal: null }) => void
    terminated: () => boolean
  } {
    const stdout = new Readable({ read() {} })
    stdout.push('• partial answer\n')
    stdout.push(null)
    const stderr = new Readable({ read() {} })
    stderr.push(`kimi version 0.33.0\nTo resume this session: kimi -r session_${sessionId}\n`)
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
      // A real process exits when the teardown ladder kills it; the fake
      // resolves `done` on terminate (the SIGTERM → grace → SIGKILL ladder's
      // terminal step in the real subprocess seam).
      terminate: () => {
        terminated = true
        resolveDone({ exitCode: 0, signal: null })
      },
      waitForExit: async () => true,
    }
    return { handle, done, resolveDone, terminated: () => terminated }
  }

  it('settles the result immediately on abort and mirrors the partial content after the kill', async () => {
    const homeDir = wireHome('run-1')
    const child = Session.create(SessionId('child-abort-1'))
    const ctx = new Context()
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    const hanging = hangingChild('run-1')

    const controller = new AbortController()
    const request = {
      prompt: [{ type: 'text', text: '建个文件' }],
      parent: { session: { header: { cwd: '/tmp' } } },
      signal: controller.signal,
    } as unknown as SubagentStartRequest

    const run = await startKimiCliRun(request, {
      cwd: '/tmp',
      env: { KIMI_CODE_HOME: homeDir },
      disposeGraceMs: 3_000,
      spawn: () => hanging.handle,
      childSession: child,
      homeDir,
      ctx,
    })

    // Abort the parent round: the result must settle promptly — NOT wait for
    // the (never-exiting) CLI child.
    const settledAt = Date.now()
    controller.abort()
    const result = await run.result
    const settleMs = Date.now() - settledAt
    expect(result.stopReason).toBe('aborted')
    expect(settleMs).toBeLessThan(1_000)
    // The abort must not have killed the child yet — dispose owns the kill.
    expect(hanging.terminated()).toBe(false)

    // Dispose reaps the process (the SIGTERM → grace → SIGKILL ladder); the
    // fake child exits when terminated.
    await run.dispose()
    expect(hanging.terminated()).toBe(true)
    // dispose is idempotent: a second call must not throw or re-kill.
    await expect(run.dispose()).resolves.toBeUndefined()

    // The aborted round's turn/end records the parent cancellation.
    const turnEnd = child.events.find(event => event.type === 'turn/end')
    expect(turnEnd?.data).toEqual({ turn: 1, reason: { kind: 'aborted', reason: { kind: 'parent' } } })

    // Once the child has exited, the partial content is mirrored into the
    // child session (with its usage) instead of leaving it blank.
    await vi.waitFor(() => {
      expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
    })
    const assistant = child.events.filter(event => event.type === 'assistant/message')
    expect(assistant[0]!.data.message.content).toEqual([{ type: 'text', text: '任务完成。' }])
    expect(assistant[0]!.data.usage).toBeUndefined()
    expect(append).toHaveBeenCalled()
    await hanging.done
  })

  it('settles aborted without a child session record and dispose is a no-op', async () => {
    const homeDir = wireHome('run-1')
    const ctx = new Context()
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })
    const hanging = hangingChild('run-1')

    const controller = new AbortController()
    const request = {
      prompt: [{ type: 'text', text: '建个文件' }],
      parent: { session: { header: { cwd: '/tmp' } } },
      signal: controller.signal,
    } as unknown as SubagentStartRequest

    const run = await startKimiCliRun(request, {
      cwd: '/tmp',
      env: { KIMI_CODE_HOME: homeDir },
      disposeGraceMs: 3_000,
      spawn: () => hanging.handle,
      homeDir,
      ctx,
    })
    controller.abort()
    const result = await run.result
    expect(result.stopReason).toBe('aborted')
    await expect(run.dispose()).resolves.toBeUndefined()
    await expect(run.dispose()).resolves.toBeUndefined()
    await hanging.done
  })
})
