import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MemberConfigurationController, type MemberConfigurationAdapter, type MemberControlRecord, type MemberControlStorage } from '../src/member-control.ts'
import { FileMemberControlStorage } from '../src/member-control-storage.ts'
import type { LocalAgentMemberConfiguration } from '../src/types.ts'

const selection = (value: string): LocalAgentMemberConfiguration => ({ model: { mode: 'value', value }, effort: { mode: 'inherit' } })
const model = (value: LocalAgentMemberConfiguration): string => value.model.mode === 'value' ? value.model.value : 'a'
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}

function mount(storageOverride?: MemberControlStorage) {
  let stored: MemberControlRecord | undefined
  let native = 'a'
  let failWrite: ((record: MemberControlRecord) => boolean) | undefined
  const calls: string[] = []
  const gates = new Map<string, Promise<void>>()
  const storage: MemberControlStorage = storageOverride ?? {
    read: () => structuredClone(stored),
    write: (_id, record) => {
      if (failWrite?.(record)) throw new Error('durability unavailable')
      stored = structuredClone(record)
    },
  }
  const adapter: MemberConfigurationAdapter = {
    validate: vi.fn(async value => { if (model(value) === 'invalid') throw new Error('unsupported combination') }),
    apply: async value => { const next = model(value); calls.push(next); await gates.get(next); native = next; return { model: native } },
    reconcile: vi.fn(async state => ({
      active: false, resolved: { model: native },
      matches: state.operation !== undefined && model(state.operation.selection) === native ? 'operation' : model(state.current.selection) === native ? 'current' : 'unknown',
    })),
  }
  const create = (lockedReason?: string) => new MemberConfigurationController('member', storage, adapter, { selection: selection('a'), resolved: { model: 'a' }, ...lockedReason === undefined ? {} : { lockedReason } })
  return { create, adapter, calls, gates, writeFailure: (failure?: (record: MemberControlRecord) => boolean) => { failWrite = failure }, setNative: (value: string) => { native = value } }
}

describe('member configuration boundaries', () => {
  it('pins resolved defaults for a frozen evaluation across later rounds and controller restart', async () => {
    const m = mount()
    let defaultEffort = 'high'
    m.adapter.prepare = async value => ({ model: model(value), effort: value.effort.mode === 'value' ? value.effort.value : defaultEffort })
    m.adapter.reconcile = async state => ({ active: false, matches: 'current', resolved: await m.adapter.prepare!(state.current.selection) })
    const control = m.create('Frozen evaluation')
    const first = await control.admit('first'); first.release()
    expect(control.read().frozen?.resolved.effort).toBe('high')
    defaultEffort = 'low'
    const second = await control.admit('second')
    expect(second.configuration.resolved.effort).toBe('high'); second.release()
    const restored = m.create('Frozen evaluation')
    const third = await restored.admit('third')
    expect(third.configuration.resolved.effort).toBe('high'); third.release()
  })

  it('serializes a selection arriving during admission preparation before starting the next turn', async () => {
    const m = mount()
    const preparing = deferred()
    const entered = deferred()
    m.adapter.prepare = async value => {
      if (model(value) === 'a') { entered.resolve(); await preparing.promise }
      return { model: model(value) }
    }
    const control = m.create()
    const next = control.admit('next')
    await entered.promise
    await control.select('b', 0, selection('b'))
    expect(m.calls).toEqual([])
    preparing.resolve()
    const lease = await next
    expect(lease.configuration.resolved.model).toBe('b')
    expect(m.calls).toEqual(['b'])
    lease.release()
  })

  it('assigns a choice validated after admission to the following round', async () => {
    const m = mount()
    const validation = deferred()
    m.adapter.validate = async () => { await validation.promise }
    const control = m.create()
    const selecting = control.select('b', 0, selection('b'))
    const first = await control.admit('admitted-first')
    validation.resolve()
    expect((await selecting).status).toBe('pending')
    expect(first.configuration.selection).toEqual(selection('a'))
    expect(m.calls).toEqual([])
    first.release()
    const second = await control.admit('next')
    expect(second.configuration.selection).toEqual(selection('b'))
    second.release()
  })

  it('accepts/coalesces during a whole running round and binds only the latest valid intent next', async () => {
    const m = mount()
    const control = m.create()
    const first = await control.admit('one')
    expect(await control.select('b', 0, selection('b'))).toMatchObject({ status: 'pending', revision: 1 })
    expect(await control.select('c', 1, selection('c'))).toMatchObject({ status: 'pending', revision: 2 })
    expect(await control.select('bad', 2, selection('invalid'))).toMatchObject({ status: 'unsupported' })
    expect(control.read()).toMatchObject({ current: { revision: 0 }, pending: { revision: 2, selection: selection('c') } })
    expect(first.configuration.selection).toEqual(selection('a'))
    expect(Object.isFrozen(first.configuration.selection.model)).toBe(true)
    expect(m.calls).toEqual([])
    first.release()
    const next = await control.admit('two')
    expect(next.configuration).toMatchObject({ revision: 2, selection: selection('c') })
    expect(m.calls).toEqual(['c'])
    next.release()
  })

  it('converges newer choices arriving during an older native control before admitting', async () => {
    const m = mount()
    const gate = deferred()
    m.gates.set('b', gate.promise)
    const control = m.create()
    await control.select('b', 0, selection('b'))
    await control.select('c', 1, selection('c'))
    const next = control.admit('next')
    expect(control.read().current.selection).toEqual(selection('a'))
    gate.resolve()
    const admitted = await next
    expect(m.calls).toEqual(['b', 'c'])
    expect(admitted.configuration.selection).toEqual(selection('c'))
    admitted.release()
  })

  it('cancels an unsent pending choice without touching the running native session', async () => {
    const m = mount()
    const control = m.create()
    const first = await control.admit('one')
    await control.select('b', 0, selection('b'))
    expect(control.cancel('cancel-b', 0).status).toBe('conflict')
    expect(control.cancel('cancel-b', 1).status).toBe('cancelled')
    first.release()
    const next = await control.admit('two')
    expect(next.configuration.selection).toEqual(selection('a'))
    expect(m.calls).toEqual([])
    next.release()
  })

  it('restores the last applied configuration when cancellation races a native ack', async () => {
    const m = mount()
    const gate = deferred()
    m.gates.set('b', gate.promise)
    const control = m.create()
    await control.select('b', 0, selection('b'))
    expect(control.cancel('cancel-b', 1)).toMatchObject({ revision: 2, status: 'pending' })
    const next = control.admit('next')
    gate.resolve()
    const admitted = await next
    expect(m.calls).toEqual(['b', 'a'])
    expect(admitted.configuration).toMatchObject({ revision: 2, selection: selection('a') })
    expect(control.cancel('cancel-b', 1).status).toBe('cancelled')
    admitted.release()
  })

  it('deduplicates accepted request IDs and rejects stale pages and conflicting reuse', async () => {
    const m = mount()
    const control = m.create()
    const first = await control.admit('one')
    await control.select('b', 0, selection('b'))
    expect(await control.select('b', 0, selection('b'))).toMatchObject({ revision: 1, status: 'pending' })
    expect((await control.select('b', 1, selection('c'))).status).toBe('conflict')
    expect((await control.select('c', 0, selection('c'))).status).toBe('conflict')
    expect(control.read().revision).toBe(1)
    first.release()
    const last = await control.admit('last')
    last.release()
  })

  it('locks frozen configurations before validation or pending-slot mutation', async () => {
    const m = mount()
    const control = m.create('Frozen evaluation condition')
    expect((await control.select('b', 0, selection('b'))).status).toBe('locked')
    expect(m.adapter.validate).not.toHaveBeenCalled()
    expect(control.read()).toMatchObject({ revision: 0, status: 'idle' })
  })
})

