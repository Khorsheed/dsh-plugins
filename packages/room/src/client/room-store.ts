/**
 * Client-side room state store: the synchronous cache the composer chain
 * selector reads (selectors cannot await), plus the per-session RoomState
 * the room components render. Fed by the mounted room Remote: a first pull
 * (`isRoom`, then `getState` when true) per session, a refresh after every
 * own mutation, a realtime refresh trigger off the current session's live
 * conversation feed, and a light 2s poll of `getState` only while the
 * CURRENT session is a room with a running member (no running members, no
 * polling). The live feed: the host pushes EVERY session event — room
 * journal appends included — as `session/event` frames, which the runtime
 * folds into the client Session's conversation snapshot; subscribing that
 * snapshot and refreshing (300ms debounced) is how host-side mutations the
 * client never initiated (the `room_task`/`room_invite` tools, the
 * local-agent member bridge) land in the dock within a beat. A cache miss
 * reads as `undefined`, and the composer selector declines on a miss: the
 * first instant of a freshly opened room shows the official input bar until
 * the first pull lands (accepted, documented).
 * @module @khorsheed/dsh-room/client/room-store
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
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

/**
 * Debounce coalescing the live-feed refresh: one room journal append usually
 * arrives inside a burst of session events (the tool call, its result, the
 * task/task-update edges), so the refresh waits for a quiet beat.
 */
export const ROOM_LIVE_REFRESH_DEBOUNCE_MS = 300

export class RoomStore {
  private readonly room = new Map<SessionId, boolean>()
  private readonly states = new Map<SessionId, RoomState>()
  private readonly listeners = new Set<() => void>()
  private poller: ReturnType<typeof setInterval> | undefined
  private current: SessionId | undefined
  /** The session the live feed is subscribed to (undefined = unattached). */
  private liveAttached: SessionId | undefined
  private liveUnsubscribe: (() => void) | undefined
  private liveTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param ctx - client root context (the sessions list feed).
   * @param gateway - the mounted room Remote, undefined when the mount failed.
   */
  constructor(
    private readonly ctx: Context,
    private readonly gateway: RoomGateway | undefined,
  ) {}

  /**
   * Follow the current session: a new current room session gets its first
   * pull and its live-feed subscription, and polling re-evaluates on every
   * switch.
   * @returns disposer (unsubscribe everything + stop polling).
   */
  start(): () => void {
    const unsubscribe = this.ctx.sessions.list.subscribe(() => {
      const current = this.ctx.sessions.list.getSnapshot().current
      if (current === this.current) return
      this.current = current
      if (current !== undefined) void this.ensure(current)
      this.attachLive()
      this.adjustPolling()
    })
    const current = this.ctx.sessions.list.getSnapshot().current
    if (current !== undefined) {
      this.current = current
      void this.ensure(current)
      this.attachLive()
    }
    return () => {
      unsubscribe()
      this.detachLive()
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
    if (!carried.ok) return // A transport failure is not a non-room verdict.
    if (!carried.value) {
      this.room.set(sessionId, false)
      this.notify()
      return
    }
    await this.refresh(sessionId)
  }

  /**
   * Re-pull the room state (after an own mutation, a live-feed nudge, or a
   * poll tick).
   * @param sessionId - room session.
   */
  async refresh(sessionId: SessionId): Promise<void> {
    if (this.gateway === undefined) return
    const carried = await this.gateway.getState({ sessionId })
    if (!carried.ok || !carried.value.ok) return
    const was = this.room.get(sessionId)
    this.room.set(sessionId, true)
    this.states.set(sessionId, carried.value.value)
    this.notify()
    // A promotion flip (unknown/non-room → room) must re-elect the composer.
    if (was !== true) this.onPromoted?.()
    // A completed pull is also the binding-availability retry point: the
    // runtime may mint the session's binding after the list's current flip.
    this.attachLive()
    this.adjustPolling()
  }

  /**
   * Subscribe the CURRENT session's live conversation feed so host-side
   * journal appends nudge a refresh. The session binding is minted lazily by
   * the runtime (it can lag the list's current flip), so every completed pull
   * re-attempts the attach; an unattached store simply keeps its other
   * triggers until one lands.
   */
  private attachLive(): void {
    if (this.liveAttached === this.current && this.liveUnsubscribe !== undefined) return
    this.detachLive()
    if (this.current === undefined) return
    // Optional-call: the ISessions contract always provides binding, but a
    // test double is allowed to omit it (no live feed in that bench).
    const face = this.ctx.sessions.binding?.(this.current)?.session
    if (face === undefined) return
    this.liveUnsubscribe = face.subscribe(() => { this.onLiveEvent() })
    this.liveAttached = this.current
  }

  /** Drop the live-feed subscription and any pending debounced refresh. */
  private detachLive(): void {
    this.liveUnsubscribe?.()
    this.liveUnsubscribe = undefined
    this.liveAttached = undefined
    if (this.liveTimer !== undefined) clearTimeout(this.liveTimer)
    this.liveTimer = undefined
  }

  /**
   * One live-feed nudge, debounced so an event burst costs one probe: a known
   * room refreshes its state; a session cached NOT a room re-probes `isRoom`
   * (a promotion lands as a host-side `room/created` append the client never
   * initiated — the room_invite/room_message tools promote in place); a
   * unknown verdict retries ensure after the same debounce.
   */
  private onLiveEvent(): void {
    if (this.current === undefined) return
    if (this.liveTimer !== undefined) clearTimeout(this.liveTimer)
    this.liveTimer = setTimeout(() => {
      this.liveTimer = undefined
      const current = this.current
      if (current === undefined) return
      if (this.room.get(current) === true) {
        void this.refresh(current)
      } else if (this.room.get(current) === false) {
        void this.reprobe(current)
      } else {
        void this.ensure(current)
      }
    }, ROOM_LIVE_REFRESH_DEBOUNCE_MS)
  }

  /**
   * Re-probe a cached-non-room session's verdict: a promotion flips the cache
   * and pulls the state (the composer takeover follows on the next notify).
   * @param sessionId - the session whose verdict may have changed.
   */
  private async reprobe(sessionId: SessionId): Promise<void> {
    if (this.gateway === undefined) return
    const carried = await this.gateway.isRoom({ sessionId })
    if (!carried.ok || !carried.value) return
    // refresh flips the verdict and fires onPromoted on a unknown/false → true flip.
    await this.refresh(sessionId)
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  /**
   * Called when a session's verdict flips unknown/false → true (an in-place
   * promotion): the composer chain elects at RENDER time and nothing
   * re-renders the outlet for a promotion of an idle session, so the client
   * wires this to re-register the composer entry (a slot version bump
   * re-renders — and re-elects — the outlet).
   */
  onPromoted: (() => void) | undefined

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
