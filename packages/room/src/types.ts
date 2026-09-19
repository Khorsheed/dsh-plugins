/**
 * Wire vocabulary shared by the room Host Remote and its browser callers,
 * plus the `room/*` custom session-event vocabulary (merged onto the official
 * SessionEventMap — the schedule package's `schedule/change` is the in-tree
 * precedent). Types only: the generated Remote codecs import this module
 * type-side, and the client bundle never inlines host runtime code.
 * @module @khorsheed/dsh-room/types
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * A JSON-safe value (mirrors the host's JsonValue shape without importing the
 * dsh-session MAIN entry — that entry's Context merge is host-side and must
 * not leak into the client type program). Relay provenance crosses the Remote
 * boundary, so it must be constrained JSON.
 */
export type RoomJsonValue = null | boolean | number | string | RoomJsonValue[] | { [key: string]: RoomJsonValue }

/**
 * Room identity marker payload. Appended once at room creation; replaying the
 * session's event log recovers room identity, so no session-header change is
 * needed. `version` gates future payload evolution.
 */
export interface RoomCreatedEvent {
  readonly version: 1
}

/**
 * A member joined the roster. `name` is both the addressing name and the
 * display name: unique within the room, free of whitespace and `@` (composer
 * @-addressing must stay parseable), and decoupled from the provider so two
 * instances of one provider can coexist (`ada (kimi-cli)`).
 */
export interface RoomMemberAddedEvent {
  /** Stable identity; older journals derive it from their original join event. */
  readonly id?: string
  readonly name: string
  readonly kind: 'main-agent' | 'cli'
  /** CLI provider id; present exactly on `kind: 'cli'` members. */
  readonly provider?: string
  /** Role instructions, prepended to the member's first dispatch. */
  readonly instructions?: string
  readonly invitedBy: 'human' | 'agent'
  /**
   * The member's own working directory (empty = inherits the room session's
   * cwd). Roster-only for now: the local-agent facade's per-call cwd override
   * (family need R2) has not landed, so the adapter does NOT pass it down yet.
   */
  readonly cwd?: string
  /**
   * The delegation's model (invite-time only, local-agent harness providers):
   * recorded on the roster and passed to the facade as the `start` call's
   * `model` option on the member's first dispatch — providers bind it at
   * spawn for both exec and live rounds. Blank/omitted = follow the harness
   * default.
   */
  readonly model?: string
  /** The CLI member's dsh child session, once delegation has started. */
  readonly childSessionId?: SessionId
}

/** A roster member's editable fields changed. */
export interface RoomMemberUpdatedEvent {
  /**
   * The member this update addresses, by its CURRENT name (a rename carries
   * the new name in `rename`; keeping `name` as the addressing key keeps
   * every pre-rename journal replayable).
   */
  readonly name: string
  /** Rename: the member's new @-addressing name (validated at write: unique, no whitespace, no "@"). */
  readonly rename?: string
  /** New role instructions; null CLEARS them (later dispatches inject none). */
  readonly instructions?: string | null
  /**
   * New member-level cwd (roster-recorded; the delegation facade's per-call
   * override is the family's open R2). null CLEARS the override — the member
   * inherits the room session's cwd again.
   */
  readonly cwd?: string | null
  /**
   * The member's intended model, edited through the members tab's edit dialog.
   * Roster-recorded intent: consumed as the facade `start` call's `model`
   * option while the member was never dispatched (the live member's immediate
   * switch rides the localAgentGateway `setMemberModel` — the client calls
   * both). null CLEARS it — the member follows the harness default again.
   */
  readonly model?: string | null
  /**
   * The CLI member's delegation handle, journaled when the member's first
   * run starts (invite predates the handle; the dispatch engine appends this
   * update so a reload reattaches the member to its child session).
   */
  readonly childSessionId?: SessionId
}

/** A member left the roster. */
export interface RoomMemberRemovedEvent {
  readonly name: string
}

/**
 * A human @-message: the dispatch record. Pure bookkeeping — the task
 * auto-open, the engine's instruction cursors, and replay. It drives NO chat
 * node: the human's words land as a standard `user/message` event (appended
 * alongside, see RoomService.postMessage) and render as the official user
 * bubble. It never feeds any prompt either — a member's prompt is role
 * instructions + roster + notifications + the dispatch text, never a running
 * log.
 */
