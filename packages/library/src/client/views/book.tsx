/**
 * One shelf resource in the sidebar (a thick one — a book, a course): its
 * roadmap draft waiting for 采用, its adopted path as an S-shaped trail of
 * nodes, and one node's page.
 *
 * The same pieces serve the project's OWN path: NodeView with no resourceId
 * reads the project-level roadmap, and 「我的记录」 exists only when the
 * station covers a thick resource. Every station carries the same four tabs —
 * 导读 / 我的记录 / 讲义 / 章节考: the gate tab is the station's quiz on a
 * quiz / read node, and its acceptance sheet (the coach judges the rubric
 * with library_assess) on an acceptance node.
 *
 * @module @khorsheed/dsh-library/client/views/book
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { ChipRow, ListRow, PanelHeader, UnderlineTabs } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import {
  acceptanceLines, coverKind, isThickResource, parseLocator,
  type LibraryAcceptanceLine, type LibraryAssessment, type LibraryAttempt, type LibraryPage, type LibraryQuizFocus, type LibraryQuizQuestion, type LibraryResource, type LibraryRoadmap, type LibraryVerdict, type RoadmapNode,
} from '../../types.ts'
import { colorOf, Cover, coverOf } from '../look.tsx'
import { CoverChips, coverLabel, evidencePolicy, type CoverContext } from '../covers.tsx'
import { collectMissed, collectVoided, type MissedRow } from '../mistakes.ts'
import type { LibraryNodeTab } from '../store.ts'
import {
  IconCameraOutlineMedium, IconCheckOutlineMedium, IconLockOutlineMedium, IconRefreshOutlineMedium, IconSparkleOutlineMedium, IconTrashOutlineMedium,
} from '../icons.tsx'
import { outcome, shortGloss, StateLine, useLoad, value, WeaknessBars, when, type ViewProps } from '../ui.tsx'
import { MathText, Tex } from '../math.tsx'
import css from '../LibraryPane.module.css'

/** The zigzag column (0..2) a node at `index` sits in. */
function column(index: number): number {
  const phase = index % 4
  return phase === 3 ? 1 : phase
}

/** A node's contents rows of one thick resource, as titles. */
function rowsOf(node: RoadmapNode, resource: LibraryResource): string[] {
  const toc = resource.toc ?? []
  return node.covers
    .flatMap(cover => (coverKind(cover) === 'resource' && cover.ref === resource.id && cover.locator !== undefined ? parseLocator(cover.locator) : []))
    .flatMap(range => toc.filter(row => row.n >= range.from && row.n <= range.to).map(row => row.title))
}

/** The kind line of a thick resource: a book's bookKind, else its kind label. */
function kindLabelOf(resource: LibraryResource, t: ViewProps['p']['t']): string {
  return resource.kind === 'book' ? t(`bookKind.${resource.meta?.bookKind ?? 'knowledge'}`) : t(`resource.kind.${resource.kind}`)
}

/** One resource: draft card, path, or the ask for one. */
export function BookView({ p, projectId, resourceId }: ViewProps & { projectId: string; resourceId: string }): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const loaded = useLoad(async () => {
    const [detail, roadmaps] = await Promise.all([outcome(p.getProject(projectId)), value(p.getRoadmap(projectId, resourceId))])
    return { resource: detail.resources.find(candidate => candidate.id === resourceId), resources: detail.resources, project: detail.project, shade: Math.max(0, detail.resources.filter(isThickResource).findIndex(candidate => candidate.id === resourceId)), ...roadmaps }
  }, [projectId, resourceId, rev])
  // Resource-level quizzes hang on no station — this section is their entry.
  const assessments = useLoad(() => value(p.listAssessments(projectId, resourceId)), [projectId, resourceId, rev])
  const [notice, setNotice] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const resource = loaded.data?.resource
  const looseQuizzes = (assessments.data?.assessments ?? []).filter(quiz => quiz.type === 'quiz' && quiz.scope.nodeId === undefined).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const prime = (text: string): void => {
    void p.bindTarget({ projectId, resourceId })
    setNotice(p.primeConversation(text) ? t('notice.primed') : t('notice.noConversation'))
  }

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await run()
      actions.refresh()
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    try {
      await outcome(p.removeResource(projectId, resourceId))
      actions.refresh()
      actions.pop()
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  return (
    <>
      <PanelHeader
        title={resource?.title ?? ''}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        actions={resource === undefined ? [] : [
          { id: 'ask', label: t('action.askCoach'), icon: <IconSparkleOutlineMedium />, onSelect: () => { prime(t('prime.readBook', { book: resource.title })) } },
          { id: 'replan', label: t('book.replan'), icon: <IconRefreshOutlineMedium />, onSelect: () => { prime(t('prime.replan', { book: resource.title })) } },
          { id: 'bind', label: t('action.bindBook'), icon: <IconSparkleOutlineMedium />, menuOnly: true, onSelect: () => { void p.bindTarget({ projectId, resourceId }).then(() => { setNotice(t('notice.bound')) }) } },
          { id: 'delete', label: t('book.delete'), icon: <IconTrashOutlineMedium />, menuOnly: true, onSelect: () => { setConfirmingDelete(true) } },
        ]}
        moreLabel={t('action.more')}
      />
      <div className={css.body} data-color={loaded.data?.project === undefined ? undefined : colorOf(loaded.data.project)}>
        <StateLine loaded={loaded} t={t} />
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {confirmingDelete && (
          <div className={css.notice} role="alert">
            <span>{t('book.deleteConfirm')}</span>
            <span className={css.chips}>
              <button type="button" className={css.danger} disabled={busy} onClick={() => { void remove() }}>{t('action.confirmDelete')}</button>
              <button type="button" className={css.ghost} onClick={() => { setConfirmingDelete(false) }}>{t('action.cancel')}</button>
            </span>
          </div>
        )}
        {resource !== undefined && (
          <section className={css.bookHead}>
            <Cover book={coverOf(resource)} shade={loaded.data?.shade ?? 0} size="badge" />
            <span className={css.projectText}>
              <span className={css.projectName}>{resource.title}</span>
              <span className={css.muted}>
                {[resource.meta?.edition, kindLabelOf(resource, t), loaded.data?.roadmap === undefined ? undefined : t('book.shelfMeta', { done: String(loaded.data.roadmap.nodes.filter(node => node.gate === 'quiz' && node.state === 'done').length), total: String(loaded.data.roadmap.nodes.filter(node => node.gate === 'quiz').length) })].filter(Boolean).join(' · ')}
              </span>
            </span>
          </section>
        )}
        {resource?.meta?.extras !== undefined && resource.meta.extras.length > 0 && <Extras p={p} resource={resource} />}
        {resource !== undefined && loaded.data?.draft !== undefined && (
          <DraftCard
            p={p}
            draft={loaded.data.draft}
            context={{ resources: loaded.data.resources }}
            tocBy={resource.tocSource?.by}
            replaces={loaded.data.roadmap !== undefined}
            busy={busy}
            onAdopt={() => { void act(() => outcome(p.adoptRoadmap(projectId, resourceId))) }}
            onDiscard={() => { void act(() => outcome(p.discardDraft(projectId, resourceId))) }}
          />
        )}
        {resource !== undefined && loaded.data?.roadmap !== undefined && (
          <Path p={p} roadmap={loaded.data.roadmap} onOpen={node => { actions.push({ view: 'node', projectId, resourceId, nodeId: node.id, tab: 'guide' }) }} />
        )}
        {resource !== undefined && loaded.data?.roadmap === undefined && loaded.data?.draft === undefined && (
          <div className={css.empty}>
            <div className={css.emptyTitle}>{t('book.noRoadmap')}</div>
            <div className={css.muted}>{t('book.noRoadmapBody')}</div>
            <button type="button" className={css.primary} onClick={() => { prime(t('prime.plan', { book: resource.title })) }}>{t('book.askPlan')}</button>
          </div>
        )}
        {resource !== undefined && looseQuizzes.length > 0 && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('book.quizzes', { count: String(looseQuizzes.length) })}</h3>
            <QuizRows p={p} projectId={projectId} quizzes={looseQuizzes} />
          </section>
        )}
        {resource !== undefined && (
          <div className={css.muted}>
            {t('book.contentsMeta', { rows: String(resource.toc?.length ?? 0), kind: kindLabelOf(resource, t) })}
            {resource.tocSource?.url !== undefined && <> · <a className={css.link} href={resource.tocSource.url} target="_blank" rel="noreferrer">{t('book.contentsSource')}</a></>}
          </div>
        )}
      </div>
    </>
  )
}

