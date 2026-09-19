import { describe, expect, it, vi } from 'vitest'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { MemberControls } from '../src/member-controls.ts'
import type { MemberControlRecord, MemberConfigurationAdapter } from '../src/member-control.ts'
import type { LocalAgentAppliedConfiguration, LocalAgentMemberBinding } from '../src/types.ts'

const binding: LocalAgentMemberBinding = { childSessionId: 'member', provider: 'native', parentSessionId: 'parent', cwd: '/home/user/work', model: 'initial' }
function mount() {
  const records = new Map<string, MemberControlRecord>()
  let defaultModel = 'initial'
  const prepare = vi.fn(async (selection) => ({ model: selection.model.mode === 'value' ? selection.model.value : defaultModel }))
  const adapter: MemberConfigurationAdapter = {
    validate: async selection => { if (selection.effort.mode === 'value') throw new Error('unsupported effort') },
    prepare,
    apply: async selection => prepare(selection),
    reconcile: async state => ({ active: false, matches: 'current', resolved: state.current.resolved }),
  }
  const factory = vi.fn(() => adapter)
  const errors = vi.fn()
  const controls = new MemberControls({ read: id => structuredClone(records.get(id)), write: (id, value) => { records.set(id, structuredClone(value)) } }, factory, errors)
  return { controls, prepare, factory, errors, defaults: (value: string) => { defaultModel = value } }
}

describe('provider configuration admission', () => {
  it('holds one configuration through all tool steps and releases it when the provider result settles', async () => {
    const m = mount()
    let finish!: () => void
    const result = new Promise<void>(resolve => { finish = resolve })
    let first: LocalAgentAppliedConfiguration | undefined
    const firstRun = await m.controls.run(binding, async configuration => { first = configuration; return { result } as unknown as SubagentRun })
    const control = m.controls.get(binding)
    await control.select('later', 0, { model: { mode: 'value', value: 'next' }, effort: { mode: 'inherit' } })
    expect(first?.resolved.model).toBe('initial')
    expect(control.read().round?.configuration.resolved.model).toBe('initial')
    const queuedStart = vi.fn(async configuration => { expect(configuration.resolved.model).toBe('next'); return { result: Promise.resolve() } as unknown as SubagentRun })
    const queued = m.controls.run(binding, queuedStart)
    expect(m.controls.queuedCount(binding.childSessionId)).toBe(1)
    expect(queuedStart).not.toHaveBeenCalled()
    finish()
    await result
    await queued
    expect(queuedStart).toHaveBeenCalledOnce()
    const start = vi.fn(async configuration => { expect(configuration.resolved.model).toBe('next'); return { result: Promise.resolve() } as unknown as SubagentRun })
    await m.controls.run(binding, start)
    expect(start).toHaveBeenCalledOnce()
    expect(m.controls.configurationOf(firstRun)?.resolved.model).toBe('initial')
    const copy = m.controls.configurationOf(firstRun)!
    copy.resolved.model = 'tampered'
    expect(m.controls.configurationOf(firstRun)?.resolved.model).toBe('initial')
    expect(m.errors).not.toHaveBeenCalled()
  })

  it('validates creation-time configuration before calling the provider and releases a failed start', async () => {
    const m = mount()
    const control = m.controls.get(binding)
    const started = vi.fn(async () => { throw new Error('spawn failed') })
    await expect(m.controls.run(binding, started)).rejects.toThrow('spawn failed')
    expect(control.read().round).toBeUndefined()
    expect(control.read().status).toBe('failed')
    await expect(m.controls.run(binding, started)).rejects.toThrow('spawn failed')
    expect(started).toHaveBeenCalledOnce()
    await control.retry(control.read().revision)
    m.defaults('new-default')
    await m.controls.run(binding, async configuration => {
      expect(configuration.resolved.model).toBe('new-default')
      return { result: Promise.resolve() } as unknown as SubagentRun
    })
    expect(m.factory.mock.calls.length).toBeGreaterThan(1)
  })

  it('serializes all rounds until settlement while allowing another member to run independently', async () => {
    const m = mount()
    let finishFirst!: () => void
    let finishSecond!: () => void
    const firstResult = new Promise<void>(resolve => { finishFirst = resolve })
    const secondResult = new Promise<void>(resolve => { finishSecond = resolve })
    const order: string[] = []
    const first = m.controls.run(binding, async () => { order.push('first'); return { result: firstResult } as unknown as SubagentRun })
    const second = m.controls.run(binding, async () => { order.push('second'); return { result: secondResult } as unknown as SubagentRun })
    const third = m.controls.run(binding, async () => { order.push('third'); return { result: Promise.resolve() } as unknown as SubagentRun })
    await first
    const other = await m.controls.run({ ...binding, childSessionId: 'other' }, async () => { order.push('other'); return { result: Promise.resolve() } as unknown as SubagentRun })
    await other.result
    expect(order).toEqual(['first', 'other'])
    expect(m.controls.queuedCount('member')).toBe(2)
    finishFirst()
    await second
    expect(order).toEqual(['first', 'other', 'second'])
    finishSecond()
    await third
    expect(order).toEqual(['first', 'other', 'second', 'third'])
    expect(m.controls.queuedCount('member')).toBe(0)
  })

  it('cancels a waiting call promptly without starting it or damaging configuration', async () => {
    const m = mount()
    let finish!: () => void
    const result = new Promise<void>(resolve => { finish = resolve })
    await m.controls.run(binding, async () => ({ result } as unknown as SubagentRun))
    const abort = new AbortController()
    const start = vi.fn(async () => ({ result: Promise.resolve() } as unknown as SubagentRun))
    const queued = m.controls.run(binding, start, abort.signal)
    const cancelled = expect(queued).rejects.toThrow('cancel queued')
    abort.abort(new Error('cancel queued'))
    await cancelled
    expect(m.controls.queuedCount('member')).toBe(0)
    expect(start).not.toHaveBeenCalled()
    const next = m.controls.run(binding, start)
    finish()
    await next
    expect(start).toHaveBeenCalledOnce()
    expect(m.controls.get(binding).read().status).toBe('idle')
  })

  it('does not turn cancellation during native startup into failed configuration', async () => {
    const m = mount()
    const abort = new AbortController()
    await expect(m.controls.run(binding, async () => { abort.abort(); throw new Error('cancelled native startup') }, abort.signal)).rejects.toThrow('cancelled')
    expect(m.controls.get(binding).read().status).toBe('idle')
    await m.controls.run(binding, async () => ({ result: Promise.resolve() } as unknown as SubagentRun))
  })

  it('refuses a failed durable input edge before native work without poisoning model configuration', async () => {
    const m = mount()
    const start = vi.fn(async () => ({ result: Promise.resolve() } as unknown as SubagentRun))
    await expect(m.controls.run(binding, start, undefined, () => { throw new Error('input disk failure') })).rejects.toThrow('input disk failure')
    expect(start).not.toHaveBeenCalled()
    expect(m.controls.get(binding).read().status).toBe('idle')
    expect(m.controls.get(binding).read().round).toBeUndefined()
  })

  it('refuses a provider, account scope, or frozen-condition change under an existing member identity', () => {
    const m = mount()
    m.controls.get(binding)
    expect(() => m.controls.get({ ...binding, provider: 'other' })).toThrow('identity changed')
    expect(() => m.controls.get({ ...binding, scope: 'other-account' })).toThrow('identity changed')
    expect(() => m.controls.get({ ...binding, configurationLock: 'frozen' })).toThrow('identity changed')
  })
})
