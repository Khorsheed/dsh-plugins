/**
 * The library tab body: the right-Sidebar page, one route stack (see
 * `client/store.ts`) over the v2 screens —
 *
 * - **今日** — reviews due, where each book stands, what the coach just noted,
 *   the projects;
 * - **项目** — its books (each with its own path), its cards, its reviews;
 * - **书** — the roadmap draft waiting for 采用, or the adopted S-shaped path;
 * - **这一节** — guide / the pages photographed for it / its chapter quizzes;
 * - **知识卡片** — the learner's own cards, filtered by where they came from;
 * - **章节考 → 结算** — answered here, choice and fill judged on the spot;
 * - **复习** — flashcards over the due cards.
 *
 * The conversation does what needs the model (adding a book, drafting a path,
 * composing a quiz, judging open answers): the pane binds the session and
 * drafts the ask. One layout serves every width (docs/panel-design.md):
 * `PanelRoot` declares the container, compact rules live in the stylesheet.
 *
 * @module @khorsheed/dsh-library/client/LibraryPane
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PanelRoot } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import type { LibraryEvent } from '../types.ts'
import type { LibraryPaneProps } from './contract.ts'
import { BookView, NodeView } from './views/book.tsx'
import { CardsView } from './views/cards.tsx'
import { NewProjectView, ProjectView, TodayView } from './views/home.tsx'
import { QuizView, ResultView, ReviewView } from './views/quiz.tsx'
import css from './LibraryPane.module.css'

/** The tab body. */
export function LibraryPane(props: LibraryPaneProps): ReactNode {
  const route = props.useStore(s => s.stack[s.stack.length - 1]!)
  return (
    <PanelRoot className={css.root}>
      {(() => {
        switch (route.view) {
          case 'today': return <TodayView p={props} />
          case 'newProject': return <NewProjectView p={props} />
          case 'project': return <ProjectView p={props} projectId={route.projectId} />
          case 'resource': return <BookView p={props} projectId={route.projectId} resourceId={route.resourceId} />
          case 'node': return <NodeView p={props} projectId={route.projectId} resourceId={route.resourceId} nodeId={route.nodeId} tab={route.tab} />
          case 'cards': return <CardsView p={props} projectId={route.projectId} filter={route.filter} />
          case 'quiz': return <QuizView p={props} projectId={route.projectId} resourceId={route.resourceId} quizId={route.quizId} />
          case 'result': return <ResultView p={props} projectId={route.projectId} resourceId={route.resourceId} result={route.result} />
          case 'review': return <ReviewView p={props} {...(route.projectId === undefined ? {} : { projectId: route.projectId })} />
        }
      })()}
      <RecordToast p={props} />
    </PanelRoot>
  )
}

/** How often the toast looks for new notes from this session. */
const TOAST_POLL_MS = 5000
/** How long a toast stays up. */
const TOAST_MS = 10_000

/**
 * 「已记下」: when the coach notes a weak point from THIS session, say so in
 * the sidebar with an undo — the chat line says it too, this is where the
 * undo lives. Only notes made after the pane opened are toasted.
 *
 * The same timer is the pane's change poll: the host's writes (a landed quiz,
 * a recorded page) move `latestActivity`, and a move refreshes the open view —
 * the per-tab watch windows alone lapsed after two minutes and left the tab
 * stale until a remount.
 */
function RecordToast({ p }: { p: LibraryPaneProps }): ReactNode {
  const { t, actions } = p
  const since = useRef(new Date().toISOString())
  const seen = useRef(new Set<string>())
  const activityAt = useRef<string | undefined>()
  const [record, setRecord] = useState<(LibraryEvent & { projectId: string }) | undefined>()
  const [undone, setUndone] = useState(false)

  useEffect(() => {
    const poll = (): void => {
      if (document.visibilityState !== 'visible') return
      void p.latestActivity().then(result => {
        if (!result.ok) return
        const at = result.value.at
        if (at === undefined) return
        // The first read only sets the baseline — the views just loaded fresh.
        if (activityAt.current !== undefined && at > activityAt.current) actions.refresh()
        activityAt.current = at
      }, () => {})
      void p.recentRecords().then(result => {
        if (!result.ok) return
        const fresh = result.value.records.find(entry =>
          entry.session === String(p.sessionId) && entry.at > since.current && !seen.current.has(entry.at))
        if (fresh === undefined) return
        seen.current.add(fresh.at)
        setUndone(false)
        setRecord(fresh)
        actions.refresh()
      }, () => {})
    }
    const timer = setInterval(poll, TOAST_POLL_MS)
    return () => { clearInterval(timer) }
  }, [p.sessionId])

  useEffect(() => {
    if (record === undefined) return
    const timer = setTimeout(() => { setRecord(undefined) }, undone ? 2000 : TOAST_MS)
    return () => { clearTimeout(timer) }
  }, [record, undone])

  if (record === undefined) return null
  return (
    <div className={css.toast} role="status">
      <span className={css.toastText}>{undone ? t('toast.undone') : t('toast.recorded', { terms: record.title ?? '' })}</span>
      {!undone && (
        <button
          type="button"
          className={css.toastAction}
          onClick={() => {
            void p.undoCards(record.projectId, record.ids ?? [], record.at).then(result => {
              if (result.ok && result.value.ok) {
                setUndone(true)
                actions.refresh()
              }
            })
          }}
        >{t('toast.undo')}</button>
      )}
    </div>
  )
}
