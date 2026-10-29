/**
 * The room desk, as the video_* tools see it. An external member of a room
 * runs its mode's tools as a stand-in over its OWN session, which local-agent
 * marks with the room it works in: `Symbol.for('dsh.agent.desk')` →
 * `{ session, role, member, runId? }` (proposal 2026-10-29-room-desk). The
 * project the room's 剪辑 panel shows is the room session's binding, so:
 *
 * - the coordinator acts ON the desk: it reads the room's project, and its
 *   create/open binds the room session (the room's panel follows);
 * - a member reads its own binding first and falls back to the room's, and its
 *   create/open binds only its own session — the room gets a row with a door,
 *   never a moved front panel;
 * - either way the room hears of an open through room's `room/desk-opened`
 *   event (owner `@khorsheed/dsh-video-studio`), rendered by this package's
 *   client at the end of the member's card, or as a row of its own.
 *
 * The event type is room's vocabulary — only room makes the host accept it in
 * a log, and a desk exists only in a room. Never append a type of this
 * package's own: the host refuses to read a log carrying an unregistered type.
 * Execution stays the member's: no write is fenced by the room session.
 *
 * Inline copy of packages/canvas/src/desk.ts (no import across plugins).
 * @module @khorsheed/dsh-video-studio/desk
 */

/** The desk mark's key on a member's stand-in agent (local-agent's preset tool host). */
const DESK = Symbol.for('dsh.agent.desk')

/** The room session, as far as the tools touch it. */
export interface DeskSession {
  readonly id: unknown
  readonly append: unknown
}

/** What the mark carries. */
export interface VideoDesk {
  /** The room session (live). */
  readonly session: DeskSession
  readonly role: 'coordinator' | 'member'
  /** The member's display name. */
  readonly member: string
  /** The member's run in progress (room shows the event inside that run's card). */
  readonly runId?: string
}

/** This package's name: the `owner` of the desk events it writes. */
export const VIDEO_DESK_OWNER = '@khorsheed/dsh-video-studio'

/** The project fields a desk-open carries under `data`. */
export interface VideoDeskOpenedData {
  readonly projectId: string
  /** The project's name. */
  readonly title: string
  /** Just made by this call, or an existing one opened. */
  readonly created: boolean
}

/** Room's `room/desk-opened` payload, with this package's fields under `data`. */
export interface VideoDeskOpened {
  readonly version: 1
  readonly owner: typeof VIDEO_DESK_OWNER
  readonly member: string
  readonly role: 'coordinator' | 'member'
  readonly runId?: string
  readonly data: VideoDeskOpenedData
}

/**
 * The calling agent's desk, when it is a room member that has one.
 * @param agent - the tool call's agent.
 * @returns the desk, or undefined (not in a room, or the room is the caller's own session).
 */
export function deskOf(agent: unknown): VideoDesk | undefined {
  if (typeof agent !== 'object' || agent === null) return undefined
  const desk = (agent as { [DESK]?: Partial<VideoDesk> })[DESK]
  if (desk?.session === undefined || desk.session === null || (desk.role !== 'coordinator' && desk.role !== 'member')) return undefined
  const room = String(desk.session.id)
  const own = (agent as { id?: unknown; session?: { id?: unknown } })
  if ((own.id !== undefined && String(own.id) === room) || (own.session?.id !== undefined && String(own.session.id) === room)) return undefined
  return {
    session: desk.session, role: desk.role, member: typeof desk.member === 'string' ? desk.member : '',
    ...typeof desk.runId === 'string' ? { runId: desk.runId } : {},
  }
}

/** The room session's id. */
export function roomIdOf(desk: VideoDesk): string {
  return String(desk.session.id)
}

/**
 * The session whose binding the caller ACTS on: the room for the coordinator,
 * its own otherwise.
 * @param own - the caller's own session id.
 * @param desk - its desk, if any.
 */
export function actingSessionId(own: string | undefined, desk: VideoDesk | undefined): string | undefined {
  return desk?.role === 'coordinator' ? roomIdOf(desk) : own
}

/**
 * Tell the room a project was opened there (best-effort: the binding already
 * happened, and a room that cannot take the row loses only the row). Untyped
 * on purpose: `room/desk-opened` belongs to the room package, which this one
 * does not depend on.
 * @param desk - the caller's desk.
 * @param opened - which project, and whether it was just made.
 */
export function announceDeskOpen(desk: VideoDesk, opened: VideoDeskOpenedData): void {
  const event: VideoDeskOpened = {
    version: 1, owner: VIDEO_DESK_OWNER, member: desk.member, role: desk.role,
    ...desk.runId === undefined ? {} : { runId: desk.runId },
    data: opened,
  }
  try {
    const result = (desk.session.append as (type: string, data: unknown) => unknown).call(desk.session, 'room/desk-opened', event)
    if (typeof (result as { catch?: unknown } | undefined)?.catch === 'function') (result as Promise<unknown>).catch(() => undefined)
  } catch {
    // A closed or read-only room: the member's own tool row still records the open.
  }
}
