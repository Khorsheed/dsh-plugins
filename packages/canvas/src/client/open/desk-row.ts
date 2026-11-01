/**
 * The room's record of a canvas a member opened there: the conversation
 * Definition claiming room's `room/desk-opened` with this owner (written into the ROOM session by
 * the canvas tools when a room member switches or creates — `../../desk.ts`)
 * into one chat node, and the follow rule its row applies.
 *
 * Who it follows (proposal 2026-10-29-room-desk, choice A): the coordinator's
 * open shows in the room's sidebar; a member's goes on the canvas strip beside
 * the one the human reads, marked fresh. Either only when the row arrived
 * while the page was there to see it — a reload or a scroll back is history
 * and only offers the door, the `OpenCanvasRow` rule.
 *
 * Types are structural: `@deepseek-ai/dsh-client-ui-conversation` and
 * `-ui-chat` are composed by the host, never imported here at runtime (the
 * canvas-novel precedent).
 * @module @khorsheed/dsh-canvas/client
 */

import { DESK_OWNER, deskWriteOf, deskWritePlace, type DeskWrite } from './desk-write.ts'

export { DESK_OWNER }

/** The chat node kind (and the `conversation.chat.node` key) of the row. */
export const DESK_ROW_KIND = 'canvas-desk-open'

/** The row's data: the event's fields, where it sits, and when it was written. */
export interface DeskRowData {
  readonly seq: number
  readonly time: number
  readonly canvasId: string
  readonly title: string
  readonly created: boolean
  readonly member: string
  readonly role: 'coordinator' | 'member'
  /** The member run it happened in: a room that seats it shows the row at the end of that run's card. */
  readonly runId?: string
}

interface EventLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data?: unknown
}

interface ContextLike {
  readonly key: string
  readonly id: string
  readonly state?: DeskRowData
  readonly start?: { readonly location?: unknown }
}


/**
 * The event's data as the row reads it, or null when the shape cannot be
 * vouched for. Two spellings: room's `room/desk-opened` with this owner (the
 * canvas fields under `data`), and the first one, `canvas/desk-opened` with
 * the fields flat (written for a few hours on 2026-10-29).
 */
export function deskRowOf(event: EventLike): DeskRowData | null {
  const outer = event.data as { owner?: unknown; data?: unknown; member?: unknown; role?: unknown; runId?: unknown } | undefined
  let fields: Partial<{ canvasId: unknown; title: unknown; created: unknown }> | undefined
  if (event.type === 'room/desk-opened') {
    if (outer?.owner !== DESK_OWNER) return null
    fields = outer.data as typeof fields
  } else if (event.type === 'canvas/desk-opened') {
    fields = outer as typeof fields
  } else return null
  if (typeof fields?.canvasId !== 'string' || typeof fields.title !== 'string') return null
  return {
    seq: event.seq,
    time: event.time,
    canvasId: fields.canvasId,
    title: fields.title,
    created: fields.created === true,
    member: typeof outer?.member === 'string' ? outer.member : '',
    role: outer?.role === 'coordinator' ? 'coordinator' : 'member',
    ...typeof outer?.runId === 'string' ? { runId: outer.runId } : {},
  }
}

/**
 * Whether the room seats desk rows in its members' cards (`room.member.attachment`
 * is declared and this plugin's row is registered there). Then a row naming a
 * run renders in that run's card, and its own conversation node hides; a row
 * naming no run (or a room without the seat) keeps its own node.
 */
let seated = false

/** Note that the room's card seat holds this plugin's row (or no longer does). */
export function setDeskRowSeated(value: boolean): void {
  seated = value
}

/** One chat node per `canvas/desk-opened` event. */
export const deskRowDefinition = {
  kind: DESK_ROW_KIND,
  target: 'chat',
  match: (event: EventLike) => deskRowOf(event) !== null
    ? { id: `desk-${event.seq}`, role: 'start' as const }
    : null,
  start: (_context: unknown, match: { readonly event: EventLike }): DeskRowData => {
    const row = deskRowOf(match.event)
    if (row === null) throw new Error('canvas-desk-open start requires a canvas desk event')
    return row
  },
  update: (context: { readonly state: DeskRowData }) => context.state,
  buildViewNode: (context: ContextLike) => context.state === undefined ? null : {
    key: context.key,
    kind: DESK_ROW_KIND,
    id: context.id,
    target: 'chat',
    anchorSeq: context.state.seq,
    location: context.start?.location ?? { kind: 'unresolved' },
    visibility: seated && context.state.runId !== undefined ? 'hidden' : 'visible',
    data: context.state,
  },
}

/** The node kind of a lone write line (a write naming no run, or a room without the card seat). */
export const DESK_WROTE_KIND = 'canvas-desk-wrote'

/** One chat node per `room/desk-wrote` event of this owner — hidden, like the open row, when a run's card holds it. */
export const deskWroteDefinition = {
  kind: DESK_WROTE_KIND,
  target: 'chat',
  match: (event: EventLike) => deskWriteOf(event) !== null ? { id: `desk-wrote-${event.seq}`, role: 'start' as const } : null,
  start: (_context: unknown, match: { readonly event: EventLike }): DeskWrite => {
    const write = deskWriteOf(match.event)
    if (write === null) throw new Error('canvas-desk-wrote start requires a canvas desk write')
    return write
  },
  update: (context: { readonly state: DeskWrite }) => context.state,
  buildViewNode: (context: { readonly key: string; readonly id: string; readonly state?: DeskWrite; readonly start?: { readonly location?: unknown } }) => context.state === undefined ? null : {
    key: context.key,
    kind: DESK_WROTE_KIND,
    id: context.id,
    target: 'chat',
    anchorSeq: context.state.seq,
    location: context.start?.location ?? { kind: 'unresolved' },
    visibility: seated && context.state.runId !== undefined ? 'hidden' : 'visible',
    data: context.state,
  },
}

/**
 * The follower's reading of this owner's desk events (proposal
 * 2026-10-30-agent-sidebar-navigation). A live `room/desk-opened` names the
 * canvas, and whose act it was: the coordinator's follows, a member's goes on
 * the strip (the badge). A live `room/desk-wrote` from a member marks the
 * canvas the same way; a coordinator's needs nothing — it writes on the canvas
 * the room already shows. The rows themselves only offer the door.
 * @param kind - the canvas tab kind.
 * @param event - one appended session event.
 */
export function deskDestinationsOf(kind: string, event: { readonly type: string; readonly seq?: number; readonly time?: number; readonly data?: unknown }): Array<{
  destination: { id: string; kind: string; params: Record<string, unknown>; label: string }
  role: 'coordinator' | 'member'
}> {
  const full = { ...event, seq: event.seq ?? 0, time: event.time ?? 0 }
  const opened = deskRowOf(full as Parameters<typeof deskRowOf>[0])
  if (opened !== null) {
    return [{ destination: { id: `desk:${DESK_OWNER}:${opened.seq}`, kind, params: { canvasId: opened.canvasId }, label: opened.title }, role: opened.role }]
  }
  const wrote = deskWriteOf(full)
  if (wrote === null || wrote.role !== 'member') return []
  return [{ destination: { id: `desk:${DESK_OWNER}:${wrote.seq}`, kind, params: deskWritePlace(wrote.canvasId, wrote.items), label: wrote.title }, role: 'member' }]
}
