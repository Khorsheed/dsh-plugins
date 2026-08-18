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

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Room identity marker: the session carrying this log-only event is a
     * room. Log-only (no surface intent), so it never reaches the model.
     */
    'room/created': RoomCreatedEvent
  }
}

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
