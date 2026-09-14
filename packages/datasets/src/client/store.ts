/**
 * The 题集 tab's transient store: the session binding, the list page's rows,
 * the opened dataset's items and files, one item's brief and answer record,
 * the slot filter, and the selected file's preview. Module level exports the
 * factory only — a module-level handle would pin the store's identity in the
 * module cache (a de-facto singleton surviving plugin reloads). register()
 * receives the factory (exclusive use: the framework instantiates per entry)
 * and the view derives its PropsStore share from the return type.
 *
 * Two pages, one store: `page` says which is showing. The detail page's
 * per-item values are keyed by `<dataset>/<item>` so switching items keeps
 * what was already fetched, and a binding change clears everything resolved
 * against the old binding in one action.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  DatasetBinding, DatasetOverview, DatasetSlot, ItemBrief, ItemRecord, ListItemsResult,
  ReadResult, SkeletonResult, ValidateDatasetResult,
} from '../types.ts'
import type { DatasetExperimentRow, ItemRunsView } from './contract.ts'

/** One selected file: a layer file, or a passthrough-zone file (either readable). */
export type DatasetSelection =
  | {
    readonly kind: 'layer'
    readonly dataset: string
    /** Item id, or null for a DATASET-LEVEL (shared) layer file. */
    readonly item: string | null
    readonly layer: string
    /** Layer-relative file path (as the layer's file list reports it). */
    readonly path: string
  }
  | {
    readonly kind: 'passthrough'
    readonly dataset: string
    /** Item id for item.json, or null for a dataset-level passthrough file. */
    readonly item: string | null
    /** Dataset-relative file path (manifest.yml, docs/x.md, items/<item>/item.json). */
    readonly path: string
  }

/** Which page the tab is on. */
export type DatasetsPage = 'list' | 'detail'

/** Which inline form is open, if any (the tab writes nothing without one). */
export type DatasetsForm = 'newDataset' | 'newItem' | 'importItem' | null

/** The key one item's fetched values are filed under. */
export function itemKey(dataset: string, item: string): string {
  return `${dataset}/${item}`
}

/** The view's state; fetched results are whole values, null until loaded. */
export interface DatasetsViewState {
  /** The session's current binding (null = unbound), loaded on mount. */
  binding: DatasetBinding | null
  /** Whether the binding fetch has answered at least once. */
  bindingLoaded: boolean
  /** Human-readable notice from a bind/unbind/write failure, or null. */
  notice: string | null
  /** The list page's rows with their repo and commit, or null before the first load. */
  overview: DatasetOverview | null
  /** Whether the list fetch is in flight. */
  listLoading: boolean
  /** Human-readable list-fetch failure, or null when idle. */
  listError: string | null
  /** Bumped by the refresh action to re-trigger the binding + list fetches. */
  refreshRev: number
  /** Which page is showing. */
  page: DatasetsPage
  /** The dataset the detail page is about, or null on the list page. */
  openDataset: string | null
  /** The item whose brief and answer record the right pane shows. */
  openItem: string | null
  /** Item records per dataset id, loaded when a dataset's detail page opens. */
  items: Record<string, readonly ItemRecord[]>
  /** Dataset-level (shared) layer files per dataset id, loaded with its items. */
  sharedLayers: Record<string, Record<string, readonly string[]>>
  /** The passthrough zone per dataset id (never filtered — shown BECAUSE it is unprotected). */
  passthrough: Record<string, readonly string[]>
  /** The slots the tree is filtered to; null = every slot. */
  slotFilter: readonly DatasetSlot[] | null
  /** One item's brief (选手将看到 + 可判性), keyed by `<dataset>/<item>`. */
  briefs: Record<string, ItemBrief>
  /** Whether a brief fetch is in flight, keyed the same way. */
  briefLoading: Record<string, boolean>
  /** A brief fetch's failure, keyed the same way. */
  briefError: Record<string, string>
  /**
   * One item's answer record, keyed the same way. `null` (the VALUE, not an
   * absent key) means this instance carries no eval plugin — the section hides.
   */
  runs: Record<string, ItemRunsView | null>
  /** Experiments the repository's plans declare, or null when no eval plugin answered. */
  experiments: readonly DatasetExperimentRow[] | null
  /** The detail page's latest validate outcome, keyed by dataset id. */
  validated: Record<string, ValidateDatasetResult>
  /** Whether a validate call is in flight. */
  validating: boolean
  /** Which inline write form is open. */
  form: DatasetsForm
  /** The last skeleton/import result, shown until dismissed. */
  skeleton: SkeletonResult | null
  /** The selected file's coordinates, or null when nothing is selected. */
  selection: DatasetSelection | null
  /** The selected file's content, or null before one completes. */
  preview: ReadResult | null
  /** Whether a preview read is in flight. */
  previewLoading: boolean
  /** Human-readable preview-fetch failure, or null when idle. */
  previewError: string | null
}

