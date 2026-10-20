/**
 * The sidebar's top screens: 今日 (what to do now — continue learning,
 * reviews due, the projects, what the coach just noted), the new-project
 * form, and one project's page: its goal, its textbooks in study order (each
 * with its own path — the project carries none), the drafts waiting for
 * 采用, its links. Deleting a project sits in the page's menu and asks
 * through a dialog that spells out what goes.
 *
 * @module @khorsheed/dsh-library/client/views/home
 */
import { useState, type ReactNode } from 'react'
import { ChipRow, PanelHeader } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { isThickResource, LIBRARY_COLORS, LIBRARY_ICONS, type LibraryColor, type LibraryIcon, type LibraryProjectSummary, type LibraryResourceKind, type LibraryResourceProgress, type LibraryTemplate } from '../../types.ts'
import { colorOf, GlyphStrokes, iconOf, ProjectGlyph, Ring } from '../look.tsx'
import { QuizRows } from './book.tsx'
import { IconArticleOutlineMedium, IconCardsOutlineMedium, IconCourseOutlineMedium, IconHardwareOutlineMedium, IconLinkOutlineMedium, IconPenOutlineMedium, IconPlayOutlineMedium, IconPlusOutlineMedium, IconRefreshOutlineMedium, IconRepoOutlineMedium, IconSparkleOutlineMedium, IconToolOutlineMedium, IconTrashOutlineMedium } from '../icons.tsx'
import { ConfirmDialog, OriginTag, outcome, StateLine, useLoad, value, when, type ViewProps } from '../ui.tsx'
import { MathText } from '../math.tsx'
import css from '../LibraryPane.module.css'

/** A project's textbooks (thick rows), in study order. */
function textbooksOf(project: LibraryProjectSummary): LibraryResourceProgress[] {
  return project.resources.filter(row => row.seq !== undefined || row.roadmap !== undefined || row.hasDraft || row.kind === 'book' || row.kind === 'course')
}

/** Where to continue in a project: the first textbook (study order) with a current station. */
function continueOf(project: LibraryProjectSummary): { textbook: LibraryResourceProgress; station: { id: string; title: string } } | undefined {
  for (const textbook of textbooksOf(project)) {
    if (textbook.current !== undefined) return { textbook, station: textbook.current }
  }
  return undefined
}

/** 「继续学习」: one card that jumps straight into the current station. */
function ContinueCard({ p, projectId, label, target }: ViewProps & { projectId: string; label: string; target: NonNullable<ReturnType<typeof continueOf>> }): ReactNode {
  const { t, actions } = p
  return (
    <section className={`${css.continue} ${css.projectNext}`}>
      <span className={css.projectNextText}>
        <span className={css.continueLabel}>{label}</span>
        <span className={css.continueTitle}>{target.station.title}</span>
        <span className={css.muted}>{t('continue.where', { seq: String(target.textbook.seq ?? ''), book: target.textbook.title })}</span>
      </span>
      <button type="button" className={css.primary} onClick={() => { actions.push({ view: 'node', projectId, resourceId: target.textbook.id, nodeId: target.station.id, tab: 'guide' }) }}>{t('continue.go')}</button>
    </section>
  )
}

/**
 * 今日: the projects first — each card carries its goal, its progress and
 * where to continue (the newest project's 继续 is the screen's one solid
 * button) — then the reviews due as one quiet row, then what the coach just
 * noted (math typeset, one line each).
 */
