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
import { useState, type ReactNode } from 'react'
import { ListRow, PanelHeader } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import {
  coverKind, isThickResource, parseLocator, type LibraryAssessment, type LibraryResource, type LibraryRoadmap, type RoadmapNode,
} from '../../types.ts'
import { colorOf, Cover, coverOf } from '../look.tsx'
import { CoverChips, type CoverContext } from '../covers.tsx'
import { IconRefreshOutlineMedium, IconSparkleMedium, IconTrashOutlineMedium } from '../icons.tsx'
import { ConfirmDialog, OriginTag, outcome, StateLine, useLoad, value, when, type ViewProps } from '../ui.tsx'
import css from '../LibraryPane.module.css'
import { Path } from './path.tsx'

/** A node's contents rows of one thick resource, as titles. */
export function rowsOf(node: RoadmapNode, resource: LibraryResource): string[] {
  const toc = resource.toc ?? []
  return node.covers
    .flatMap(cover => (coverKind(cover) === 'resource' && cover.ref === resource.id && cover.locator !== undefined ? parseLocator(cover.locator) : []))
    .flatMap(range => toc.filter(row => row.n >= range.from && row.n <= range.to).map(row => row.title))
}

/** The kind line of a thick resource: a book's bookKind, else its kind label. */
export function kindLabelOf(resource: LibraryResource, t: ViewProps['p']['t']): string {
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
          { id: 'ask', label: t('action.askCoach'), icon: <IconSparkleMedium />, onSelect: () => { prime(t('prime.readBook', { book: resource.title })) } },
          { id: 'replan', label: t('book.replan'), icon: <IconRefreshOutlineMedium />, onSelect: () => { prime(t('prime.replan', { book: resource.title })) } },
          { id: 'bind', label: t('action.bindBook'), icon: <IconSparkleMedium />, menuOnly: true, onSelect: () => { void p.bindTarget({ projectId, resourceId }).then(() => { setNotice(t('notice.bound')) }) } },
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
        {resource !== undefined && isThickResource(resource) && (
          <section className={css.kindRow}>
            <span className={css.kindRowText}>
              <span>{t('book.kindLine', { kind: t(`bookKind.${resource.meta?.bookKind ?? 'knowledge'}`) })}</span>
              <span className={css.muted}>{t(`book.kindHint.${resource.meta?.bookKind ?? 'knowledge'}`)}</span>
            </span>
            <button
              type="button"
              className={css.ghost}
              disabled={busy}
              onClick={() => { void act(() => outcome(p.setBookKind(projectId, resourceId, resource.meta?.bookKind === 'material' ? 'knowledge' : 'material'))) }}
            >{t(resource.meta?.bookKind === 'material' ? 'book.kindToKnowledge' : 'book.kindToMaterial')}</button>
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
            <Path
              p={p}
              projectId={projectId}
              resource={resource}
              roadmap={loaded.data.roadmap}
              onOpen={node => { actions.push({ view: 'node', projectId, resourceId, nodeId: node.id, tab: 'guide' }) }}
              onLesson={node => { actions.push({ view: 'lesson', projectId, resourceId, nodeId: node.id }) }}
              onRetake={node => { actions.push({ view: 'node', projectId, resourceId, nodeId: node.id, tab: 'quiz' }) }}
            />
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
export function sourceMix(kinds: readonly string[], t: ViewProps['p']['t']): string {
  const counts = new Map<string, number>()
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  return [...counts].map(([kind, count]) => `${t(kind === 'photo' ? 'evidence.photo' : kind === 'web' ? 'evidence.web' : 'evidence.knowledge')} ${count}`).join(' · ')
}
