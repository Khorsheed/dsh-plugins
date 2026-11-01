/**
 * What a room member's writes did on a canvas, as one line (proposal
 * 2026-10-29-room-desk): the `room/desk-wrote` events of one run (or a lone
 * one) folded per canvas — a card added then edited in the same turn counts
 * once, as added — and spelled 「新增人物卡「数据标注员」 · 新增 2 张世界卡 ·
 * 批注 1 张卡」. Its door lands where the writes are (`deskWritePlace`).
 *
 * @module @khorsheed/dsh-canvas/client
 */

/** The desk events' owner this plugin renders (its own package, `../../desk.ts`). */
export const DESK_OWNER = '@khorsheed/dsh-canvas'

/** One thing a write did (the host's `CanvasDeskWriteItem`). */
export interface DeskWriteItem {
  /** `chapter`: a 长篇小说 chapter written or re-planned (its title reads 「第 1 章《…》」). */
  readonly action: 'added' | 'changed' | 'commented' | 'archived' | 'manuscript' | 'chapter'
  readonly title: string
  readonly cardId?: string
  readonly manuscriptId?: string
  readonly kind?: string
  /** `chapter`: its number (events written before 2026-11-01 carry it only in the title). */
  readonly chapter?: number
}

/** One `room/desk-wrote` event of this owner, as the line reads it. */
export interface DeskWrite {
  readonly seq: number
  readonly time: number
  readonly member: string
  readonly role: 'coordinator' | 'member'
  readonly runId?: string
  readonly canvasId: string
  readonly title: string
  readonly items: readonly DeskWriteItem[]
}

const ACTIONS = new Set(['added', 'changed', 'commented', 'archived', 'manuscript', 'chapter'])

/**
 * Read one event, or null when it is not this owner's write.
 * @param event - type, seq, time and the room payload.
 */
export function deskWriteOf(event: { readonly type: string; readonly seq: number; readonly time: number; readonly data?: unknown }): DeskWrite | null {
  if (event.type !== 'room/desk-wrote') return null
  const outer = event.data as { owner?: unknown; member?: unknown; role?: unknown; runId?: unknown; data?: { canvasId?: unknown; title?: unknown; items?: unknown } } | undefined
  if (outer?.owner !== DESK_OWNER || typeof outer.data?.canvasId !== 'string' || !Array.isArray(outer.data.items)) return null
  const items = (outer.data.items as unknown[]).flatMap((raw): DeskWriteItem[] => {
    const item = raw as Partial<Record<keyof DeskWriteItem, unknown>>
    if (typeof item.action !== 'string' || !ACTIONS.has(item.action) || typeof item.title !== 'string') return []
    return [{
      action: item.action as DeskWriteItem['action'], title: item.title,
      ...typeof item.cardId === 'string' ? { cardId: item.cardId } : {},
      ...typeof item.manuscriptId === 'string' ? { manuscriptId: item.manuscriptId } : {},
      ...typeof item.kind === 'string' ? { kind: item.kind } : {},
      ...chapterOf(item),
    }]
  })
  return {
    seq: event.seq, time: event.time,
    member: typeof outer.member === 'string' ? outer.member : '',
    role: outer.role === 'coordinator' ? 'coordinator' : 'member',
    ...typeof outer.runId === 'string' ? { runId: outer.runId } : {},
    canvasId: outer.data.canvasId,
    title: typeof outer.data.title === 'string' ? outer.data.title : '',
    items,
  }
}

/** The strongest thing that happened to one card in a turn: a new card stays new. */
const RANK: Record<DeskWriteItem['action'], number> = { added: 4, archived: 3, commented: 2, changed: 1, manuscript: 0, chapter: 0 }

/** One canvas's writes in a turn, folded. */
export interface DeskWriteGroup {
  readonly canvasId: string
  readonly title: string
  /** The last write's event (seq/time/role/member) — what the line follows by. */
  readonly last: DeskWrite
  readonly items: readonly DeskWriteItem[]
}

/**
 * Fold a turn's writes per canvas, in first-write order.
 * @param writes - the turn's write events, in order.
 */
