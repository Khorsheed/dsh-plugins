/**
 * The 故事日志 page: the book's chapters as columns, and four bands of rows
 * over them —
 *
 * - 伏笔: one row per foreshadow, a mark per chapter that planted / advanced /
 *   hinted / resolved it (hollow when only a plan has it), the line between
 *   marks dashed red where it slept past its threshold; the row head carries
 *   the user's ★;
 * - 关系: one row per pair, a step line at the pair's level (the banked points
 *   lift it a little; 裂痕 and 决裂 sit below the four levels);
 * - 人物: the chapters a character is in (POV ringed) and the chapters their
 *   card changed (a corner badge, hollow when the person edited the canvas);
 * - 世界: the chapter a setting first appeared and each chapter that added a rule.
 *
 * A row opens the side panel: where it stands now (现状), and how it got there
 * (变化过程). The table is a bounded scroll box (the horizontal bar stays on
 * screen however many rows), pans by dragging its blank lanes, and a minimap
 * above it jumps to any stretch of the book; 全书 squeezes every chapter into
 * one screen.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  isOverdue, NOVEL_GENRE_ID, nextMilestoneOf, PLOT_FIELDS, PTS_PER_LEVEL, RELATION_LADDERS, SLEEP_THRESHOLD,
  type HistoryChange, type HistoryEntry, type MentionEntry, type RelationEntry,
  type StoryAppearance, type StoryCard, type StoryCharacter, type StoryForeshadow, type StoryLogResult, type StoryRelation,
} from '../types.ts'
import type { NovelNavigate, NovelPageOwnerProps, NovelRemote, NovelSurfaceProps } from './contract.ts'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './novel.module.css'

type T = TranslateNS<'novel'>

/* ------------------------------------------------------------ geometry */

/** A column's width in the detail zoom; 全书 squeezes it down to {@link MIN_CW}. */
const CW_DETAIL = 30
const MIN_CW = 8
/** Below this width the marks shrink and the 「n 章未动」 labels hide. */
const FIT_BELOW = 20
/** The row head's width: wide frame, narrow frame. */
const HW_WIDE = 236
const HW_NARROW = 150
/** A short book leaves the lanes room to spare: the row heads grow to these, then the columns to {@link CW_ROOMY}. */
const HW_WIDE_MAX = 480
const HW_NARROW_MAX = 360
const CW_ROOMY = 64
/** The frame narrower than this opens the side panel as a drawer over the table. */
const NARROW_BELOW = 860
/** The relation lane's height; the four levels 12px apart from the bottom, the rifts below them. */
const REL_LANE = 74

const INK = 'var(--dsw-alias-label-primary)'
const INK2 = 'var(--dsw-alias-label-secondary)'
const RULE = 'var(--dsw-alias-border-l2)'
const SURFACE = 'var(--dsw-alias-bg-base)'
const RED = 'var(--dsw-alias-state-error-primary)'
const ACCENT = 'var(--dsw-alias-brand-primary)'
const LINE = 'var(--dsw-alias-border-l1)'

/** A pair's height on the ladder: a level 1–4, or one of the two rifts. */
type Level = number | 'crack' | 'break'
const LEVEL_Y = (level: Level): number => level === 'crack' ? 62 : level === 'break' ? 68 : 62 - level * 12
/** Within a level the banked points lift the line (a full bar 9px, still under the next level's guide). */
const REL_Y = (level: Level, progress: number): number => LEVEL_Y(level) - (typeof level === 'number' ? progress * 3 : 0)
const isRift = (level: Level): boolean => level === 'crack' || level === 'break'

/* --------------------------------------------------------------- model */

interface ForeshadowRow {
  readonly view: StoryForeshadow
  readonly marks: StoryForeshadow['marks']
  readonly threshold: number
  /** 已揭晓 or 已放弃: no trailing line, no sleep. */
  readonly closed: boolean
  readonly sleeping: boolean
  /** The chapter that resolved it in the text. */
  readonly resolvedAt?: number
  /** The first chapter it shows up in (the 按埋下 order). */
  readonly first: number
}

interface RelationStep {
  readonly chapter: number
  readonly level: Level
  readonly progress: number
}

/** One line of a pair's 变化过程, with the bar as it stood after it. */
interface RelationLogItem {
  readonly entry: RelationEntry
  readonly level: Level
  readonly progress: number
  /** The pair's type after the entry. */
  readonly type: StoryRelation['type']
}

interface RelationRow {
  readonly view: StoryRelation
  /** The step line: one state per chapter the journal touched. */
  readonly steps: readonly RelationStep[]
  readonly log: readonly RelationLogItem[]
  /** Every type the pair has had, oldest first (`同盟 → 对手`). */
  readonly types: readonly StoryRelation['type'][]
}

interface CastChapter {
  readonly chapter: number
  readonly at?: StoryAppearance
  readonly changes: readonly HistoryEntry[]
}

interface Model {
  readonly log: StoryLogResult
  /** The newest reconciled chapter (0 when none is). */
  readonly cur: number
  readonly last: number
  readonly planning: ReadonlySet<number>
  readonly foreshadows: readonly ForeshadowRow[]
  readonly relations: readonly RelationRow[]
  /** Foreshadow marks per chapter (the minimap's bars). */
  readonly load: ReadonlyMap<number, number>
}

function foreshadowRow(view: StoryForeshadow): ForeshadowRow {
  const marks = view.marks.length > 0 || view.plantedAt === undefined
    ? view.marks
    : [{ chapter: view.plantedAt, kind: 'planted' as const, planned: false }]
  const closed = view.state === '已揭晓' || view.state === '已放弃'
  const resolvedAt = marks.find(mark => mark.kind === 'resolved' && !mark.planned)?.chapter
  return {
    view, marks, closed, first: marks[0]?.chapter ?? view.plantedAt ?? Number.POSITIVE_INFINITY,
    threshold: view.starred ? SLEEP_THRESHOLD.starred : SLEEP_THRESHOLD.normal,
    sleeping: !closed && isOverdue(view),
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
  }
}

function levelOfView(view: StoryRelation): Level {
  return view.rift === '决裂' ? 'break' : view.rift === '裂痕' ? 'crack' : view.level ?? 1
}

/**
 * Replay a pair's journal: points bank inside 0…{@link PTS_PER_LEVEL} on a
 * numbered level, any stage event empties the bar; a chapter with several
 * entries keeps its last state on the step line.
 */
