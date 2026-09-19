/**
 * room host half: the `room` Typert Remote service. (The `room_invite` /
 * `room_task` / `room_message` model tools left this package's profile-root
 * registration in the M4' tool-row split — their definition factories live
 * in ./tool.ts and the companion `@khorsheed/dsh-room-tool` mounts them
 * inside agent-preset compositions.) The room's entire state is the session's `room/*` custom-event
 * journal (log-only events — persistence and reload-replay come free, the
 * model never sees them, and harnesses without this plugin replay the session
 * safely); every read folds the journal through the pure replay, and every
 * mutating Remote appends and flushes. Dispatch records and first tasks are
 * executed by the DispatchEngine: main-agent members get a plugin-sourced
 * followup on the room's own agent, CLI members go through the probed
 * local-agent delegation facade (absent facade = degraded CLI capability,
 * never a boot failure). The member-notification gate lives here too: the
 * local-agent bridge duck-type-calls `receiveMemberMessage` (service face via
 * ctx.provide, off the wire), the human confirms/dismisses through the
 * confirmRelay/dismissRelay Remotes.
 * @module @khorsheed/dsh-room
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `sessions` SessionStore merge onto Context.
import type { Session } from '@deepseek-ai/dsh-session'
import type { LocalAgentMemberRun, MemberRoomCommand, MemberMessageOutcome } from '@khorsheed/dsh-local-agent/types'
import { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: pulls the `agents` registry merge onto Context (create/resume
// are consumed through the registry, not the agent-loop package).
import type {} from '@deepseek-ai/dsh-agent'
// The persistence read path refuses logs carrying event types outside the
// KNOWN_SESSION_EVENT_TYPES catalog; registering the room vocabulary declares
// that a room-mounted build understands them (see ROOM_EVENT_TYPES in
// journal.ts). The registration must land in the TOOLCHAIN's module instance:
// the toolchain loads dsh-session from src (tsx path mapping) while a
// profile-installed plugin resolves the root export to lib — two instances,
// two catalog Sets, and a registration that never reaches the reader (the
// prod 3080 failure mode). Importing the source file through the package's
// `./src/*` export lands both sides on the same file URL, but no static
// specifier expresses it (the exact-file exports map needs tsx's extension
// probing; the `.ts` form trips TS2877) — so the specifier is computed and
// resolved at runtime, and the top-level await lets the plugin loader block
// boot on the registration completing. Test environments (vite) cannot
// resolve the `./src/*` export and take the root fallback — there the root
// and the toolchain already share one instance.
const catalogSpecifier = ['@deepseek-ai/dsh-session', 'src', 'known-event-types'].join('/')
const catalogModule = await import(catalogSpecifier)
  .catch(() => import('@deepseek-ai/dsh-session')) as { KNOWN_SESSION_EVENT_TYPES: Set<string> }
for (const type of ROOM_EVENT_TYPES) catalogModule.KNOWN_SESSION_EVENT_TYPES.add(type)
import { agentPresetsDerivationHost, composeRoomAgent, deriveSessionPreset, inspectCold, roomSessionPreset } from './agent-setup.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: pulls the `room/*` SessionEventMap merges.
import type {} from './types.ts'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { probeLocalAgent, probeLocalAgentRoster } from './adapter.ts'
import { DispatchEngine, ROOM_PLUGIN } from './dispatch.ts'
import { coordinatorMember, memberId, isRoomLog, MAIN_AGENT_MEMBER, parseMentions, replay, ROOM_EVENT_TYPES } from './journal.ts'
import type {
  RoomAddTaskRequest, RoomAddTaskResult,
  RoomCancelRequest, RoomCancelResult,
  RoomCloseTaskRequest, RoomCloseTaskResult,
  RoomPrepareMemberRequest, RoomPrepareMemberResult,
  RoomFailure, RoomSetCoordinatorRequest, RoomSetCoordinatorResult, RoomReconcileDeliveryRequest, RoomReconcileDeliveryResult,
  RoomGetStateRequest, RoomGetStateResult,
  RoomInviteRequest, RoomInviteResult,
  RoomIsRoomRequest,
  RoomListProvidersRequest,
  RoomMemberMessage, RoomMemberMessageReceipt,
  RoomMessageRequest, RoomMessageResult,
  RoomPostMessageRequest, RoomPostMessageResult,
  RoomProviderInfo, RoomProviderList,
  RoomRelayResolveRequest, RoomRelayResolveResult,
  RoomRemoveMemberRequest, RoomRemoveMemberResult,
  RoomSetGoalRequest, RoomSetGoalResult,
  RoomState, RoomUpdateMemberRequest, RoomUpdateMemberResult,
  RoomUpdateTaskRequest, RoomUpdateTaskResult,
} from './types.ts'

export type * from './types.ts'
export { MAIN_AGENT_MEMBER, ROOM_EVENT_TYPES } from './journal.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Room service owned by the room plugin: the Typert Remote gateway AND
     * the in-process service face the local-agent bridge duck-type-calls
     * (`receiveMemberMessage`). TypertRemoteService's Service base provides
     * it under 'room'.
     */
    room: RoomService
  }
}

/** A resolved room session plus its replayed state, or the rejection. */
type RoomLoad =
  | { readonly ok: true; readonly session: Session; readonly state: RoomState }
  | { readonly ok: false; readonly error: RoomFailure }

/** A side-effect-free room read: replayed state plus the log-recorded preset. */
type RoomColdLoad =
  | { readonly ok: true; readonly state: RoomState; readonly preset: string | undefined }
  | { readonly ok: false; readonly error: RoomFailure }

/** Addressing/display names must stay parseable by the composer @-grammar. */
function validName(name: string): boolean {
  return name !== '' && !/\s/.test(name) && !name.includes('@')
}

/** A task title is the dispatch text's first line, truncated. */
function taskTitle(text: string): string {
  const first = text.trim().split('\n', 1)[0] ?? ''
  return first.length > 60 ? `${first.slice(0, 60)}…` : first
}