describe('member configuration durability and reconciliation', () => {
  it('fails closed on malformed persisted state instead of inventing a default configuration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'member-controls-invalid-'))
    const storage = new FileMemberControlStorage(directory)
    mount(storage).create()
    const filename = readdirSync(directory).find(name => name.endsWith('.json'))!
    writeFileSync(join(directory, filename), '{invalid state')
    expect(() => mount(new FileMemberControlStorage(directory)).create()).toThrow()
  })

  it('does not acknowledge a selection whose durable write fails', async () => {
    const m = mount()
    const control = m.create()
    m.writeFailure(() => true)
    await expect(control.select('b', 0, selection('b'))).rejects.toThrow('durability unavailable')
    expect(control.read()).toMatchObject({ revision: 0, status: 'failed' })
    expect(m.calls).toEqual([])
    await expect(control.admit('blocked')).rejects.toThrow('durability unavailable')
    m.writeFailure()
    await control.retry(0)
    const admitted = await control.admit('recovered')
    admitted.release()
  })

  it('reconciles an acknowledged native change after persistence failure without applying it twice', async () => {
    const m = mount()
    const first = m.create()
    m.writeFailure(record => record.state.current.selection.model.mode === 'value' && record.state.current.selection.model.value === 'b')
    await first.select('b', 0, selection('b'))
    await vi.waitFor(() => { expect(first.read().status).toBe('failed') })
    expect(m.calls).toEqual(['b'])
    const recovered = m.create()
    await expect(recovered.admit('blocked')).rejects.toThrow()
    m.writeFailure()
    await recovered.retry(1)
    const admitted = await recovered.admit('after-recovery')
    expect(admitted.configuration.selection).toEqual(selection('b'))
    expect(m.calls).toEqual(['b'])
    expect((await recovered.select('b', 0, selection('b'))).status).toBe('applied')
    admitted.release()
  })

  it('keeps admission blocked when native state cannot be reconciled', async () => {
    const m = mount()
    const first = m.create()
    const round = await first.admit('old-round')
    // Simulate process loss before its lease release was persisted.
    m.setNative('unrecognized-native-state')
    const recovered = m.create()
    await expect(recovered.admit('next')).rejects.toThrow('could not be reconciled')
    expect(m.calls).toEqual([])
    expect(recovered.read().round?.id).toBe('old-round')
    void round
  })

  it('persists pending intent, revisions and request receipts across real storage instances', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'member-controls-'))
    const storage = new FileMemberControlStorage(directory)
    const m = mount(storage)
    const first = m.create()
    await first.admit('old-round')
    await first.select('b', 0, selection('b'))
    const restored = new MemberConfigurationController('member', new FileMemberControlStorage(directory), m.adapter, { selection: selection('wrong-initial') })
    expect(restored.read()).toMatchObject({ revision: 1, pending: { requestId: 'b' } })
    const admitted = await restored.admit('restored-round')
    expect(admitted.configuration.selection).toEqual(selection('b'))
    expect((await restored.select('b', 0, selection('b'))).status).toBe('applied')
    admitted.release()
  })
})