function relationRow(view: StoryRelation): RelationRow {
  const firstType = view.journal.find(entry => entry.kind === 'stage' && entry.event === 'type')
  let type: StoryRelation['type'] = (firstType?.kind === 'stage' ? firstType.fromType : undefined) ?? view.type
  const types = [type]
  const first = view.journal[0]
  let level: Level = first?.kind === 'stage' ? first.level ?? levelOfView(view) : levelOfView(view)
  let progress = 0
  const steps: RelationStep[] = []
  const log: RelationLogItem[] = []
  for (const entry of view.journal) {
    if (entry.kind === 'stage') {
      level = entry.level ?? (entry.stage === '决裂' ? 'break' : entry.stage === '裂痕' ? 'crack' : level)
      progress = 0
      if (entry.event === 'type' && entry.toType !== undefined && entry.toType !== type) {
        type = entry.toType
        types.push(type)
      }
    } else if (typeof level === 'number') {
      progress = Math.min(PTS_PER_LEVEL, Math.max(0, progress + entry.delta))
    }
    log.push({ entry, level, progress, type })
    const previous = steps[steps.length - 1]
    if (previous?.chapter === entry.chapter) steps[steps.length - 1] = { chapter: entry.chapter, level, progress }
    else steps.push({ chapter: entry.chapter, level, progress })
  }
  return { view, steps, log, types }
}

function storyModel(log: StoryLogResult): Model {
  const settled = log.chapters.filter(row => row.phase === 'extracted' || row.phase === 'reviewed').map(row => row.n)
  const cur = Math.max(0, ...settled)
  const foreshadows = log.foreshadows.map(foreshadowRow)
  const relations = log.relations.map(relationRow)
  const load = new Map<number, number>()
  for (const row of foreshadows) for (const mark of row.marks) load.set(mark.chapter, (load.get(mark.chapter) ?? 0) + 1)
  const last = Math.max(
    1, cur, ...log.chapters.map(row => row.n), ...load.keys(),
    ...log.relations.flatMap(view => view.journal.map(entry => entry.chapter)),
    ...log.characters.flatMap(card => [...card.appearances.map(at => at.chapter), ...card.history.map(entry => entry.chapter)]),
    ...log.world.flatMap(card => card.history.map(entry => entry.chapter)),
  )
  const planning = new Set(log.chapters.filter(row => row.phase === 'planning' || row.phase === 'writing').map(row => row.n))
  return { log, cur, last, planning, foreshadows, relations, load }
}

function castChapters(card: StoryCharacter): CastChapter[] {
  const chapters = [...new Set([...card.appearances.map(at => at.chapter), ...card.history.map(entry => entry.chapter)])].sort((a, b) => a - b)
  return chapters.map((chapter) => {
    const at = card.appearances.find(item => item.chapter === chapter)
    return { chapter, ...(at === undefined ? {} : { at }), changes: card.history.filter(entry => entry.chapter === chapter) }
  })
}

const allByUser = (entries: readonly HistoryEntry[]): boolean => entries.length > 0 && entries.every(entry => entry.source === 'user')

/* -------------------------------------------------------------- glyphs */

const MENTION_KEY = {
  planted: 'pending.mention.planted', advanced: 'pending.mention.advanced',
  hinted: 'pending.mention.hinted', resolved: 'pending.mention.resolved',
} as const

function Svg({ children }: { readonly children: ReactNode }): ReactNode {
  return <svg viewBox="0 0 14 14" aria-hidden="true">{children}</svg>
}

function MentionGlyph({ kind, planned }: { readonly kind: MentionEntry['kind']; readonly planned: boolean }): ReactNode {
  const style: CSSProperties = { stroke: INK, strokeWidth: 1.6, fill: planned ? SURFACE : INK, strokeLinejoin: 'round' }
  return (
    <Svg>
      {kind === 'planted' && <circle cx="7" cy="7" r="5" style={style} />}
      {kind === 'advanced' && <path d="M7 1.8 12.4 11.6H1.6Z" style={style} />}
      {kind === 'hinted' && <circle cx="7" cy="7" r="2.6" style={style} />}
      {kind === 'resolved' && <path d="M7 1 13 7 7 13 1 7Z" style={style} />}
    </Svg>
  )
}

/** The card-changed badge: solid when the story moved it, hollow when the person edited the canvas. */
function Badge({ user, alone }: { readonly user: boolean; readonly alone: boolean }): ReactNode {
  const style: CSSProperties = { stroke: INK, strokeWidth: alone ? 1.4 : 1.2, fill: user ? SURFACE : INK }
  return alone
    ? <rect x="4.5" y="4.5" width="5" height="5" style={style} />
    : <rect x="9.6" y="-.6" width="4.4" height="4.4" style={style} />
}

function CastGlyph({ at, changes }: { readonly at: StoryAppearance | undefined; readonly changes: readonly HistoryEntry[] }): ReactNode {
  const badge = changes.length === 0 ? null : <Badge user={allByUser(changes)} alone={at === undefined} />
  if (at === undefined) return <Svg>{badge}</Svg>
  const fill = at.planned ? SURFACE : INK2
  return (
    <Svg>
      {at.pov
        ? <>
          <circle cx="7" cy="7" r="5.2" style={{ stroke: INK2, strokeWidth: 1.6, fill: SURFACE }} />
          <circle cx="7" cy="7" r="2.6" style={{ stroke: INK2, fill: at.planned ? 'none' : INK2 }} />
        </>
        : <circle cx="7" cy="7" r="3.4" style={{ stroke: INK2, strokeWidth: 1.6, fill }} />}
      {badge}
    </Svg>
  )
}

function RelationGlyph({ event }: { readonly event: Extract<RelationEntry, { kind: 'stage' }>['event'] }): ReactNode {
  if (event === 'break') return <Svg><path d="M3 3 11 11M11 3 3 11" style={{ stroke: RED, strokeWidth: 2, strokeLinecap: 'round', fill: 'none' }} /></Svg>
  if (event === 'crack') {
    return (
      <Svg>
        <circle cx="7" cy="7" r="4.2" style={{ stroke: RED, strokeWidth: 1.5, fill: SURFACE }} />
        <path d="M4 10 10 4" style={{ stroke: RED, strokeWidth: 1.5 }} />
      </Svg>
    )
  }
  if (event === 'fix') {
    return (
      <Svg>
        <circle cx="7" cy="7" r="4.2" style={{ stroke: INK, strokeWidth: 1.5, fill: SURFACE }} />
        <circle cx="7" cy="7" r="1.8" style={{ fill: INK }} />
      </Svg>
    )
  }
  // A hand-set stage: a flat bar, neither up nor down.
  if (event === 'set') return <Svg><path d="M3 7h8" style={{ stroke: INK, strokeWidth: 1.8, strokeLinecap: 'round', fill: 'none' }} /></Svg>
  // start / up / type: an arrow up, clear of the foreshadow's diamond and triangle.
  return <Svg><path d="M7 12V3M3.2 6.6 7 2.8l3.8 3.8" style={{ stroke: INK, strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }} /></Svg>
}

