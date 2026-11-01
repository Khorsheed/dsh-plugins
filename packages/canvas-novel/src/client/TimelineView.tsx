/**
 * 时间轴, the novel's view face (2026-11-01; it replaces 故事): the book's
 * events in story time. Left, what has happened (backstory first, then the
 * chapters' events, each with the chapter that wrote it); right, everything
 * to come grouped by priority — 临近 · 积压 · 就绪 · 饱和 · 搁置 — with the one
 * line that says why, and how the priority is worked out. Picking an event
 * shows its parts: the five tension components, its preconditions, its
 * causes, the people and places it names, the ideas bound to it.
 *
 * 按章节 lists the same events by the chapter that tells them (2026-11-02):
 * the two orders read one list, so they always agree; a flashback is marked
 * where story time and chapter order part. How priority is worked out sits
 * behind the ⓘ after the hint, not in a block of its own.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useState, type ReactNode } from 'react'
import { NOVEL_GENRE_ID, type NovelTimelineResult, type TimelineEventView, type TimelineFutureView } from '../types.ts'
import type { NovelSurfaceProps } from './contract.ts'
import { AlignBadge } from './AlignPage.tsx'
import { DeleteNode } from './DeleteNode.tsx'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './timeline.module.css'

type T = NovelSurfaceProps['t']
const TIERS = ['near', 'backlog', 'ready', 'sat', 'hold'] as const

/** The 时间轴 face (keyed `novel:story`); nothing on a canvas of another genre. */
export function TimelineView(props: NovelSurfaceProps): ReactNode {
  const [mode, setMode] = useState<'story' | 'chapters'>('story')
  const [info, setInfo] = useState(false)
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  const { t } = props
  return (
    <div className={css.page}>
      <div className={css.toolbar}>
        <div className={css.seg} role="group" aria-label={t('tl.mode')}>
          <button type="button" aria-pressed={mode === 'story'} onClick={() => { setMode('story') }}>{t('tl.byStory')}</button>
          <button type="button" aria-pressed={mode === 'chapters'} onClick={() => { setMode('chapters') }}>{t('tl.byChapter')}</button>
        </div>
        <span className={css.muted}>
          {mode === 'story' ? t('tl.storyHint') : t('tl.chapterHint')}
          {mode === 'story' && <button type="button" className={css.info} aria-expanded={info} aria-label={t('tl.ruleHead')} title={t('tl.ruleHead')} onClick={() => { setInfo(value => !value) }}>i</button>}
        </span>
        <AlignBadge {...props} />
        <NowTag {...props} />
        {info && mode === 'story' && (
          <div className={css.pop} role="dialog" aria-label={t('tl.ruleHead')}>
            <b>{t('tl.ruleHead')}</b>
            <p>{t('tl.formula')}</p>
            <ol>{(['sat', 'hold', 'near', 'backlog', 'ready'] as const).map(tier => <li key={tier}><b>{t(`tl.tier.${tier}`)}</b>　{t(`tl.when.${tier}`)}</li>)}</ol>
            <p className={css.muted}>{t('tl.ruleNote')}</p>
          </div>
        )}
      </div>
      {mode === 'story' ? <StoryTime {...props} /> : <ByChapter {...props} />}
    </div>
  )
}

/** Where the book stands. */
function NowTag({ canvasId, rev, remote, t }: NovelSurfaceProps): ReactNode {
  const read = useNovelRead(remote(), r => r.timeline({ canvasId }), `timeline:${canvasId}`, rev)
  if (read.state !== 'ready' || !read.value.ok) return null
  return <span className={css.nowTag}>{t('tl.now', { n: (read.value.chapter ?? 1) - 1 })}</span>
}

