/**
 * 时间轴, the novel's view face (2026-11-01; it replaces 故事): the book's
 * events in story time. Left, what has happened (backstory first, then the
 * chapters' events, each with the chapter that wrote it); right, everything
 * to come grouped by priority — 临近 · 积压 · 就绪 · 饱和 · 搁置 — with the one
 * line that says why, and how the priority is worked out. Picking an event
 * shows its parts: the five tension components, its preconditions, its
 * causes, the people and places it names, the ideas bound to it.
 *
 * 按章节 switches to the chapter × card table the 故事 face used to be.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useState, type ReactNode } from 'react'
import { NOVEL_GENRE_ID, type NovelTimelineResult, type TimelineEventView, type TimelineFutureView } from '../types.ts'
import type { NovelSurfaceProps } from './contract.ts'
import { StoryView } from './StoryLogPage.tsx'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './timeline.module.css'

type T = NovelSurfaceProps['t']
const TIERS = ['near', 'backlog', 'ready', 'sat', 'hold'] as const

/** The 时间轴 face (keyed `novel:story`); nothing on a canvas of another genre. */
export function TimelineView(props: NovelSurfaceProps): ReactNode {
  const [mode, setMode] = useState<'story' | 'chapters'>('story')
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  const { t } = props
  return (
    <div className={css.page}>
      <div className={css.toolbar}>
        <div className={css.seg} role="group" aria-label={t('tl.mode')}>
          <button type="button" aria-pressed={mode === 'story'} onClick={() => { setMode('story') }}>{t('tl.byStory')}</button>
          <button type="button" aria-pressed={mode === 'chapters'} onClick={() => { setMode('chapters') }}>{t('tl.byChapter')}</button>
        </div>
        <span className={css.muted}>{mode === 'story' ? t('tl.storyHint') : t('tl.chapterHint')}</span>
      </div>
      {mode === 'story' ? <StoryTime {...props} /> : <StoryView {...props} />}
    </div>
  )
}

function StoryTime(props: NovelSurfaceProps): ReactNode {
  const { canvasId, rev, remote, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.timeline({ canvasId }), `timeline:${canvasId}`, rev)
  const [picked, setPicked] = useState<string | null>(null)
  if (api === undefined) return null
  if (read.state === 'loading') return <div className={css.muted}>{t('state.loading')}</div>
  if (read.state === 'error') return <div className={css.warn}>{t('error.generic', { message: read.message })}</div>
  if (!read.value.ok) return <div className={css.warn}>{t(errorKey(read.value.error))}</div>
  const data = read.value
  const past = data.past ?? []
  const future = data.future ?? []
  const all: readonly TimelineEventView[] = [...past, ...future]
  const chosen = all.find(event => event.id === picked)
  return (
    <>
      <div className={css.columns}>
        <section className={css.column}>
          <h3 className={css.colHead}>{t('tl.past')}<span className={css.muted}> {past.length}</span></h3>
          {past.length === 0
            ? <p className={css.empty}>{t('tl.pastEmpty')}</p>
            : past.map(event => <EventRow key={event.id} event={event} data={data} picked={picked === event.id} onPick={() => { setPicked(event.id) }} t={t} />)}
        </section>
        <div className={css.now}><span>{t('tl.now', { n: (data.chapter ?? 1) - 1 })}</span></div>
        <section className={css.column}>
          <h3 className={css.colHead}>{t('tl.future')}<span className={css.muted}> {future.length}</span></h3>
          {future.length === 0
            ? <p className={css.empty}>{t('tl.futureEmpty')}</p>
            : TIERS.map(tier => {
              const rows = future.filter(event => event.tier === tier).sort((a, b) => b.tension - a.tension)
              if (rows.length === 0) return null
              return (
                <div key={tier} className={css.tier} data-tier={tier}>
                  <div className={css.tierHead}><b>{t(`tl.tier.${tier}`)}</b><span className={css.muted}>{t(`tl.tierHint.${tier}`)}</span></div>
                  {rows.map(event => <EventRow key={event.id} event={event} data={data} picked={picked === event.id} onPick={() => { setPicked(event.id) }} t={t} />)}
                </div>
              )
            })}
        </section>
      </div>
      <details className={css.rule}>
        <summary>{t('tl.ruleHead')}</summary>
        <p>{t('tl.formula')}</p>
        <ol>{TIERS.slice().sort((a, b) => ['sat', 'hold', 'near', 'backlog', 'ready'].indexOf(a) - ['sat', 'hold', 'near', 'backlog', 'ready'].indexOf(b)).map(tier => <li key={tier}><b>{t(`tl.tier.${tier}`)}</b>：{t(`tl.when.${tier}`)}</li>)}</ol>
        <p className={css.muted}>{t('tl.ruleNote')}</p>
      </details>
      {chosen !== undefined && <EventDetail event={chosen} data={data} all={all} openCard={props.navigate.openCard} t={t} />}
    </>
  )
}