export interface RoomDispatchEvent {
  /** Caller retry identity, persisted before accepting input. */
  readonly id?: string
  readonly targetIds?: readonly string[]
  readonly origin?: 'human' | 'coordinator' | 'report' | 'relay'
  readonly replyTo?: string
  /** Completion report deduplication key (one source delivery). */
  readonly reportFor?: string
  readonly targets: readonly string[]
  readonly text: string
}

/**
 * A member's final reply, mirrored into the room journal for UI projection
 * and replay. Never re-injected into any prompt: the member's own CLI
 * session (resume chain) holds its working memory.
 */
export interface RoomSpeechEvent {
  readonly member: string
  readonly text: string
  readonly childSessionId?: SessionId
  /** Dispatch→settle milliseconds, when measured. */
  readonly durationMs?: number
}

/** A member run's lifecycle edge. */
export interface RoomRunStateEvent {
  readonly member: string
  readonly state: 'running' | 'done' | 'cancelled' | 'failed'
  readonly startedAt: number
  readonly elapsedMs?: number
  /**
   * Why the run failed (terminal `failed` edges only): the engine's caught
   * fault message, surfaced by the client's dim failure row. Optional so old
   * journal events replay fine.
   */
  readonly error?: string
}

/** A relay's lifecycle states (see the design note's notification channel). */
export type RoomRelayState = 'pending' | 'confirmed' | 'dismissed' | 'sent'

/**
 * A member-to-member notification arrived at the room gate (journaled as
 * pending): the family bridge's `receiveMemberMessage` call, or the fallback
 * parse of a reply's trailing `@name <content>` own line. `provenance` is
 * the origin record (the bridge passes the sender's delegation record; the
 * fallback records the speech it was parsed from).
 */
export interface RoomRelayEvent {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly content: string
  readonly provenance?: Record<string, RoomJsonValue>
}

/** A relay left the pending state (confirmed, dismissed, or delivered). */
export interface RoomRelayResolvedEvent {
  readonly id: string
  readonly state: 'confirmed' | 'dismissed' | 'sent'
}

/**
 * Task-board task statuses. `failed` is terminal-from-the-engine (the run
 * settle writes it) but stays human-actionable: the board keeps the row
 * visible until the human dismisses it (closeTask → cancelled) or
 * re-dispatches.
 */
export type RoomTaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled' | 'failed'

/**
 * The room's goal was set (or cleared: an empty text). Log-only; the journal
 * fold keeps the LATEST goal event's text as the current goal (empty/absent =
 * unset). The goal rides the roster section of every member prompt, and the
 * dock's goal capsule renders it with the task progress.
 */
export interface RoomGoalEvent {
  readonly text: string
}

/**
 * A task entered the board: an @-dispatch opens it `in_progress` (title is
 * the dispatch text, truncated), a human addTask opens it `pending`.
 * `blockedBy` names the MEMBER the task waits on — pure display ("等 ada"):
 * the row renders grey until that member has no open task left. It never
 * triggers any automatic dispatch.
 */
export interface RoomTaskAddedEvent {
  readonly id: string
  readonly member: string
  readonly title: string
  readonly status: 'pending' | 'in_progress'
  readonly blockedBy?: string
}

/**
 * A task changed status (a run settle closes the auto-opened task to the
 * run's own terminal state — done/cancelled/failed; the human manages the
 * rest).
 */
export interface RoomTaskUpdatedEvent {
  readonly id: string
  readonly status: 'in_progress' | 'done' | 'cancelled' | 'failed'
}

/**
 * A task's editable fields changed (the `room_task` tool's `update` action):
 * a title rename and/or a `blockedBy` re-target (`null` clears the wait).
 * Status changes stay on `room/task-updated`; closed tasks take no edits.
 */
