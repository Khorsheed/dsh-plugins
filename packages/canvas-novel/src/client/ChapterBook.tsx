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
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { ChipRow } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { NOVEL_GENRE_ID, type ChapterRow, type EffectiveChapterPhase } from '../types.ts'
import { bareTitle, ChapterReader } from './ChapterReader.tsx'
import type { NovelSurfaceProps } from './contract.ts'
import { awaitsReconcile } from './NovelFaces.tsx'
import { currentChapter, PendingList } from './PendingList.tsx'
import { useNovelRead } from './use-novel.ts'
import css from './novel.module.css'

const GROUP = 10

type Filter = 'all' | 'todo' | 'open'

/** The 章节 entry. */
export function ChapterBook(props: NovelSurfaceProps & { readonly onEmpty?: (() => void) | undefined }): ReactNode {
  const [reading, setReading] = useState<number | null>(null)
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  if (reading !== null) {
    return <ChapterReader {...props} n={reading} host="book" onGo={setReading} onToc={() => { setReading(null) }} />
  }
  return <Contents {...props} onRead={setReading} />
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

function Contents({ canvasId, rev, navigate, sessionId, remote, t, onRead, onEmpty }: NovelSurfaceProps & {
  readonly onRead: (n: number) => void
  readonly onEmpty?: (() => void) | undefined
}): ReactNode {
  const api = remote()
  const read = useNovelRead(api, r => r.chapters({ canvasId }), `chapters:${canvasId}`, rev)
  const queue = useNovelRead(api, r => r.pending({ canvasId }), `pending:${canvasId}`, rev)
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
  const groups: ChapterRow[][] = []
  for (let index = 0; index < rows.length; index += GROUP) groups.push(rows.slice(index, index + GROUP))
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
      ) : groups.map((group, index) => {
        const first = group[0]!.chapter.n
        const last = group.at(-1)!.chapter.n
        const done = group.filter(item => settled(item.phase)).length
        const groupWords = formatWords(group.reduce((sum, item) => sum + (item.chapter.wordCount ?? 0), 0), t)
        const busy = group.some(item => !settled(item.phase))
        const isOpen = toggled[index] ?? (busy || index === groups.length - 1)
        return (
          <div key={first} className={css.group} data-open={isOpen || undefined}>
            <button
              type="button"
              className={css.groupHead}
              aria-expanded={isOpen}
              onClick={() => { setToggled(all => ({ ...all, [index]: !isOpen })) }}
            >
              <span className={css.groupChev}>›</span>
              <span className={css.groupTitle}>{t('toc.group', { from: first, to: last })}</span>
              <span className={css.groupSum}>
                {done === group.length
                  ? t('toc.groupDone', { words: groupWords })
                  : t('toc.groupSum', { done, count: group.length, words: groupWords })}
              </span>
            </button>
            {isOpen && <div className={css.rows}>{group.map(row)}</div>}
          </div>
        )
      })}
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
