/**
 * The library pane's transient store: where the learner is in the sidebar —
 * a stack of routes, so 「‹」 always returns to the screen they came from —
 * and a revision counter the views reload on. Everything durable lives in the
 * host's `state/dsh-library/`; each view re-reads it on mount and on `rev`.
 *
 * @module @khorsheed/dsh-library/client/store
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { LibraryAssessResult } from '../types.ts'

/** The card list's filters. */
export type LibraryCardFilter = 'all' | 'photo' | 'chat' | 'quiz' | 'due'

/** The node page's tabs. */
export type LibraryNodeTab = 'guide' | 'pages' | 'quiz'

/** One screen of the sidebar. */
export type LibraryRoute =
  | { readonly view: 'today' }
  | { readonly view: 'newProject' }
  | { readonly view: 'project'; readonly projectId: string }
  | { readonly view: 'book'; readonly projectId: string; readonly bookId: string }
  | { readonly view: 'node'; readonly projectId: string; readonly bookId: string; readonly nodeId: string; readonly tab: LibraryNodeTab }
  | { readonly view: 'cards'; readonly projectId: string; readonly filter: LibraryCardFilter }
  | { readonly view: 'quiz'; readonly projectId: string; readonly bookId: string; readonly quizId: string }
  | { readonly view: 'result'; readonly projectId: string; readonly bookId: string; readonly result: LibraryAssessResult }
  | { readonly view: 'review'; readonly projectId?: string }

/** The pane's state. */
export interface LibraryState {
  /** The route stack; the last entry is on screen. */
  stack: LibraryRoute[]
  /** Bumped to make the open view re-read the host. */
  rev: number
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
  refresh: (draft: LibraryState) => void
}

const TODAY: LibraryRoute = { view: 'today' }

/**
 * Create the library pane's store handle.
 * @returns the store handle (spec, type, identity and factory in one).
 */
export function createLibraryStore(): EngineStoreHandle<LibraryState, LibraryActions> {
  return defineStore({
    init: (): LibraryState => ({ stack: [TODAY], rev: 0 }),
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
      refresh: (d) => { d.rev += 1 },
    },
  })
}