/** Annotation twin of the actions literal below (drift fails assignability at defineStore). */
export type DatasetsViewActions = {
  setBinding: (draft: DatasetsViewState, binding: DatasetBinding | null) => void
  setNotice: (draft: DatasetsViewState, notice: string | null) => void
  refresh: (draft: DatasetsViewState) => void
  setOverview: (draft: DatasetsViewState, overview: DatasetOverview) => void
  setListLoading: (draft: DatasetsViewState, loading: boolean) => void
  setListError: (draft: DatasetsViewState, error: string | null) => void
  openDataset: (draft: DatasetsViewState, dataset: string | null) => void
  openItem: (draft: DatasetsViewState, item: string | null) => void
  setDetails: (draft: DatasetsViewState, dataset: string, detail: ListItemsResult) => void
  setSlotFilter: (draft: DatasetsViewState, slots: readonly DatasetSlot[] | null) => void
  setBrief: (draft: DatasetsViewState, key: string, brief: ItemBrief) => void
  setBriefLoading: (draft: DatasetsViewState, key: string, loading: boolean) => void
  setBriefError: (draft: DatasetsViewState, key: string, error: string | null) => void
  setRuns: (draft: DatasetsViewState, key: string, runs: ItemRunsView | null) => void
  setExperiments: (draft: DatasetsViewState, rows: readonly DatasetExperimentRow[] | null) => void
  setValidated: (draft: DatasetsViewState, dataset: string, result: ValidateDatasetResult) => void
  setValidating: (draft: DatasetsViewState, running: boolean) => void
  setForm: (draft: DatasetsViewState, form: DatasetsForm) => void
  setSkeleton: (draft: DatasetsViewState, result: SkeletonResult | null) => void
  select: (draft: DatasetsViewState, selection: DatasetSelection | null) => void
  setPreview: (draft: DatasetsViewState, preview: ReadResult) => void
  setPreviewLoading: (draft: DatasetsViewState, loading: boolean) => void
  setPreviewError: (draft: DatasetsViewState, error: string | null) => void
}

const INITIAL: DatasetsViewState = {
  binding: null,
  bindingLoaded: false,
  notice: null,
  overview: null,
  listLoading: false,
  listError: null,
  refreshRev: 0,
  page: 'list',
  openDataset: null,
  openItem: null,
  items: {},
  sharedLayers: {},
  passthrough: {},
  slotFilter: null,
  briefs: {},
  briefLoading: {},
  briefError: {},
  runs: {},
  experiments: null,
  validated: {},
  validating: false,
  form: null,
  skeleton: null,
  selection: null,
  preview: null,
  previewLoading: false,
  previewError: null,
}

/**
 * Create the 题集 view store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createDatasetsViewStore(): EngineStoreHandle<DatasetsViewState, DatasetsViewActions> {
  return defineStore({
    init: (): DatasetsViewState => ({ ...INITIAL }),
    actions: {
      setBinding: (d, binding: DatasetBinding | null) => {
        d.binding = binding
        d.bindingLoaded = true
        // A binding change invalidates everything resolved against the old one
        // — including which pages make sense, so the tab returns to the list.
        d.overview = null
        d.listError = null
        d.page = 'list'
        d.openDataset = null
        d.openItem = null
        d.items = {}
        d.sharedLayers = {}
        d.passthrough = {}
        d.briefs = {}
        d.briefLoading = {}
        d.briefError = {}
        d.runs = {}
        d.experiments = null
        d.validated = {}
        d.slotFilter = null
        d.selection = null
        d.preview = null
        d.previewError = null
      },
      setNotice: (d, notice: string | null) => { d.notice = notice },
      refresh: (d) => { d.refreshRev += 1 },
      setOverview: (d, overview: DatasetOverview) => {
        d.overview = overview
        d.listError = null
      },
      setListLoading: (d, loading: boolean) => { d.listLoading = loading },
      setListError: (d, error: string | null) => { d.listError = error },
      openDataset: (d, dataset: string | null) => {
        d.openDataset = dataset
        d.page = dataset === null ? 'list' : 'detail'
        d.openItem = null
        d.selection = null
        d.preview = null
        d.previewError = null
        d.slotFilter = null
        d.form = null
        d.skeleton = null
      },
      openItem: (d, item: string | null) => {
        d.openItem = item
        // Opening an item shows its brief; the file preview waits for a file.
        d.selection = null
        d.preview = null
        d.previewError = null
      },
      setDetails: (d, dataset: string, detail: ListItemsResult) => {
        d.items[dataset] = detail.items
        d.sharedLayers[dataset] = detail.datasetLayers
        d.passthrough[dataset] = detail.passthrough
      },
      setSlotFilter: (d, slots: readonly DatasetSlot[] | null) => { d.slotFilter = slots },
      setBrief: (d, key: string, brief: ItemBrief) => {
        d.briefs[key] = brief
        delete d.briefError[key]
      },
      setBriefLoading: (d, key: string, loading: boolean) => { d.briefLoading[key] = loading },
      setBriefError: (d, key: string, error: string | null) => {
        if (error === null) delete d.briefError[key]
        else d.briefError[key] = error
      },
      setRuns: (d, key: string, runs: ItemRunsView | null) => { d.runs[key] = runs },
      setExperiments: (d, rows: readonly DatasetExperimentRow[] | null) => { d.experiments = rows },
      setValidated: (d, dataset: string, result: ValidateDatasetResult) => { d.validated[dataset] = result },
      setValidating: (d, running: boolean) => { d.validating = running },
      setForm: (d, form: DatasetsForm) => {
        d.form = form
        if (form !== null) d.skeleton = null
      },
      setSkeleton: (d, result: SkeletonResult | null) => {
        d.skeleton = result
        if (result !== null) d.form = null
      },
      select: (d, selection: DatasetSelection | null) => {
        d.selection = selection
        d.preview = null
        d.previewError = null
      },
      setPreview: (d, preview: ReadResult) => {
        d.preview = preview
        d.previewError = null
      },
      setPreviewLoading: (d, loading: boolean) => { d.previewLoading = loading },
      setPreviewError: (d, error: string | null) => { d.previewError = error },
    },
  })
}
