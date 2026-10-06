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
import type { ReactNode } from 'react'
import { PanelRoot } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
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
          case 'book': return <BookView p={props} projectId={route.projectId} bookId={route.bookId} />
          case 'node': return <NodeView p={props} projectId={route.projectId} bookId={route.bookId} nodeId={route.nodeId} tab={route.tab} />
          case 'cards': return <CardsView p={props} projectId={route.projectId} filter={route.filter} />
          case 'quiz': return <QuizView p={props} projectId={route.projectId} bookId={route.bookId} quizId={route.quizId} />
          case 'result': return <ResultView p={props} projectId={route.projectId} bookId={route.bookId} result={route.result} />
          case 'review': return <ReviewView p={props} {...(route.projectId === undefined ? {} : { projectId: route.projectId })} />
        }
      })()}
    </PanelRoot>
  )
}
