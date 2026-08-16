// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConfigSync, DEFAULT_CLIENT_CONFIG, WHALESONG_CONFIG_PATH } from '../src/client/config.ts'

/** A fetch fake answering from a queue of payloads (Error = network failure). */
function fetchQueue(...steps: (object | Error | null)[]): { fetchImpl: typeof fetch; calls: number } {
  let calls = 0
  const fetchImpl = (() => {
    const step = steps[Math.min(calls, steps.length - 1)]
    calls += 1
    if (step instanceof Error) return Promise.reject(step)
    return Promise.resolve({ ok: true, json: () => Promise.resolve(step) } as Response)
  }) as unknown as typeof fetch
  return { fetchImpl, get calls() { return calls } }
}

const POLL_MS = 3000

describe('createConfigSync', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('serves the default config until the first response lands', async () => {
    vi.useFakeTimers()
    const { fetchImpl } = fetchQueue({ enabled: false, volume: 0.4 })
    const sync = createConfigSync(window, { fetchImpl, pollMs: POLL_MS })
    expect(sync.get()).toEqual(DEFAULT_CLIENT_CONFIG)
    await vi.advanceTimersByTimeAsync(0)
    expect(sync.get()).toEqual({ enabled: false, volume: 0.4 })
    sync.dispose()
  })

  it('polls on the configured interval', async () => {
    vi.useFakeTimers()
    const queue = fetchQueue({ enabled: true, volume: 1 })
    const sync = createConfigSync(window, { fetchImpl: queue.fetchImpl, pollMs: POLL_MS })
    await vi.advanceTimersByTimeAsync(0)
    expect(queue.calls).toBe(1)
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(queue.calls).toBe(2)
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(queue.calls).toBe(4)
    sync.dispose()
  })

  it('notifies subscribers only when the config actually changes, and unsubscribe stops delivery', async () => {
    vi.useFakeTimers()
    const { fetchImpl } = fetchQueue(
      { enabled: true, volume: 1 },
      { enabled: true, volume: 1 },
      { enabled: false, volume: 1 },
    )
    const sync = createConfigSync(window, { fetchImpl, pollMs: POLL_MS })
    const seen: unknown[] = []
    const unsubscribe = sync.subscribe((config) => { seen.push(config) })
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toEqual([]) // payload equals the default: no notification
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(seen).toEqual([]) // unchanged again
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(seen).toEqual([{ enabled: false, volume: 1 }])
    unsubscribe()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(seen).toEqual([{ enabled: false, volume: 1 }]) // no delivery after unsubscribe
    sync.dispose()
  })

  it('keeps the current config on fetch failure and malformed payloads', async () => {
    vi.useFakeTimers()
    const { fetchImpl } = fetchQueue(
      { enabled: false, volume: 0.4 },
      new Error('network down'),
      { enabled: 'yes', volume: 0.4 },
      null,
      { enabled: true },
    )
    const sync = createConfigSync(window, { fetchImpl, pollMs: POLL_MS })
    await vi.advanceTimersByTimeAsync(0)
    expect(sync.get()).toEqual({ enabled: false, volume: 0.4 })
    await vi.advanceTimersByTimeAsync(POLL_MS) // network error
    expect(sync.get()).toEqual({ enabled: false, volume: 0.4 })
    await vi.advanceTimersByTimeAsync(POLL_MS) // enabled not boolean
    expect(sync.get()).toEqual({ enabled: false, volume: 0.4 })
    await vi.advanceTimersByTimeAsync(POLL_MS) // payload not an object
    expect(sync.get()).toEqual({ enabled: false, volume: 0.4 })
    await vi.advanceTimersByTimeAsync(POLL_MS) // volume missing → default 1
    expect(sync.get()).toEqual({ enabled: true, volume: 1 })
    sync.dispose()
  })

  it('keeps the current config when the route answers non-OK', async () => {
    vi.useFakeTimers()
    let calls = 0
    const fetchImpl = (() => {
      calls += 1
      return Promise.resolve({ ok: calls !== 1, json: () => Promise.resolve({ enabled: false, volume: 0.4 }) } as Response)
    }) as unknown as typeof fetch
    const sync = createConfigSync(window, { fetchImpl, pollMs: POLL_MS })
    await vi.advanceTimersByTimeAsync(0) // ok: false → keep default
    expect(sync.get()).toEqual(DEFAULT_CLIENT_CONFIG)
    await vi.advanceTimersByTimeAsync(POLL_MS) // ok: true → applied
    expect(sync.get()).toEqual({ enabled: false, volume: 0.4 })
    sync.dispose()
  })

  it('clamps out-of-range volume into 0..1 in both directions', async () => {
    vi.useFakeTimers()
    const { fetchImpl } = fetchQueue({ enabled: true, volume: 7 }, { enabled: true, volume: -3 })
    const sync = createConfigSync(window, { fetchImpl, pollMs: POLL_MS })
    await vi.advanceTimersByTimeAsync(0)
    expect(sync.get()).toEqual({ enabled: true, volume: 1 })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(sync.get()).toEqual({ enabled: true, volume: 0 })
    sync.dispose()
  })

  it('dispose stops the poll loop', async () => {
    vi.useFakeTimers()
    const queue = fetchQueue({ enabled: true, volume: 1 })
    const sync = createConfigSync(window, { fetchImpl: queue.fetchImpl, pollMs: POLL_MS })
    await vi.advanceTimersByTimeAsync(0)
    sync.dispose()
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(queue.calls).toBe(1)
  })

  it('honors a route path override', async () => {
    vi.useFakeTimers()
    const requested: string[] = []
    const fetchImpl = ((path: string) => {
      requested.push(path)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: true, volume: 1 }) } as Response)
    }) as unknown as typeof fetch
    const sync = createConfigSync(window, { fetchImpl, pollMs: POLL_MS, path: '/custom/whalesong' })
    await vi.advanceTimersByTimeAsync(0)
    expect(requested).toEqual(['/custom/whalesong'])
    expect(requested).not.toContain(WHALESONG_CONFIG_PATH)
    sync.dispose()
  })

  it('keeps the default config and never polls when the surface has no fetch', async () => {
    vi.useFakeTimers()
    let intervals = 0
    const fakeWin = {
      setInterval: () => { intervals += 1; return 1 },
      clearInterval: () => {},
    } as unknown as Window
    const sync = createConfigSync(fakeWin)
    expect(sync.get()).toEqual(DEFAULT_CLIENT_CONFIG)
    const seen: unknown[] = []
    const unsubscribe = sync.subscribe((config) => { seen.push(config) })
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(intervals).toBe(0) // no poll loop without fetch
    expect(seen).toEqual([]) // and no config ever arrives
    unsubscribe()
    sync.dispose()
    expect(sync.get()).toEqual(DEFAULT_CLIENT_CONFIG)
  })
})
