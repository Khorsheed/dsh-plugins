/**
 * The 章节 face of a 长篇小说 canvas: the work as a book (2026-11-02 改版稿).
 * 接下来 on top says what to do, in order — changes to align, chapters waiting
 * for 对账, items waiting for the person, then the earliest unfinished chapter.
 * Only the first actionable step is primary; the next chapter's candidates join
 * once every existing chapter is reconciled. Below, each volume: a cell per
 * planned chapter in its phase's color (a gap where the goal's segment ends),
 * the goal's current segment (the whole goal folds behind it), and the
 * chapters with a one-line recap; a state shows only when it needs something.
 * 新建第 N 章 offers your own manuscript or an Agent plan in the last row. The 全部 / 待处理 / 未对账 chips appear
 * on a long book only. A row opens the chapter reader in place; the reader's
 * 目录 comes back here. A work without chapters tells the canvas (`onEmpty`),
 * which then opens on 设定.
 *
 * The face is also where every chapter destination lands (proposal
 * 2026-10-30-agent-sidebar-navigation): the canvas hands an outside ask down
 * as `target` (a chapter number, on its plan or its text), and the reader
 * opens there — one place for a chapter, never a separate detail page.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { ChipRow } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { NOVEL_GENRE_ID, volumeNumeral, type ChapterRow, type EffectiveChapterPhase } from '../types.ts'
import { goalSegments } from './PlanView.tsx'
import { bareTitle, ChapterReader } from './ChapterReader.tsx'
import { ALIGN_PAGE, type ChapterTarget, type NovelSurfaceProps } from './contract.ts'
import { awaitsReconcile } from './NovelFaces.tsx'
import { PendingList } from './PendingList.tsx'
import { useNovelRead } from './use-novel.ts'
import { ImportNovel } from './ImportNovel.tsx'
import css from './novel.module.css'
import book from './book.module.css'

const GROUP = 10
/** The 全部 / 待处理 / 未对账 chips only earn their row on a long book. */
const FILTER_FROM = 12

type Filter = 'all' | 'todo' | 'open'

/**
 * The asks each canvas's face already answered, page-wide: the face remounts
 * on every face switch, and the canvas keeps its last ask until the next strip
 * write — answering it again would pull the reader back to that chapter.
 */
const answered = new Map<string, number>()

/** The 章节 entry. */
export function ChapterBook(props: NovelSurfaceProps & {
  readonly onEmpty?: (() => void) | undefined
  /** An outside ask: show this chapter (a destination, a card's door). */
  readonly target?: ChapterTarget | undefined
}): ReactNode {
  const { canvasId, target } = props
  const asked = target === undefined || (answered.get(canvasId) ?? 0) >= target.n ? undefined : target
  const [reading, setReading] = useState<{ n: number; focusPlan: boolean; editing?: boolean } | null>(() => readingOf(asked))
  useEffect(() => {
    if (asked === undefined) return
    answered.set(canvasId, asked.n)
    const next = readingOf(asked)
    if (next !== null) setReading(next)
  }, [asked, canvasId])
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  if (reading !== null) {
    return (
      <ChapterReader
        {...props}
        n={reading.n}
        focusPlan={reading.focusPlan}
        editing={reading.editing === true}
        onEditingChange={editing => { setReading(current => current === null || current.n !== reading.n ? current : { n: current.n, focusPlan: current.focusPlan, ...(editing ? { editing: true } : {}) }) }}
        onGo={n => { setReading({ n, focusPlan: false }) }}
        onToc={() => { setReading(null) }}
      />
    )
  }
  return <Contents {...props} onRead={(n, editing, focusPlan) => { setReading({ n, focusPlan: focusPlan === true, ...(editing === true ? { editing: true } : {}) }) }} />
}

/** The reader position an ask names, or null for an unreadable one. */
function readingOf(target: ChapterTarget | undefined): { n: number; focusPlan: boolean } | null {
  const n = target === undefined ? NaN : parseInt(target.item, 10)
  return Number.isFinite(n) ? { n, focusPlan: target!.focus === 'plan' } : null
}

/**
 * Whether a chapter still needs something: its text waits for a 对账, or it
 * holds pending items left from before 对账 stopped asking (2026-10-09).
 */
