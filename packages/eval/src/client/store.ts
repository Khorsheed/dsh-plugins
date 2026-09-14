/**
 * The lab tab's transient store: the experiment list, which row is open, which
 * of the detail's seven sub-pages is showing, and — since I5·T35b — how the
 * matrix is arranged and which cell's drawer is open. Module level exports the
 * factory only: a module-level handle would pin the store's identity in the
 * module cache (a de-facto singleton surviving plugin reloads).
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  EvalCellDetail, EvalCellsResult, EvalExperimentDetail, EvalExperimentsResult, EvalMatrixView,
} from '../types.ts'

/**
 * The detail's sub-pages, in the tab order ui-spec §五 fixes. `overview`
 * (T35a), `matrix` and `cells` (T35b) have bodies; the rest carry the
 * placeholder naming their task.
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
  /** Bumped by the refresh action to re-trigger every fetch. */
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

  /** The factor the matrix puts on its columns; null takes the first one. */
  matrixColumn: string | null
  /** Remaining factors banding the matrix rows. */
  matrixGroupBy: string[]
  /** Remaining factors pinned to one canonical value each. */
  matrixFilter: Record<string, string>
  /** The matrix payload, or null before the first load. */
  matrix: EvalMatrixView | null
  matrixLoading: boolean
  matrixError: string | null

  /** The cells page's bucket filter, or null for every bucket. */
  cellsBucket: string | null
  /** The cell list, or null before the first load. */
  cells: EvalCellsResult | null
  cellsLoading: boolean
  cellsError: string | null

  /** The cell whose drawer is open, or null. */
  cellSelection: string | null
  /** The open cell's detail, or null before it completes. */
  cell: EvalCellDetail | null
  cellLoading: boolean
  cellError: string | null

  /** Whether the export dialog is open. */
  exportOpen: boolean
  /** One-shot notice line (retry / release check / export outcomes), or null. */
  notice: string | null
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
  setMatrixColumn: (draft: LabViewState, column: string | null) => void
  toggleMatrixGroup: (draft: LabViewState, factor: string) => void
  setMatrixFilter: (draft: LabViewState, factor: string, value: string | null) => void
  setMatrix: (draft: LabViewState, matrix: EvalMatrixView) => void
  setMatrixLoading: (draft: LabViewState, loading: boolean) => void
  setMatrixError: (draft: LabViewState, error: string | null) => void
  setCellsBucket: (draft: LabViewState, bucket: string | null) => void
  setCells: (draft: LabViewState, cells: EvalCellsResult) => void
  setCellsLoading: (draft: LabViewState, loading: boolean) => void
  setCellsError: (draft: LabViewState, error: string | null) => void
  openCell: (draft: LabViewState, missionId: string | null) => void
  setCell: (draft: LabViewState, cell: EvalCellDetail) => void
  setCellLoading: (draft: LabViewState, loading: boolean) => void
  setCellError: (draft: LabViewState, error: string | null) => void
  setExportOpen: (draft: LabViewState, open: boolean) => void
  setNotice: (draft: LabViewState, notice: string | null) => void
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
  matrixColumn: null,
  matrixGroupBy: [],
  matrixFilter: {},
  matrix: null,
  matrixLoading: false,
  matrixError: null,
  cellsBucket: null,
  cells: null,
  cellsLoading: false,
  cellsError: null,
  cellSelection: null,
  cell: null,
  cellLoading: false,
  cellError: null,
  exportOpen: false,
  notice: null,
}

/** Everything that is about ONE experiment, cleared when another opens. */
function resetExperimentScoped(draft: LabViewState): void {
  draft.detail = null
  draft.detailError = null
  draft.matrixColumn = null
  draft.matrixGroupBy = []
  draft.matrixFilter = {}
  draft.matrix = null
  draft.matrixError = null
  draft.cellsBucket = null
  draft.cells = null
  draft.cellsError = null
  draft.cellSelection = null
  draft.cell = null
  draft.cellError = null
  draft.exportOpen = false
  draft.notice = null
}

/**
 * Create the lab view store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLabViewStore(): EngineStoreHandle<LabViewState, LabViewActions> {
  return defineStore({
    init: (): LabViewState => ({ ...INITIAL, matrixGroupBy: [], matrixFilter: {} }),
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
        resetExperimentScoped(d)
      },
      setPage: (d, page: LabPage) => { d.page = page },
      setDetail: (d, detail: EvalExperimentDetail) => {
        d.detail = detail
        d.detailError = null
      },
      setDetailLoading: (d, loading: boolean) => { d.detailLoading = loading },
      setDetailError: (d, error: string | null) => { d.detailError = error },

      setMatrixColumn: (d, column: string | null) => {
        d.matrixColumn = column
        // A factor cannot be the column and a band at once, and pinning the
        // column's own factor would collapse the comparison to one column.
        d.matrixGroupBy = d.matrixGroupBy.filter(factor => factor !== column)
        if (column !== null && column in d.matrixFilter) {
          const next = { ...d.matrixFilter }
          delete next[column]
          d.matrixFilter = next
        }
        d.matrix = null
      },
      toggleMatrixGroup: (d, factor: string) => {
        d.matrixGroupBy = d.matrixGroupBy.includes(factor)
          ? d.matrixGroupBy.filter(entry => entry !== factor)
          : [...d.matrixGroupBy, factor]
        d.matrix = null
      },
      setMatrixFilter: (d, factor: string, value: string | null) => {
        const next = { ...d.matrixFilter }
        if (value === null) delete next[factor]
        else next[factor] = value
        d.matrixFilter = next
        d.matrix = null
      },
      setMatrix: (d, matrix: EvalMatrixView) => {
        d.matrix = matrix
        d.matrixError = null
      },
      setMatrixLoading: (d, loading: boolean) => { d.matrixLoading = loading },
      setMatrixError: (d, error: string | null) => { d.matrixError = error },

      setCellsBucket: (d, bucket: string | null) => {
        d.cellsBucket = bucket
        d.cells = null
      },
      setCells: (d, cells: EvalCellsResult) => {
        d.cells = cells
        d.cellsError = null
      },
      setCellsLoading: (d, loading: boolean) => { d.cellsLoading = loading },
      setCellsError: (d, error: string | null) => { d.cellsError = error },

      openCell: (d, missionId: string | null) => {
        d.cellSelection = missionId
        d.cell = null
        d.cellError = null
        d.exportOpen = false
      },
      setCell: (d, cell: EvalCellDetail) => {
        d.cell = cell
        d.cellError = null
      },
      setCellLoading: (d, loading: boolean) => { d.cellLoading = loading },
      setCellError: (d, error: string | null) => { d.cellError = error },
      setExportOpen: (d, open: boolean) => { d.exportOpen = open },
      setNotice: (d, notice: string | null) => { d.notice = notice },
    },
  })
}
