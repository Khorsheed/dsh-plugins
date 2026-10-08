/**
 * What replaces the generic `novel_write` tool row in the conversation.
 *
 * A chapter plan gets a card: the chapter, the plan's 梗概 and its shape
 * (走向 N 拍 · 推进 2 · 新埋 1 · 出场 3 人), whether the person has confirmed
 * it, and one door — 查看并确认计划 → — to the chapter page, where the whole
 * plan is read and confirmed. The card confirms nothing itself: the plan is
 * judged in full, on the page, not from a summary.
 *
 * A plan registered while the row is on screen (it saw the call running)
 * opens that chapter page in the right sidebar by itself, once: when the
 * turn ends the host folds its tool calls under 「已调用工具」, card and all,
 * and the person read 「点一下确认计划」 with no button in sight (2026-10-08).
 * The page's ✓ 确认计划 stays put whatever the conversation folds. A row
 * mounted already settled is history and only offers its door.
 *
 * Every other write (a review) is one compact line with the answer
 * behind 详情.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { ForeshadowOp } from '../types.ts'
import type { NovelFace } from './contract.ts'
import { chapterHeading } from './PendingList.tsx'
import { useNovelRead } from './use-novel.ts'
import { writeRowModel, type NovelToolBlock, type WriteRowChapter } from './write-row.ts'
import css from './WriteToolRow.module.css'

const OP_KEYS = { 推进: 'plan.op.advance', 暗示: 'plan.op.hint', 新埋: 'plan.op.plant', 揭晓: 'plan.op.resolve' } as const
/** While a plan waits for the person, the card re-reads this often (they confirm on the page). */
const AWAIT_POLL_MS = 10_000

/** What the row reaches outside its own block. */
export interface WriteToolFace extends NovelFace {
  /** Open the canvas tab on one of its pages; undefined when the canvas is not composed. */
  readonly openPage: () => ((canvasId: string, page: string, heading: string, param?: string) => void) | undefined
  /** The chapter page's key. */
  readonly chapterPage: string
  /** The 规划 page's key (an outline proposal's door). */
  readonly planPage: string
}

/** The props the keyed tool slot composes for this row. */
export interface WriteToolRowProps extends WriteToolFace {
  readonly block: NovelToolBlock
  readonly phase?: string
  readonly t: TranslateNS<'novel'>
}

/** Render one `novel_write` call. */
export function WriteToolRow(props: WriteToolRowProps): ReactNode {
  const row = writeRowModel(props.block, props.phase)
  const sawRunning = useRef(false)
  if (row.state === 'running') sawRunning.current = true
  if (row.state === 'chapter') return <PlanCard {...props} chapter={row.chapter!} live={sawRunning.current} />
  if (row.state === 'outline') return <OutlineCard {...props} canvasId={row.canvasId!} live={sawRunning.current} />
  return <Line state={row.state} text={row.text} t={props.t} />
}

function Line({ state, text, t }: { readonly state: 'running' | 'failed' | 'line'; readonly text: string; readonly t: TranslateNS<'novel'> }): ReactNode {
  const [open, setOpen] = useState(false)
  const first = text.split('\n')[0] ?? ''
  return (
    <div className={css.line} data-tool="novel_write" data-state={state}>
      <div className={css.lineRow}>
        <span className={css.label}>{t('card.label')}</span>
        {state === 'running' && <span className={css.note}>{t('card.running')}</span>}
        {state === 'failed' && <span className={css.warn} title={text}>{first || t('card.failed')}</span>}
        {state === 'line' && <span className={css.text} title={text}>{first}</span>}
        {state !== 'running' && text !== first && (
          <button type="button" className={css.inspect} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
            {t('card.inspect')}
          </button>
        )}
      </div>
      {open && <pre className={css.detail}>{text}</pre>}
    </div>
  )
}

