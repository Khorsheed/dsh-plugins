/**
 * The 故事日志 page: one tab per kind of card — 伏笔, 人物, 关系, 世界 — each a
 * table of its rows over the book's chapters, one mark per chapter in the
 * tab's colour (hollow when only a plan has it there):
 *
 * - 伏笔: the chapters that planted / advanced / hinted / resolved it; the row
 *   end says how long it has slept;
 * - 人物: the chapters a character is in;
 * - 关系: the pair's 确立 / 加深 / 进入新阶段 / 裂痕 / 修复;
 * - 世界: the chapter a setting first appeared and each 设定更新.
 *
 * Each tab has its own filters and sorts; the key folds behind 「图例」. A row
 * opens the detail beside the table (in its place on a narrow frame); a
 * chapter number opens that chapter's page. The table is a bounded scroll box
 * that pans by dragging its blank cells.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  isOverdue, NOVEL_GENRE_ID, nextMilestoneOf, PLOT_FIELDS, PTS_PER_LEVEL, RELATION_LADDERS, SLEEP_THRESHOLD,
  type HistoryChange, type HistoryEntry, type MentionEntry, type RelationEntry,
  type StoryCard, type StoryCharacter, type StoryForeshadow, type StoryLogResult, type StoryRelation,
} from '../types.ts'
import { CHAPTER_PAGE, type NovelNavigate, type NovelPageOwnerProps, type NovelRemote, type NovelSurfaceProps } from './contract.ts'
import { chapterHeading } from './PendingStrip.tsx'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './novel.module.css'

type T = TranslateNS<'novel'>

/** The frame narrower than this shows one face at a time: the table, or a picked row's detail in its place. */
const NARROW_BELOW = 860
/** Below this the row heads drop their number and trailing note. */
const PHONE_BELOW = 480
/** A book longer than this gets the compact columns. */
const MANY_CHAPTERS = 6
/** The 沉睡 filter's bar, a step before the sleep reminder itself. */
const SLEEPY = 3

/* --------------------------------------------------------------- model */

type Tab = 'f' | 'c' | 'r' | 'w'
const TABS: readonly Tab[] = ['f', 'c', 'r', 'w']

type StageEvent = Extract<RelationEntry, { kind: 'stage' }>['event']
type Glyph = MentionEntry['kind'] | 'appear' | 'first' | 'changed' | StageEvent | 'deepen' | 'drift'

/** One line of a row's track: a mark in the table and a line in the detail. */
interface Step {
  readonly chapter: number
  readonly glyph: Glyph
  readonly word: string
  /** The detail leads with the first note instead of the word (a character's 出场 says nothing a 第 N 章 row does not). */
  readonly wordless?: boolean
  readonly planned: boolean
  /** Smaller words after the mark's word (`相识 → 合作`, the plan's line). */
  readonly notes: readonly string[]
  /** Card changes behind the step (人物 / 世界). */
  readonly changes: readonly HistoryEntry[]
  /** Where a relation step drew from (原文). */
  readonly evidence?: string
}

/** A row of any tab: the head, the track, and what the filters and sorts read. */
interface Row {
  readonly id: string
  readonly ref: string
  readonly text: string
  readonly meta: string
  readonly bad: boolean
  readonly steps: readonly Step[]
  /** The first and last chapter the text (not a plan) has it in; 0 when none. */
  readonly first: number
  readonly last: number
}

interface ForeshadowRow extends Row {
  readonly view: StoryForeshadow
  /** 已揭晓 or 已放弃: no sleep. */
  readonly closed: boolean
  readonly sleeping: boolean
  readonly threshold: number
}

interface RelationRow extends Row {
  readonly view: StoryRelation
  /** Every type the pair has had, oldest first (`同盟 → 对手`). */
  readonly types: readonly StoryRelation['type'][]
}

interface CharacterRow extends Row {
  readonly card: StoryCharacter
  readonly shown: number
}

interface WorldRow extends Row {
  readonly card: StoryCard
  readonly kind: string
}

interface Model {
  /** The newest reconciled chapter (0 when none is). */
  readonly cur: number
  readonly last: number
  readonly planning: ReadonlySet<number>
  readonly f: readonly ForeshadowRow[]
  readonly c: readonly CharacterRow[]
  readonly r: readonly RelationRow[]
  readonly w: readonly WorldRow[]
}

const MENTION_KEY = {
  planted: 'pending.mention.planted', advanced: 'pending.mention.advanced',
  hinted: 'pending.mention.hinted', resolved: 'pending.mention.resolved',
} as const

const refOrder = (ref: string): number => Number(/\d+/.exec(ref)?.[0] ?? Number.POSITIVE_INFINITY)

function span(steps: readonly Step[]): { first: number; last: number } {
  const settled = steps.filter(step => !step.planned).map(step => step.chapter)
  return { first: settled.length === 0 ? 0 : Math.min(...settled), last: Math.max(0, ...settled) }
}

function foreshadowRow(view: StoryForeshadow, t: T): ForeshadowRow {
  const marks = view.marks.length > 0 || view.plantedAt === undefined
    ? view.marks
    : [{ chapter: view.plantedAt, kind: 'planted' as const, planned: false }]
  const steps: Step[] = marks.map(mark => ({
    chapter: mark.chapter, glyph: mark.kind, word: t(MENTION_KEY[mark.kind]), planned: mark.planned,
    notes: mark.note === undefined ? [] : [mark.note], changes: [],
  }))
  const closed = view.state === '已揭晓' || view.state === '已放弃'
  const sleeping = !closed && isOverdue(view)
  const slept = view.slept ?? 0
  const meta = closed ? view.state : slept > 0 ? t('log.f.sleeping', { n: slept }) : ''
  return {
    id: view.cardId, ref: view.ref, text: view.question, meta, bad: sleeping, steps, ...span(steps),
    view, closed, sleeping, threshold: view.starred ? SLEEP_THRESHOLD.starred : SLEEP_THRESHOLD.normal,
  }
}