export function TodayView({ p }: ViewProps): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const projects = useLoad(() => value(p.listProjects()), [rev])
  const due = useLoad(() => value(p.dueCards()), [rev])
  const records = useLoad(() => value(p.recentRecords()), [rev])
  const changes = useLoad(() => value(p.recentChanges()), [rev])
  // 「最近的变化」: knowledge points that moved, and (language projects) the words the coach noted — newest first.
  const feed = [
    ...(changes.data?.changes ?? []).map(change => ({ kind: 'point' as const, at: change.at, change })),
    ...(records.data?.records ?? []).filter(record => record.source === 'chat').map(record => ({ kind: 'card' as const, at: record.at, record })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  const list = projects.data?.projects ?? []
  const dueCards = due.data?.cards ?? []
  // 今日复习: every project's open misses (one retake paper across its stations), then the due cards.
  const retakeRows = list.filter(project => (project.openMisses ?? 0) > 0)
  const [retaking, setRetaking] = useState<string | undefined>()
  const [retakeError, setRetakeError] = useState<string | undefined>()
  const startRetake = (projectId: string): void => {
    setRetaking(projectId)
    setRetakeError(undefined)
    void outcome(p.createRetake(projectId)).then(created => {
      actions.push({ view: 'quiz', projectId, quizId: created.assessment.id })
    }, (failure: unknown) => { setRetakeError(failure instanceof Error ? failure.message : String(failure)) }).finally(() => { setRetaking(undefined) })
  }
  // Projects come most-recent first: the first one with a current station owns the solid 继续.
  const leadId = list.find(project => continueOf(project) !== undefined)?.id

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
        {list.length > 0 && (
          <section className={css.section}>
            <div className={css.sectionHead}>
              <h3 className={css.sectionTitle}>{t('today.projects')}</h3>
              <button type="button" className={css.textButton} onClick={() => { actions.push({ view: 'newProject' }) }}>＋ {t('project.new')}</button>
            </div>
            <div className={css.projectList}>
              {list.map(project => <ProjectCard key={project.id} p={p} project={project} lead={project.id === leadId} />)}
            </div>
          </section>
        )}
        {(retakeRows.length > 0 || dueCards.length > 0) && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('today.dueTitle')}</h3>
            {retakeRows.map(project => (
              <div key={project.id} className={css.reviewRow}>
                <span className={css.big}>{project.openMisses}</span>
                <span className={css.reviewText}>
                  <span>{t('today.retakeLine', { project: project.name })}</span>
                  <span className={css.muted}>{t('today.retakeHint')}</span>
                </span>
                <button type="button" className={leadId === undefined && project === retakeRows[0] ? css.primary : css.secondary} disabled={retaking !== undefined} onClick={() => { startRetake(project.id) }}>{t('node.retakeStart')}</button>
              </div>
            ))}
            {dueCards.length > 0 && (
              <div className={css.reviewRow}>
                <span className={css.big}>{dueCards.length}</span>
                <span className={css.reviewText}>
                  <span>{t('today.cardsDue')}</span>
                  <span className={css.muted}>{t('today.dueMinutes', { minutes: String(Math.max(1, Math.round(dueCards.length / 4))) })}</span>
                </span>
                <button type="button" className={leadId === undefined && retakeRows.length === 0 ? css.primary : css.secondary} onClick={() => { actions.push({ view: 'review' }) }}>{t('today.startReview')}</button>
              </div>
            )}
            {retakeError !== undefined && <div className={css.error}>{retakeError}</div>}
          </section>
        )}
        {feed.length > 0 && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('today.changes')}</h3>
            <div className={css.recordList}>
              {feed.map(entry => entry.kind === 'point' ? (
                <button
                  key={`${entry.change.projectId}-${entry.change.at}-${entry.change.id ?? ''}`}
                  type="button"
                  className={css.record}
                  onClick={() => {
                    const { change } = entry
                    if (change.nodeId !== undefined && change.resourceId !== undefined) actions.push({ view: 'node', projectId: change.projectId, resourceId: change.resourceId, nodeId: change.nodeId, tab: 'quiz' })
                    else actions.push({ view: 'project', projectId: change.projectId })
                  }}
                >
                  <span className={css.changeDot} data-state={entry.change.to} aria-hidden="true" />
                  <span className={css.recordText}>
                    <span className={css.recordTitle}>{t(entry.change.to === 'mastered' ? 'today.changeMastered' : entry.change.to === 'weak' ? 'today.changeWeak' : entry.change.to === 'practicing' ? 'today.changePracticing' : 'today.changeUntested', { title: entry.change.title ?? '' })}</span>
                    <span className={css.muted}>
                      {[
                        ...((entry.change.count ?? 0) > 0 ? [t('today.changeOpen', { count: String(entry.change.count) })] : []),
                        ...(entry.change.detail === undefined ? [] : [entry.change.detail]),
                        entry.change.projectName,
                        when(entry.change.at, t),
                      ].join(' · ')}
                    </span>
                  </span>
                </button>
              ) : (
                <button
                  key={`${entry.record.projectId}-${entry.record.at}`}
                  type="button"
                  className={css.record}
                  onClick={() => { actions.push({ view: 'cards', projectId: entry.record.projectId, filter: 'chat' }) }}
                >
                  <span className={css.recordIcon} aria-hidden="true"><IconSparkleOutlineMedium size={14} /></span>
                  <span className={css.recordText}>
                    <span className={css.recordTitle}><MathText text={entry.record.title ?? ''} /></span>
                    <span className={css.muted}>{entry.record.projectName} · {t('source.chat')} · {when(entry.record.at, t)}</span>
                  </span>
                </button>
              ))}
            </div>
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

