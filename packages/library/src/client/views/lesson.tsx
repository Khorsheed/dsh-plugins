/**
 * A station's 讲义 as its own page (proposal library-lesson-page): pushed from
 * the station's guide (打开讲义) or opened by itself once the coach has written
 * them after 开始学这一站. The markdown splits at its `##` headings — one
 * section per knowledge point — so the contents can jump between them and
 * show each point's mastery; wide panes keep the contents beside the text.
 * Also the station guide's lesson card (LessonCard).
 *
 * @module @khorsheed/dsh-library/client/views/lesson
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { PanelHeader } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import type { LibraryPointMastery } from '../../mastery.ts'
import { stationMastery } from '../../mastery.ts'
import type { LibraryResource, RoadmapNode } from '../../types.ts'
import { outcome, StateLine, useLoad, value, when, type ViewProps } from '../ui.tsx'
import css from '../LibraryPane.module.css'

/** How long 正在备课 waits for the 讲义 before offering to ask again. */
const PREPARE_PATIENCE_MS = 10 * 60_000

/** One `##` section of the 讲义; the text before the first heading is the opening. */
interface LessonSection {
  readonly id: string
  readonly title: string | undefined
  readonly body: string
}

/** Split the markdown at its `##` headings (deeper headings stay inside their section). */
export function lessonSections(text: string): LessonSection[] {
  const sections: LessonSection[] = []
  let title: string | undefined
  let lines: string[] = []
  const flush = (): void => {
    const body = lines.join('\n').trim()
    if (title !== undefined || body !== '') sections.push({ id: `s${sections.length}`, title, body })
  }
  for (const line of text.replace(/^#\s+.*\n/, '').split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading === null) { lines.push(line); continue }
    flush()
    title = heading[1]!.replace(/[*_`]/g, '')
    lines = []
  }
  flush()
  return sections
}

/** The point a section heading names, by its title. */
function pointOf(title: string | undefined, points: readonly LibraryPointMastery[]): LibraryPointMastery | undefined {
  if (title === undefined) return undefined
  const squash = (value: string): string => value.replace(/\s/g, '').toLowerCase()
  return points.find(point => squash(title).includes(squash(point.title)))
}

/** The station's points with their mastery, for the dots (empty while loading). */
function useStationPoints(p: ViewProps['p'], projectId: string, node: RoadmapNode | undefined): readonly LibraryPointMastery[] {
  const rev = p.useStore(s => s.rev)
  const assessments = useLoad(() => value(p.listAssessments(projectId)), [projectId, rev])
  const attempts = useLoad(() => value(p.listAttempts(projectId)), [projectId, rev])
  if (node === undefined) return []
  return stationMastery(node, assessments.data?.assessments ?? [], attempts.data?.attempts ?? []).points
}

/** The 讲义 page. */
export function LessonView({ p, projectId, resourceId, nodeId }: ViewProps & { projectId: string; resourceId: string; nodeId: string }): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const loaded = useLoad(async () => {
    const [detail, roadmaps] = await Promise.all([outcome(p.getProject(projectId)), value(p.getRoadmap(projectId, resourceId))])
    return { resource: detail.resources.find(candidate => candidate.id === resourceId), node: roadmaps.roadmap?.nodes.find(candidate => candidate.id === nodeId) }
  }, [projectId, resourceId, nodeId, rev])
  const node = loaded.data?.node
  const points = useStationPoints(p, projectId, node)
  const sections = useMemo(() => lessonSections(node?.notes?.text ?? ''), [node?.notes?.text])
  const [active, setActive] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const refs = useRef(new Map<string, HTMLElement>())
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])
  const jump = (id: string): void => {
    setActive(id)
    refs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const ask = (): void => {
    if (node === undefined) return
    void p.bindTarget({ projectId, resourceId })
    setNotice(p.primeConversation(t('prime.lessonAsk', { node: node.title })) ? t('lesson.asked') : t('notice.noConversation'))
  }
  const titled = sections.filter(section => section.title !== undefined)
  return (
    <>
      <PanelHeader
        title={node === undefined ? t('lesson.title') : t('lesson.titleOf', { node: node.title })}
        meta={loaded.data?.resource?.title}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        moreLabel={t('action.more')}
      />
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {node !== undefined && node.notes === undefined && <div className={css.muted}>{t('lesson.none')}</div>}
        {node?.notes !== undefined && (
          <div className={css.lesson}>
            <nav className={css.lessonToc} aria-label={t('lesson.contents')}>
              <span className={css.lessonTocHead}>{t('lesson.contentsMeta', { count: String(points.length) })}</span>
              {sections.map((section, index) => {
                const point = pointOf(section.title, points)
                return (
                  <button key={section.id} type="button" className={css.lessonTocItem} aria-current={active === section.id ? 'true' : undefined} onClick={() => { jump(section.id) }}>
                    <i className={css.lessonDot} data-state={point?.state ?? 'none'} aria-hidden="true" />
                    <span>{section.title ?? (index === 0 ? t('lesson.opening') : '')}</span>
                  </button>
                )
              })}
              <div className={css.lessonTocActions}>
                <button type="button" className={css.primary} onClick={() => { actions.replace({ view: 'node', projectId, resourceId, nodeId, tab: 'quiz' }) }}>{t('lesson.toQuiz')}</button>
                <button type="button" className={css.ghost} onClick={ask}>{t('lesson.ask')}</button>
              </div>
            </nav>
            <article className={css.lessonBody}>
              <div className={css.muted}>{t('lesson.meta', { at: when(node.notes.updatedAt, t), count: String(titled.length) })}{node.notes.revisions > 1 ? ` · ${t('lesson.revised', { n: String(node.notes.revisions - 1) })}` : ''}</div>
              {sections.map(section => (
                <section key={section.id} ref={element => { if (element === null) refs.current.delete(section.id); else refs.current.set(section.id, element) }} className={css.lessonSection}>
                  {section.title !== undefined && <h2 className={css.lessonHeading}>{section.title}</h2>}
                  <MarkdownText text={section.body} labels={markdownLabels} />
                </section>
              ))}
              <section className={css.stepBox}>
                <span className={css.stepText}>
                  <strong>{t('lesson.doneTitle')}</strong>
                  <span className={css.muted}>{t('lesson.doneHint', { count: String(points.length) })}</span>
                </span>
                <div className={css.askActions}>
                  <button type="button" className={css.ghost} onClick={ask}>{t('lesson.ask')}</button>
                  <button type="button" className={css.primary} onClick={() => { actions.replace({ view: 'node', projectId, resourceId, nodeId, tab: 'quiz' }) }}>{t('lesson.toQuiz')}</button>
                </div>
              </section>
              {notice !== undefined && <div className={css.notice}>{notice}</div>}
            </article>
          </div>
        )}
      </div>
    </>
  )
}

/**
 * The station guide's lesson card: no 讲义 yet → 开始学这一站 (a draft in the
 * conversation input; the coach writes the 讲义 when it is sent); asked and
 * waiting → 正在备课 (the 讲义 page opens by itself when they land); written →
 * the points with their mastery and 打开讲义.
 */
export function LessonCard({ p, projectId, resourceId, node, resource }: {
  p: ViewProps['p']; projectId: string; resourceId: string; node: RoadmapNode; resource: LibraryResource | undefined
}): ReactNode {
  const { t, actions, useStore } = p
  const key = `${projectId}:${resourceId}:${node.id}`
  const since = useStore(s => s.preparing[key])
  const points = useStationPoints(p, projectId, node)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(Date.now())
  const notes = node.notes
  // Waiting: re-read now and then; the page opens itself once the 讲义 land.
  useEffect(() => {
    if (since === undefined) return
    if (notes !== undefined && Date.parse(notes.updatedAt) >= since) {
      actions.setPreparing(key, undefined)
      actions.push({ view: 'lesson', projectId, resourceId, nodeId: node.id })
      return
    }
    const timer = setInterval(() => { setNow(Date.now()); actions.refresh() }, 4000)
    return () => { clearInterval(timer) }
  }, [since, notes?.updatedAt])
  const start = (): void => {
    void p.bindTarget({ projectId, resourceId })
    const text = t(resource?.origin === 'authored' ? 'prime.lessonStart' : 'prime.lessonStartBook', {
      book: resource?.title ?? '',
      node: node.title,
      points: (node.points ?? []).map(point => point.title).join('、'),
    })
    if (!p.primeConversation(text)) { setFailed(true); return }
    setFailed(false)
    actions.setPreparing(key, Date.now())
  }
  const ask = (): void => {
    void p.bindTarget({ projectId, resourceId })
    if (!p.primeConversation(t('prime.lessonAsk', { node: node.title }))) setFailed(true)
  }
  const waiting = since !== undefined && notes === undefined
  const stale = waiting && now - since > PREPARE_PATIENCE_MS
  return (
    <section className={css.stepBox} data-lesson="true">
      {notes === undefined ? (
        <>
          <span className={css.stepText}>
            <strong>{waiting ? (stale ? t('lesson.prepareStale') : t('lesson.preparing')) : t('lesson.notReady')}</strong>
            <span className={css.muted}>{waiting ? t('lesson.preparingHint') : t('lesson.notReadyHint')}</span>
          </span>
          <div className={css.askActions}>
            {waiting && !stale
              ? <button type="button" className={css.textButton} onClick={() => { actions.setPreparing(key, undefined) }}>{t('lesson.cancelWait')}</button>
              : <button type="button" className={css.ghost} onClick={ask}>{t('lesson.ask')}</button>}
            <button type="button" className={css.primary} disabled={waiting && !stale} onClick={start}>{t('lesson.start')}</button>
          </div>
        </>
      ) : (
        <>
          <span className={css.stepText}>
            <strong>{t('lesson.ready', { count: String((node.points ?? []).length) })}</strong>
            <span className={css.muted}>{t('lesson.meta', { at: when(notes.updatedAt, t), count: String(lessonSections(notes.text).filter(section => section.title !== undefined).length) })}</span>
            {points.length > 0 && (
              <span className={css.lessonPoints}>
                {points.map(point => <span key={point.id}><i className={css.lessonDot} data-state={point.state} aria-hidden="true" />{point.title}</span>)}
              </span>
            )}
          </span>
          <div className={css.askActions}>
            <button type="button" className={css.ghost} onClick={ask}>{t('lesson.ask')}</button>
            <button type="button" className={css.primary} onClick={() => { actions.push({ view: 'lesson', projectId, resourceId, nodeId: node.id }) }}>{t('lesson.open')}</button>
          </div>
        </>
      )}
      {failed && <span className={css.muted}>{t('notice.noConversation')}</span>}
    </section>
  )
}