/** A pair's journal as steps: 确立, 加深 / 疏远, 进入新阶段 (`相识 → 合作`), 裂痕, 决裂, 修复, 转为…, 手动调整. */
function relationRow(view: StoryRelation, t: T): RelationRow {
  const firstType = view.journal.find(entry => entry.kind === 'stage' && entry.event === 'type')
  let type: StoryRelation['type'] = (firstType?.kind === 'stage' ? firstType.fromType : undefined) ?? view.type
  const types = [type]
  let stage: string | undefined
  const steps: Step[] = view.journal.map((entry) => {
    const base = { chapter: entry.chapter, planned: false, changes: [], ...(entry.evidence === undefined ? {} : { evidence: entry.evidence }) }
    if (entry.kind === 'points') {
      const strong = Math.abs(entry.delta) >= 2
      return entry.delta < 0
        ? { ...base, glyph: 'drift', word: t(strong ? 'log.m.driftMore' : 'log.m.drift'), notes: [] }
        : { ...base, glyph: 'deepen', word: t(strong ? 'log.m.deepenMore' : 'log.m.deepen'), notes: [] }
    }
    const from = stage
    stage = entry.stage
    switch (entry.event) {
      case 'start': return { ...base, glyph: 'start', word: t('log.m.start'), notes: [entry.stage] }
      case 'up': return { ...base, glyph: 'up', word: t('log.m.up'), notes: [from === undefined ? entry.stage : `${from} → ${entry.stage}`] }
      case 'crack': return { ...base, glyph: 'crack', word: t('log.m.crack'), notes: [] }
      case 'break': return { ...base, glyph: 'break', word: t('log.m.break'), notes: [] }
      case 'fix': return { ...base, glyph: 'fix', word: t('log.m.fix'), notes: [t('log.r.backTo', { stage: entry.stage })] }
      case 'set': return { ...base, glyph: 'set', word: t('log.m.set'), notes: [from === undefined ? entry.stage : `${from} → ${entry.stage}`] }
      case 'type': {
        if (entry.toType !== undefined && entry.toType !== type) {
          type = entry.toType
          types.push(type)
        }
        return { ...base, glyph: 'type', word: t('log.m.type', { type }), notes: [entry.stage] }
      }
    }
  })
  return {
    id: view.cardId, ref: view.ref, text: view.names.join(' × '), meta: `${view.type} · ${view.stage}`, bad: view.rift !== undefined,
    steps, ...span(steps), view, types,
  }
}

function characterRow(card: StoryCharacter, t: T): CharacterRow {
  const steps: Step[] = card.appearances.map(at => ({
    chapter: at.chapter, glyph: 'appear', word: t('log.m.appear'), wordless: true, planned: at.planned,
    notes: [...at.role === undefined ? [] : [at.role], ...at.experiences], changes: [],
  }))
  return { id: card.cardId, ref: card.ref, text: card.name, meta: castCount(card, t), bad: false, steps, ...span(steps), card, shown: steps.filter(step => !step.planned).length }
}

function worldRow(card: StoryCard, t: T): WorldRow {
  const chapters = [...new Set(card.history.map(entry => entry.chapter))].sort((a, b) => a - b)
  const steps: Step[] = chapters.map((chapter) => {
    const changes = card.history.filter(entry => entry.chapter === chapter)
    const first = changes.every(entry => entry.kind === 'create')
    return { chapter, glyph: first ? 'first' : 'changed', word: t(first ? 'log.m.first' : 'log.m.changed'), planned: false, notes: [], changes }
  })
  const kind = card.plot['kind'] ?? ''
  return { id: card.cardId, ref: card.ref, text: card.name, meta: kind, bad: false, steps, ...span(steps), card, kind }
}

function storyModel(log: StoryLogResult, t: T): Model {
  const settled = log.chapters.filter(row => row.phase === 'extracted' || row.phase === 'reviewed').map(row => row.n)
  const cur = Math.max(0, ...settled)
  const f = log.foreshadows.map(view => foreshadowRow(view, t))
  const r = log.relations.map(view => relationRow(view, t))
  const c = log.characters.map(card => characterRow(card, t))
  const w = log.world.map(card => worldRow(card, t))
  const last = Math.max(1, cur, ...log.chapters.map(row => row.n), ...[...f, ...r, ...c, ...w].flatMap(row => row.steps.map(step => step.chapter)))
  const planning = new Set(log.chapters.filter(row => row.phase === 'planning' || row.phase === 'writing').map(row => row.n))
  return { cur, last, planning, f, c, r, w }
}

/** 出场 counts the written chapters, 计划 the planned ones; a zero side is left out. */
function castCount(card: StoryCharacter, t: T): string {
  const shown = card.appearances.filter(at => !at.planned).length
  const planned = card.appearances.length - shown
  const parts = [...shown > 0 ? [t('log.c.shown', { n: shown })] : [], ...planned > 0 ? [t('log.c.plannedCount', { n: planned })] : []]
  return parts.length === 0 ? t('log.c.absent') : parts.join(' · ')
}

