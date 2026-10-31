import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemberContextStore, MemberToolRegistry, contextRatio, MEMBER_CONTEXT_POLL_MS } from '../src/client/member-tools.ts'
import { slashMatches } from '../src/client/MemberComposer.tsx'

afterEach(() => { vi.useRealTimers() })

describe('member tools', () => {
  it('slash matching offers /compact for a lone command prefix only', () => {
    expect(slashMatches('/').map(command => command.name)).toEqual(['compact'])
    expect(slashMatches('/com').map(command => command.name)).toEqual(['compact'])
    expect(slashMatches('/compact')).toEqual([])
    expect(slashMatches('/compact now')).toEqual([])
    expect(slashMatches('请 /com')).toEqual([])
  })

  it('the ratio needs both counts', () => {
    expect(contextRatio({ usedTokens: 100, contextWindow: 400 })).toBe(0.25)
    expect(contextRatio({ usedTokens: 100 })).toBeUndefined()
    expect(contextRatio(null)).toBeUndefined()
  })

  it('one poll per member however many surfaces subscribe; it stops with the last listener', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => ({ provider: 'kimi-cli', usedTokens: 1, contextWindow: 10, state: 'idle' as const }))
    const store = new MemberContextStore(read)
    const a = vi.fn()
    const offA = store.subscribe('child', a)
    const offB = store.subscribe('child', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(1)
    expect(store.get('child')).toMatchObject({ usedTokens: 1 })
    expect(a).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(MEMBER_CONTEXT_POLL_MS)
    expect(read).toHaveBeenCalledTimes(2)
    // An unchanged reading notifies nobody.
    expect(a).toHaveBeenCalledTimes(1)
    offA(); offB()
    await vi.advanceTimersByTimeAsync(MEMBER_CONTEXT_POLL_MS * 3)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('a stale disposer never evicts a newer registration', () => {
    const registry = new MemberToolRegistry()
    const first = registry.register({ id: 'guard', render: () => null })
    const second = { id: 'guard', render: () => 'x' }
    registry.register(second)
    first()
    expect(registry.tools()).toEqual([second])
  })
})
