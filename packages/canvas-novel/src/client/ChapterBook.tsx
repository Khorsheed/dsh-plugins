/**
 * The 章节 face of a 长篇小说 canvas: the work as a book. The contents page
 * shows the whole work at a glance (a spine of one tick per chapter, colored by
 * phase, red where something waits for review), the chapter to pick up at with
 * 继续写 (and, while chapters wait for 对账, a line saying the model clears
 * them first), the pending queue folded under its count, a filter for the
 * chapters that need the person, and the chapters in groups of ten (a group
 * opens by itself while it has work in it, and the last one always), each
 * marked 已对账 / 待对账 / 计划. A row opens the chapter reader in place; the
 * reader's 目录 comes back here. A work without chapters tells the canvas
 * (`onEmpty`), which then opens on 设定.
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
import { ChipRow } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { NOVEL_GENRE_ID, volumeNumeral, type ChapterRow, type EffectiveChapterPhase } from '../types.ts'
import { goalSegments } from './PlanView.tsx'
import { bareTitle, ChapterReader } from './ChapterReader.tsx'
import type { ChapterTarget, NovelSurfaceProps } from './contract.ts'
import { awaitsReconcile } from './NovelFaces.tsx'
import { currentChapter, PendingList } from './PendingList.tsx'
import { useNovelRead } from './use-novel.ts'
import css from './novel.module.css'

const GROUP = 10

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
  return <Contents {...props} onRead={(n, editing) => { setReading({ n, focusPlan: false, ...(editing === true ? { editing: true } : {}) }) }} />
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
  readonly onRead: (n: number, editing?: boolean) => void
  readonly onEmpty?: (() => void) | undefined
}): ReactNode {
  const { canvasId, rev, navigate, sessionId, remote, t, onRead, onEmpty } = props
  return <ContentsBody {...props} canvasId={canvasId} rev={rev} navigate={navigate} sessionId={sessionId} remote={remote} t={t} onRead={onRead} onEmpty={onEmpty} />
}

function ContentsBody({ canvasId, rev, navigate, sessionId, remote, t, onRead, onEmpty, ...rest }: NovelSurfaceProps & {
  readonly onRead: (n: number, editing?: boolean) => void
  readonly onEmpty?: (() => void) | undefined
}): ReactNode {
  const api = remote()
  const read = useNovelRead(api, r => r.chapters({ canvasId }), `chapters:${canvasId}`, rev)
  const queue = useNovelRead(api, r => r.pending({ canvasId }), `pending:${canvasId}`, rev)
  const outlineRead = useNovelRead(api, r => r.outline({ canvasId }), `outline:${canvasId}`, rev)
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
        <NewOwnChapter {...surface} onCreated={n => { onRead(n, true) }} />
      </div>
    )
  }
  const words = rows.reduce((sum, row) => sum + (row.chapter.wordCount ?? 0), 0)
  const reviewed = rows.filter(row => settled(row.phase)).length
  const todo = rows.filter(row => needsPerson(row, pending))
  const open = rows.filter(row => !settled(row.phase))
  const current = currentChapter(rows, pending)!
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

  return (
    <div className={css.book} data-canvas-scroll="novel-book">
      <div className={css.bookHead}>
        <div className={css.bookStat}>{t('toc.stat', { count: rows.length, words: formatWords(words, t), reviewed })}</div>
        <div className={css.spine} style={{ gridTemplateColumns: `repeat(${Math.max(rows.length, 20)}, 1fr)` }}>
          {rows.map(item => (
            <button
              key={item.chapter.n}
              type="button"
              className={css.tick}
              data-phase={item.phase === 'reviewed' ? 'extracted' : item.phase}
              data-todo={(pending[item.chapter.n] ?? 0) > 0 || undefined}
              title={`${t('strip.chapter', { n: item.chapter.n })} ${bareTitle(item.chapter.n, item.chapter.title)} · ${phaseLabel(item, pending, t)}`}
              aria-label={t('strip.chapter', { n: item.chapter.n })}
              onClick={() => { onRead(item.chapter.n) }}
            />
          ))}
        </div>
        <div className={css.legend}>
          {(['extracted', 'stale', 'writing', 'planning'] as const).map(kind => (
            <span key={kind} data-kind={kind}>{t(`toc.legend.${kind}`)}</span>
          ))}
        </div>
      </div>
      <div className={css.resume}>
        <div className={css.resumeText}>
          <span className={css.resumeTitle}>
            {t('strip.chapter', { n: current.chapter.n })} · {bareTitle(current.chapter.n, current.chapter.title)}
          </span>
          <small>
            {[
              current.chapter.byUser === true ? t('toc.byUser') : undefined,
              current.chapter.wordCount === undefined ? undefined : t('chapter.words', { count: current.chapter.wordCount }),
              t(`toc.state.${tocState(current.phase)}`),
            ].filter(Boolean).join(' · ')}
          </small>
          {stale.length > 0 && <span className={css.resumeNote}>{t('toc.staleNote', { count: stale.length })}</span>}
        </div>
        <button type="button" className={css.resumeGo} onClick={() => { onRead(current.chapter.n) }}>{t('toc.continue')}</button>
      </div>
      <NextCandidates {...surface} />
      <NewOwnChapter {...surface} onCreated={n => { onRead(n, true) }} />
      {items.length > 0 && (
        <div className={css.queue}>
          <button type="button" className={css.queueHead} aria-expanded={queueOpen} onClick={() => { setQueueOpen(value => !value) }}>
            <span className={css.groupChev} data-open={queueOpen || undefined}>›</span>
            {t('strip.pending', { count: items.length })}
          </button>
          {queueOpen && api !== undefined && (
            <PendingList canvasId={canvasId} items={items} navigate={navigate} sessionId={sessionId} remote={api} t={t} />
          )}
        </div>
      )}
      <ChipRow<Filter>
        className={css.filters}
        label={t('toc.filter.label')}
        value={filter}
        onSelect={setFilter}
        chips={([['all', rows.length], ['todo', todo.length], ['open', open.length]] as const).map(([id, count]) => ({ id, label: t(`toc.filter.${id}Label`), count }))}
      />
      {filter !== 'all' ? (
        <div className={css.rows}>
          {(filter === 'todo' ? todo : open).map(row)}
          {(filter === 'todo' ? todo : open).length === 0 && <div className={css.muted}>{t('toc.filterEmpty')}</div>}
        </div>
      ) : groups.map(({ rows: group, volume }, index) => {
        if (group.length === 0 && volume === undefined) return null
        const first = group[0]?.chapter.n ?? 0
        const last = group.at(-1)?.chapter.n ?? 0
        const done = group.filter(item => settled(item.phase)).length
        const groupWords = formatWords(group.reduce((sum, item) => sum + (item.chapter.wordCount ?? 0), 0), t)
        const busy = group.some(item => !settled(item.phase))
        const isOpen = toggled[index] ?? (busy || index === groups.length - 1 || (volume !== undefined && group.length > 0 && groups.slice(index + 1).every(next => next.rows.length === 0)))
        return (
          <div key={volume === undefined ? `g${first}` : `v${volume.index}`} className={css.group} data-open={isOpen || undefined}>
            <button
              type="button"
              className={css.groupHead}
              aria-expanded={isOpen}
              onClick={() => { setToggled(all => ({ ...all, [index]: !isOpen })) }}
            >
              <span className={css.groupChev}>›</span>
              <span className={css.groupTitle}>
                {volume === undefined
                  ? (groups.some(other => other.volume !== undefined) ? t('toc.noVolume') : t('toc.group', { from: first, to: last }))
                  : t('toc.volume', { index: volumeNumeral(volume.index), title: volume.title.replace(/^第[一二三四五六七八九十\d]+卷\s*[·・:：]?\s*/, '') })}
              </span>
              <span className={css.groupSum}>
                {volume !== undefined && volume.planned !== undefined
                  ? t('toc.volumeSum', { planned: volume.planned, done: group.length })
                  : done === group.length
                    ? t('toc.groupDone', { words: groupWords })
                    : t('toc.groupSum', { done, count: group.length, words: groupWords })}
              </span>
            </button>
            {volume !== undefined && volume.planned !== undefined && (
              <div className={css.volBar}><i style={{ width: `${Math.min(100, Math.round(group.length / Math.max(1, volume.planned) * 100))}%` }} /></div>
            )}
            {isOpen && volume?.goal !== undefined && (
              <div className={css.volGoal}>
                {goalSegments(volume.goal).map((row, rowIndex) => (
                  <div key={rowIndex} className={css.volSeg}>{row.range !== undefined && <span>{row.range}</span>}<span>{row.text}</span></div>
                ))}
              </div>
            )}
            {isOpen && <div className={css.rows}>{group.map(row)}</div>}
            {isOpen && volume?.landing !== undefined && <p className={css.volLanding}>{volume.landing}</p>}
          </div>
        )
      })}
    </div>
  )
}