function needsPerson(row: ChapterRow, pending: Readonly<Record<number, number>>): boolean {
  return (pending[row.chapter.n] ?? 0) > 0 || awaitsReconcile(row.phase)
}

/** A chapter whose memory is caught up (已对账; a 已审过 from before counts the same). */
function settled(phase: EffectiveChapterPhase): boolean {
  return phase === 'extracted' || phase === 'reviewed'
}

function Contents(props: NovelSurfaceProps & {
  readonly onRead: (n: number, editing?: boolean, focusPlan?: boolean) => void
  readonly onEmpty?: (() => void) | undefined
}): ReactNode {
  const { canvasId, rev, navigate, sessionId, remote, t, onRead, onEmpty } = props
  return <ContentsBody {...props} canvasId={canvasId} rev={rev} navigate={navigate} sessionId={sessionId} remote={remote} t={t} onRead={onRead} onEmpty={onEmpty} />
}

function ContentsBody({ canvasId, rev, navigate, sessionId, remote, t, onRead, onEmpty, ...rest }: NovelSurfaceProps & {
  readonly onRead: (n: number, editing?: boolean, focusPlan?: boolean) => void
  readonly onEmpty?: (() => void) | undefined
}): ReactNode {
  const api = remote()
  const read = useNovelRead(api, r => r.chapters({ canvasId }), `chapters:${canvasId}`, rev)
  const queue = useNovelRead(api, r => r.pending({ canvasId }), `pending:${canvasId}`, rev)
  const outlineRead = useNovelRead(api, r => r.outline({ canvasId }), `outline:${canvasId}`, rev)
  const alignRead = useNovelRead(api, r => r.align({ canvasId }), `align:${canvasId}`, rev)
  const surface = { ...rest, canvasId, rev, navigate, sessionId, remote, t } as NovelSurfaceProps
  const [filter, setFilter] = useState<Filter>('all')
  const [queueOpen, setQueueOpen] = useState(false)
  const empty = read.state === 'ready' && read.value.chapters.length === 0
  useEffect(() => { if (empty) onEmpty?.() }, [empty, onEmpty])
  // Explicit open/closed choices per group; unset groups follow the default.
  const [toggled, setToggled] = useState<Record<number, boolean>>({})
  if (api === undefined) return null
  if (read.state === 'loading') return <div className={css.book}><div className={css.muted}>{t('state.loading')}</div></div>
  if (read.state === 'error') return <div className={css.book}><div className={css.warn}>{t('error.generic', { message: read.message })}</div></div>
  const { chapters: rows, pending } = read.value
  if (rows.length === 0) {
    return (
      <div className={css.book} data-canvas-scroll="novel-book">
        <div className={css.bookEmpty}>{t('toc.empty')}</div>
        <ImportNovel {...surface} />
        <NewOwnChapter {...surface} n={1} onPlan={sessionId !== undefined && rest.sendToConversation !== undefined ? () => { rest.sendToConversation?.(sessionId, t('cand.planAsk', { n: 1 })) } : undefined} onCreated={n => { onRead(n, true) }} />
      </div>
    )
  }
  const writing = rows.find(item => !settled(item.phase) && !awaitsReconcile(item.phase))
  const stale = rows.filter(item => awaitsReconcile(item.phase))
  const items = queue.state === 'ready' ? queue.value.items : []
  // Volumes head the list when the outline has them (2026-11-01: 规划's roadmap lives here); else groups of ten.
  const outlineDoc = outlineRead.state === 'ready' && outlineRead.value.ok ? outlineRead.value.outline : undefined
  // A book whose outline is still a proposal groups by the proposed volumes (2026-11-01: 《潜梦者》 showed 「第 1–5 章」).
  const volumes = outlineDoc === undefined ? [] : outlineDoc.volumes.length > 0 ? outlineDoc.volumes : outlineDoc.proposal?.volumes ?? []
  const groups: { rows: ChapterRow[]; volume?: { index: number; title: string; planned?: number; goal?: string; landing?: string } }[] = []
  if (volumes.length > 0) {
    volumes.forEach((volume, index) => {
      const inVolume = rows.filter(item => (item.chapter.volume ?? volumes[0]!.id) === volume.id)
      groups.push({ rows: inVolume, volume: { index: index + 1, title: volume.title, ...(volume.chapters === undefined ? {} : { planned: volume.chapters }), ...(volume.goal === undefined ? {} : { goal: volume.goal }), ...(volume.landing === undefined ? {} : { landing: volume.landing }) } })
    })
    const loose = rows.filter(item => item.chapter.volume !== undefined && !volumes.some(volume => volume.id === item.chapter.volume))
    if (loose.length > 0) groups.push({ rows: loose })
  } else {
    for (let index = 0; index < rows.length; index += GROUP) groups.push({ rows: rows.slice(index, index + GROUP) })
  }
  const row = (item: ChapterRow): ReactNode => (
    <ChapterLine key={item.chapter.n} row={item} pending={pending[item.chapter.n] ?? 0} onRead={onRead} t={t} />
  )
  const nextN = Math.max(...rows.map(item => item.chapter.n)) + 1
  const send = (text: string): void => { if (sessionId !== undefined) rest.sendToConversation?.(sessionId, text) }
  const canSend = sessionId !== undefined && rest.sendToConversation !== undefined
  const draft = (text: string): void => { if (sessionId !== undefined) rest.draftToConversation?.(sessionId, text) }
  const canDraft = sessionId !== undefined && rest.draftToConversation !== undefined
  const lastGroup = groups.reduce((at, group, index) => group.rows.length > 0 ? index : at, groups.length - 1)

  // 接下来: what to do, in order; only the first actionable step is primary.
  const steps: { key: string; title: string; sub: string; acts: ((primary: boolean) => ReactNode) | null; body?: (primary: boolean) => ReactNode }[] = []
  const toAlign = alignRead.state === 'ready' && alignRead.value.ok ? (alignRead.value.items ?? []).length : 0
  if (toAlign > 0) {
    steps.push({
      key: 'align', title: t('next.align', { count: toAlign }), sub: t('next.alignSub'),
      acts: primary => <Button size="sm" variant={primary ? 'primary' : 'outline'} onClick={() => { navigate.openPage(ALIGN_PAGE, t('align.title')) }}>{t('next.alignGo')}</Button>,
    })
  }
  if (stale.length > 0) {
    const first = stale[0]!.chapter
    steps.push({
      key: 'stale',
      title: stale.length === 1
        ? t('next.stale', { n: first.n, title: bareTitle(first.n, first.title) })
        : t('next.staleMany', { list: stale.map(item => item.chapter.n).join('、') }),
      sub: t('next.staleSub'),
      acts: canDraft ? primary => <Button size="sm" variant={primary ? 'primary' : 'outline'} onClick={() => { draft(t('next.reconcileAsk', { list: stale.map(item => item.chapter.n).join('、') })) }}>{t('next.reconcile')}</Button> : null,
    })
  }
  if (items.length > 0) {
    steps.push({
      key: 'queue', title: t('next.queue', { count: items.length }), sub: t('next.queueSub'),
      acts: primary => <Button size="sm" variant={primary ? 'primary' : 'outline'} aria-expanded={queueOpen} onClick={() => { setQueueOpen(value => !value) }}>{queueOpen ? t('next.fold') : t('next.look')}</Button>,
      ...(queueOpen ? { body: () => <PendingList canvasId={canvasId} items={items} navigate={navigate} sessionId={sessionId} remote={api} t={t} /> } : {}),
    })
  }
  if (writing !== undefined) {
    const c = writing.chapter
    const planning = writing.phase === 'planning'
    const planned = c.plan !== undefined
    steps.push({
      key: 'current',
      title: t(planning ? (planned ? 'next.planReady' : 'next.planning') : 'next.writing', { n: c.n, title: bareTitle(c.n, c.title) }),
      sub: t(planning ? (planned ? 'next.planReadySub' : 'next.planningSub') : 'next.writingSub'),
      acts: primary => <Button size="sm" variant={primary ? 'primary' : 'outline'} onClick={() => { onRead(c.n, undefined, planning) }}>{t(planning ? 'next.seePlan' : 'toc.continue')}</Button>,
    })
  }
  if (rows.every(item => settled(item.phase))) {
    steps.push({
      key: 'cand',
      title: t('next.cand', { n: nextN }),
      sub: '',
      acts: null,
      body: primary => <NextCandidates {...surface} chapter={nextN} primary={primary} onPlan={canSend ? () => { send(t('cand.planAsk', { n: nextN })) } : undefined} />,
    })
  }
  const primaryAt = steps.findIndex(step => step.acts !== null || step.body !== undefined)

  return (
    <div className={css.book} data-canvas-scroll="novel-book">
      <section className={book.next}>
        <div className={book.nextHead}>{t('next.heading')}</div>
        {steps.map((step, index) => {
          const primary = index === primaryAt
          return (
            <div key={step.key} className={book.step} data-first={primary || undefined}>
              <span className={book.stepN}>{index + 1}</span>
              <span className={book.stepWhat}>
                <b>{step.title}</b>
                {step.sub !== '' && <span>{step.sub}</span>}
              </span>
              {step.acts !== null && <span className={book.stepActs}>{step.acts(primary)}</span>}
              {step.body !== undefined && <div className={book.stepBody}>{step.body(primary)}</div>}
            </div>
          )
        })}
      </section>
      {rows.length > FILTER_FROM && (
        <ChipRow<Filter>
          className={css.filters}
          label={t('toc.filter.label')}
          value={filter}
          onSelect={setFilter}
          chips={([['all', rows.length], ['todo', rows.filter(item => needsPerson(item, pending)).length], ['open', rows.filter(item => !settled(item.phase)).length]] as const).map(([id, count]) => ({ id, label: t(`toc.filter.${id}Label`), count }))}
        />
      )}
      {filter !== 'all' ? (
        <div className={book.chs}>
          {(filter === 'todo' ? rows.filter(item => needsPerson(item, pending)) : rows.filter(item => !settled(item.phase))).map(row)}
        </div>
      ) : groups.map(({ rows: group, volume }, index) => {
        if (group.length === 0 && volume === undefined) return null
        const first = group[0]?.chapter.n ?? 0
        const last = group.at(-1)?.chapter.n ?? 0
        const isOpen = toggled[index] ?? (index === lastGroup || group.some(item => !settled(item.phase)))
        const segs = volume?.goal === undefined ? [] : goalSegments(volume.goal)
        const ends = new Set(segs.flatMap(seg => { const m = /–(\d+)/.exec(seg.range ?? ''); return m === null ? [] : [Number(m[1])] }))
        const latest = Math.max(0, ...group.filter(item => item.phase !== 'planning').map(item => item.chapter.n))
        const here = segs.find(seg => { const m = /(\d+)–(\d+)/.exec(seg.range ?? ''); return m !== null && latest >= Number(m[1]) && latest <= Number(m[2]) }) ?? segs[0]
        const cellsCount = Math.max(volume?.planned ?? 0, group.length)
        const start = first === 0 ? 1 : first
        return (
          <section key={volume === undefined ? `g${first}` : `v${volume.index}`} className={book.vol}>
            <button type="button" className={book.volHead} aria-expanded={isOpen} onClick={() => { setToggled(all => ({ ...all, [index]: !isOpen })) }}>
              <h3>
                {volume === undefined
                  ? (groups.some(other => other.volume !== undefined) ? t('toc.noVolume') : t('toc.group', { from: first, to: last }))
                  : t('toc.volume', { index: volumeNumeral(volume.index), title: volume.title.replace(/^第[一二三四五六七八九十\d]+卷\s*[·・:：]?\s*/, '') })}
              </h3>
              <span>{volume?.planned !== undefined ? t('toc.volumeSum', { planned: volume.planned, done: group.filter(item => settled(item.phase)).length }) : t('toc.groupCount', { count: group.length })}</span>
            </button>
            {volume !== undefined && cellsCount > 0 && (
              <div className={book.cells} style={{ gridTemplateColumns: `repeat(${cellsCount}, minmax(0, 1fr))` }} aria-hidden="true">
                {Array.from({ length: cellsCount }, (_, i) => {
                  const n = start + i
                  const at = group.find(item => item.chapter.n === n)
                  return <i key={n} data-s={at === undefined ? undefined : tocState(at.phase)} data-end={ends.has(n) || undefined} title={at === undefined ? undefined : `${t('strip.chapter', { n })} · ${phaseLabel(at, pending, t)}`} />
                })}
              </div>
            )}
            {isOpen && here !== undefined && (
              <details className={book.goal}>
                <summary>
                  <span className={book.goalNow}>{here.range === undefined ? t('next.goalHead') : t('next.goalNow', { range: here.range })}</span>
                  <span className={book.goalText}>{here.text}</span>
                  {segs.length > 1 && <span className={book.goalMore}>{t('next.goalAll')}</span>}
                </summary>
                {segs.map((seg, segIndex) => (
                  <div key={segIndex} className={book.goalRow} data-now={seg === here || undefined}><b>{seg.range ?? ''}</b><span>{seg.text}</span></div>
                ))}
                {volume?.landing !== undefined && <div className={book.goalRow}><b>{t('next.landing')}</b><span>{volume.landing}</span></div>}
              </details>
            )}
            {isOpen && (
              <div className={book.chs}>
                {group.map(row)}
                {index === lastGroup && <ImportNovel {...surface} />}
                {index === lastGroup && <NewOwnChapter {...surface} n={nextN} onPlan={canSend ? () => { send(t('cand.planAsk', { n: nextN })) } : undefined} onCreated={n => { onRead(n, true) }} />}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/**
 * 下一章候选, as the last step of 接下来: one line with the count and the
 * strongest candidate; 看候选 opens the list with 优先推进 / 本章屏蔽.
 */
function NextCandidates(props: NovelSurfaceProps & { readonly chapter: number; readonly primary: boolean; readonly onPlan: (() => void) | undefined }): ReactNode {
  const { canvasId, rev, remote, sessionId, navigate, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.timeline({ canvasId }), `timeline:${canvasId}`, rev)
  const [open, setOpen] = useState(false)
  if (api === undefined || read.state !== 'ready' || !read.value.ok) return null
  const data = read.value
  const chapter = props.chapter
  const future = data.future ?? []
  const prefer = data.pins?.prefer ?? []
  const block = data.pins?.block ?? []
  const shown = [...future].sort((a, b) => Number(prefer.includes(b.id)) - Number(prefer.includes(a.id))
    || ['near', 'backlog', 'ready', 'sat', 'hold'].indexOf(a.tier) - ['near', 'backlog', 'ready', 'sat', 'hold'].indexOf(b.tier) || b.tension - a.tension)
  const pin = (id: string, kind: 'prefer' | 'block'): void => {
    if (sessionId === undefined) return
    const toggle = (list: readonly string[]): string[] => list.includes(id) ? list.filter(item => item !== id) : [...list, id]
    void api.setRecallPins(sessionId, {
      canvasId, chapter,
      prefer: kind === 'prefer' ? toggle(prefer) : prefer.filter(item => item !== id),
      block: kind === 'block' ? toggle(block) : block.filter(item => item !== id),
    }).then(() => { navigate.refresh() })
  }
  return (
    <div className={book.cand}>
      <div className={book.candLine}>
        <span className={book.candSum}>{shown.length === 0 ? t('cand.empty') : t('next.candSum', { count: shown.length, top: shown[0]!.title })}</span>
        <span className={book.stepActs}>
          {shown.length > 0 && <Button size="sm" variant="outline" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>{open ? t('next.fold') : t('next.seeCand')}</Button>}
          {props.onPlan !== undefined && <Button size="sm" variant={props.primary ? 'primary' : 'outline'} onClick={props.onPlan}>{t('cand.plan', { n: chapter })}</Button>}
        </span>
      </div>
      {open && (
        <div className={css.cands}>
          <p className={css.muted}>{t('cand.hint')}</p>
          {shown.map(event => (
            <div key={event.id} className={css.cand} data-tier={event.tier} data-blocked={block.includes(event.id) || undefined}>
              <span className={css.candTier}>{t(`tl.tier.${event.tier}`)}</span>
              <span className={css.candText}><b>{event.title}</b><small>{event.reason}</small></span>
              {sessionId !== undefined && (
                <span className={css.candPins}>
                  <button type="button" aria-pressed={prefer.includes(event.id)} onClick={() => { pin(event.id, 'prefer') }}>{t('cand.prefer')}</button>
                  <button type="button" aria-pressed={block.includes(event.id)} onClick={() => { pin(event.id, 'block') }}>{t('cand.block')}</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 新建第 N 章: choose your own manuscript or an Agent plan; your own manuscript asks for a title first. */
function NewOwnChapter(props: NovelSurfaceProps & { readonly n: number; readonly onCreated: (n: number) => void; readonly onPlan?: (() => void) | undefined }): ReactNode {
  const { canvasId, remote, sessionId, navigate, t } = props
  const api = remote()
  const [title, setTitle] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  if (api === undefined || sessionId === undefined) return null
  if (title === null) {
    return (
      <div className={book.chAdd}>
        <span className={book.chNo}>＋</span>
        <span className={book.chAddText}>{t('toc.newChapter', { n: props.n })}<small>{t('toc.newChoices')}</small></span>
        <span className={book.chAddActions}>
          <Button size="sm" variant="outline" onClick={() => { setTitle('') }}>{t('toc.newOwnAction')}</Button>
          {props.onPlan !== undefined && <Button size="sm" variant="outline" onClick={props.onPlan}>{t('cand.plan', { n: props.n })}</Button>}
        </span>
      </div>
    )
  }
  return (
    <div className={book.ownRow}>
      <input className={css.ownInput} aria-label={t('toc.newOwnTitle')} placeholder={t('toc.newOwnTitle')} value={title} onChange={event => { setTitle(event.target.value) }} />
      <Button
        size="sm"
        variant="primary"
        disabled={title.trim() === ''}
        onClick={() => {
          void api.newOwnChapter(sessionId, { canvasId, title: title.trim() }).then(result => {
            if (!result.ok) { setFailure(t('error.generic', { message: result.error.message })); return }
            if (!result.value.ok || result.value.n === undefined) { setFailure(t('error.generic', { message: result.value.error ?? '' })); return }
            navigate.refresh()
            setTitle(null)
            props.onCreated(result.value.n)
          })
        }}
      >
        {t('toc.newOwnGo')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => { setTitle(null) }}>{t('edit.cancel')}</Button>
      {failure !== null && <span className={css.warn}>{failure}</span>}
    </div>
  )
}

/** One chapter: number, title, its one-line recap (or the plan's summary); a state only when it needs something. */
function ChapterLine({ row, pending, onRead, t }: {
  readonly row: ChapterRow
  readonly pending: number
  readonly onRead: (n: number, editing?: boolean, focusPlan?: boolean) => void
  readonly t: TranslateNS<'novel'>
}): ReactNode {
  const { chapter, phase } = row
  const state = tocState(phase)
  const line = chapter.recap ?? (chapter.plan === undefined ? undefined : t('next.planLine', { text: chapter.plan.summary }))
  return (
    <button type="button" className={book.ch} onClick={() => { onRead(chapter.n, undefined, phase === 'planning') }}>
      <span className={book.chNo}>{t('strip.chapter', { n: chapter.n })}</span>
      <span className={book.chTitle}>
        {bareTitle(chapter.n, chapter.title)}
        {chapter.byUser === true && <span className={css.byUserTag} title={t('chapter.byUserTitle')}>{t('chapter.byUser')}</span>}
      </span>
      <span className={book.chSide}>
        {(pending > 0 || state !== 'done') && <span className={book.pill} data-state={pending > 0 ? 'wait' : state}>{pending > 0 ? t('strip.pending', { count: pending }) : t(`toc.state.${state}`)}</span>}
        {chapter.wordCount !== undefined && <span>{t('chapter.words', { count: chapter.wordCount })}</span>}
      </span>
      {line !== undefined && <span className={book.chLine}>{line}</span>}
    </button>
  )
}

/** The contents' three states (and a missing text): 已对账, 待对账, 计划. */
function tocState(phase: EffectiveChapterPhase): 'done' | 'wait' | 'plan' | 'missing' {
  if (settled(phase)) return 'done'
  if (awaitsReconcile(phase)) return 'wait'
  return phase === 'planning' ? 'plan' : 'missing'
}

function phaseLabel(row: ChapterRow, pending: Readonly<Record<number, number>>, t: TranslateNS<'novel'>): string {
  const count = pending[row.chapter.n] ?? 0
  return count > 0 ? t('strip.pending', { count }) : t(`phase.${row.phase === 'reviewed' ? 'extracted' : row.phase}`)
}