function PointsGlyph({ delta }: { readonly delta: number }): ReactNode {
  const color = delta < 0 ? RED : INK2
  return <Svg><circle cx="7" cy="7" r={Math.abs(delta) >= 2 ? 3.4 : 2.4} style={{ stroke: color, strokeWidth: 1.3, fill: delta < 0 ? SURFACE : color }} /></Svg>
}

function WorldGlyph({ first }: { readonly first: boolean }): ReactNode {
  return <Svg><rect x="2.5" y="2.5" width="9" height="9" rx="1.5" style={{ stroke: INK2, strokeWidth: 1.6, fill: first ? SURFACE : INK2 }} /></Svg>
}

/* -------------------------------------------------------------- labels */

const FIELD_KEY = {
  identity: 'log.field.identity', want: 'log.field.want', lack: 'log.field.lack', wound: 'log.field.wound',
  appearance: 'log.field.appearance', voice: 'log.field.voice', knows: 'log.field.knows', unaware: 'log.field.unaware',
  secrets: 'log.field.secrets', now: 'log.field.now', kind: 'log.field.kind', rule: 'log.field.rule',
} as const
const fieldLabel = (t: T, field: string): string => field in FIELD_KEY ? t(FIELD_KEY[field as keyof typeof FIELD_KEY]) : field
const LIST_FIELDS = new Set(['knows', 'unaware', 'secrets'])

function stageLabel(t: T, item: RelationLogItem): string {
  const { entry } = item
  if (entry.kind === 'points') return ''
  if (entry.event === 'crack') return t('log.rel.crack')
  if (entry.event === 'break') return t('log.rel.break')
  if (entry.event === 'fix') return t('log.rel.fix', { stage: entry.stage })
  return entry.stage
}

/** A pair's 变化过程 line: 建卡 · 接触 / 升到托底 / 裂痕 / 转为对手 / 改成托底…. */
function journalLabel(t: T, item: RelationLogItem): string {
  const { entry } = item
  if (entry.kind === 'points') return `${entry.delta > 0 ? '+' : ''}${entry.delta}`
  switch (entry.event) {
    case 'start': return t('log.rel.start', { stage: entry.stage })
    case 'up': return t('log.rel.up', { stage: entry.stage })
    case 'crack': return t('log.rel.crack')
    case 'break': return t('log.rel.break')
    case 'fix': return t('log.rel.fix', { stage: entry.stage })
    case 'type': return t('log.rel.type', { type: entry.toType ?? item.type, stage: entry.stage })
    case 'set': return t('log.rel.set', { stage: entry.stage })
  }
}

function sourceLine(t: T, entry: HistoryEntry): string {
  if (entry.source === 'user') return t('log.src.user', { n: entry.chapter })
  const source = t(entry.source === 'accept' ? 'log.src.accept' : 'log.src.model')
  const head = entry.kind === 'create' ? `${t('log.src.create')} · ${source}` : source
  return entry.evidence === undefined ? head : `${head} · ${t('log.src.evidence', { text: entry.evidence })}`
}

/* --------------------------------------------------------------- state */

