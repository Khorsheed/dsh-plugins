/**
 * The quote action registry runtime: registration order = list order,
 * duplicate ids fail loud, disposal removes and notifies, the list reference
 * is stable between mutations (so it can serve as useSyncExternalStore's
 * getSnapshot), and a contribution's throwing faces are wrapped — reported
 * through onError, never propagated into the menu.
 */
import { describe, expect, it, vi } from 'vitest'
import { QuoteActionRegistryRuntime, type QuoteActionContribution, type QuoteActionTarget } from '../src/client/registry.ts'

/** A target in the shape the menu hands out. */
const TARGET = { text: '选中的话', label: '主会话', sessionId: 's-1' } as QuoteActionTarget

/** One minimal contribution. */
function action(id: string, over: Partial<QuoteActionContribution> = {}): QuoteActionContribution {
  return { id, label: () => `标签 ${id}`, run: vi.fn(), ...over }
}

describe('QuoteActionRegistryRuntime', () => {
  it('lists contributions in registration order and notifies subscribers', () => {
    const registry = new QuoteActionRegistryRuntime(vi.fn())
    const seen: number[] = []
    registry.subscribe(() => { seen.push(registry.list().length) })
    registry.registerAction(action('a.one'))
    registry.registerAction(action('b.two'))
    expect(registry.list().map(entry => entry.id)).toEqual(['a.one', 'b.two'])
    expect(seen).toEqual([1, 2])
  })

  it('rejects a duplicate id loudly', () => {
    const registry = new QuoteActionRegistryRuntime(vi.fn())
    registry.registerAction(action('a.one'))
    expect(() => registry.registerAction(action('a.one'))).toThrow(/already registered/)
    expect(registry.list()).toHaveLength(1)
  })

  it('disposal removes the row, notifies, and is idempotent', () => {
    const registry = new QuoteActionRegistryRuntime(vi.fn())
    const seen: number[] = []
    registry.subscribe(() => { seen.push(registry.list().length) })
    const dispose = registry.registerAction(action('a.one'))
    dispose()
    dispose()
    expect(registry.list()).toHaveLength(0)
    expect(seen).toEqual([1, 0])
  })

  it('keeps the list reference stable between mutations (getSnapshot-shaped)', () => {
    const registry = new QuoteActionRegistryRuntime(vi.fn())
    const before = registry.list()
    expect(registry.list()).toBe(before)
    registry.registerAction(action('a.one'))
    const after = registry.list()
    expect(after).not.toBe(before)
    expect(registry.list()).toBe(after)
  })

  it('wraps a throwing run: reported, never propagated', () => {
    const onError = vi.fn()
    const registry = new QuoteActionRegistryRuntime(onError)
    const failure = new Error('boom')
    registry.registerAction(action('a.one', {
      run: () => { throw failure },
    }))
    expect(() => registry.list()[0]?.run(TARGET)).not.toThrow()
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('wraps a throwing label: reported, degrades to the id', () => {
    const onError = vi.fn()
    const registry = new QuoteActionRegistryRuntime(onError)
    registry.registerAction(action('a.one', {
      label: () => { throw new Error('boom') },
    }))
    expect(registry.list()[0]?.label()).toBe('a.one')
    expect(onError).toHaveBeenCalledOnce()
  })

  it('wraps a throwing available: reported, hides the row', () => {
    const onError = vi.fn()
    const registry = new QuoteActionRegistryRuntime(onError)
    registry.registerAction(action('a.one', {
      available: () => { throw new Error('boom') },
    }))
    expect(registry.list()[0]?.available?.(TARGET)).toBe(false)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('passes the target through untouched and leaves an absent gate absent', () => {
    const registry = new QuoteActionRegistryRuntime(vi.fn())
    const run = vi.fn()
    registry.registerAction(action('a.one', { run }))
    const entry = registry.list()[0]
    expect(entry?.available).toBeUndefined()
    expect(entry?.icon).toBeUndefined()
    entry?.run(TARGET)
    expect(run).toHaveBeenCalledWith(TARGET)
  })
})
