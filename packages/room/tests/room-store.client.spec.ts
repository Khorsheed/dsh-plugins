// @vitest-environment jsdom
/** The client room store: first pull, cache reads, mutation refresh, and the running-only poll. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { ROOM_POLL_INTERVAL_MS, RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import type { RoomState } from '../src/types.ts'

const IDLE_ROOM: RoomState = { members: [], blackboard: [], cursors: [], runs: [] }
const RUNNING_ROOM: RoomState = {
  members: [{ name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' }],
  blackboard: [],
  cursors: [],
  runs: [{ member: 'ada', state: 'running', startedAt: 1 }],
}

interface Bench {
  list: ReturnType<typeof createSnapshotStore<{ current: SessionId | undefined }>>
  gateway: RoomGateway & { isRoom: ReturnType<typeof vi.fn>; getState: ReturnType<typeof vi.fn> }
  store: RoomStore
}

function bench(): Bench {
  const list = createSnapshotStore<{ current: SessionId | undefined }>({ current: undefined })
  const ctx = { sessions: { list } } as unknown as ClientContext
  const gateway = {
    // The stub verdict: sessions whose id starts with 'room' are rooms.
    isRoom: vi.fn(async ({ sessionId }: { sessionId: SessionId }) => ({
      ok: true as const, value: sessionId.startsWith('room'),
    })),
    getState: vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: IDLE_ROOM } })),
  }
  return { list, gateway, store: new RoomStore(ctx, gateway) }
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
})
