/**
 * The timeline (时间轴, 2026-11-01): the book's events in story time — what
 * has happened (episodic memory) and what is to happen (prospective memory:
 * the person's preset events, characters' intentions, consequences waiting
 * to land, promises, and the reveals the foreshadows owe) — with each
 * future event's tension, after Lewin's tension systems:
 *
 *   tension = V × E × (1 + 0.25·Z) ÷ (1 + k·D) × satiation
 *
 * V value (the agent sets it, the person may change it), E readiness (the
 * share of the event's preconditions the 对账 has ticked), D distance to
 * its window in chapters (no window counts as 4), Z chapters since it was
 * last touched, S times advanced in the last four chapters. The tier is the
 * dominant part, checked in order: 饱和 → 搁置 → 临近 → 积压 → 就绪.
 *
 * Recall is computation, never a model call: the planner asks for the
 * candidates, the engine ranks every future event and hands back a few
 * lines.
 *
 * This module is pure: the shapes, their tolerant reads, the tension and
 * the recall. The store keeps the file and the journals.
 *
 * @module @khorsheed/dsh-canvas-novel
 */

/** Where an event stands. */
export type EventStatus = 'happened' | 'planned' | 'preset' | 'hidden' | 'failed'
/** Where a future event comes from. */
export type FutureSource = '预设' | '打算' | '后果' | '承诺' | '揭晓'
/** The tiers, in the order they are checked. */
export type Tier = 'sat' | 'hold' | 'near' | 'backlog' | 'ready'

export const FUTURE_SOURCES: readonly FutureSource[] = ['预设', '打算', '后果', '承诺', '揭晓']
export const TIER_ORDER: readonly Tier[] = ['near', 'backlog', 'ready', 'sat', 'hold']
export const TIER_LABELS: Readonly<Record<Tier, string>> = { near: '临近', backlog: '积压', ready: '就绪', sat: '饱和', hold: '搁置' }
/** The pace (k) the timeline uses until a book can set its own. */
export const DEFAULT_PACE = 0.4
/** How many candidates recall hands the planner. */
export const RECALL_MAX = 8

/** A precondition of a future event: met in chapter N, or still open. */
export interface EventPrecondition {
  readonly text: string
  readonly met?: number
}

/** One event on the timeline. */
export interface StoryEvent {
  /** `e<n>`; a foreshadow's reveal is the derived `fs:<cardId>`. */
  readonly id: string
  readonly title: string
  /** Story time as a label (2046 / 第 2 天傍晚 / 约 2095): shown, never computed with. */
  readonly when?: string
  /** Position in story time: events sort by it. */
  readonly order: number
  readonly status: EventStatus
  /** A future event's origin. */
  readonly source?: FutureSource
  /** The characters it involves (card ids). */
  readonly who?: readonly string[]
  /** The settings it happens at or touches (card ids). */
  readonly places?: readonly string[]
  /** The chapters that wrote it (happened) or are to (planned). */
  readonly chapters?: readonly number[]
  /** V, 0–1. */
  readonly value?: number
  readonly valueWhy?: string
  /** The window as the person reads it (卷一末 / 第 8 章前). */
  readonly window?: string
  /** The window as a chapter number, when it has one. */
  readonly windowChapter?: number
  readonly pre?: readonly EventPrecondition[]
  /** The chapters that advanced it. */
  readonly touched?: readonly number[]
  /** The events that cause it (ids). */
  readonly causes?: readonly string[]
  /** The chapter the book stood at when it was set (Z counts from here before any touch). */
  readonly since?: number
  /** Evidence for a happened event: the text that wrote it. */
  readonly evidence?: string
  /** For a reveal: the foreshadow card. */
  readonly foreshadowId?: string
  readonly createdAt: string
}

/** The pins the person set for the next chapter's recall. */
export interface RecallPins {
  readonly chapter: number
  readonly prefer: readonly string[]
  readonly block: readonly string[]
}

/** The timeline file. */
export interface TimelineDoc {
  readonly version: 1
  readonly events: readonly StoryEvent[]
  readonly pins?: RecallPins
  /** The next `e<n>`. */
  readonly next: number
}

export function emptyTimeline(): TimelineDoc {
  return { version: 1, events: [], next: 1 }
}

const STATUSES: readonly EventStatus[] = ['happened', 'planned', 'preset', 'hidden', 'failed']

function text(value: unknown, max: number): string | undefined {
  if (typeof value === 'number') value = String(value)
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined
}

