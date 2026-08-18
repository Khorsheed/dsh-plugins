/**
 * room host half: the `room` Typert Remote service. Step 0 spike surface:
 * `createRoom` mints a normal session and appends the `room/created` identity
 * marker (log-only custom event — persistence and reload-replay come free,
 * and harnesses without this plugin replay the session safely), and `isRoom`
 * recovers room identity from the event log. Member roster, dispatch, and the
 * blackboard land as further custom events in later steps.
 * @module @khorsheed/dsh-room
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `sessions` SessionStore merge onto Context.
import type {} from '@deepseek-ai/dsh-session'
// Type-only: pulls the `room/created` SessionEventMap merge.
import type {} from './types.ts'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { RoomCreateRequest, RoomCreateResult, RoomIsRoomRequest } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Room Remote owned by the room plugin. */
    room: RoomService
  }
}

/**
 * room Remote service: creates room sessions and answers room-identity
 * probes. A room IS a normal session; the marker event is its only
 * distinguishing state at this step.
 */
export class RoomService extends TypertRemoteService {
  static inject = ['sessions']

  /**
   * @param ctx - host context carrying the session store.
   */
  constructor(ctx: Context) {
    super(ctx, 'room')
  }

  /**
   * Probe whether a session is a room: replay its event log looking for the
   * `room/created` marker.
   * @param request - session identity.
   * @returns true when the session carries the marker (false for unknown sessions too).
   */
  @Remote('isRoom')
  isRoom(request: RoomIsRoomRequest): Promise<boolean> {
    const session = this.ctx.sessions.get(request.sessionId)
    return Promise.resolve(session?.events.some(event => event.type === 'room/created') ?? false)
  }

  /**
   * Create a room: mint a normal session, append the `room/created` identity
   * marker, and flush it durable.
   * @param request - optional storage metadata (cwd).
   * @returns the new room session's identity.
   */
  @Remote('createRoom')
  async createRoom(request: RoomCreateRequest): Promise<RoomCreateResult> {
    const session = this.ctx.sessions.create(undefined, {
      meta: request.cwd === undefined ? {} : { cwd: request.cwd },
    })
    session.append('room/created', { version: 1 })
    await this.ctx.sessions.flush(session)
    return { sessionId: session.id }
  }
}

export default RoomService
