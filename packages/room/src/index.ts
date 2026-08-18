/**
 * room host half: the `room` Typert Remote service. The room's entire state
 * is the session's `room/*` custom-event journal (log-only events —
 * persistence and reload-replay come free, the model never sees them, and
 * harnesses without this plugin replay the session safely); every read folds
 * the journal through the pure replay, and every mutating Remote appends and
 * flushes. The dispatch engine (next step) turns `room/dispatch` records and
 * pending first tasks into member runs.
 * @module @khorsheed/dsh-room
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `sessions` SessionStore merge onto Context.
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session'
// Type-only: pulls the `room/*` SessionEventMap merges.
import type {} from './types.ts'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { isRoomLog, parseMentions, replay } from './journal.ts'
import type {
  RoomCreateRequest, RoomCreateResult, RoomFailure,
  RoomGetStateRequest, RoomGetStateResult,
  RoomInviteRequest, RoomInviteResult,
  RoomIsRoomRequest,
  RoomPostMessageRequest, RoomPostMessageResult,
  RoomRemoveMemberRequest, RoomRemoveMemberResult,
  RoomState, RoomUpdateMemberRequest, RoomUpdateMemberResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Room Remote owned by the room plugin. */
    room: RoomService
  }
}

/** A resolved room session plus its replayed state, or the rejection. */
type RoomLoad =
  | { readonly ok: true; readonly session: Session; readonly state: RoomState }
  | { readonly ok: false; readonly error: RoomFailure }

/** Addressing/display names must stay parseable by the composer @-grammar. */
function validName(name: string): boolean {
  return name !== '' && !/\s/.test(name) && !name.includes('@')
}

/**
 * room Remote service: room creation, roster management, and the human
 * message intake. A room IS a normal session; the journal is its only state.
 */
export class RoomService extends TypertRemoteService {
  static inject = ['sessions']

  /**
   * @param ctx - host context carrying the session store.
   */
  constructor(ctx: Context) {
    super(ctx, 'room')
  }

  /** Resolve a session as a room: presence, marker, replayed state. */
  private load(sessionId: SessionId): RoomLoad {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return { ok: false, error: { code: 'session-not-found' } }
    if (!isRoomLog(session.events)) return { ok: false, error: { code: 'not-a-room' } }
    return { ok: true, session, state: replay(session.events) }
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
    return Promise.resolve(session !== undefined && isRoomLog(session.events))
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

  /**
   * Replay the room's journal into the derived state (roster, blackboard,
   * dispatch cursors, run states).
   * @param request - room session identity.
   * @returns the replayed state, or a rejection from the closed failure union.
   */
  @Remote('getState')
  getState(request: RoomGetStateRequest): Promise<RoomGetStateResult> {
    const loaded = this.load(request.sessionId)
    if (!loaded.ok) return Promise.resolve({ ok: false, error: loaded.error })
    return Promise.resolve({ ok: true, value: loaded.state })
  }

  /**
   * Invite a CLI member: validate the addressing name (unique, no whitespace,
   * no `@`) and the provider, then append `room/member-added`. A supplied
   * first task is acknowledged (`pendingFirstTask`) but not dispatched yet —
   * the dispatch engine lands next step.
   * @param request - room session, provider, name, optional instructions and first task.
   * @returns the invitation receipt, or a rejection.
   */
  @Remote('invite')
  async invite(request: RoomInviteRequest): Promise<RoomInviteResult> {
    const loaded = this.load(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (!validName(request.name)) return { ok: false, error: { code: 'invalid-name' } }
    if (loaded.state.members.some(member => member.name === request.name)) {
      return { ok: false, error: { code: 'duplicate-name' } }
    }
    if (request.provider.trim() === '') return { ok: false, error: { code: 'empty-provider' } }
    if (request.instructions !== undefined && request.instructions.trim() === '') {
      return { ok: false, error: { code: 'empty-text' } }
    }
    if (request.firstTask !== undefined && request.firstTask.trim() === '') {
      return { ok: false, error: { code: 'empty-text' } }
    }
    loaded.session.append('room/member-added', {
      name: request.name,
      kind: 'cli',
      provider: request.provider,
      invitedBy: 'human',
      ...request.instructions === undefined ? {} : { instructions: request.instructions },
    })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { name: request.name, pendingFirstTask: request.firstTask !== undefined } }
  }

  /**
   * Update a member's role instructions.
   * @param request - room session, member name, new instructions.
   * @returns the update receipt, or a rejection.
   */
  @Remote('updateMember')
  async updateMember(request: RoomUpdateMemberRequest): Promise<RoomUpdateMemberResult> {
    const loaded = this.load(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (!loaded.state.members.some(member => member.name === request.name)) {
      return { ok: false, error: { code: 'member-not-found' } }
    }
    if (request.instructions === undefined) return { ok: false, error: { code: 'nothing-to-update' } }
    if (request.instructions.trim() === '') return { ok: false, error: { code: 'empty-text' } }
    loaded.session.append('room/member-updated', { name: request.name, instructions: request.instructions })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { name: request.name } }
  }

  /**
   * Remove a member from the roster. Interrupting a live run lands with the
   * dispatch engine; this step records the journal event only.
   * @param request - room session, member name.
   * @returns the removal receipt, or a rejection.
   */
  @Remote('removeMember')
  async removeMember(request: RoomRemoveMemberRequest): Promise<RoomRemoveMemberResult> {
    const loaded = this.load(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (!loaded.state.members.some(member => member.name === request.name)) {
      return { ok: false, error: { code: 'member-not-found' } }
    }
    loaded.session.append('room/member-removed', { name: request.name })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { name: request.name } }
  }

  /**
   * Post a human message into the room: leading `@name` tokens address
   * members (a `room/dispatch` blackboard entry + dispatch record), a bare
   * message is a blackboard-only `room/note`. Every target must be on the
   * roster. Executing the dispatch lands with the dispatch engine; the
   * receipt reports the parse.
   * @param request - room session and raw composer text.
   * @returns the parse receipt, or a rejection.
   */
  @Remote('postMessage')
  async postMessage(request: RoomPostMessageRequest): Promise<RoomPostMessageResult> {
    const loaded = this.load(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (request.text.trim() === '') return { ok: false, error: { code: 'empty-text' } }
    const parsed = parseMentions(request.text)
    if (parsed.targets.length === 0) {
      const note = loaded.session.append('room/note', { text: request.text.trim() })
      await this.ctx.sessions.flush(loaded.session)
      return { ok: true, value: { parsed, seq: note.seq } }
    }
    if (parsed.text === '') return { ok: false, error: { code: 'empty-text' } }
    const roster = new Set(loaded.state.members.map(member => member.name))
    const unknown = parsed.targets.filter(target => !roster.has(target))
    if (unknown.length > 0) return { ok: false, error: { code: 'unknown-targets', names: unknown } }
    const dispatch = loaded.session.append('room/dispatch', { targets: parsed.targets, text: parsed.text })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { parsed, seq: dispatch.seq } }
  }
}

export default RoomService
