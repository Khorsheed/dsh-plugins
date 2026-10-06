/**
 * The library tab body (M2a interim): the project list with each book's
 * roadmap progress. The v2 sidebar — today, roadmaps, nodes, photos, cards,
 * quizzes and review — replaces this view in M2b.
 *
 * @module @khorsheed/dsh-library/client/LibraryPane
 */
import { useEffect, type ReactNode } from 'react'
import type { LibraryPaneProps } from './contract.ts'
import css from './LibraryPane.module.css'

/** The tab body. */
export function LibraryPane(props: LibraryPaneProps): ReactNode {
  const { useStore, actions, t } = props
  const projects = useStore(s => s.projects)
  const loading = useStore(s => s.loading)
  const error = useStore(s => s.error)

  useEffect(() => {
    let cancelled = false
    actions.setLoading(true)
    void props.listProjects().then(listed => {
      if (cancelled) return
      if (!listed.ok) { actions.setError(listed.error.message); return }
      actions.setProjects(listed.value.projects)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <div className={css.root}>
      <div className={css.body}>
        {error !== null && <div className={css.error}>{t('state.error', { reason: error })}</div>}
        {loading && projects.length === 0 && <div className={css.state}>{t('state.loading')}</div>}
        {!loading && error === null && projects.length === 0 && (
          <div className={css.state}>
            <div className={css.stateTitle}>{t('state.emptyProjectsTitle')}</div>
            <div>{t('state.emptyProjectsBody')}</div>
          </div>
        )}
        <div className={css.rows}>
          {projects.map(project => (
            <div key={project.id} className={css.card}>
              <div className={css.cardName}>{project.name}</div>
              {project.books.map(book => (
                <div key={book.id} className={css.rowSub}>
                  {book.title}
                  {book.roadmap === undefined ? '' : ` · ${book.roadmap.done}/${book.roadmap.total}`}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
