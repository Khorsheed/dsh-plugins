/**
 * The room desk for the novel tools (proposal 2026-10-29-room-desk; the canvas
 * package's `desk.ts` owns the rule, this is its read for the novel's own
 * binding). A room member's tools run as a stand-in over its own session,
 * marked with `Symbol.for('dsh.agent.desk')` → `{ session, role, member }`:
 * the coordinator works on the room's bound novel, a member on its own and
 * else the room's. A bind announces itself to the room through the canvas's
 * `canvas/desk-opened` event (a novel is a canvas; the canvas client renders
 * the row). No mark = the single-session behavior.
 * @module @khorsheed/dsh-canvas-novel/desk
 */
import type { Session } from '@deepseek-ai/dsh-session'

const DESK = Symbol.for('dsh.agent.desk')

/** What the mark carries. */
export interface NovelDesk {
  readonly session: Session
  readonly role: 'coordinator' | 'member'
  readonly member: string
}

/**
 * The calling agent's desk, when it is a room member that has one.
 * @param agent - the tool call's agent.
 * @returns the desk, or undefined.
 */
export function deskOf(agent: unknown): NovelDesk | undefined {
  if (typeof agent !== 'object' || agent === null) return undefined
  const desk = (agent as { [DESK]?: Partial<NovelDesk> })[DESK]
  if (desk?.session === undefined || (desk.role !== 'coordinator' && desk.role !== 'member')) return undefined
  const own = (agent as { session?: { id?: unknown } }).session?.id
  if (own !== undefined && String(desk.session.id) === String(own)) return undefined
  return { session: desk.session, role: desk.role, member: typeof desk.member === 'string' ? desk.member : '' }
}

/**
 * The session whose binding the caller acts on: the room for the coordinator.
 * @param session - the caller's own session.
 * @param desk - its desk, if any.
 */
export function actingSession(session: Session, desk: NovelDesk | undefined): Session {
  return desk?.role === 'coordinator' ? desk.session : session
}

/**
 * Tell the room a novel was bound there (best-effort).
 * @param desk - the caller's desk.
 * @param work - the novel canvas.
 */
export function announceDeskBind(desk: NovelDesk, work: { readonly id: string; readonly title: string }): void {
  try {
    const append = desk.session.append.bind(desk.session) as unknown as (type: string, data: unknown) => unknown
    append('canvas/desk-opened', { version: 1, canvasId: work.id, title: work.title, created: false, member: desk.member, role: desk.role })
  } catch {
    // A closed room loses only the row.
  }
}
