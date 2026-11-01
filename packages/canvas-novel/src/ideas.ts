/**
 * 灵感 (2026-11-01): what the person jots down out of chapter order — a
 * scene, a line of dialogue, a thought. Saving one asks nothing of the
 * agent; binding it to a future event is either the person's own click or
 * a request they send into the conversation. A bound idea's text rides
 * along verbatim when the planner picks its event; the 对账 of the chapter
 * that realizes the event marks it 已写入.
 *
 * Also the character memory's journal shape (相信的事 / 当前打算), which the
 * 对账 appends to the same way it appends experiences.
 *
 * @module @khorsheed/dsh-canvas-novel
 */

/** One idea. */
export interface Idea {
  readonly id: string
  readonly text: string
  readonly createdAt: string
  /** The future event it is bound to. */
  readonly eventId?: string
  /** The chapter that wrote it in. */
  readonly writtenIn?: number
}

/** The ideas file. */
export interface IdeasDoc {
  readonly version: 1
  readonly ideas: readonly Idea[]
  readonly next: number
}

export function emptyIdeas(): IdeasDoc {
  return { version: 1, ideas: [], next: 1 }
}

/** Tolerant read of the ideas file. */
export function normalizeIdeas(raw: unknown): IdeasDoc | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const ideas = (Array.isArray(r['ideas']) ? r['ideas'] : []).flatMap((row): Idea[] => {
    if (typeof row !== 'object' || row === null) return []
    const item = row as Record<string, unknown>
    const id = typeof item['id'] === 'string' ? item['id'] : undefined
    const text = typeof item['text'] === 'string' ? item['text'].trim().slice(0, 4000) : ''
    if (id === undefined || text === '') return []
    const eventId = typeof item['eventId'] === 'string' && item['eventId'] !== '' ? item['eventId'] : undefined
    const writtenIn = typeof item['writtenIn'] === 'number' && Number.isInteger(item['writtenIn']) ? item['writtenIn'] : undefined
    return [{
      id, text, createdAt: typeof item['createdAt'] === 'string' ? item['createdAt'] : '',
      ...(eventId === undefined ? {} : { eventId }), ...(writtenIn === undefined ? {} : { writtenIn }),
    }]
  })
  const next = typeof r['next'] === 'number' && Number.isInteger(r['next']) && r['next'] > 0
    ? r['next']
    : ideas.reduce((max, idea) => Math.max(max, Number(/^i(\d+)$/.exec(idea.id)?.[1] ?? 0)), 0) + 1
  return { version: 1, ideas, next }
}

/** Where a belief came from: seen first-hand, heard from someone, or worked out. */
export type BeliefSource = '亲历' | '听说' | '推测'
export const BELIEF_SOURCES: readonly BeliefSource[] = ['亲历', '听说', '推测']

/** One line of a character's memory journal: a belief they came to hold, or what they now intend. */
export interface MindEntry {
  readonly characterId: string
  readonly chapter: number
  readonly kind: 'belief' | 'intent'
  readonly text: string
  readonly source?: BeliefSource
  /** Who they heard it from (a card id or a name). */
  readonly from?: string
  readonly evidence?: string
  readonly createdAt: string
}

/** Tolerant read of one journal line. */
export function normalizeMindEntry(raw: unknown): MindEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const characterId = typeof r['characterId'] === 'string' ? r['characterId'] : undefined
  const chapter = typeof r['chapter'] === 'number' && Number.isInteger(r['chapter']) ? r['chapter'] : undefined
  const kind = r['kind'] === 'intent' ? 'intent' : r['kind'] === 'belief' ? 'belief' : undefined
  const text = typeof r['text'] === 'string' ? r['text'].trim().slice(0, 300) : ''
  if (characterId === undefined || chapter === undefined || kind === undefined || text === '') return undefined
  const source = BELIEF_SOURCES.find(candidate => candidate === r['source'])
  const from = typeof r['from'] === 'string' && r['from'] !== '' ? r['from'].slice(0, 80) : undefined
  const evidence = typeof r['evidence'] === 'string' && r['evidence'] !== '' ? r['evidence'].slice(0, 200) : undefined
  return {
    characterId, chapter, kind, text, createdAt: typeof r['createdAt'] === 'string' ? r['createdAt'] : '',
    ...(source === undefined ? {} : { source }), ...(from === undefined ? {} : { from }), ...(evidence === undefined ? {} : { evidence }),
  }
}