function namesOf(event: TimelineEventView, data: NovelTimelineResult): string[] {
  return [...(event.who ?? []), ...(event.places ?? [])].map(id => data.names?.[id] ?? id)
}

function EventRow({ event, data, picked, onPick, t }: {
  readonly event: TimelineEventView
  readonly data: NovelTimelineResult
  readonly picked: boolean
  readonly onPick: () => void
  readonly t: T
}): ReactNode {
  const future = 'tier' in event ? event as TimelineFutureView : undefined
  const names = namesOf(event, data)
  return (
    <button type="button" className={css.event} data-status={event.status} data-tier={future?.tier} aria-current={picked || undefined} onClick={onPick}>
      <span className={css.title}>{event.title}</span>
      <span className={css.meta}>
        {event.source !== undefined && <span className={css.src}>{event.source}</span>}
        {event.when !== undefined && <span>{event.when}</span>}
        {event.chapters !== undefined && <span className={css.chap}>{t('tl.chapters', { list: event.chapters.join('、') })}</span>}
        {event.status === 'failed' && <span className={css.failed}>{t('tl.failed')}</span>}
        {names.length > 0 && <span>{names.join('、')}</span>}
        {event.ideas > 0 && <span className={css.ideaMark}>{t('tl.ideas', { count: event.ideas })}</span>}
      </span>
      {future !== undefined && <span className={css.reason}>{future.reason}</span>}
    </button>
  )
}

function EventDetail({ event, data, all, openCard, t }: {
  readonly event: TimelineEventView
  readonly data: NovelTimelineResult
  readonly all: readonly TimelineEventView[]
  readonly openCard: (cardId: string, heading: string) => void
  readonly t: T
}): ReactNode {
  const future = 'tier' in event ? event as TimelineFutureView : undefined
  const ids = [...(event.who ?? []), ...(event.places ?? [])]
  const bar = (label: string, value: number, text: string, source: string): ReactNode => (
    <div className={css.comp}>
      <span className={css.muted}>{label}</span>
      <span className={css.bar}><i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} /></span>
      <span className={css.compText}><em className={css.who}>{source}</em>{text}</span>
    </div>
  )
  return (
    <section className={css.detail}>
      <header className={css.detailHead}>
        <h3>{event.title}</h3>
        {event.source !== undefined && <span className={css.src}>{event.source}</span>}
        {future !== undefined && <span className={css.tierTag} data-tier={future.tier}>{t(`tl.tier.${future.tier}`)}</span>}
        {event.window !== undefined && <span className={css.muted}>{t('tl.window', { window: event.window })}</span>}
      </header>
      {future !== undefined && (
        <div className={css.comps}>
          {bar(t('tl.V'), future.V, event.valueWhy ?? '', t('tl.byAgent'))}
          {bar(t('tl.E'), future.E, (event.pre ?? []).length === 0 ? t('tl.noPre') : event.pre!.map(row => `${row.met === undefined ? '○' : '✓'} ${row.text}${row.met === undefined ? '' : t('tl.metIn', { n: row.met })}`).join('　'), t('tl.byReconcile'))}
          {bar(t('tl.D'), future.D === undefined ? 1 : future.D / 20, future.D === undefined ? t('tl.noWindow') : t('tl.dText', { n: future.D }), t('tl.auto'))}
          {bar(t('tl.Z'), future.Z / 5, t('tl.zText', { n: future.Z }), t('tl.auto'))}
          {bar(t('tl.S'), future.S / 4, t('tl.sText', { n: future.S }), t('tl.auto'))}
          <p className={css.muted}>{t('tl.tension', { value: future.tension.toFixed(2) })}</p>
        </div>
      )}
      {(event.causes ?? []).length > 0 && (
        <div className={css.causes}>
          <span className={css.muted}>{t('tl.causes')}</span>
          {event.causes!.map(id => <span key={id}>{all.find(row => row.id === id)?.title ?? id}</span>)}
        </div>
      )}
      {ids.length > 0 && (
        <div className={css.causes}>
          <span className={css.muted}>{t('tl.involves')}</span>
          {ids.map(id => <button key={id} type="button" className={css.chip} onClick={() => { openCard(id, data.names?.[id] ?? id) }}>{data.names?.[id] ?? id}</button>)}
        </div>
      )}
      {event.foreshadowId !== undefined && (
        <button type="button" className={css.chip} onClick={() => { openCard(event.foreshadowId!, event.title) }}>{t('tl.openForeshadow')}</button>
      )}
      {event.ideas > 0 && <p className={css.muted}>{t('tl.ideasNote', { count: event.ideas })}</p>}
      {future === undefined && event.status !== 'failed' && <p className={css.muted}>{t('tl.happenedNote')}</p>}
    </section>
  )
}
