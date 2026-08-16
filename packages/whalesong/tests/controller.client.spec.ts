// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ObservableSnapshot, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { createWhalesongRuntime, RECONCILE_MS } from '../src/client/controller.ts'
import type { WhalesongSound } from '../src/client/sound.ts'

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
  /** Change the snapshot WITHOUT notifying (simulates a lost notification). */
  setSilent(next: SessionListState): void {
    this.snapshot = next
  }
}

interface FakeSound {
  readonly plays: WhalesongSound[]
  readonly volumes: number[]
  disposed: boolean
  setVolume(volume: number): void
  play(kind: WhalesongSound): void
  dispose(): void
}

interface FakeOverlay {
  disposed: boolean
  sync(): void
  dispose(): void
}

interface FakeFavicon {
  active: boolean
  disposed: boolean
  setActive(on: boolean): void
  dispose(): void
}

/** Runtime wired to fakes; tracks every created instance. */
function setup(initial: SessionListState): {
  list: FakeList
  sounds: FakeSound[]
  overlays: FakeOverlay[]
  favicons: FakeFavicon[]
  runtime: ReturnType<typeof createWhalesongRuntime>
} {
  const list = new FakeList(initial)
  const sounds: FakeSound[] = []
  const overlays: FakeOverlay[] = []
  const favicons: FakeFavicon[] = []
  const runtime = createWhalesongRuntime({
    doc: document,
    win: window,
    list,
    createOverlay: () => {
      const overlay: FakeOverlay = { disposed: false, sync() {}, dispose() { this.disposed = true } }
      overlays.push(overlay)
      return overlay
    },
    createSound: () => {
      const sound: FakeSound = {
        plays: [],
        volumes: [],
        disposed: false,
        setVolume(volume) { this.volumes.push(volume) },
        play(kind) { this.plays.push(kind) },
        dispose() { this.disposed = true },
      }
      sounds.push(sound)
      return sound as never
    },
    createFavicon: () => {
      const favicon: FakeFavicon = {
        active: false,
        disposed: false,
        setActive(on) { this.active = on },
        dispose() { this.disposed = true },
      }
      favicons.push(favicon)
      return favicon
    },
  })
  return { list, sounds, overlays, favicons, runtime }
}

describe('createWhalesongRuntime', () => {
  afterEach(() => {
    document.body.classList.remove('dsh-whalesong-on')
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('enabled start: overlay + sound + subscription, baseline fires no chime', () => {
    const { list, sounds, overlays, runtime } = setup(state({ a: { running: true } }))
    runtime.applyConfig({ enabled: true, volume: 1 })
    expect(overlays).toHaveLength(1)
    expect(sounds).toHaveLength(1)
    expect(sounds[0].volumes).toEqual([1])
    expect(list.listenerCount).toBe(1)
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(true)
    expect(sounds[0].plays).toEqual([])
    runtime.dispose()
  })

  it('drives chimes and the body class off session edges while enabled', () => {
    const { list, sounds, runtime } = setup(state({ a: { running: true } }))
    runtime.applyConfig({ enabled: true, volume: 1 })
    list.set(state({ a: { running: false } }))
    expect(sounds[0].plays).toEqual(['completed'])
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(false)
    list.set(state({ a: { running: true } }))
    list.set(state({ a: { running: true, pendingInteraction: 'approval' } }))
    expect(sounds[0].plays).toEqual(['completed', 'blocked'])
    runtime.dispose()
  })

  it('enabled=false leaves zero residue: no subscription, disposed halves, no body class', () => {
    const { list, sounds, overlays, favicons, runtime } = setup(state({ a: { running: true } }))
    runtime.applyConfig({ enabled: true, volume: 1 })
    expect(favicons[0].active).toBe(true)
    runtime.applyConfig({ enabled: false, volume: 1 })
    expect(list.listenerCount).toBe(0)
    expect(overlays[0].disposed).toBe(true)
    expect(sounds[0].disposed).toBe(true)
    expect(favicons[0].disposed).toBe(true) // original favicon restored
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(false)
    // further store activity is inert
    list.set(state({ a: { running: false } }))
    expect(sounds[0].plays).toEqual([])
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(false)
    // disabled config re-application stays inert
    runtime.applyConfig({ enabled: false, volume: 0.5 })
    expect(list.listenerCount).toBe(0)
    runtime.dispose()
  })

  it('reconcile poll clears the whalesong within one interval when a notify is lost', () => {
    vi.useFakeTimers()
    const { list, sounds, runtime } = setup(state({ a: { running: true } }))
    runtime.applyConfig({ enabled: true, volume: 1 })
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(true)
    list.setSilent(state({ a: { running: false } })) // notification lost (latch reproduction)
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(true) // no notify yet
    vi.advanceTimersByTime(RECONCILE_MS)
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(false)
    expect(sounds[0].plays).toEqual(['completed']) // completion edge still derived
    runtime.dispose()
  })

  it('reconcile poll short-circuits on an unchanged snapshot (no double chimes)', () => {
    vi.useFakeTimers()
    const { list, sounds, runtime } = setup(state({ a: { running: true } }))
    runtime.applyConfig({ enabled: true, volume: 1 })
    list.set(state({ a: { running: false } })) // notified once
    vi.advanceTimersByTime(RECONCILE_MS * 2) // poll sees the same snapshot
    expect(sounds[0].plays).toEqual(['completed'])
    runtime.dispose()
  })

  it('re-enable after a stop restarts cleanly with a fresh baseline', () => {
    const { list, sounds, overlays, runtime } = setup(state({ a: { running: true } }))
    runtime.applyConfig({ enabled: true, volume: 1 })
    runtime.applyConfig({ enabled: false, volume: 1 })
    runtime.applyConfig({ enabled: true, volume: 0.5 })
    expect(overlays).toHaveLength(2)
    expect(sounds).toHaveLength(2)
    expect(list.listenerCount).toBe(1)
    expect(sounds[1].volumes).toEqual([0.5])
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(true)
    // baseline again: the still-running session does not chime on restart
    expect(sounds[1].plays).toEqual([])
    list.set(state({ a: { running: false } }))
    expect(sounds[1].plays).toEqual(['completed'])
    runtime.dispose()
  })

  it('forwards volume changes to the live player without restarting', () => {
    const { list, sounds, overlays, runtime } = setup(state({ a: { running: true } }))
    runtime.applyConfig({ enabled: true, volume: 1 })
    runtime.applyConfig({ enabled: true, volume: 0.3 })
    expect(overlays).toHaveLength(1) // no restart
    expect(sounds[0].volumes).toEqual([1, 0.3])
    expect(list.listenerCount).toBe(1)
    runtime.dispose()
  })

  it('is idempotent: re-applying the same config keeps one subscription', () => {
    const { list, overlays, runtime } = setup(state({ a: { running: true } }))
    runtime.applyConfig({ enabled: true, volume: 1 })
    runtime.applyConfig({ enabled: true, volume: 1 })
    expect(overlays).toHaveLength(1)
    expect(list.listenerCount).toBe(1)
    runtime.dispose()
  })

  it('dispose from the stopped state is a safe no-op', () => {
    const { runtime } = setup(state({ a: { running: true } }))
    expect(() => {
      runtime.dispose()
      runtime.dispose()
    }).not.toThrow()
  })
})
