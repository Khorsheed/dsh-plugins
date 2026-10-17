/**
 * The sidebar's top screens: 今日 (what to do now — reviews due, where each
 * book stands, what the coach just noted, the projects), the new-project
 * form, and one project's page (its books, its cards, its reviews).
 *
 * @module @khorsheed/dsh-library/client/views/home
 */
import { useState, type ReactNode } from 'react'
import { ChipRow, ListRow, PanelHeader } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { isThickResource, LIBRARY_COLORS, LIBRARY_ICONS, type LibraryAssessment, type LibraryColor, type LibraryIcon, type LibraryProjectSummary, type LibraryQuizQuestion, type LibraryResource, type LibraryResourceKind, type LibraryRoadmap, type LibraryTemplate } from '../../types.ts'
import { colorOf, coverOf, Cover, GlyphStrokes, iconOf, ProjectGlyph, Ring } from '../look.tsx'
import { MathText } from '../math.tsx'
import { summarizeCovers, type CoverContext } from '../covers.tsx'
import { DraftCard, QuizRows } from './book.tsx'
import { IconArticleOutlineMedium, IconCardsOutlineMedium, IconCheckOutlineMedium, IconCourseOutlineMedium, IconHardwareOutlineMedium, IconLinkOutlineMedium, IconLockOutlineMedium, IconPenOutlineMedium, IconPlayOutlineMedium, IconPlusOutlineMedium, IconRefreshOutlineMedium, IconRepoOutlineMedium, IconSparkleOutlineMedium, IconToolOutlineMedium } from '../icons.tsx'
import { outcome, StateLine, useLoad, value, when, type ViewProps } from '../ui.tsx'
import css from '../LibraryPane.module.css'

/** 今日. */
export function TodayView({ p }: ViewProps): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const projects = useLoad(() => value(p.listProjects()), [rev])
  const due = useLoad(() => value(p.dueCards()), [rev])
  const records = useLoad(() => value(p.recentRecords()), [rev])
  const list = projects.data?.projects ?? []
  const dueCards = due.data?.cards ?? []

  return (
    <>
      <PanelHeader
        title={t('today.title')}
        actions={[
          { id: 'new', label: t('project.new'), icon: <IconPlusOutlineMedium />, onSelect: () => { actions.push({ view: 'newProject' }) } },
          { id: 'refresh', label: t('action.refresh'), icon: <IconRefreshOutlineMedium />, onSelect: () => { actions.refresh() } },
        ]}
        moreLabel={t('action.more')}
      />
      <div className={css.body}>
        <StateLine loaded={projects} t={t} />
        {projects.data !== undefined && list.length === 0 && (
          <div className={css.empty}>
            <div className={css.emptyTitle}>{t('today.emptyTitle')}</div>
            <div className={css.muted}>{t('today.emptyBody')}</div>
            <button type="button" className={css.primary} onClick={() => { actions.push({ view: 'newProject' }) }}>{t('project.new')}</button>
          </div>
        )}
        {dueCards.length > 0 && (
          <section className={css.hero}>
            <div className={css.heroText}>
              <span className={css.big}>{dueCards.length}</span>
              <span className={css.muted}>{t('today.dueLine', { minutes: String(Math.max(1, Math.round(dueCards.length / 4))) })}</span>
            </div>
            <button type="button" className={css.primary} onClick={() => { actions.push({ view: 'review' }) }}>{t('today.startReview')}</button>
          </section>
        )}
        {list.length > 0 && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('today.projects')}</h3>
            <div className={css.projectGrid}>
              {list.map(project => <ProjectCard key={project.id} p={p} project={project} />)}
              <button type="button" className={css.projectAdd} onClick={() => { actions.push({ view: 'newProject' }) }}>＋ {t('project.new')}</button>
            </div>
          </section>
        )}
        {(records.data?.records.length ?? 0) > 0 && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('today.recorded')}</h3>
            {records.data!.records.map(record => (
              <ListRow
                key={`${record.projectId}-${record.at}`}
                icon={<IconSparkleOutlineMedium />}
                title={record.title ?? ''}
                meta={`${record.projectName} · ${t(record.source === 'quiz' ? 'source.quiz' : 'source.chat')} · ${when(record.at, t)}`}
                onSelect={() => { actions.push({ view: 'cards', projectId: record.projectId, filter: record.source === 'quiz' ? 'quiz' : 'chat' }) }}
              />
            ))}
          </section>
        )}
      </div>
    </>
  )
}