type RowKind = 'f' | 'r' | 'c' | 'w'
interface Selection {
  readonly kind: RowKind
  readonly id: string
  /** The chapter of the mark that was clicked (its line is lit in 变化过程). */
  readonly chapter?: number
}
type Filter = 'open' | 'star' | 'all'
type Sort = 'plant' | 'idle'
type Zoom = 'detail' | 'fit'
type Tab = 'now' | 'log'

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
  const { canvasId, api, log, navigate, sessionId, t } = props
  const model = useMemo(() => storyModel(log), [log])
  const [filter, setFilter] = useState<Filter>('open')
  const [sort, setSort] = useState<Sort>('plant')
  const [zoom, setZoom] = useState<Zoom>('detail')
  const [tab, setTab] = useState<Tab>('now')
  const [open, setOpen] = useState({ r: true, c: true, w: false })
  const [selection, setSelection] = useState<Selection | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [size, setSize] = useState({ frame: 0, matrix: 0 })

  const frameRef = useRef<HTMLDivElement>(null)
  const matrixRef = useRef<HTMLDivElement>(null)
  const windowRef = useRef<HTMLElement>(null)
  const scrolled = useRef(false)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (frame === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      setSize({ frame: frame.clientWidth, matrix: matrixRef.current?.clientWidth ?? 0 })
    })
    // The table's own width moves too when the side panel leaves the row (narrow) or comes back.
    observer.observe(frame)
    if (matrixRef.current !== null) observer.observe(matrixRef.current)
    return () => { observer.disconnect() }
  }, [])

  // An unmeasured frame (no layout yet) reads as wide.
  const narrow = size.frame > 0 && size.frame < NARROW_BELOW
  const base = narrow ? HW_NARROW : HW_WIDE
  const room = size.matrix - base - 12
  // Every chapter fits at the detail width: no zoom, no minimap, and the spare width goes to the names first.
  const fits = size.matrix > 0 && room >= model.last * CW_DETAIL
  const hw = fits ? base + Math.min(room - model.last * CW_DETAIL, (narrow ? HW_NARROW_MAX : HW_WIDE_MAX) - base) : base
  const cw = fits ? Math.min(CW_ROOMY, Math.floor((size.matrix - hw - 12) / model.last))
    : zoom === 'fit' && size.matrix > 0 ? Math.max(MIN_CW, Math.floor(room / model.last))
      : CW_DETAIL
  const fit = cw < FIT_BELOW
  const X = (n: number): number => (n - 1) * cw + cw / 2
  const laneWidth = model.last * cw + 6

  const syncWindow = (): void => {
    const matrix = matrixRef.current
    const frame = windowRef.current
    if (matrix === null || frame === null) return
    const from = matrix.scrollLeft / cw
    const span = Math.min(model.last, Math.max(0, matrix.clientWidth - hw) / cw)
    frame.style.left = `${(from / model.last) * 100}%`
    frame.style.width = `${(span / model.last) * 100}%`
  }
  const scrollToChapter = (n: number): void => {
    const matrix = matrixRef.current
    if (matrix !== null) matrix.scrollLeft = n * cw - (matrix.clientWidth - hw) / 2
  }

  // Open with the current chapter in view; keep the minimap's frame on what the table shows.
  useEffect(() => {
    if (!scrolled.current && size.matrix > 0) {
      scrolled.current = true
      scrollToChapter(model.cur > 0 ? model.cur : model.last)
    }
    syncWindow()
  })

  // Grab the blank lanes to pan; a drag never counts as a click on a row.
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const matrix = matrixRef.current
      const state = drag.current
      if (state === null || matrix === null) return
      if (Math.abs(event.clientX - state.x) > 4) {
        state.moved = true
        matrix.dataset['dragging'] = 'true'
      }
      if (state.moved) matrix.scrollLeft = state.left - (event.clientX - state.x)
    }
    const up = (): void => {
      if (drag.current === null) return
      const moved = drag.current.moved
      drag.current = moved ? { x: 0, left: 0, moved: true } : null
      delete matrixRef.current?.dataset['dragging']
      // The click that ends a drag lands after pointerup; let it be swallowed, then clear.
      if (moved) setTimeout(() => { drag.current = null }, 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  const scrubbing = useRef(false)
  const scrubTo = (event: React.PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width > 0) scrollToChapter(((event.clientX - box.left) / box.width) * model.last)
  }

  /* rows */
  let foreshadows = model.foreshadows
  if (filter === 'open') foreshadows = foreshadows.filter(row => !row.closed)
  if (filter === 'star') foreshadows = foreshadows.filter(row => row.view.starred)
  foreshadows = [...foreshadows].sort(sort === 'idle'
    ? (a, b) => (b.closed ? -1 : b.view.slept ?? 0) - (a.closed ? -1 : a.view.slept ?? 0) || Number(b.view.starred) - Number(a.view.starred)
    : (a, b) => a.first - b.first)

  const visible = (pick: Selection | null): boolean => pick !== null && (
    pick.kind === 'f' ? foreshadows.some(row => row.view.cardId === pick.id)
      : pick.kind === 'r' ? model.relations.some(row => row.view.cardId === pick.id)
        : pick.kind === 'c' ? log.characters.some(card => card.cardId === pick.id)
          : log.world.some(card => card.cardId === pick.id))
  const fallback = (): Selection | null => {
    const first = foreshadows[0]?.view.cardId
    if (first !== undefined) return { kind: 'f', id: first }
    const relation = model.relations[0]?.view.cardId
    if (relation !== undefined) return { kind: 'r', id: relation }
    const character = log.characters[0]?.cardId
    if (character !== undefined) return { kind: 'c', id: character }
    const world = log.world[0]?.cardId
    return world === undefined ? null : { kind: 'w', id: world }
  }
  const selected = visible(selection) ? selection : fallback()
  const isSelected = (kind: RowKind, id: string): boolean => selected?.kind === kind && selected.id === id
  const pick = (next: Selection, mark: boolean): void => {
    if (drag.current?.moved === true) return
    setSelection(next)
    setDrawer(true)
    if (mark && next.kind !== 'f') setTab('log')
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
  const starButton = (row: ForeshadowRow): ReactNode => (
    <button
      type="button"
      className={css.logStar}
      aria-pressed={row.view.starred}
      disabled={busy || sessionId === undefined}
      title={t(row.view.starred ? 'log.unstar' : 'log.star')}
      onClick={(event) => { event.stopPropagation(); void star(row.view.cardId, !row.view.starred) }}
    >
      {row.view.starred ? '★' : '☆'}
    </button>
  )

  /* lanes */
  const laneBackground = (
    <>
      {Array.from({ length: Math.floor(model.last / 5) }, (_, i) => (i + 1) * 5).map(n => <i key={`g${n}`} className={css.logGridline} style={{ left: n * cw - 1 }} />)}
      {model.cur > 0 && <i className={css.logShade} style={{ left: (model.cur - 1) * cw, width: cw }} />}
      {[...model.planning].map(n => <i key={`p${n}`} className={css.logShade} data-plan="true" style={{ left: (n - 1) * cw, width: cw }} />)}
    </>
  )
  const lane = (children: ReactNode, className?: string): ReactNode => (
    <div className={className ?? css.logLane} style={{ width: laneWidth }}>{laneBackground}{children}</div>
  )
  const band = (label: string, count: string, toggle?: keyof typeof open): ReactNode => (
    <div className={css.logBand}>
      <div className={css.logHead}>
        {label}
        <span className={css.logCount}>{count}</span>
        {toggle !== undefined && (
          <button type="button" className={css.logBandToggle} onClick={() => { setOpen({ ...open, [toggle]: !open[toggle] }) }}>
            {t(open[toggle] ? 'log.collapse' : 'log.expand')}
          </button>
        )}
      </div>
      {lane(null)}
    </div>
  )
  const mark = (key: string, chapter: number, title: string, glyph: ReactNode, onClick: () => void, extra?: { top?: number; on?: boolean }): ReactNode => (
    <button
      key={key}
      type="button"
      className={css.logMark}
      data-on={extra?.on === true ? 'true' : undefined}
      style={{ left: X(chapter), ...(extra?.top === undefined ? {} : { top: extra.top }) }}
      title={title}
      aria-label={title}
      onClick={(event) => { event.stopPropagation(); onClick() }}
    >
      {glyph}
    </button>
  )

  const foreshadowLane = (row: ForeshadowRow): ReactNode => {
    const { marks, threshold } = row
    const parts: ReactNode[] = []
    for (let i = 0; i < marks.length - 1; i++) {
      const a = marks[i]!
      const b = marks[i + 1]!
      if (b.chapter === a.chapter) continue
      const kind = b.planned ? 'plan' : b.chapter - a.chapter >= threshold ? 'sleep' : undefined
      parts.push(<i key={`s${i}`} className={css.logSegment} data-kind={kind} style={{ left: X(a.chapter), width: X(b.chapter) - X(a.chapter) }} />)
      if (!b.planned && kind === 'sleep' && !fit) {
        parts.push(<span key={`z${i}`} className={css.logIdle} style={{ left: (X(a.chapter) + X(b.chapter)) / 2 }}>{t('log.idle', { n: b.chapter - a.chapter })}</span>)
      }
    }
    const done = marks.filter(item => !item.planned)
    const lastDone = done[done.length - 1]?.chapter
    if (!row.closed && lastDone !== undefined && model.cur > lastDone && !marks.some(item => item.chapter > lastDone && item.chapter <= model.cur)) {
      parts.push(<i key="tail" className={css.logSegment} data-kind={row.sleeping ? 'sleep' : undefined} style={{ left: X(lastDone), width: X(model.cur) - X(lastDone) }} />)
      if (row.sleeping && !fit) {
        parts.push(<span key="ztail" className={css.logIdle} style={{ left: (X(lastDone) + X(model.cur)) / 2 }}>{t('log.idle', { n: row.view.slept ?? model.cur - lastDone })}</span>)
      }
    }
    marks.forEach((item, i) => {
      const kind = t(MENTION_KEY[item.kind])
      const title = `${t('log.chapter', { n: item.chapter })} · ${kind}${item.planned ? t('log.plannedSuffix') : ''}${item.note === undefined ? '' : `：${item.note}`}`
      const on = selected?.kind === 'f' && selected.id === row.view.cardId && selected.chapter === item.chapter
      parts.push(mark(`m${i}`, item.chapter, title, <MentionGlyph kind={item.kind} planned={item.planned} />, () => { pick({ kind: 'f', id: row.view.cardId, chapter: item.chapter }, true) }, { on }))
    })
    return lane(parts)
  }

  const foreshadowStatus = (row: ForeshadowRow): ReactNode => row.resolvedAt !== undefined
    ? <span className={css.logStatus}>{t('log.f.resolvedAt', { n: row.resolvedAt })}</span>
    : row.sleeping ? <span className={css.logStatus} data-tone="bad">{t('log.f.sleeping', { n: row.view.slept ?? 0 })}</span>
      : row.view.state === '已放弃' ? <span className={css.logStatus}>{row.view.state}</span> : null

  const relationLane = (row: RelationRow): ReactNode => {
    const lines: ReactNode[] = []
    row.steps.forEach((step, i) => {
      const next = row.steps[i + 1]
      const x1 = X(step.chapter)
      const x2 = next === undefined ? X(Math.max(model.cur, step.chapter)) : X(next.chapter)
      const y = REL_Y(step.level, step.progress)
      const bad = isRift(step.level)
      if (x2 > x1) {
        lines.push(<line key={`h${i}`} x1={x1} y1={y} x2={x2} y2={y} style={{ stroke: bad ? RED : INK2, strokeOpacity: bad ? 0.6 : 1, strokeWidth: 2, ...(bad ? { strokeDasharray: '4 3' } : {}) }} />)
      }
      if (next !== undefined) {
        lines.push(<line key={`v${i}`} x1={x2} y1={y} x2={x2} y2={REL_Y(next.level, next.progress)} style={{ stroke: RULE, strokeWidth: 1.5 }} />)
      }
    })
    const parts: ReactNode[] = [
      <svg key="svg" className={css.logRelSvg} width={laneWidth} height={REL_LANE} aria-hidden="true">
        {[1, 2, 3, 4].map(level => (
          <line key={`l${level}`} x1={0} y1={LEVEL_Y(level)} x2={laneWidth} y2={LEVEL_Y(level)} style={{ stroke: RULE, strokeOpacity: 0.35, strokeDasharray: '1 4' }} />
        ))}
        {lines}
      </svg>,
    ]
    const select = (chapter: number): void => { pick({ kind: 'r', id: row.view.cardId, chapter }, true) }
    row.log.forEach((item, i) => {
      const { entry } = item
      const at = row.steps.find(step => step.chapter === entry.chapter)!
      const evidence = entry.evidence === undefined ? '' : `：${entry.evidence}`
      if (entry.kind === 'points') {
        const title = `${t('log.chapter', { n: entry.chapter })} · ${entry.delta > 0 ? '+' : ''}${entry.delta}${evidence}`
        parts.push(mark(`p${i}`, entry.chapter, title, <PointsGlyph delta={entry.delta} />, () => { select(entry.chapter) }, { top: REL_Y(at.level, at.progress) - 10 }))
        return
      }
      if (entry.event === 'type') {
        parts.push(<span key={`t${i}`} className={css.logTypeChange} style={{ left: X(entry.chapter) }}>→ {entry.toType ?? item.type}</span>)
      }
      const label = stageLabel(t, item)
      parts.push(<span key={`l${i}`} className={css.logRelLabel} data-tone={isRift(item.level) ? 'bad' : undefined} style={{ left: X(entry.chapter), top: LEVEL_Y(item.level) - 8 }}>{label}</span>)
      parts.push(mark(`e${i}`, entry.chapter, `${t('log.chapter', { n: entry.chapter })} · ${journalLabel(t, item)}${evidence}`, <RelationGlyph event={entry.event} />, () => { select(entry.chapter) }, { top: LEVEL_Y(item.level) - 10 }))
    })
    return lane(parts, css.logLaneTall)
  }

  const relationStatus = (view: StoryRelation): string => {
    const bar = view.rift === undefined && view.level !== undefined && view.level < 4 ? ` ${view.progress}/${PTS_PER_LEVEL}` : ''
    return `${view.type} · ${view.stage}${bar}`
  }

  const castLane = (card: StoryCharacter): ReactNode => lane(castChapters(card).map(({ chapter, at, changes }) => {
    const where = at === undefined ? t('log.c.absent') : `${t(at.pov ? 'log.c.pov' : 'log.c.present')}${at.planned ? t('log.plannedSuffix') : ''}`
    const changed = changes.length === 0 ? '' : ` · ${t('log.c.changed', { fields: [...new Set(changes.flatMap(entry => entry.changes.map(change => fieldLabel(t, change.field))))].join('、') })}${allByUser(changes) ? t('log.c.byUserSuffix') : ''}`
    return mark(`c${chapter}`, chapter, `${t('log.chapter', { n: chapter })} · ${where}${changed}`, <CastGlyph at={at} changes={changes} />, () => { pick({ kind: 'c', id: card.cardId, chapter }, true) })
  }))
  const castStatus = (card: StoryCharacter): string => {
    const changed = card.history.filter(entry => entry.kind === 'change').length
    return [castCount(card, t), ...changed > 0 ? [t('log.c.changes', { n: changed })] : []].join(' · ')
  }

  const worldChapters = (card: StoryCard): { chapter: number; first: boolean; entries: HistoryEntry[] }[] => {
    const chapters = [...new Set(card.history.map(entry => entry.chapter))].sort((a, b) => a - b)
    return chapters.map((chapter) => {
      const entries = card.history.filter(entry => entry.chapter === chapter)
      return { chapter, first: entries.every(entry => entry.kind === 'create'), entries }
    })
  }
  const worldLane = (card: StoryCard): ReactNode => lane(worldChapters(card).map(({ chapter, first, entries }) => {
    const note = entries.flatMap(entry => entry.changes.filter(change => change.field === 'rule').map(change => change.value)).at(-1)
    const title = `${t('log.chapter', { n: chapter })} · ${t(first ? 'log.w.first' : 'log.w.rule')}${note === undefined ? '' : `：${note}`}`
    return mark(`w${chapter}`, chapter, title, <WorldGlyph first={first} />, () => { pick({ kind: 'w', id: card.cardId, chapter }, true) })
  }))
  const worldStatus = (card: StoryCard): string => {
    if (card.history.length === 0) return t('log.w.none')
    const rules = card.history.filter(entry => entry.kind === 'change').length
    return rules > 0 ? t('log.w.rules', { n: rules }) : t('log.w.once')
  }

  const row = (key: string, kind: RowKind, id: string, head: ReactNode, body: ReactNode, tall = false): ReactNode => (
    <div
      key={key}
      className={tall ? css.logRowTall : css.logRow}
      data-selected={isSelected(kind, id) ? 'true' : undefined}
      onClick={() => { pick({ kind, id }, false) }}
    >
      <div className={css.logHead} data-head="true">{head}</div>
      {body}
    </div>
  )

  const openForeshadows = model.foreshadows.filter(item => !item.closed).length
  const columnHead = (
    <div className={css.logColumns}>
      <div className={css.logHead} data-head="true">{t('log.chapters')}</div>
      {lane(
        <>
          {log.chapters.map(chapter => (fit && chapter.n % 5 !== 0 && chapter.n !== 1 && chapter.n !== model.cur) ? null : (
            <span
              key={chapter.n}
              className={css.logColumnNumber}
              data-five={chapter.n % 5 === 0 ? 'true' : undefined}
              data-current={chapter.n === model.cur ? 'true' : undefined}
              style={{ left: (chapter.n - 1) * cw, width: cw }}
              title={`${t('log.chapter', { n: chapter.n })}${chapter.title === '' ? '' : ` · ${chapter.title}`} · ${t(`phase.${chapter.phase}`)}`}
            >
              {chapter.n}
            </span>
          ))}
          {model.cur > 0 && <span className={css.logCurrentTag} style={{ left: X(model.cur) - 24 }}>{t('log.current')}</span>}
        </>,
        css.logColumnLane,
      )}
    </div>
  )

  const grid = (
    <div className={css.logGrid} data-fit={fit ? 'true' : undefined} style={{ '--log-cw': `${cw}px` } as CSSProperties}>
      {columnHead}
      {band(t('log.band.foreshadow'), t('log.band.foreshadowCount', { count: model.foreshadows.length, open: openForeshadows }))}
      {foreshadows.map(item => row(`f${item.view.cardId}`, 'f', item.view.cardId, (
        <>
          {starButton(item)}
          <span className={css.logRef}>{item.view.ref}</span>
          <span className={css.logName} title={item.view.question}>{item.view.question}</span>
          {foreshadowStatus(item)}
        </>
      ), foreshadowLane(item)))}
      {foreshadows.length === 0 && (
        <div className={css.logRow}>
          <div className={css.logHead} data-head="true"><span className={css.muted}>{t(filter === 'star' ? 'log.f.noStarred' : model.foreshadows.length === 0 ? 'log.f.none' : 'log.f.noOpen')}</span></div>
          {lane(null)}
        </div>
      )}
      {band(t('log.band.relation'), t('log.band.relationCount', { count: model.relations.length }), 'r')}
      {open.r && model.relations.map(item => row(`r${item.view.cardId}`, 'r', item.view.cardId, (
        <>
          <span className={css.logName}>{item.view.names.join(' — ')}</span>
          <span className={css.logStatus} data-tone={item.view.rift === undefined ? undefined : 'bad'}>{relationStatus(item.view)}</span>
          {item.view.ready && <span className={css.logReady} title={t('log.r.readyHelp')}>{t('log.r.ready')}</span>}
        </>
      ), relationLane(item), true))}
      {band(t('log.band.cast'), String(log.characters.length), 'c')}
      {open.c && log.characters.map(card => row(`c${card.cardId}`, 'c', card.cardId, (
        <>
          <span className={css.logName}>{card.name}</span>
          <span className={css.logStatus}>{castStatus(card)}</span>
        </>
      ), castLane(card)))}
      {band(t('log.band.world'), String(log.world.length), 'w')}
      {open.w && log.world.map(card => row(`w${card.cardId}`, 'w', card.cardId, (
        <>
          <span className={css.logName}>{card.name}</span>
          <span className={css.logStatus}>{worldStatus(card)}</span>
        </>
      ), worldLane(card)))}
    </div>
  )

  const seg = <V extends string>(value: V, set: (next: V) => void, options: readonly (readonly [V, string])[]): ReactNode => (
    <div className={css.logSeg}>
      {options.map(([key, label]) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => { set(key) }}>{label}</button>
      ))}
    </div>
  )

  const loadMax = Math.max(1, ...model.load.values())
  return (
    <div className={css.page}>
      <div
        ref={frameRef}
        className={css.logFrame}
        data-narrow={narrow ? 'true' : undefined}
        style={{ '--log-hw': `${hw}px` } as CSSProperties}
      >
        <div className={css.logToolbar}>
          {seg(filter, setFilter, [['open', t('log.filter.open')], ['star', t('log.filter.star')], ['all', t('log.filter.all')]])}
          {seg(sort, setSort, [['plant', t('log.sort.plant')], ['idle', t('log.sort.idle')]])}
          {!fits && seg(zoom, setZoom, [['detail', t('log.zoom.detail')], ['fit', t('log.zoom.fit')]])}
          <span className={css.logSpacer} />
          {failure !== null && <span className={css.warn}>{failure}</span>}
          {model.cur > 0 && <span className={css.muted}>{t('log.writtenTo', { n: model.cur })}</span>}
        </div>
        <div className={css.logBody}>
          <div className={css.logMain}>
            {!fits && <div
              className={css.logScrub}
              onPointerDown={(event) => {
                scrubbing.current = true
                event.currentTarget.setPointerCapture?.(event.pointerId)
                scrubTo(event)
              }}
              onPointerMove={(event) => { if (scrubbing.current) scrubTo(event) }}
              onPointerUp={() => { scrubbing.current = false }}
            >
              <span className={css.logScrubLabel}>{t('log.scrub.count', { n: model.last })}<br />{t('log.scrub.help')}</span>
              <svg viewBox={`0 0 ${model.last * 10} 28`} preserveAspectRatio="none" aria-label={t('log.scrub.label')}>
                {Array.from({ length: model.last }, (_, i) => i + 1).map((n) => {
                  const height = 4 + ((model.load.get(n) ?? 0) / loadMax) * 22
                  const fill = n === model.cur ? ACCENT : model.planning.has(n) ? LINE : RULE
                  return <rect key={n} x={(n - 1) * 10 + 2} y={28 - height} width={6} height={height} rx={1} style={{ fill }} />
                })}
              </svg>
              <i ref={windowRef} className={css.logScrubWindow} />
            </div>}
            <div
              ref={matrixRef}
              className={css.logMatrix}
              onScroll={syncWindow}
              onPointerDown={(event) => {
                const target = event.target as Element
                if (event.button !== 0 || target.closest('button, [data-head]') !== null) return
                drag.current = { x: event.clientX, left: event.currentTarget.scrollLeft, moved: false }
              }}
            >
              {grid}
            </div>
          </div>
          {(!narrow || drawer) && <aside className={css.logSide}>
            {narrow && <button type="button" className={css.logClose} onClick={() => { setDrawer(false) }}>{t('log.close')}</button>}
            <SidePanel
              model={model}
              selected={selected}
              tab={tab}
              setTab={setTab}
              navigate={navigate}
              starButton={starButton}
              t={t}
            />
          </aside>}
        </div>
        <Legend t={t} />
      </div>
    </div>
  )
}

