/**
 * The sidebar's top screens: 今日 (what to do now — reviews due, where each
 * book stands, what the coach just noted, the projects), the new-project
 * form, and one project's page (its books, its cards, its reviews).
 *
 * @module @khorsheed/dsh-library/client/views/home
 */
import { useState, type ReactNode } from 'react'
import { ChipRow, ListRow, PanelHeader } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { LIBRARY_COLORS, LIBRARY_ICONS, type LibraryColor, type LibraryIcon, type LibraryProjectSummary, type LibraryTemplate } from '../../types.ts'
import { colorOf, Cover, GlyphStrokes, iconOf, ProjectGlyph, Ring } from '../look.tsx'
import { IconCardsOutlineMedium, IconPlusOutlineMedium, IconRefreshOutlineMedium, IconSparkleOutlineMedium } from '../icons.tsx'
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
  const total = project.books.reduce((sum, book) => sum + (book.roadmap?.total ?? 0), 0)
  const done = project.books.reduce((sum, book) => sum + (book.roadmap?.done ?? 0), 0)
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
        <span className={css.muted}>{t('project.cardMeta', { books: String(project.books.length), cards: String(project.cardCount), due: String(project.dueCount) })}</span>
      </span>
    </button>
  )
}

/** One project: its colored header, its shelf, its cards and reviews. */
export function ProjectView({ p, projectId }: ViewProps & { projectId: string }): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const loaded = useLoad(() => outcome(p.getProject(projectId)), [projectId, rev])
  const [notice, setNotice] = useState<string | undefined>()
  const [styling, setStyling] = useState(false)
  const project = loaded.data?.project
  const books = loaded.data?.books ?? []

  const askToAddBook = (): void => {
    if (project === undefined) return
    void p.bindTarget({ projectId })
    setNotice(p.primeConversation(t('prime.addBook', { project: project.name })) ? t('notice.primed') : t('notice.noConversation'))
  }
  const restyle = (patch: { color?: LibraryColor; icon?: LibraryIcon }): void => {
    void outcome(p.updateProject(projectId, patch)).then(() => { actions.refresh() }, (failure: unknown) => { setNotice(String(failure)) })
  }

  return (
    <>
      <PanelHeader
        title=""
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        actions={[
          { id: 'add', label: t('book.add'), icon: <IconPlusOutlineMedium />, onSelect: askToAddBook },
          { id: 'cards', label: t('cards.title'), icon: <IconCardsOutlineMedium />, onSelect: () => { actions.push({ view: 'cards', projectId, filter: 'all' }) } },
          { id: 'style', label: t('project.style'), icon: <IconSparkleOutlineMedium />, menuOnly: true, onSelect: () => { setStyling(!styling) } },
          { id: 'bind', label: t('action.bindProject'), icon: <IconSparkleOutlineMedium />, menuOnly: true, onSelect: () => { void p.bindTarget({ projectId }).then(() => { setNotice(t('notice.bound')) }) } },
        ]}
        moreLabel={t('action.more')}
      />
      {project !== undefined && (
        <section className={css.band} data-color={colorOf(project)}>
          <span className={css.projectTop}>
            <ProjectGlyph icon={iconOf(project)} />
            <span className={css.projectText}>
              <span className={css.projectName}>{project.name}</span>
              <span className={css.muted}>{project.goal ?? t(`template.${project.template}`)}</span>
            </span>
            <Ring percent={progressOf(project)} />
          </span>
          <span className={css.bandStats}>
            <button type="button" className={css.bandStat} onClick={() => { actions.push({ view: 'cards', projectId, filter: 'all' }) }}><b>{project.cardCount}</b>{t('cards.title')}</button>
            <button type="button" className={css.bandStat} disabled={project.dueCount === 0} onClick={() => { actions.push({ view: 'review', projectId }) }}><b>{project.dueCount}</b>{t('review.due')}</button>
          </span>
          {styling && (
            <span className={css.picker}>
              <span className={css.swatches}>
                {LIBRARY_COLORS.map(color => (
                  <button key={color} type="button" className={css.swatch} data-color={color} aria-label={color} aria-pressed={colorOf(project) === color} onClick={() => { restyle({ color }) }} />
                ))}
              </span>
              <span className={css.swatches}>
                {LIBRARY_ICONS.map(icon => (
                  <button key={icon} type="button" className={css.iconPick} aria-label={icon} aria-pressed={iconOf(project) === icon} onClick={() => { restyle({ icon }) }}><GlyphStrokes icon={icon} /></button>
                ))}
              </span>
            </span>
          )}
        </section>
      )}
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {project !== undefined && (
          <section className={css.section} data-color={colorOf(project)}>
            <h3 className={css.sectionTitle}>{t('project.shelf', { count: String(project.books.length) })}</h3>
            <div className={css.shelf}>
              {project.books.map((row, index) => {
                const book = books.find(candidate => candidate.id === row.id)
                const percent = row.roadmap === undefined || row.roadmap.total === 0 ? 0 : Math.round((row.roadmap.done / row.roadmap.total) * 100)
                return (
                  <button key={row.id} type="button" className={css.shelfBook} title={row.title} onClick={() => { actions.push({ view: 'book', projectId, bookId: row.id }) }}>
                    <Cover book={book ?? row} shade={index} kindLabel={book === undefined ? undefined : t(`bookKind.${book.bookKind}`)} />
                    <span className={css.shelfLabel}>
                      <span className={css.shelfTitle}>{row.title}</span>
                      <span className={css.shelfMeta}>{row.hasDraft ? t('book.draftWaiting') : row.roadmap === undefined ? t('book.noRoadmap') : `${t('book.shelfMeta', { done: String(row.roadmap.done), total: String(row.roadmap.total) })} · ${percent}%`}</span>
                    </span>
                  </button>
                )
              })}
              <button type="button" className={css.shelfBook} onClick={askToAddBook}>
                <span className={css.shelfAdd}>＋</span>
                <span className={css.shelfLabel}><span className={css.shelfTitle}>{t('book.add')}</span></span>
              </button>
            </div>
          </section>
        )}
      </div>
    </>
  )
}
