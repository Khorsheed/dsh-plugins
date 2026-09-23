import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SubagentRun, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { MemberInbox } from '../src/member-inbox.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function mount(directory = mkdtempSync(join(tmpdir(), 'member-inbox-'))) {
  const jobs: { memberId: string; text: string; signal: AbortSignal; admitted: () => void; started: ReturnType<typeof deferred<SubagentRun>>; result: ReturnType<typeof deferred<SubagentResult>> }[] = []
  const execute = vi.fn(async (memberId: string, text: string, signal: AbortSignal, admitted: () => void) => {
    const started = deferred<SubagentRun>()
    const result = deferred<SubagentResult>()
    jobs.push({ memberId, text, signal, admitted, started, result })
    signal.addEventListener('abort', () => started.resolve({ result: Promise.reject(signal.reason) } as unknown as SubagentRun), { once: true })
    return started.promise
  })
  const errors = vi.fn()
  return { directory, jobs, execute, errors, inbox: new MemberInbox(directory, execute, errors) }
}

describe('durable member inbox', () => {
  it('persists before acceptance, deduplicates retries and records actual admission and settlement', async () => {
    const m = mount()
    const first = m.inbox.enqueue('member', 'work', 'request-1')
    expect(first.status).toBe('queued')
    const stored = JSON.parse(readFileSync(join(m.directory, readdirSync(m.directory)[0]!), 'utf8'))
    expect(stored.state.messages[0]).toMatchObject({ id: first.id, text: 'work', status: 'queued' })
    expect(m.inbox.enqueue('member', 'work', 'request-1')).toEqual(first)
    expect(() => m.inbox.enqueue('member', 'other work', 'request-1')).toThrow('different text')
    expect(m.execute).toHaveBeenCalledOnce()
    m.jobs[0]!.admitted()
    expect(m.inbox.read('member').messages[0]!.status).toBe('running')
    m.jobs[0]!.started.resolve({ result: m.jobs[0]!.result.promise } as unknown as SubagentRun)
    m.jobs[0]!.result.resolve({ output: [], stopReason: 'completed' })
    await vi.waitFor(() => expect(m.inbox.read('member').messages[0]!.status).toBe('done'))
    m.inbox.dispose()
  })

  it('restores queued messages paused and fences unknown execution until evidence is recorded', async () => {
    const before = mount()
    before.inbox.enqueue('member', 'running', 'first')
    before.jobs[0]!.admitted()
    before.inbox.enqueue('member', 'waiting', 'second')
    before.inbox.dispose()
    const after = mount(before.directory)
    expect(after.inbox.read('member')).toMatchObject({ paused: true, messages: [{ status: 'uncertain' }, { status: 'queued' }] })
    expect(after.execute).not.toHaveBeenCalled()
    expect(() => after.inbox.assertAdmission('member')).toThrow('uncertain')
    expect(() => after.inbox.resume('member')).toThrow('Reconcile')
    expect(() => after.inbox.reconcile('member', 'first', 'done', '')).toThrow('evidence')
    after.inbox.reconcile('member', 'first', 'done', 'confirmed native result')
    expect(() => after.inbox.assertAdmission('member')).toThrow('paused')
    after.inbox.resume('member')
    expect(after.jobs.map(job => job.text)).toEqual(['waiting'])
    after.inbox.dispose()
  })

  it('cancels only the selected queued input, and pause/resume retains other input', async () => {
    const m = mount()
    m.inbox.enqueue('member', 'first', 'one')
    m.inbox.enqueue('member', 'second', 'two')
    m.inbox.cancel('member', 'one')
    expect(m.jobs[0]!.signal.aborted).toBe(true)
    expect(m.jobs[1]!.signal.aborted).toBe(false)
    m.inbox.pause('member')
    await vi.waitFor(() => expect(m.jobs[1]!.signal.aborted).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(m.inbox.read('member').messages.map(row => row.status)).toEqual(['cancelled', 'queued'])
    m.inbox.resume('member')
    expect(m.jobs.map(job => job.text)).toEqual(['first', 'second', 'second'])
    m.inbox.dispose()
  })

  it('never acknowledges an unpersisted input and blocks admission until storage is reconciled', () => {
    const m = mount()
    m.inbox.read('member')
    const backup = m.directory + '-backup'
    renameSync(m.directory, backup)
    writeFileSync(m.directory, 'unavailable directory')
    expect(() => m.inbox.enqueue('member', 'work', 'one')).toThrow()
    expect(m.execute).not.toHaveBeenCalled()
    expect(() => m.inbox.assertAdmission('member')).toThrow('persistence failed')
    rmSync(m.directory)
    renameSync(backup, m.directory)
    m.inbox.resume('member')
    expect(m.inbox.read('member').messages).toEqual([])
    expect(m.inbox.enqueue('member', 'work', 'one')).toMatchObject({ status: 'queued' })
    m.inbox.dispose()
  })

  it('stops an admitted input before its native run handle has published', async () => {
    const m = mount()
    m.inbox.enqueue('member', 'starting', 'one')
    m.jobs[0]!.admitted()
    expect(m.inbox.cancelStarting('member')).toBe(true)
    expect(m.jobs[0]!.signal.aborted).toBe(true)
    await vi.waitFor(() => expect(m.inbox.read('member').messages[0]!.status).toBe('cancelled'))
    m.inbox.dispose()
  })

  it('fails closed on corrupt persisted messages', () => {
    const m = mount()
    m.inbox.enqueue('member', 'work', 'one')
    m.inbox.dispose()
    writeFileSync(join(m.directory, readdirSync(m.directory)[0]!), JSON.stringify({ version: 1, state: { memberId: 'another', paused: false, messages: [] } }))
    const after = mount(m.directory)
    expect(() => after.inbox.read('member')).toThrow('Invalid member inbox')
    expect(after.execute).not.toHaveBeenCalled()
  })
})