/** Past events told later than story order puts them (a flashback); every told backstory counts. */
function lateTold(past: readonly TimelineEventView[]): Set<string> {
  const told = (event: TimelineEventView): boolean => (event.chapters ?? []).length > 0
  const body = past.filter(event => event.backstory !== true && (told(event) || event.when !== undefined))
  const late = new Set<string>()
  let seen = Infinity
  for (const event of [...body].reverse()) {
    const first = event.chapters?.[0]
    if (first !== undefined && first > seen) late.add(event.id)
    if (first !== undefined) seen = Math.min(seen, first)
  }
  for (const event of past) if (event.backstory === true && told(event)) late.add(event.id)
  return late
}

/** 按章节: the same events, under the chapter that tells them. */
function ByChapter(props: NovelSurfaceProps): ReactNode {
  const { canvasId, rev, remote, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.timeline({ canvasId }), `timeline:${canvasId}`, rev)
  const chapters = useNovelRead(api, r => r.chapters({ canvasId }), `chapters:${canvasId}`, rev)
  const [picked, setPicked] = useState<string | null>(null)
  if (api === undefined) return null
  if (read.state === 'loading') return <div className={css.muted}>{t('state.loading')}</div>
  if (read.state === 'error') return <div className={css.warn}>{t('error.generic', { message: read.message })}</div>
  if (!read.value.ok) return <div className={css.warn}>{t(errorKey(read.value.error))}</div>
  const data = read.value
  const past = data.past ?? []
  const future = data.future ?? []
  const late = lateTold(past)
  const rows = chapters.state === 'ready' ? chapters.value.chapters : []
  const titleOf = new Map(rows.map(row => [row.chapter.n, row.chapter.title.replace(/^第\s*\d+\s*章\s*[·・:：]?\s*/, '')]))
  const planned = future.filter(event => (event.chapters ?? []).length > 0)
  const numbers = [...new Set([...rows.map(row => row.chapter.n), ...past.flatMap(event => event.chapters ?? []), ...planned.flatMap(event => event.chapters ?? [])])].sort((a, b) => a - b)
  const untold = past.filter(event => (event.chapters ?? []).length === 0)
  const all: readonly TimelineEventView[] = [...past, ...future]
  const lanes = data.lanes ?? []
  const laneIx = (event: TimelineEventView): number | undefined => lanes.length < 2 || event.lane === undefined ? undefined : (lanes.indexOf(event.lane) < 0 ? undefined : lanes.indexOf(event.lane))
  const row = (event: TimelineEventView, n?: number): ReactNode => (
    <EventRow key={`${event.id}:${n ?? 0}`} event={event} data={data} lane={laneIx(event)} late={false} max={1} mode="chapters"
      flag={event.backstory === true ? t('tl.flagBackstory') : late.has(event.id) ? t('tl.flagEarlier') : 'tier' in event ? t('tl.flagPlanned') : undefined}
      picked={picked === event.id} onPick={() => { setPicked(picked === event.id ? null : event.id) }} t={t} />
  )
  const chosen = all.find(event => event.id === picked)
  if (numbers.length === 0 && untold.length === 0) return <p className={css.empty}>{t('tl.pastEmpty')}</p>
  return (
    <>
      <div className={css.chapList}>
        {numbers.map(n => {
          const here = [...past.filter(event => event.chapters?.includes(n)), ...planned.filter(event => event.chapters?.includes(n))]
          return (
            <section key={n} className={css.chapBlock}>
              <header className={css.chapHead}><span>{t('strip.chapter', { n })}</span><b>{titleOf.get(n) ?? ''}</b><span>{t('tl.count', { count: here.length })}</span></header>
              {here.length === 0 ? <p className={css.empty}>{t('tl.chapterNone')}</p> : here.map(event => row(event, n))}
            </section>
          )
        })}
        {untold.length > 0 && (
          <section className={css.chapBlock}>
            <header className={css.chapHead}><span>{t('tl.untold')}</span></header>
            {untold.map(event => row(event))}
          </section>
        )}
      </div>
      {chosen !== undefined && <EventDetail event={chosen} data={data} all={all} openCard={props.navigate.openCard} del={chosen.id.startsWith('fs:') || chosen.recap === true ? null : <DeleteNode {...props} node={chosen.id} onDeleted={() => { setPicked(null) }} />} t={t} />}
    </>
  )
}

