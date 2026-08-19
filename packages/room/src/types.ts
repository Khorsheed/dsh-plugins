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
  /** The CLI member's dsh child session, once delegation has started. */
  readonly childSessionId?: SessionId
}

/** A roster member's editable fields changed. */
export interface RoomMemberUpdatedEvent {
  readonly name: string
  readonly instructions?: string
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
 * A human @-message: the dispatch record. Journaled for UI projection and
 * replay (chat-flow lines, task auto-open); it no longer feeds any prompt —
 * a member's prompt is role instructions + roster + notifications + the
 * dispatch text, never a running log.
 */
export interface RoomDispatchEvent {
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

/** Task-board task statuses. */
export type RoomTaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled'

/**
 * A task entered the board: an @-dispatch opens it `in_progress` (title is
 * the dispatch text, truncated), a human addTask opens it `pending`.
 */
export interface RoomTaskAddedEvent {
  readonly id: string
  readonly member: string
  readonly title: string
  readonly status: 'pending' | 'in_progress'
}

/** A task changed status (speech settle closes it; the human manages the rest). */
export interface RoomTaskUpdatedEvent {
  readonly id: string
  readonly status: 'in_progress' | 'done' | 'cancelled'
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
    /** Dispatch record: a human @-message (UI projection + task auto-open). */
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
  }
}

/** One roster member, as folded by the journal replay. */
export interface RoomMember {
  readonly name: string
  readonly kind: 'main-agent' | 'cli'
  readonly provider?: string
  readonly instructions?: string
  readonly invitedBy: 'human' | 'agent'
  /** Member-level working directory (roster record; not yet passed to the facade). */
  readonly cwd?: string
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
}

/** A member's current run state, as folded by the journal replay. */
export interface RoomMemberRun {
  readonly member: string
  readonly state: 'running' | 'done' | 'cancelled' | 'failed'
  readonly startedAt: number
  readonly elapsedMs?: number
}

/**
 * The replayed room state: roster, notification relays, the task board, and
 * run states. There is deliberately NO blackboard/log projection here —
 * members never consume the room's running log (see the design note).
 */
export interface RoomState {
  readonly members: readonly RoomMember[]
  readonly relays: readonly RoomRelay[]
  readonly tasks: readonly RoomTask[]
  readonly runs: readonly RoomMemberRun[]
}

/** Closed failure vocabulary of the room Remote surface. */
export type RoomFailure =
  | { readonly code: 'session-not-found' }
  | { readonly code: 'not-a-room' }
  | { readonly code: 'invalid-name' }
  | { readonly code: 'duplicate-name' }
  | { readonly code: 'empty-provider' }
  | { readonly code: 'member-not-found' }
  | { readonly code: 'empty-text' }
  | { readonly code: 'nothing-to-update' }
  | { readonly code: 'local-agent-unavailable' }
  | { readonly code: 'unknown-targets'; readonly names: readonly string[] }
  /** postMessage without any leading @-mention (bare messages belong to the official submit path). */
  | { readonly code: 'no-targets' }
  | { readonly code: 'relay-not-found' }
  /** The relay exists but already left the pending state. */
  | { readonly code: 'relay-not-pending' }
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

/** createRoom request. */
export interface RoomCreateRequest {
  /** Working directory recorded in the session header; omitted for none. */
  readonly cwd?: string
}

/** createRoom result: the freshly created room session's identity. */
export interface RoomCreateResult {
  /** The new room session. */
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

/** updateMember request: edit a member's role instructions. */
export interface RoomUpdateMemberRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** Member to update. */
  readonly name: string
  /** New role instructions (non-blank when present). */
  readonly instructions?: string
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
  /** Room session. */
  readonly sessionId: SessionId
  /** Raw composer text: leading `@name` tokens address members. */
  readonly text: string
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

/** listProviders request (no parameters). */
export interface RoomListProvidersRequest {}

/** One invitable CLI provider. */
export interface RoomProviderInfo {
  /** The provider id invite/dispatch uses (the harness's delegationProvider). */
  readonly provider: string
  readonly displayName: string
  /** Whether the harness's scoped home holds usable credentials. */
  readonly authenticated: boolean
}

/** listProviders result: the facade verdict plus the roster. */
export interface RoomProviderList {
  /** False when the local-agent delegation facade is absent (CLI members undispatchable). */
  readonly localAgentAvailable: boolean
  readonly providers: readonly RoomProviderInfo[]
}