function ids(value: unknown, max = 12): string[] | undefined {
  const list = (Array.isArray(value) ? value : []).map(item => text(item, 80)).filter((item): item is string => item !== undefined)
  return list.length === 0 ? undefined : [...new Set(list)].slice(0, max)
}

function chapterList(value: unknown): number[] | undefined {
  const list = (Array.isArray(value) ? value : []).filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0)
  return list.length === 0 ? undefined : [...new Set(list)].sort((a, b) => a - b)
}

/** Tolerant read of one event. */
export function normalizeEvent(raw: unknown): StoryEvent | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const id = text(r['id'], 80)
  const title = text(r['title'], 200)
  const status = STATUSES.find(candidate => candidate === r['status'])
  if (id === undefined || title === undefined || status === undefined) return undefined
  const order = typeof r['order'] === 'number' && Number.isFinite(r['order']) ? r['order'] : 0
  const source = FUTURE_SOURCES.find(candidate => candidate === r['source'])
  const value = typeof r['value'] === 'number' && Number.isFinite(r['value']) ? Math.max(0, Math.min(1, r['value'])) : undefined
  const windowChapter = typeof r['windowChapter'] === 'number' && Number.isInteger(r['windowChapter']) && r['windowChapter'] > 0 ? r['windowChapter'] : undefined
  const since = typeof r['since'] === 'number' && Number.isInteger(r['since']) && r['since'] >= 0 ? r['since'] : undefined
  const pre = (Array.isArray(r['pre']) ? r['pre'] : []).flatMap((row): EventPrecondition[] => {
    if (typeof row !== 'object' || row === null) return []
    const item = row as Record<string, unknown>
    const t = text(item['text'], 200)
    if (t === undefined) return []
    const met = typeof item['met'] === 'number' && Number.isInteger(item['met']) ? item['met'] : undefined
    return [{ text: t, ...(met === undefined ? {} : { met }) }]
  }).slice(0, 8)
  const opt = <K extends string, V>(key: K, v: V | undefined): Partial<Record<K, V>> => v === undefined ? {} : { [key]: v } as Record<K, V>
  return {
    id, title, order, status,
    ...opt('when', text(r['when'], 60)),
    ...opt('source', source),
    ...opt('who', ids(r['who'])),
    ...opt('places', ids(r['places'])),
    ...opt('chapters', chapterList(r['chapters'])),
    ...opt('value', value),
    ...opt('valueWhy', text(r['valueWhy'], 200)),
    ...opt('window', text(r['window'], 60)),
    ...opt('windowChapter', windowChapter),
    ...(pre.length === 0 ? {} : { pre }),
    ...opt('touched', chapterList(r['touched'])),
    ...opt('causes', ids(r['causes'])),
    ...opt('since', since),
    ...opt('evidence', text(r['evidence'], 200)),
    ...opt('foreshadowId', text(r['foreshadowId'], 80)),
    createdAt: text(r['createdAt'], 40) ?? '',
  }
}

/** Tolerant read of the timeline file. */
export function normalizeTimeline(raw: unknown): TimelineDoc | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const events = (Array.isArray(r['events']) ? r['events'] : []).map(normalizeEvent).filter((event): event is StoryEvent => event !== undefined)
  const pinsRaw = r['pins'] as Record<string, unknown> | undefined
  const pins = typeof pinsRaw === 'object' && pinsRaw !== null && typeof pinsRaw['chapter'] === 'number'
    ? { chapter: pinsRaw['chapter'], prefer: ids(pinsRaw['prefer'], 40) ?? [], block: ids(pinsRaw['block'], 40) ?? [] }
    : undefined
  const next = typeof r['next'] === 'number' && Number.isInteger(r['next']) && r['next'] > 0
    ? r['next']
    : events.reduce((max, event) => Math.max(max, Number(/^e(\d+)$/.exec(event.id)?.[1] ?? 0)), 0) + 1
  return { version: 1, events, ...(pins === undefined ? {} : { pins }), next }
}

/** Whether an event is still to come (prospective memory). */
export function isFuture(event: StoryEvent): boolean {
  return event.status === 'preset' || event.status === 'planned' || event.status === 'hidden'
}

/** The parts of a future event's tension at a chapter. */
export interface TensionParts {
  readonly V: number
  readonly E: number
  /** Chapters to the window; undefined when it has none. */
  readonly D?: number
  readonly Z: number
  readonly S: number
  readonly tension: number
  readonly tier: Tier
}

/**
 * One future event's tension, at the book's current chapter.
 * @param event - the event.
 * @param current - the newest chapter number.
 * @param pace - k: a fast book discounts distant events harder.
 */