function StoryTime(props: NovelSurfaceProps): ReactNode {
  const { canvasId, rev, remote, t, sessionId } = props
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
  const lanes = data.lanes ?? []
  const laneIx = (event: TimelineEventView): number | undefined => {
    if (lanes.length < 2 || event.lane === undefined) return undefined
    const ix = lanes.indexOf(event.lane)
    return ix < 0 ? undefined : ix
  }
  const max = Math.max(0.0001, ...future.map(event => event.tension))
  const row = (event: TimelineEventView): ReactNode => (
    <EventRow key={event.id} event={event} data={data} lane={laneIx(event)} late={late.has(event.id)} max={max} picked={picked === event.id} onPick={() => { setPicked(picked === event.id ? null : event.id) }} t={t} />
  )
  // 故事开始前 is what the event says it is (backstory), not a missing
  // chapter; an event no chapter tells and no story time places waits in
  // 时间待定. 正文 is in story order, so a flashback shows where it happened,
  // marked with the later chapter that tells it.
  const told = (event: TimelineEventView): boolean => (event.chapters ?? []).length > 0
  const before = past.filter(event => event.backstory === true)
  const body = past.filter(event => event.backstory !== true && (told(event) || event.when !== undefined))
  const undated = past.filter(event => event.backstory !== true && !told(event) && event.when === undefined)
  const late = lateTold(past)
  const backfill = data.backfill ?? []
  return (
    <>
      <div className={css.columns}>
        <section className={css.column}>
          <h3 className={css.colHead}>{t('tl.past')}{past.some(event => event.recap !== true) && <span className={css.muted}> {past.filter(event => event.recap !== true).length}</span>}</h3>
          {lanes.length >= 2 && (
            <div className={css.legend}>
              <span className={css.muted}>{t('tl.lanes')}</span>
              {lanes.slice(0, 4).map((id, ix) => <span key={id} className={css.laneKey} data-lane={ix}>{data.names?.[id] ?? id}</span>)}
            </div>
          )}
          {backfill.length > 0 && (
            <div className={css.backfill}>
              <span>{t('tl.backfill', { list: chapterList(backfill) })}</span>
              {sessionId !== undefined && props.sendToConversation !== undefined && (
                <button type="button" className={`${css.button} ${css.primary}`} onClick={() => { props.sendToConversation?.(sessionId, t('tl.backfillAsk', { list: chapterList(backfill) })) }}>{t('tl.backfillBtn')}</button>
              )}
            </div>
          )}
          {past.length === 0 && <p className={css.empty}>{t('tl.pastEmpty')}</p>}
          {before.length > 0 && <div className={css.tier}><div className={css.tierHead}><b className={css.era}>{t('tl.era.before')}</b></div>{before.map(row)}</div>}
          {body.length > 0 && <div className={css.tier}><div className={css.tierHead}><b className={css.era}>{t('tl.era.body')}</b></div>{body.map(row)}</div>}
          {undated.length > 0 && (
            <div className={css.tray}>
              <div className={css.tierHead}><b className={css.era}>{t('tl.undated')}</b><span className={css.muted}>{t('tl.undatedHint')}</span></div>
              {undated.map(row)}
            </div>
          )}
        </section>
        <div className={css.now} aria-hidden="true" />
        <section className={css.column}>
          <h3 className={css.colHead}>{t('tl.future')}<span className={css.muted}> {future.length}</span></h3>
          {future.length === 0
            ? <p className={css.empty}>{t('tl.futureEmpty')}</p>
            : TIERS.map(tier => {
              const rows = future.filter(event => event.tier === tier).sort((a, b) => b.tension - a.tension)
              if (rows.length === 0) return null
              return (
                <div key={tier} className={css.tier} data-tier={tier}>
                  <div className={css.tierHead}><b>{t(`tl.tier.${tier}`)} {rows.length}</b><span className={css.muted}>{t(`tl.tierHint.${tier}`)}</span></div>
                  {rows.map(row)}
                </div>
              )
            })}
        </section>
      </div>
      {chosen !== undefined && <EventDetail event={chosen} data={data} all={all} openCard={props.navigate.openCard} del={chosen.id.startsWith('fs:') || chosen.recap === true ? null : <DeleteNode {...props} node={chosen.id} onDeleted={() => { setPicked(null) }} />} t={t} />}
    </>
  )
}

