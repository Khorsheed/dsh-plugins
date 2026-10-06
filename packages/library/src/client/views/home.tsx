/**
 * The sidebar's top screens: 今日 (what to do now — reviews due, where each
 * book stands, what the coach just noted, the projects), the new-project
 * form, and one project's page (its books, its cards, its reviews).
 *
 * @module @khorsheed/dsh-library/client/views/home
 */
import { useState, type ReactNode } from 'react'
import { ChipRow, ListRow, PanelHeader } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import type { LibraryTemplate } from '../../types.ts'
import { IconBookOutlineMedium, IconCardsOutlineMedium, IconPlusOutlineMedium, IconRefreshOutlineMedium, IconSparkleOutlineMedium } from '../icons.tsx'
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
  const reading = list.flatMap(project => project.books
    .filter(book => book.current !== undefined || book.hasDraft)
    .map(book => ({ project, book })))

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
        {reading.length > 0 && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('today.reading')}</h3>
            {reading.map(({ project, book }) => (
              <ListRow
                key={book.id}
                icon={<IconBookOutlineMedium />}
                title={book.title}
                meta={book.hasDraft
                  ? t('book.draftWaiting')
                  : t('today.readingMeta', { project: project.name, node: book.current?.title ?? '' })}
                onSelect={() => { actions.push({ view: 'book', projectId: project.id, bookId: book.id }) }}
              />
            ))}
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
        {list.length > 0 && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('today.projects')}</h3>
            {list.map(project => (
              <ListRow
                key={project.id}
                title={project.name}
                meta={t('project.meta', {
                  template: t(`template.${project.template}`),
                  books: String(project.books.length),
                  cards: String(project.cardCount),
                })}
                trailing={project.dueCount > 0 ? <span className={css.badge}>{project.dueCount}</span> : undefined}
                onSelect={() => { actions.push({ view: 'project', projectId: project.id }) }}
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

/** One project: its books, cards and reviews. */
export function ProjectView({ p, projectId }: ViewProps & { projectId: string }): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const loaded = useLoad(() => outcome(p.getProject(projectId)), [projectId, rev])
  const [notice, setNotice] = useState<string | undefined>()
  const project = loaded.data?.project

  const askToAddBook = (): void => {
    if (project === undefined) return
    void p.bindTarget({ projectId })
    setNotice(p.primeConversation(t('prime.addBook', { project: project.name })) ? t('notice.primed') : t('notice.noConversation'))
  }

  return (
    <>
      <PanelHeader
        title={project?.name ?? ''}
        meta={project === undefined ? undefined : t(`template.${project.template}`)}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        actions={[
          { id: 'add', label: t('book.add'), icon: <IconPlusOutlineMedium />, onSelect: askToAddBook },
          { id: 'cards', label: t('cards.title'), icon: <IconCardsOutlineMedium />, onSelect: () => { actions.push({ view: 'cards', projectId, filter: 'all' }) } },
          { id: 'bind', label: t('action.bindProject'), icon: <IconSparkleOutlineMedium />, menuOnly: true, onSelect: () => { void p.bindTarget({ projectId }).then(() => { setNotice(t('notice.bound')) }) } },
        ]}
        moreLabel={t('action.more')}
      />
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {project !== undefined && (
          <>
            <div className={css.stats}>
              <button type="button" className={css.stat} onClick={() => { actions.push({ view: 'cards', projectId, filter: 'all' }) }}>
                <span className={css.statValue}>{project.cardCount}</span>
                <span className={css.muted}>{t('cards.title')}</span>
              </button>
              <button type="button" className={css.stat} disabled={project.dueCount === 0} onClick={() => { actions.push({ view: 'review', projectId }) }}>
                <span className={css.statValue}>{project.dueCount}</span>
                <span className={css.muted}>{t('review.due')}</span>
              </button>
            </div>
            {project.goal !== undefined && <div className={css.muted}>{t('project.goalLine', { goal: project.goal })}</div>}
            <section className={css.section}>
              <h3 className={css.sectionTitle}>{t('project.books', { count: String(project.books.length) })}</h3>
              {project.books.length === 0 && (
                <div className={css.empty}>
                  <div className={css.muted}>{t('project.noBooks')}</div>
                  <button type="button" className={css.primary} onClick={askToAddBook}>{t('book.add')}</button>
                </div>
              )}
              {project.books.map(book => {
                const meta = book.hasDraft
                  ? t('book.draftWaiting')
                  : book.roadmap === undefined
                    ? t('book.noRoadmap')
                    : t('book.progressMeta', {
                      done: String(book.roadmap.done),
                      total: String(book.roadmap.total),
                      next: book.current?.title ?? t('book.finished'),
                    })
                return (
                  <ListRow
                    key={book.id}
                    icon={<IconBookOutlineMedium />}
                    title={book.title}
                    meta={meta}
                    trailing={book.roadmap === undefined ? undefined : (
                      <span className={css.miniBar} aria-hidden="true">
                        <i style={{ width: `${book.roadmap.total === 0 ? 0 : Math.round((book.roadmap.done / book.roadmap.total) * 100)}%` }} />
                      </span>
                    )}
                    onSelect={() => { actions.push({ view: 'book', projectId, bookId: book.id }) }}
                  />
                )
              })}
            </section>
          </>
        )}
      </div>
    </>
  )
}