export interface RoomTaskEditedEvent {
  readonly id: string
  readonly title?: string
  /** New blocking member; explicit null clears the wait. */
  readonly blockedBy?: string | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Room identity marker: the session carrying this log-only event is a
     * room. Log-only (no surface intent), so it never reaches the model.
     */
    'room/created': RoomCreatedEvent
    /** Roster mutation: a member joined. */
    'room/member-added': RoomMemberAddedEvent
    /** Roster mutation: a member's editable fields changed. */
    'room/member-updated': RoomMemberUpdatedEvent
    /** Roster mutation: a member left. */
    'room/member-removed': RoomMemberRemovedEvent
    /** Dispatch record: a human @-message (bookkeeping: task auto-open, dispatch cursors). */
    'room/dispatch': RoomDispatchEvent
    /** Member speech mirror (UI projection; never re-injected into prompts). */
    'room/speech': RoomSpeechEvent
    /** Member run lifecycle. */
    'room/run-state': RoomRunStateEvent
    /** Notification gate: a member-to-member relay arrived (pending). */
    'room/relay': RoomRelayEvent
    /** Notification gate: a relay was confirmed, dismissed, or delivered. */
    'room/relay-resolved': RoomRelayResolvedEvent
    /** Task board: a task was added. */
    'room/task-added': RoomTaskAddedEvent
    /** Task board: a task changed status. */
    'room/task-updated': RoomTaskUpdatedEvent
    /** Task board: a task's title/blockedBy was edited (the room_task tool's update). */
    'room/task-edited': RoomTaskEditedEvent
    /** Goal: the room's goal was set (or cleared). */
    'room/goal': RoomGoalEvent
  }
}

/** One roster member, as folded by the journal replay. */
export interface RoomMember {
  readonly id?: string
  readonly name: string
  readonly kind: 'main-agent' | 'cli'
  readonly provider?: string
  readonly instructions?: string
  readonly invitedBy: 'human' | 'agent'
  /** Member-level working directory (roster record; not yet passed to the facade). */
  readonly cwd?: string
  /** The member's intended model (roster record; the facade start's `model` option on the first dispatch). */
  readonly model?: string
  readonly childSessionId?: SessionId
}

/** One notification relay, as folded by the journal replay. */
export interface RoomRelay {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly content: string
  readonly provenance?: Record<string, RoomJsonValue>
  readonly state: RoomRelayState
}

/** One task-board task, as folded by the journal replay. */
export interface RoomTask {
  readonly id: string
  readonly member: string
  readonly title: string
  readonly status: RoomTaskStatus
  /** The member this task waits on (display only; never dispatches anything). */
  readonly blockedBy?: string
  /**
   * Epoch ms of the task's latest journal event (add or status update): the
   * goal card's "latest advance" ordering and the row's relative time.
   */
  readonly updatedAt: number
}

/** A member's current run state, as folded by the journal replay. */
export interface RoomMemberRun {
  readonly member: string
  readonly state: 'running' | 'done' | 'cancelled' | 'failed'
  readonly startedAt: number
  readonly elapsedMs?: number
  /** Why the run failed (failed edges only), when the edge carried one. */
  readonly error?: string
}

/**
 * The replayed room state: roster, notification relays, the task board, run
 * states, and the current goal. There is deliberately NO blackboard/log
 * projection here — members never consume the room's running log (see the
 * design note).
 */
export interface RoomState {
  readonly deliveries?: readonly RoomDelivery[]
  readonly coordinator?: RoomCoordinatorEvent
  readonly members: readonly RoomMember[]
  readonly relays: readonly RoomRelay[]
  readonly tasks: readonly RoomTask[]
  readonly runs: readonly RoomMemberRun[]
  /** The current goal text (the latest `room/goal` event), undefined when unset. */
  readonly goal?: string
}

/**
 * The goal progress pair: done tasks over the COUNTABLE total — cancelled
 * and failed tasks leave the denominator (a cancelled task was never part of
 * the plan; a failed one never advanced it).
 */
export interface RoomTaskProgress {
  readonly done: number
  readonly total: number
}