/** 下一章候选: what recall hands the planner for the next chapter, with the person's 优先推进 / 本章屏蔽. */
function NextCandidates(props: NovelSurfaceProps): ReactNode {
  const { canvasId, rev, remote, sessionId, navigate, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.timeline({ canvasId }), `timeline:${canvasId}`, rev)
  const [open, setOpen] = useState(false)
  if (api === undefined || read.state !== 'ready' || !read.value.ok) return null
  const data = read.value
  const chapter = data.chapter ?? 1
  const future = data.future ?? []
  if (future.length === 0) return null
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
    <section className={css.candBox}>
      <button type="button" className={css.candHead} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <span className={css.groupChev} data-open={open || undefined}>›</span>
        <b>{t('cand.heading', { n: chapter })}</b>
        <span className={css.muted}>{t('cand.count', { count: shown.length })}</span>
      </button>
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
          {sessionId !== undefined && props.sendToConversation !== undefined && (
            <div><button type="button" className={css.planEditBtn} onClick={() => { props.sendToConversation?.(sessionId, t('cand.planAsk', { n: chapter })) }}>{t('cand.plan', { n: chapter })}</button></div>
          )}
        </div>
      )}
    </section>
  )
}

/** 新建一章，自己写: a title, then the chapter opens in its edit box. */
function NewOwnChapter(props: NovelSurfaceProps & { readonly onCreated: (n: number) => void }): ReactNode {
  const { canvasId, remote, sessionId, navigate, t } = props
  const api = remote()
  const [title, setTitle] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  if (api === undefined || sessionId === undefined) return null
  if (title === null) {
    return <div className={css.ownRow}><button type="button" className={css.planEditBtn} onClick={() => { setTitle('') }}>{t('toc.newOwn')}</button><span className={css.muted}>{t('toc.newOwnHint')}</span></div>
  }
  return (
    <div className={css.ownRow}>
      <input className={css.ownInput} aria-label={t('toc.newOwnTitle')} placeholder={t('toc.newOwnTitle')} value={title} onChange={event => { setTitle(event.target.value) }} />
      <button
        type="button"
        className={css.confirm}
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
      </button>
      <button type="button" className={css.planEditBtn} onClick={() => { setTitle(null) }}>{t('edit.cancel')}</button>
      {failure !== null && <span className={css.warn}>{failure}</span>}
    </div>
  )
}