/**
 * room Remote service: promotion, roster management, the human @-message
 * intake, the notification gate, the task board, and run cancellation. A
 * room IS a normal session; the journal is its only state. A room is never
 * CREATED apart from a session — inviting an agent into any session promotes
 * it (see ensureRoom; the room-session-promotion proposal).
 */
export class RoomService extends TypertRemoteService {
  static inject = ['sessions', 'agents']

  /** The dispatch engine executing this service's dispatch records. */
  readonly engine: DispatchEngine
  private readonly handoffs = new Set<string>()

  /** sessionId → in-flight cold resume (mutations on a cold room dedupe). */
  private readonly resumes = new Map<SessionId, Promise<RoomLoad>>()

  /**
   * @param ctx - host context carrying the session store.
   */
  constructor(ctx: Context) {
    super(ctx, 'room')
    this.engine = new DispatchEngine(ctx)
    // A stale client or another official input surface must not wake a DSH
    // model behind an external coordinator. Public pre-step admits an empty
    // initial step without a model call after room has durably accepted it.
    const nativeTurns = new WeakMap<object, number>()
    ctx.on('agent/pre-step', async ({ agent, messages, turn, step }, next) => {
      const events = agent.session.snapshotEvents()
      if (!isRoomLog(events) || coordinatorMember(replay(events), events)?.kind !== 'cli') return next()
      if (nativeTurns.get(agent) === turn) return next()
      if (step !== 1) throw new Error('Room native turn has no explicit member dispatch')
      if (messages.some(message => message.source.kind === 'plugin' && message.source.plugin === ROOM_PLUGIN)) {
        nativeTurns.set(agent, turn)
        return next()
      }
      for (const message of messages) {
        if (message.source.kind !== 'user' || message.content.some(block => block.type !== 'text')) {
          throw new Error('Use the room input route for this coordinator; this input cannot be forwarded losslessly')
        }
        const result = await this.postMessage({ sessionId: agent.session.id, requestId: String(message.id), text: message.content.map(block => block.type === 'text' ? block.text : '').join('\n') })
        if (!result.ok) throw new Error(`Room input routing failed: ${result.error.code}`)
      }
      return { kind: 'enter', messages: [] }
    })
    // The model-facing room tools are deliberately NOT registered here: they
    // moved to the companion `@khorsheed/dsh-room-tool`, which mounts the
    // tool row inside agent-preset compositions (session-granted). The
    // definition factories stay exported from ./tool.ts for that companion.
  }

  /** Resolve a LIVE session as a room: presence, marker, replayed state. */
  private load(sessionId: SessionId): RoomLoad {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return { ok: false, error: { code: 'session-not-found' } }
    if (!isRoomLog(session.snapshotEvents())) return { ok: false, error: { code: 'not-a-room' } }
    return { ok: true, session, state: replay(session.snapshotEvents()) }
  }

  /**
   * Read a session as a room without side effects: the live store first, then
   * a persistence inspection (a cold room after a host restart answers from
   * its durable log; nothing is attached or resumed on a read).
   */
  private async loadCold(sessionId: SessionId): Promise<RoomColdLoad> {
    const live = this.ctx.sessions.get(sessionId)
    if (live !== undefined) {
      return isRoomLog(live.snapshotEvents())
        ? { ok: true, state: replay(live.snapshotEvents()), preset: roomSessionPreset(live) }
        : { ok: false, error: { code: 'not-a-room' } }
    }
    const inspected = await inspectCold(this.ctx, sessionId)
    if (inspected === undefined) return { ok: false, error: { code: 'session-not-found' } }
    if (!isRoomLog(inspected.events)) return { ok: false, error: { code: 'not-a-room' } }
    return {
      ok: true,
      state: replay(inspected.events),
      preset: deriveSessionPreset(agentPresetsDerivationHost, { header: inspected.meta, events: inspected.events }),
    }
  }

  /**
   * Resolve a room for a MUTATION: the session must be live to take appends,
   * and dispatch needs its agent live (the delegation facade resolves the
   * parent through `ctx.agents.get` — live agents only). A cold room is
   * cold-resumed through the agent factory, which republishes session +
   * agent under the preset the log records; resumes dedupe per session.
   */
  private ensureLive(sessionId: SessionId): Promise<RoomLoad> {
    const hit = this.load(sessionId)
    if (hit.ok || hit.error.code !== 'session-not-found') return Promise.resolve(hit)
    let pending = this.resumes.get(sessionId)
    if (pending === undefined) {
      pending = this.resumeRoom(sessionId).finally(() => this.resumes.delete(sessionId))
      this.resumes.set(sessionId, pending)
    }
    return pending
  }

  /** One cold resume: refuse non-rooms before paying an agent composition. */
  private async resumeRoom(sessionId: SessionId): Promise<RoomLoad> {
    const cold = await this.loadCold(sessionId)
    if (!cold.ok) return cold
    try {
      const composition = await composeRoomAgent(this.ctx, cold.preset)
      await this.ctx.agents.resume({
        resumeSessionId: sessionId,
        ...composition.setup === undefined ? {} : { setup: composition.setup },
      })
    } catch (error: unknown) {
      return { ok: false, error: { code: 'resume-failed', message: String(error) } }
    }
    const loaded = this.load(sessionId)
    if (loaded.ok) await this.engine.recover(loaded.session)
    return loaded
  }

  /**
   * Probe whether a session is a room: replay its event log looking for the
   * `room/created` marker. Side-effect-free: a cold session answers from a
   * persistence inspection, so opening any session never resumes its agent.
   * @param request - session identity.
   * @returns true when the session carries the marker (false for unknown sessions too).
   */
  @Remote('isRoom')
  async isRoom(request: RoomIsRoomRequest): Promise<boolean> {
    const session = this.ctx.sessions.get(request.sessionId)
    if (session !== undefined) return isRoomLog(session.snapshotEvents())
    const inspected = await inspectCold(this.ctx, request.sessionId)
    return inspected !== undefined && isRoomLog(inspected.events)
  }