function PlanCard({ chapter, live: watched, remote, openPage, chapterPage, t }: WriteToolRowProps & {
  readonly chapter: WriteRowChapter
  /** The row saw this call run: a plan that lands awaiting confirmation opens its page. */
  readonly live: boolean
}): ReactNode {
  const { canvasId, n } = chapter
  const [tick, setTick] = useState(0)
  const read = useNovelRead(remote(), r => r.chapter({ canvasId, n }), `chapter:${canvasId}:${n}`, tick)
  const live = read.state === 'ready' && read.value.ok ? read.value.chapter : undefined
  const plan = live?.plan
  const confirmed = live?.planConfirmedAt !== undefined
  const awaiting = plan !== undefined && !confirmed
  useEffect(() => {
    if (!awaiting) return
    const timer = setInterval(() => { setTick(value => value + 1) }, AWAIT_POLL_MS)
    return () => { clearInterval(timer) }
  }, [awaiting])
  const title = live?.title ?? chapter.title
  const open = openPage()
  const followed = useRef(false)
  useEffect(() => {
    if (!watched || followed.current || !awaiting || open === undefined) return
    followed.current = true
    open(canvasId, chapterPage, chapterHeading(t, n, title), String(n))
  }, [watched, awaiting, open, canvasId, chapterPage, n, title, t])
  // The live plan wins; the answer's counts stand in until it is read (or when it cannot be).
  const facts: string[] = plan !== undefined
    ? [
        ...(plan.beats.length > 0 ? [t('card.beats', { count: plan.beats.length })] : []),
        ...opCounts(plan.foreshadowOps).map(([op, count]) => t('card.op', { op: t(OP_KEYS[op]), count })),
        ...(plan.cast.length > 0 ? [t('card.cast', { count: plan.cast.length })] : []),
      ]
    : chapter.counts === null
      ? []
      : [
          t('card.beats', { count: chapter.counts.beats }),
          t('card.ops', { count: chapter.counts.ops }),
          t('card.cast', { count: chapter.counts.cast }),
        ]
  return (
    <div className={css.card} data-tool="novel_write" data-state={awaiting ? 'awaiting' : confirmed ? 'confirmed' : 'plain'}>
      <div className={css.head}>
        <span className={css.kicker}>{t('card.kicker', { n })}</span>
        {plan !== undefined && <span className={css.status} data-confirmed={confirmed || undefined}>{t(confirmed ? 'card.confirmed' : 'card.awaiting')}</span>}
      </div>
      <div className={css.title}>{title}</div>
      {plan !== undefined && plan.summary !== '' && <p className={css.gist}>{plan.summary}</p>}
      {facts.length > 0 && (
        <div className={css.facts}>
          {facts.map(fact => <span key={fact}>{fact}</span>)}
        </div>
      )}
      {open !== undefined && (
        <button
          type="button"
          className={css.go}
          data-primary={awaiting || undefined}
          onClick={() => { open(canvasId, chapterPage, chapterHeading(t, n, title), String(n)) }}
        >
          {t(awaiting ? 'card.confirm' : 'card.view')} →
        </button>
      )}
    </div>
  )
}

/**
 * An outline proposal: it waits on the 规划 page for the person's 采用, so the
 * card says whether it still waits and opens that page. Like a plan, one it
 * watched land opens the page by itself — the turn folds the card away.
 */
function OutlineCard({ canvasId, live: watched, remote, openPage, planPage, t }: WriteToolRowProps & {
  readonly canvasId: string
  readonly live: boolean
}): ReactNode {
  const [tick, setTick] = useState(0)
  const read = useNovelRead(remote(), r => r.outline({ canvasId }), `outline:${canvasId}`, tick)
  const outline = read.state === 'ready' && read.value.ok ? read.value.outline : undefined
  const awaiting = outline?.proposal !== undefined
  useEffect(() => {
    if (!awaiting) return
    const timer = setInterval(() => { setTick(value => value + 1) }, AWAIT_POLL_MS)
    return () => { clearInterval(timer) }
  }, [awaiting])
  const open = openPage()
  const followed = useRef(false)
  useEffect(() => {
    if (!watched || followed.current || !awaiting || open === undefined) return
    followed.current = true
    open(canvasId, planPage, t('face.plan'))
  }, [watched, awaiting, open, canvasId, planPage, t])
  return (
    <div className={css.card} data-tool="novel_write" data-state={awaiting ? 'awaiting' : 'plain'}>
      <div className={css.head}>
        <span className={css.kicker}>{t('card.outline')}</span>
        {outline !== undefined && <span className={css.status} data-confirmed={!awaiting || undefined}>{t(awaiting ? 'card.outlineAwaiting' : 'card.outlineSettled')}</span>}
      </div>
      {outline?.proposal?.rationale !== undefined && <p className={css.gist}>{outline.proposal.rationale}</p>}
      {open !== undefined && (
        <button
          type="button"
          className={css.go}
          data-primary={awaiting || undefined}
          onClick={() => { open(canvasId, planPage, t('face.plan')) }}
        >
          {t(awaiting ? 'card.outlineAdopt' : 'card.outlineView')} →
        </button>
      )}
    </div>
  )
}

/** Foreshadow ops counted per kind, in the order the plan first uses them. */
function opCounts(ops: readonly ForeshadowOp[]): Array<[ForeshadowOp['op'], number]> {
  const counts = new Map<ForeshadowOp['op'], number>()
  for (const op of ops) counts.set(op.op, (counts.get(op.op) ?? 0) + 1)
  return [...counts]
}
