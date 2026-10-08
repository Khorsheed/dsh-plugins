/**
 * The 长篇小说 canvas's three top faces — 章节 · 设定 · 故事 — and what the
 * canvas asks of the genre around them:
 *
 * - the face labels, and 章节's badge: what waits on the person (chapters
 *   to reconcile plus pending items);
 * - the 设定 face's scopes: 已进入故事 (a card some reconciled chapter uses)
 *   and 灵感 (a story card none does yet);
 * - its 连线 layout: the characters as nodes, the relation cards as lines,
 *   dashed while no chapter has the pair;
 * - the delete question's note: the chapters that use the card, or that an
 *   idea card affects no chapter.
 *
 * Every read here is the story log, the chapter index or the pending queue —
 * the reads the other surfaces make — re-read when the board moves.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useEffect, type ReactNode } from 'react'
import { NOVEL_GENRE_ID, NOVEL_PLAN_FACE, type EffectiveChapterPhase, type StoryLogResult } from '../types.ts'
import type { NovelCardOwnerProps, NovelSurfaceProps } from './contract.ts'
import { chapterHeading } from './PendingList.tsx'
import { errorKey, useNovelRead } from './use-novel.ts'
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

/** 章节's badge: what waits on the person (chapters to reconcile plus pending items); nothing at zero. */
export function ChaptersBadge(props: NovelSurfaceProps): ReactNode {
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  return <Waiting {...props} />
}

function Waiting({ canvasId, rev, remote, t }: NovelSurfaceProps): ReactNode {
  const api = remote()
  const chapters = useNovelRead(api, r => r.chapters({ canvasId }), `chapters:${canvasId}`, rev)
  const pending = useNovelRead(api, r => r.pending({ canvasId }), `pending:${canvasId}`, rev)
  const stale = chapters.state === 'ready' ? chapters.value.chapters.filter(row => awaitsReconcile(row.phase)).length : 0
  const items = pending.state === 'ready' ? pending.value.items.length : 0
  const count = stale + items
  return count > 0 ? <span className={css.faceBadge} title={t('face.waiting', { stale, items })}>{count}</span> : null
}

/* ---------------------------------------------------------- the scopes */

/** The 设定 face's scope reader: reports 已进入故事 / 灵感 and renders nothing. */
export function CardScopes(props: NovelSurfaceProps & {
  readonly onScopes: (scopes: readonly { id: string; label: string; cardIds: readonly string[]; archiveFirst?: boolean }[]) => void
}): ReactNode {
  const { canvasId, board, rev, remote, onScopes, t } = props
  const read = useNovelRead(remote(), r => r.storyLog({ canvasId }), `story-log:${canvasId}`, rev)
  const log = read.state === 'ready' && read.value.ok ? read.value : undefined
  useEffect(() => {
    if (log === undefined || board.genre?.id !== NOVEL_GENRE_ID) return
    const usage = storyUsage(log)
    const storyCategories = new Set((board.categories ?? []).filter(row => row.role !== undefined && STORY_ROLES.has(row.role)).map(row => row.id))
    const cards = board.cards ?? []
    onScopes([
      { id: 'story', label: t('scope.story'), cardIds: cards.filter(card => usage.has(card.id)).map(card => card.id), archiveFirst: true },
      { id: 'idea', label: t('scope.idea'), cardIds: cards.filter(card => !usage.has(card.id) && storyCategories.has(card.kind)).map(card => card.id) },
    ])
  }, [log, board, onScopes, t])
  return null
}

/* ----------------------------------------------------------- the graph */

const NODE_W = 88
const NODE_H = 32

/**
 * The 连线 layout: the characters round a ring, each relation card a line
 * between its pair with the card's 现状 on it; a pair no chapter has yet is
 * dashed, a character no chapter has yet too. A node or a line opens its card.
 */
export function RelationGraph(props: NovelSurfaceProps): ReactNode {
  if (props.board.genre?.id !== NOVEL_GENRE_ID) return null
  return <Graph {...props} />
}

function Graph({ canvasId, rev, navigate, remote, t }: NovelSurfaceProps): ReactNode {
  const read = useNovelRead(remote(), r => r.storyLog({ canvasId }), `story-log:${canvasId}`, rev)
  if (read.state === 'loading') return <div className={css.graph}><div className={css.muted}>{t('state.loading')}</div></div>
  if (read.state === 'error') return <div className={css.graph}><div className={css.warn}>{t('error.generic', { message: read.message })}</div></div>
  if (!read.value.ok) return <div className={css.graph}><div className={css.warn}>{t(errorKey(read.value.error))}</div></div>
  const log = read.value
  const usage = storyUsage(log)
  const people = log.characters
  if (people.length === 0) return <div className={css.graph}><div className={css.graphEmpty}>{t('graph.empty')}</div></div>
  // A ring sized so neighbouring nodes keep a node's width between them.
  const radius = Math.max(110, (people.length * (NODE_W + 24)) / (2 * Math.PI))
  const width = 2 * radius + NODE_W + 40
  const height = 2 * radius + NODE_H + 60
  const at = new Map(people.map((card, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / people.length
    return [card.cardId, { x: width / 2 + radius * Math.cos(angle), y: height / 2 + radius * Math.sin(angle) }] as const
  }))
  const lines = log.relations.flatMap((view) => {
    const a = at.get(view.pair[0] ?? '')
    const b = at.get(view.pair[1] ?? '')
    return a === undefined || b === undefined ? [] : [{ view, a, b, used: usage.has(view.cardId) }]
  })
  return (
    <div className={css.graph} data-canvas-scroll="novel-graph">
      {/* Natural size at most: a small ring scaled to the panel's width reads as oversized type. */}
      <svg className={css.graphSvg} style={{ maxWidth: width }} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('graph.label')}>
        {lines.map(({ view, a, b, used }) => (
          <g
            key={view.cardId}
            className={css.graphLine}
            data-idle={used ? undefined : 'true'}
            role="button"
            tabIndex={0}
            aria-label={`${view.names.join(' × ')} · ${view.type} · ${view.stage}`}
            onClick={() => { navigate.openCard(view.cardId, view.name) }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') navigate.openCard(view.cardId, view.name) }}
          >
            {/* A wide transparent twin so a finger finds the line. */}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={css.graphHit} />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} textAnchor="middle">{clip(view.now ?? view.stage, 10)}</text>
          </g>
        ))}
        {people.map((card) => {
          const point = at.get(card.cardId)!
          return (
            <g
              key={card.cardId}
              className={css.graphNode}
              data-idle={usage.has(card.cardId) ? undefined : 'true'}
              role="button"
              tabIndex={0}
              aria-label={card.name}
              onClick={() => { navigate.openCard(card.cardId, card.name) }}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') navigate.openCard(card.cardId, card.name) }}
            >
              <rect x={point.x - NODE_W / 2} y={point.y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={8} />
              <text x={point.x} y={point.y + 5} textAnchor="middle">{clip(card.name, 6)}</text>
            </g>
          )
        })}
      </svg>
      <div className={css.graphKey}>{t('graph.key')}</div>
    </div>
  )
}

function clip(text: string, max: number): string {
  return [...text].length > max ? `${[...text].slice(0, max).join('')}…` : text
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