/** The draft card: what the coach proposes, and the learner's 采用 / 放弃. Shared by the resource page and the project page (no resource = the project's own path). */
export function DraftCard({ p, draft, context, tocBy, replaces, busy, onAdopt, onDiscard }: {
  p: ViewProps['p']
  draft: LibraryRoadmap
  /** The project's shelf, for labeling covers. */
  context: CoverContext
  /** The resource's contents-source badge (a resource's own draft only). */
  tocBy?: 'web' | 'model' | 'photo' | undefined
  replaces: boolean
  busy: boolean
  onAdopt: () => void
  onDiscard: () => void
}): ReactNode {
  const { t } = p
  return (
    <section className={css.draft}>
      <div className={css.draftHead}>
        <span className={css.draftTitle}>{t('book.draftTitle')}</span>
        {tocBy !== undefined && <span className={css.chip} data-tone={tocBy === 'web' ? 'web' : 'know'}>{t(`tocSource.${tocBy}`)}</span>}
      </div>
      <div className={css.muted}>{t('book.draftMeta', { count: String(draft.nodes.length) })}{draft.note === undefined ? '' : ` · ${draft.note}`}</div>
      <ol className={css.draftNodes}>
        {draft.nodes.map(node => (
          <li key={node.id}>
            <span className={css.kind} data-kind={node.gate}>{t(`nodeKind.${node.gate}`)}</span>
            <div className={css.extraText}>
              <span>{node.title}</span>
              {node.goals.length > 0 && <span className={css.muted}>{node.goals[0]}</span>}
              {node.gate === 'acceptance' && node.acceptance !== undefined && (
                <span className={css.muted}>{t('accept.meta', { count: String(node.acceptance.length) })}</span>
              )}
              <CoverChips covers={node.covers} context={context} t={t} />
            </div>
          </li>
        ))}
      </ol>
      {replaces && <div className={css.muted}>{t('book.draftReplaces')}</div>}
      <div className={css.actions}>
        <button type="button" className={css.primary} disabled={busy} onClick={onAdopt}>{t('book.adopt')}</button>
        <button type="button" className={css.ghost} disabled={busy} onClick={onDiscard}>{t('book.discard')}</button>
      </div>
    </section>
  )
}