export function foldWrites(writes: readonly DeskWrite[]): DeskWriteGroup[] {
  const groups = new Map<string, { title: string; last: DeskWrite; items: Map<string, DeskWriteItem> }>()
  for (const write of writes) {
    const group = groups.get(write.canvasId) ?? { title: write.title, last: write, items: new Map<string, DeskWriteItem>() }
    group.title = write.title || group.title
    group.last = write
    for (const item of write.items) {
      const key = item.cardId !== undefined ? `c:${item.cardId}` : `m:${item.manuscriptId ?? item.title}`
      const had = group.items.get(key)
      if (had === undefined || RANK[item.action] > RANK[had.action]) group.items.set(key, had === undefined ? item : { ...item, title: item.title || had.title })
    }
    groups.set(write.canvasId, group)
  }
  return [...groups.entries()].map(([canvasId, group]) => ({ canvasId, title: group.title, last: group.last, items: [...group.items.values()] }))
}

/** The copy the line needs. */
export type DeskWriteCopy = (key: string, params?: Record<string, string>) => string

/**
 * The line's parts: added cards per category (one by name, several counted),
 * then edits, comments, archives and manuscripts.
 * @param items - one canvas's folded items.
 * @param t - the copy.
 */
export function writeSummaryParts(items: readonly DeskWriteItem[], t: DeskWriteCopy): string[] {
  const parts: string[] = []
  const added = items.filter(item => item.action === 'added')
  const kinds = [...new Set(added.map(item => item.kind ?? ''))]
  for (const kind of kinds) {
    const ofKind = added.filter(item => (item.kind ?? '') === kind)
    parts.push(ofKind.length > 1 ? t('deskwrite.addedN', { kind, count: String(ofKind.length) })
      : ofKind[0]!.title === '' ? t('deskwrite.addedUntitled', { kind })
        : t('deskwrite.added1', { kind, title: ofKind[0]!.title }))
  }
  for (const action of ['chapter', 'changed', 'commented', 'archived', 'manuscript'] as const) {
    const of = items.filter(item => item.action === action)
    if (of.length === 0) continue
    // A single unnamed card is counted rather than shown with empty quotes.
    parts.push(of.length === 1 && of[0]!.title !== ''
      ? t(`deskwrite.${action}1`, { title: of[0]!.title })
      : t(`deskwrite.${action}N`, { count: String(of.length) }))
  }
  return parts
}

/** A chapter item's number: its own field, else the 「第 N 章」 its title opens with (older events). */
function chapterOf(item: Partial<Record<keyof DeskWriteItem, unknown>>): { chapter?: number } {
  if (item.action !== 'chapter') return {}
  if (typeof item.chapter === 'number') return { chapter: item.chapter }
  const n = typeof item.title === 'string' ? /^第\s*(\d+)\s*章/.exec(item.title)?.[1] : undefined
  return n === undefined ? {} : { chapter: Number(n) }
}

/**
 * Where a turn's writes on one canvas are seen best (proposal
 * 2026-10-30-agent-sidebar-navigation): the chapter it wrote (the last one),
 * else the one card or manuscript it touched, else every card it touched under
 * the board's 「本轮改动」 chip, else the canvas.
 * @param canvasId - the canvas.
 * @param items - the folded items of the turn.
 */
export function deskWritePlace(canvasId: string, items: readonly DeskWriteItem[]): {
  readonly canvasId: string
  readonly card?: string
  readonly manuscript?: string
  readonly face?: 'board' | 'manuscripts'
  readonly item?: string
  readonly focus?: string
  readonly cards?: readonly string[]
  readonly heading?: string
} {
  const chapter = [...items].reverse().find(item => item.action === 'chapter' && item.chapter !== undefined)
  if (chapter !== undefined) return { canvasId, face: 'manuscripts', item: String(chapter.chapter), focus: 'body' }
  const cards = [...new Set(items.filter(item => item.cardId !== undefined && item.action !== 'archived').map(item => item.cardId!))]
  const manuscripts = items.filter(item => item.manuscriptId !== undefined)
  if (cards.length === 1 && manuscripts.length === 0) {
    const card = items.find(item => item.cardId === cards[0])!
    return { canvasId, card: card.cardId!, heading: card.title }
  }
  if (cards.length === 0 && manuscripts.length === 1) return { canvasId, manuscript: manuscripts[0]!.manuscriptId!, heading: manuscripts[0]!.title }
  if (cards.length > 1) return { canvasId, face: 'board', cards }
  return { canvasId }
}
