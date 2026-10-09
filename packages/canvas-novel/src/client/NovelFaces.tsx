/**
 * The 长篇小说 canvas's three top faces — 章节 · 设定 · 故事 — and what the
 * canvas asks of the genre around them:
 *
 * - the face labels, and 章节's badge: what waits on the person (chapters
 *   to reconcile plus pending items);
 * - the 设定 face's scopes: 已进入故事 (a card some reconciled chapter uses)
 *   and 灵感 (a story card none does yet);
 * - the delete question's note: the chapters that use the card, or that an
 *   idea card affects no chapter.
 *
 * Every read here is the story log, the chapter index or the pending queue —
 * the reads the other surfaces make — re-read when the board moves.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useEffect, type ReactNode } from 'react'
import { NOVEL_GENRE_ID, NOVEL_PLAN_FACE, type EffectiveChapterPhase, type RecentNote, type StoryLogResult } from '../types.ts'
import type { NovelCardOwnerProps, NovelSurfaceProps } from './contract.ts'
import { chapterHeading } from './PendingList.tsx'
import { fieldLabel, MENTION_KEY } from './StoryLogPage.tsx'
import { useNovelRead } from './use-novel.ts'
import css from './novel.module.css'

/** The card roles the story log follows (a principle card is never "in the story"). */
const STORY_ROLES: ReadonlySet<string> = new Set(['character', 'world', 'foreshadow', 'relation'])

/** Whether a chapter's text moved since its last 对账 (or was never reconciled). */
export function awaitsReconcile(phase: EffectiveChapterPhase): boolean {
  return phase === 'writing' || phase === 'stale'
}

/**
 * The reconciled chapters each kept card is in, by card id, oldest first: a
 * foreshadow's mentions, a character's appearances, a pair's journal, a world
 * setting's history — never a plan's line, never the person's own edit.
 */
export function storyUsage(log: StoryLogResult): ReadonlyMap<string, readonly number[]> {
  const usage = new Map<string, number[]>()
  const add = (cardId: string, chapters: Iterable<number>): void => {
    const set = [...new Set(chapters)].sort((a, b) => a - b)
    if (set.length > 0) usage.set(cardId, set)
  }
  for (const view of log.foreshadows) {
    const marks = view.marks.filter(mark => !mark.planned).map(mark => mark.chapter)
    add(view.cardId, marks.length === 0 && view.plantedAt !== undefined ? [view.plantedAt] : marks)
  }
  for (const card of log.characters) add(card.cardId, card.appearances.filter(at => !at.planned).map(at => at.chapter))
  for (const view of log.relations) add(view.cardId, view.journal.map(entry => entry.chapter))
  for (const card of log.world) add(card.cardId, card.history.filter(entry => entry.source !== 'user').map(entry => entry.chapter))
  return usage
}

/* ------------------------------------------------------------ the tabs */

/** One top-face label: 章节, 设定, 故事. */
export function FaceLabel(props: NovelSurfaceProps & { readonly face: string; readonly label: string }): ReactNode {
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return props.label
  if (props.face === 'manuscripts') return props.t('face.chapters')
  if (props.face === 'board') return props.t('face.settings')
  if (props.face === NOVEL_PLAN_FACE) return props.t('face.plan')
  return props.t('face.story')
}

/** 章节's badge: the chapters whose text waits for a 对账; nothing at zero. */
export function ChaptersBadge(props: NovelSurfaceProps): ReactNode {
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  return <Waiting {...props} />
}

function Waiting({ canvasId, rev, remote, t }: NovelSurfaceProps): ReactNode {
  const api = remote()
  const chapters = useNovelRead(api, r => r.chapters({ canvasId }), `chapters:${canvasId}`, rev)
  // Nothing waits on the person any more (2026-10-09): only a text the memory has not caught up with.
  const stale = chapters.state === 'ready' ? chapters.value.chapters.filter(row => awaitsReconcile(row.phase)).length : 0
  return stale > 0 ? <span className={css.faceBadge} title={t('face.waiting', { stale })}>{stale}</span> : null
}

/* ---------------------------------------------------------- the scopes */

/** One scope of the 设定 face, as the canvas draws it (`CanvasCardScope`, structurally). */
interface CardScope {
  readonly id: string
  readonly label: string
  readonly cardIds: readonly string[]
  readonly archiveFirst?: boolean
  readonly notes?: Readonly<Record<string, { readonly label: string; readonly text?: string }>>
}

/** The 最近更新 scope's id (the 已对账 card opens the 设定 face on it). */
export const RECENT_SCOPE = 'recent'

