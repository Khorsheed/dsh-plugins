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

/** A human @-message: blackboard entry and dispatch record in one. */
export interface RoomDispatchEvent {
  readonly targets: readonly string[]
  readonly text: string
}

/** A bare human message: blackboard only, triggers nobody. */
export interface RoomNoteEvent {
  readonly text: string
}

/** A member's final reply, mirrored onto the blackboard. */
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
    /** Blackboard: a human @-message (also the dispatch record). */
    'room/dispatch': RoomDispatchEvent
    /** Blackboard: a bare human message. */
    'room/note': RoomNoteEvent
    /** Blackboard: a member's reply. */
    'room/speech': RoomSpeechEvent
    /** Member run lifecycle. */
    'room/run-state': RoomRunStateEvent
  }
}

/** One roster member, as folded by the journal replay. */
export interface RoomMember {
  readonly name: string
  readonly kind: 'main-agent' | 'cli'
  readonly provider?: string
  readonly instructions?: string
  readonly invitedBy: 'human' | 'agent'
  readonly childSessionId?: SessionId
}

/** One blackboard entry, as folded by the journal replay (in log order). */
export type RoomBlackboardEntry =
  | { readonly kind: 'dispatch'; readonly seq: number; readonly targets: readonly string[]; readonly text: string }
  | { readonly kind: 'note'; readonly seq: number; readonly text: string }
  | {
    readonly kind: 'speech'
    readonly seq: number
    readonly member: string
    readonly text: string
    readonly childSessionId?: SessionId
    readonly durationMs?: number
  }

/** A member's blackboard read cursor: the seq of the latest dispatch naming them. */
export interface RoomDispatchCursor {
  readonly member: string
  readonly seq: number
}

/** A member's current run state, as folded by the journal replay. */
export interface RoomMemberRun {
  readonly member: string
  readonly state: 'running' | 'done' | 'cancelled' | 'failed'
  readonly startedAt: number
  readonly elapsedMs?: number
}

/** The replayed room state: roster, blackboard, dispatch cursors, run states. */
export interface RoomState {
  readonly members: readonly RoomMember[]
  readonly blackboard: readonly RoomBlackboardEntry[]
  readonly cursors: readonly RoomDispatchCursor[]
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
  /** A cold room's agent resume failed (persistence or preset composition). */
  | { readonly code: 'resume-failed'; readonly message: string }

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
   * Optional first task. Recorded on the roster event's acceptance only —
   * the dispatch engine (next step) turns it into the first run.
   */
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

/** postMessage request: a human message into the room. */
export interface RoomPostMessageRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** Raw composer text: leading `@name` tokens address members. */
  readonly text: string
}

/** What the postMessage parser made of the raw text. */
export interface RoomPostParsed {
  /** Addressed members (empty for a bare note). */
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
