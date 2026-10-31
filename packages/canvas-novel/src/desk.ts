/**
 * The room desk for the novel tools (proposal 2026-10-29-room-desk; the canvas
 * package's `desk.ts` owns the rule, this is its read for the novel's own
 * binding). A room member's tools run as a stand-in over its own session,
 * marked with `Symbol.for('dsh.agent.desk')` → `{ session, role, member }`:
 * the coordinator works on the room's bound novel, a member on its own and
 * else the room's. A bind announces itself to the room through room's
 * `room/desk-opened` event owned by the canvas (a novel is a canvas; the
 * canvas client renders the row). No mark = the single-session behavior.
 * @module @khorsheed/dsh-canvas-novel/desk
 */
import type { Session } from '@deepseek-ai/dsh-session'

const DESK = Symbol.for('dsh.agent.desk')

/** What the mark carries. */
export interface NovelDesk {
  readonly session: Session
  readonly role: 'coordinator' | 'member'
  readonly member: string
  readonly runId?: string
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
  return {
    session: desk.session, role: desk.role, member: typeof desk.member === 'string' ? desk.member : '',
    ...typeof desk.runId === 'string' ? { runId: desk.runId } : {},
  }
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
    append('room/desk-opened', {
      version: 1, owner: '@khorsheed/dsh-canvas', member: desk.member, role: desk.role,
      ...desk.runId === undefined ? {} : { runId: desk.runId },
      data: { canvasId: work.id, title: work.title, created: false },
    })
  } catch {
    // A closed room loses only the row.
  }
}

/** One thing a novel tool did, in the canvas's desk-write item shape (the canvas client renders it). */
export interface NovelDeskWriteItem {
  readonly action: 'added' | 'changed' | 'commented' | 'archived' | 'chapter'
  readonly title: string
  readonly cardId?: string
  readonly kind?: string
}

/** The snapshot `NovelService.deskSnapshot` returns, as the diff reads it. */
interface DeskSnapshotLike {
  readonly title: string
  readonly cards: readonly {
    readonly id: string; readonly kind: string; readonly text: string; readonly status: string
    readonly fields?: Readonly<Record<string, unknown>>; readonly comments: readonly unknown[]
  }[]
  readonly chapters: readonly { readonly chapter: { readonly n: number; readonly title: string }; readonly phase: unknown }[]
}

/** The field names a novel card's name is kept under, tried in order. */
const NAME_FIELDS = ['名字', '姓名', '名称', '标题', 'name', 'title']

/** A card's name: its category's title field, a name field, its text's first line, else its first string field. */
export function novelCardName(card: DeskSnapshotLike['cards'][number], titleKey?: string): string {
  for (const key of titleKey === undefined ? NAME_FIELDS : [titleKey, ...NAME_FIELDS]) {
    const value = card.fields?.[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  const line = card.text.split('\n').map(row => row.replace(/^#+\s*/, '').trim()).find(row => row !== '')
  if (line !== undefined) return line.slice(0, 40)
  const first = Object.values(card.fields ?? {}).find(value => typeof value === 'string' && value.trim() !== '')
  return typeof first === 'string' ? first.trim().slice(0, 40) : ''
}

/**
 * What one novel tool call did to the work: cards added, archived,
 * commented or otherwise changed, and chapters created or rewritten.
 * @param before - the snapshot before the call.
 * @param after - the snapshot after it.
 * @param kindOf - a category id's display name and the field its cards are named by.
 */
export function novelWriteItems(before: DeskSnapshotLike, after: DeskSnapshotLike, kindOf: (kind: string) => { readonly label: string; readonly titleKey?: string } | undefined): NovelDeskWriteItem[] {
  const items: NovelDeskWriteItem[] = []
  const was = new Map(before.cards.map(card => [card.id, card]))
  for (const card of after.cards) {
    const prior = was.get(card.id)
    const action = prior === undefined ? 'added'
      : prior.status !== 'archived' && card.status === 'archived' ? 'archived'
        : card.comments.length > prior.comments.length ? 'commented'
          : prior.text !== card.text || JSON.stringify(prior.fields ?? {}) !== JSON.stringify(card.fields ?? {}) || prior.status !== card.status ? 'changed'
            : undefined
    if (action === undefined) continue
    const category = kindOf(card.kind)
    const kind = category?.label ?? ''
    items.push({ action, title: novelCardName(card, category?.titleKey), cardId: card.id, ...kind === '' ? {} : { kind } })
  }
  const chapters = new Map(before.chapters.map(row => [row.chapter.n, JSON.stringify(row)]))
  for (const row of after.chapters) {
    if (chapters.get(row.chapter.n) === JSON.stringify(row)) continue
    items.push({ action: 'chapter', title: `第 ${row.chapter.n} 章《${row.chapter.title}》` })
  }
  return items
}

/**
 * Tell the room what a novel tool did (best-effort): room's `room/desk-wrote`
 * owned by the canvas, whose client renders the line.
 * @param desk - the caller's desk.
 * @param work - the work (its canvas) and title.
 * @param items - what changed; nothing is written when empty.
 */
export function announceDeskWrite(desk: NovelDesk, work: { readonly id: string; readonly title: string }, items: readonly NovelDeskWriteItem[]): void {
  if (items.length === 0) return
  try {
    const append = desk.session.append.bind(desk.session) as unknown as (type: string, data: unknown) => unknown
    append('room/desk-wrote', {
      version: 1, owner: '@khorsheed/dsh-canvas', member: desk.member, role: desk.role,
      ...desk.runId === undefined ? {} : { runId: desk.runId },
      data: { canvasId: work.id, title: work.title, items },
    })
  } catch {
    // A closed room loses only the line.
  }
}