/** Closed failure vocabulary of the room Remote surface. */
export type RoomFailure =
  | { readonly code: 'delivery-not-uncertain' }
  | { readonly code: 'coordinator-busy' }
  | { readonly code: 'coordinator-not-ready'; readonly message: string }
  | { readonly code: 'coordinator-conflict' }
  | { readonly code: 'active-coordinator' }
  | { readonly code: 'configuration-owned-by-core' }
  | { readonly code: 'session-not-found' }
  | { readonly code: 'not-a-room' }
  | { readonly code: 'invalid-name' }
  | { readonly code: 'duplicate-name' }
  | { readonly code: 'empty-provider' }
  | { readonly code: 'member-not-found' }
  | { readonly code: 'empty-text' }
  | { readonly code: 'nothing-to-update' }
  | { readonly code: 'local-agent-unavailable' }
  /**
   * The provider is not any harness's delegation provider (the classic slip:
   * the harness name `kimi` instead of the delegation provider `kimi-cli`).
   * Carries the legal set so the caller (the room_invite tool's model caller,
   * the dialog) can self-correct.
   */
  | { readonly code: 'unknown-provider'; readonly provider: string; readonly available: readonly string[] }
  | { readonly code: 'unknown-targets'; readonly names: readonly string[] }
  /** postMessage without any leading @-mention (bare messages belong to the official submit path). */
  | { readonly code: 'no-targets' }
  | { readonly code: 'relay-not-found' }
  /** The relay exists but already left the pending state. */
  | { readonly code: 'relay-not-pending' }
  /** The main agent is the room itself: it cannot be renamed. */
  | { readonly code: 'main-member' }
  | { readonly code: 'task-not-found' }
  /** The task exists but is already closed (done/cancelled). */
  | { readonly code: 'task-closed' }
  /** A cold room's agent resume failed (persistence or preset composition). */
  | { readonly code: 'resume-failed'; readonly message: string }

/**
 * The family bridge's gate entry, verbatim-frozen contract
 * (`proposals/active/2026-08-19-local-agent-member-channel.md`): the bridge
 * probes `ctx.get('room')` and duck-type-calls this method. Phase 1's gate is
 * always human confirmation, so the receipt is always 'pending-confirm';
 * 'sent'/'busy' belong to the phase-2 auto gate.
 */
export interface RoomMemberMessage {
  readonly from: string
  readonly to: string
  readonly content: string
  readonly parentSessionId: SessionId
  readonly provenance?: Record<string, RoomJsonValue>
}

/** The gate receipt handed back to the sending member through the bridge. */
export type RoomMemberMessageReceipt = 'sent' | 'pending-confirm' | 'busy'

/** isRoom probe: does this session carry the room marker? */
export interface RoomIsRoomRequest {
  /** Session to probe. */
  readonly sessionId: SessionId
}

/** getState request. */
export interface RoomGetStateRequest {
  /** Room session to replay. */
  readonly sessionId: SessionId
}

/** getState outcome: the replayed state or a rejection. */
export type RoomGetStateResult =
  | { readonly ok: true; readonly value: RoomState }
  | { readonly ok: false; readonly error: RoomFailure }

/** invite request: add a CLI member to the roster. */
export interface RoomInviteRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** CLI provider id (non-blank). */
  readonly provider: string
  /** Addressing/display name: unique in the room, no whitespace, no `@`. */
  readonly name: string
  /** Role instructions, prepended to the member's first dispatch. */
  readonly instructions?: string
  /**
   * Member-level working directory (empty/omitted = inherits the room
   * session's cwd). Recorded on the roster; not yet passed to the delegation
   * facade (family need R2 pending).
   */
  readonly cwd?: string
  /** Optional first task, dispatched to the member as soon as it joins. */
  readonly firstTask?: string
  /**
   * The delegation's model (blank/omitted = follow the harness default).
   * Applies to local-agent harness providers only: it lands as the facade
   * `start` call's `model` option, bound at spawn for exec and live alike.
   */
  readonly model?: string
}

/** invite receipt. */
export interface RoomInvitation {
  /** The accepted member name. */
  readonly name: string
  /** True when a first task was supplied and dispatched with the invitation. */
  readonly pendingFirstTask: boolean
}

/** invite outcome. */
export type RoomInviteResult =
  | { readonly ok: true; readonly value: RoomInvitation }
  | { readonly ok: false; readonly error: RoomFailure }

