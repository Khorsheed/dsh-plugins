/**
 * The room's record of a game project a member opened there: the
 * conversation Definition claiming room's `room/desk-opened` with this
 * package as owner (written into the ROOM session by `game_open` when a room
 * member switches, adopts or creates — `../desk.ts`) into one chat node, and
 * the follow rule its row applies.
 *
 * Who it follows (proposal 2026-10-29-room-desk): the coordinator's open
 * shows the game tab on that project in the room's sidebar; a member's never
 * takes the foreground (the game tab shows one project, there is no strip to
 * put it on), so its row only offers the door. Either only when the row
 * arrived while the page was there to see it — a reload or a scroll back is
 * history.
 *
 * Types are structural: ui-conversation and ui-chat are composed by the host,
 * never imported here at runtime; the room package is not a dependency.
 * @module @khorsheed/dsh-game/client
 */

/** The desk events' owner: this package's name. */
export const DESK_OWNER = '@khorsheed/dsh-game'

/** The chat node kind (and the `conversation.chat.node` key) of the row. */
export const DESK_ROW_KIND = 'game-desk-open'

/** The row's data: the event's fields, where it sits, and when it was written. */
export interface DeskRowData {
  readonly seq: number
  readonly time: number
  readonly projectId: string
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
 * The event's data as the row reads it, or null when it is not this
 * package's `room/desk-opened` or its shape cannot be vouched for.
 */
export function deskRowOf(event: EventLike): DeskRowData | null {
  if (event.type !== 'room/desk-opened') return null
  const outer = event.data as { owner?: unknown; data?: unknown; member?: unknown; role?: unknown; runId?: unknown } | undefined
  if (outer?.owner !== DESK_OWNER) return null
  const fields = outer.data as Partial<{ projectId: unknown; title: unknown; created: unknown }> | undefined
  if (typeof fields?.projectId !== 'string' || typeof fields.title !== 'string') return null
  return {
    seq: event.seq,
    time: event.time,
    projectId: fields.projectId,
    title: fields.title,
    created: fields.created === true,
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

/** One chat node per game `room/desk-opened` event. */
export const deskRowDefinition = {
  kind: DESK_ROW_KIND,
  target: 'chat',
  match: (event: EventLike) => deskRowOf(event) !== null
    ? { id: `game-desk-${event.seq}`, role: 'start' as const }
    : null,
  start: (_context: unknown, match: { readonly event: EventLike }): DeskRowData => {
    const row = deskRowOf(match.event)
    if (row === null) throw new Error('game-desk-open start requires a game desk event')
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
 * marks. A live `room/desk-wrote` (a version published, variants offered on
 * the room's project) only refreshes: it is read as a member's act whoever
 * wrote it, so it never moves the sidebar, and the follower's write signal
 * re-reads the room's game tab. The rows themselves only offer the door.
 * @param kind - the tab kind the place belongs to.
 * @param event - one appended session event.
 */
export function deskDestinationsOf(kind: string, event: { readonly type: string; readonly seq?: number; readonly time?: number; readonly data?: unknown }): Array<{
  destination: { id: string; kind: string; params: Record<string, unknown>; label: string }
  role: 'coordinator' | 'member'
}> {
  const row = deskRowOf({ ...event, seq: event.seq ?? 0, time: event.time ?? 0 } as Parameters<typeof deskRowOf>[0])
  if (row !== null) {
    return [{ destination: { id: `desk:${DESK_OWNER}:${row.seq}`, kind, params: { projectId: row.projectId, view: 'play' }, label: row.title }, role: row.role }]
  }
  if (event.type !== 'room/desk-wrote') return []
  const outer = event.data as { owner?: unknown; data?: { projectId?: unknown; place?: unknown; label?: unknown } } | undefined
  const data = outer?.data
  if (outer?.owner !== DESK_OWNER || typeof data?.projectId !== 'string') return []
  const place = typeof data.place === 'object' && data.place !== null ? data.place as Record<string, unknown> : { view: 'play' }
  return [{
    destination: { id: `desk:${DESK_OWNER}:${event.seq ?? 0}`, kind, params: { ...place, projectId: data.projectId }, label: typeof data.label === 'string' ? data.label : '' },
    role: 'member',
  }]
}
