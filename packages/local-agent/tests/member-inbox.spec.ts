import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SubagentRun, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { MemberInbox } from '../src/member-inbox.ts'
import type { LocalAgentMemberInput } from '../src/types.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
interface Job { memberId: string; row: LocalAgentMemberInput; signal: AbortSignal; admitted: () => void; started: ReturnType<typeof deferred<SubagentRun>>; result: ReturnType<typeof deferred<SubagentResult>> }
function mount(directory = mkdtempSync(join(tmpdir(), 'member-inbox-'))) {
  const jobs: Job[] = []
  const dispatch = (memberId: string, row: LocalAgentMemberInput, signal: AbortSignal, admitted: () => void): Promise<SubagentRun> => {
    const started = deferred<SubagentRun>()
    const result = deferred<SubagentResult>()
    jobs.push({ memberId, row, signal, admitted, started, result })
    signal.addEventListener('abort', () => started.resolve({ result: Promise.reject(signal.reason) } as unknown as SubagentRun), { once: true })
    return started.promise
  }
  const composer = vi.fn(dispatch)
  const errors = vi.fn()
  const inbox = new MemberInbox(directory, composer, errors)
  /** The composer path: dedup by request id, then one ledger row (the registry passes run()'s submission). */
  const enqueue = (memberId: string, text: string, requestId: string) =>
    inbox.enqueue(memberId, text, requestId, row => { inbox.submit(memberId, { id: `exec-${requestId}`, caller: 'composer', key: row.key, text: row.text }) })
  /** A non-composer row with its own dispatcher and a waiter for its end. */
  const submit = (memberId: string, id: string, caller: 'tool' | 'room' | 'api' = 'tool', key?: string) => {
    const ended = deferred<LocalAgentMemberInput>()
    inbox.submit(memberId, { id, caller, ...key === undefined ? {} : { key } }, {
      dispatch: (signal, admitted, row) => dispatch(memberId, row, signal, admitted),
      final: row => ended.resolve(row),
    })
    return ended.promise
  }
  const finish = async (job: Job, stopReason: SubagentResult['stopReason'] = 'completed') => {
    job.admitted()
    job.started.resolve({ result: job.result.promise } as unknown as SubagentRun)
    job.result.resolve({ output: [], stopReason })
  }
  return { directory, jobs, composer, errors, inbox, enqueue, submit, finish }
}
const file = (directory: string) => join(directory, readdirSync(directory).find(name => name.endsWith('.json'))!)

