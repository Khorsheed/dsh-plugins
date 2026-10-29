/**
 * The room's record of a project a member opened there: the conversation
 * Definition claiming room's `room/desk-opened` with this package as owner
 * (written into the ROOM session by video_project's create/open when a room
 * member calls it — `../desk.ts`) into one chat node, the follow rule its row
 * applies, and the hand-off that brings the room's 剪辑 panel to a project.
 *
 * Who it follows (proposal 2026-10-29-room-desk): the coordinator's open shows
 * in the room's 剪辑 panel; a member's never takes the front — the panel has
 * no strip to park it on, so the row keeps only its door. Either only when the
 * row arrived while the page was there to see it — a reload or a scroll back
 * is history and only offers the door.
 *
 * Types are structural: ui-conversation and ui-chat are composed by the host,
 * never imported here (the canvas precedent).
 * Inline copy of packages/canvas/src/client/open/desk-row.ts.
 * @module @khorsheed/dsh-video-studio/client/desk-row
 */

/** This package's name: the desk events' `owner` (the host half writes it). */
export const DESK_OWNER = '@khorsheed/dsh-video-studio'

/** The chat node kind (and the `conversation.chat.node` key) of the row. */
export const DESK_ROW_KIND = 'video-studio-desk-open'

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
 * package's well-formed `room/desk-opened`.
 */
export function deskRowOf(event: EventLike): DeskRowData | null {
  if (event.type !== 'room/desk-opened') return null
  const outer = event.data as { owner?: unknown; data?: unknown; member?: unknown; role?: unknown; runId?: unknown } | undefined
  if (outer?.owner !== DESK_OWNER) return null
  const fields = outer.data as Partial<{ projectId: unknown; title: unknown; created: unknown }> | undefined
  if (typeof fields?.projectId !== 'string' || fields.projectId === '') return null
  return {
    seq: event.seq,
    time: event.time,
    projectId: fields.projectId,
    title: typeof fields.title === 'string' ? fields.title : fields.projectId,
    created: fields.created === true,
    member: typeof outer.member === 'string' ? outer.member : '',
    role: outer.role === 'coordinator' ? 'coordinator' : 'member',
    ...typeof outer.runId === 'string' ? { runId: outer.runId } : {},
  }
}

/**
 * Whether the room seats desk rows in its members' cards (this package's row
 * is registered at `room.member.attachment`). Then a row naming a run renders
 * in that run's card and its own conversation node hides; a row naming no run
 * (or a room without the seat) keeps its own node.
 */
let seated = false

/** Note that the room's card seat holds this package's row (or no longer does). */
export function setDeskRowSeated(value: boolean): void {
  seated = value
}

/** One chat node per this package's `room/desk-opened` event. */
export const deskRowDefinition = {
  kind: DESK_ROW_KIND,
  target: 'chat',
  match: (event: EventLike) => deskRowOf(event) !== null
    ? { id: `video-desk-${event.seq}`, role: 'start' as const }
    : null,
  start: (_context: unknown, match: { readonly event: EventLike }): DeskRowData => {
    const row = deskRowOf(match.event)
    if (row === null) throw new Error('video-studio desk row start requires a video-studio desk event')
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
export function shouldFollow(scope: string, row: { readonly seq: number; readonly time: number }, now: number = Date.now()): boolean {
  const key = `${scope}:${row.seq}`
  if (followed.has(key) || now - row.time > LIVE_WINDOW_MS || row.time - now > LIVE_WINDOW_MS) return false
  followed.add(key)
  return true
}

// ───────────── the hand-off to the 剪辑 panel ─────────────

/** Panels listening per session: a mounted pane switches at once. */
const listeners = new Map<string, Set<(projectId: string) => void>>()
/** A request made before the session's pane mounted (the tab is opening). */
const pending = new Map<string, { projectId: string; at: number }>()

/**
 * Ask the session's 剪辑 panel to show a project. A mounted pane switches now;
 * otherwise the pane that mounts next for that session takes it (once, while
 * fresh). Showing is not binding: the session's binding is the tools' business.
 */
export function requestPanelProject(sessionId: string, projectId: string, now: number = Date.now()): void {
  const live = listeners.get(sessionId)
  if (live !== undefined && live.size > 0) {
    pending.delete(sessionId)
    for (const listener of live) listener(projectId)
    return
  }
  pending.set(sessionId, { projectId, at: now })
}

/** The request waiting for a pane that is mounting now, consumed. */
export function takePanelProject(sessionId: string, now: number = Date.now()): string | undefined {
  const request = pending.get(sessionId)
  pending.delete(sessionId)
  return request === undefined || now - request.at > LIVE_WINDOW_MS ? undefined : request.projectId
}

/** A mounted pane's subscription to requests for its session. */
export function onPanelProject(sessionId: string, listener: (projectId: string) => void): () => void {
  let set = listeners.get(sessionId)
  if (set === undefined) listeners.set(sessionId, set = new Set())
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(sessionId)
  }
}