/** The step a chapter cell draws: the text over the plan, then the weightiest kind. */
const WEIGHT: Readonly<Record<Glyph, number>> = {
  resolved: 9, planted: 8, advanced: 7, hinted: 6, appear: 5, first: 5, changed: 4,
  break: 9, crack: 8, fix: 7, up: 6, type: 5, set: 4, start: 3, deepen: 2, drift: 2,
}
function cellStep(steps: readonly Step[]): Step | undefined {
  let best: Step | undefined
  for (const step of steps) {
    if (best === undefined || (best.planned && !step.planned) || (best.planned === step.planned && WEIGHT[step.glyph] > WEIGHT[best.glyph])) best = step
  }
  return best
}

/* -------------------------------------------------------------- per tab */

interface Choice<R> {
  readonly key: string
  readonly label: string
  readonly test: (row: R) => boolean
  readonly star?: boolean
}
interface Order<R> {
  readonly key: string
  readonly label: string
  readonly compare: (a: R, b: R) => number
}
interface TabSpec<R extends Row> {
  readonly rows: readonly R[]
  readonly filters: readonly Choice<R>[]
  readonly sorts: readonly Order<R>[]
  readonly glyphs: readonly Glyph[]
}

const byFirst = (a: Row, b: Row): number => (a.first || Number.POSITIVE_INFINITY) - (b.first || Number.POSITIVE_INFINITY) || refOrder(a.ref) - refOrder(b.ref)
const byLast = (a: Row, b: Row): number => b.last - a.last || byFirst(a, b)

function tabSpec(model: Model, tab: Tab, t: T): TabSpec<Row> {
  if (tab === 'f') {
    const spec: TabSpec<ForeshadowRow> = {
      rows: model.f,
      filters: [
        { key: 'open', label: t('log.filter.open'), test: row => !row.closed },
        { key: 'sleepy', label: t('log.filter.sleepy', { n: SLEEPY }), test: row => !row.closed && (row.view.slept ?? 0) >= SLEEPY },
        { key: 'star', label: t('log.filter.star'), test: row => row.view.starred, star: true },
        { key: 'done', label: t('log.filter.done'), test: row => row.view.state === '已揭晓' },
        { key: 'all', label: t('log.filter.all'), test: () => true },
      ],
      sorts: [
        { key: 'plant', label: t('log.sort.plant'), compare: byFirst },
        { key: 'sleep', label: t('log.sort.sleep'), compare: (a, b) => (b.closed ? -1 : b.view.slept ?? 0) - (a.closed ? -1 : a.view.slept ?? 0) || byFirst(a, b) },
      ],
      glyphs: ['planted', 'advanced', 'hinted', 'resolved'],
    }
    return spec as unknown as TabSpec<Row>
  }
  if (tab === 'c') {
    const spec: TabSpec<CharacterRow> = {
      rows: model.c,
      filters: [
        { key: 'all', label: t('log.filter.all'), test: () => true },
        { key: 'now', label: t('log.filter.now'), test: row => row.steps.some(step => step.chapter === model.cur) },
      ],
      sorts: [
        { key: 'first', label: t('log.sort.first'), compare: byFirst },
        { key: 'count', label: t('log.sort.count'), compare: (a, b) => b.shown - a.shown || byFirst(a, b) },
        { key: 'recent', label: t('log.sort.recent'), compare: byLast },
      ],
      glyphs: ['appear'],
    }
    return spec as unknown as TabSpec<Row>
  }
  if (tab === 'r') {
    const types = [...new Set(model.r.map(row => row.view.type))]
    const spec: TabSpec<RelationRow> = {
      rows: model.r,
      filters: [
        { key: 'all', label: t('log.filter.all'), test: () => true },
        { key: 'ready', label: t('log.filter.ready'), test: row => row.view.ready },
        { key: 'rift', label: t('log.filter.rift'), test: row => row.view.rift !== undefined },
        ...types.map(type => ({ key: `t:${type}`, label: type, test: (row: RelationRow) => row.view.type === type })),
      ],
      sorts: [
        { key: 'changed', label: t('log.sort.changed'), compare: byLast },
        { key: 'start', label: t('log.sort.start'), compare: byFirst },
      ],
      glyphs: ['start', 'deepen', 'up', 'crack', 'fix'],
    }
    return spec as unknown as TabSpec<Row>
  }
  const kinds = [...new Set(model.w.map(row => row.kind).filter(kind => kind !== ''))]
  const spec: TabSpec<WorldRow> = {
    rows: model.w,
    filters: [
      { key: 'all', label: t('log.filter.all'), test: () => true },
      ...kinds.map(kind => ({ key: `k:${kind}`, label: kind, test: (row: WorldRow) => row.kind === kind })),
    ],
    sorts: [
      { key: 'appear', label: t('log.sort.appear'), compare: byFirst },
      { key: 'updated', label: t('log.sort.updated'), compare: byLast },
    ],
    glyphs: ['first', 'changed'],
  }
  return spec as unknown as TabSpec<Row>
}

const NONE_KEY = {
  f: ['log.none.f', 'log.none.fHelp'], c: ['log.none.c', 'log.none.cHelp'],
  r: ['log.none.r', 'log.none.rHelp'], w: ['log.none.w', 'log.none.wHelp'],
} as const

/* -------------------------------------------------------------- glyphs */

