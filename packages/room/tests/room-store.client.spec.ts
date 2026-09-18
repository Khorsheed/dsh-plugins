// @vitest-environment jsdom
/** The client room store: first pull, cache reads, mutation refresh, and the running-only poll. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { ROOM_LIVE_REFRESH_DEBOUNCE_MS, ROOM_POLL_INTERVAL_MS, RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import type { RoomState } from '../src/types.ts'

const IDLE_ROOM: RoomState = { members: [], relays: [], tasks: [], runs: [] }
const RUNNING_ROOM: RoomState = {
  members: [{ name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' }],
  relays: [],
  tasks: [],
  runs: [{ member: 'ada', state: 'running', startedAt: 1 }],
}

/** The sessions-list double: the 0.1.5 `current` plus alpha.2's per-row retention (both read paths exercised). */
interface ListDouble {
  current: SessionId | undefined
  byId: Record<SessionId, { id: SessionId; retainedBy?: { mainView?: number } }>
}

interface Bench {
  list: ReturnType<typeof createSnapshotStore<ListDouble>>
  /** sessionId → the client session's live conversation feed (undefined = unbound). */
  live: Map<SessionId, ReturnType<typeof createSnapshotStore<{ tick: number }>>>
  gateway: RoomGateway & { isRoom: ReturnType<typeof vi.fn>; getState: ReturnType<typeof vi.fn> }
  store: RoomStore
}

function bench(): Bench {
  const list = createSnapshotStore<ListDouble>({ current: undefined, byId: {} })
  const live = new Map<SessionId, ReturnType<typeof createSnapshotStore<{ tick: number }>>>()
  const ctx = {
    sessions: {
      list,
      binding: (id: SessionId) => {
        const feed = live.get(id)
        return feed === undefined ? undefined : { sessionId: id, session: feed }
      },
    },
  } as unknown as Context
  const gateway = {
    // The stub verdict: sessions whose id starts with 'room' are rooms.
    isRoom: vi.fn(async ({ sessionId }: { sessionId: SessionId }) => ({
      ok: true as const, value: sessionId.startsWith('room'),
    })),
    getState: vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: IDLE_ROOM } })),
  }
  return { list, live, gateway, store: new RoomStore(ctx, gateway) }
}

/** Register a live conversation feed for a session and poke it once. */
function poke(b: Bench, sessionId: SessionId): void {
  let feed = b.live.get(sessionId)
  if (feed === undefined) {
    feed = createSnapshotStore({ tick: 0 })
    b.live.set(sessionId, feed)
  }
  feed.update((draft) => { draft.tick += 1 })
}