function ChapterLine({ row, pending, onRead, t }: {
  readonly row: ChapterRow
  readonly pending: number
  readonly onRead: (n: number) => void
  readonly t: TranslateNS<'novel'>
}): ReactNode {
  const { chapter, phase } = row
  return (
    <button type="button" className={css.row} onClick={() => { onRead(chapter.n) }}>
      <span className={css.rowNo}>{t('strip.chapter', { n: chapter.n })}</span>
      <span className={css.rowTitle}>
        {bareTitle(chapter.n, chapter.title)}
        {chapter.byUser === true && <span className={css.byUserTag} title={t('chapter.byUserTitle')}>{t('chapter.byUser')}</span>}
      </span>
      <span className={css.phaseTag} data-state={tocState(phase)} data-todo={pending > 0 || undefined} title={t(`phase.${phase}`)}>
        {pending > 0 ? t('strip.pending', { count: pending }) : t(`toc.state.${tocState(phase)}`)}
      </span>
      <span className={css.rowWords}>{chapter.wordCount === undefined ? '—' : t('chapter.words', { count: chapter.wordCount })}</span>
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

/** `86400` → `8.6 万` (zh) / `86k` (en): the dictionary picks its unit. */
function formatWords(words: number, t: TranslateNS<'novel'>): string {
  return words >= 10000
    ? t('toc.wordsLarge', { wan: (words / 10000).toFixed(1), k: Math.round(words / 1000) })
    : String(words)
}
