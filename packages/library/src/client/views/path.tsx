/**
 * A textbook's adopted path as a vertical lesson rail (proposal
 * library-slimming §5, option A): one row per station with its full title,
 * a disc that says where the learner stands, and its knowledge points as
 * mastery dots. Rows group under the contents' parts. Nothing is locked
 * (D6): the next station — the first not yet passed — is only highlighted
 * and opens its card (开始学 / 接着学 / 去订正).
 *
 * @module @khorsheed/dsh-library/client/views/path
 */
import type { ReactNode } from 'react'
import { stationMastery, type LibraryStationMastery } from '../../mastery.ts'
import { coverKind, parseLocator, type LibraryResource, type LibraryRoadmap, type RoadmapNode } from '../../types.ts'
import { IconCheckOutlineMedium } from '../icons.tsx'
import { Segments, useLoad, value, type ViewProps } from '../ui.tsx'
import { stationTitle } from '../titles.ts'
import css from '../LibraryPane.module.css'

/** Where the learner stands on one station. */
export type StationStatus = 'done' | 'studying' | 'ready' | 'todo'

/**
 * Passed (done) → 已过关; 讲义 written and the learner has been quizzed or has
 * a weak point → 学习中; 讲义 written → 已备课; nothing yet → 未开始.
 */
export function stationStatus(node: RoadmapNode, mastery: LibraryStationMastery): StationStatus {
  if (node.state === 'done') return 'done'
  const tried = (node.quizStats?.attempts ?? 0) > 0 || mastery.open.length > 0 || mastery.points.some(point => point.state !== 'untested')
  if (tried) return 'studying'
  return node.notes === undefined ? 'todo' : 'ready'
}

/** The contents part a station's first row sits under, when the contents has parts. */
function partOf(node: RoadmapNode, resource: LibraryResource): string | undefined {
  const cover = node.covers.find(candidate => coverKind(candidate) === 'resource' && candidate.ref === resource.id && candidate.locator !== undefined)
  const first = cover?.locator === undefined ? undefined : parseLocator(cover.locator)[0]?.from
  return first === undefined ? undefined : resource.toc?.find(row => row.n === first)?.part
}

/** The station's rows as a short label (第 3 章 / 第 3–4 章). */
function rowsLabel(node: RoadmapNode, resource: LibraryResource, t: ViewProps['p']['t']): string | undefined {
  const cover = node.covers.find(candidate => coverKind(candidate) === 'resource' && candidate.ref === resource.id && candidate.locator !== undefined)
  return cover?.locator === undefined ? undefined : t('path.rows', { rows: cover.locator.replace(/-/g, '–') })
}

/** The rail. */
export function Path({ p, projectId, resource, roadmap, onOpen, onLesson, onRetake }: {
  p: ViewProps['p']
  projectId: string
  resource: LibraryResource
  roadmap: LibraryRoadmap
  onOpen: (node: RoadmapNode) => void
  onLesson: (node: RoadmapNode) => void
  onRetake: (node: RoadmapNode) => void
}): ReactNode {
  const { t, useStore } = p
  const rev = useStore(s => s.rev)
  const assessments = useLoad(() => value(p.listAssessments(projectId)), [projectId, rev])
  const attempts = useLoad(() => value(p.listAttempts(projectId)), [projectId, rev])
  const rows = roadmap.nodes.map(node => {
    const mastery = stationMastery(node, assessments.data?.assessments ?? [], attempts.data?.attempts ?? [])
    return { node, mastery, status: stationStatus(node, mastery) }
  })
  const levels = rows.filter(row => row.node.gate !== 'read')
  const passed = levels.filter(row => row.status === 'done').length
  const allPoints = rows.flatMap(row => row.mastery.points)
  const mastered = allPoints.filter(point => point.state === 'mastered').length
  // The recommended next station: the first level not yet passed.
  const next = levels.find(row => row.status !== 'done')?.node.id
  let lastPart: string | undefined
  let number = 0
  return (
    <section className={css.section}>
      <div className={css.railHead}>
        <span className={css.railCounts}>
          <span><b>{passed}</b> / {levels.length} {t('path.stationsPassed')}</span>
          {allPoints.length > 0 && <span><b>{mastered}</b> / {allPoints.length} {t('path.pointsMastered')}</span>}
        </span>
        <Segments done={passed} total={levels.length} label={t('path.progress', { done: String(passed), total: String(levels.length) })} />
      </div>
      <ol className={css.rail}>
        {rows.map(({ node, mastery, status }) => {
          const part = partOf(node, resource)
          const showPart = part !== undefined && part !== lastPart
          lastPart = part ?? lastPart
          const side = node.gate === 'read'
          if (!side) number += 1
          const isNext = node.id === next
          const best = node.quizStats?.bestRatio
          const open = mastery.open.length
          return (
            <li key={node.id} className={css.railItem} data-status={status} data-side={side ? 'true' : undefined} data-next={isNext ? 'true' : undefined}>
              {showPart && <span className={css.railPart}>{part}</span>}
              <div className={css.railRow}>
                <button type="button" className={css.railDisc} data-status={status} data-next={isNext ? 'true' : undefined} aria-label={node.title} onClick={() => { onOpen(node) }}>
                  {status === 'done' ? <IconCheckOutlineMedium size={18} /> : side ? '·' : number}
                </button>
                <div className={css.railBody}>
                  <button type="button" className={css.railTitle} onClick={() => { onOpen(node) }}>{stationTitle(node.title)}</button>
                  <span className={css.railMeta}>
                    {status === 'done' && <span className={css.railState} data-status="done">{best === undefined ? t('path.done') : t('path.doneBest', { percent: String(Math.round(best * 100)) })}</span>}
                    {status === 'studying' && <span className={css.railState} data-status="studying">{open > 0 ? t('path.studyingOpen', { count: String(open) }) : t('path.studying')}</span>}
                    {status === 'ready' && <span className={css.railState} data-status="ready">{t('path.ready')}</span>}
                    {rowsLabel(node, resource, t) !== undefined && <span>{rowsLabel(node, resource, t)}</span>}
                    {mastery.points.length > 0 && (
                      <span className={css.railDots} aria-label={t('path.dotsLabel')}>
                        {mastery.points.map(point => <i key={point.id} className={css.lessonDot} data-state={point.state} title={`${point.title} · ${t(`point.${point.state}`)}`} />)}
                      </span>
                    )}
                  </span>
                  {isNext && (
                    <span className={css.railNext}>
                      <span className={css.muted}>{t(status === 'todo' ? 'path.nextTodo' : 'path.nextHint')}</span>
                      <span className={css.btnRow}>
                        {open > 0 && <button type="button" className={css.ghost} onClick={() => { onRetake(node) }}>{t('path.retake', { count: String(open) })}</button>}
                        <button type="button" className={css.primary} onClick={() => { if (node.notes === undefined) onOpen(node); else onLesson(node) }}>{t(node.notes === undefined ? 'lesson.start' : 'path.continue')}</button>
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