/** One mark, 12×12, in the tab's colour (currentColor); hollow when only a plan has it. */
function Mark({ glyph, planned = false }: { readonly glyph: Glyph; readonly planned?: boolean }): ReactNode {
  const paint: CSSProperties = planned
    ? { fill: 'var(--log-surface)', stroke: 'currentColor', strokeWidth: 1.3 }
    : { fill: 'currentColor' }
  const line: CSSProperties = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      {glyph === 'planted' && <circle cx="6" cy="6" r="4.5" style={paint} />}
      {glyph === 'advanced' && <path d="M6 1.4 10.6 10H1.4Z" style={{ ...paint, strokeLinejoin: 'round' }} />}
      {glyph === 'hinted' && <circle cx="6" cy="6" r="2.4" style={paint} />}
      {glyph === 'resolved' && <path d="M6 1 11 6 6 11 1 6Z" style={{ ...paint, strokeLinejoin: 'round' }} />}
      {glyph === 'appear' && <circle cx="6" cy="6" r="3.6" style={paint} />}
      {glyph === 'first' && <rect x="2" y="2" width="8" height="8" rx="1.5" style={paint} />}
      {glyph === 'changed' && <>
        <rect x="2" y="2" width="8" height="8" rx="1.5" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }} />
        <path d="M2 10 10 2v6.5Q10 10 8.5 10Z" style={{ fill: 'currentColor' }} />
      </>}
      {glyph === 'start' && <rect x="2.5" y="2.5" width="7" height="7" rx="1" style={paint} />}
      {glyph === 'up' && <path d="M6 1.5v9M2.5 5 6 1.5 9.5 5" style={line} />}
      {glyph === 'deepen' && <circle cx="6" cy="6" r="2" style={paint} />}
      {glyph === 'drift' && <path d="M3 4.5 6 7.5 9 4.5" style={line} />}
      {glyph === 'crack' && <path d="M6 1 4 5 8 7 6 11" style={line} />}
      {glyph === 'break' && <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" style={line} />}
      {glyph === 'fix' && <path d="M2.2 6.2 5 9 9.8 3.2" style={line} />}
      {glyph === 'type' && <path d="M1.5 6h8M6.5 3l3 3-3 3" style={line} />}
      {glyph === 'set' && <path d="M2.5 6h7" style={line} />}
    </svg>
  )
}

const GLYPH_WORD: Readonly<Record<Glyph, Parameters<T>[0]>> = {
  ...MENTION_KEY, appear: 'log.m.appear', first: 'log.m.first', changed: 'log.m.changed',
  start: 'log.m.start', deepen: 'log.m.deepen', drift: 'log.m.drift', up: 'log.m.up', crack: 'log.m.crack',
  break: 'log.m.break', fix: 'log.m.fix', type: 'log.m.typeKey', set: 'log.m.set',
}

/* -------------------------------------------------------------- labels */

const FIELD_KEY = {
  identity: 'log.field.identity', want: 'log.field.want', lack: 'log.field.lack', wound: 'log.field.wound',
  appearance: 'log.field.appearance', voice: 'log.field.voice', knows: 'log.field.knows', unaware: 'log.field.unaware',
  secrets: 'log.field.secrets', now: 'log.field.now', kind: 'log.field.kind', rule: 'log.field.rule',
} as const
const fieldLabel = (t: T, field: string): string => field in FIELD_KEY ? t(FIELD_KEY[field as keyof typeof FIELD_KEY]) : field
const LIST_FIELDS = new Set(['knows', 'unaware', 'secrets'])

function sourceLine(t: T, entry: HistoryEntry): string {
  if (entry.source === 'user') return t('log.src.user', { n: entry.chapter })
  const source = t(entry.source === 'accept' ? 'log.src.accept' : 'log.src.model')
  const head = entry.kind === 'create' ? `${t('log.src.create')} · ${source}` : source
  return entry.evidence === undefined ? head : `${head} · ${t('log.src.evidence', { text: entry.evidence })}`
}

/* --------------------------------------------------------------- state */

/** The `novel:story-log` page entry. */
export function StoryLogPage(props: NovelSurfaceProps<NovelPageOwnerProps>): ReactNode {
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  return <StoryLogRead {...props} />
}

function StoryLogRead(props: NovelSurfaceProps<NovelPageOwnerProps>): ReactNode {
  const { canvasId, rev, remote, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.storyLog({ canvasId }), `story-log:${canvasId}`, rev)
  if (api === undefined) return null
  if (read.state === 'loading') return <div className={css.page}><div className={css.muted}>{t('state.loading')}</div></div>
  if (read.state === 'error') return <div className={css.page}><div className={css.warn}>{t('error.generic', { message: read.message })}</div></div>
  if (!read.value.ok) return <div className={css.page}><div className={css.warn}>{t(errorKey(read.value.error))}</div></div>
  return <StoryLog {...props} api={api} log={read.value} />
}