const TEMPLATES: readonly LibraryTemplate[] = ['language', 'subject', 'custom']

/** 新建项目. */
export function NewProjectView({ p }: ViewProps): ReactNode {
  const { t, actions } = p
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<LibraryTemplate>('subject')
  const [goal, setGoal] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const created = await outcome(p.createProject({ name, template, ...(goal.trim() === '' ? {} : { goal }) }))
      actions.replace({ view: 'project', projectId: created.project.id })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PanelHeader title={t('project.new')} onBack={() => { actions.pop() }} backLabel={t('action.back')} moreLabel={t('action.more')} />
      <form className={css.body} onSubmit={event => { event.preventDefault(); void submit() }}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('project.name')}</span>
          <input className={css.input} value={name} placeholder={t('project.namePlaceholder')} onChange={event => { setName(event.target.value) }} />
        </label>
        <div className={css.field}>
          <span className={css.fieldLabel}>{t('project.template')}</span>
          <ChipRow
            label={t('project.template')}
            chips={TEMPLATES.map(id => ({ id, label: t(`template.${id}`) }))}
            value={template}
            onSelect={setTemplate}
          />
          <span className={css.muted}>{t(`template.${template}.hint`)}</span>
        </div>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('project.goal')}</span>
          <input className={css.input} value={goal} placeholder={t('project.goalPlaceholder')} onChange={event => { setGoal(event.target.value) }} />
        </label>
        {error !== undefined && <div className={css.error}>{error}</div>}
        <div className={css.actions}>
          <button type="submit" className={css.primary} disabled={busy || name.trim() === ''}>{t('project.create')}</button>
        </div>
      </form>
    </>
  )
}

/** Overall progress of a project: done nodes over all nodes of its adopted paths. */
function progressOf(project: LibraryProjectSummary): number {
  const total = project.resources.reduce((sum, resource) => sum + (resource.roadmap?.total ?? 0), 0)
  const done = project.resources.reduce((sum, resource) => sum + (resource.roadmap?.done ?? 0), 0)
  return total === 0 ? 0 : Math.round((done / total) * 100)
}

/** A project card on 今日: its glyph, name, goal, progress, counts, when it was last used. */
function ProjectCard({ p, project }: ViewProps & { project: LibraryProjectSummary }): ReactNode {
  const { t, actions } = p
  return (
    <button type="button" className={css.projectCard} data-color={colorOf(project)} onClick={() => { actions.push({ view: 'project', projectId: project.id }) }}>
      <span className={css.projectTop}>
        <ProjectGlyph icon={iconOf(project)} />
        <span className={css.projectText}>
          <span className={css.projectName}>{project.name}</span>
          <span className={css.muted}>{t(`template.${project.template}`)} · {when(project.lastActiveAt, t)}</span>
        </span>
        <Ring percent={progressOf(project)} />
      </span>
      {project.goal !== undefined && <span className={css.projectGoal}>{project.goal}</span>}
      <span className={css.projectFoot}>
        <span className={css.muted}>{t('project.cardMeta', { books: String(project.resources.filter(row => row.kind === 'book' || row.kind === 'course').length), cards: String(project.cardCount), due: String(project.dueCount) })}</span>
      </span>
    </button>
  )
}