/** updateMember request: edit a member's name, role instructions, cwd, or model. */
export interface RoomUpdateMemberRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** Member to update (its CURRENT name). */
  readonly name: string
  /** Rename: the new @-addressing name (unique, no whitespace, no "@"). */
  readonly rename?: string
  /** New role instructions; null (or a blank string) CLEARS them. */
  readonly instructions?: string | null
  /** New member-level cwd; null (or a blank string) CLEARS the override back to inheriting the room cwd. */
  readonly cwd?: string | null
  /**
   * New intended model (roster-recorded; the first dispatch binds it as the
   * facade start's `model` option); null (or a blank string) CLEARS it back
   * to following the harness default.
   */
  readonly model?: string | null
}

/** updateMember outcome. */
export type RoomUpdateMemberResult =
  | { readonly ok: true; readonly value: { readonly name: string } }
  | { readonly ok: false; readonly error: RoomFailure }

/** removeMember request. */
export interface RoomRemoveMemberRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** Member to remove. */
  readonly name: string
}

/** removeMember outcome. */
export type RoomRemoveMemberResult =
  | { readonly ok: true; readonly value: { readonly name: string } }
  | { readonly ok: false; readonly error: RoomFailure }

/** postMessage request: a human @-message into the room. */
export interface RoomPostMessageRequest {
  readonly requestId?: string
  /** Room session. */
  readonly sessionId: SessionId
  /** Raw composer text: leading `@name` tokens address members. */
  readonly text: string
  /**
   * Menu-picked addressees (the room composer's mention menu records a pick
   * as explicit addressing even when the `@name` sits mid-sentence). Unioned
   * with the parsed leading tokens and validated against the roster the same
   * way; the text itself is dispatched verbatim either way.
   */
  readonly targets?: readonly string[]
}

/** What the postMessage parser made of the raw text. */
export interface RoomPostParsed {
  /** Addressed members (never empty — a bare message is a `no-targets` rejection). */
  readonly targets: readonly string[]
  /** The message body with the leading @-tokens stripped. */
  readonly text: string
}

/** postMessage receipt. */
export interface RoomPostReceipt {
  readonly parsed: RoomPostParsed
  /** Seq of the appended journal event. */
  readonly seq: number
}

/**
 * messageMember request (host-only — the `room_message` tool's path; NOT a
 * Remote): dispatch one message to one member. Identical dispatch semantics
 * to a human's `@member text` minus the user/message bubble (the caller is
 * the main agent, not the human).
 */
export interface RoomMessageRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** The addressee's roster name. */
  readonly member: string
  /** The message text. */
  readonly text: string
}

/** messageMember outcome. */
export type RoomMessageResult =
  | { readonly ok: true; readonly value: { readonly member: string } }
  | { readonly ok: false; readonly error: RoomFailure }

/** postMessage outcome. */
export type RoomPostMessageResult =
  | { readonly ok: true; readonly value: RoomPostReceipt }
  | { readonly ok: false; readonly error: RoomFailure }

/** cancel request: interrupt a member's in-flight run. */
export interface RoomCancelRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** Member whose run should be cancelled. */
  readonly name: string
}

/** cancel receipt. */
export interface RoomCancellation {
  /** True when an in-flight run was found and cancelled. */
  readonly cancelled: boolean
}

/** cancel outcome. */
export type RoomCancelResult =
  | { readonly ok: true; readonly value: RoomCancellation }
  | { readonly ok: false; readonly error: RoomFailure }

/** confirmRelay/dismissRelay request: resolve a pending notification relay. */
export interface RoomRelayResolveRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** The relay to resolve. */
  readonly relayId: string
}

/** confirmRelay/dismissRelay outcome. */
export type RoomRelayResolveResult =
  | { readonly ok: true; readonly value: { readonly relayId: string } }
  | { readonly ok: false; readonly error: RoomFailure }

/** addTask request: a human-added task on a member's board lane. */
export interface RoomAddTaskRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** The member owning the task. */
  readonly member: string
  /** Task title (non-blank). */
  readonly title: string
  /**
   * Optional member this task waits on ("等 ada" — display only, never an
   * automatic dispatch). Must name a roster member when present.
   */
  readonly blockedBy?: string
}

/** addTask outcome. */
export type RoomAddTaskResult =
  | { readonly ok: true; readonly value: { readonly id: string } }
  | { readonly ok: false; readonly error: RoomFailure }

