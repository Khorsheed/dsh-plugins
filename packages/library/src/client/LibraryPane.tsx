/**
 * The library tab body: the right-Sidebar page, one route stack (see
 * `client/store.ts`) over the v2 screens —
 *
 * - **今日** — reviews due, where each book stands, what the coach just noted,
 *   the projects;
 * - **项目** — its textbooks in study order (each with its own path — the
 *   project carries none), drafts waiting, its cards, its reviews;
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
import { interactionHandlers, subscribeWrites } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'
import type { LibraryEvent } from '../types.ts'
import { RECORD_KIND, type LibraryNavParams } from '../nav-line.ts'
import { LIBRARY_KIND } from './definition.tsx'
import type { LibraryPaneProps } from './contract.ts'
import { BookView } from './views/book.tsx'
import { NodeView } from './views/station.tsx'
import { CardsView } from './views/cards.tsx'
import { NewProjectView, ProjectView, TodayView } from './views/home.tsx'
import { QuizView, ResultView, ReviewView } from './views/quiz.tsx'
import { LessonView } from './views/lesson.tsx'
import css from './LibraryPane.module.css'

/** The tab body. */
export function LibraryPane(props: LibraryPaneProps): ReactNode {
  const route = props.useStore(s => s.stack[s.stack.length - 1]!)
  const { actions } = props
  // The tab's navigation (`sidebarRight.openTab('library', { params })` — a
  // destination the learner watched land, a card's door, a room's desk row):
  // applied once per navigation revision, on mount when it opened this tab,
  // at once when the tab was already open, and again for a repeat of the
  // same place.
  const navigation = (props as { useTabInfo?: () => { tab?: { navigation?: { params?: unknown; revision?: number } } } }).useTabInfo?.().tab?.navigation
  const navRevision = navigation?.revision ?? 0
  const navParams = navigation?.params as LibraryNavParams | undefined
  const appliedNav = useRef(0)
  useEffect(() => {
    if (navRevision === 0 || appliedNav.current === navRevision) return
    appliedNav.current = navRevision
    if (typeof navParams?.view === 'string') actions.land(navParams)
  }, [navRevision, navParams, actions])
  return (
    <PanelRoot className={css.root} {...interactionHandlers}>
      {(() => {
        switch (route.view) {
          case 'today': return <TodayView p={props} />
          case 'newProject': return <NewProjectView p={props} />
          case 'project': return <ProjectView p={props} projectId={route.projectId} />
          case 'resource': return <BookView p={props} projectId={route.projectId} resourceId={route.resourceId} />
          case 'node': return <NodeView p={props} projectId={route.projectId} resourceId={route.resourceId} nodeId={route.nodeId} tab={route.tab} />
          case 'lesson': return <LessonView p={props} projectId={route.projectId} resourceId={route.resourceId} nodeId={route.nodeId} />
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

/**
 * The slow fallback re-read while the pane is in view. A library write in the
 * conversation re-reads at once (the follower's write signal); this only
 * catches what the session on screen does not show (another tab or device, a
 * room member's own session, a host restart).
 */
const FALLBACK_MS = 30_000
/** How long a toast stays up. */
const TOAST_MS = 10_000

/**
 * 「已记下」: when the coach notes a weak point from THIS session, say so in
 * the sidebar with an undo — the chat line says it too, this is where the
 * undo lives. Only notes made after the pane opened are toasted.
 *
 * The same component is the pane's freshness: a library write in the
 * conversation (the follower's write signal) re-reads the open view at once,
 * a noted weak point (the record kind) also looks for the note to toast, and
 * a slow re-read while the pane is in view catches the rest.
 */
function RecordToast({ p }: { p: LibraryPaneProps }): ReactNode {
  const { t, actions } = p
  const since = useRef(new Date().toISOString())
  const seen = useRef(new Set<string>())
  const [record, setRecord] = useState<(LibraryEvent & { projectId: string }) | undefined>()
  const [undone, setUndone] = useState(false)

  useEffect(() => {
    const lookForNotes = (): void => {
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
    const stopWrites = subscribeWrites(LIBRARY_KIND, () => { actions.refresh() })
    const stopNotes = subscribeWrites(RECORD_KIND, () => { actions.refresh(); lookForNotes() })
    // The fallback re-reads only when the newest change moved, so the open
    // view does not flash a reload every half minute.
    let newest: string | undefined
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void p.recentChanges().then(result => {
        if (!result.ok) return
        const at = result.value.changes[0]?.at
        if (newest !== undefined && at !== undefined && at > newest) actions.refresh()
        if (at !== undefined) newest = at
      }, () => {})
      lookForNotes()
    }, FALLBACK_MS)
    return () => { stopWrites(); stopNotes(); clearInterval(timer) }
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