/** Editing a project in place: name, goal, template, color, icon — saved together. */
function ProjectEditor({ p, project, onDone }: ViewProps & { project: LibraryProjectSummary; onDone: () => void }): ReactNode {
  const { t, actions } = p
  const [name, setName] = useState(project.name)
  const [goal, setGoal] = useState(project.goal ?? '')
  const [template, setTemplate] = useState<LibraryTemplate>(project.template)
  const [color, setColor] = useState<LibraryColor>(colorOf(project))
  const [icon, setIcon] = useState<LibraryIcon>(iconOf(project))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [deleting, setDeleting] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await outcome(p.updateProject(project.id, { name: name.trim(), goal: goal.trim(), template, color, icon }))
      actions.refresh()
      onDone()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await outcome(p.deleteProject(project.id))
      actions.refresh()
      onDone()
      actions.pop()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  return (
    <form className={css.editor} data-color={color} onSubmit={event => { event.preventDefault(); void save() }}>
      <span className={css.projectTop}>
        <ProjectGlyph icon={icon} />
        <span className={css.projectText}><span className={css.projectName}>{t('project.edit')}</span></span>
      </span>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('project.name')}</span>
        <input className={css.input} value={name} onChange={event => { setName(event.target.value) }} />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('project.goal')}</span>
        <textarea className={css.input} rows={2} value={goal} onChange={event => { setGoal(event.target.value) }} />
      </label>
      <div className={css.field}>
        <span className={css.fieldLabel}>{t('project.template')}</span>
        <ChipRow label={t('project.template')} chips={TEMPLATES.map(id => ({ id, label: t(`template.${id}`) }))} value={template} onSelect={setTemplate} />
        {template !== project.template && <span className={css.muted}>{t('project.templateChange')}</span>}
      </div>
      <div className={css.field}>
        <span className={css.fieldLabel}>{t('project.style')}</span>
        <span className={css.swatches}>
          {LIBRARY_COLORS.map(entry => (
            <button key={entry} type="button" className={css.swatch} data-color={entry} aria-label={entry} aria-pressed={color === entry} onClick={() => { setColor(entry) }} />
          ))}
        </span>
        <span className={css.swatches}>
          {LIBRARY_ICONS.map(entry => (
            <button key={entry} type="button" className={css.iconPick} aria-label={entry} aria-pressed={icon === entry} onClick={() => { setIcon(entry) }}><GlyphStrokes icon={entry} /></button>
          ))}
        </span>
      </div>
      {error !== undefined && <div className={css.error}>{error}</div>}
      <div className={css.actions}>
        <button type="button" className={css.secondary} onClick={onDone}>{t('action.cancel')}</button>
        <button type="submit" className={css.primary} disabled={busy || name.trim() === ''}>{t('action.save')}</button>
      </div>
      <div className={css.dangerZone}>
        {deleting ? (
          <>
            <span className={css.muted}>{t('project.deleteConfirm')}</span>
            <button type="button" className={css.danger} disabled={busy} onClick={() => { void remove() }}>{t('action.confirmDelete')}</button>
            <button type="button" className={css.ghost} onClick={() => { setDeleting(false) }}>{t('action.cancel')}</button>
          </>
        ) : (
          <button type="button" className={css.textButton} onClick={() => { setDeleting(true) }}>{t('project.delete')}</button>
        )}
      </div>
    </form>
  )
}

