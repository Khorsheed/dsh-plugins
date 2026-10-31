/**
 * The room desk, as the library tools see it (the canvas pattern,
 * `packages/canvas/src/desk.ts`, inlined: no package depends on another's
 * desk). An external member of a room runs its mode's library tools as a
 * stand-in over its OWN session, which local-agent marks with the room it
 * works in: `Symbol.for('dsh.agent.desk')` → `{ session, role, member, runId? }`.
 *
 * What is per session in the library, and where each goes in a room:
 *
 * - the binding (which project / book the tools default to) is the desk's:
 *   the coordinator reads and binds the ROOM session's; a member reads its own
 *   first, else the room's, and binds only its own;
 * - a photo the user sent belongs to whichever session it was sent in — a
 *   member looks in its own first, then in the room's;
 * - a card's source session (the jump back to the talk) stays the member's own.
 *
 * Learning progress lives on the project / book, not on a session, so a room
 * changes nothing there. Every bind a room member makes is told to the room as
 * room's `room/desk-opened` (owner: this package), which the library client
 * renders in the room. No mark (outside a room, the room's own agent) =
 * exactly the single-session behavior.
 * @module @khorsheed/dsh-library/desk
 */

/** The desk mark's key on a member's stand-in agent (local-agent's preset tool host). */
const DESK = Symbol.for('dsh.agent.desk')

/** This package's name: the `owner` of the desk events it writes. */
export const LIBRARY_DESK_OWNER = '@khorsheed/dsh-library'

/** The room session, as far as the library reaches it. */
interface RoomSessionLike {
  readonly id: unknown
  readonly append: unknown
}

/** What the mark carries. */
export interface LibraryDesk {
  /** The room session (live). */
  readonly session: RoomSessionLike
  readonly role: 'coordinator' | 'member'
  /** The member's display name. */
  readonly member: string
  /** The member's run in progress (room renders the event inside that run's card). */
  readonly runId?: string
}

/** The library's fields of a desk event (`data` of the room payload). */
export interface LibraryDeskData {
  readonly projectId: string
  readonly projectName: string
  readonly resourceId?: string
  /** The bound book's title. */
  readonly resourceTitle?: string
}

/**
 * A room member bound a project / book: room's `room/desk-opened` payload,
 * the library's fields under `data`.
 */
export interface LibraryDeskOpened {
  readonly version: 1
  readonly owner: typeof LIBRARY_DESK_OWNER
  readonly member: string
  /** The coordinator's bind moves the room's sidebar; a member's only offers it. */
  readonly role: 'coordinator' | 'member'
  readonly runId?: string
  readonly data: LibraryDeskData
}

/**
 * The calling agent's desk, when it is a room member that has one.
 * @param agent - the tool call's agent.
 * @returns the desk, or undefined (not in a room, or the room is the caller's own session).
 */
export function deskOf(agent: unknown): LibraryDesk | undefined {
  if (typeof agent !== 'object' || agent === null) return undefined
  const desk = (agent as { [DESK]?: Partial<LibraryDesk> })[DESK]
  if (desk?.session === undefined || desk.session === null || (desk.role !== 'coordinator' && desk.role !== 'member')) return undefined
  const own = (agent as { session?: { id?: unknown } }).session?.id
  if (own !== undefined && String(desk.session.id) === String(own)) return undefined
  return {
    session: desk.session, role: desk.role, member: typeof desk.member === 'string' ? desk.member : '',
    ...typeof desk.runId === 'string' ? { runId: desk.runId } : {},
  }
}

/**
 * Tell the room a project / book was bound there. Untyped on purpose:
 * `room/desk-opened` is room's vocabulary (the host refuses to read a log
 * holding a type nobody registered — never write a `library/…` type), and
 * this package does not depend on room. Best-effort: the bind already
 * happened; a room that cannot take the row loses only the row.
 * @param desk - the caller's desk.
 * @param data - which project / book.
 */
export function announceDeskOpen(desk: LibraryDesk, data: LibraryDeskData): void {
  const event: LibraryDeskOpened = {
    version: 1, owner: LIBRARY_DESK_OWNER, member: desk.member, role: desk.role,
    ...desk.runId === undefined ? {} : { runId: desk.runId },
    data,
  }
  try {
    ;(desk.session.append as (type: string, data: unknown) => unknown).call(desk.session, 'room/desk-opened', event)
  } catch {
    // A closed or read-only room: the binding itself stands.
  }
}