/** The 「开始前 / 附录」 strip: what the resource holds that is not a stop on the path. */
function Extras({ p, resource }: { p: ViewProps['p']; resource: LibraryResource }): ReactNode {
  const { t } = p
  const [open, setOpen] = useState(false)
  const extras = resource.meta?.extras ?? []
  const before = extras.filter(extra => extra.when === 'before')
  return (
    <section className={css.extras}>
      <button type="button" className={css.extrasHead} aria-expanded={open} onClick={() => { setOpen(!open) }}>
        <span>{before.length > 0 ? t('book.extrasBefore', { first: before[0]!.title }) : t('book.extrasTitle')}</span>
        <span className={css.muted}>{t('book.extrasCount', { count: String(extras.length) })}{open ? ' ▴' : ' ▾'}</span>
      </button>
      {open && (
        <ul className={css.extrasList}>
          {extras.map(extra => (
            <li key={extra.title}>
              <span className={css.kind} data-kind={extra.when === 'before' ? 'quiz' : 'read'}>{t(extra.when === 'before' ? 'book.extraBefore' : 'book.extraReference')}</span>
              <span className={css.extraText}>
                <b>{extra.title}</b>
                {(extra.note !== undefined || extra.where !== undefined) && <span className={css.muted}>{[extra.where, extra.note].filter(Boolean).join(' · ')}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Path geometry: rows are 84px tall; levels zigzag over three columns. */
const ROW = 84
const COLUMNS = [1 / 6, 1 / 2, 5 / 6]

/**
 * The adopted path: levels (quiz and acceptance nodes) on an S-shaped trail
 * joined by connectors — solid up to the furthest reached level, dotted
 * beyond — and side stops (read nodes) as small dots beside the level they
 * follow.
 */
function Path({ p, roadmap, onOpen }: { p: ViewProps['p']; roadmap: LibraryRoadmap; onOpen: (node: RoadmapNode) => void }): ReactNode {
  const { t } = p
  // Levels gate (quiz by its quiz, acceptance by its rubric); read nodes are side stops.
  const levels = roadmap.nodes.filter(node => node.gate !== 'read')
  // Each side stop hangs beside the level before it (or the first one).
  const sides = new Map<string, RoadmapNode[]>()
  let anchor = levels[0]?.id
  for (const node of roadmap.nodes) {
    if (node.gate !== 'read') { anchor = node.id; continue }
    if (anchor === undefined) continue
    sides.set(anchor, [...(sides.get(anchor) ?? []), node])
  }
  const width = 340
  const x = (index: number): number => (COLUMNS[column(index)] ?? 0.5) * width
  const y = (index: number): number => index * ROW + 30
  const done = levels.filter(node => node.state === 'done').length
  return (
    <section className={css.section}>
      <h3 className={css.sectionTitle}>{t('book.pathTitle', { done: String(done), total: String(levels.length) })}</h3>
      <div className={css.path} style={{ height: Math.max(levels.length, 1) * ROW + 48 }}>
        <svg className={css.pathLine} viewBox={`0 0 ${width} ${Math.max(levels.length, 1) * ROW + 10}`} aria-hidden="true">
          {levels.slice(1).map((node, index) => {
            const from = index
            const to = index + 1
            const reached = node.state !== 'locked'
            const midY = (y(from) + y(to)) / 2
            return (
              <path
                key={node.id}
                d={`M${x(from)} ${y(from)} C ${x(from)} ${midY}, ${x(to)} ${midY}, ${x(to)} ${y(to)}`}
                className={reached ? css.lineReached : css.lineAhead}
              />
            )
          })}
        </svg>
        {levels.map((node, index) => (
          <div key={node.id} className={css.pathSlot} style={{ left: `${(COLUMNS[column(index)] ?? 0.5) * 100}%`, top: y(index) }}>
            <button type="button" className={css.pathNode} onClick={() => { onOpen(node) }}>
              <span className={css.disc} data-state={node.state} data-kind={node.gate}>
                {node.state === 'done' ? <IconCheckOutlineMedium /> : node.state === 'locked' ? <IconLockOutlineMedium /> : index + 1}
              </span>
              <span className={css.pathLabel} data-state={node.state}>{node.title}</span>
              {node.state === 'done' && node.quizStats?.bestRatio !== undefined && <span className={css.best}>{Math.round(node.quizStats.bestRatio * 100)}%</span>}
            </button>
            {(sides.get(node.id) ?? []).map(side => (
              <button key={side.id} type="button" className={css.sideStop} data-side={column(index) === 2 ? 'left' : 'right'} data-state={side.state} onClick={() => { onOpen(side) }}>
                <span className={css.sideDot} aria-hidden="true" />
                <span>{side.title}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

/** One node: guide, photographed pages, its 讲义, and the gate tab 章节考 — on every kind of station. */
export function NodeView({ p, projectId, resourceId, nodeId, tab }: ViewProps & { projectId: string; resourceId: string | undefined; nodeId: string; tab: LibraryNodeTab }): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const loaded = useLoad(async () => {
    const [detail, roadmaps] = await Promise.all([outcome(p.getProject(projectId)), value(p.getRoadmap(projectId, resourceId))])
    const resource = resourceId === undefined ? undefined : detail.resources.find(candidate => candidate.id === resourceId)
    const node = roadmaps.roadmap?.nodes.find(candidate => candidate.id === nodeId)
    return { resource, resources: detail.resources, project: detail.project, node, passRatio: roadmaps.roadmap?.passRatio ?? 0.8 }
  }, [projectId, resourceId, nodeId, rev])
  const [notice, setNotice] = useState<string | undefined>()
  const node = loaded.data?.node
  // The pages tab rides a thick resource: the route's, else the station's
  // first thick cover (the learner picks when several).
  const coveredThick = (node?.covers ?? []).flatMap(cover => {
    if (coverKind(cover) !== 'resource') return []
    const resource = loaded.data?.resources.find(candidate => candidate.id === cover.ref)
    return resource !== undefined && isThickResource(resource) ? [resource.id] : []
  })
  const [pickedResource, setPickedResource] = useState<string | undefined>()
  const pagesResourceId = resourceId ?? pickedResource ?? coveredThick[0]
  const pagesResource = loaded.data?.resources.find(candidate => candidate.id === pagesResourceId)
  const resource = loaded.data?.resource

  const prime = (text: string): void => {
    void p.bindTarget(resourceId === undefined ? { projectId } : { projectId, resourceId })
    setNotice(p.primeConversation(text) ? t('notice.primed') : t('notice.noConversation'))
  }

  const tabs: { id: LibraryNodeTab; label: string }[] = [
    { id: 'guide', label: t('node.guide') },
    ...(coveredThick.length > 0 ? [{ id: 'pages' as const, label: t('node.pages') }] : []),
    { id: 'notes', label: t('node.notes') },
    // Every station ends in 章节考: a quiz / read station's papers, an
    // acceptance station's rubric sheet.
    { id: 'quiz', label: t('node.quiz') },
  ]
  const activeTab = tabs.some(candidate => candidate.id === tab) ? tab : 'guide'
  const coverContext: CoverContext = { resources: loaded.data?.resources ?? [] }

  return (
    <>
      <PanelHeader
        title={node?.title ?? ''}
        meta={resource?.title ?? loaded.data?.project.name}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        actions={node === undefined ? [] : [
          { id: 'ask', label: t('action.askCoach'), icon: <IconSparkleOutlineMedium />, onSelect: () => { prime(resource === undefined ? t('prime.nodeOnPath', { node: node.title }) : t('prime.node', { book: resource.title, node: node.title })) } },
        ]}
        moreLabel={t('action.more')}
      />
      {node !== undefined && (
        <div className={css.coversRow}>
          <CoverChips covers={node.covers} context={coverContext} t={t} />
        </div>
      )}
      <UnderlineTabs
        label={t('node.tabs')}
        tabs={tabs}
        value={activeTab}
        onChange={next => { actions.replace({ view: 'node', projectId, ...(resourceId === undefined ? {} : { resourceId }), nodeId, tab: next }) }}
      />
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {node !== undefined && activeTab === 'guide' && (
          <GuideTab p={p} projectId={projectId} resourceId={resourceId} node={node} resource={resource} coverContext={coverContext} onPrime={prime} />
        )}
        {node !== undefined && activeTab === 'pages' && pagesResource !== undefined && pagesResourceId !== undefined && (
          <>
            {coveredThick.length > 1 && resourceId === undefined && (
              <ChipRow
                label={t('node.pagesPick')}
                chips={coveredThick.map(candidate => ({ id: candidate, label: loaded.data?.resources.find(r => r.id === candidate)?.title ?? candidate }))}
                value={pagesResourceId}
                onSelect={setPickedResource}
              />
            )}
            <PagesTab p={p} projectId={projectId} resourceId={pagesResourceId} resourceTitle={pagesResource.title} node={node} onBind={() => { void p.bindTarget({ projectId, resourceId: pagesResourceId }) }} />
          </>
        )}
        {node !== undefined && activeTab === 'notes' && (
          <NotesTab p={p} node={node} onPrime={prime} />
        )}
        {node !== undefined && activeTab === 'quiz' && node.gate === 'acceptance' && (
          <AcceptanceTab p={p} projectId={projectId} node={node} passRatio={loaded.data?.passRatio ?? 0.8} onPrime={() => { prime(t('prime.accept', { node: node.title, nodeId: node.id, criteria: acceptanceLines(node).map(line => `- ${line.id}: ${line.line}`).join('\n') })) }} />
        )}
        {node !== undefined && activeTab === 'quiz' && node.gate !== 'acceptance' && (
          <QuizTab
            p={p}
            projectId={projectId}
            resourceId={resourceId}
            node={node}
            passRatio={loaded.data?.passRatio ?? 0.8}
            resources={loaded.data?.resources ?? []}
            onPrime={focus => { prime(resource === undefined ? t(`prime.quiz.station.${focus}`, { node: node.title }) : t(`prime.quiz.${focus}`, { book: resource.title, node: node.title })) }}
            onRetake={prompts => { prime(t('prime.quiz.retake', { node: node.title, list: prompts.map(prompt => `- ${prompt}`).join('\n') })) }}
            onRetakeAll={prompts => { prime(t('prime.quiz.missedAll', { list: prompts.map(prompt => `- ${prompt}`).join('\n') })) }}
            onReplace={prompts => { prime(t('prime.quiz.replace', { node: node.title, list: prompts.map(prompt => `- ${prompt}`).join('\n') })) }}
          />
        )}
      </div>
    </>
  )
}

function GuideTab({ p, projectId, resourceId, node, resource, coverContext, onPrime }: {
  p: ViewProps['p']; projectId: string; resourceId: string | undefined; node: RoadmapNode; resource: LibraryResource | undefined; coverContext: CoverContext; onPrime: (text: string) => void
}): ReactNode {
  const { t, actions } = p
  const rows = resource === undefined ? [] : rowsOf(node, resource)
  const [error, setError] = useState<string | undefined>()
  return (
    <>
      {node.state === 'locked' && <div className={css.notice}>{t('node.locked')}</div>}
      {node.goals.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('node.goals')}</h3>
          <ul className={css.goals}>{node.goals.map(goal => <li key={goal}>{goal}</li>)}</ul>
        </section>
      )}
      {rows.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('node.covers')}</h3>
          <ul className={css.goals}>{rows.map(row => <li key={row}>{row}</li>)}</ul>
        </section>
      )}
      {resource === undefined && node.covers.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('node.covers')}</h3>
          <ul className={css.goals}>{node.covers.map((cover, at) => <li key={at}>{coverLabel(cover, coverContext, t)}</li>)}</ul>
        </section>
      )}
      <div className={css.actions}>
        <button type="button" className={css.secondary} onClick={() => { onPrime(resource === undefined ? t('prime.nodeOnPath', { node: node.title }) : t('prime.node', { book: resource.title, node: node.title })) }}>{t('action.askCoach')}</button>
        {node.gate === 'read' && node.state === 'current' && (
          <button
            type="button"
            className={css.primary}
            onClick={() => { void outcome(p.markNodeRead(projectId, resourceId, node.id)).then(() => { actions.pop() }, (failure: unknown) => { setError(String(failure)) }) }}
          >{t('node.markRead')}</button>
        )}
      </div>
      {error !== undefined && <div className={css.error}>{error}</div>}
    </>
  )
}

function PagesTab({ p, projectId, resourceId, resourceTitle, node, onBind }: {
  p: ViewProps['p']; projectId: string; resourceId: string; resourceTitle: string; node: RoadmapNode; onBind: () => void
}): ReactNode {
  const { t, useStore, actions } = p
  const rev = useStore(s => s.rev)
  const [notice, setNotice] = useState<string | undefined>()
  // After a photo goes out, re-read every few seconds until the coach has
  // recorded a new page (or two minutes pass) — the page lands here by itself.
  const [watching, setWatching] = useState<{ since: number; pages: number } | undefined>()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (watching === undefined) return
    const timer = setInterval(() => {
      if (Date.now() - watching.since > 120_000) setWatching(undefined)
      else setTick(value => value + 1)
    }, 4000)
    return () => { clearInterval(timer) }
  }, [watching])
  const pages = useLoad(() => value(p.listPages(projectId, resourceId, node.id)), [projectId, resourceId, node.id, rev, tick])
  const cards = useLoad(() => value(p.listCards({ projectId, nodeId: node.id, limit: 50 })), [projectId, node.id, rev, tick])
  const count = pages.data?.pages.length ?? 0
  useEffect(() => {
    if (watching !== undefined && count > watching.pages) {
      setWatching(undefined)
      setNotice(t('node.photoRecorded'))
    }
  }, [count, watching])

  const send = (sent: boolean, ok: string): void => {
    setNotice(sent ? ok : t('notice.noConversation'))
  }

  const onPick = (file: File | undefined): void => {
    if (file === undefined) return
    onBind()
    const sent = p.sendPhoto(file, t('prime.photo', { book: resourceTitle, node: node.title }))
    if (sent) setWatching({ since: Date.now(), pages: count })
    send(sent, t('node.photoSent'))
  }

  return (
    <>
      <StateLine loaded={pages} t={t} />
      {notice !== undefined && <div className={css.notice}>{notice}</div>}
      <div className={css.pages}>
        {(pages.data?.pages ?? []).map(page => <PageThumb key={page.id} p={p} projectId={projectId} page={page} />)}
        <label className={css.pageAdd}>
          <IconCameraOutlineMedium />
          <span>{watching === undefined ? t('node.photo') : t('node.photoWaiting')}</span>
          <input
            className={css.fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={event => { onPick(event.target.files?.[0]); event.target.value = '' }}
          />
        </label>
      </div>
      {(pages.data?.pages ?? []).map(page => (
        <PageFixes
          key={page.id}
          p={p}
          page={page}
          onSend={(text, ok) => { onBind(); send(p.sendMessage(text), ok) }}
        />
      ))}
      {(cards.data?.cards.length ?? 0) > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('node.cardsHere', { count: String(cards.data!.total) })}</h3>
          {cards.data!.cards.map(card => (
            <ListRow
              key={card.id}
              title={card.term}
              meta={shortGloss(card.gloss)}
              trailing={<WeaknessBars weakness={card.weakness} label={t('cards.weakness', { level: String(card.weakness) })} />}
              onSelect={() => { actions.push({ view: 'cards', projectId, filter: 'all' }) }}
            />
          ))}
        </section>
      )}
    </>
  )
}

/**
 * One page's corrections: the marks the coach was unsure of (tap to keep
 * one) and a word it missed (type it). Both go out as the learner's own
 * message, so the chat shows what was asked and the coach cards it in context.
 */
function PageFixes({ p, page, onSend }: { p: ViewProps['p']; page: LibraryPage; onSend: (text: string, ok: string) => void }): ReactNode {
  const { t } = p
  const [adding, setAdding] = useState(false)
  const [word, setWord] = useState('')
  const label = page.label ?? t('node.thisPage')
  const uncertain = page.marks.filter(mark => mark.uncertain === true)
  return (
    <section className={css.fixes}>
      <div className={css.fixesHead}>
        <span className={css.muted}>{label}</span>
        {!adding && <button type="button" className={css.textButton} onClick={() => { setAdding(true) }}>{t('node.addMissed')}</button>}
      </div>
      {uncertain.length > 0 && (
        <div className={css.chips}>
          <span className={css.muted}>{t('node.uncertain')}</span>
          {uncertain.map(mark => (
            <button
              key={mark.text}
              type="button"
              className={css.chipButton}
              onClick={() => { onSend(t('prime.keepMark', { page: label, word: mark.text }), t('node.fixSent')) }}
            >{mark.text}</button>
          ))}
        </div>
      )}
      {adding && (
        <form
          className={css.row}
          onSubmit={event => {
            event.preventDefault()
            if (word.trim() === '') return
            onSend(t('prime.addMissed', { page: label, word: word.trim() }), t('node.fixSent'))
            setWord('')
            setAdding(false)
          }}
        >
          <input className={css.input} autoFocus value={word} placeholder={t('node.addMissedPlaceholder')} onChange={event => { setWord(event.target.value) }} />
          <button type="submit" className={css.secondary} disabled={word.trim() === ''}>{t('node.send')}</button>
        </form>
      )}
    </section>
  )
}

/** A page thumbnail: the photo read back on demand, its label and mark count. */
function PageThumb({ p, projectId, page }: { p: ViewProps['p']; projectId: string; page: LibraryPage }): ReactNode {
  const { t } = p
  const photo = useLoad(() => outcome(p.readPagePhoto(projectId, page.id)), [projectId, page.id])
  return (
    <figure className={css.page}>
      {photo.data !== undefined
        ? <img className={css.pageImage} src={`data:${photo.data.mediaType};base64,${photo.data.data}`} alt={page.label ?? ''} />
        : <span className={css.pageImage} aria-hidden="true" />}
      <figcaption className={css.muted}>{t('node.pageCaption', { label: page.label ?? '', marks: String(page.marks.length) })}</figcaption>
    </figure>
  )
}

/**
 * The station's 讲义 tab: the coach's distilled teaching on the node —
 * marginalia for a book station, the textbook itself for a 讲授 station.
 */
function NotesTab({ p, node, onPrime }: { p: ViewProps['p']; node: RoadmapNode; onPrime: (text: string) => void }): ReactNode {
  const { t } = p
  const notes = node.notes
  return (
    <>
      {node.state === 'locked' && <div className={css.notice}>{t('node.locked')}</div>}
      {notes === undefined ? (
        <div className={css.empty}>
          <div className={css.emptyTitle}>{t('node.notesEmptyTitle')}</div>
          <div className={css.muted}>{t('node.notesEmpty')}</div>
        </div>
      ) : (
        <section className={css.notesPaper}>
          <div className={css.notesMeta}>{t('node.notesMeta', { at: when(notes.updatedAt, t), n: String(notes.revisions) })}</div>
          <NotesBody text={notes.text} />
        </section>
      )}
      <div className={css.actions}>
        <button type="button" className={css.secondary} onClick={() => { onPrime(t('prime.notes', { node: node.title, nodeId: node.id })) }}>{notes === undefined ? t('node.notesWrite') : t('node.notesAsk')}</button>
      </div>
    </>
  )
}

/** 讲义 body: headings, bullet lists, paragraphs, with **bold** and `code` inline. */
function NotesBody({ text }: { text: string }): ReactNode {
  const blocks: ReactNode[] = []
  let key = 0
  for (const raw of text.split(/\n{2,}/)) {
    const block = raw.trim()
    if (block === '') continue
    const heading = /^#{1,4}\s+(.*)$/.exec(block)
    if (heading !== null) {
      blocks.push(<h4 key={key++}>{inline(heading[1] ?? '')}</h4>)
      continue
    }
    const lines = block.split('\n').map(line => line.trim()).filter(line => line !== '')
    if (lines.length > 0 && lines.every(line => line.startsWith('- ') || line.startsWith('* '))) {
      blocks.push(<ul key={key++}>{lines.map((line, at) => <li key={at}>{inline(line.slice(2))}</li>)}</ul>)
      continue
    }
    blocks.push(<p key={key++}>{lines.map((line, at) => <Fragment key={at}>{at > 0 && <br />}{inline(line)}</Fragment>)}</p>)
  }
  return <div className={css.notesBody}>{blocks}</div>
}

/** `**bold**`, `` `code` `` and $…$ TeX spans — deliberately the only inline marks. */
function inline(text: string): ReactNode {
  return text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\*\*[^*]+\*\*|`[^`]+`)/g).map((part, at) => {
    if (part.startsWith('$$') && part.endsWith('$$') && part.length > 4) return <Tex key={at} tex={part.slice(2, -2)} block />
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) return <Tex key={at} tex={part.slice(1, -1)} />
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={at}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={at}>{part.slice(1, -1)}</code>
    return <Fragment key={at}>{part}</Fragment>
  })
}

/** The right answer as a row caption: choice questions get their letter. */
function answerText(question: LibraryQuizQuestion): string {
  const at = question.options?.indexOf(question.answer) ?? -1
  return at >= 0 ? `${String.fromCharCode(65 + at)}. ${question.answer}` : question.answer
}

/** One missed / flagged question row: the mark, the prompt, and where it sits (answer · when · book). */
function MissRow({ p, row, variant, book }: { p: ViewProps['p']; row: MissedRow; variant: 'missed' | 'voided'; book?: string | undefined }): ReactNode {
  const { t } = p
  return (
    <div className={css.missRow}>
      <span className={css.missMark} data-void={variant === 'voided' ? 'true' : undefined} aria-hidden="true">{variant === 'voided' ? '?' : '✕'}</span>
      <div className={css.missText}>
        <span>{row.question.prompt}</span>
        <span className={css.muted}>
          {variant === 'missed' && <><MathText text={t('node.missedAnswer', { answer: answerText(row.question) })} /> · </>}
          {when(row.at, t)}{book === undefined ? '' : ` · ${book}`}
        </span>
      </div>
    </div>
  )
}

function QuizTab({ p, projectId, resourceId, node, passRatio, resources, onPrime, onRetake, onRetakeAll, onReplace }: {
  p: ViewProps['p']; projectId: string; resourceId: string | undefined; node: RoadmapNode; passRatio: number; resources: readonly LibraryResource[]; onPrime: (focus: LibraryQuizFocus) => void; onRetake: (prompts: string[]) => void; onRetakeAll: (prompts: string[]) => void; onReplace: (prompts: string[]) => void
}): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  // The quiz direction: the three focuses. 错题重考 is not a direction — it is
  // the paper card's primary action once this station has misses.
  const [direction, setDirection] = useState<LibraryQuizFocus>('mine')
  const [showOthers, setShowOthers] = useState(false)
  // After asking, re-read until the coach has stored the new quiz (two minutes at most).
  const [watching, setWatching] = useState<{ since: number; count: number } | undefined>()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (watching === undefined) return
    const timer = setInterval(() => {
      if (Date.now() - watching.since > 120_000) setWatching(undefined)
      else setTick(current => current + 1)
    }, 4000)
    return () => { clearInterval(timer) }
  }, [watching])
  // Project-wide read, split below into the station's own quizzes and the ones
  // gating no station (本书测验 / 自由测验) — else those are invisible from here.
  const assessments = useLoad(() => value(p.listAssessments(projectId, undefined, undefined, 'quiz')), [projectId, rev, tick])
  const shown = (assessments.data?.assessments ?? []).filter(quiz =>
    quiz.scope.nodeId === node.id
    || (quiz.scope.nodeId === undefined && (resourceId !== undefined ? quiz.scope.resourceId === resourceId : quiz.scope.resourceId === undefined)))
  const quizCount = shown.length
  // The quiz the learner is waiting for opens itself when it lands.
  useEffect(() => {
    if (watching === undefined || quizCount <= watching.count) return
    setWatching(undefined)
    const landed = shown.at(-1)
    if (landed !== undefined) actions.push({ view: 'quiz', projectId, ...(landed.scope.resourceId === undefined ? {} : { resourceId: landed.scope.resourceId }), quizId: landed.id })
  }, [quizCount, watching])
  const mine = useLoad(() => value(p.listCards({ projectId, nodeId: node.id, limit: 5 })), [projectId, node.id, rev])
  // This station's missed questions — every quiz's latest sitting, joined by assessmentId.
  const allAttempts = useLoad(() => value(p.listAttempts(projectId)), [projectId, rev])
  const stats = node.quizStats
  const mineCount = mine.data?.total ?? 0
  // The station's papers, oldest first: the current one is the newest not
  // superseded; everything superseded (or older than it) is history.
  const stations = shown.filter(quiz => quiz.scope.nodeId === node.id)
  const live = stations.filter(quiz => quiz.supersededBy === undefined)
  const latest = live.at(-1) ?? stations.at(-1)
  const earlier = stations.filter(quiz => quiz !== latest).reverse()
  const loose = shown.filter(quiz => quiz.scope.nodeId === undefined)
  const policy = evidencePolicy(node.covers, resources)
  // Every quiz's latest sitting (attempts arrive newest first) drives both the
  // paper card's state and the missed / flagged lists — one shared collection,
  // so the station's list, its 其他站 shelf and the project page's entry count
  // can never disagree (mistakes.ts).
  const latestByQuiz = new Map<string, LibraryAttempt>()
  for (const attempt of allAttempts.data?.attempts ?? []) {
    if (attempt.assessmentId !== undefined && !latestByQuiz.has(attempt.assessmentId)) latestByQuiz.set(attempt.assessmentId, attempt)
  }
  const allQuizzes = assessments.data?.assessments ?? []
  const allMissed = collectMissed(allAttempts.data?.attempts ?? [], allQuizzes)
  const missed = allMissed.filter(row => row.quiz.scope.nodeId === node.id)
  const others = allMissed.filter(row => row.quiz.scope.nodeId !== node.id)
  const voided = collectVoided(allAttempts.data?.attempts ?? [], stations)
  const bookOf = (quiz: LibraryAssessment): string | undefined =>
    quiz.scope.resourceId === undefined ? undefined : resources.find(candidate => candidate.id === quiz.scope.resourceId)?.title
  // The paper card's three states: untaken → 开始作答; passed → 再出一套;
  // failed with misses → 重考错题. The focus chips always configure the ask.
  const sitting = latest === undefined ? undefined : latestByQuiz.get(latest.id)
  const taken = sitting !== undefined
  const passed = taken && sitting.ratio >= passRatio
  const openPaper = (quiz: LibraryAssessment): void => {
    actions.push({ view: 'quiz', projectId, ...(quiz.scope.resourceId === undefined ? (resourceId === undefined ? {} : { resourceId }) : { resourceId: quiz.scope.resourceId }), quizId: quiz.id })
  }
  const ask = (): void => {
    onPrime(direction)
    setWatching({ since: Date.now(), count: quizCount })
  }
  const retake = (): void => {
    onRetake(missed.map(row => row.question.prompt))
    setWatching({ since: Date.now(), count: quizCount })
  }
  const asking = watching !== undefined
  const againLabel = asking ? t('node.quizWaiting') : t('node.askQuizAgain')
  const retakeLabel = asking ? t('node.quizWaiting') : t('node.retakeCount', { count: String(missed.length) })
  return (
    <>
      {node.state === 'locked' && <div className={css.notice}>{t('node.locked')}</div>}
      <div className={css.muted}>
        {t('node.passRule', { percent: String(Math.round(passRatio * 100)) })}
        {stats !== undefined && stats.attempts > 0 && ` · ${t('node.best', { percent: String(Math.round((stats.bestRatio ?? 0) * 100)), attempts: String(stats.attempts) })}`}
      </div>
      <section className={css.policy}>
        <span className={css.muted}>{t('policy.title')}</span>
        <span>{t(`policy.${policy}`)}</span>
      </section>
      <StateLine loaded={assessments} t={t} />
      {latest !== undefined && (
        <section className={css.quizLatest}>
          <div className={css.quizLatestText}>
            <strong>{taken ? t(passed ? 'node.paperPassed' : 'node.paperFailed', { percent: String(Math.round(sitting.ratio * 100)) }) : t('node.quizLatest', { count: String(latest.questions?.length ?? 0) })}</strong>
            <span className={css.muted}>{[t(`focus.${latest.focus ?? 'mixed'}`), sourceMix((latest.questions ?? []).map(question => question.evidence.kind), t), ...(taken ? [when(sitting.at, t)] : [])].join(' · ')}</span>
          </div>
          {!taken && <button type="button" className={css.primary} onClick={() => { openPaper(latest) }}>{t('quiz.startNow')}</button>}
          {taken && !passed && missed.length > 0 && <button type="button" className={css.primary} disabled={asking} onClick={retake}>{retakeLabel}</button>}
          {taken && (passed || missed.length === 0) && <button type="button" className={css.primary} disabled={asking} onClick={ask}>{againLabel}</button>}
          <div className={css.quizLatestFoot}>
            {!taken && <button type="button" className={css.textButton} disabled={asking} onClick={ask}>{againLabel}</button>}
            {!taken && missed.length > 0 && <button type="button" className={css.textButton} disabled={asking} onClick={retake}>{retakeLabel}</button>}
            {taken && !passed && missed.length > 0 && <button type="button" className={css.textButton} disabled={asking} onClick={ask}>{againLabel}</button>}
            {taken && <button type="button" className={css.textButton} onClick={() => { openPaper(latest) }}>{t('node.redoSame')}</button>}
          </div>
        </section>
      )}
      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('node.focusTitle')}</h3>
        <ChipRow
          label={t('node.focusTitle')}
          chips={FOCUSES.map(id => ({ id, label: t(`focus.${id}`), ...(id === 'mine' ? { count: mineCount } : {}) }))}
          value={direction}
          onSelect={id => { setDirection(id as LibraryQuizFocus) }}
        />
        <div className={css.muted}>
          {direction === 'mine'
            ? mineCount === 0 ? t('node.focusMineEmpty') : t('node.focusMineHint', { terms: (mine.data?.cards ?? []).map(card => card.term).join('、') })
            : t(`node.focusHint.${direction}`)}
        </div>
      </section>
      {latest === undefined && (
        <div className={css.actions}>
          <button type="button" className={css.primary} disabled={asking} onClick={ask}>{asking ? t('node.quizWaiting') : t('node.askQuiz')}</button>
        </div>
      )}
      {(missed.length > 0 || others.length > 0) && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{missed.length > 0 ? t('node.missedTitle', { count: String(missed.length) }) : t('mistakes.title', { count: String(others.length) })}</h3>
          {missed.map(row => <MissRow key={`${row.quiz.id}:${row.question.id}`} p={p} row={row} variant="missed" />)}
          {others.length > 0 && missed.length > 0 && !showOthers && (
            <div className={css.actions}>
              <button type="button" className={css.textButton} onClick={() => { setShowOthers(true) }}>{t('node.otherMissed', { count: String(others.length) })} ▸</button>
            </div>
          )}
          {others.length > 0 && (missed.length === 0 || showOthers) && (
            <>
              {missed.length > 0 && <div className={css.muted}>{t('node.otherMissed', { count: String(others.length) })}</div>}
              {others.map(row => <MissRow key={`${row.quiz.id}:${row.question.id}`} p={p} row={row} variant="missed" book={bookOf(row.quiz)} />)}
              <div className={css.actions}>
                <button type="button" className={css.textButton} onClick={() => { onRetakeAll(others.map(row => row.question.prompt)) }}>{t('mistakes.cta')}</button>
              </div>
            </>
          )}
        </section>
      )}
      {voided.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('node.voidedTitle', { count: String(voided.length) })}</h3>
          {voided.map(row => <MissRow key={`${row.quiz.id}:${row.question.id}`} p={p} row={row} variant="voided" />)}
          <div className={css.muted}>{t('node.voidedHint')}</div>
          <div className={css.actions}>
            <button type="button" className={css.textButton} onClick={() => { onReplace(voided.map(row => row.question.prompt)) }}>{t('node.voidedReplace')}</button>
          </div>
        </section>
      )}
      {earlier.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('node.quizEarlier')}</h3>
          {earlier.map(quiz => (
            <ListRow
              key={quiz.id}
              title={t('node.quizRow', { count: String(quiz.questions?.length ?? 0) })}
              meta={[t(`focus.${quiz.focus ?? 'mixed'}`), sourceMix((quiz.questions ?? []).map(question => question.evidence.kind), t)].join(' · ')}
              trailing={<span className={css.linkText}>{t('quiz.start')}</span>}
              onSelect={() => { actions.push({ view: 'quiz', projectId, ...(quiz.scope.resourceId === undefined ? (resourceId === undefined ? {} : { resourceId }) : { resourceId: quiz.scope.resourceId }), quizId: quiz.id }) }}
            />
          ))}
        </section>
      )}
      {loose.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t(resourceId === undefined ? 'project.quizzes' : 'book.quizzes', { count: String(loose.length) })}</h3>
          <QuizRows p={p} projectId={projectId} quizzes={loose.slice().reverse()} />
        </section>
      )}
    </>
  )
}

/** An acceptance station's gate tab: the rubric, the submit gesture, the history. */
function AcceptanceTab({ p, projectId, node, passRatio, onPrime }: {
  p: ViewProps['p']; projectId: string; node: RoadmapNode; passRatio: number; onPrime: () => void
}): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const attempts = useLoad(() => value(p.listAttempts(projectId, node.id)), [projectId, node.id, rev])
  // The station gates no quiz itself, but its covered thick resources may hold
  // resource-level ones (本书测验) — the acceptance lines often ref them.
  const coveredThick = [...new Set(node.covers.flatMap(cover => coverKind(cover) === 'resource' ? [cover.ref] : []))]
  const looseQuizzes = useLoad(async () => {
    const lists = await Promise.all(coveredThick.map(id => value(p.listAssessments(projectId, id, undefined, 'quiz'))))
    return lists.flatMap(result => result.assessments).filter(quiz => quiz.scope.nodeId === undefined)
  }, [projectId, node.id, rev, coveredThick.join(',')])
  // A ref line's live state, before any acceptance sitting: the referenced
  // assessment's latest sitting does the judging (attempts arrive newest first).
  const allAttempts = useLoad(() => value(p.listAttempts(projectId)), [projectId, rev])
  const latest = attempts.data?.attempts[0]
  const rubric = acceptanceLines(node)
  const verdictOf = (line: LibraryAcceptanceLine): LibraryVerdict | undefined =>
    latest?.verdicts.find(verdict => (verdict.task === line.id || verdict.criterion === line.line) && verdict.void !== true)
    ?? (line.ref === undefined ? undefined : (() => {
      const sitting = (allAttempts.data?.attempts ?? []).find(attempt => attempt.assessmentId === line.ref)
      return sitting === undefined ? undefined : { task: line.id, criterion: line.line, pass: sitting.ratio >= passRatio, ratio: sitting.ratio, evidence: '', by: 'auto' as const }
    })())
  return (
    <>
      {node.state === 'locked' && <div className={css.notice}>{t('node.locked')}</div>}
      <div className={css.muted}>{t('accept.station', { count: String(rubric.length) })} · {t('accept.passRule', { percent: String(Math.round(passRatio * 100)) })}</div>
      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('accept.title')}</h3>
        <ul className={css.acceptList}>
          {rubric.map(line => {
            const verdict = verdictOf(line)
            return (
              <li key={line.id} className={css.acceptItem}>
                <span className={css.acceptMark} data-state={verdict === undefined ? 'none' : (verdict.pass && (verdict.ratio ?? 1) >= 0.5) ? 'pass' : 'fail'} aria-hidden="true">
                  {verdict === undefined ? '' : (verdict.pass && (verdict.ratio ?? 1) >= 0.5) ? <IconCheckOutlineMedium size={11} /> : '✕'}
                </span>
                <span className={css.acceptText}>
                  {line.line}
                  {line.ref !== undefined && (
                    <button type="button" className={css.textButton} onClick={() => { actions.push({ view: 'quiz', projectId, quizId: line.ref! }) }}>{t('accept.machine')} →</button>
                  )}
                  {verdict !== undefined && verdict.ratio !== undefined && verdict.ratio > 0 && verdict.ratio < 1 ? <span className={css.muted}> · {Math.round(verdict.ratio * 100)}%</span> : null}
                </span>
              </li>
            )
          })}
        </ul>
        <div className={css.muted}>{t('accept.hint')}</div>
      </section>
      {(looseQuizzes.data?.length ?? 0) > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('book.quizzes', { count: String(looseQuizzes.data!.length) })}</h3>
          <QuizRows p={p} projectId={projectId} quizzes={looseQuizzes.data!} />
        </section>
      )}
      <div className={css.actions}>
        <button type="button" className={css.primary} onClick={onPrime}>{t('accept.submit')}</button>
      </div>
      <div className={css.muted}>{t('accept.submitHint')}</div>
      {(attempts.data?.attempts.length ?? 0) > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('accept.history')}</h3>
          {attempts.data!.attempts.map(attempt => (
            <div key={attempt.id} className={css.moveRow}>
              <span>{Math.round(attempt.ratio * 100)}%</span>
              <span className={css.muted}>{when(attempt.at, t)}</span>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

const FOCUSES: readonly LibraryQuizFocus[] = ['mine', 'book', 'mixed']

/**
 * Rows of quizzes that gate no station (the resource page's 本书测验, the project
 * page's 自由测验, a station's same-scope list) — each opens the paper. The
 * route's resource comes from the quiz's own scope.
 */
export function QuizRows({ p, projectId, quizzes }: { p: ViewProps['p']; projectId: string; quizzes: readonly LibraryAssessment[] }): ReactNode {
  const { t, actions } = p
  return (
    <>
      {quizzes.map(quiz => (
        <ListRow
          key={quiz.id}
          title={t('node.quizRow', { count: String(quiz.questions?.length ?? 0) })}
          meta={[t(`focus.${quiz.focus ?? 'mixed'}`), sourceMix((quiz.questions ?? []).map(question => question.evidence.kind), t), when(quiz.createdAt, t)].join(' · ')}
          trailing={<span className={css.linkText}>{t('quiz.start')}</span>}
          onSelect={() => { actions.push({ view: 'quiz', projectId, ...(quiz.scope.resourceId === undefined ? {} : { resourceId: quiz.scope.resourceId }), quizId: quiz.id }) }}
        />
      ))}
    </>
  )
}

/** 「照片 3 · 领域知识 7」 for a quiz row. */
function sourceMix(kinds: readonly string[], t: ViewProps['p']['t']): string {
  const counts = new Map<string, number>()
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  return [...counts].map(([kind, count]) => `${t(kind === 'photo' ? 'evidence.photo' : kind === 'web' ? 'evidence.web' : 'evidence.knowledge')} ${count}`).join(' · ')
}
