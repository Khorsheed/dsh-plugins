import { describe, expect, it } from 'vitest'
import { ModelDirectoryCache } from '../src/model-directory.ts'
import type { LocalAgentModelDirectoryData } from '../src/types.ts'

const data = (value: string): LocalAgentModelDirectoryData => ({
  entries: [{ value, label: value, source: 'native' }], complete: true, customInput: true,
})
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('shared model directory', () => {
  it('deduplicates cold reads and notifies an already-open picker on completion', async () => {
    const load = deferred<LocalAgentModelDirectoryData>()
    let calls = 0
    const cache = new ModelDirectoryCache({ load: async () => { calls++; return load.promise } })
    const abort = new AbortController()
    const reader = cache.follow('scope-a', abort.signal)[Symbol.asyncIterator]()
    expect((await reader.next()).value).toMatchObject({ status: 'loading', refreshing: true })
    const a = cache.refresh('scope-a')
    const b = cache.refresh('scope-a')
    expect(a).toBe(b)
    const update = reader.next()
    load.resolve(data('native-alias'))
    expect((await update).value).toMatchObject({ status: 'ready', entries: [{ value: 'native-alias' }] })
    expect(calls).toBe(1)
    abort.abort()
    expect((await reader.next()).done).toBe(true)
    cache.dispose()
  })

  it('keeps the last success on refresh failure and rate-limits subsequent failures', async () => {
    let now = 1
    let calls = 0
    const cache = new ModelDirectoryCache({ now: () => now, ttlMs: 10, retryMs: 5, load: async () => {
      if (++calls > 1) throw new Error('native directory unavailable')
      return data('a')
    } })
    await cache.refresh('scope-a')
    now = 11
    expect(cache.read('scope-a')).toMatchObject({ status: 'stale', refreshing: true })
    const failed = await cache.refresh('scope-a')
    expect(failed).toMatchObject({ status: 'stale', refreshing: false, refreshedAt: 1, entries: [{ value: 'a' }], reason: 'native directory unavailable' })
    cache.read('scope-a')
    expect(calls).toBe(2)
    now = 16
    cache.read('scope-a')
    await cache.refresh('scope-a')
    expect(calls).toBe(3)
    cache.dispose()
  })

  it('fences an invalidated probe and isolates different accounts', async () => {
    const old = deferred<LocalAgentModelDirectoryData>()
    let firstSignal: AbortSignal | undefined
    let calls = 0
    const cache = new ModelDirectoryCache({ load: async (key, signal) => {
      if (++calls === 1) { firstSignal = signal; return old.promise }
      return data(key)
    } })
    const stale = cache.refresh('a')
    await Promise.resolve()
    cache.invalidate('a')
    expect(firstSignal?.aborted).toBe(true)
    await cache.refresh('a')
    await cache.refresh('b')
    old.resolve(data('wrong-account'))
    await stale
    expect(cache.read('a').entries[0]?.value).toBe('a')
    expect(cache.read('b').entries[0]?.value).toBe('b')
    cache.dispose()
  })

  it('distinguishes unsupported, successful empty, and failed directories', async () => {
    const cache = new ModelDirectoryCache({ load: async key => {
      if (key === 'failed') throw new Error('probe failed')
      return { entries: [], complete: key === 'empty', customInput: true, ...key === 'old-cli' ? { unsupported: true } : {} }
    } })
    expect((await cache.refresh('empty')).status).toBe('ready')
    expect((await cache.refresh('old-cli')).status).toBe('unsupported')
    expect((await cache.refresh('failed')).status).toBe('error')
    cache.dispose()
  })
})
