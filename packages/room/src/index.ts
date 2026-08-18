/**
 * room host half: the `room` Typert Remote service plus the `room_invite`
 * model tool. The room's entire state is the session's `room/*` custom-event
 * journal (log-only events — persistence and reload-replay come free, the
 * model never sees them, and harnesses without this plugin replay the session
 * safely); every read folds the journal through the pure replay, and every
 * mutating Remote appends and flushes. Dispatch records and first tasks are
 * executed by the DispatchEngine: main-agent members get a plugin-sourced
 * followup on the room's own agent, CLI members go through the probed
 * local-agent delegation facade (absent facade = degraded CLI capability,
 * never a boot failure).
 * @module @khorsheed/dsh-room
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `sessions` SessionStore merge onto Context.
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session'
// The persistence read path refuses logs carrying event types outside this
// catalog; registering the room vocabulary declares that a room-mounted build
// understands them (see ROOM_EVENT_TYPES in journal.ts).
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
// Type-only: pulls the `agents` registry merge onto Context.
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: pulls the `room/*` SessionEventMap merges.
import type {} from './types.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { probeLocalAgent, probeLocalAgentRoster } from './adapter.ts'
import { DispatchEngine } from './dispatch.ts'
import { isRoomLog, MAIN_AGENT_MEMBER, parseMentions, replay, ROOM_EVENT_TYPES } from './journal.ts'
import { roomInviteTool } from './tool.ts'
import type {
  RoomCancelRequest, RoomCancelResult,
  RoomCreateRequest, RoomCreateResult, RoomFailure,
  RoomGetStateRequest, RoomGetStateResult,
  RoomInviteRequest, RoomInviteResult,
  RoomIsRoomRequest,
  RoomListProvidersRequest,
  RoomPostMessageRequest, RoomPostMessageResult,
  RoomProviderInfo, RoomProviderList,
  RoomRemoveMemberRequest, RoomRemoveMemberResult,
  RoomState, RoomUpdateMemberRequest, RoomUpdateMemberResult,
} from './types.ts'

export type * from './types.ts'
export { MAIN_AGENT_MEMBER, ROOM_EVENT_TYPES } from './journal.ts'

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

/** The tools registry face this package consumes (probed, never injected). */
interface ToolsRegistryProbe {
  register(tool: ToolDefinition): () => void
}

/**
 * room Remote service: room creation, roster management, the human message
 * intake, and run cancellation. A room IS a normal session; the journal is
 * its only state.
 */
export class RoomService extends TypertRemoteService {
  static inject = ['sessions', 'agents']

  /** The dispatch engine executing this service's dispatch records. */
  readonly engine: DispatchEngine

  /**
   * @param ctx - host context carrying the session store.
   */
  constructor(ctx: Context) {
    super(ctx, 'room')
    // Join the persistence catalog BEFORE any room event can be appended:
    // the read path refuses logs with out-of-catalog types, so a room written
    // by this build reloads only because the vocabulary is registered here.
    const catalog = KNOWN_SESSION_EVENT_TYPES as Set<string>
    for (const type of ROOM_EVENT_TYPES) catalog.add(type)
    this.engine = new DispatchEngine(ctx)
    // The tools registry is probed, not injected: a composition without it
    // loses the model-facing invitation path but keeps every other surface.
    const tools = ctx.get('tools') as ToolsRegistryProbe | undefined
    if (tools !== undefined) {
      this.ctx.effect(() => tools.register(roomInviteTool(this)), 'room: room_invite tool')
    }
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
   * marker, seat the session's own main agent on the roster (an equal member,
   * addressable like any other), and flush durable.
   * @param request - optional storage metadata (cwd).
   * @returns the new room session's identity.
   */
  @Remote('createRoom')
  async createRoom(request: RoomCreateRequest): Promise<RoomCreateResult> {
    const session = this.ctx.sessions.create(undefined, {
      meta: request.cwd === undefined ? {} : { cwd: request.cwd },
    })
    session.append('room/created', { version: 1 })
    session.append('room/member-added', { name: MAIN_AGENT_MEMBER, kind: 'main-agent', invitedBy: 'human' })
    await this.ctx.sessions.flush(session)
    return { sessionId: session.id }
  }

