/**
 * The library pane's transient store: where the learner is in the sidebar —
 * a stack of routes, so 「‹」 always returns to the screen they came from —
 * and a revision counter the views reload on. Everything durable lives in the
 * host's `state/dsh-library/`; each view re-reads it on mount and on `rev`.
 *
 * @module @khorsheed/dsh-library/client/store
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { LibraryAssessResult, LibraryQuizFocus, LibraryQuizQuestion } from '../types.ts'
import type { LibraryNavParams } from '../nav-line.ts'

/** The card list's filters. */
export type LibraryCardFilter = 'all' | 'photo' | 'chat' | 'quiz' | 'due'

/** The node page's tabs. */
export type LibraryNodeTab = 'guide' | 'pages' | 'notes' | 'quiz'

/** One screen of the sidebar. */
export type LibraryRoute =
  | { readonly view: 'today' }
  | { readonly view: 'newProject' }
  | { readonly view: 'project'; readonly projectId: string }
  | { readonly view: 'resource'; readonly projectId: string; readonly resourceId: string }
  | { readonly view: 'node'; readonly projectId: string; readonly resourceId: string; readonly nodeId: string; readonly tab: LibraryNodeTab }
  | { readonly view: 'lesson'; readonly projectId: string; readonly resourceId: string; readonly nodeId: string }
  | { readonly view: 'cards'; readonly projectId: string; readonly filter: LibraryCardFilter }
  | { readonly view: 'quiz'; readonly projectId: string; readonly resourceId?: string; readonly quizId: string }
  | { readonly view: 'result'; readonly projectId: string; readonly resourceId?: string; readonly result: LibraryAssessResult }
  | { readonly view: 'review'; readonly projectId?: string }

/** A station's 章节考 settings, as the learner left them. */
export interface LibraryQuizSettings {
  readonly focus: LibraryQuizFocus
  readonly kinds: readonly LibraryQuizQuestion['kind'][]
  readonly countText: string
  /** The picked points (重点出这些) — empty means the coach picks by weakness. */
  readonly picked: readonly string[]
}

/** One station's quiz state, kept across tab switches (keyed `project:resource:node`). */
export interface LibraryStationQuiz {
  readonly settings?: LibraryQuizSettings
}

/** The pane's state. */
export interface LibraryState {
  /** The route stack; the last entry is on screen. */
  stack: LibraryRoute[]
  /** Bumped to make the open view re-read the host. */
  rev: number
  /** Per-station quiz settings — they outlive the tab that shows them. */
  quiz: Record<string, LibraryStationQuiz>
}

/** Annotation twin of the actions literal below. */
export type LibraryActions = {
  /** Open a screen on top of the current one. */
  push: (draft: LibraryState, route: LibraryRoute) => void
  /** Replace the current screen (tab switches, filter changes). */
  replace: (draft: LibraryState, route: LibraryRoute) => void
  /** Back one screen (never past today). */
  pop: (draft: LibraryState) => void
  /** Back to today. */
  home: (draft: LibraryState) => void
  /**
   * Land on one address (the tab's navigation params — a destination, a
   * room's desk row): the screen it names, over the screens 「‹」 walks back
   * through (today, the project, the book).
   */
  land: (draft: LibraryState, params: LibraryNavParams) => void
  refresh: (draft: LibraryState) => void
  /** Remember a station's 章节考 settings. */
  setQuizSettings: (draft: LibraryState, key: string, settings: LibraryQuizSettings) => void
}

const TODAY: LibraryRoute = { view: 'today' }

/**
 * The route stack one address opens: the screen it names on top of the ones
 * 「‹」 returns through.
 * @param params - the address.
 * @returns the stack, today at its bottom.
 */
export function stackOf(params: LibraryNavParams): LibraryRoute[] {
  if (params.view === 'today') return [TODAY]
  const project: LibraryRoute = { view: 'project', projectId: params.projectId }
  if (params.view === 'project') return [TODAY, project]
  if (params.view === 'cards') return [TODAY, project, { view: 'cards', projectId: params.projectId, filter: params.filter ?? 'all' }]
  if (params.view === 'quiz') {
    const quiz: LibraryRoute = { view: 'quiz', projectId: params.projectId, ...(params.resourceId === undefined ? {} : { resourceId: params.resourceId }), quizId: params.quizId }
    return params.resourceId === undefined
      ? [TODAY, project, quiz]
      : [TODAY, project, { view: 'resource', projectId: params.projectId, resourceId: params.resourceId }, quiz]
  }
  const book: LibraryRoute = { view: 'resource', projectId: params.projectId, resourceId: params.resourceId }
  if (params.view === 'book') return [TODAY, project, book]
  const at = { projectId: params.projectId, resourceId: params.resourceId, nodeId: params.nodeId }
  if (params.view === 'lesson') return [TODAY, project, book, { view: 'lesson', ...at }]
  return [TODAY, project, book, { view: 'node', ...at, tab: params.tab ?? 'guide' }]
}

/**
 * Create the library pane's store handle.
 * @returns the store handle (spec, type, identity and factory in one).
 */
export function createLibraryStore(): EngineStoreHandle<LibraryState, LibraryActions> {
  return defineStore({
    init: (): LibraryState => ({ stack: [TODAY], rev: 0, quiz: {} }),
    actions: {
      push: (d, route) => { d.stack.push(route) },
      replace: (d, route) => { d.stack[d.stack.length - 1] = route },
      pop: (d) => {
        if (d.stack.length > 1) d.stack.pop()
        d.rev += 1
      },
      home: (d) => {
        d.stack = [TODAY]
        d.rev += 1
      },
      land: (d, params) => {
        d.stack = stackOf(params)
        d.rev += 1
      },
      refresh: (d) => { d.rev += 1 },
      setQuizSettings: (d, key, settings) => { d.quiz[key] = { ...d.quiz[key], settings } },
    },
  })
}