/** 出场 counts the written chapters, 计划 the planned ones; a zero side is left out. */
function castCount(card: StoryCharacter, t: T): string {
  const shown = card.appearances.filter(at => !at.planned).length
  const planned = card.appearances.length - shown
  const parts = [...shown > 0 ? [t('log.c.shown', { n: shown })] : [], ...planned > 0 ? [t('log.c.plannedCount', { n: planned })] : []]
  return parts.length === 0 ? t('log.c.absent') : parts.join(' · ')
}

/* ---------------------------------------------------------- side panel */

function SidePanel({ model, selected, tab, setTab, navigate, starButton, t }: {
  readonly model: Model
  readonly selected: Selection | null
  readonly tab: Tab
  readonly setTab: (tab: Tab) => void
  readonly navigate: NovelNavigate
  readonly starButton: (row: ForeshadowRow) => ReactNode
  readonly t: T
}): ReactNode {
  if (selected === null) return <div className={css.muted}>{t('log.empty')}</div>
  const tabs = (count: number): ReactNode => (
    <div className={css.logTabs} role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'now'} onClick={() => { setTab('now') }}>{t('log.tab.now')}</button>
      <button type="button" role="tab" aria-selected={tab === 'log'} onClick={() => { setTab('log') }}>{t('log.tab.log')}<small>{count}</small></button>
    </div>
  )
  const go = (cardId: string, heading: string, label: string): ReactNode => (
    <button type="button" className={css.logGo} onClick={() => { navigate.openCard(cardId, heading) }}>{label}</button>
  )

  if (selected.kind === 'f') {
    const row = model.foreshadows.find(item => item.view.cardId === selected.id)!
    return <ForeshadowSide row={row} cur={model.cur} chapter={selected.chapter} starButton={starButton} go={go} t={t} />
  }
  if (selected.kind === 'r') {
    const row = model.relations.find(item => item.view.cardId === selected.id)!
    const { view } = row
    return (
      <>
        <div className={css.logKicker}>{t('log.r.kicker', { types: row.types.join(' → ') })}</div>
        <h3 className={css.logTitle}>{view.names.join(' — ')}</h3>
        {view.now !== undefined && <p className={css.logQuestion}>{view.now}</p>}
        <div className={css.logMeta}>{t('log.r.now', { type: view.type, stage: view.stage })}</div>
        {tabs(row.log.length)}
        {tab === 'now' ? <RelationNow view={view} t={t} /> : <RelationTrack row={row} chapter={selected.chapter} t={t} />}
        {go(view.cardId, view.name, t('log.open.relation'))}
      </>
    )
  }
  if (selected.kind === 'c') {
    const card = model.log.characters.find(item => item.cardId === selected.id)!
    const pov = card.appearances.filter(at => at.pov && !at.planned).length
    const changed = card.history.filter(entry => entry.kind === 'change').length
    return (
      <>
        <div className={css.logKicker}>{t('log.c.kicker')}</div>
        <h3 className={css.logTitle}>{card.name}</h3>
        <div className={css.logMeta}>
          {castCount(card, t)}
          {pov > 0 && ` · ${t('log.c.povCount', { n: pov })}`}
          {changed > 0 && ` · ${t('log.c.metaChanged', { n: changed })}`}
        </div>
        {tabs(card.history.length)}
        {tab === 'now'
          ? <CardNow card={card} fields={PLOT_FIELDS.character ?? []} relations={model.relations.filter(item => item.view.pair.includes(card.cardId))} t={t} />
          : <CastTrack card={card} chapter={selected.chapter} t={t} />}
        {go(card.cardId, card.name, t('log.open.character'))}
      </>
    )
  }
  const card = model.log.world.find(item => item.cardId === selected.id)!
  return (
    <>
      <div className={css.logKicker}>{t('log.w.kicker')}</div>
      <h3 className={css.logTitle}>{card.name}</h3>
      {tabs(card.history.length)}
      {tab === 'now'
        ? <CardNow card={card} fields={PLOT_FIELDS.world ?? []} relations={[]} t={t} />
        : <HistoryTrack history={card.history} chapter={selected.chapter} world t={t} />}
      {go(card.cardId, card.name, t('log.open.world'))}
    </>
  )
}

