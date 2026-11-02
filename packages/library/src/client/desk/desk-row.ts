/**
 * The room's record of a project / book a member bound there: the
 * conversation Definition claiming room's `room/desk-opened` with this
 * package as `owner` (written into the ROOM session by the library tools —
 * `../../desk.ts`), and the follow rule its row applies (the canvas pattern,
 * `packages/canvas/src/client/open/desk-row.ts`, inlined).
 *
 * Who it follows: the coordinator's bind opens the library in the room's
 * sidebar on that book (or project); a member's bound only its own session and
 * never takes the front — the row offers the door. Either only when the row
 * arrived while the page was there to see it: a reload or a scroll back is
 * history and only offers the door.
 *
 * Types are structural: ui-conversation and ui-chat are composed by the host,
 * never imported here.
 * @module @khorsheed/dsh-library/client/desk
 */

/** The desk events' owner: this package. */
export const DESK_OWNER = '@khorsheed/dsh-library'

/** The chat node kind (and the `conversation.chat.node` key) of the row. */
export const DESK_ROW_KIND = 'library-desk-open'

/** The row's data: the event's fields, where it sits, and when it was written. */
export interface DeskRowData {
  readonly seq: number
  readonly time: number
  readonly projectId: string
  readonly projectName: string
  readonly resourceId?: string
  readonly resourceTitle?: string
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
 * The event's data as the row reads it, or null when it is not this
 * package's well-formed `room/desk-opened` (another plugin's desk event is its
 * own to render).
 */
export function deskRowOf(event: EventLike): DeskRowData | null {
  if (event.type !== 'room/desk-opened') return null
  const outer = event.data as { owner?: unknown; data?: unknown; member?: unknown; role?: unknown; runId?: unknown } | undefined
  if (outer?.owner !== DESK_OWNER) return null
  const fields = outer.data as Partial<Record<'projectId' | 'projectName' | 'resourceId' | 'resourceTitle', unknown>> | undefined
  if (typeof fields?.projectId !== 'string' || typeof fields.projectName !== 'string') return null
  return {
    seq: event.seq,
    time: event.time,
    projectId: fields.projectId,
    projectName: fields.projectName,
    ...typeof fields.resourceId === 'string' ? { resourceId: fields.resourceId } : {},
    ...typeof fields.resourceTitle === 'string' ? { resourceTitle: fields.resourceTitle } : {},
    member: typeof outer.member === 'string' ? outer.member : '',
    role: outer.role === 'coordinator' ? 'coordinator' : 'member',
    ...typeof outer.runId === 'string' ? { runId: outer.runId } : {},
  }
}

/**
 * Whether the room seats desk rows in its members' cards (`room.member.attachment`
 * is declared and this plugin's row is registered there). Then a row naming a
 * run renders in that run's card and its own conversation node hides; a row
 * naming no run (or a room without the seat) keeps its own node.
 */
let seated = false

/** Note that the room's card seat holds this plugin's row (or no longer does). */
export function setDeskRowSeated(value: boolean): void {
  seated = value
}

/** One chat node per library `room/desk-opened` event. */
export const deskRowDefinition = {
  kind: DESK_ROW_KIND,
  target: 'chat',
  match: (event: EventLike) => deskRowOf(event) !== null
    ? { id: `library-desk-${event.seq}`, role: 'start' as const }
    : null,
  start: (_context: unknown, match: { readonly event: EventLike }): DeskRowData => {
    const row = deskRowOf(match.event)
    if (row === null) throw new Error('library-desk-open start requires a library desk event')
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

/**
 * The follower's reading of this owner's desk events (proposal
 * 2026-10-30-agent-sidebar-navigation): a live `room/desk-opened` names its
 * place and whose act it was — the coordinator's follows, a member's only
 * marks. The rows themselves only offer the door.
 * @param kind - the tab kind the place belongs to.
 * @param event - one appended session event.
 */
export function deskDestinationsOf(kind: string, event: { readonly type: string; readonly seq?: number; readonly time?: number; readonly data?: unknown }): Array<{
  destination: { id: string; kind: string; params: Record<string, unknown>; label: string }
  role: 'coordinator' | 'member'
}> {
  const row = deskRowOf({ ...event, seq: event.seq ?? 0, time: event.time ?? 0 } as Parameters<typeof deskRowOf>[0])
  if (row === null) return []
  return [{ destination: { id: `desk:${DESK_OWNER}:${row.seq}`, kind, params: row.resourceId === undefined ? { view: 'project', projectId: row.projectId } : { view: 'book', projectId: row.projectId, resourceId: row.resourceId }, label: row.resourceTitle ?? row.projectName }, role: row.role }]
}
