import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveFlush } from '../src/live-flush.ts'

afterEach(() => { vi.useRealTimers() })

describe('live mirror bounded flush', () => {
  it('publishes a sparse tail without waiting for another delta', () => {
    vi.useFakeTimers()
    const publish = vi.fn()
    const flush = new LiveFlush(vi.fn())
    flush.schedule(1, publish)
    vi.advanceTimersByTime(49)
    expect(publish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(publish).toHaveBeenCalledOnce()
    flush.dispose()
  })

  it('coalesces a burst without extending its deadline and keeps items independent', () => {
    vi.useFakeTimers()
    const seen: string[] = []
    const flush = new LiveFlush(vi.fn())
    flush.schedule(1, () => seen.push('a'))
    vi.advanceTimersByTime(30)
    flush.schedule(1, () => seen.push('ab'))
    flush.schedule(2, () => seen.push('tool-result'))
    vi.advanceTimersByTime(20)
    expect(seen).toEqual(['ab'])
    vi.advanceTimersByTime(30)
    expect(seen).toEqual(['ab', 'tool-result'])
    flush.dispose()
  })

  it('does not publish stale partial content after finalization or disposal', () => {
    vi.useFakeTimers()
    const publish = vi.fn()
    const flush = new LiveFlush(vi.fn())
    flush.schedule(1, publish)
    flush.cancel(1)
    flush.schedule(2, publish)
    flush.dispose()
    flush.schedule(3, publish)
    vi.runAllTimers()
    expect(publish).not.toHaveBeenCalled()
  })

  it('reports timer failures and permits a subsequent update', () => {
    vi.useFakeTimers()
    const error = new Error('mirror unavailable')
    const onError = vi.fn()
    const publish = vi.fn()
    const flush = new LiveFlush(onError)
    flush.schedule(1, () => { throw error })
    vi.advanceTimersByTime(50)
    expect(onError).toHaveBeenCalledWith(error)
    flush.schedule(1, publish)
    vi.advanceTimersByTime(50)
    expect(publish).toHaveBeenCalledOnce()
    flush.dispose()
  })
})