describe('RoomStore', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads undefined before the first pull (the selector declines)', async () => {
    const { store } = bench()
    expect(store.isRoomCached('room-1' as SessionId)).toBeUndefined()
    expect(store.getCached('room-1' as SessionId)).toBeUndefined()
  })

  it('ensure fills the verdict and pulls the state for rooms only', async () => {
    const { store, gateway } = bench()
    await store.ensure('room-1' as SessionId)
    expect(store.isRoomCached('room-1' as SessionId)).toBe(true)
    expect(store.getCached('room-1' as SessionId)).toEqual(IDLE_ROOM)

    await store.ensure('plain' as SessionId)
    expect(store.isRoomCached('plain' as SessionId)).toBe(false)
    expect(store.getCached('plain' as SessionId)).toBeUndefined()
    // One isRoom call per session; getState only for the room.
    expect(gateway.isRoom).toHaveBeenCalledTimes(2)
    expect(gateway.getState).toHaveBeenCalledTimes(1)
  })

  it('refresh replaces the cached state and notifies subscribers', async () => {
    const { store, gateway } = bench()
    const listener = vi.fn()
    store.subscribe(listener)
    await store.refresh('room-1' as SessionId)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getCached('room-1' as SessionId)).toEqual(IDLE_ROOM)

    gateway.getState.mockResolvedValue({ ok: true, value: { ok: true, value: RUNNING_ROOM } } as never)
    await store.refresh('room-1' as SessionId)
    expect(store.getCached('room-1' as SessionId)).toEqual(RUNNING_ROOM)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('follows the current session into its first pull', async () => {
    const { list, store, gateway } = bench()
    const dispose = store.start()
    list.update((draft) => { draft.current = 'room-1' as SessionId })
    await vi.waitFor(() => { expect(gateway.isRoom).toHaveBeenCalledWith({ sessionId: 'room-1' }) })
    await vi.waitFor(() => { expect(store.isRoomCached('room-1' as SessionId)).toBe(true) })
    dispose()
  })

  it('follows the alpha.2 main-view retention row when the legacy current is absent', async () => {
    const { list, store, gateway } = bench()
    const dispose = store.start()
    list.update((draft) => {
      draft.byId['room-1' as SessionId] = { id: 'room-1' as SessionId, retainedBy: { mainView: 1 } }
    })
    await vi.waitFor(() => { expect(gateway.isRoom).toHaveBeenCalledWith({ sessionId: 'room-1' }) })
    await vi.waitFor(() => { expect(store.isRoomCached('room-1' as SessionId)).toBe(true) })
    dispose()
  })

  it('polls only while the current room has a running member', async () => {
    vi.useFakeTimers()
    const { list, store, gateway } = bench()
    gateway.getState.mockResolvedValue({ ok: true, value: { ok: true, value: RUNNING_ROOM } } as never)
    const dispose = store.start()
    list.update((draft) => { draft.current = 'room-1' as SessionId })
    await vi.advanceTimersByTimeAsync(0)
    const baseline = gateway.getState.mock.calls.length
    expect(baseline).toBeGreaterThan(0)

    // Running member → the poll ticks.
    await vi.advanceTimersByTimeAsync(ROOM_POLL_INTERVAL_MS)
    expect(gateway.getState.mock.calls.length).toBe(baseline + 1)

    // The member settles → the next refresh stops the poll.
    gateway.getState.mockResolvedValue({ ok: true, value: { ok: true, value: IDLE_ROOM } } as never)
    await vi.advanceTimersByTimeAsync(ROOM_POLL_INTERVAL_MS)
    const settled = gateway.getState.mock.calls.length
    await vi.advanceTimersByTimeAsync(ROOM_POLL_INTERVAL_MS * 3)
    expect(gateway.getState.mock.calls.length).toBe(settled)
    dispose()
  })

  it('never polls an idle room or a non-room current session', async () => {
    vi.useFakeTimers()
    const { list, store, gateway } = bench()
    const dispose = store.start()
    list.update((draft) => { draft.current = 'room-1' as SessionId })
    await vi.advanceTimersByTimeAsync(0)
    const afterFirstPull = gateway.getState.mock.calls.length
    await vi.advanceTimersByTimeAsync(ROOM_POLL_INTERVAL_MS * 3)
    expect(gateway.getState.mock.calls.length).toBe(afterFirstPull)
    dispose()
  })

  it('dispose stops the poll', async () => {
    vi.useFakeTimers()
    const { list, store, gateway } = bench()
    gateway.getState.mockResolvedValue({ ok: true, value: { ok: true, value: RUNNING_ROOM } } as never)
    const dispose = store.start()
    list.update((draft) => { draft.current = 'room-1' as SessionId })
    await vi.advanceTimersByTimeAsync(0)
    dispose()
    const count = gateway.getState.mock.calls.length
    await vi.advanceTimersByTimeAsync(ROOM_POLL_INTERVAL_MS * 2)
    expect(gateway.getState.mock.calls.length).toBe(count)
  })

  it('a live-feed nudge on the current room refreshes, debounced', async () => {
    vi.useFakeTimers()
    const b = bench()
    const { list, store, gateway } = b
    const dispose = store.start()
    poke(b, 'room-1' as SessionId)
    list.update((draft) => { draft.current = 'room-1' as SessionId })
    await vi.advanceTimersByTimeAsync(0)
    const baseline = gateway.getState.mock.calls.length
    expect(baseline).toBeGreaterThan(0)

    // A burst of host-side journal appends coalesces into ONE pull.
    poke(b, 'room-1' as SessionId)
    await vi.advanceTimersByTimeAsync(ROOM_LIVE_REFRESH_DEBOUNCE_MS / 2)
    poke(b, 'room-1' as SessionId)
    await vi.advanceTimersByTimeAsync(ROOM_LIVE_REFRESH_DEBOUNCE_MS / 2)
    expect(gateway.getState.mock.calls.length).toBe(baseline)
    await vi.advanceTimersByTimeAsync(ROOM_LIVE_REFRESH_DEBOUNCE_MS)
    expect(gateway.getState.mock.calls.length).toBe(baseline + 1)
    dispose()
  })

  it('a live nudge on a cached non-room re-probes the verdict (promotion flips the cache)', async () => {
    vi.useFakeTimers()
    const b = bench()
    const { list, store, gateway } = b
    const dispose = store.start()
    poke(b, 'plain-1' as SessionId)
    list.update((draft) => { draft.current = 'plain-1' as SessionId })
    await vi.advanceTimersByTimeAsync(0)
    expect(store.isRoomCached('plain-1' as SessionId)).toBe(false)
    const stateCalls = gateway.getState.mock.calls.length
    const probeCalls = gateway.isRoom.mock.calls.length

    // A nudge on the plain session re-probes (debounced) but never pulls state.
    poke(b, 'plain-1' as SessionId)
    await vi.advanceTimersByTimeAsync(ROOM_LIVE_REFRESH_DEBOUNCE_MS * 2)
    expect(gateway.isRoom.mock.calls.length).toBe(probeCalls + 1)
    expect(gateway.getState.mock.calls.length).toBe(stateCalls)

    // The promotion lands host-side: the next re-probe flips the cache and
    // pulls the state — and the promotion hook fires (the client re-registers
    // the composer entry off it, re-electing the outlet).
    const onPromoted = vi.fn()
    store.onPromoted = onPromoted
    gateway.isRoom.mockResolvedValue({ ok: true, value: true } as never)
    poke(b, 'plain-1' as SessionId)
    await vi.advanceTimersByTimeAsync(ROOM_LIVE_REFRESH_DEBOUNCE_MS * 2)
    expect(store.isRoomCached('plain-1' as SessionId)).toBe(true)
    expect(store.getCached('plain-1' as SessionId)).toEqual(IDLE_ROOM)
    expect(onPromoted).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('dispose unsubscribes the live feed and drops a pending nudge', async () => {
    vi.useFakeTimers()
    const b = bench()
    const { list, store, gateway } = b
    const dispose = store.start()
    poke(b, 'room-1' as SessionId)
    list.update((draft) => { draft.current = 'room-1' as SessionId })
    await vi.advanceTimersByTimeAsync(0)
    const baseline = gateway.getState.mock.calls.length

    poke(b, 'room-1' as SessionId)
    dispose()
    await vi.advanceTimersByTimeAsync(ROOM_LIVE_REFRESH_DEBOUNCE_MS * 4)
    expect(gateway.getState.mock.calls.length).toBe(baseline)
    poke(b, 'room-1' as SessionId)
    await vi.advanceTimersByTimeAsync(ROOM_LIVE_REFRESH_DEBOUNCE_MS * 4)
    expect(gateway.getState.mock.calls.length).toBe(baseline)
  })
})
