/**
 * Covers — what a station draws on — as chips with their provenance badges,
 * plus the client-side mirror of the host's evidence gate (display only; the
 * host enforces, `service.ts`'s coversVerbatimBlocker).
 *
 * @module @khorsheed/dsh-library/client/covers
 */
import type { ReactNode } from 'react'
import type { LibraryBook, LibraryNodeCover, LibraryResource } from '../types.ts'
import type { LibraryPaneProps } from './contract.ts'
import css from './LibraryPane.module.css'

/** What labeling a cover needs: the project's books and shelf resources. */
export interface CoverContext {
  readonly books: readonly LibraryBook[]
  readonly resources: readonly LibraryResource[]
}

type T = LibraryPaneProps['t']

/** A book cover's ranges as compact text: 「3-5, 7」; empty = the whole book. */
function rangesText(ranges: readonly { from: number; to: number }[]): string {
  return ranges.map(range => (range.from === range.to ? `${range.from}` : `${range.from}-${range.to}`)).join(', ')
}

/** A cover's one-line label. */
export function coverLabel(cover: LibraryNodeCover, context: CoverContext, t: T): string {
  switch (cover.kind) {
    case 'book': {
      const book = context.books.find(candidate => candidate.id === cover.bookId)
      const title = book === undefined ? cover.bookId : `《${book.title}》`
      return cover.ranges.length === 0 ? title : `${title} ${t('cover.chapters', { ranges: rangesText(cover.ranges) })}`
    }
    case 'resource':
      return context.resources.find(candidate => candidate.id === cover.resourceId)?.title ?? cover.resourceId
    case 'url':
      return cover.title ?? cover.url.replace(/^https?:\/\//, '').split('/')[0] ?? cover.url
    case 'topic':
      return `${t('cover.topic')}: ${cover.text}`
  }
}

/** The kind tag on a cover chip: book / link / teaching. */
function coverKindLabel(cover: LibraryNodeCover, t: T): string {
  return cover.kind === 'book' ? t('cover.book') : cover.kind === 'topic' ? t('cover.topic') : t('cover.link')
}

/** A cover's provenance badge (absent on a book — its tocSource already records it). */
export function ProvenanceBadge({ cover, t }: { cover: LibraryNodeCover; t: T }): ReactNode {
  if (cover.by === undefined) return null
  return <span className={css.prov} data-by={cover.by}>{t(`prov.${cover.by}`)}</span>
}

/** One station's covers as a chip row: label + provenance badge each. */
export function CoverChips({ covers, context, t }: { covers: readonly LibraryNodeCover[]; context: CoverContext; t: T }): ReactNode {
  if (covers.length === 0) return null
  return (
    <div className={css.chips}>
      {covers.map((cover, index) => (
        <span key={`${cover.kind}-${index}`} className={css.chip} data-tone={cover.kind === 'book' ? 'photo' : cover.kind === 'topic' ? undefined : 'web'}>
          {coverKindLabel(cover, t)} · {coverLabel(cover, context, t)}
          <ProvenanceBadge cover={cover} t={t} />
        </span>
      ))}
    </div>
  )
}

/** One line for a path row: 「《书》 第 3-5 章 · 链接 ×2 · 讲授 ×1」. */
export function summarizeCovers(covers: readonly LibraryNodeCover[], context: CoverContext, t: T): string {
  const books = covers.filter((cover): cover is LibraryNodeCover & { kind: 'book' } => cover.kind === 'book')
  const links = covers.filter(cover => cover.kind === 'resource' || cover.kind === 'url').length
  const topics = covers.filter(cover => cover.kind === 'topic').length
  const parts: string[] = books.map(book => coverLabel(book, context, t))
  if (links > 0) parts.push(`${t('cover.link')} ×${links}`)
  if (topics > 0) parts.push(`${t('cover.topic')} ×${topics}`)
  return parts.join(' · ')
}

/**
 * The station's evidence policy, computed from its covers — the client mirror
 * of the host's gate, for the quiz tab's policy card only: only knowledge
 * books / plain teaching allow memory-backed content questions; a material
 * book, a resource or a url demands a verbatim quote.
 */
export function evidencePolicy(covers: readonly LibraryNodeCover[], books: readonly LibraryBook[]): 'knowledge-ok' | 'verbatim' {
  for (const cover of covers) {
    if (cover.kind === 'resource' || cover.kind === 'url') return 'verbatim'
    if (cover.kind === 'book' && books.find(candidate => candidate.id === cover.bookId)?.bookKind === 'material') return 'verbatim'
  }
  return 'knowledge-ok'
}