/** 1、2、3、5 → 1–3、5 */
function chapterList(ns: readonly number[]): string {
  const out: string[] = []
  for (let i = 0; i < ns.length; i++) {
    let j = i
    while (j + 1 < ns.length && ns[j + 1] === ns[j]! + 1) j++
    out.push(j > i + 1 ? `${ns[i]}–${ns[j]}` : j === i + 1 ? `${ns[i]}、${ns[j]}` : `${ns[i]}`)
    i = j
  }
  return out.join('、')
}

function EventRow({ event, data, lane, late, max, picked, onPick, t, mode = 'story', flag }: {
  readonly event: TimelineEventView
  readonly data: NovelTimelineResult
  readonly lane: number | undefined
  readonly late: boolean
  readonly mode?: 'story' | 'chapters'
  readonly flag?: string | undefined
  readonly max: number
  readonly picked: boolean
  readonly onPick: () => void
  readonly t: T
}): ReactNode {
  const future = 'tier' in event ? event as TimelineFutureView : undefined
  const who = (event.who ?? []).map(id => data.names?.[id] ?? id)
  const places = (event.places ?? []).map(id => data.names?.[id] ?? id)
  return (
    <button type="button" className={css.event} data-status={event.status} data-tier={future?.tier} data-lane={lane} data-recap={event.recap === true || undefined} aria-current={picked || undefined} onClick={onPick}>
      <span className={css.title}>{event.title}</span>
      <span className={css.meta}>
        {mode === 'story' && event.chapters !== undefined && event.chapters.length > 0 && future === undefined && !late && <span className={css.chapDot}>{event.chapters.join('·')}</span>}
        {flag !== undefined && <span className={css.toldLate}>{flag}</span>}
        {late && <span className={css.toldLate}>{t('tl.toldIn', { n: event.chapters!.join('、') })}</span>}
        {event.recap === true && <span className={css.src}>{t('tl.recap')}</span>}
        {event.source !== undefined && <span className={css.src}>{event.source}</span>}
        {event.status === 'hidden' && <span className={css.src}>{t('tl.hidden')}</span>}
        {event.when !== undefined && <span className={css.when}>{event.when}</span>}
        {places.length > 0 && <span className={css.where}>{places.join("、")}</span>}
        {who.length > 0 && <span>{who.join('、')}</span>}
        {future !== undefined && event.window !== undefined && <span>· {event.window}</span>}
        {event.status === 'failed' && <span className={css.failed}>{t('tl.failed')}</span>}
        {event.ideas > 0 && <span className={css.ideaMark}>{t('tl.ideas', { count: event.ideas })}</span>}
      </span>
      {future !== undefined && mode === 'story' && (
        <span className={css.tension}>
          <span className={css.bar}><i style={{ width: `${Math.max(4, Math.round(future.tension / max * 100))}%` }} /></span>
          <span className={css.reason}>{future.reason}</span>
        </span>
      )}
    </button>
  )
}

function EventDetail({ event, data, all, openCard, del, t }: {
  readonly event: TimelineEventView
  readonly data: NovelTimelineResult
  readonly all: readonly TimelineEventView[]
  readonly openCard: (cardId: string, heading: string) => void
  readonly del: ReactNode
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
        <span className={css.grow} />{del}
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
      {event.evidence !== undefined && <blockquote className={css.quote}>{event.evidence}</blockquote>}
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
