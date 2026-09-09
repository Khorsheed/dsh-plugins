// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { apply } from '../src/client/index.ts'

type RowSpec = Partial<SessionSummary> & { running: boolean }

/** Minimal SessionListState; only the fields whalesong reads are meaningful. */
function state(rows: Record<string, RowSpec>): SessionListState {
  const byId: Record<string, SessionSummary> = {}
  for (const [id, spec] of Object.entries(rows)) {
    byId[id] = { id, displayTitle: id, ...spec } as unknown as SessionSummary
  }
  return { ids: Object.keys(rows), byId, current: undefined, phase: 'ready', subagentsByParent: {} } as unknown as SessionListState
}

/** Controllable snapshot feed mirroring SnapshotStore's observable face. */
class FakeList implements ObservableSnapshot<SessionListState> {
  private readonly listeners = new Set<() => void>()
  constructor(private snapshot: SessionListState) {}
  getSnapshot(): SessionListState { return this.snapshot }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  get listenerCount(): number { return this.listeners.size }
  set(next: SessionListState): void {
    this.snapshot = next
    for (const fn of [...this.listeners]) fn()
  }
}

describe('whalesong client apply', () => {
  afterEach(() => {
    document.body.classList.remove('dsh-whalesong-on')
    document.body.innerHTML = ''
  })

  it('mounts the runtime, lights the whalesong on session edges, and tears down with the context', async () => {
    const list = new FakeList(state({}))
    const ctx = new Context()
    ctx.provide('sessions', { list } as never)
    apply(ctx)

    // The effect ran synchronously: the overlay is mounted, idle (no running
    // sessions), and the runtime subscribed to the list feed.
    expect(document.body.querySelector('div')).not.toBeNull()
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(false)
    expect(list.listenerCount).toBe(1)

    // A running session lights the whalesong through the real controller path.
    list.set(state({ a: { running: true } }))
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(true)
    list.set(state({ a: { running: false } }))
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(false)

    // Context teardown unwinds the effect: no overlay, no body class, no
    // subscription, no config poll.
    await ctx.fiber.dispose()
    expect(document.body.querySelector('div')).toBeNull()
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(false)
    expect(list.listenerCount).toBe(0)
  })

  it('applies a config delivered by the host route: disabled tears the runtime down', async () => {
    vi.stubGlobal('fetch', (() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ enabled: false, volume: 1 }),
    })) as unknown as typeof fetch)
    try {
      const list = new FakeList(state({ a: { running: true } }))
      const ctx = new Context()
      ctx.provide('sessions', { list } as never)
      apply(ctx)

      // Optimistic default (enabled) starts the runtime immediately...
      expect(document.body.querySelector('div')).not.toBeNull()
      expect(document.body.classList.contains('dsh-whalesong-on')).toBe(true)
      // ...and the first route response (disabled) tears it down through the
      // config-sync subscription: zero residue.
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(document.body.querySelector('div')).toBeNull()
      expect(document.body.classList.contains('dsh-whalesong-on')).toBe(false)
      expect(list.listenerCount).toBe(0)

      await ctx.fiber.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
