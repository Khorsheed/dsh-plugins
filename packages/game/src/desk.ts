/**
 * The room desk, as the game tools see it. An external member of a room runs
 * its mode's game tools as a stand-in over its OWN session, which local-agent
 * marks with the room it works in: `Symbol.for('dsh.agent.desk')` →
 * `{ session, role, member, runId? }` (the canvas precedent, proposal
 * 2026-10-29-room-desk). The project the room's sidebar shows is the room
 * session's binding, so:
 *
 * - the coordinator acts ON the desk: it reads the room's project, and a
 *   `game_open` binds the room session (the room's sidebar follows);
 * - a member reads its own binding first and falls back to the room's, and
 *   its `game_open` binds only its own session;
 * - either way the room hears of it through a `room/desk-opened` event
 *   (owner `@khorsheed/dsh-game`) the game client renders. The event type is
 *   room's vocabulary — only room makes the host accept it in a log — so it is
 *   written untyped, and never under a type of this package's own.
 *
 * Execution stays the member's: every write's fence and workspace is its own
 * session. No mark (any session outside a room, the room's own agent) =
 * exactly the single-session behavior.
 * @module @khorsheed/dsh-game/desk
 */
import type { Session } from '@deepseek-ai/dsh-session'

/** The desk mark's key on a member's stand-in agent (local-agent's preset tool host). */
const DESK = Symbol.for('dsh.agent.desk')

/** What the mark carries. */
export interface GameDesk {
  /** The room session (live). */
  readonly session: Session
  readonly role: 'coordinator' | 'member'
  /** The member's display name. */
  readonly member: string
  /** The member's run in progress (room renders the event inside that run's card and reply). */
  readonly runId?: string
}

/** This package's name: the `owner` of the desk events it writes. */
export const GAME_DESK_OWNER = '@khorsheed/dsh-game'

/** What the game puts under the event's `data`. */
export interface GameDeskOpenedData {
  readonly projectId: string
  readonly title: string
  /** True when this call made the project (create), false for a switch or an adoption. */
  readonly created: boolean
}

/** A room member switched to, adopted or created a project: room's `room/desk-opened` payload. */
export interface GameDeskOpened {
  readonly version: 1
  readonly owner: typeof GAME_DESK_OWNER
  readonly member: string
  /** The coordinator's open moves the room's sidebar; a member's only offers the door. */
  readonly role: 'coordinator' | 'member'
  /** The run it happened in: the room shows it at the end of that run's card. */
  readonly runId?: string
  readonly data: GameDeskOpenedData
}

/**
 * The calling agent's desk, when it is a room member that has one.
 * @param agent - the tool call's agent.
 * @returns the desk, or undefined (not in a room, or the room is the caller's own session).
 */
export function deskOf(agent: unknown): GameDesk | undefined {
  if (typeof agent !== 'object' || agent === null) return undefined
  const desk = (agent as { [DESK]?: Partial<GameDesk> })[DESK]
  if (desk?.session === undefined || (desk.role !== 'coordinator' && desk.role !== 'member')) return undefined
  const own = (agent as { session?: { id?: unknown } }).session?.id
  if (own !== undefined && String(desk.session.id) === String(own)) return undefined
  return {
    session: desk.session, role: desk.role, member: typeof desk.member === 'string' ? desk.member : '',
    ...typeof desk.runId === 'string' ? { runId: desk.runId } : {},
  }
}

/**
 * The session whose binding the caller ACTS on: the room for the coordinator,
 * its own otherwise.
 */
export function actingSession(session: Session, desk: GameDesk | undefined): Session {
  return desk?.role === 'coordinator' ? desk.session : session
}

/**
 * Tell the room a project was opened there. Best-effort: the binding already
 * moved, and a room that cannot take the event loses only the row.
 * @param desk - the caller's desk.
 * @param opened - which project, and whether it was just made.
 */
export function announceDeskOpen(desk: GameDesk, opened: GameDeskOpenedData): void {
  const event: GameDeskOpened = {
    version: 1, owner: GAME_DESK_OWNER, member: desk.member, role: desk.role,
    ...desk.runId === undefined ? {} : { runId: desk.runId },
    data: opened,
  }
  try {
    // Untyped on purpose: `room/desk-opened` belongs to the room package, which this one does not depend on.
    const written = (desk.session.append as unknown as (type: string, data: unknown) => unknown).call(desk.session, 'room/desk-opened', event)
    if (written instanceof Promise) written.catch(() => {})
  } catch {
    // A closed or read-only room: the binding itself already moved.
  }
}
