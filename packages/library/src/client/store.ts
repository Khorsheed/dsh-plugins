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

/** An ask sent to the coach that has not landed yet: when, the paper count it must beat, and what was asked. */
export interface LibraryQuizAsk {
  readonly since: number
  readonly count: number
  readonly summary: string
}

/** One station's quiz state, kept across tab switches (keyed `project:resource:node`). */
export interface LibraryStationQuiz {
  readonly settings?: LibraryQuizSettings
  readonly ask?: LibraryQuizAsk
}

/** The pane's state. */
export interface LibraryState {
  /** The route stack; the last entry is on screen. */
  stack: LibraryRoute[]
  /** Bumped to make the open view re-read the host. */
  rev: number
  /** Per-station quiz settings and the pending ask — they outlive the tab that shows them. */
  quiz: Record<string, LibraryStationQuiz>
  /** Stations whose 讲义 the learner asked for (开始学这一站), keyed `project:resource:node` → when. */
  preparing: Record<string, number>
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
  /** Remember a station's 章节考 settings. */
  setQuizSettings: (draft: LibraryState, key: string, settings: LibraryQuizSettings) => void
  /** Start (or clear, with undefined) a station's pending ask. */
  setQuizAsk: (draft: LibraryState, key: string, ask: LibraryQuizAsk | undefined) => void
  /** Start (or clear) waiting for a station's 讲义. */
  setPreparing: (draft: LibraryState, key: string, since: number | undefined) => void
}

const TODAY: LibraryRoute = { view: 'today' }

/**
 * Create the library pane's store handle.
 * @returns the store handle (spec, type, identity and factory in one).
 */
export function createLibraryStore(): EngineStoreHandle<LibraryState, LibraryActions> {
  return defineStore({
    init: (): LibraryState => ({ stack: [TODAY], rev: 0, quiz: {}, preparing: {} }),
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
      setQuizSettings: (d, key, settings) => { d.quiz[key] = { ...d.quiz[key], settings } },
      setQuizAsk: (d, key, ask) => {
        const { ask: _previous, ...rest } = d.quiz[key] ?? {}
        d.quiz[key] = ask === undefined ? rest : { ...rest, ask }
      },
      setPreparing: (d, key, since) => {
        if (since === undefined) delete d.preparing[key]
        else d.preparing[key] = since
      },
    },
  })
}