  /**
   * Resolve a session for a room WRITE, promoting it when it isn't a room
   * yet: a live plain session gains the `room/created` identity marker and
   * the main agent's roster seat (the promotion IS the entry model — the
   * room-session-promotion proposal: any session an agent is invited into
   * becomes a room). Idempotent — an existing room passes through untouched,
   * and concurrent promotions converge on the log (the first `room/created`
   * wins identity). A cold EXISTING room resumes through the normal path;
   * a cold PLAIN session cannot be promoted sight-unseen (promotion writes
   * on the live session, and the surfaces that promote — the open session's
   * invite dialog, the room tools running in their own session — always hold
   * it live), so it answers `not-a-room`. NOT a Remote — the surfaces reach
   * it through the write paths (invite/messageMember); public so tests and a
   * future manual "promote" surface share the one entry.
   * @param sessionId - the session to write.
   * @returns the live session plus replayed state, or the rejection.
   */
  async ensureRoom(sessionId: SessionId): Promise<RoomLoad> {
    const live = this.ctx.sessions.get(sessionId)
    if (live === undefined) {
      const cold = await this.loadCold(sessionId)
      if (!cold.ok) return { ok: false, error: cold.error }
      return this.ensureLive(sessionId)
    }
    if (!isRoomLog(live.snapshotEvents())) {
      live.append('room/created', { version: 1 })
      live.append('room/member-added', { name: MAIN_AGENT_MEMBER, kind: 'main-agent', invitedBy: 'human' })
      await this.ctx.sessions.flush(live)
    }
    return { ok: true, session: live, state: replay(live.snapshotEvents()) }
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
        // The roster name is the localAgentGateway harnessModel lookup key
        // (the invite dialog's model picker).
        harness: row.name,
        authenticated: status.authenticated,
      })
    }
    return { localAgentAvailable, providers }
  }

  /**
   * Replay the room's journal into the derived state (roster, notification
   * relays, task board, run states).
   * @param request - room session identity.
   * @returns the replayed state, or a rejection from the closed failure union.
   */
  @Remote('getState')
  async getState(request: RoomGetStateRequest): Promise<RoomGetStateResult> {
    // Side-effect-free: a cold room answers from its durable log (see loadCold).
    const loaded = await this.loadCold(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    return { ok: true, value: loaded.state }
  }

  /**
   * Validate, PROMOTE (a plain session becomes a room — see ensureRoom), and
   * journal an invitation: the name must be parseable by the
   * composer @-grammar and unique, the provider non-blank AND a registered
   * delegation provider (the classic slip is the harness name `kimi` where
   * the family registered `kimi-cli` — validated against the roster's
   * `delegationProvider` set, the same probe listProviders serves; a roster-
   * less core skips the check, degrading to the old accept-anything), and
   * (CLI members are undispatchable without it) the local-agent facade must
   * be probed. A first task is journaled as a `room/dispatch` (auto-opening
   * the member's in_progress task) and handed to the engine immediately —
   * the receipt's `pendingFirstTask` means "dispatched". Shared by the
   * Remote surface (`invitedBy: 'human'`) and the room_invite tool
   * (`invitedBy: 'agent'`).
   * @param request - room session, provider, name, optional cwd, instructions and first task.
   * @param invitedBy - the invitation's origin.
   * @returns the invitation receipt, or a rejection.
   */
  async inviteMember(request: RoomInviteRequest, invitedBy: 'human' | 'agent', actorChildSessionId?: string): Promise<RoomInviteResult> {
    // Invite PROMOTES: inviting an agent into a plain session makes it a room.
    const loaded = await this.ensureRoom(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    if (invitedBy === 'agent' && !this.isCurrentCoordinator(loaded.session, actorChildSessionId)) return { ok: false, error: { code: 'not-coordinator' } }
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
    if (request.model !== undefined && request.model.trim() === '') {
      return { ok: false, error: { code: 'empty-text' } }
    }
    if (probeLocalAgent(this.ctx) === undefined) {
      return { ok: false, error: { code: 'local-agent-unavailable' } }
    }
    const roster = probeLocalAgentRoster(this.ctx)
    if (roster !== undefined) {
      // The same delegationProvider set listProviders serves: invite accepts
      // exactly what dispatch can resolve, and the rejection carries the
      // legal set so a model caller can self-correct (rename and retry).
      const available: string[] = []
      for (const row of roster.roster()) {
        const status = await roster.statusOf(row.name)
        if (status.delegationProvider !== undefined) available.push(status.delegationProvider)
      }
      if (!available.includes(request.provider)) {
        return { ok: false, error: { code: 'unknown-provider', provider: request.provider, available } }
      }
    }
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    if (invitedBy === 'agent' && !this.isCurrentCoordinator(loaded.session, actorChildSessionId)) return { ok: false, error: { code: 'not-coordinator' } }
    loaded.session.append('room/member-added', {
      id: randomUUID(),
      name: request.name,
      kind: 'cli',
      provider: request.provider,
      invitedBy,
      ...request.instructions === undefined ? {} : { instructions: request.instructions },
      ...request.cwd === undefined || request.cwd.trim() === '' ? {} : { cwd: request.cwd.trim() },
      ...request.model === undefined || request.model.trim() === '' ? {} : { model: request.model.trim() },
    })
    let firstTaskSeq: number | undefined
    if (request.firstTask !== undefined) {
      firstTaskSeq = loaded.session.append('room/dispatch', {
        id: randomUUID(), origin: invitedBy === 'human' ? 'human' : 'coordinator',
        ...invitedBy === 'human' ? {} : { replyTo: memberId(loaded.session.snapshotEvents(), coordinatorMember(replay(loaded.session.snapshotEvents()), loaded.session.snapshotEvents())!) },
        targetIds: [memberId(loaded.session.snapshotEvents(), replay(loaded.session.snapshotEvents()).members.find(member => member.name === request.name)!)],
        targets: [request.name], text: request.firstTask,
      }).seq
      loaded.session.append('room/task-added', {
        id: randomUUID(), member: request.name, title: taskTitle(request.firstTask), status: 'in_progress',
      })
    }
    await this.ctx.sessions.flush(loaded.session)
    if (request.firstTask !== undefined && firstTaskSeq !== undefined) {
      this.engine.dispatch(loaded.session, request.name, request.firstTask, { dispatchSeq: firstTaskSeq })
    }
    return { ok: true, value: { name: request.name, pendingFirstTask: request.firstTask !== undefined } }
  }

  /**
   * Invite a CLI member (the human path; see inviteMember).
   * @param request - room session, provider, name, optional cwd, instructions and first task.
   * @returns the invitation receipt, or a rejection.
   */
  @Remote('invite')
  invite(request: RoomInviteRequest): Promise<RoomInviteResult> {
    return this.inviteMember(request, 'human')
  }

  /**
   * Update a member's editable fields: rename (validated like an invite name —
   * unique, parseable; the main agent is the room itself and cannot be
   * renamed), role instructions (null or a blank text CLEARS them — later
   * dispatches inject none), the member-level cwd override (null or a
   * blank text clears back to inheriting the room cwd; still roster-recorded
   * only — the delegation facade's per-call cwd override is the family's open
   * R2), and the intended model (null or a blank text clears it back to the
   * harness default; roster-recorded intent — the first dispatch binds it as
   * the facade start's `model` option, and the live member's immediate switch
   * is the client's localAgentGateway `setMemberModel` call, not this one).
   * An instructions edit rides the member's next dispatch as a context
   * update (the CLI session itself is never rewritten); a rename migrates
   * every name-keyed projection at replay (the journal fold moves the roster
   * key, tasks' member/blockedBy, relays' from/to, and the runs key).
   * @param request - room session, member name, and the fields to change.
   * @returns the update receipt (the CURRENT name), or a rejection.
   */
  @Remote('updateMember')
  async updateMember(request: RoomUpdateMemberRequest): Promise<RoomUpdateMemberResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    const member = loaded.state.members.find(entry => entry.name === request.name)
    if (member === undefined) {
      return { ok: false, error: { code: 'member-not-found' } }
    }
    if (request.model !== undefined && member.childSessionId !== undefined) return { ok: false, error: { code: 'configuration-owned-by-core' } }
    if (request.rename === undefined && request.instructions === undefined
      && request.cwd === undefined && request.model === undefined) {
      return { ok: false, error: { code: 'nothing-to-update' } }
    }
    if (request.rename !== undefined && request.rename !== request.name) {
      if (member.kind === 'main-agent') return { ok: false, error: { code: 'main-member' } }
      if (!validName(request.rename)) return { ok: false, error: { code: 'invalid-name' } }
      if (loaded.state.members.some(entry => entry.name === request.rename)) {
        return { ok: false, error: { code: 'duplicate-name' } }
      }
    }
    // A blank string is a clear, never a stored value (the wire keeps null
    // and blank distinct, the journal stores one form: null).
    const instructions = typeof request.instructions === 'string' && request.instructions.trim() === ''
      ? null
      : request.instructions
    const cwd = typeof request.cwd === 'string'
      ? (request.cwd.trim() === '' ? null : request.cwd.trim())
      : request.cwd
    const model = typeof request.model === 'string'
      ? (request.model.trim() === '' ? null : request.model.trim())
      : request.model
    loaded.session.append('room/member-updated', {
      name: request.name,
      ...request.rename === undefined ? {} : { rename: request.rename },
      ...instructions === undefined ? {} : { instructions },
      ...cwd === undefined ? {} : { cwd },
      ...model === undefined ? {} : { model },
    })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { name: request.name } }
  }

  /** Native preparation creates no unrelated conversation turn and leaves the role unchanged. */
  @Remote('prepareMember')
  async prepareMember(request: RoomPrepareMemberRequest): Promise<RoomPrepareMemberResult> {
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    this.handoffs.add(request.sessionId)
    try { return await this.prepareMemberInRoom(request) }
    finally { this.handoffs.delete(request.sessionId) }
  }

  private async prepareMemberInRoom(request: RoomPrepareMemberRequest): Promise<RoomPrepareMemberResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const member = loaded.state.members.find(member => member.name === request.name)
    if (member?.kind !== 'cli' || member.provider === undefined) return { ok: false, error: { code: 'member-not-found' } }
    const family = probeLocalAgent(this.ctx)
    if (family?.prepareMember === undefined) return { ok: false, error: { code: 'coordinator-not-ready', message: 'Native preparation is unavailable in this family core' } }
    try {
      const childSessionId = await family.prepareMember(request.sessionId, member.provider, member.childSessionId ?? memberId(loaded.session.snapshotEvents(), member), {
        ...member.cwd === undefined ? {} : { cwd: member.cwd }, ...member.model === undefined ? {} : { model: member.model },
      })
      loaded.session.append('room/member-updated', { name: member.name, childSessionId: SessionId(childSessionId) })
      await this.ctx.sessions.flush(loaded.session)
      return { ok: true, value: { childSessionId } }
    } catch (error) { return { ok: false, error: { code: 'coordinator-not-ready', message: String(error) } } }
  }

  /** A human records the known result before releasing a crashed member's queued work. */
  @Remote('reconcileDelivery')
  async reconcileDelivery(request: RoomReconcileDeliveryRequest): Promise<RoomReconcileDeliveryResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const delivery = loaded.state.deliveries?.find(row => row.id === request.deliveryId)
    if (delivery?.status !== 'uncertain') return { ok: false, error: { code: 'delivery-not-uncertain' } }
    if (request.evidence.trim() === '') return { ok: false, error: { code: 'empty-text' } }
    loaded.session.append('room/delivery-state', { id: delivery.id, dispatchSeq: delivery.dispatchSeq, memberId: delivery.memberId, state: request.outcome, text: request.evidence.trim() })
    await this.ctx.sessions.flush(loaded.session)
    await this.engine.recover(loaded.session)
    return { ok: true }
  }

  /** Explicit human role change; state is committed only after readiness and idle checks. */
  @Remote('setCoordinator')
  async setCoordinator(request: RoomSetCoordinatorRequest): Promise<RoomSetCoordinatorResult> {
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    this.handoffs.add(request.sessionId)
    try {
      const loaded = await this.ensureLive(request.sessionId)
      if (!loaded.ok) return { ok: false, error: loaded.error }
      const events = loaded.session.snapshotEvents()
      let candidate = loaded.state.members.find(member => memberId(events, member) === request.memberId)
      const previous = coordinatorMember(loaded.state, events)
      if (candidate === undefined || previous === undefined) return { ok: false, error: { code: 'member-not-found' } }
      if ((loaded.state.coordinator?.revision ?? 0) !== request.expectedRevision) return { ok: false, error: { code: 'coordinator-conflict' } }
      const agent = this.ctx.agents.get(request.sessionId)
      if (agent?.status === 'running' || (agent?.inbox?.nextTurn.length ?? 0) > 0 || (agent?.inbox?.nextStep.length ?? 0) > 0 || this.engine.hasPending(loaded.session, previous.name) || this.engine.hasPending(loaded.session, candidate.name)) {
        return { ok: false, error: { code: 'coordinator-busy' } }
      }
      if (candidate.kind === 'cli' && candidate.childSessionId === undefined) {
        const prepared = await this.prepareMemberInRoom({ sessionId: request.sessionId, name: candidate.name })
        if (!prepared.ok) return { ok: false, error: prepared.error }
        candidate = { ...candidate, childSessionId: SessionId(prepared.value.childSessionId) }
      }
      const refreshedEvents = loaded.session.snapshotEvents()
      const refreshed = replay(refreshedEvents)
      candidate = refreshed.members.find(member => memberId(refreshedEvents, member) === request.memberId)
      if (candidate === undefined) return { ok: false, error: { code: 'member-not-found' } }
      if ((refreshed.coordinator?.revision ?? 0) !== request.expectedRevision) return { ok: false, error: { code: 'coordinator-conflict' } }
      const refreshedAgent = this.ctx.agents.get(request.sessionId)
      if (refreshedAgent?.status === 'running' || (refreshedAgent?.inbox?.nextTurn.length ?? 0) > 0 || (refreshedAgent?.inbox?.nextStep.length ?? 0) > 0 || this.engine.hasPending(loaded.session, previous.name) || this.engine.hasPending(loaded.session, candidate.name)) return { ok: false, error: { code: 'coordinator-busy' } }
      if (candidate.kind === 'cli') {
        const family = this.ctx.get('localAgent') as { canCoordinateRoom?: (id: string) => boolean } | undefined
        if (candidate.childSessionId === undefined || family?.canCoordinateRoom?.(candidate.childSessionId) !== true) return { ok: false, error: { code: 'coordinator-not-ready', message: 'The member coordination tool channel is unavailable' } }
      }
      for (const participant of [previous, candidate]) {
        if (participant.kind !== 'cli') continue
        const family = this.ctx.get('localAgent') as { memberConfiguration?: (id: string) => { status: string; round?: unknown; pending?: unknown; lockedReason?: string } } | undefined
        if (participant.childSessionId === undefined || family?.memberConfiguration === undefined) {
          return { ok: false, error: { code: 'coordinator-not-ready', message: 'Member native session preparation is required before promotion' } }
        }
        const control = family.memberConfiguration(participant.childSessionId)
        if (control.status !== 'idle' || control.round !== undefined || control.pending !== undefined || control.lockedReason !== undefined) {
          return { ok: false, error: { code: 'coordinator-not-ready', message: 'Member configuration has not converged or is locked' } }
        }
      }
      const handoff = [
        `Coordinator handoff from ${previous.name} to ${candidate.name}.`,
        `Room session: ${request.sessionId}. Earlier native conversations remain available by their session IDs.`,
        loaded.state.goal === undefined ? '' : `Goal: ${loaded.state.goal}`,
        ...loaded.state.tasks.filter(task => !['done', 'cancelled'].includes(task.status)).map(task => `Open task ${task.id}: ${task.member}: ${task.title} (${task.status})`),
        ...events.filter(event => event.type === 'room/speech' || event.type === 'room/dispatch').slice(-12).map(event =>
          event.type === 'room/speech' ? `${event.data.member}: ${event.data.text.slice(0, 1500)}`
          : event.type === 'room/dispatch' ? `To ${event.data.targets.join(', ')}: ${event.data.text.slice(0, 1500)}` : ''),
      ].filter(Boolean).join('\n').slice(0, 16000)
      const value = { version: 1 as const, memberId: request.memberId, previousMemberId: memberId(events, previous), revision: request.expectedRevision + 1, handoff }
      loaded.session.append('room/coordinator', value)
      await this.ctx.sessions.flush(loaded.session)
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error: { code: 'coordinator-not-ready', message: String(error) } }
    } finally { this.handoffs.delete(request.sessionId) }
  }

  /**
   * Remove a member from the roster. An in-flight run is NOT interrupted
   * here — cancel() first when the member is running.
   * @param request - room session, member name.
   * @returns the removal receipt, or a rejection.
   */
  @Remote('removeMember')
  async removeMember(request: RoomRemoveMemberRequest): Promise<RoomRemoveMemberResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    if (!loaded.state.members.some(member => member.name === request.name)) {
      return { ok: false, error: { code: 'member-not-found' } }
    }
    if (coordinatorMember(loaded.state, loaded.session.snapshotEvents())?.name === request.name) return { ok: false, error: { code: 'active-coordinator' } }
    loaded.session.append('room/member-removed', { name: request.name })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { name: request.name } }
  }

  /**
   * Post a human @-message into the room: leading `@name` tokens address
   * members, and so does the request's `targets` list (the composer's
   * mention-menu picks — explicit addressing wherever the `@name` sits); the
   * two union before the roster check (a `room/dispatch` journal record,
   * executed by the engine, and one auto-opened in_progress task per target).
   * The human's raw text is
   * FIRST appended as a standard `user/message` (source kind 'user' — the
   * human typed it; the official messageDefinition classifies any other kind
   * as a collapsed context-injection row, not the user bubble), so the words
   * render as the official user bubble and enter the main agent's
   * model-visible history. The append wakes nothing: turns start from
   * prompt/followup calls, never from log appends (the agent is the log's
   * writer, not a watcher). The `room/dispatch` record stays as pure
   * bookkeeping (task board, dispatch cursors, replay) — it no longer drives
   * any chat node. A BARE message is a structured `no-targets` rejection —
   * defense only: the room composer releases bare messages to the official
   * submit path (a normal main-agent turn) and never calls this Remote
   * without addressing.
   * @param request - room session, raw composer text, and the menu-picked addressees.
   * @returns the parse receipt, or a rejection.
   */
  @Remote('postMessage')
  async postMessage(request: RoomPostMessageRequest): Promise<RoomPostMessageResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (request.text.trim() === '') return { ok: false, error: { code: 'empty-text' } }
    const parsed = parseMentions(request.text)
    // Menu-picked addressees union with the parsed leading tokens: a menu
    // pick is explicit addressing wherever the `@name` sits in the sentence.
    const targets = [...new Set([...parsed.targets, ...request.targets ?? []])]
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    if (targets.length === 0) {
      const selected = coordinatorMember(loaded.state, loaded.session.snapshotEvents())
      if (selected === undefined) return { ok: false, error: { code: 'member-not-found' } }
      targets.push(selected.name)
    }
    // Leading tokens are stripped from the dispatched text; a picked mid-
    // sentence mention stays — the sentence is dispatched verbatim.
    const text = parsed.targets.length > 0 ? parsed.text : request.text.trim()
    if (text === '') return { ok: false, error: { code: 'empty-text' } }
    const roster = new Set(loaded.state.members.map(member => member.name))
    const unknown = targets.filter(target => !roster.has(target))
    if (unknown.length > 0) return { ok: false, error: { code: 'unknown-targets', names: unknown } }
    if (request.requestId !== undefined) {
      const previous = loaded.session.snapshotEvents().find(event => event.type === 'room/dispatch' && event.data.id === request.requestId)
      if (previous?.type === 'room/dispatch') return { ok: true, value: { parsed: { targets: previous.data.targets, text: previous.data.text }, seq: previous.seq } }
    }
    loaded.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: request.text.trim() }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const dispatch = loaded.session.append('room/dispatch', {
      id: request.requestId ?? randomUUID(), targets, text, origin: 'human',
      targetIds: targets.map(name => memberId(loaded.session.snapshotEvents(), loaded.state.members.find(member => member.name === name)!)),
    })
    for (const target of targets) {
      loaded.session.append('room/task-added', {
        id: randomUUID(), member: target, title: taskTitle(text), status: 'in_progress',
      })
    }
    await this.ctx.sessions.flush(loaded.session)
    for (const target of targets) {
      this.engine.dispatch(loaded.session, target, text, { dispatchSeq: dispatch.seq })
    }
    return { ok: true, value: { parsed: { targets, text }, seq: dispatch.seq } }
  }

  /**
   * Dispatch one message to one member (host-only — the `room_message` tool's
   * path; the model-facing equivalent of the human's `@member text`). Same
   * dispatch internals as postMessage minus the user/message bubble: the
   * caller is the room's own main agent, so the text must NOT wear the human
   * bubble (source kind 'user' would misattribute it). The dispatch record
   * and the auto-opened in_progress task journal as usual.
   * @param request - room session, addressee, text.
   * @returns the dispatch receipt, or a rejection.
   */
  async messageMember(request: RoomMessageRequest, actorChildSessionId?: string): Promise<RoomMessageResult> {
    // Messaging PROMOTES too (the room_message tool's gate): the main agent
    // answering "把 kimi 拉进来问一下…" promotes its own session, then the
    // roster check runs against the promoted state.
    const loaded = await this.ensureRoom(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (!this.isCurrentCoordinator(loaded.session, actorChildSessionId)) return { ok: false, error: { code: 'not-coordinator' } }
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    if (!loaded.state.members.some(member => member.name === request.member)) {
      return { ok: false, error: { code: 'member-not-found' } }
    }
    const text = request.text.trim()
    if (text === '') return { ok: false, error: { code: 'empty-text' } }
    const coordinator = coordinatorMember(loaded.state, loaded.session.snapshotEvents())
    const target = loaded.state.members.find(member => member.name === request.member)!
    const dispatch = loaded.session.append('room/dispatch', {
      id: randomUUID(), targets: [request.member], targetIds: [memberId(loaded.session.snapshotEvents(), target)], text, origin: 'coordinator',
      ...coordinator === undefined || coordinator.name === request.member ? {} : { replyTo: memberId(loaded.session.snapshotEvents(), coordinator) },
    })
    loaded.session.append('room/task-added', {
      id: randomUUID(), member: request.member, title: taskTitle(text), status: 'in_progress',
    })
    await this.ctx.sessions.flush(loaded.session)
    this.engine.dispatch(loaded.session, request.member, text, { dispatchSeq: dispatch.seq })
    return { ok: true, value: { member: request.member } }
  }

  /** Host-authenticated actor; model tool arguments never provide the room or sender. */
  private isCurrentCoordinator(session: Session, actorChildSessionId?: string): boolean {
    const events = session.snapshotEvents()
    const coordinator = coordinatorMember(replay(events), events)
    return actorChildSessionId === undefined ? coordinator?.kind === 'main-agent' : coordinator?.childSessionId === actorChildSessionId
  }

  /** Bounded shared room context for native and external model tools; reading never wakes an agent. */
  async readRoomContext(sessionId: string): Promise<string> {
    const state = await this.getState({ sessionId: SessionId(sessionId) })
    if (!state.ok) throw new Error(`Room unavailable: ${state.error.code}`)
    const events = this.ctx.sessions.get(SessionId(sessionId))?.snapshotEvents() ?? []
    const recent = events.filter(event => event.type === 'room/speech').slice(-12).map(event => event.type === 'room/speech' ? { member: event.data.member, text: event.data.text.slice(0, 2000) } : null)
    return JSON.stringify({ coordinator: coordinatorMember(state.value)?.name,
      state: { ...state.value, deliveries: state.value.deliveries?.slice(-30), tasks: state.value.tasks.slice(-100), relays: state.value.relays.slice(-30) },
      providers: await this.listProviders({}), recent })
  }

  /** Shared backend for external MCP room tools. Not exposed as a browser Remote. */
  async receiveMemberCommand(actor: LocalAgentMemberRun, command: MemberRoomCommand): Promise<MemberMessageOutcome> {
    try {
      const loaded = await this.ensureLive(SessionId(actor.parentSessionId))
      if (!loaded.ok) return { ok: false, error: `Room unavailable: ${loaded.error.code}` }
      const sender = loaded.state.members.find(member => member.childSessionId === actor.childSessionId && member.provider === actor.provider)
      if (sender === undefined) return { ok: false, error: 'The authenticated member is not in this room roster' }
      if (command === null || typeof command !== 'object' || command.arguments === null || typeof command.arguments !== 'object' || Array.isArray(command.arguments)) return { ok: false, error: 'Malformed room command' }
      const args = command.arguments
      const allowed: Record<string, readonly string[]> = { room_read: [], room_invite: ['provider', 'name', 'instructions', 'cwd', 'model', 'firstTask'], room_message: ['member', 'text'] }
      const keys = allowed[command.name]
      if (keys === undefined || Object.keys(args).some(key => !keys.includes(key))) return { ok: false, error: 'Unknown room command or argument; room and actor identity are host-owned' }
      const required = (key: string): string => {
        const value = args[key]
        if (typeof value !== 'string' || value.trim() === '') throw new Error(`A non-empty ${key} is required`)
        return value
      }
      const optional = (key: string): string | undefined => args[key] === undefined ? undefined : required(key)
      if (command.name === 'room_read') {
        return { ok: true, receipt: JSON.stringify({ self: sender.name, ...JSON.parse(await this.readRoomContext(loaded.session.id)) }) }
      }
      if (!this.isCurrentCoordinator(loaded.session, actor.childSessionId)) return { ok: false, error: 'Only the current coordinator may invite members or dispatch work' }
      const result = command.name === 'room_invite'
        ? await this.inviteMember({ sessionId: loaded.session.id, provider: required('provider'), name: required('name'),
          ...optional('instructions') === undefined ? {} : { instructions: optional('instructions')! },
          ...optional('cwd') === undefined ? {} : { cwd: optional('cwd')! },
          ...optional('model') === undefined ? {} : { model: optional('model')! },
          ...optional('firstTask') === undefined ? {} : { firstTask: optional('firstTask')! },
        }, 'agent', actor.childSessionId)
        : await this.messageMember({ sessionId: loaded.session.id, member: required('member'), text: required('text') }, actor.childSessionId)
      return result.ok ? { ok: true, receipt: JSON.stringify(result.value) } : { ok: false, error: result.error.code }
    } catch (error) { return { ok: false, error: String(error) } }
  }

  /**
   * The notification gate entry, verbatim-frozen contract for the local-agent
   * family bridge (`ctx.get('room')` + duck-typed call). The call crosses an
   * untyped package boundary, so the message shape is validated at runtime:
   * a malformed message throws (the bridge treats a rejection as "room does
   * not claim this" and delivers directly) instead of poisoning the journal.
   * `from`/`to` arrive as roster names OR member child session ids (the
   * bridge cannot speak names for the sender — only room owns the roster);
   * both are normalized to roster names when resolvable, so the pending card
   * and the delivery text (`{from} 给你的通知: …`) read as names. Phase 1's
   * gate is ALWAYS human confirmation: the relay is journaled pending and
   * the sender receives 'pending-confirm' (never 'sent' — the bridge keeps
   * the member's conclusion honest). A non-room parent session throws.
   * @param request - sender, recipient, content, the shared parent session, provenance.
   * @returns the gate receipt.
   */
  async receiveMemberMessage(request: RoomMemberMessage): Promise<RoomMemberMessageReceipt> {
    if (typeof request?.from !== 'string' || typeof request.to !== 'string'
      || typeof request.content !== 'string' || typeof request.parentSessionId !== 'string') {
      throw new Error('room: malformed member message (from/to/content/parentSessionId must be strings)')
    }
    const loaded = await this.ensureLive(request.parentSessionId)
    if (!loaded.ok) throw new Error(`room: not a room session (${loaded.error.code})`)
    const sender = loaded.state.members.find(member => member.childSessionId === request.from && member.provider === request.provenance?.provider)
    if (sender !== undefined && this.isCurrentCoordinator(loaded.session, request.from)) {
      const target = loaded.state.members.find(member => member.name === request.to || member.childSessionId === request.to)
      if (target === undefined) throw new Error('Unknown room member')
      const result = await this.messageMember({ sessionId: loaded.session.id, member: target.name, text: request.content }, request.from)
      if (!result.ok) throw new Error(result.error.code)
      return 'sent'
    }
    const resolveName = (endpoint: string): string => {
      const byName = loaded.state.members.find(member => member.name === endpoint)
      if (byName !== undefined) return byName.name
      return loaded.state.members.find(member => member.childSessionId === endpoint)?.name ?? endpoint
    }
    loaded.session.append('room/relay', {
      id: randomUUID(),
      from: resolveName(request.from),
      to: resolveName(request.to),
      content: request.content,
      ...request.provenance === undefined ? {} : { provenance: request.provenance },
    })
    await this.ctx.sessions.flush(loaded.session)
    return 'pending-confirm'
  }

  /**
   * Confirm a pending relay: journal the confirmed edge and dispatch the
   * notification to the recipient as a continuation (`{from} 给你的通知:
   * {content}`); the engine marks the relay sent once the recipient's own
   * session receives the prompt.
   * @param request - room session, relay id.
   * @returns the resolution receipt, or a rejection.
   */
  @Remote('confirmRelay')
  async confirmRelay(request: RoomRelayResolveRequest): Promise<RoomRelayResolveResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const relay = loaded.state.relays.find(entry => entry.id === request.relayId)
    if (relay === undefined) return { ok: false, error: { code: 'relay-not-found' } }
    if (relay.state !== 'pending') return { ok: false, error: { code: 'relay-not-pending' } }
    if (!loaded.state.members.some(member => member.name === relay.to)) {
      return { ok: false, error: { code: 'member-not-found' } }
    }
    loaded.session.append('room/relay-resolved', { id: relay.id, state: 'confirmed' })
    await this.ctx.sessions.flush(loaded.session)
    this.engine.dispatch(loaded.session, relay.to, `${relay.from} 给你的通知: ${relay.content}`, {
      relayIds: [relay.id],
    })
    return { ok: true, value: { relayId: relay.id } }
  }

  /**
   * Dismiss a pending relay: the notification never reaches anyone.
   * @param request - room session, relay id.
   * @returns the resolution receipt, or a rejection.
   */
  @Remote('dismissRelay')
  async dismissRelay(request: RoomRelayResolveRequest): Promise<RoomRelayResolveResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const relay = loaded.state.relays.find(entry => entry.id === request.relayId)
    if (relay === undefined) return { ok: false, error: { code: 'relay-not-found' } }
    if (relay.state !== 'pending') return { ok: false, error: { code: 'relay-not-pending' } }
    loaded.session.append('room/relay-resolved', { id: relay.id, state: 'dismissed' })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { relayId: relay.id } }
  }

  /**
   * Add a task to a member's board lane (the human's management entry; @-
   * dispatches auto-open in_progress tasks, this opens a pending one).
   * `blockedBy` names the member the task waits on (display only — it never
   * dispatches anything); it must resolve against the roster.
   * @param request - room session, member, title, optional blockedBy.
   * @returns the new task's id, or a rejection.
   */
  @Remote('addTask')
  async addTask(request: RoomAddTaskRequest): Promise<RoomAddTaskResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (!loaded.state.members.some(member => member.name === request.member)) {
      return { ok: false, error: { code: 'member-not-found' } }
    }
    if (request.title.trim() === '') return { ok: false, error: { code: 'empty-text' } }
    if (request.blockedBy !== undefined
      && !loaded.state.members.some(member => member.name === request.blockedBy)) {
      return { ok: false, error: { code: 'member-not-found' } }
    }
    const id = randomUUID()
    loaded.session.append('room/task-added', {
      id, member: request.member, title: request.title.trim(), status: 'pending',
      ...request.blockedBy === undefined ? {} : { blockedBy: request.blockedBy },
    })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { id } }
  }

  /**
   * Close an open task (done by default, or cancelled). A failed task is
   * still open for closing — that is the human's dismiss path after a
   * failed run (the board's [关闭] passes 'cancelled').
   * @param request - room session, task id, optional closing status.
   * @returns the closed task's id, or a rejection.
   */
  @Remote('closeTask')
  async closeTask(request: RoomCloseTaskRequest): Promise<RoomCloseTaskResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const task = loaded.state.tasks.find(entry => entry.id === request.taskId)
    if (task === undefined) return { ok: false, error: { code: 'task-not-found' } }
    if (task.status === 'done' || task.status === 'cancelled') {
      return { ok: false, error: { code: 'task-closed' } }
    }
    loaded.session.append('room/task-updated', { id: task.id, status: request.status ?? 'done' })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { id: task.id } }
  }

  /**
   * Edit an open task's title and/or blockedBy (the `room_task` tool's update
   * action; journaled as `room/task-edited`, status changes stay on
   * closeTask). Host method only — the capsule UI edits nothing but the goal.
   * `blockedBy: null` clears the wait; a string must resolve against the
   * roster. A closed task takes no edits.
   * @param request - room session, task id, and at least one edited field.
   * @returns the edited task's id, or a rejection.
   */
  async updateTask(request: RoomUpdateTaskRequest): Promise<RoomUpdateTaskResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const task = loaded.state.tasks.find(entry => entry.id === request.taskId)
    if (task === undefined) return { ok: false, error: { code: 'task-not-found' } }
    if (task.status === 'done' || task.status === 'cancelled') {
      return { ok: false, error: { code: 'task-closed' } }
    }
    if (request.title === undefined && request.blockedBy === undefined) {
      return { ok: false, error: { code: 'nothing-to-update' } }
    }
    if (request.title !== undefined && request.title.trim() === '') {
      return { ok: false, error: { code: 'empty-text' } }
    }
    if (typeof request.blockedBy === 'string'
      && !loaded.state.members.some(member => member.name === request.blockedBy)) {
      return { ok: false, error: { code: 'member-not-found' } }
    }
    loaded.session.append('room/task-edited', {
      id: task.id,
      ...request.title === undefined ? {} : { title: request.title.trim() },
      ...request.blockedBy === undefined ? {} : { blockedBy: request.blockedBy },
    })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { id: task.id } }
  }

  /**
   * Set (or, with a blank text, clear) the room's goal. The goal is one
   * journaled line — the latest `room/goal` event wins; it rides the top of
   * the roster section in every member prompt and drives the dock's goal
   * capsule. Pure display/coordination text: it never dispatches anything.
   * @param request - room session and goal text.
   * @returns the now-current goal (absent after a clear), or a rejection.
   */
  @Remote('setGoal')
  async setGoal(request: RoomSetGoalRequest): Promise<RoomSetGoalResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const text = request.text.trim()
    loaded.session.append('room/goal', { text })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: text === '' ? {} : { goal: text } }
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
  async cancel(request: RoomCancelRequest): Promise<RoomCancelResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const member = loaded.state.members.find(entry => entry.name === request.name)
    if (member === undefined) return { ok: false, error: { code: 'member-not-found' } }
    const facade = probeLocalAgent(this.ctx)
    const hit = facade !== undefined && member.childSessionId !== undefined
      ? facade.cancel(member.childSessionId)
      : false
    if (hit) {
      const running = loaded.state.runs.find(entry => entry.member === request.name && entry.state === 'running')
      loaded.session.append('room/run-state', {
        member: request.name, state: 'cancelled', startedAt: running?.startedAt ?? Date.now(),
      })
      // The engine's settle no-ops behind this edge, so the task closing the
      // settle would have done happens here: the dispatch-opened in_progress
      // task cancels with its run.
      for (const task of loaded.state.tasks) {
        if (task.member === request.name && task.status === 'in_progress') {
          loaded.session.append('room/task-updated', { id: task.id, status: 'cancelled' })
        }
      }
      await this.ctx.sessions.flush(loaded.session)
      return { ok: true, value: { cancelled: true } }
    }
    return { ok: true, value: { cancelled: false } }
  }
}

export default RoomService