export function tensionOf(event: StoryEvent, current: number, pace = DEFAULT_PACE): TensionParts {
  const V = event.value ?? 0.5
  const pre = event.pre ?? []
  const E = pre.length === 0 ? 1 : pre.filter(row => row.met !== undefined).length / pre.length
  const D = event.windowChapter === undefined ? undefined : Math.max(0, event.windowChapter - current)
  const last = Math.max(event.since ?? current, ...(event.touched ?? []))
  const Z = Math.max(0, current - last)
  const S = (event.touched ?? []).filter(n => n > current - 4 && n <= current).length
  const satiation = S >= 3 ? 0.35 : S === 2 ? 0.7 : 1
  const tension = V * E * (1 + 0.25 * Z) / (1 + pace * Math.min(D ?? 4, 30)) * satiation
  const tier: Tier = S >= 3 ? 'sat'
    : pre.some(row => row.met === undefined) ? 'hold'
      : D !== undefined && D < 3 ? 'near'
        : Z >= 3 ? 'backlog'
          : 'ready'
  return { V, E, ...(D === undefined ? {} : { D }), Z, S, tension, tier }
}

/** Why an event sits in its tier, in one line the person can read. */
export function tierReason(event: StoryEvent, parts: TensionParts): string {
  if (parts.tier === 'sat') return `最近 4 章推进了 ${parts.S} 次`
  if (parts.tier === 'hold') return `还缺：${(event.pre ?? []).filter(row => row.met === undefined).map(row => row.text).join('、')}`
  if (parts.tier === 'near') return `离时间窗口还有约 ${parts.D} 章`
  if (parts.tier === 'backlog') return `已经 ${parts.Z} 章没写到`
  return (event.pre ?? []).length === 0 ? '条件都齐了' : '前置都已发生'
}

/** One recalled candidate. */
export interface Candidate {
  readonly event: StoryEvent
  readonly parts: TensionParts
  readonly preferred: boolean
}

/**
 * The few future events the planner sees (recall): preferred ones first;
 * blocked ones never; every 临近 one; then by tension. Apart from the POV
 * character, one character may fill at most two places. 饱和 and 搁置 stay
 * out unless preferred.
 * @param events - every future event (the derived reveals included).
 * @param current - the newest chapter number.
 * @param options - the person's pins, the POV character, the cap.
 */
export function recall(
  events: readonly StoryEvent[],
  current: number,
  options: { readonly prefer?: readonly string[]; readonly block?: readonly string[]; readonly pov?: string; readonly max?: number; readonly pace?: number } = {},
): Candidate[] {
  const prefer = new Set(options.prefer ?? [])
  const block = new Set(options.block ?? [])
  const max = options.max ?? RECALL_MAX
  const scored = events.filter(isFuture).filter(event => !block.has(event.id))
    .map(event => ({ event, parts: tensionOf(event, current, options.pace), preferred: prefer.has(event.id) }))
  const rank = (a: Candidate, b: Candidate): number =>
    TIER_ORDER.indexOf(a.parts.tier) - TIER_ORDER.indexOf(b.parts.tier) || b.parts.tension - a.parts.tension
  const out: Candidate[] = scored.filter(row => row.preferred).sort(rank)
  const seats = new Map<string, number>()
  const people = (row: Candidate): string[] => (row.event.who ?? []).filter(id => id !== options.pov)
  for (const row of out) for (const id of people(row)) seats.set(id, (seats.get(id) ?? 0) + 1)
  for (const row of scored.filter(row => !row.preferred && row.parts.tier !== 'sat' && row.parts.tier !== 'hold').sort(rank)) {
    if (out.length >= max) break
    if (row.parts.tier !== 'near' && people(row).some(id => (seats.get(id) ?? 0) >= 2)) continue
    for (const id of people(row)) seats.set(id, (seats.get(id) ?? 0) + 1)
    out.push(row)
  }
  return out
}

/** A position between two neighbours (or past the last), for inserting an event after another. */
export function orderAfter(events: readonly StoryEvent[], afterId: string | undefined): number {
  const sorted = [...events].sort((a, b) => a.order - b.order)
  if (sorted.length === 0) return 1
  if (afterId === undefined) return sorted[sorted.length - 1]!.order + 1
  const index = sorted.findIndex(event => event.id === afterId)
  if (index === -1) return sorted[sorted.length - 1]!.order + 1
  const next = sorted[index + 1]
  return next === undefined ? sorted[index]!.order + 1 : (sorted[index]!.order + next.order) / 2
}
