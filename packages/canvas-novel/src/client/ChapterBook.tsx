/**
 * The 成稿 face of a 长篇小说 canvas: the work as a book. The contents page
 * shows the whole work at a glance (a spine of one tick per chapter, colored by
 * phase, red where something waits for review), the chapter to pick up at, a
 * filter for the chapters that need the person, and the chapters in groups of
 * ten (a group opens by itself while it has work in it, and the last one
 * always). A row opens the chapter reader in place; the reader's 目录 comes
 * back here.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { NOVEL_GENRE_ID, type ChapterRow } from '../types.ts'
import { bareTitle, ChapterReader } from './ChapterReader.tsx'
import type { NovelSurfaceProps } from './contract.ts'
import { currentChapter } from './PendingStrip.tsx'
import { useNovelRead } from './use-novel.ts'
import css from './novel.module.css'

const GROUP = 10

type Filter = 'all' | 'todo' | 'open'

/** The 成稿 entry. */
export function ChapterBook(props: NovelSurfaceProps): ReactNode {
  const [reading, setReading] = useState<number | null>(null)
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  if (reading !== null) {
    return <ChapterReader {...props} n={reading} host="book" onGo={setReading} onToc={() => { setReading(null) }} />
  }
  return <Contents {...props} onRead={setReading} />
}

/** Whether a chapter needs the person: pending items, or extracted and waiting for ✓ 审过. */
function needsPerson(row: ChapterRow, pending: Readonly<Record<number, number>>): boolean {
  return (pending[row.chapter.n] ?? 0) > 0 || row.phase === 'extracted'
}

function Contents({ canvasId, board, rev, remote, t, onRead }: NovelSurfaceProps & { readonly onRead: (n: number) => void }): ReactNode {
  const api = remote()
  const read = useNovelRead(api, r => r.chapters({ canvasId }), `chapters:${canvasId}`, rev)
  const [filter, setFilter] = useState<Filter>('all')
  // Explicit open/closed choices per group; unset groups follow the default.
  const [toggled, setToggled] = useState<Record<number, boolean>>({})
  if (api === undefined) return null
  if (read.state === 'loading') return <div className={css.book}><div className={css.muted}>{t('state.loading')}</div></div>
  if (read.state === 'error') return <div className={css.book}><div className={css.warn}>{t('error.generic', { message: read.message })}</div></div>
  const { chapters: rows, pending } = read.value
  if (rows.length === 0) {
    return (
      <div className={css.book} data-canvas-scroll="novel-book">
        <h3 className={css.bookTitle}>{board.title ?? ''}</h3>
        <div className={css.bookEmpty}>{t('toc.empty')}</div>
      </div>
    )
  }
  const words = rows.reduce((sum, row) => sum + (row.chapter.wordCount ?? 0), 0)
  const reviewed = rows.filter(row => row.phase === 'reviewed').length
  const todo = rows.filter(row => needsPerson(row, pending))
  const open = rows.filter(row => row.phase !== 'reviewed')
  const current = currentChapter(rows, pending)!
  const groups: ChapterRow[][] = []
  for (let index = 0; index < rows.length; index += GROUP) groups.push(rows.slice(index, index + GROUP))
  const row = (item: ChapterRow): ReactNode => (
    <ChapterLine key={item.chapter.n} row={item} pending={pending[item.chapter.n] ?? 0} onRead={onRead} t={t} />
  )

  return (
    <div className={css.book} data-canvas-scroll="novel-book">
      <div className={css.bookHead}>
        <h3 className={css.bookTitle}>{board.title ?? ''}</h3>
        <div className={css.bookStat}>{t('toc.stat', { count: rows.length, words: formatWords(words, t), reviewed })}</div>
        <div className={css.spine} style={{ gridTemplateColumns: `repeat(${Math.max(rows.length, 20)}, 1fr)` }}>
          {rows.map(item => (
            <button
              key={item.chapter.n}
              type="button"
              className={css.tick}
              data-phase={item.phase}
              data-todo={(pending[item.chapter.n] ?? 0) > 0 || undefined}
              title={`${t('strip.chapter', { n: item.chapter.n })} ${bareTitle(item.chapter.n, item.chapter.title)} · ${phaseLabel(item, pending, t)}`}
              aria-label={t('strip.chapter', { n: item.chapter.n })}
              onClick={() => { onRead(item.chapter.n) }}
            />
          ))}
        </div>
        <div className={css.legend}>
          {(['reviewed', 'extracted', 'todo', 'writing', 'planning'] as const).map(kind => (
            <span key={kind} data-kind={kind}>{t(`toc.legend.${kind}`)}</span>
          ))}
        </div>
      </div>
      <button type="button" className={css.resume} onClick={() => { onRead(current.chapter.n) }}>
        <span className={css.resumeText}>
          <small>{t('toc.resume')}</small>
          <span className={css.resumeTitle}>
            {t('strip.chapter', { n: current.chapter.n })} {bareTitle(current.chapter.n, current.chapter.title)}
          </span>
        </span>
        <span className={css.resumeGo}>›</span>
      </button>
      <div className={css.filters} role="group">
        {([['all', rows.length], ['todo', todo.length], ['open', open.length]] as const).map(([key, count]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key) }}>
            {t(`toc.filter.${key}`, { count })}
          </button>
        ))}
      </div>
      {filter !== 'all' ? (
        <div className={css.rows}>
          {(filter === 'todo' ? todo : open).map(row)}
          {(filter === 'todo' ? todo : open).length === 0 && <div className={css.muted}>{t('toc.filterEmpty')}</div>}
        </div>
      ) : groups.map((group, index) => {
        const first = group[0]!.chapter.n
        const last = group.at(-1)!.chapter.n
        const done = group.filter(item => item.phase === 'reviewed').length
        const groupWords = formatWords(group.reduce((sum, item) => sum + (item.chapter.wordCount ?? 0), 0), t)
        const busy = group.some(item => item.phase !== 'reviewed')
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
      <span className={css.phaseTag} data-phase={phase} data-todo={pending > 0 || undefined}>
        {pending > 0 ? t('strip.pending', { count: pending }) : t(`phase.${phase}`)}
      </span>
      <span className={css.rowWords}>{chapter.wordCount === undefined ? '—' : t('chapter.words', { count: chapter.wordCount })}</span>
    </button>
  )
}

function phaseLabel(row: ChapterRow, pending: Readonly<Record<number, number>>, t: TranslateNS<'novel'>): string {
  const count = pending[row.chapter.n] ?? 0
  return count > 0 ? t('strip.pending', { count }) : t(`phase.${row.phase}`)
}

/** `86400` → `8.6 万` (zh) / `86k` (en): the dictionary picks its unit. */
function formatWords(words: number, t: TranslateNS<'novel'>): string {
  return words >= 10000
    ? t('toc.wordsLarge', { wan: (words / 10000).toFixed(1), k: Math.round(words / 1000) })
    : String(words)
}
