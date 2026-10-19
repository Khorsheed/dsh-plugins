/**
 * One textbook in the sidebar (a book, a course, a coach-authored outline):
 * its place in the study order and origin, its roadmap draft waiting for
 * 采用, its adopted path as an S-shaped trail of nodes, the chapters the path
 * skips, and one node's page. Every path belongs to a textbook — the
 * project carries none. 「我的记录」 exists only when the station covers
 * its own textbook. Every station carries the same four tabs —
 * 导读 / 我的记录 / 讲义 / 章节考: the gate tab is the station's quiz on a
 * quiz / read node, and its acceptance sheet (the coach judges the rubric
 * with library_assess) on an acceptance node.
 *
 * @module @khorsheed/dsh-library/client/views/book
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { ChipRow, ListRow, PanelHeader, UnderlineTabs } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import {
  acceptanceLines, coverKind, isThickResource, parseLocator,
  type LibraryAcceptanceLine, type LibraryAssessment, type LibraryAttempt, type LibraryPage, type LibraryQuizFocus, type LibraryQuizQuestion, type LibraryResource, type LibraryRoadmap, type LibraryVerdict, type RoadmapNode,
} from '../../types.ts'
import { colorOf, Cover, coverOf } from '../look.tsx'
import { CoverChips, coverLabel, type CoverContext } from '../covers.tsx'
import { collectMissed, collectVoided, type MissedRow } from '../mistakes.ts'
import type { LibraryNodeTab, LibraryQuizSettings } from '../store.ts'
import {
  IconCameraOutlineMedium, IconCheckOutlineMedium, IconInfoOutlineMedium, IconLockOutlineMedium, IconRefreshOutlineMedium, IconSparkleOutlineMedium, IconTrashOutlineMedium,
} from '../icons.tsx'
import { ConfirmDialog, OriginTag, outcome, shortGloss, StateLine, useLoad, value, WeaknessBars, when, type ViewProps } from '../ui.tsx'
import { MathText } from '../math.tsx'
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
  const [deleteError, setDeleteError] = useState<string | undefined>()
  // The delete dialog names the photographed pages that go with the textbook.
  const pages = useLoad(() => confirmingDelete ? value(p.listPages(projectId, resourceId)) : Promise.resolve(undefined), [projectId, resourceId, confirmingDelete])
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
    setDeleteError(undefined)
    try {
      await outcome(p.removeResource(projectId, resourceId))
      setConfirmingDelete(false)
      actions.refresh()
      actions.pop()
    } catch (failure) {
      setDeleteError(failure instanceof Error ? failure.message : String(failure))
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
          { id: 'delete', label: t('book.delete'), icon: <IconTrashOutlineMedium />, menuOnly: true, onSelect: () => { setDeleteError(undefined); setConfirmingDelete(true) } },
        ]}
        moreLabel={t('action.more')}
      />
      <div className={css.body} data-color={loaded.data?.project === undefined ? undefined : colorOf(loaded.data.project)}>
        <StateLine loaded={loaded} t={t} />
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {resource !== undefined && (
          <section className={css.bookHead}>
            {resource.seq !== undefined ? <span className={css.seq}>{resource.seq}</span> : <Cover book={coverOf(resource)} shade={loaded.data?.shade ?? 0} size="badge" />}
            <span className={css.projectText}>
              <span className={css.textbookTitle}>{resource.title}<OriginTag origin={resource.origin} digital={resource.kind === 'course'} t={t} /></span>
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
            skipped={skippedRows(loaded.data.draft, resource)}
            replaces={loaded.data.roadmap !== undefined}
            busy={busy}
            onAdopt={() => { void act(() => outcome(p.adoptRoadmap(projectId, resourceId))) }}
            onDiscard={() => { void act(() => outcome(p.discardDraft(projectId, resourceId))) }}
          />
        )}
        {resource !== undefined && loaded.data?.roadmap !== undefined && (
          <>
            <Path p={p} roadmap={loaded.data.roadmap} onOpen={node => { actions.push({ view: 'node', projectId, resourceId, nodeId: node.id, tab: 'guide' }) }} />
            <SkippedRows p={p} rows={skippedRows(loaded.data.roadmap, resource)} />
          </>
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
      {confirmingDelete && resource !== undefined && (
        <ConfirmDialog
          title={t('book.deleteTitle', { book: resource.title, project: loaded.data?.project.name ?? '' })}
          lines={[
            loaded.data?.roadmap !== undefined
              ? t('book.deletePath', { done: String(loaded.data.roadmap.nodes.filter(node => node.state === 'done').length), total: String(loaded.data.roadmap.nodes.length) })
              : loaded.data?.draft !== undefined ? t('book.deleteDraft') : undefined,
            t('book.deletePages', { count: String(pages.data?.pages.length ?? 0) }),
            (assessments.data?.assessments.length ?? 0) > 0 ? t('book.deleteQuizzes', { count: String(assessments.data!.assessments.length) }) : undefined,
          ].filter((line): line is string => line !== undefined)}
          keep={t('book.deleteKeep')}
          note={resource.seq !== undefined ? t('book.deleteRenumber') : undefined}
          confirmLabel={t('book.deleteConfirmButton')}
          cancelLabel={t('action.cancel')}
          busy={busy}
          error={deleteError}
          onConfirm={() => { void remove() }}
          onCancel={() => { setConfirmingDelete(false) }}
        />
      )}
    </>
  )
}

/** The textbook's contents rows no station of `roadmap` covers — what this path skips. */
function skippedRows(roadmap: LibraryRoadmap, resource: LibraryResource): { n: number; title: string }[] {
  const covered = new Set<number>()
  let whole = false
  for (const node of roadmap.nodes) {
    for (const cover of node.covers) {
      if (coverKind(cover) !== 'resource' || cover.ref !== resource.id) continue
      if (cover.locator === undefined) { whole = true; continue }
      for (const range of parseLocator(cover.locator)) {
        for (let n = range.from; n <= range.to; n += 1) covered.add(n)
      }
    }
  }
  if (whole || covered.size === 0) return []
  return (resource.toc ?? []).filter(row => !covered.has(row.n)).map(row => ({ n: row.n, title: row.title }))
}