/** A project card on 今日: glyph, name, goal, progress — and where to continue, with its own button. */
function ProjectCard({ p, project, lead }: ViewProps & { project: LibraryProjectSummary; lead: boolean }): ReactNode {
  const { t, actions } = p
  const target = continueOf(project)
  const textbooks = textbooksOf(project)
  const drafts = textbooks.filter(row => row.hasDraft).length
  const open = (): void => { actions.push({ view: 'project', projectId: project.id }) }
  return (
    <article className={css.projectCard} data-color={colorOf(project)}>
      <button type="button" className={css.projectOpen} onClick={open}>
        <span className={css.projectTop}>
          <ProjectGlyph icon={iconOf(project)} />
          <span className={css.projectText}>
            <span className={css.projectName}>{project.name}</span>
            <span className={css.muted}>{t(`template.${project.template}`)} · {when(project.lastActiveAt, t)}</span>
          </span>
          <Ring percent={progressOf(project)} />
        </span>
        {project.goal !== undefined && <span className={css.projectGoal}>{project.goal}</span>}
        <span className={css.muted}>
          {t('project.cardMeta', { books: String(textbooks.length), cards: String(project.cardCount), due: String(project.dueCount) })}
          {drafts > 0 ? ` · ${t('project.draftsWaiting', { count: String(drafts) })}` : ''}
        </span>
      </button>
      {target !== undefined && (
        <div className={css.projectNext}>
          <span className={css.projectNextText}>
            <span className={css.continueLabel}>{t('continue.label')}</span>
            <span className={css.continueTitle}>{target.station.title}</span>
            <span className={css.muted}>{t('continue.where', { seq: String(target.textbook.seq ?? ''), book: target.textbook.title })}</span>
          </span>
          <button
            type="button"
            className={lead ? css.primary : css.secondary}
            onClick={() => { actions.push({ view: 'node', projectId: project.id, resourceId: target.textbook.id, nodeId: target.station.id, tab: 'guide' }) }}
          >{t('continue.go')}</button>
        </div>
      )}
    </article>
  )
}

/** Editing a project in place: name, goal, template, color, icon — saved together (deleting lives in the page menu). */
function ProjectEditor({ p, project, onDone }: ViewProps & { project: LibraryProjectSummary; onDone: () => void }): ReactNode {
  const { t, actions } = p
  const [name, setName] = useState(project.name)
  const [goal, setGoal] = useState(project.goal ?? '')
  const [template, setTemplate] = useState<LibraryTemplate>(project.template)
  const [color, setColor] = useState<LibraryColor>(colorOf(project))
  const [icon, setIcon] = useState<LibraryIcon>(iconOf(project))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

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
    </form>
  )
}