  /**
   * List the invitable CLI providers: the local-agent roster with each
   * harness's auth state, plus the delegation-facade verdict (absent facade =
   * CLI members undispatchable; the dialog greys the section instead of
   * failing). Harnesses without a delegation provider are record-only and
   * are not invitable.
   * @param _request - no parameters.
   * @returns the provider list and the facade verdict.
   */
  @Remote('listProviders')
  async listProviders(_request: RoomListProvidersRequest): Promise<RoomProviderList> {
    const localAgentAvailable = probeLocalAgent(this.ctx) !== undefined
    const roster = probeLocalAgentRoster(this.ctx)
    if (roster === undefined) return { localAgentAvailable, providers: [] }
    const providers: RoomProviderInfo[] = []
    for (const row of roster.roster()) {
      const status = await roster.statusOf(row.name)
      // A harness without a delegation provider cannot carry a CLI member.
      if (status.delegationProvider === undefined) continue
      providers.push({
        provider: status.delegationProvider,
        displayName: row.displayName,
        authenticated: status.authenticated,
      })
    }
    return { localAgentAvailable, providers }
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
   * Validate and journal an invitation: the name must be parseable by the
   * composer @-grammar and unique, the provider non-blank, and (CLI members
   * are undispatchable without it) the local-agent facade must be probed.
   * A first task is journaled as a `room/dispatch` and handed to the engine
   * immediately — the receipt's `pendingFirstTask` means "dispatched".
   * Shared by the Remote surface (`invitedBy: 'human'`) and the room_invite
   * tool (`invitedBy: 'agent'`).
   * @param request - room session, provider, name, optional instructions and first task.
   * @param invitedBy - the invitation's origin.
   * @returns the invitation receipt, or a rejection.
   */
  async inviteMember(request: RoomInviteRequest, invitedBy: 'human' | 'agent'): Promise<RoomInviteResult> {
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
    if (probeLocalAgent(this.ctx) === undefined) {
      return { ok: false, error: { code: 'local-agent-unavailable' } }
    }
    loaded.session.append('room/member-added', {
      name: request.name,
      kind: 'cli',
      provider: request.provider,
      invitedBy,
      ...request.instructions === undefined ? {} : { instructions: request.instructions },
    })
    let firstTaskSeq: number | undefined
    if (request.firstTask !== undefined) {
      firstTaskSeq = loaded.session.append('room/dispatch', {
        targets: [request.name], text: request.firstTask,
      }).seq
    }
    await this.ctx.sessions.flush(loaded.session)
    if (request.firstTask !== undefined && firstTaskSeq !== undefined) {
      this.engine.dispatch(loaded.session, request.name, request.firstTask, firstTaskSeq)
    }
    return { ok: true, value: { name: request.name, pendingFirstTask: request.firstTask !== undefined } }
  }

  /**
   * Invite a CLI member (the human path; see inviteMember).
   * @param request - room session, provider, name, optional instructions and first task.
   * @returns the invitation receipt, or a rejection.
   */
  @Remote('invite')
  invite(request: RoomInviteRequest): Promise<RoomInviteResult> {
    return this.inviteMember(request, 'human')
  }

  /**
   * Update a member's role instructions. The edit rides the member's next
   * dispatch as a context update (the CLI session itself is never rewritten).
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
   * Remove a member from the roster. An in-flight run is NOT interrupted
   * here — cancel() first when the member is running.
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
   * members (a `room/dispatch` blackboard entry, executed by the engine), a
   * bare message is a blackboard-only `room/note`. Every target must be on
   * the roster.
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
    for (const target of parsed.targets) {
      this.engine.dispatch(loaded.session, target, parsed.text, dispatch.seq)
    }
    return { ok: true, value: { parsed, seq: dispatch.seq } }
  }

  /**
   * Cancel a member's in-flight run through the local-agent facade. A hit
   * journals the terminal `cancelled` edge immediately (the engine's own
   * settle for that run then no-ops); a miss — no facade, no delegation
   * handle, or nothing in flight — journals nothing and reports
   * `cancelled: false`.
   * @param request - room session, member name.
   * @returns the cancellation receipt, or a rejection.
   */
  @Remote('cancel')
  cancel(request: RoomCancelRequest): Promise<RoomCancelResult> {
    const loaded = this.load(request.sessionId)
    if (!loaded.ok) return Promise.resolve({ ok: false, error: loaded.error })
    const member = loaded.state.members.find(entry => entry.name === request.name)
    if (member === undefined) return Promise.resolve({ ok: false, error: { code: 'member-not-found' } })
    const facade = probeLocalAgent(this.ctx)
    const hit = facade !== undefined && member.childSessionId !== undefined
      ? facade.cancel(member.childSessionId)
      : false
    if (hit) {
      const running = loaded.state.runs.find(entry => entry.member === request.name && entry.state === 'running')
      loaded.session.append('room/run-state', {
        member: request.name, state: 'cancelled', startedAt: running?.startedAt ?? Date.now(),
      })
      return this.ctx.sessions.flush(loaded.session).then(() => ({ ok: true as const, value: { cancelled: true } }))
    }
    return Promise.resolve({ ok: true, value: { cancelled: false } })
  }
}

export default RoomService
