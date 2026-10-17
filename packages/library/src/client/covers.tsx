/**
 * Covers — what a station draws on — as chips with their provenance badges,
 * plus the client-side mirror of the host's evidence gate (display only; the
 * host enforces, `service.ts`'s coversVerbatimBlocker).
 *
 * v5: a cover is one shape — `{ ref, locator? }` — and the ref describes
 * itself: a shelf resource's id, a bare url, or `topic:…` for coached
 * teaching.
 *
 * @module @khorsheed/dsh-library/client/covers
 */
import type { ReactNode } from 'react'
import { coverKind, coverTopic, isThickResource, type LibraryNodeCover, type LibraryResource } from '../types.ts'
import type { LibraryPaneProps } from './contract.ts'
import css from './LibraryPane.module.css'

/** What labeling a cover needs: the project's shelf (books included). */
export interface CoverContext {
  readonly resources: readonly LibraryResource[]
}

type T = LibraryPaneProps['t']

/** A cover's one-line label. */
export function coverLabel(cover: LibraryNodeCover, context: CoverContext, t: T): string {
  switch (coverKind(cover)) {
    case 'resource': {
      const resource = context.resources.find(candidate => candidate.id === cover.ref)
      if (resource === undefined) return cover.locator === undefined ? cover.ref : `${cover.ref} ${t('cover.chapters', { ranges: cover.locator })}`
      const title = isThickResource(resource) ? `《${resource.title}》` : resource.title
      return cover.locator === undefined ? title : `${title} ${t('cover.chapters', { ranges: cover.locator })}`
    }
    case 'url':
      return cover.title ?? cover.ref.replace(/^https?:\/\//, '').split('/')[0] ?? cover.ref
    case 'topic':
      return `${t('cover.topic')}: ${coverTopic(cover) ?? ''}`
  }
}

/** The kind tag on a cover chip: book / link / teaching. */
function coverKindLabel(cover: LibraryNodeCover, context: CoverContext, t: T): string {
  const kind = coverKind(cover)
  if (kind === 'resource') {
    const resource = context.resources.find(candidate => candidate.id === cover.ref)
    return resource !== undefined && isThickResource(resource) ? t('cover.book') : t('cover.link')
  }
  return kind === 'topic' ? t('cover.topic') : t('cover.link')
}

/** A cover's provenance badge (absent on a shelf resource — its tocSource already records it). */
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
        <span key={`${coverKind(cover)}-${index}`} className={css.chip} data-tone={coverKind(cover) === 'resource' ? 'photo' : coverKind(cover) === 'topic' ? undefined : 'web'}>
          {coverKindLabel(cover, context, t)} · {coverLabel(cover, context, t)}
          <ProvenanceBadge cover={cover} t={t} />
        </span>
      ))}
    </div>
  )
}

/** One line for a path row: 「《书》 第 3-5 章 · 链接 ×2 · 讲授 ×1」. */
export function summarizeCovers(covers: readonly LibraryNodeCover[], context: CoverContext, t: T): string {
  const thick: string[] = []
  let links = 0
  let topics = 0
  for (const cover of covers) {
    const kind = coverKind(cover)
    if (kind === 'resource') {
      const resource = context.resources.find(candidate => candidate.id === cover.ref)
      if (resource !== undefined && isThickResource(resource)) thick.push(coverLabel(cover, context, t))
      else links += 1
    } else if (kind === 'url') links += 1
    else topics += 1
  }
  const parts = [...thick]
  if (links > 0) parts.push(`${t('cover.link')} ×${links}`)
  if (topics > 0) parts.push(`${t('cover.topic')} ×${topics}`)
  return parts.join(' · ')
}

/**
 * The station's evidence policy, computed from its covers — the client mirror
 * of the host's gate, for the quiz tab's policy card only: only knowledge
 * books / plain teaching allow memory-backed content questions; a material
 * book, a thin link or a url demands a verbatim quote.
 */
export function evidencePolicy(covers: readonly LibraryNodeCover[], resources: readonly LibraryResource[]): 'knowledge-ok' | 'verbatim' {
  for (const cover of covers) {
    const kind = coverKind(cover)
    if (kind === 'url') return 'verbatim'
    if (kind === 'resource') {
      const resource = resources.find(candidate => candidate.id === cover.ref)
      if (resource === undefined) continue
      if (!isThickResource(resource) || resource.meta?.bookKind === 'material') return 'verbatim'
    }
  }
  return 'knowledge-ok'
}
