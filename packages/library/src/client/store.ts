/**
 * The library pane's transient store: the project list the open pane renders.
 * Everything durable lives in the host's `state/dsh-library/`; this store is
 * re-read from the host on every mount.
 *
 * @module @khorsheed/dsh-library/client/store
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { LibraryProjectSummary } from '../types.ts'

/** The pane's state. */
export interface LibraryState {
  projects: LibraryProjectSummary[]
  loading: boolean
  error: string | null
}

/** Annotation twin of the actions literal below. */
export type LibraryActions = {
  setProjects: (draft: LibraryState, projects: LibraryProjectSummary[]) => void
  setLoading: (draft: LibraryState, loading: boolean) => void
  setError: (draft: LibraryState, error: string | null) => void
}

/**
 * Create the library pane's store handle.
 * @returns the store handle (spec, type, identity and factory in one).
 */
export function createLibraryStore(): EngineStoreHandle<LibraryState, LibraryActions> {
  return defineStore({
    init: (): LibraryState => ({ projects: [], loading: false, error: null }),
    actions: {
      setProjects: (d, projects) => {
        d.projects = projects
        d.loading = false
        d.error = null
      },
      setLoading: (d, loading) => { d.loading = loading },
      setError: (d, error) => {
        d.error = error
        d.loading = false
      },
    },
  })
}
