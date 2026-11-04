import { describe, expect, it, vi } from 'vitest'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { MemberControls } from '../src/member-controls.ts'
import type { MemberControlRecord, MemberConfigurationAdapter } from '../src/member-control.ts'
import type { LocalAgentAppliedConfiguration, LocalAgentMemberBinding } from '../src/types.ts'
import { LocalAgentRetryableStartError, RETRYABLE_START_FAILURE, isRetryableStartFailure } from '../src/types.ts'

const binding: LocalAgentMemberBinding = { childSessionId: 'member', provider: 'native', parentSessionId: 'parent', cwd: '/home/user/work', model: 'initial' }
function mount(records = new Map<string, MemberControlRecord>()) {
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
  return { controls, records, prepare, factory, errors, defaults: (value: string) => { defaultModel = value } }
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

  it('awaits durable admission and rechecks cancellation before native startup', async () => {
    const m = mount()
    let release!: () => void
    let entered!: () => void
    const writing = new Promise<void>(resolve => { release = resolve })
    const admitted = new Promise<void>(resolve => { entered = resolve })
    const abort = new AbortController()
    const start = vi.fn(async () => ({ result: Promise.resolve() } as unknown as SubagentRun))
    const pending = m.controls.run(binding, start, abort.signal, async () => { entered(); await writing })
    const rejected = expect(pending).rejects.toThrow('cancel during persistence')
    await admitted
    expect(start).not.toHaveBeenCalled()
    abort.abort(new Error('cancel during persistence'))
    release()
    await rejected
    expect(start).not.toHaveBeenCalled()
    expect(m.controls.get(binding).read().status).toBe('idle')
    expect(m.controls.get(binding).read().round).toBeUndefined()
    await m.controls.run(binding, start)
    expect(start).toHaveBeenCalledOnce()
  })

  it('rejects asynchronous persistence failures before native startup', async () => {
    const m = mount()
    const start = vi.fn(async () => ({ result: Promise.resolve() } as unknown as SubagentRun))
    await expect(m.controls.run(binding, start, undefined, async () => {
      await Promise.resolve()
      throw new Error('durable room edge failed')
    })).rejects.toThrow('durable room edge failed')
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

/**
 * 11-04 (prod): a host restart mid-round left a Kimi member's native session
 * locked; its next start failed before any prompt and the member then failed
 * every round in 0 ms until 对账并重试. A provider marks such a start failure
 * retryable; the core retries it at the member's NEXT admission, never re-runs
 * the failed round, and never retries anything after the run was returned.
 */
describe('retryable native-start failures', () => {
  const ok = () => ({ result: Promise.resolve() } as unknown as SubagentRun)

  it('a retryable start failure is retried by the next admission, also after a restart', async () => {
    const m = mount()
    const control = m.controls.get(binding)
    let attempts = 0
    const start = vi.fn(async () => {
      attempts++
      if (attempts === 1) throw new LocalAgentRetryableStartError('上一个进程还没退出')
      return ok()
    })
    await expect(m.controls.run(binding, start)).rejects.toThrow('上一个进程还没退出')
    expect(control.read()).toMatchObject({ status: 'failed', error: '上一个进程还没退出' })
    expect(control.startFailed()).toBe(true)
    // The failed round is not re-run on its own.
    await Promise.resolve()
    expect(start).toHaveBeenCalledOnce()
    // The next admission retries, with no user action, across a host restart.
    const restarted = mount(m.records)
    await restarted.controls.run(binding, start)
    expect(start).toHaveBeenCalledTimes(2)
    expect(restarted.controls.get(binding).read().status).not.toBe('failed')
  })

  it('a still-retryable failure stays retryable; each admission tries once', async () => {
    const m = mount()
    const start = vi.fn(async () => { throw new LocalAgentRetryableStartError('still in use') })
    await expect(m.controls.run(binding, start)).rejects.toThrow('still in use')
    await expect(m.controls.run(binding, start)).rejects.toThrow('still in use')
    expect(start).toHaveBeenCalledTimes(2)
    expect(m.controls.get(binding).read().status).toBe('failed')
  })

  it('a plain start failure waits for the user: the next admission fails at once without starting', async () => {
    const m = mount()
    const start = vi.fn(async () => { throw new Error('This session is in use') })
    await expect(m.controls.run(binding, start)).rejects.toThrow('in use')
    await expect(m.controls.run(binding, start)).rejects.toThrow('in use')
    expect(start).toHaveBeenCalledOnce()
    const control = m.controls.get(binding)
    expect(control.startFailed()).toBe(true)
    await control.retry(control.read().revision)
    await expect(m.controls.run(binding, start)).rejects.toThrow('in use')
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('never retries started work: a retryable error after the run was returned changes nothing', async () => {
    const m = mount()
    const start = vi.fn(async () => ({ result: Promise.reject(new LocalAgentRetryableStartError('late')) } as unknown as SubagentRun))
    const run = await m.controls.run(binding, start)
    await expect(run.result).rejects.toThrow('late')
    await Promise.resolve()
    expect(start).toHaveBeenCalledOnce()
    expect(m.controls.get(binding).read().status).not.toBe('failed')
  })

  it('a cancelled start is neither failed nor retried', async () => {
    const m = mount()
    const abort = new AbortController()
    const start = vi.fn(async () => { abort.abort(); throw new LocalAgentRetryableStartError('cancelled while starting') })
    await expect(m.controls.run(binding, start, abort.signal)).rejects.toThrow('cancelled')
    expect(m.controls.get(binding).read().status).toBe('idle')
    expect(start).toHaveBeenCalledOnce()
  })

  it('a failed selection is not a failed start', async () => {
    const m = mount()
    const control = m.controls.get(binding)
    m.prepare.mockImplementation(async () => { throw new Error('selection refused') })
    await control.select('pick', control.read().revision, { model: { mode: 'value', value: 'other' }, effort: { mode: 'inherit' } })
    await vi.waitFor(() => expect(control.read().status).toBe('failed'))
    expect(control.read().pending).toBeDefined()
    expect(control.startFailed()).toBe(false)
  })

  it('reads the mark by brand, through a wrapper\'s cause, without importing the class', () => {
    expect(isRetryableStartFailure(new LocalAgentRetryableStartError('x'))).toBe(true)
    expect(isRetryableStartFailure(Object.assign(new Error('x'), { [RETRYABLE_START_FAILURE]: true }))).toBe(true)
    expect(isRetryableStartFailure(new Error('wrapped', { cause: new LocalAgentRetryableStartError('x') }))).toBe(true)
    expect(isRetryableStartFailure(new Error('x'))).toBe(false)
    expect(isRetryableStartFailure(Object.assign(new Error('x'), { [RETRYABLE_START_FAILURE]: 'yes' }))).toBe(false)
    // A provider error that says it failed before any prompt (Kimi's KimiSessionOccupiedError shape).
    class Occupied extends Error { readonly beforePrompt = true }
    expect(isRetryableStartFailure(new Occupied('in use'))).toBe(true)
    expect(isRetryableStartFailure(Object.assign(new Error('x'), { beforePrompt: false }))).toBe(false)
    expect(isRetryableStartFailure(undefined)).toBe(false)
  })
})