describe('member execution ledger', () => {
  it('persists before acceptance, deduplicates retries and records actual admission and settlement', async () => {
    const m = mount()
    const first = m.enqueue('member', 'work', 'request-1')
    expect(first).toMatchObject({ id: 'exec-request-1', key: 'request-1', caller: 'composer', status: 'queued' })
    const stored = JSON.parse(readFileSync(file(m.directory), 'utf8'))
    expect(stored.version).toBe(2)
    expect(stored.state.messages[0]).toMatchObject({ id: first.id, key: 'request-1', text: 'work', status: 'queued' })
    expect(m.enqueue('member', 'work', 'request-1')).toEqual(first)
    expect(() => m.enqueue('member', 'other work', 'request-1')).toThrow('different text')
    expect(m.composer).toHaveBeenCalledOnce()
    m.jobs[0]!.admitted()
    expect(m.inbox.read('member').messages[0]).toMatchObject({ status: 'running', admittedAt: expect.any(Number) })
    m.jobs[0]!.started.resolve({ result: m.jobs[0]!.result.promise } as unknown as SubagentRun)
    m.jobs[0]!.result.resolve({ output: [], stopReason: 'completed' })
    await vi.waitFor(() => expect(m.inbox.read('member').messages[0]).toMatchObject({ status: 'done', settledAt: expect.any(Number) }))
    m.inbox.dispose()
  })

  it('dispatches one row at a time in ledger order, whoever submitted it', async () => {
    const m = mount()
    const tool = m.submit('member', 'a', 'tool')
    m.enqueue('member', 'typed', 'b')
    const room = m.submit('member', 'c', 'room', 'delivery-1')
    expect(m.jobs.map(job => job.row.id)).toEqual(['a'])
    expect(() => m.inbox.submit('member', { id: 'd', caller: 'room', key: 'delivery-1' })).toThrow('already exists')
    await m.finish(m.jobs[0]!)
    expect(await tool).toMatchObject({ id: 'a', status: 'done' })
    await vi.waitFor(() => expect(m.jobs.map(job => job.row.id)).toEqual(['a', 'exec-b']))
    await m.finish(m.jobs[1]!)
    await vi.waitFor(() => expect(m.jobs.map(job => job.row.id)).toEqual(['a', 'exec-b', 'c']))
    await m.finish(m.jobs[2]!, 'error')
    expect(await room).toMatchObject({ id: 'c', status: 'failed' })
    m.inbox.dispose()
  })

  it('cancels only the selected queued row (by id or key), and pause holds composer input', async () => {
    const m = mount()
    m.submit('member', 'running', 'tool')
    const cancelled = m.submit('member', 'queued', 'room', 'delivery-2')
    m.enqueue('member', 'second', 'two')
    m.inbox.cancel('member', 'delivery-2')
    expect(await cancelled).toMatchObject({ id: 'queued', status: 'cancelled' })
    m.jobs[0]!.admitted()
    expect(() => m.inbox.cancel('member', 'running')).toThrow('Only a queued input')
    m.inbox.pause('member')
    m.jobs[0]!.started.resolve({ result: m.jobs[0]!.result.promise } as unknown as SubagentRun)
    m.jobs[0]!.result.resolve({ output: [], stopReason: 'completed' })
    await vi.waitFor(() => expect(m.inbox.read('member').messages[0]!.status).toBe('done'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(m.jobs).toHaveLength(1)
    expect(m.inbox.read('member').messages.map(row => row.status)).toEqual(['done', 'cancelled', 'queued'])
    m.inbox.resume('member')
    expect(m.jobs.map(job => job.row.text)).toEqual([undefined, 'second'])
    m.inbox.dispose()
  })

  it('restarts: running → uncertain for every caller, composer input kept (paused), other queued rows dropped, blocked until reconciled', async () => {
    const before = mount()
    void before.submit('member', 'tool-run', 'tool')
    before.jobs[0]!.admitted()
    before.enqueue('member', 'waiting', 'second')
    void before.submit('member', 'room-queued', 'room', 'delivery-3')
    before.inbox.dispose()
    const after = mount(before.directory)
    expect(after.inbox.read('member')).toMatchObject({ paused: true, messages: [{ id: 'tool-run', status: 'uncertain' }, { key: 'second', status: 'queued' }] })
    expect(after.composer).not.toHaveBeenCalled()
    expect(() => after.inbox.assertAdmission('member')).toThrow('uncertain')
    expect(() => after.inbox.resume('member')).toThrow('Reconcile')
    expect(() => after.inbox.reconcile('member', 'tool-run', 'done', '')).toThrow('evidence')
    after.inbox.reconcile('member', 'tool-run', 'failed', 'the CLI transcript shows it crashed')
    expect(() => after.inbox.assertAdmission('member')).toThrow('paused')
    after.inbox.resume('member')
    expect(after.jobs.map(job => job.row.text)).toEqual(['waiting'])
    after.inbox.dispose()
  })

  it('reads a version-1 member inbox file as composer rows keyed by their request id', () => {
    const directory = mkdtempSync(join(tmpdir(), 'member-inbox-v1-'))
    const seed = mount(directory)
    seed.enqueue('member', 'placeholder', 'p')
    seed.inbox.dispose()
    const path = file(directory)
    writeFileSync(path, JSON.stringify({ version: 1, state: { memberId: 'member', paused: false, messages: [
      { id: 'old-1', text: 'done before', status: 'done', createdAt: 1, updatedAt: 2 },
      { id: 'old-2', text: 'was running', status: 'running', createdAt: 3, updatedAt: 4 },
      { id: 'old-3', text: 'was waiting', status: 'queued', createdAt: 5, updatedAt: 6 },
    ] } }))
    const after = mount(directory)
    expect(after.inbox.read('member')).toMatchObject({ paused: true, messages: [
      { id: 'old-1', key: 'old-1', caller: 'composer', text: 'done before', status: 'done' },
      { id: 'old-2', key: 'old-2', caller: 'composer', status: 'uncertain' },
      { id: 'old-3', key: 'old-3', caller: 'composer', text: 'was waiting', status: 'queued' },
    ] })
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(2)
    // A retry of an old request id is still deduplicated.
    expect(after.enqueue('member', 'was waiting', 'old-3')).toMatchObject({ id: 'old-3' })
    after.inbox.reconcile('member', 'old-2', 'done', 'confirmed')
    after.inbox.resume('member')
    expect(after.jobs.map(job => job.row.text)).toEqual(['was waiting'])
    after.inbox.dispose()
  })

  it('never acknowledges an unpersisted input and blocks admission until storage is reconciled', () => {
    const m = mount()
    m.inbox.read('member')
    const backup = m.directory + '-backup'
    renameSync(m.directory, backup)
    writeFileSync(m.directory, 'unavailable directory')
    expect(() => m.enqueue('member', 'work', 'one')).toThrow()
    expect(m.composer).not.toHaveBeenCalled()
    expect(() => m.inbox.assertAdmission('member')).toThrow('persistence failed')
    rmSync(m.directory)
    renameSync(backup, m.directory)
    m.inbox.resume('member')
    expect(m.inbox.read('member').messages).toEqual([])
    expect(m.enqueue('member', 'work', 'one')).toMatchObject({ status: 'queued' })
    m.inbox.dispose()
  })

  it('stops the dispatched row before its native run handle has published', async () => {
    const m = mount()
    m.enqueue('member', 'starting', 'one')
    m.jobs[0]!.admitted()
    expect(m.inbox.cancelStarting('member')).toBe(true)
    expect(m.jobs[0]!.signal.aborted).toBe(true)
    await vi.waitFor(() => expect(m.inbox.read('member').messages[0]!.status).toBe('cancelled'))
    m.inbox.dispose()
  })

  it('fails closed on corrupt persisted messages', () => {
    const m = mount()
    m.enqueue('member', 'work', 'one')
    m.inbox.dispose()
    writeFileSync(file(m.directory), JSON.stringify({ version: 2, state: { memberId: 'another', paused: false, messages: [] } }))
    const after = mount(m.directory)
    expect(() => after.inbox.read('member')).toThrow('Invalid member inbox')
    expect(after.composer).not.toHaveBeenCalled()
  })
})
