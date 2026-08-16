import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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
    // the mirror appended the transcript after settlement
    expect(child.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
    expect(append).toHaveBeenCalledWith(child.id, child.events)
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
    ctx.provide('localAgent', { homeDir: () => '/tmp/kimi-home', get: () => ({ displayName: 'Kimi Code' }) } as never)
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

    const promise = () => provider.start(request)
    expect(promise).toThrow(/not spawned/)
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
    ctx.provide('localAgent', { homeDir: () => '/tmp/kimi-home' } as never)
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

    expect(() => provider.start(request)).toThrow(/not spawned/)
  })
})