function ForeshadowSide({ row, cur, chapter, starButton, go, t }: {
  readonly row: ForeshadowRow
  readonly cur: number
  readonly chapter: number | undefined
  readonly starButton: (row: ForeshadowRow) => ReactNode
  readonly go: (cardId: string, heading: string, label: string) => ReactNode
  readonly t: T
}): ReactNode {
  const { view, marks, threshold } = row
  return (
    <>
      <div className={css.logKicker}>{t('log.f.kicker', { ref: view.ref })}</div>
      <h3 className={css.logTitle}>{view.question}</h3>
      <div className={css.logMeta}>
        {starButton(row)}
        {t(view.starred ? 'log.f.starred' : 'log.f.unstarred', { n: threshold })}
        {row.resolvedAt !== undefined
          ? <span className={css.logStatus}>{t('log.f.resolvedAt', { n: row.resolvedAt })}</span>
          : row.sleeping ? <span className={css.logStatus} data-tone="bad">{t('log.f.sleeping', { n: view.slept ?? 0 })}</span> : null}
      </div>
      {view.state === '已揭晓' && view.answer !== undefined && <p className={css.logQuestion}>{t('log.f.answer', { answer: view.answer })}</p>}
      <ul className={css.logTrack}>
        {marks.map((item, i) => {
          const next = marks[i + 1]
          const gap = next !== undefined && !next.planned && next.chapter - item.chapter >= threshold ? next.chapter - item.chapter : 0
          return (
            <li key={i} data-gap={gap > 0 ? t('log.idle', { n: gap }) : undefined} data-on={chapter === item.chapter ? 'true' : undefined}>
              <span className={css.logTrackGlyph}><MentionGlyph kind={item.kind} planned={item.planned} /></span>
              <span className={css.logTrackText}>
                <b>{t('log.chapter', { n: item.chapter })}</b> {t(MENTION_KEY[item.kind])}
                {item.planned && <span className={css.logPlanned}>{t('log.planned')}</span>}
                {item.note !== undefined && <p>{item.note}</p>}
              </span>
            </li>
          )
        })}
        {!row.closed && cur > 0 && (
          <li data-tail="true">
            <span className={css.logTrackGlyph} />
            <span className={css.logTrackText}>{row.sleeping ? t('log.f.tailSleeping', { n: view.slept ?? 0, cur }) : t('log.f.tailOpen', { cur })}</span>
          </li>
        )}
      </ul>
      {go(view.cardId, `${view.ref} ${view.question}`, t('log.open.foreshadow'))}
    </>
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
        ? t('log.r.hintReady', { stage: view.stage, points: view.progress, full: PTS_PER_LEVEL, milestone: next.milestone, next: next.stage })
        : t('log.r.hintWait', { stage: view.stage, points: view.progress, full: PTS_PER_LEVEL, next: next.stage })
  return (
    <>
      <div className={css.logStairs} data-rift={rift ? 'true' : undefined}>
        {ladder.map((step, i) => {
          const at = i + 1
          const state = rift ? (at <= level ? 'got' : undefined)
            : at === level ? 'now' : at < level ? 'got' : at === level + 1 ? 'next' : undefined
          const fill = state === 'now' ? { background: `linear-gradient(to top, ${INK} ${(view.progress / PTS_PER_LEVEL) * 100}%, transparent 0)` } : {}
          const sub = state === 'now' ? `${view.progress}/${PTS_PER_LEVEL}` : state === 'next' && view.ready ? t('log.r.ready') : '　'
          return (
            <div key={step.stage} data-state={state}>
              <i style={{ height: 8 + i * 8, ...fill }} />
              {step.stage}
              <small>{sub}</small>
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
      {view.views.length > 0 && (
        <>
          <div className={css.logKicker}>{t('log.r.views')}</div>
          <div className={css.logViews}>{view.views.map(line => <div key={line}>{line}</div>)}</div>
        </>
      )}
    </>
  )
}

function RelationTrack({ row, chapter, t }: { readonly row: RelationRow; readonly chapter: number | undefined; readonly t: T }): ReactNode {
  if (row.log.length === 0) return <div className={css.muted}>{t('log.r.noJournal')}</div>
  return (
    <ul className={css.logTrack}>
      {row.log.map((item, i) => {
        const { entry } = item
        return (
          <li key={i} data-on={chapter === entry.chapter ? 'true' : undefined}>
            <span className={css.logTrackGlyph}>
              {entry.kind === 'points' ? <PointsGlyph delta={entry.delta} /> : <RelationGlyph event={entry.event} />}
            </span>
            <span className={css.logTrackText}>
              <b>{t('log.chapter', { n: entry.chapter })}</b> {journalLabel(t, item)}
              {entry.kind === 'points' && typeof item.level === 'number' && <span className={css.muted}> · {t('log.r.progress', { points: item.progress, full: PTS_PER_LEVEL })}</span>}
              {entry.evidence !== undefined && <p>{t('log.src.evidence', { text: entry.evidence })}</p>}
            </span>
          </li>
        )
      })}
    </ul>
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

function CastTrack({ card, chapter, t }: { readonly card: StoryCharacter; readonly chapter: number | undefined; readonly t: T }): ReactNode {
  const chapters = castChapters(card)
  if (chapters.length === 0) return <div className={css.muted}>{t('log.c.noTrack')}</div>
  return (
    <ul className={css.logTrack}>
      {chapters.map(({ chapter: n, at, changes }) => {
        const where = at !== undefined ? t(at.pov ? 'log.c.pov' : 'log.c.present') : allByUser(changes) ? '' : t('log.c.absent')
        return (
          <li key={n} data-on={chapter === n ? 'true' : undefined}>
            <span className={css.logTrackGlyph}><CastGlyph at={at} changes={changes} /></span>
            <span className={css.logTrackText}>
              <b>{t('log.chapter', { n })}</b> {where}
              {at?.planned === true && <span className={css.logPlanned}>{t('log.planned')}</span>}
              {at?.role !== undefined && <p>{at.role}</p>}
              {at?.experiences.map(line => <p key={line}>{line}</p>)}
              {changes.map((entry, i) => <ChangeLines key={i} entry={entry} t={t} />)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function HistoryTrack({ history, chapter, world, t }: {
  readonly history: readonly HistoryEntry[]
  readonly chapter: number | undefined
  readonly world: boolean
  readonly t: T
}): ReactNode {
  if (history.length === 0) return <div className={css.muted}>{t('log.w.noTrack')}</div>
  return (
    <ul className={css.logTrack}>
      {history.map((entry, i) => (
        <li key={i} data-on={chapter === entry.chapter ? 'true' : undefined}>
          <span className={css.logTrackGlyph}>{world && <WorldGlyph first={entry.kind === 'create'} />}</span>
          <span className={css.logTrackText}>
            <b>{t('log.chapter', { n: entry.chapter })}</b> {t(entry.kind === 'create' ? 'log.w.first' : 'log.w.rule')}
            <ChangeLines entry={entry} t={t} />
          </span>
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------- legend */

function Legend({ t }: { readonly t: T }): ReactNode {
  const kinds = ['planted', 'advanced', 'hinted', 'resolved'] as const
  return (
    <div className={css.logLegend}>
      {kinds.map(kind => <span key={kind}><MentionGlyph kind={kind} planned={false} />{t(MENTION_KEY[kind])}</span>)}
      <span><MentionGlyph kind="advanced" planned />{t('log.legend.planned')}</span>
      <span><i className={css.logLegendSleep} />{t('log.legend.sleep', { normal: SLEEP_THRESHOLD.normal, starred: SLEEP_THRESHOLD.starred })}</span>
      <span>{t('log.legend.star')}</span>
      <span><PointsGlyph delta={1} /><PointsGlyph delta={2} /><PointsGlyph delta={-1} />{t('log.legend.points', { full: PTS_PER_LEVEL })}</span>
      <span><RelationGlyph event="up" />{t('log.legend.up')}</span>
      <span><RelationGlyph event="crack" />{t('log.rel.crack')}</span>
      <span><RelationGlyph event="break" />{t('log.rel.break')}</span>
      <span><RelationGlyph event="fix" />{t('log.legend.fix')}</span>
      <span><RelationGlyph event="set" />{t('log.legend.set')}</span>
      <span><CastGlyph at={{ chapter: 0, pov: true, planned: false, experiences: [] }} changes={[]} />{t('log.c.pov')}</span>
      <span><CastGlyph at={{ chapter: 0, pov: false, planned: false, experiences: [] }} changes={[]} />{t('log.c.present')}</span>
      <span><CastGlyph at={{ chapter: 0, pov: false, planned: false, experiences: [] }} changes={[LEGEND_CHANGE('accept')]} />{t('log.legend.changed')}</span>
      <span><CastGlyph at={undefined} changes={[LEGEND_CHANGE('user')]} />{t('log.legend.byUser')}</span>
      <span><WorldGlyph first />{t('log.w.first')}</span>
      <span><WorldGlyph first={false} />{t('log.w.rule')}</span>
    </div>
  )
}

const LEGEND_CHANGE = (source: HistoryEntry['source']): HistoryEntry => ({ cardId: '', chapter: 0, source, kind: 'change', changes: [], createdAt: '' })
