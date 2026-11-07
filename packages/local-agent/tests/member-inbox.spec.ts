import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SubagentRun, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { MemberInbox, SELF_ROUND_RESTARTED } from '../src/member-inbox.ts'
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

  it('the boot pause lifts by itself once the lost round is reconciled and no composer input waits; an operator pause stays', async () => {
    const before = mount()
    void before.submit('member', 'room-run', 'room', 'delivery-1')
    before.jobs[0]!.admitted()
    before.inbox.dispose()
    const after = mount(before.directory)
    expect(after.inbox.read('member')).toMatchObject({ paused: true, pausedBy: 'restart' })
    // Auto-continue / moving on reconciles the lost round: nothing left to decide.
    after.inbox.reconcile('member', 'room-run', 'cancelled', 'moved on after restart')
    expect(after.inbox.read('member').paused).toBe(false)
    expect(after.inbox.read('member').pausedBy).toBeUndefined()
    after.inbox.dispose()

    // Composer input still waiting: the pause stays until it is resumed or cancelled.
    const b2 = mount()
    void b2.submit('member', 'run-2', 'tool')
    b2.jobs[0]!.admitted()
    b2.enqueue('member', 'waiting', 'w')
    b2.inbox.dispose()
    const a2 = mount(b2.directory)
    a2.inbox.reconcile('member', 'run-2', 'failed', 'crashed')
    expect(a2.inbox.read('member')).toMatchObject({ paused: true, pausedBy: 'restart' })
    a2.inbox.cancel('member', 'w')
    expect(a2.inbox.read('member').paused).toBe(false)
    // An operator's pause never lifts by itself.
    a2.inbox.pause('member')
    expect(a2.inbox.read('member')).toMatchObject({ paused: true })
    expect(a2.inbox.read('member').pausedBy).toBeUndefined()
    a2.inbox.dispose()
  })

  it('lists members a restart interrupted without loading, converting or saving their ledgers (M10)', async () => {
    const before = mount()
    // `ada` was running a round when the host died; `bob` had finished his.
    void before.submit('ada', 'ada-run', 'room', 'delivery-ada')
    before.jobs[0]!.admitted()
    const bob = before.submit('bob', 'bob-run', 'room', 'delivery-bob')
    await before.finish(before.jobs[1]!)
    await bob
    // Before the restart nothing is interrupted: a row running in this process is live work.
    expect(before.inbox.interruptedMembers()).toEqual([])
    before.inbox.dispose()
    const files = Object.fromEntries(readdirSync(before.directory).map(name => [name, readFileSync(join(before.directory, name), 'utf8')]))
    const after = mount(before.directory)
    expect(after.inbox.interruptedMembers()).toEqual(['ada'])
    // Read-only: every file is byte-identical, still `running` on disk.
    expect(Object.fromEntries(readdirSync(before.directory).map(name => [name, readFileSync(join(before.directory, name), 'utf8')]))).toEqual(files)
    // Once loaded (uncertain in memory) it is still listed, once.
    expect(after.inbox.read('ada').messages[0]).toMatchObject({ status: 'uncertain' })
    expect(after.inbox.interruptedMembers()).toEqual(['ada'])
    // Reconciled: no longer interrupted.
    after.inbox.reconcile('ada', 'ada-run', 'done', 'checked the transcript')
    expect(after.inbox.interruptedMembers()).toEqual([])
    // A stray or corrupt file in the directory is skipped, not thrown.
    writeFileSync(join(before.directory, `${'0'.repeat(64)}.json`), '{oops')
    writeFileSync(join(before.directory, 'notes.txt'), 'x')
    expect(after.inbox.interruptedMembers()).toEqual([])
    after.inbox.dispose()
    // No directory at all (no member ever ran): nothing.
    expect(mount(join(before.directory, 'missing')).inbox.interruptedMembers()).toEqual([])
  })

  it('an older restart\'s leftover (already `uncertain` on disk) is not interrupted by this restart (M10)', () => {
    const first = mount()
    void first.submit('ada', 'ada-run', 'room', 'delivery-ada')
    first.jobs[0]!.admitted()
    first.inbox.dispose()
    // Boot 2 loads the ledger (running → uncertain, saved) and nobody reconciles it.
    const second = mount(first.directory)
    expect(second.inbox.read('ada').messages[0]).toMatchObject({ status: 'uncertain' })
    expect(second.inbox.interruptedMembers()).toEqual(['ada'])
    second.inbox.dispose()
    // Boot 3: the same stale row, from disk and once loaded, is not this restart's.
    const third = mount(first.directory)
    expect(third.inbox.interruptedMembers()).toEqual([])
    expect(third.inbox.read('ada').messages[0]).toMatchObject({ status: 'uncertain' })
    expect(third.inbox.interruptedMembers()).toEqual([])
    third.inbox.dispose()
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

  it('accepts `cli` rows (a round the CLI opened itself); a row with an unknown caller still invalidates the ledger', () => {
    const directory = mkdtempSync(join(tmpdir(), 'member-inbox-cli-'))
    const seed = mount(directory)
    seed.enqueue('member', 'placeholder', 'p')
    seed.inbox.dispose()
    const path = file(directory)
    writeFileSync(path, JSON.stringify({ version: 2, state: { memberId: 'member', paused: false, messages: [
      { id: 'self-1', caller: 'cli', status: 'done', createdAt: 1, updatedAt: 2 },
      { id: 'self-2', caller: 'cli', status: 'running', createdAt: 5, updatedAt: 6 },
    ] } }))
    const after = mount(directory)
    // A running `cli` row (a round the CLI opened itself) is nobody's request:
    // after the restart it ends failed with the restart marker and blocks nothing.
    expect(after.inbox.read('member').messages).toMatchObject([
      { id: 'self-1', caller: 'cli', status: 'done' },
      { id: 'self-2', caller: 'cli', status: 'failed', error: SELF_ROUND_RESTARTED },
    ])
    expect(after.inbox.read('member').paused).toBe(false)
    expect(() => after.inbox.assertAdmission('member')).not.toThrow()
    after.inbox.dispose()
    writeFileSync(path, JSON.stringify({ version: 2, state: { memberId: 'member', paused: false, messages: [
      { id: 'odd-1', caller: 'cron', status: 'done', createdAt: 3, updatedAt: 4 },
    ] } }))
    const odd = mount(directory)
    expect(() => odd.inbox.read('member')).toThrow('Invalid member inbox')
    odd.inbox.dispose()
  })

  it('runNow: a round the CLI already runs takes the slot at once, queued rows wait for it, and a taken slot refuses it', async () => {
    const m = mount()
    const result = deferred<SubagentResult>()
    const ended = deferred<LocalAgentMemberInput>()
    const row = m.inbox.runNow('member', { id: 'self-1', caller: 'cli' }, {
      dispatch: async () => ({ result: result.promise } as unknown as SubagentRun),
      final: settled => ended.resolve(settled),
    })
    expect(row).toMatchObject({ id: 'self-1', caller: 'cli', status: 'running', admittedAt: expect.any(Number) })
    // Asked for meanwhile: queued behind it, not dispatched.
    const tool = m.submit('member', 'tool-1')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(m.jobs).toHaveLength(0)
    expect(m.inbox.read('member').messages.map(input => [input.id, input.status])).toEqual([['self-1', 'running'], ['tool-1', 'queued']])
    // A second self round while the slot is taken is refused.
    expect(m.inbox.runNow('member', { id: 'self-2', caller: 'cli' }, {})).toBeUndefined()
    result.resolve({ stopReason: 'completed', output: [] })
    expect(await ended.promise).toMatchObject({ id: 'self-1', status: 'done' })
    await vi.waitFor(() => expect(m.jobs).toHaveLength(1))
    // A dispatched row holds the slot: a self round is refused.
    expect(m.inbox.runNow('member', { id: 'self-3', caller: 'cli' }, {})).toBeUndefined()
    await m.finish(m.jobs[0]!)
    expect(await tool).toMatchObject({ id: 'tool-1', status: 'done' })
    m.inbox.dispose()
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