/** 「本路线不学」: the skipped chapters, folded. */
function SkippedRows({ p, rows }: { p: ViewProps['p']; rows: readonly { n: number; title: string }[] }): ReactNode {
  const { t } = p
  if (rows.length === 0) return null
  return (
    <details className={css.skipped}>
      <summary>{t('book.skipped', { count: String(rows.length) })}</summary>
      <ul>{rows.map(row => <li key={row.n}>{row.title}</li>)}</ul>
    </details>
  )
}

/** The draft card on a textbook's page: what the coach proposes, what it skips, and the learner's 采用 / 放弃. */
export function DraftCard({ p, draft, context, tocBy, skipped, replaces, busy, onAdopt, onDiscard }: {
  p: ViewProps['p']
  draft: LibraryRoadmap
  /** The project's shelf, for labeling covers. */
  context: CoverContext
  /** The textbook's contents-source badge. */
  tocBy?: 'web' | 'model' | 'photo' | undefined
  /** The contents rows no station covers. */
  skipped: readonly { n: number; title: string }[]
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
              {node.gate === 'quiz' && node.points !== undefined && node.points.length > 0 && (
                <span className={css.muted}>{t('book.points', { points: node.points.map(point => point.title).join(' / ') })}</span>
              )}
              {node.gate === 'acceptance' && node.acceptance !== undefined && (
                <span className={css.muted}>{t('accept.meta', { count: String(node.acceptance.length) })}</span>
              )}
              <CoverChips covers={node.covers} context={context} t={t} />
            </div>
          </li>
        ))}
      </ol>
      <SkippedRows p={p} rows={skipped} />
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
export function NodeView({ p, projectId, resourceId, nodeId, tab }: ViewProps & { projectId: string; resourceId: string; nodeId: string; tab: LibraryNodeTab }): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const loaded = useLoad(async () => {
    const [detail, roadmaps] = await Promise.all([outcome(p.getProject(projectId)), value(p.getRoadmap(projectId, resourceId))])
    const resource = detail.resources.find(candidate => candidate.id === resourceId)
    const node = roadmaps.roadmap?.nodes.find(candidate => candidate.id === nodeId)
    return { resource, resources: detail.resources, project: detail.project, node, passRatio: roadmaps.roadmap?.passRatio ?? 0.8 }
  }, [projectId, resourceId, nodeId, rev])
  const [notice, setNotice] = useState<string | undefined>()
  const node = loaded.data?.node
  // The pages tab rides the station's own textbook, when the station covers it.
  const coversOwn = (node?.covers ?? []).some(cover => coverKind(cover) === 'resource' && cover.ref === resourceId)
  const resource = loaded.data?.resource

  const prime = (text: string): void => {
    void p.bindTarget({ projectId, resourceId })
    setNotice(p.primeConversation(text) ? t('notice.primed') : t('notice.noConversation'))
  }

  const tabs: { id: LibraryNodeTab; label: string }[] = [
    { id: 'guide', label: t('node.guide') },
    ...(coversOwn && resource !== undefined && isThickResource(resource) ? [{ id: 'pages' as const, label: t('node.pages') }] : []),
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
          { id: 'ask', label: t('action.askCoach'), icon: <IconSparkleOutlineMedium />, onSelect: () => { prime(t('prime.node', { book: resource?.title ?? '', node: node.title })) } },
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
        onChange={next => { actions.replace({ view: 'node', projectId, resourceId, nodeId, tab: next }) }}
      />
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {node !== undefined && activeTab === 'guide' && (
          <GuideTab p={p} projectId={projectId} resourceId={resourceId} node={node} resource={resource} coverContext={coverContext} onPrime={prime} />
        )}
        {node !== undefined && activeTab === 'pages' && resource !== undefined && (
          <PagesTab p={p} projectId={projectId} resourceId={resourceId} resourceTitle={resource.title} node={node} onBind={() => { void p.bindTarget({ projectId, resourceId }) }} />
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
            onPrime={(focus, context) => {
              const base = t(`prime.quiz.${focus}`, { book: resource?.title ?? '', node: node.title })
              const weak = context?.weak ?? []
              const points = context?.points ?? []
              const kinds = context?.kinds ?? []
              prime(base
                + (weak.length > 0 ? t('prime.quiz.weakSuffix', { terms: weak.join('、') }) : '')
                + (points.length > 0 ? t('prime.quiz.pointsSuffix', { points: points.join('、') }) : '')
                + (kinds.length > 0 ? t('prime.quiz.kindsSuffix', { kinds: kinds.map(kind => t(`kind.${kind}`)).join('、') }) : '')
                + (context?.count !== undefined ? t('prime.quiz.countSuffix', { count: String(context.count) }) : ''))
            }}
            onRetake={prompts => { prime(t('prime.quiz.retake', { node: node.title, list: prompts.map(prompt => `- ${prompt}`).join('\n') })) }}
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
  const [marking, setMarking] = useState(false)
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
        <button type="button" className={css.secondary} onClick={() => { onPrime(t('prime.node', { book: resource?.title ?? '', node: node.title })) }}>{t('action.askCoach')}</button>
        {node.gate === 'read' && node.state === 'current' && (
          <button
            type="button"
            className={css.primary}
            disabled={marking}
            onClick={() => {
              setMarking(true)
              void outcome(p.markNodeRead(projectId, resourceId, node.id)).then(() => { actions.pop() }, (failure: unknown) => { setError(String(failure)); setMarking(false) })
            }}
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
 * The body renders through the host's MarkdownText (full GFM + KaTeX — the
 * same surface the conversation has).
 */
function NotesTab({ p, node, onPrime }: { p: ViewProps['p']; node: RoadmapNode; onPrime: (text: string) => void }): ReactNode {
  const { t } = p
  const notes = node.notes
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])
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
          <MarkdownText text={notes.text} labels={markdownLabels} />
        </section>
      )}
      <div className={css.actions}>
        <button type="button" className={css.secondary} onClick={() => { onPrime(t('prime.notes', { node: node.title, nodeId: node.id })) }}>{notes === undefined ? t('node.notesWrite') : t('node.notesAsk')}</button>
      </div>
    </>
  )
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
        <span><MathText text={row.question.prompt} /></span>
        <span className={css.muted}>
          {variant === 'missed' && <><MathText text={t('node.missedAnswer', { answer: answerText(row.question) })} /> · </>}
          {when(row.at, t)}{book === undefined ? '' : ` · ${book}`}
        </span>
      </div>
    </div>
  )
}