/** closeTask request: close an open task. */
export interface RoomCloseTaskRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** The task to close. */
  readonly taskId: string
  /** Closing status (default 'done'). */
  readonly status?: 'done' | 'cancelled'
}

/** closeTask outcome. */
export type RoomCloseTaskResult =
  | { readonly ok: true; readonly value: { readonly id: string } }
  | { readonly ok: false; readonly error: RoomFailure }

/**
 * updateTask request: edit an open task's title and/or blockedBy (the
 * `room_task` tool's update action — host method only, not on the Remote
 * surface; the capsule UI edits nothing but the goal).
 */
export interface RoomUpdateTaskRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** The task to edit. */
  readonly taskId: string
  /** New title (non-blank when present). */
  readonly title?: string
  /** New blocking member (must be on the roster); explicit null clears the wait. */
  readonly blockedBy?: string | null
}

/** updateTask outcome. */
export type RoomUpdateTaskResult =
  | { readonly ok: true; readonly value: { readonly id: string } }
  | { readonly ok: false; readonly error: RoomFailure }

/** setGoal request: set (or, with a blank text, clear) the room's goal. */
export interface RoomSetGoalRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** Goal text; blank clears the goal. */
  readonly text: string
}

/** setGoal outcome. */
export type RoomSetGoalResult =
  | { readonly ok: true; readonly value: { readonly goal?: string } }
  | { readonly ok: false; readonly error: RoomFailure }

/** listProviders request (no parameters). */
export interface RoomListProvidersRequest {}

/** One invitable CLI provider. */
export interface RoomProviderInfo {
  /** The provider id invite/dispatch uses (the harness's delegationProvider). */
  readonly provider: string
  readonly displayName: string
  /**
   * The roster harness name — the lookup key for the localAgentGateway
   * `harnessModel` read (the invite dialog's model picker). Absent only on
   * a pre-model-broker family core; the dialog then serves a plain text input.
   */
  readonly harness?: string
  /** Whether the harness's scoped home holds usable credentials. */
  readonly authenticated: boolean
}

/** listProviders result: the facade verdict plus the roster. */
export interface RoomProviderList {
  /** False when the local-agent delegation facade is absent (CLI members undispatchable). */
  readonly localAgentAvailable: boolean
  readonly providers: readonly RoomProviderInfo[]
}

/** Durable role change. Handoff is bounded context, never native history migration. */
export interface RoomCoordinatorEvent {
  readonly version: 1
  readonly memberId: string
  readonly revision: number
  readonly previousMemberId: string
  readonly handoff: string
}

export interface RoomSetCoordinatorRequest {
  readonly sessionId: SessionId
  readonly memberId: string
  readonly expectedRevision: number
}
export type RoomSetCoordinatorResult =
  | { readonly ok: true; readonly value: RoomCoordinatorEvent }
  | { readonly ok: false; readonly error: RoomFailure }

/** A dispatch target's durable lifecycle. An uncertain crashed run is never replayed. */
export interface RoomDeliveryStateEvent {
  readonly id: string
  readonly dispatchSeq: number
  readonly memberId: string
  readonly state: 'running' | 'done' | 'cancelled' | 'failed' | 'uncertain'
  readonly text?: string
  readonly error?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'room/coordinator': RoomCoordinatorEvent
    'room/delivery-state': RoomDeliveryStateEvent
  }
}

export interface RoomDelivery {
  readonly id: string
  readonly dispatchSeq: number
  readonly memberId: string
  readonly status: 'queued' | RoomDeliveryStateEvent['state']
  readonly origin: NonNullable<RoomDispatchEvent['origin']>
  readonly text: string
  readonly error?: string
}
export interface RoomReconcileDeliveryRequest {
  readonly sessionId: SessionId
  readonly deliveryId: string
  readonly outcome: 'done' | 'cancelled'
  readonly evidence: string
}
export type RoomReconcileDeliveryResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: RoomFailure }

export interface RoomPrepareMemberRequest {
  readonly sessionId: SessionId
  readonly name: string
}
export type RoomPrepareMemberResult =
  | { readonly ok: true; readonly value: { readonly childSessionId: string } }
  | { readonly ok: false; readonly error: RoomFailure }