/** One card's line under 最近更新: what the newest 对账 did to it (its first two kinds of change), and the words. */
export function recentNoteOf(notes: readonly RecentNote[], role: string | undefined, t: NovelSurfaceProps['t']): { label: string; text?: string } {
  const labelOf = (item: RecentNote): string => {
    if (item.kind === 'create') return t(role === 'foreshadow' ? 'recent.planted' : 'recent.created')
    if (item.kind === 'field') return fieldLabel(t, item.field ?? '')
    if (item.kind === 'mention' && item.mention !== undefined) return t(MENTION_KEY[item.mention])
    if (item.kind === 'experience') return t('recent.experience')
    if (item.kind === 'points') return t('recent.points', { delta: (item.delta ?? 0) > 0 ? `+${item.delta}` : String(item.delta ?? 0) })
    return t('recent.stage')
  }
  const labels = [...new Set(notes.map(labelOf))]
  const text = notes.find(item => item.text !== undefined && item.text !== '')?.text
  return { label: labels.slice(0, 2).join(' · '), ...(text === undefined ? {} : { text }) }
}

/** The 设定 face's scope reader: reports 已进入故事 / 灵感 / 最近更新 and renders nothing. */
export function CardScopes(props: NovelSurfaceProps & {
  readonly onScopes: (scopes: readonly CardScope[]) => void
}): ReactNode {
  const { canvasId, board, rev, remote, onScopes, t } = props
  const read = useNovelRead(remote(), r => r.storyLog({ canvasId }), `story-log:${canvasId}`, rev)
  const recent = useNovelRead(remote(), r => r.recentUpdates({ canvasId }), `recent:${canvasId}`, rev)
  const log = read.state === 'ready' && read.value.ok ? read.value : undefined
  const latest = recent.state === 'ready' && recent.value.ok ? recent.value : undefined
  useEffect(() => {
    if (log === undefined || board.genre?.id !== NOVEL_GENRE_ID) return
    const usage = storyUsage(log)
    const storyCategories = new Set((board.categories ?? []).filter(row => row.role !== undefined && STORY_ROLES.has(row.role)).map(row => row.id))
    const roleOf = new Map((board.categories ?? []).map(row => [row.id, row.role]))
    const cards = board.cards ?? []
    const scopes: CardScope[] = [
      { id: 'story', label: t('scope.story'), cardIds: cards.filter(card => usage.has(card.id)).map(card => card.id), archiveFirst: true },
      { id: 'idea', label: t('scope.idea'), cardIds: cards.filter(card => !usage.has(card.id) && storyCategories.has(card.kind)).map(card => card.id) },
    ]
    // 最近更新: only the newest 对账 — looked at and left alone is accepted (2026-10-09).
    if (latest?.chapter !== undefined) {
      const touched = cards.filter(card => latest.cards[card.id] !== undefined)
      if (touched.length > 0) {
        scopes.push({
          id: RECENT_SCOPE,
          label: t('scope.recent', { n: latest.chapter }),
          cardIds: touched.map(card => card.id),
          archiveFirst: true,
          notes: Object.fromEntries(touched.map(card => [card.id, recentNoteOf(latest.cards[card.id]!, roleOf.get(card.kind), t)])),
        })
      }
    }
    onScopes(scopes)
  }, [log, latest, board, onScopes, t])
  return null
}

/* ------------------------------------------------------ the delete note */

/** What a card's delete question adds: the chapters using it, or that an idea card affects no chapter. */
export function DeleteNote(props: NovelSurfaceProps<NovelCardOwnerProps>): ReactNode {
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  if (props.category.role === undefined || !STORY_ROLES.has(props.category.role)) return null
  return <Note {...props} />
}

function Note({ canvasId, card, rev, remote, t }: NovelSurfaceProps<NovelCardOwnerProps>): ReactNode {
  const read = useNovelRead(remote(), r => r.storyLog({ canvasId }), `story-log:${canvasId}`, rev)
  if (read.state !== 'ready' || !read.value.ok) return null
  const log = read.value
  const chapters = storyUsage(log).get(card.id) ?? []
  if (chapters.length === 0) return <p className={css.deleteNote}>{t('delete.idea')}</p>
  return (
    <div className={css.deleteNote}>
      <p>{t('delete.used')}</p>
      <ul>
        {chapters.map((n) => {
          const chapter = log.chapters.find(row => row.n === n)
          return <li key={n}>{chapterHeading(t, n, chapter?.title ?? '')}</li>
        })}
      </ul>
    </div>
  )
}
