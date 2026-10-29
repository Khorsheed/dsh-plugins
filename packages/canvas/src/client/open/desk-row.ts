/**
 * The room's record of a canvas a member opened there: the conversation
 * Definition claiming `canvas/desk-opened` (written into the ROOM session by
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

/** The event's data as the row reads it, or null when the shape cannot be vouched for. */
export function deskRowOf(event: EventLike): DeskRowData | null {
  const data = event.data as Partial<DeskRowData> | undefined
  if (typeof data?.canvasId !== 'string' || typeof data.title !== 'string') return null
  return {
    seq: event.seq,
    time: event.time,
    canvasId: data.canvasId,
    title: data.title,
    created: data.created === true,
    member: typeof data.member === 'string' ? data.member : '',
    role: data.role === 'coordinator' ? 'coordinator' : 'member',
  }
}

/** One chat node per `canvas/desk-opened` event. */
export const deskRowDefinition = {
  kind: DESK_ROW_KIND,
  target: 'chat',
  match: (event: EventLike) => event.type === 'canvas/desk-opened' && deskRowOf(event) !== null
    ? { id: `desk-${event.seq}`, role: 'start' as const }
    : null,
  start: (_context: unknown, match: { readonly event: EventLike }): DeskRowData => {
    const row = deskRowOf(match.event)
    if (row === null) throw new Error('canvas-desk-open start requires a canvas/desk-opened event')
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
    visibility: 'visible',
    data: context.state,
  },
}

/** How old a row may be when it mounts and still count as seen arriving. */
export const LIVE_WINDOW_MS = 20_000

/** Rows this page already followed: a remount (a scroll, a view switch) never follows twice. */
const followed = new Set<string>()

/**
 * Whether a row mounting now should follow, recording that it did.
 * @param scope - the room session (or any key that tells rooms apart).
 * @param row - the row.
 * @param now - the clock.
 * @returns true exactly once per row, and only while it is fresh.
 */
export function shouldFollow(scope: string, row: DeskRowData, now: number = Date.now()): boolean {
  const key = `${scope}:${row.seq}`
  if (followed.has(key) || now - row.time > LIVE_WINDOW_MS || row.time - now > LIVE_WINDOW_MS) return false
  followed.add(key)
  return true
}