function StoryLog(props: NovelSurfaceProps<NovelPageOwnerProps> & { readonly api: NovelRemote; readonly log: StoryLogResult }): ReactNode {
  const { canvasId, api, log, navigate, sessionId, param, t } = props
  const model = useMemo(() => storyModel(log, t), [log, t])
  // Opened on a card (the card page's 在故事日志中看): its tab, its row picked, its detail up front when narrow.
  const opened = param === undefined ? undefined : TABS.find(item => model[item].some(row => row.id === param))
  const [tab, setTab] = useState<Tab>(opened ?? 'f')
  const [filters, setFilters] = useState<Record<Tab, string>>({ f: 'open', c: 'all', r: 'all', w: 'all' })
  const [sorts, setSorts] = useState<Record<Tab, string>>({ f: 'plant', c: 'first', r: 'changed', w: 'appear' })
  const [picks, setPicks] = useState<Partial<Record<Tab, string>>>(opened === undefined ? {} : { [opened]: param })
  const [key, setKey] = useState(false)
  const [detail, setDetail] = useState(opened !== undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [width, setWidth] = useState(0)

  const frameRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const revealed = useRef(false)
  /** Each tab's scroll, and the table's when a narrow pick swapped it for the detail; restored on the way back. */
  const parked = useRef<Partial<Record<Tab, number>>>({})
  const parkedDetail = useRef<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (frame === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { setWidth(frame.clientWidth) })
    observer.observe(frame)
    return () => { observer.disconnect() }
  }, [])

  // An unmeasured frame (no layout yet) reads as wide.
  const narrow = width > 0 && width < NARROW_BELOW
  const phone = width > 0 && width < PHONE_BELOW
  const many = model.last > MANY_CHAPTERS
  const cw = many ? (phone ? 30 : 34) : (phone ? 44 : 56)
  const hw = phone ? 148 : narrow ? 260 : many ? 340 : 420

  const spec = tabSpec(model, tab, t)
  const filter = spec.filters.find(item => item.key === filters[tab]) ?? spec.filters[0]!
  const sort = spec.sorts.find(item => item.key === sorts[tab]) ?? spec.sorts[0]!
  const rows = spec.rows.filter(filter.test).sort(sort.compare)
  const picked = spec.rows.find(row => row.id === picks[tab]) ?? rows[0]
  const detailFace = narrow && detail && picked !== undefined
  const empty = spec.rows.length === 0

  // Open with the current chapter in view.
  useEffect(() => {
    const main = mainRef.current
    if (revealed.current || main === null || width === 0) return
    revealed.current = true
    main.scrollLeft = Math.max(0, hw + (model.cur + 2) * cw - main.clientWidth)
  })

  // Back from the narrow detail (or widened out of it): the table where it was left.
  useEffect(() => {
    if (detailFace) return
    const main = mainRef.current
    if (main !== null && parkedDetail.current !== null) {
      main.scrollTop = parkedDetail.current.top
      main.scrollLeft = parkedDetail.current.left
    }
    parkedDetail.current = null
  }, [detailFace])

  // Grab the blank cells to pan; a drag never counts as a click on a row.
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const main = mainRef.current
      const state = drag.current
      if (state === null || main === null) return
      if (Math.abs(event.clientX - state.x) + Math.abs(event.clientY - state.y) > 4) {
        state.moved = true
        main.dataset['dragging'] = 'true'
      }
      if (state.moved) {
        main.scrollLeft = state.left - (event.clientX - state.x)
        main.scrollTop = state.top - (event.clientY - state.y)
      }
    }
    const up = (): void => {
      if (drag.current === null) return
      const moved = drag.current.moved
      delete mainRef.current?.dataset['dragging']
      // The click that ends a drag lands after pointerup; let it be swallowed, then clear.
      if (moved) setTimeout(() => { drag.current = null }, 0)
      else drag.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  const switchTab = (next: Tab): void => {
    const main = mainRef.current
    if (main !== null) parked.current[tab] = main.scrollTop
    setTab(next)
    setDetail(false)
    requestAnimationFrame(() => { if (mainRef.current !== null) mainRef.current.scrollTop = parked.current[next] ?? 0 })
  }
  const pick = (id: string): void => {
    if (drag.current?.moved === true) return
    setPicks({ ...picks, [tab]: id })
    if (narrow) {
      const main = mainRef.current
      parkedDetail.current = main === null ? null : { top: main.scrollTop, left: main.scrollLeft }
      setDetail(true)
      frameRef.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }
  const openChapter = (n: number): void => {
    const chapter = log.chapters.find(row => row.n === n)
    if (chapter !== undefined) navigate.openPage(CHAPTER_PAGE, chapterHeading(t, n, chapter.title), String(n))
  }

  const star = async (cardId: string, starred: boolean): Promise<void> => {
    if (sessionId === undefined) return
    setBusy(true)
    setFailure(null)
    try {
      const result = await api.starForeshadow(sessionId, { canvasId, cardId, starred })
      setFailure(!result.ok ? t('error.generic', { message: result.error.message }) : result.value.ok ? null : t(errorKey(result.value.error)))
      navigate.refresh()
    } finally {
      setBusy(false)
    }
  }

  const tabs = (
    <div className={css.logTabs} role="tablist">
      {TABS.map(item => (
        <button key={item} type="button" role="tab" className={css.logTab} data-tab={item} aria-selected={item === tab} onClick={() => { switchTab(item) }}>
          {t(`log.tab.${item}`)}
          <span className={css.logCount}>{model[item].length}</span>
        </button>
      ))}
    </div>
  )

  const bar = (
    <div className={css.logBar}>
      <div className={css.logPills}>
        {spec.filters.map((item) => {
          const n = spec.rows.filter(item.test).length
          return (
            <button
              key={item.key}
              type="button"
              className={css.logPill}
              aria-pressed={item.key === filter.key}
              data-zero={n === 0 ? 'true' : undefined}
              onClick={() => { setFilters({ ...filters, [tab]: item.key }) }}
            >
              {item.star === true && <span className={css.logStarMark}>★</span>}
              {item.label}
              <span className={css.logCount}>{n}</span>
            </button>
          )
        })}
      </div>
      <span className={css.logRule} />
      <div className={css.logSorts}>
        {spec.sorts.map(item => (
          <button key={item.key} type="button" aria-pressed={item.key === sort.key} onClick={() => { setSorts({ ...sorts, [tab]: item.key }) }}>{item.label}</button>
        ))}
      </div>
      <span className={css.logSpacer} />
      {failure !== null && <span className={css.warn}>{failure}</span>}
      {model.cur > 0 && <span className={css.logAt}>{t('log.writtenTo', { n: model.cur })}</span>}
      <button type="button" className={css.logKeyToggle} aria-expanded={key} onClick={() => { setKey(!key) }}>{t('log.legend')}</button>
    </div>
  )

  const legend = key && (
    <div className={css.logKey}>
      {spec.glyphs.map(glyph => <span key={glyph}><Mark glyph={glyph} />{t(GLYPH_WORD[glyph])}</span>)}
      <span><Mark glyph={spec.glyphs[0]!} planned />{t('log.legend.planned')}</span>
    </div>
  )

  const chapters = Array.from({ length: model.last }, (_, i) => i + 1)
  const grid = (
    <div
      className={css.logGrid}
      style={{ '--log-hw': `${hw}px`, '--log-cw': `${cw}px`, '--log-n': model.last, '--log-cur': model.cur } as CSSProperties}
      data-cur={model.cur > 0 ? 'true' : undefined}
    >
      <div className={css.logHd} data-lab="true">{t('log.chapters')}</div>
      {chapters.map((n) => {
        const chapter = log.chapters.find(row => row.n === n)
        const sub = n === model.cur ? t('log.current') : model.planning.has(n) ? t('log.planned') : null
        const label = <>{n}{sub !== null && <small>{sub}</small>}</>
        return (
          <div key={n} className={css.logHd} data-col="true" data-current={n === model.cur ? 'true' : undefined}>
            {chapter === undefined ? label : (
              <button type="button" title={`${chapterHeading(t, n, chapter.title)} · ${t(`phase.${chapter.phase}`)}`} onClick={() => { openChapter(n) }}>{label}</button>
            )}
          </div>
        )
      })}
      <div className={css.logHd} />
      <div className={css.logGap} />
      {rows.map(row => (
        <div key={row.id} className={css.logRow} aria-selected={row.id === picked?.id} onClick={() => { pick(row.id) }}>
          <div className={css.logLab} data-head="true">
            <span className={css.logRef}>{row.ref}</span>
            <span className={css.logName} title={row.text}>{row.text}</span>
            {row.meta !== '' && <span className={css.logMeta} data-tone={row.bad ? 'bad' : undefined}>{row.meta}</span>}
            {tab === 'f' && <span className={css.logStarMark}>{(row as ForeshadowRow).view.starred ? '★' : ''}</span>}
          </div>
          {chapters.map((n) => {
            const step = cellStep(row.steps.filter(item => item.chapter === n))
            const title = step === undefined ? undefined : `${t('log.chapter', { n })} · ${step.word}${step.planned ? t('log.plannedSuffix') : ''}${step.notes[0] === undefined ? '' : `：${step.notes[0]}`}`
            return <div key={n} className={css.logCell} title={title}>{step !== undefined && <Mark glyph={step.glyph} planned={step.planned} />}</div>
          })}
          <div className={css.logCell} />
        </div>
      ))}
    </div>
  )

  return (
    <div className={css.page}>
      <div
        ref={frameRef}
        className={css.logFrame}
        data-tab={tab}
        data-narrow={narrow ? 'true' : undefined}
        data-phone={phone ? 'true' : undefined}
        data-detail={detailFace ? 'true' : undefined}
      >
        {detailFace ? (
          <nav className={css.logCrumb}>
            <button type="button" onClick={() => { setDetail(false) }}>‹ {t(`log.tab.${tab}`)}</button>
          </nav>
        ) : <>
          {tabs}
          {!empty && bar}
          {!empty && legend}
        </>}
        <div className={css.logBody} data-bare={empty ? 'true' : undefined}>
          <div
            ref={mainRef}
            className={css.logMain}
            onPointerDown={(event) => {
              const target = event.target as Element
              if (event.button !== 0 || target.closest('button, [data-head]') !== null) return
              const main = event.currentTarget
              drag.current = { x: event.clientX, y: event.clientY, left: main.scrollLeft, top: main.scrollTop, moved: false }
            }}
          >
            {empty ? (
              <div className={css.logNone}><b>{t(NONE_KEY[tab][0])}</b>{t(NONE_KEY[tab][1])}</div>
            ) : <>
              {grid}
              {rows.length === 0 && <div className={css.logNone}>{t('log.filtered', { tab: t(`log.tab.${tab}`) })}</div>}
            </>}
          </div>
          {!empty && (!narrow || detailFace) && (
            <aside className={css.logSide}>
              {picked === undefined
                ? <div className={css.muted}>{t('log.pick')}</div>
                : <Detail tab={tab} row={picked} model={model} navigate={navigate} openChapter={openChapter} star={star} busy={busy || sessionId === undefined} t={t} />}
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------- the detail */

function Detail({ tab, row, model, navigate, openChapter, star, busy, t }: {
  readonly tab: Tab
  readonly row: Row
  readonly model: Model
  readonly navigate: NovelNavigate
  readonly openChapter: (n: number) => void
  readonly star: (cardId: string, starred: boolean) => Promise<void>
  readonly busy: boolean
  readonly t: T
}): ReactNode {
  const chip = (text: string, bad = false): ReactNode => <span key={text} className={css.logChip} data-tone={bad ? 'bad' : undefined}>{text}</span>
  const section = (title: string, body: ReactNode): ReactNode => <section className={css.logSec}><h5>{title}</h5>{body}</section>
  const links = (heading: string, chapter?: number): ReactNode => (
    <div className={css.logLinks}>
      <button type="button" onClick={() => { navigate.openCard(row.id, heading) }}>{t('log.open.card')} ›</button>
      {chapter !== undefined && chapter > 0 && <button type="button" onClick={() => { openChapter(chapter) }}>{t('log.open.chapter', { n: chapter })} ›</button>}
    </div>
  )
  const head = (chips: readonly ReactNode[], action?: ReactNode): ReactNode => (
    <div>
      <div className={css.logKicker}><i />{tab === 'f' ? `${t(`log.tab.${tab}`)} · ${row.ref}` : t(`log.tab.${tab}`)}</div>
      <div className={css.logTitle}><h3>{row.text}</h3>{action}</div>
      {chips.length > 0 && <div className={css.logChips}>{chips}</div>}
    </div>
  )

  if (tab === 'f') {
    const { view, closed, sleeping, threshold } = row as ForeshadowRow
    const slept = view.slept ?? 0
    const planted = view.plantedAt ?? row.first
    return (
      <div className={css.logDetail}>
        {head([
          chip(view.state),
          ...planted > 0 ? [chip(t('log.f.plantedAt', { n: planted }))] : [],
          ...closed ? [] : [chip(slept === 0 ? t('log.f.fresh') : t('log.f.sleeping', { n: slept }), sleeping)],
        ], (
          <button
            type="button"
            className={css.logStar}
            aria-pressed={view.starred}
            disabled={busy}
            title={t(view.starred ? 'log.unstar' : 'log.star')}
            onClick={() => { void star(view.cardId, !view.starred) }}
          >
            {view.starred ? '★' : '☆'}
          </button>
        ))}
        {!closed && <div className={css.muted}>{t(view.starred ? 'log.f.starred' : 'log.f.unstarred', { n: threshold })}</div>}
        {view.state === '已揭晓' && view.answer !== undefined && section(t('log.f.answer'), <div>{view.answer}</div>)}
        {section(t('log.f.track'), (
          <>
            <Track steps={row.steps} t={t} />
            {!closed && model.cur > 0 && <div className={css.muted}>{sleeping ? t('log.f.tailSleeping', { n: slept, cur: model.cur }) : t('log.f.tailOpen', { cur: model.cur })}</div>}
          </>
        ))}
        {links(`${view.ref} ${view.question}`, planted)}
      </div>
    )
  }

  if (tab === 'r') {
    const { view, types } = row as RelationRow
    return (
      <div className={css.logDetail}>
        {head([
          chip(types.join(' → ')),
          chip(view.stage, view.rift !== undefined),
          ...view.ready ? [chip(t('log.r.ready'))] : [],
        ])}
        {view.now !== undefined && <p className={css.logLead}>{view.now}</p>}
        {section(t('log.r.stage'), <RelationNow view={view} t={t} />)}
        {view.views.length > 0 && section(t('log.r.views'), <div className={css.logViews}>{view.views.map(line => <div key={line}>{line}</div>)}</div>)}
        {section(t('log.r.track'), row.steps.length === 0 ? <div className={css.muted}>{t('log.r.noJournal')}</div> : <Track steps={row.steps} t={t} />)}
        {links(view.name)}
      </div>
    )
  }

  if (tab === 'c') {
    const { card } = row as CharacterRow
    const updates = card.history.filter(entry => entry.kind === 'change')
    return (
      <div className={css.logDetail}>
        {head([chip(row.meta), ...updates.length > 0 ? [chip(t('log.c.updates', { n: updates.length }))] : []])}
        <CardNow card={card} fields={PLOT_FIELDS.character ?? []} relations={model.r.filter(item => item.view.pair.includes(card.cardId))} t={t} />
        {section(t('log.c.track'), row.steps.length === 0 ? <div className={css.muted}>{t('log.c.noTrack')}</div> : <Track steps={row.steps} t={t} />)}
        {updates.length > 0 && section(t('log.c.changes'), (
          <div className={css.logTrack}>
            {updates.map((entry, i) => (
              <div key={i} className={css.logStep}>
                <span className={css.logStepChapter}>{t('log.chapter', { n: entry.chapter })}</span>
                <span className={css.logStepGlyph}><Mark glyph="changed" /></span>
                <span className={css.logStepText}><ChangeLines entry={entry} t={t} /></span>
              </div>
            ))}
          </div>
        ))}
        {links(card.name, row.steps.find(step => !step.planned)?.chapter)}
      </div>
    )
  }

  const { card, kind } = row as WorldRow
  const updates = row.steps.filter(step => step.glyph === 'changed').length
  return (
    <div className={css.logDetail}>
      {head([
        ...kind === '' ? [] : [chip(kind)],
        ...row.first > 0 ? [chip(t('log.w.firstAt', { n: row.first }))] : [],
        ...updates > 0 ? [chip(t('log.w.updates', { n: updates }))] : [],
      ])}
      <CardNow card={card} fields={(PLOT_FIELDS.world ?? []).filter(field => field !== 'kind')} relations={[]} t={t} />
      {section(t('log.w.track'), row.steps.length === 0 ? <div className={css.muted}>{t('log.w.noTrack')}</div> : <Track steps={row.steps} t={t} />)}
      {links(card.name, row.first)}
    </div>
  )
}

/**
 * A row's steps: 第 N 章 | mark | [计划] word, then its notes, card changes and
 * 原文. A wordless step leads with its first note instead — or, written but
 * with nothing gathered, says so quietly.
 */
function Track({ steps, t }: { readonly steps: readonly Step[]; readonly t: T }): ReactNode {
  return (
    <div className={css.logTrack}>
      {steps.map((step, i) => {
        const [first, ...rest] = step.notes
        const lead = step.wordless !== true ? <b>{step.word}</b>
          : first !== undefined ? first
            : step.planned ? step.word : <span className={css.logQuiet}>{t('log.c.noExperience')}</span>
        const notes = step.wordless === true ? rest : step.notes
        return (
          <div key={i} className={css.logStep}>
            <span className={css.logStepChapter}>{t('log.chapter', { n: step.chapter })}</span>
            <span className={css.logStepGlyph}><Mark glyph={step.glyph} planned={step.planned} /></span>
            <span className={css.logStepText}>
              <span>{step.planned && <span className={css.logTag}>{t('log.planned')}</span>}{lead}</span>
              {notes.map(note => <span key={note} className={css.logNote}>{note}</span>)}
            {step.evidence !== undefined && <span className={css.logNote}>{t('log.src.evidence', { text: step.evidence })}</span>}
              {step.changes.map((entry, j) => <ChangeLines key={j} entry={entry} t={t} />)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function RelationNow({ view, t }: { readonly view: StoryRelation; readonly t: T }): ReactNode {
  const ladder = RELATION_LADDERS[view.type]
  const level = view.level ?? 0
  const rift = view.rift !== undefined
  const next = nextMilestoneOf(view)
  const hint = rift ? t('log.r.hintRift', { stage: view.stage })
    : next === undefined ? t('log.r.hintTop')
      : view.ready
        ? t('log.r.hintReady', { stage: view.stage, milestone: next.milestone, next: next.stage })
        : t('log.r.hintWait', { stage: view.stage, points: view.progress, full: PTS_PER_LEVEL, next: next.stage })
  return (
    <>
      <div className={css.logStairs} data-rift={rift ? 'true' : undefined}>
        {ladder.map((step, i) => {
          const at = i + 1
          const state = rift ? (at <= level ? 'got' : undefined)
            : at === level ? 'now' : at < level ? 'got' : at === level + 1 ? 'next' : undefined
          const fill = state === 'now' ? { background: `linear-gradient(to top, currentColor ${(view.progress / PTS_PER_LEVEL) * 100}%, transparent 0)` } : {}
          return (
            <div key={step.stage} data-state={state}>
              <i style={{ height: 8 + i * 8, ...fill }} />
              {step.stage}
            </div>
          )
        })}
      </div>
      <ol className={css.logLadder}>
        {ladder.map((step, i) => (
          <li key={step.stage} data-current={!rift && i + 1 === level ? 'true' : undefined}><b>{step.stage}</b><span>{step.milestone}</span></li>
        ))}
      </ol>
      <div className={css.muted}>{hint}</div>
    </>
  )
}

/** Where each value came from: the newest change that set it (a value from before the history has none). */
function originsOf(history: readonly HistoryEntry[]): Map<string, HistoryEntry> {
  const origins = new Map<string, HistoryEntry>()
  for (const entry of history) {
    if (entry.kind !== 'change') continue
    for (const change of entry.changes) {
      if (change.op === '−') continue
      origins.set(LIST_FIELDS.has(change.field) ? `${change.field}\n${change.value}` : change.field, entry)
    }
  }
  return origins
}

function CardNow({ card, fields, relations, t }: {
  readonly card: StoryCard
  readonly fields: readonly string[]
  readonly relations: readonly RelationRow[]
  readonly t: T
}): ReactNode {
  const origins = originsOf(card.history)
  const from = (key: string): ReactNode => {
    const entry = origins.get(key)
    if (entry === undefined) return null
    return <small>{entry.source === 'user' ? t('log.from.user', { n: entry.chapter }) : t('log.chapter', { n: entry.chapter })}</small>
  }
  const rows = fields.filter(field => (card.plot[field] ?? '') !== '')
  if (rows.length === 0 && relations.length === 0) return <div className={css.muted}>{t('log.card.empty')}</div>
  return (
    <dl className={css.logCard}>
      {rows.map(field => (
        <div key={field}>
          <dt>{fieldLabel(t, field)}</dt>
          <dd>
            {LIST_FIELDS.has(field)
              ? card.plot[field]!.split('\n').map(line => <span key={line}>{line}{from(`${field}\n${line}`)}</span>)
              : <>{card.plot[field]}{from(field)}</>}
          </dd>
        </div>
      ))}
      {relations.length > 0 && (
        <div>
          <dt>{t('log.field.relations')}</dt>
          <dd>
            {relations.map(({ view }) => {
              const other = view.pair.map((id, i) => [id, view.names[i]] as const).find(([id]) => id !== card.cardId)?.[1] ?? view.name
              return <span key={view.cardId}>{`${other} · ${view.type} · ${view.stage}`}</span>
            })}
          </dd>
        </div>
      )}
    </dl>
  )
}

function ChangeLines({ entry, t }: { readonly entry: HistoryEntry; readonly t: T }): ReactNode {
  const line = (change: HistoryChange, i: number): ReactNode => (
    <div key={i}>
      <span className={css.logField}>{fieldLabel(t, change.field)}</span>
      {change.op === '→' && <><del>{change.from}</del> → {change.value}</>}
      {change.op === '+' && <>＋ {change.value}</>}
      {change.op === '−' && <>－ <del>{change.value}</del></>}
    </div>
  )
  return (
    <div className={css.logChanges}>
      {entry.changes.map(line)}
      <span className={css.logSource}>{sourceLine(t, entry)}</span>
    </div>
  )
}