/** One project: its goal band, continue learning, drafts waiting, its textbooks in study order, its links. */
export function ProjectView({ p, projectId }: ViewProps & { projectId: string }): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const loaded = useLoad(() => outcome(p.getProject(projectId)), [projectId, rev])
  // Free quizzes hang on no resource and no station — this section is their only entry.
  const assessments = useLoad(() => value(p.listAssessments(projectId, undefined, undefined, 'quiz')), [projectId, rev])
  // The 错题 entry's count and target ride the shared collection (mistakes.ts) — the same rows the station's 章节考 tab lists.
  const attempts = useLoad(() => value(p.listAttempts(projectId)), [projectId, rev])
  const openMisses = loaded.data?.project.openMisses ?? 0
  const [notice, setNotice] = useState<string | undefined>()
  const [editing, setEditing] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const project = loaded.data?.project
  const resources = loaded.data?.resources ?? []
  const thick = resources.filter(isThickResource)
  const thin = resources.filter(resource => !isThickResource(resource))
  const rows = thick.map(resource => ({ resource, row: project?.resources.find(candidate => candidate.id === resource.id) }))
  const drafts = rows.filter(entry => entry.row?.hasDraft === true)
  const resume = project === undefined ? undefined : continueOf(project)
  const freeQuizzes = (assessments.data?.assessments ?? []).filter(quiz => quiz.scope.resourceId === undefined && quiz.scope.nodeId === undefined).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  // The 错题 entry jumps to wherever the newest miss lives: its station's 章节考 tab, else its textbook page.
  // The 错题 stat: every station's open misses, retaken in one paper (订正不计分).
  const openMissed = (): void => {
    if (busy) return
    setBusy(true)
    void outcome(p.createRetake(projectId)).then(created => {
      actions.push({ view: 'quiz', projectId, quizId: created.assessment.id })
    }, (failure: unknown) => { setNotice(failure instanceof Error ? failure.message : String(failure)) }).finally(() => { setBusy(false) })
  }


  const prime = (key: 'prime.addBook' | 'prime.addResource' | 'prime.pickTextbooks'): void => {
    if (project === undefined) return
    void p.bindTarget({ projectId })
    setNotice(p.primeConversation(t(key, { project: project.name })) ? t('notice.primed') : t('notice.noConversation'))
  }

  const move = async (resourceId: string, seq: number): Promise<void> => {
    setBusy(true)
    try {
      await outcome(p.moveResource(projectId, resourceId, seq))
      actions.refresh()
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await outcome(p.deleteProject(projectId))
      setDeleting(false)
      actions.refresh()
      actions.pop()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
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
        actions={ordering ? [] : [
          { id: 'add', label: t('book.add'), icon: <IconPlusOutlineMedium />, onSelect: () => { prime('prime.addBook') } },
          { id: 'addLink', label: t('resource.add'), icon: <IconLinkOutlineMedium />, onSelect: () => { prime('prime.addResource') } },
          { id: 'cards', label: t('cards.title'), icon: <IconCardsOutlineMedium />, onSelect: () => { actions.push({ view: 'cards', projectId, filter: 'all' }) } },
          { id: 'edit', label: t('project.edit'), icon: <IconPenOutlineMedium />, menuOnly: true, onSelect: () => { setEditing(true) } },
          ...(thick.length > 1 ? [{ id: 'order', label: t('project.reorder'), icon: <span aria-hidden="true">⇅</span>, menuOnly: true, onSelect: () => { setOrdering(true) } }] : []),
          { id: 'bind', label: t('action.bindProject'), icon: <IconSparkleOutlineMedium />, menuOnly: true, onSelect: () => { void p.bindTarget({ projectId }).then(() => { setNotice(t('notice.bound')) }) } },
          { id: 'delete', label: t('project.delete'), icon: <IconTrashOutlineMedium />, menuOnly: true, onSelect: () => { setError(undefined); setDeleting(true) } },
        ]}
        moreLabel={t('action.more')}
      />
      {project !== undefined && editing && (
        <ProjectEditor p={p} project={project} onDone={() => { setEditing(false) }} />
      )}
      {project !== undefined && !editing && !ordering && (
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
            <button type="button" className={css.bandStat} disabled={openMisses === 0 || busy} onClick={openMissed}><b>{openMisses}</b>{t('mistakes.stat')}</button>
          </span>
        </section>
      )}
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {ordering && (
          <>
            <div className={css.notice}>{t('project.reorderHint')}</div>
            <ol className={css.textbooks}>
              {rows.map(({ resource }, index) => (
                <li key={resource.id} className={css.textbook}>
                  <span className={css.seq}>{index + 1}</span>
                  <span className={css.textbookMain}>
                    <span className={css.textbookTitle}>{resource.title}</span>
                  </span>
                  <span className={css.order}>
                    <button type="button" aria-label={t('project.moveUp', { book: resource.title })} disabled={busy || index === 0} onClick={() => { void move(resource.id, index) }}>▲</button>
                    <button type="button" aria-label={t('project.moveDown', { book: resource.title })} disabled={busy || index === rows.length - 1} onClick={() => { void move(resource.id, index + 2) }}>▼</button>
                  </span>
                </li>
              ))}
            </ol>
            <div className={css.actions}>
              <button type="button" className={css.primary} onClick={() => { setOrdering(false) }}>{t('action.done')}</button>
            </div>
          </>
        )}
        {project !== undefined && !ordering && (
          <>
            {resume !== undefined && <ContinueCard p={p} projectId={projectId} label={t('continue.label')} target={resume} />}
            {drafts.length > 0 && (
              <div className={css.banner}>
                <span>{t('project.draftsBanner', { count: String(drafts.length) })}</span>
                <button type="button" className={css.ghost} onClick={() => { actions.push({ view: 'resource', projectId, resourceId: drafts[0]!.resource.id }) }}>
                  {t('project.draftsOpen', { seq: String(drafts[0]!.resource.seq ?? 1) })}
                </button>
              </div>
            )}
            {loaded.data !== undefined && thick.length === 0 && (
              <div className={css.empty}>
                <div className={css.emptyTitle}>{t('project.noTextbooks')}</div>
                <div className={css.muted}>{t('project.noTextbooksBody')}</div>
                <div className={css.starts}>
                  <button type="button" className={css.start} onClick={() => { prime('prime.addBook') }}><b>{t('project.startOwn')}</b><span>{t('project.startOwnHint')}</span></button>
                  <button type="button" className={css.start} onClick={() => { prime('prime.pickTextbooks') }}><b>{t('project.startPick')}</b><span>{t('project.startPickHint')}</span></button>
                </div>
              </div>
            )}
            {thick.length > 0 && (
              <section className={css.section}>
                <div className={css.sectionHead}>
                  <h3 className={css.sectionTitle}>{t('project.textbooks', { count: String(thick.length) })}</h3>
                  {thick.length > 1 && <button type="button" className={css.textButton} onClick={() => { setOrdering(true) }}>{t('project.reorder')}</button>}
                </div>
                <ol className={css.textbooks}>
                  {rows.map(({ resource, row }) => {
                    const done = row?.roadmap !== undefined && row.roadmap.total > 0 && row.roadmap.done === row.roadmap.total
                    const state = done ? 'done' : row?.current !== undefined ? 'current' : undefined
                    const percent = row?.roadmap === undefined || row.roadmap.total === 0 ? 0 : Math.round((row.roadmap.done / row.roadmap.total) * 100)
                    return (
                      <li key={resource.id} className={css.textbook}>
                        <span className={css.seq} data-state={state}>{resource.seq ?? '·'}</span>
                        <button type="button" className={css.textbookMain} onClick={() => { actions.push({ view: 'resource', projectId, resourceId: resource.id }) }}>
                          <span className={css.textbookTitle}>{resource.title}<OriginTag origin={resource.origin} digital={resource.kind === 'course'} t={t} /></span>
                          {row?.roadmap !== undefined && <span className={css.bar} aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>}
                          <span className={css.textbookMeta}>
                            {row?.roadmap !== undefined
                              ? `${row.roadmap.done}/${row.roadmap.total}${done ? ` · ${t('book.finished')}` : row.current !== undefined ? ` · ${t('project.currentStation', { station: row.current.title })}` : ''}`
                              : row?.hasDraft === true ? t('project.draftRow', { count: String(row.draftTotal ?? 0) }) : t('book.noRoadmap')}
                            {row?.roadmap !== undefined && row.hasDraft ? ` · ${t('book.draftWaiting')}` : ''}
                          </span>
                        </button>
                        <span />
                      </li>
                    )
                  })}
                </ol>
              </section>
            )}
            {freeQuizzes.length > 0 && (
              <section className={css.section}>
                <h3 className={css.sectionTitle}>{t('project.quizzes', { count: String(freeQuizzes.length) })}</h3>
                <QuizRows p={p} projectId={projectId} quizzes={freeQuizzes} />
              </section>
            )}
            <section className={css.section}>
              <div className={css.sectionHead}>
                <h3 className={css.sectionTitle}>{t('resource.title', { count: String(thin.length) })}</h3>
                <button type="button" className={css.textButton} onClick={() => { prime('prime.addResource') }}>＋ {t('resource.add')}</button>
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
          </>
        )}
      </div>
      {deleting && project !== undefined && (
        <ConfirmDialog
          title={t('project.deleteTitle', { project: project.name })}
          lines={[
            t('project.deleteTextbooks', { count: String(thick.length) }),
            t('project.deleteCards', { count: String(project.cardCount), due: String(project.dueCount) }),
            t('project.deleteAttempts', { count: String(attempts.data?.attempts.length ?? 0) }),
            ...(thin.length > 0 ? [t('project.deleteLinks', { count: String(thin.length) })] : []),
          ]}
          note={t('project.deleteNote')}
          confirmLabel={t('project.deleteConfirmButton')}
          cancelLabel={t('action.cancel')}
          busy={busy}
          error={error}
          onConfirm={() => { void remove() }}
          onCancel={() => { setDeleting(false) }}
        />
      )}
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
