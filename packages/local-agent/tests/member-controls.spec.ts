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
    await m.controls.run(binding, async configuration => { first = configuration; return { result } as unknown as SubagentRun })
    const control = m.controls.get(binding)
    await control.select('later', 0, { model: { mode: 'value', value: 'next' }, effort: { mode: 'inherit' } })
    expect(first?.resolved.model).toBe('initial')
    expect(control.read().round?.configuration.resolved.model).toBe('initial')
    await expect(m.controls.run(binding, async () => { throw new Error('must not start') })).rejects.toThrow('active')
    finish()
    await result
    const start = vi.fn(async configuration => { expect(configuration.resolved.model).toBe('next'); return { result: Promise.resolve() } as unknown as SubagentRun })
    await m.controls.run(binding, start)
    expect(start).toHaveBeenCalledOnce()
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

  it('refuses a provider, account scope, or frozen-condition change under an existing member identity', () => {
    const m = mount()
    m.controls.get(binding)
    expect(() => m.controls.get({ ...binding, provider: 'other' })).toThrow('identity changed')
    expect(() => m.controls.get({ ...binding, scope: 'other-account' })).toThrow('identity changed')
    expect(() => m.controls.get({ ...binding, configurationLock: 'frozen' })).toThrow('identity changed')
  })
})