function QuizTab({ p, projectId, resourceId, node, passRatio, onPrime, onRetake, onReplace }: {
  p: ViewProps['p']; projectId: string; resourceId: string | undefined; node: RoadmapNode; passRatio: number; onPrime: (focus: LibraryQuizFocus, context?: { weak?: readonly string[]; points?: readonly string[]; kinds?: readonly LibraryQuizQuestion['kind'][]; count?: number | undefined }) => void; onRetake: (prompts: string[]) => void; onReplace: (prompts: string[]) => void
}): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  // The quiz direction: the three focuses. 错题重考 is not a direction — it is
  // the paper card's primary action once this station has misses.
  // The station's own misses fold into one card (other stations' never show here — a fresh station must not look already sat).
  const [showMissed, setShowMissed] = useState(false)
  // The points grid's explainer hides behind the title's ⓘ (tap to toggle).
  const [showPointsHint, setShowPointsHint] = useState(false)
  // The settings (范围 / 重点 / 题型 / 题量) and the pending ask live in the pane
  // store per station, so leaving the tab and coming back keeps both. 范围
  // defaults to 都考; no kinds picked = the coach's mix; 题量 defaults to 10.
  const stationKey = `${projectId}:${resourceId ?? ''}:${node.id}`
  const station = useStore(s => s.quiz[stationKey])
  const settings = station?.settings ?? DEFAULT_SETTINGS
  const direction = settings.focus
  const picked = settings.picked
  const kinds = settings.kinds
  const countText = settings.countText
  const update = (patch: Partial<LibraryQuizSettings>): void => { actions.setQuizSettings(stationKey, { ...settings, ...patch }) }
  const setDirection = (focus: LibraryQuizFocus): void => { update({ focus }) }
  const setCountText = (text: string): void => { update({ countText: text }) }
  // After asking, re-read until the coach has stored the new quiz; past the
  // patience window the card says so instead of silently giving up.
  const watching = station?.ask
  const [now, setNow] = useState(Date.now())
  const stale = watching !== undefined && now - watching.since > ASK_PATIENCE_MS
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (watching === undefined || stale) return
    const timer = setInterval(() => {
      setNow(Date.now())
      setTick(current => current + 1)
    }, 4000)
    return () => { clearInterval(timer) }
  }, [watching, stale])
  // Project-wide read, split below into the station's own quizzes and the ones
  // gating no station (本书测验 / 自由测验) — else those are invisible from here.
  const assessments = useLoad(() => value(p.listAssessments(projectId, undefined, undefined, 'quiz')), [projectId, rev, tick])
  const shown = (assessments.data?.assessments ?? []).filter(quiz =>
    quiz.scope.nodeId === node.id
    || (quiz.scope.nodeId === undefined && (resourceId !== undefined ? quiz.scope.resourceId === resourceId : quiz.scope.resourceId === undefined)))
  const quizCount = shown.length
  // The quiz the learner is waiting for opens itself when it lands.
  useEffect(() => {
    if (watching === undefined || assessments.data === undefined || quizCount <= watching.count) return
    actions.setQuizAsk(stationKey, undefined)
    const landed = shown.at(-1)
    if (landed !== undefined) actions.push({ view: 'quiz', projectId, ...(landed.scope.resourceId === undefined ? {} : { resourceId: landed.scope.resourceId }), quizId: landed.id })
  }, [quizCount, watching])
  const mine = useLoad(() => value(p.listCards({ projectId, nodeId: node.id, limit: 5 })), [projectId, node.id, rev])
  // The station's weak cards drive both the 薄弱 line under the pass rule and the weak list the ask primes carry.
  const weak = useLoad(() => value(p.listCards({ projectId, nodeId: node.id, weakMin: 1, limit: 5 })), [projectId, node.id, rev])
  // Every attempt of the project — the paper card's state and the missed lists both read it (through mistakes.ts).
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
  const voided = collectVoided(allAttempts.data?.attempts ?? [], latest === undefined ? [] : [latest])
  // Per-point mastery: the newest verdict (attempts arrive newest first) of any
  // question probing the point decides — strong, weak, or untested.
  const points = node.points ?? []
  const pointStates = new Map<string, 'strong' | 'weak'>()
  {
    const quizById = new Map(allQuizzes.map(quiz => [quiz.id, quiz]))
    for (const attempt of allAttempts.data?.attempts ?? []) {
      const quiz = quizById.get(attempt.assessmentId ?? '')
      if (quiz === undefined || quiz.scope.nodeId !== node.id) continue
      for (const verdict of attempt.verdicts) {
        if (verdict.void === true) continue
        const question = quiz.questions?.find(candidate => candidate.id === verdict.task)
        if (question?.point === undefined || pointStates.has(question.point)) continue
        pointStates.set(question.point, verdict.pass ? 'strong' : 'weak')
      }
    }
  }
  const pickedTitles = points.filter(point => picked.includes(point.id)).map(point => point.title)
  const togglePoint = (pointId: string): void => {
    update({ picked: picked.includes(pointId) ? picked.filter(candidate => candidate !== pointId) : [...picked, pointId] })
  }
  // The paper card's three states: untaken → 开始作答; passed → 再出一套;
  // failed with misses → 重考错题. The focus chips always configure the ask.
  const sitting = latest === undefined ? undefined : latestByQuiz.get(latest.id)
  const taken = sitting !== undefined
  const passed = taken && sitting.ratio >= passRatio
  const openPaper = (quiz: LibraryAssessment): void => {
    actions.push({ view: 'quiz', projectId, ...(quiz.scope.resourceId === undefined ? (resourceId === undefined ? {} : { resourceId }) : { resourceId: quiz.scope.resourceId }), quizId: quiz.id })
  }
  const ask = (): void => {
    const parsed = Number.parseInt(countText.trim(), 10)
    const count = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_QUIZ_COUNT) : DEFAULT_QUIZ_COUNT
    onPrime(direction, { weak: weak.data?.cards.map(card => card.term) ?? [], points: pickedTitles, kinds, count })
    const summary = [t(`focus.${direction}`), kinds.length === 0 ? t('node.kindsMixed') : kinds.map(kind => t(`kind.${kind}`)).join('、'), t('node.askCount', { count: String(count) }), ...(pickedTitles.length > 0 ? [t('node.askPointsShort', { count: String(pickedTitles.length) })] : [])].join(' · ')
    actions.setQuizAsk(stationKey, { since: Date.now(), count: quizCount, summary })
    setNow(Date.now())
  }
  const retake = (): void => {
    onRetake(missed.map(row => row.question.prompt))
    actions.setQuizAsk(stationKey, { since: Date.now(), count: quizCount, summary: t('node.retakeCount', { count: String(missed.length) }) })
    setNow(Date.now())
  }
  const asking = watching !== undefined && !stale
  // A picked set of points overrides the default ask (the agreed priority: 选了考点 > 开始作答 > 重考错题 > 再出一套).
  const askLabel = asking ? t('node.quizWaiting')
    : pickedTitles.length > 0 ? t('node.askPoints', { count: String(pickedTitles.length) })
    : t('node.askQuizAgain')
  const retakeLabel = asking ? t('node.quizWaiting') : t('node.retakeCount', { count: String(missed.length) })
  const primaryIsRetake = taken && !passed && missed.length > 0 && pickedTitles.length === 0
  return (
    <>
      {node.state === 'locked' && <div className={css.notice}>{t('node.locked')}</div>}
      <div className={css.muted}>
        {t('node.passRule', { percent: String(Math.round(passRatio * 100)) })}
        {stats !== undefined && stats.attempts > 0 && ` · ${t('node.best', { percent: String(Math.round((stats.bestRatio ?? 0) * 100)), attempts: String(stats.attempts) })}`}
      </div>
      {(weak.data?.cards.length ?? 0) > 0 && (
        <div className={css.muted}>{t('node.weakLine', { terms: weak.data!.cards.map(card => card.term).join('、') })}</div>
      )}
      <StateLine loaded={assessments} t={t} />
      {watching !== undefined && (
        <section className={css.asking} role="status" data-stale={stale}>
          <span className={css.askingText}>
            <strong>{stale ? t('node.askStale') : t('node.asking')}</strong>
            <span className={css.muted}>{watching.summary} · {t('node.askSince', { minutes: String(Math.max(1, Math.round((now - watching.since) / 60_000))) })}</span>
          </span>
          {stale
            ? <button type="button" className={css.secondary} onClick={ask}>{t('node.askAgain')}</button>
            : null}
          <button type="button" className={css.textButton} onClick={() => { actions.setQuizAsk(stationKey, undefined) }}>{t('node.askDismiss')}</button>
        </section>
      )}
      {latest !== undefined && (
        <section className={css.quizLatest}>
          <div className={css.quizLatestText}>
            <strong>{taken ? t(passed ? 'node.paperPassed' : 'node.paperFailed', { percent: String(Math.round(sitting.ratio * 100)) }) : t('node.quizLatest', { count: String(latest.questions?.length ?? 0) })}</strong>
            <span className={css.muted}>{[t(`focus.${latest.focus ?? 'mixed'}`), sourceMix((latest.questions ?? []).map(question => question.evidence.kind), t), ...(taken ? [when(sitting.at, t)] : [])].join(' · ')}</span>
          </div>
          {!taken && <button type="button" className={css.primary} onClick={() => { openPaper(latest) }}>{t('quiz.startNow')}</button>}
          {taken && primaryIsRetake && <button type="button" className={css.primary} disabled={asking} onClick={retake}>{retakeLabel}</button>}
          {taken && !primaryIsRetake && <button type="button" className={css.primary} disabled={asking} onClick={ask}>{askLabel}</button>}
          <div className={css.quizLatestFoot}>
            {(!taken || primaryIsRetake) && <button type="button" className={css.textButton} disabled={asking} onClick={ask}>{askLabel}</button>}
            {missed.length > 0 && !primaryIsRetake && <button type="button" className={css.textButton} disabled={asking} onClick={retake}>{retakeLabel}</button>}
            {taken && <button type="button" className={css.textButton} onClick={() => { openPaper(latest) }}>{t('node.redoSame')}</button>}
          </div>
        </section>
      )}
      {points.length > 0 && (
        <section className={css.section}>
          <h3 className={`${css.sectionTitle} ${css.pointsHead}`}>
            {t('node.pointsTitle')}
            <button
              type="button"
              className={css.infoButton}
              aria-expanded={showPointsHint}
              aria-label={t('node.pointsHintLabel')}
              onClick={() => { setShowPointsHint(value => !value) }}
            ><IconInfoOutlineMedium size={13} /></button>
          </h3>
          <div className={css.points}>
            {points.map(point => {
              const state = pointStates.get(point.id) ?? 'untested'
              const on = picked.includes(point.id)
              return (
                <button key={point.id} type="button" className={css.point} data-state={state} aria-pressed={on} onClick={() => { togglePoint(point.id) }}>
                  <span className={css.pointName}>{point.title}</span>
                  <span className={css.pointState}>{t(`node.pointState.${state}`)}</span>
                </button>
              )
            })}
          </div>
          {showPointsHint && <div className={css.muted}>{t('node.pointsHint')}</div>}
        </section>
      )}
      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('node.settingsTitle')}</h3>
        <div className={css.settingRow}>
          <span className={css.settingLabel}>{t('node.setting.range')}</span>
          <div className={css.settingControl}>
            <ChipRow
              label={t('node.setting.range')}
              chips={FOCUSES.map(id => ({ id, label: t(`focus.${id}`), ...(id === 'mine' ? { count: mineCount } : {}) }))}
              value={direction}
              onSelect={id => { setDirection(id as LibraryQuizFocus) }}
            />
            <div className={css.muted}>
              {direction === 'mine'
                ? mineCount === 0 ? t('node.focusMineEmpty') : t('node.focusMineHint', { terms: (mine.data?.cards ?? []).map(card => card.term).join('、') })
                : t(`node.focusHint.${direction}`)}
            </div>
          </div>
        </div>
        <div className={css.settingRow}>
          <span className={css.settingLabel}>{t('node.kindsTitle')}</span>
          <ChipRow
            className={css.settingChips}
            label={t('node.kindsTitle')}
            chips={QUIZ_KINDS.map(id => ({ id, label: t(`kind.${id}`) }))}
            value={kinds}
            onSelect={id => { update({ kinds: kinds.includes(id) ? kinds.filter(kind => kind !== id) : [...kinds, id] }) }}
          />
        </div>
        <div className={css.settingRow}>
          <span className={css.settingLabel}>{t('node.countTitle')}</span>
          <input
            className={`${css.input} ${css.countInput}`}
            inputMode="numeric"
            aria-label={t('node.countTitle')}
            placeholder={String(DEFAULT_QUIZ_COUNT)}
            value={countText}
            onChange={event => { setCountText(event.target.value) }}
            onBlur={() => {
              const parsed = Number.parseInt(countText.trim(), 10)
              setCountText(Number.isFinite(parsed) ? String(Math.min(Math.max(parsed, 1), MAX_QUIZ_COUNT)) : String(DEFAULT_QUIZ_COUNT))
            }}
          />
        </div>
      </section>
      {latest === undefined && (
        <div className={css.actions}>
          <button type="button" className={css.primary} disabled={asking} onClick={ask}>{asking ? t('node.quizWaiting') : pickedTitles.length > 0 ? t('node.askPoints', { count: String(pickedTitles.length) }) : t('node.askQuiz')}</button>
        </div>
      )}
      {missed.length > 0 && (
        <section className={css.mistakeBook}>
          <button type="button" className={css.mistakeHead} aria-expanded={showMissed} onClick={() => { setShowMissed(!showMissed) }}>
            <span className={css.mistakeHeadText}>
              <strong>{t('node.missedTitle', { count: String(missed.length) })}</strong>
              <span className={css.muted}>{t('node.missedMeta', { when: when(missed[0]!.at, t) })}</span>
            </span>
            <span className={css.linkText}>{showMissed ? t('node.missedHide') : t('node.missedShow')}</span>
          </button>
          {showMissed && (
            <div className={css.mistakeRows}>
              {missed.map(row => <MissRow key={`${row.quiz.id}:${row.question.id}`} p={p} row={row} variant="missed" />)}
            </div>
          )}
        </section>
      )}
      {voided.length > 0 && (
        <div className={css.muted}>
          {t('node.voidedSummary', { count: String(voided.length) })}
          {' · '}
          <button type="button" className={css.textButton} onClick={() => { onReplace(voided.map(row => row.question.prompt)) }}>{t('node.voidedReplace')}</button>
        </div>
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
const QUIZ_KINDS: readonly LibraryQuizQuestion['kind'][] = ['choice', 'fill', 'free']
/** 题量 field's default — a chapter quiz's one-sitting size. */
const DEFAULT_QUIZ_COUNT = 10

/** A station's 章节考 settings before the learner touches them: 都考, the coach's mix of kinds, 10 questions. */
const DEFAULT_SETTINGS: LibraryQuizSettings = { focus: 'mixed', kinds: [], countText: String(DEFAULT_QUIZ_COUNT), picked: [] }

/** How long the tab waits for an asked quiz before saying it has not landed (a 20-question paper takes minutes). */
const ASK_PATIENCE_MS = 8 * 60_000
/** The 题量 field's cap — past this a chapter quiz stops being one sitting. */
const MAX_QUIZ_COUNT = 20

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
