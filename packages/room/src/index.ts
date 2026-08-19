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
import { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: pulls the `agents` registry merge onto Context (create/resume
// are consumed through the registry, not the agent-loop package).
import type {} from '@deepseek-ai/dsh-agent'
// The persistence read path refuses logs carrying event types outside this
// catalog; registering the room vocabulary declares that a room-mounted build
// understands them (see ROOM_EVENT_TYPES in journal.ts).
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { composeRoomAgent, inspectCold, roomSessionPreset } from './agent-setup.ts'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: pulls the `room/*` SessionEventMap merges.
import type {} from './types.ts'
// Type-only: pulls the `tools` ToolRuntime merge onto Context (deferred inject).
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { probeLocalAgent, probeLocalAgentRoster } from './adapter.ts'
import { DispatchEngine } from './dispatch.ts'
import { isRoomLog, MAIN_AGENT_MEMBER, parseMentions, replay, ROOM_EVENT_TYPES } from './journal.ts'
import { roomInviteTool } from './tool.ts'
import type {
  RoomAddTaskRequest, RoomAddTaskResult,
  RoomCancelRequest, RoomCancelResult,
  RoomCloseTaskRequest, RoomCloseTaskResult,
  RoomCreateRequest, RoomCreateResult, RoomFailure,
  RoomGetStateRequest, RoomGetStateResult,
  RoomInviteRequest, RoomInviteResult,
  RoomIsRoomRequest,
  RoomListProvidersRequest,
  RoomMemberMessage, RoomMemberMessageReceipt,
  RoomPostMessageRequest, RoomPostMessageResult,
  RoomProviderInfo, RoomProviderList,
  RoomRelayResolveRequest, RoomRelayResolveResult,
  RoomRemoveMemberRequest, RoomRemoveMemberResult,
  RoomState, RoomUpdateMemberRequest, RoomUpdateMemberResult,
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
 * room Remote service: room creation, roster management, the human @-message
 * intake, the notification gate, the task board, and run cancellation. A
 * room IS a normal session; the journal is its only state.
 */
export class RoomService extends TypertRemoteService {
  static inject = ['sessions', 'agents']

  /** The dispatch engine executing this service's dispatch records. */
  readonly engine: DispatchEngine

  /** sessionId → in-flight cold resume (mutations on a cold room dedupe). */
  private readonly resumes = new Map<SessionId, Promise<RoomLoad>>()

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
    // The tools registry joins through DEFERRED injection, not a constructor
    // probe: an apply-time ctx.get races the registry's own mount order (the
    // probe loses on the real composition tree), while ctx.inject fires when
    // the registry appears and never fires in a composition without one —
    // losing only the model-facing invitation path, never the boot.
    this.ctx.inject(['tools'], (toolsCtx) => {
      toolsCtx.effect(() => toolsCtx.tools.register(roomInviteTool(this)), 'room: room_invite tool')
    })
  }

  /** Resolve a LIVE session as a room: presence, marker, replayed state. */
  private load(sessionId: SessionId): RoomLoad {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return { ok: false, error: { code: 'session-not-found' } }
    if (!isRoomLog(session.events)) return { ok: false, error: { code: 'not-a-room' } }
    return { ok: true, session, state: replay(session.events) }
  }

  /**
   * Read a session as a room without side effects: the live store first, then
   * a persistence inspection (a cold room after a host restart answers from
   * its durable log; nothing is attached or resumed on a read).
   */
  private async loadCold(sessionId: SessionId): Promise<RoomColdLoad> {
    const live = this.ctx.sessions.get(sessionId)
    if (live !== undefined) {
      return isRoomLog(live.events)
        ? { ok: true, state: replay(live.events), preset: roomSessionPreset(live) }
        : { ok: false, error: { code: 'not-a-room' } }
    }
    const inspected = await inspectCold(this.ctx, sessionId)
    if (inspected === undefined) return { ok: false, error: { code: 'session-not-found' } }
    if (!isRoomLog(inspected.events)) return { ok: false, error: { code: 'not-a-room' } }
    return {
      ok: true,
      state: replay(inspected.events),
      preset: resolveSessionPreset({ header: inspected.meta, events: inspected.events }),
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
    return this.load(sessionId)
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
    if (session !== undefined) return isRoomLog(session.events)
    const inspected = await inspectCold(this.ctx, request.sessionId)
    return inspected !== undefined && isRoomLog(inspected.events)
  }

  /**
   * Create a room: publish the session through the agent factory (the
   * official session.create shape — a live main agent under the default
   * preset, its id recorded on the header), append the `room/created`
   * identity marker, seat the main agent on the roster (an equal member,
   * addressable like any other), and flush durable. The live agent is what
   * CLI-member dispatch anchors to (the delegation facade resolves the
   * parent through `ctx.agents.get`, live agents only).
   * @param request - optional storage metadata (cwd).
   * @returns the new room session's identity.
   */
  @Remote('createRoom')
  async createRoom(request: RoomCreateRequest): Promise<RoomCreateResult> {
    const composition = await composeRoomAgent(this.ctx, undefined)
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: {
        ...request.cwd === undefined ? {} : { cwd: request.cwd },
        ...composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset },
      },
      ...composition.setup === undefined ? {} : { setup: composition.setup },
    })
    const session = handle.agent.session
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
   * Validate and journal an invitation: the name must be parseable by the
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
  async inviteMember(request: RoomInviteRequest, invitedBy: 'human' | 'agent'): Promise<RoomInviteResult> {
    const loaded = await this.ensureLive(request.sessionId)
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
    loaded.session.append('room/member-added', {
      name: request.name,
      kind: 'cli',
      provider: request.provider,
      invitedBy,
      ...request.instructions === undefined ? {} : { instructions: request.instructions },
      ...request.cwd === undefined || request.cwd.trim() === '' ? {} : { cwd: request.cwd.trim() },
    })
    let firstTaskSeq: number | undefined
    if (request.firstTask !== undefined) {
      firstTaskSeq = loaded.session.append('room/dispatch', {
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
   * Update a member's role instructions. The edit rides the member's next
   * dispatch as a context update (the CLI session itself is never rewritten).
   * @param request - room session, member name, new instructions.
   * @returns the update receipt, or a rejection.
   */
  @Remote('updateMember')
  async updateMember(request: RoomUpdateMemberRequest): Promise<RoomUpdateMemberResult> {
    const loaded = await this.ensureLive(request.sessionId)
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
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (!loaded.state.members.some(member => member.name === request.name)) {
      return { ok: false, error: { code: 'member-not-found' } }
    }
    loaded.session.append('room/member-removed', { name: request.name })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { name: request.name } }
  }

  /**
   * Post a human @-message into the room: leading `@name` tokens address
   * members (a `room/dispatch` journal record, executed by the engine, and
   * one auto-opened in_progress task per target). The human's raw text is
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
   * without an @-mention.
   * @param request - room session and raw composer text.
   * @returns the parse receipt, or a rejection.
   */
  @Remote('postMessage')
  async postMessage(request: RoomPostMessageRequest): Promise<RoomPostMessageResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (request.text.trim() === '') return { ok: false, error: { code: 'empty-text' } }
    const parsed = parseMentions(request.text)
    if (parsed.targets.length === 0) return { ok: false, error: { code: 'no-targets' } }
    if (parsed.text === '') return { ok: false, error: { code: 'empty-text' } }
    const roster = new Set(loaded.state.members.map(member => member.name))
    const unknown = parsed.targets.filter(target => !roster.has(target))
    if (unknown.length > 0) return { ok: false, error: { code: 'unknown-targets', names: unknown } }
    loaded.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: request.text.trim() }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const dispatch = loaded.session.append('room/dispatch', { targets: parsed.targets, text: parsed.text })
    for (const target of parsed.targets) {
      loaded.session.append('room/task-added', {
        id: randomUUID(), member: target, title: taskTitle(parsed.text), status: 'in_progress',
      })
    }
    await this.ctx.sessions.flush(loaded.session)
    for (const target of parsed.targets) {
      this.engine.dispatch(loaded.session, target, parsed.text, { dispatchSeq: dispatch.seq })
    }
    return { ok: true, value: { parsed, seq: dispatch.seq } }
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
   * @param request - room session, member, title.
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
    const id = randomUUID()
    loaded.session.append('room/task-added', {
      id, member: request.member, title: request.title.trim(), status: 'pending',
    })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { id } }
  }

  /**
   * Close an open task (done by default, or cancelled).
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
