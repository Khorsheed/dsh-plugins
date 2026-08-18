/**
 * Client-side room state store: the synchronous cache the composer chain
 * selector reads (selectors cannot await), plus the per-session RoomState
 * the room components render. Fed by the mounted room Remote: a first pull
 * (`isRoom`, then `getState` when true) per session, a refresh after every
 * own mutation, and — phase-1 simplification, NO realtime subscription — a
 * light 2s poll of `getState` only while the CURRENT session is a room with
 * a running member (no running members, no polling). A cache miss reads as
 * `undefined`, and the composer selector declines on a miss: the first
 * instant of a freshly opened room shows the official input bar until the
 * first pull lands (accepted, documented).
 * @module @khorsheed/dsh-room/client/room-store
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  RoomGetStateRequest, RoomGetStateResult, RoomIsRoomRequest, RoomState,
} from '../types.ts'

/** The slice of the mounted room Remote the store reads. */
export interface RoomGateway {
  isRoom(request: RoomIsRoomRequest): Promise<RemoteResult<boolean>>
  getState(request: RoomGetStateRequest): Promise<RemoteResult<RoomGetStateResult>>
}

/** Poll cadence while the current room has running members. */
export const ROOM_POLL_INTERVAL_MS = 2_000

export class RoomStore {
  private readonly room = new Map<SessionId, boolean>()
  private readonly states = new Map<SessionId, RoomState>()
  private readonly listeners = new Set<() => void>()
  private poller: ReturnType<typeof setInterval> | undefined
  private current: SessionId | undefined

  /**
   * @param ctx - client root context (the sessions list feed).
   * @param gateway - the mounted room Remote, undefined when the mount failed.
   */
  constructor(
    private readonly ctx: ClientContext,
    private readonly gateway: RoomGateway | undefined,
  ) {}

  /**
   * Follow the current session: a new current room session gets its first
   * pull, and polling re-evaluates on every switch.
   * @returns disposer (unsubscribe + stop polling).
   */
  start(): () => void {
    const unsubscribe = this.ctx.sessions.list.subscribe(() => {
      const current = this.ctx.sessions.list.getSnapshot().current
      if (current === this.current) return
      this.current = current
      if (current !== undefined) void this.ensure(current)
      this.adjustPolling()
    })
    const current = this.ctx.sessions.list.getSnapshot().current
    if (current !== undefined) {
      this.current = current
      void this.ensure(current)
    }
    return () => {
      unsubscribe()
      this.stopPolling()
    }
  }

  /**
   * The composer selector's synchronous read.
   * @param sessionId - session to probe.
   * @returns cached verdict, or undefined while the first pull is in flight.
   */
  isRoomCached(sessionId: SessionId): boolean | undefined {
    return this.room.get(sessionId)
  }

  /**
   * The cached room state (stable reference between refreshes — safe as a
   * useSyncExternalStore snapshot).
   * @param sessionId - room session.
   * @returns the cached state, or undefined before the first successful pull.
   */
  getCached(sessionId: SessionId): RoomState | undefined {
    return this.states.get(sessionId)
  }

  /**
   * Subscribe to cache changes.
   * @param listener - called after any map mutation.
   * @returns unsubscribe.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * First pull for a session: isRoom, then getState when it is one.
   * No-ops on a cached verdict.
   * @param sessionId - session to ensure.
   */
  async ensure(sessionId: SessionId): Promise<void> {
    if (this.room.has(sessionId) || this.gateway === undefined) return
    const carried = await this.gateway.isRoom({ sessionId })
    const verdict = carried.ok && carried.value
    this.room.set(sessionId, verdict)
    if (!verdict) {
      this.notify()
      return
    }
    await this.refresh(sessionId)
  }

  /**
   * Re-pull the room state (after an own mutation, or a poll tick).
   * @param sessionId - room session.
   */
  async refresh(sessionId: SessionId): Promise<void> {
    if (this.gateway === undefined) return
    const carried = await this.gateway.getState({ sessionId })
    if (!carried.ok || !carried.value.ok) return
    this.room.set(sessionId, true)
    this.states.set(sessionId, carried.value.value)
    this.notify()
    this.adjustPolling()
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  private adjustPolling(): void {
    const running = this.current !== undefined
      && this.room.get(this.current) === true
      && (this.states.get(this.current)?.runs.some(entry => entry.state === 'running') ?? false)
    if (running && this.poller === undefined) {
      this.poller = setInterval(() => {
        if (this.current !== undefined) void this.refresh(this.current)
      }, ROOM_POLL_INTERVAL_MS)
    } else if (!running) {
      this.stopPolling()
    }
  }

  private stopPolling(): void {
    if (this.poller !== undefined) clearInterval(this.poller)
    this.poller = undefined
  }
}