/** One project: its colored header, its path card, its shelf (thick covers and thin links). */
export function ProjectView({ p, projectId }: ViewProps & { projectId: string }): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const loaded = useLoad(() => outcome(p.getProject(projectId)), [projectId, rev])
  const path = useLoad(() => value(p.getRoadmap(projectId)), [projectId, rev])
  // Free quizzes hang on no resource and no station — this section is their only entry.
  const assessments = useLoad(() => value(p.listAssessments(projectId, undefined, undefined, 'quiz')), [projectId, rev])
  const [notice, setNotice] = useState<string | undefined>()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const project = loaded.data?.project
  const resources = loaded.data?.resources ?? []
  const thick = resources.filter(isThickResource)
  const thin = resources.filter(resource => !isThickResource(resource))
  const freeQuizzes = (assessments.data?.assessments ?? []).filter(quiz => quiz.scope.resourceId === undefined && quiz.scope.nodeId === undefined).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const coverContext: CoverContext = { resources }

  const askToAddBook = (): void => {
    if (project === undefined) return
    void p.bindTarget({ projectId })
    setNotice(p.primeConversation(t('prime.addBook', { project: project.name })) ? t('notice.primed') : t('notice.noConversation'))
  }

  const askToAddResource = (): void => {
    if (project === undefined) return
    void p.bindTarget({ projectId })
    setNotice(p.primeConversation(t('prime.addResource', { project: project.name })) ? t('notice.primed') : t('notice.noConversation'))
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

  return (
    <>
      <PanelHeader
        title={project?.name ?? ''}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        actions={[
          { id: 'add', label: t('book.add'), icon: <IconPlusOutlineMedium />, onSelect: askToAddBook },
          { id: 'addLink', label: t('resource.add'), icon: <IconLinkOutlineMedium />, onSelect: askToAddResource },
          { id: 'cards', label: t('cards.title'), icon: <IconCardsOutlineMedium />, onSelect: () => { actions.push({ view: 'cards', projectId, filter: 'all' }) } },
          { id: 'edit', label: t('project.edit'), icon: <IconPenOutlineMedium />, menuOnly: true, onSelect: () => { setEditing(true) } },
          { id: 'bind', label: t('action.bindProject'), icon: <IconSparkleOutlineMedium />, menuOnly: true, onSelect: () => { void p.bindTarget({ projectId }).then(() => { setNotice(t('notice.bound')) }) } },
        ]}
        moreLabel={t('action.more')}
      />
      {project !== undefined && editing && (
        <ProjectEditor p={p} project={project} onDone={() => { setEditing(false) }} />
      )}
      {project !== undefined && !editing && (
        <section className={css.band} data-color={colorOf(project)}>
          <span className={css.projectTop}>
            <ProjectGlyph icon={iconOf(project)} />
            <span className={css.projectText}>
              {project.goal !== undefined && <span className={css.bandGoal}>{project.goal}</span>}
              <span className={css.muted}>{t(`template.${project.template}`)} · {when(project.lastActiveAt, t)}</span>
            </span>
            <Ring percent={progressOf(project)} />
          </span>
          <span className={css.bandStats}>
            <button type="button" className={css.bandStat} onClick={() => { actions.push({ view: 'cards', projectId, filter: 'all' }) }}><b>{project.cardCount}</b>{t('cards.title')}</button>
            <button type="button" className={css.bandStat} disabled={project.dueCount === 0} onClick={() => { actions.push({ view: 'review', projectId }) }}><b>{project.dueCount}</b>{t('review.due')}</button>
          </span>
        </section>
      )}
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {project !== undefined && path.data?.draft !== undefined && (
          <DraftCard
            p={p}
            draft={path.data.draft}
            context={coverContext}
            replaces={path.data.roadmap !== undefined}
            busy={busy}
            onAdopt={() => { void act(() => outcome(p.adoptRoadmap(projectId))) }}
            onDiscard={() => { void act(() => outcome(p.discardDraft(projectId))) }}
          />
        )}
        {project !== undefined && path.data?.roadmap !== undefined && (
          <PathCard p={p} projectId={projectId} roadmap={path.data.roadmap} context={coverContext} />
        )}
        {project !== undefined && freeQuizzes.length > 0 && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('project.quizzes', { count: String(freeQuizzes.length) })}</h3>
            <QuizRows p={p} projectId={projectId} quizzes={freeQuizzes} />
          </section>
        )}
        {project !== undefined && <MistakesSection p={p} projectId={projectId} resources={resources} />}
        {project !== undefined && (
          <section className={css.section} data-color={colorOf(project)}>
            <h3 className={css.sectionTitle}>{t('project.shelf', { count: String(thick.length) })}</h3>
            <div className={css.shelf}>
              {thick.map((resource, index) => {
                const row = project.resources.find(candidate => candidate.id === resource.id)
                const percent = row?.roadmap === undefined || row.roadmap.total === 0 ? 0 : Math.round((row.roadmap.done / row.roadmap.total) * 100)
                return (
                  <button key={resource.id} type="button" className={css.shelfBook} title={resource.title} onClick={() => { actions.push({ view: 'resource', projectId, resourceId: resource.id }) }}>
                    <Cover book={coverOf(resource)} shade={index} kindLabel={resource.kind === 'book' ? t(`bookKind.${resource.meta?.bookKind ?? 'knowledge'}`) : t(`resource.kind.${resource.kind}`)} />
                    <span className={css.shelfLabel}>
                      <span className={css.shelfTitle}>{resource.title}</span>
                      <span className={css.shelfMeta}>{row?.hasDraft === true ? t('book.draftWaiting') : row?.roadmap === undefined ? t('book.noRoadmap') : `${t('book.shelfMeta', { done: String(row.roadmap.done), total: String(row.roadmap.total) })} · ${percent}%`}</span>
                    </span>
                  </button>
                )
              })}
              <button type="button" className={css.shelfBook} aria-label={t('book.add')} title={t('book.add')} onClick={askToAddBook}>
                <span className={css.shelfAdd}>＋</span>
              </button>
            </div>
          </section>
        )}
        {project !== undefined && (
          <section className={css.section}>
            <div className={css.sectionHead}>
              <h3 className={css.sectionTitle}>{t('resource.title', { count: String(thin.length) })}</h3>
              <button type="button" className={css.textButton} onClick={askToAddResource}>＋ {t('resource.add')}</button>
            </div>
            {loaded.data !== undefined && thin.length === 0 && (
              <span className={css.muted}>{t('resource.empty')}</span>
            )}
            {thin.length > 0 && (
              <div className={css.resList}>
                {thin.map(resource => (
                  <div key={resource.id} className={css.res}>
                    <span className={css.resKind} title={t(`resource.kind.${resource.kind}`)}>{resourceKindIcon(resource.kind)}</span>
                    <div className={css.resMain}>
                      <button type="button" className={css.resTitle} title={resource.url} onClick={() => { if (resource.url !== undefined) window.open(resource.url, '_blank', 'noopener,noreferrer') }}>{resource.title}</button>
                      {resource.note !== undefined && <span className={css.resNote}>{resource.note}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </>
  )
}

/** A resource row's kind tile glyph (article is the default). */
function resourceKindIcon(kind: LibraryResourceKind): ReactNode {
  switch (kind) {
    case 'video': return <IconPlayOutlineMedium size={13} />
    case 'repo': return <IconRepoOutlineMedium size={13} />
    case 'tool': return <IconToolOutlineMedium size={13} />
    case 'course': return <IconCourseOutlineMedium size={13} />
    case 'hardware': return <IconHardwareOutlineMedium size={13} />
    default: return <IconArticleOutlineMedium size={13} />
  }
}

/**
 * 错题本: every missed question across the project's papers (each paper's
 * latest sitting), newest first, with a one-tap 「围绕错题出一套」 for the
 * coach. The station-level list lives on the station's 章节考 tab; this is
 * the cross-station shelf.
 */
function MistakesSection({ p, projectId, resources }: ViewProps & { projectId: string; resources: readonly LibraryResource[] }): ReactNode {
  const { t, useStore } = p
  const rev = useStore(s => s.rev)
  const attempts = useLoad(() => value(p.listAttempts(projectId)), [projectId, rev])
  const assessments = useLoad(() => value(p.listAssessments(projectId, undefined, undefined, 'quiz')), [projectId, rev])
  const [notice, setNotice] = useState<string | undefined>()
  const missed: { key: string; quiz: LibraryAssessment; question: LibraryQuizQuestion; at: string }[] = []
  {
    const byAssessment = new Map((assessments.data?.assessments ?? []).map(assessment => [assessment.id, assessment]))
    const seenQuizzes = new Set<string>()
    const seenQuestions = new Set<string>()
    for (const attempt of attempts.data?.attempts ?? []) {
      const quiz = byAssessment.get(attempt.assessmentId ?? '')
      if (quiz === undefined || seenQuizzes.has(quiz.id)) continue
      seenQuizzes.add(quiz.id)
      for (const verdict of attempt.verdicts) {
        if (verdict.pass || verdict.void === true) continue
        const question = quiz.questions?.find(candidate => candidate.id === verdict.task)
        if (question === undefined) continue
        const key = `${quiz.id}:${question.id}`
        if (seenQuestions.has(key)) continue
        seenQuestions.add(key)
        missed.push({ key, quiz, question, at: attempt.at })
      }
    }
  }
  if (assessments.data === undefined || missed.length === 0) return null
  const resourceTitle = (quiz: LibraryAssessment): string | undefined =>
    quiz.scope.resourceId === undefined ? undefined : resources.find(candidate => candidate.id === quiz.scope.resourceId)?.title
  return (
    <section className={css.section}>
      <h3 className={css.sectionTitle}>{t('mistakes.title', { count: String(missed.length) })}</h3>
      {missed.map(row => (
        <div key={row.key} className={css.missRow}>
          <span className={css.missMark} aria-hidden="true">✕</span>
          <div className={css.missText}>
            <span>{row.question.prompt}</span>
            <span className={css.muted}>
              <MathText text={t('node.missedAnswer', { answer: row.question.options !== undefined && row.question.options.indexOf(row.question.answer) >= 0 ? `${String.fromCharCode(65 + row.question.options.indexOf(row.question.answer))}. ${row.question.answer}` : row.question.answer })} />
              {' · '}{when(row.at, t)}{resourceTitle(row.quiz) === undefined ? '' : ` · ${resourceTitle(row.quiz)}`}
            </span>
          </div>
        </div>
      ))}
      <div className={css.actions}>
        <button
          type="button"
          className={css.secondary}
          onClick={() => {
            const list = missed.map(row => `- ${row.question.prompt}`).join('\n')
            setNotice(p.primeConversation(t('prime.quiz.missedAll', { list })) ? t('notice.primed') : t('notice.noConversation'))
          }}
        >{t('mistakes.cta')}</button>
      </div>
      {notice !== undefined && <div className={css.notice}>{notice}</div>}
    </section>
  )
}

/** The adopted project path: progress plus every station, compact; a station opens its node page. */
function PathCard({ p, projectId, roadmap, context }: ViewProps & { projectId: string; roadmap: LibraryRoadmap; context: CoverContext }): ReactNode {
  const { t, actions } = p
  const done = roadmap.nodes.filter(node => node.state === 'done').length
  return (
    <section className={css.section}>
      <h3 className={css.sectionTitle}>{t('path.title', { done: String(done), total: String(roadmap.nodes.length) })}</h3>
      {roadmap.note !== undefined && <div className={css.muted}>{roadmap.note}</div>}
      <ol className={css.stations}>
        {roadmap.nodes.map(node => (
          <li key={node.id}>
            <button type="button" className={css.station} data-state={node.state} onClick={() => { actions.push({ view: 'node', projectId, nodeId: node.id, tab: 'guide' }) }}>
              <span className={css.stationDot} data-state={node.state} aria-hidden="true">
                {node.state === 'done' ? <IconCheckOutlineMedium size={10} /> : node.state === 'locked' ? <IconLockOutlineMedium size={10} /> : null}
              </span>
              <span className={css.stationText}>
                <span className={css.stationTitle}>
                  <span className={css.kind} data-kind={node.gate}>{t(`nodeKind.${node.gate}`)}</span>
                  {node.title}
                  {node.state === 'done' && node.quizStats?.bestRatio !== undefined && <span className={css.best}>{Math.round(node.quizStats.bestRatio * 100)}%</span>}
                </span>
                <span className={css.muted}>{summarizeCovers(node.covers, context, t)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
