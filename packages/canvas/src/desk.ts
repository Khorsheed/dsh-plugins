/**
 * The room desk, as the canvas tools see it. An external member of a room
 * runs its mode's canvas tools as a stand-in over its OWN session, which
 * local-agent marks with the room it works in: `Symbol.for('dsh.agent.desk')`
 * → `{ session, role, member }` (proposal 2026-10-29-room-desk). The canvas
 * the room's sidebar shows is that session's focus, so:
 *
 * - the coordinator acts ON the desk: its target is the room's canvas, and a
 *   switch moves the room's sidebar;
 * - a member reads its own choice first and falls back to the room's, and a
 *   switch stays its own — the room gets a tab beside the front one;
 * - either way the room hears of it through a `room/desk-opened` event
 *   (owner `@khorsheed/dsh-canvas`) the canvas client renders — at the end of
 *   the member's card when the room seats it there, else as a row of its own.
 *   The event is room's vocabulary: only room makes the host accept it in a
 *   log, and a desk exists only in a room.
 *
 * Execution stays the member's: the fence of every write is its own session.
 * No mark (any session outside a room, the room's own agent) = exactly the
 * single-session behavior.
 * @module @khorsheed/dsh-canvas/desk
 */
import type { Session } from '@deepseek-ai/dsh-session'

/** The desk mark's key on a member's stand-in agent (local-agent's preset tool host). */
const DESK = Symbol.for('dsh.agent.desk')

/** What the mark carries. */
export interface CanvasDesk {
  /** The room session (live). */
  readonly session: Session
  readonly role: 'coordinator' | 'member'
  /** The member's display name. */
  readonly member: string
  /** The member's run in progress (room renders the event inside that run's card and reply). */
  readonly runId?: string
}

/** This package's name: the `owner` of the desk events it writes. */
export const CANVAS_DESK_OWNER = '@khorsheed/dsh-canvas'

/**
 * A room member switched to or created a canvas: room's `room/desk-opened`
 * payload, with the canvas's own fields under `data`.
 */
export interface CanvasDeskOpened {
  readonly version: 1
  readonly owner: typeof CANVAS_DESK_OWNER
  readonly member: string
  /** The coordinator's open moves the room's sidebar; a member's adds a tab beside it. */
  readonly role: 'coordinator' | 'member'
  /** The run it happened in: the room shows it at the end of that run's card. */
  readonly runId?: string
  readonly data: { readonly canvasId: string; readonly title: string; readonly created: boolean }
}

/**
 * Write one desk event into the room. Untyped on purpose: `room/desk-opened`
 * belongs to the room package, which this one does not depend on.
 * @param room - the room session.
 * @param event - the payload.
 */
export function appendDeskOpened(room: { append: unknown }, event: CanvasDeskOpened): void {
  ;(room.append as (type: string, data: unknown) => unknown).call(room, 'room/desk-opened', event)
}

/**
 * The calling agent's desk, when it is a room member that has one.
 * @param agent - the tool call's agent.
 * @returns the desk, or undefined (not in a room, or the room is the caller's own session).
 */
export function deskOf(agent: unknown): CanvasDesk | undefined {
  if (typeof agent !== 'object' || agent === null) return undefined
  const desk = (agent as { [DESK]?: Partial<CanvasDesk> })[DESK]
  if (desk?.session === undefined || (desk.role !== 'coordinator' && desk.role !== 'member')) return undefined
  const own = (agent as { session?: { id?: unknown } }).session?.id
  if (own !== undefined && String(desk.session.id) === String(own)) return undefined
  return {
    session: desk.session, role: desk.role, member: typeof desk.member === 'string' ? desk.member : '',
    ...typeof desk.runId === 'string' ? { runId: desk.runId } : {},
  }
}

/**
 * The session whose canvas the caller ACTS on: the room for the coordinator,
 * its own otherwise.
 * @param session - the caller's own session.
 * @param desk - its desk, if any.
 * @returns the session to focus and bind.
 */
export function actingSession(session: Session, desk: CanvasDesk | undefined): Session {
  return desk?.role === 'coordinator' ? desk.session : session
}

/**
 * Tell the room a canvas was opened there (best-effort: the switch itself
 * already happened, and a room that cannot take the row loses only the row).
 * @param desk - the caller's desk.
 * @param opened - which canvas, and whether it was just made.
 */
export function announceDeskOpen(desk: CanvasDesk, opened: { canvasId: string; title: string; created: boolean }): void {
  try {
    appendDeskOpened(desk.session, {
      version: 1, owner: CANVAS_DESK_OWNER, member: desk.member, role: desk.role,
      ...desk.runId === undefined ? {} : { runId: desk.runId },
      data: opened,
    })
  } catch {
    // A closed or read-only room: the member's own row still records the switch.
  }
}
