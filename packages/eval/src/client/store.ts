/**
 * The lab tab's transient store: the experiment list, which row is open, and
 * which of the detail's seven sub-pages is showing. Module level exports the
 * factory only — a module-level handle would pin the store's identity in the
 * module cache (a de-facto singleton surviving plugin reloads).
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { EvalExperimentDetail, EvalExperimentsResult } from '../types.ts'

/**
 * The detail's sub-pages, in the tab order ui-spec §五 fixes. Only `overview`
 * has a body in this slice; the rest carry the placeholder naming their task.
 */
export const LAB_PAGES = ['overview', 'plan', 'conditions', 'matrix', 'cells', 'report', 'judging'] as const

/** One sub-page of an experiment's detail. */
export type LabPage = typeof LAB_PAGES[number]

/** The view's state; fetched results are whole values, null until loaded. */
export interface LabViewState {
  /** The list payload, or null before the first load. */
  list: EvalExperimentsResult | null
  /** Whether a list fetch is in flight. */
  loading: boolean
  /** Human-readable list-fetch failure, or null when idle. */
  error: string | null
  /** Bumped by the refresh action to re-trigger the list fetch. */
  refreshRev: number
  /** The open experiment's row id, or null while the list is showing. */
  selection: string | null
  /** Which sub-page of the detail is showing. */
  page: LabPage
  /** The open experiment's detail, or null for a draft / before one completes. */
  detail: EvalExperimentDetail | null
  /** Whether a detail fetch is in flight. */
  detailLoading: boolean
  /** Human-readable detail-fetch failure, or null. */
  detailError: string | null
}

/** Annotation twin of the actions literal below (drift fails assignability at defineStore). */
export type LabViewActions = {
  setList: (draft: LabViewState, list: EvalExperimentsResult) => void
  setLoading: (draft: LabViewState, loading: boolean) => void
  setError: (draft: LabViewState, error: string | null) => void
  refresh: (draft: LabViewState) => void
  open: (draft: LabViewState, id: string | null) => void
  setPage: (draft: LabViewState, page: LabPage) => void
  setDetail: (draft: LabViewState, detail: EvalExperimentDetail) => void
  setDetailLoading: (draft: LabViewState, loading: boolean) => void
  setDetailError: (draft: LabViewState, error: string | null) => void
}

const INITIAL: LabViewState = {
  list: null,
  loading: false,
  error: null,
  refreshRev: 0,
  selection: null,
  page: 'overview',
  detail: null,
  detailLoading: false,
  detailError: null,
}

/**
 * Create the lab view store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLabViewStore(): EngineStoreHandle<LabViewState, LabViewActions> {
  return defineStore({
    init: (): LabViewState => ({ ...INITIAL }),
    actions: {
      setList: (d, list: EvalExperimentsResult) => {
        d.list = list
        d.error = null
      },
      setLoading: (d, loading: boolean) => { d.loading = loading },
      setError: (d, error: string | null) => { d.error = error },
      refresh: (d) => { d.refreshRev += 1 },
      open: (d, id: string | null) => {
        d.selection = id
        // Opening an experiment always lands on the overview: the sub-page is
        // a property of the visit, not of the experiment.
        d.page = 'overview'
        d.detail = null
        d.detailError = null
      },
      setPage: (d, page: LabPage) => { d.page = page },
      setDetail: (d, detail: EvalExperimentDetail) => {
        d.detail = detail
        d.detailError = null
      },
      setDetailLoading: (d, loading: boolean) => { d.detailLoading = loading },
      setDetailError: (d, error: string | null) => { d.detailError = error },
    },
  })
}
